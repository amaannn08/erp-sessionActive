// ERP Session Keeper — Background Service Worker
//
// Orchestrates the heartbeat alarm, keeps the ERP tab from being discarded,
// falls back to pinging the server directly when no tab answers, and tracks
// state for the popup/badge. MV3 service workers can be killed and restarted
// at any time, so nothing important lives only in memory — it's all in
// chrome.storage.local, and alarms/listeners are re-established on every
// wake (onInstalled, onStartup, and simply by virtue of being an event
// listener registered at the top level).

var ERP_URL_PATTERN = 'https://erp.iitkgp.ac.in/IIT_ERP3/*';
var KEEPALIVE_URL = 'https://erp.iitkgp.ac.in/IIT_ERP3/keepAlive.htm';
var HEARTBEAT_ALARM = 'heartbeat';
var RETRY_ALARM = 'retry';
var STORAGE_KEY = 'ekState';
var MAX_HISTORY = 60;
var RETRY_DELAYS_MIN = [0.5, 0.5, 1, 2, 2]; // backoff, capped; index by (failures-1)

var DEFAULT_STATE = {
  enabled: true,
  intervalMinutes: 5,
  expiry: null, // epoch ms, best known value reported by a content script
  lastPing: null, // { ok, status, at, error?, source? }
  lastSuccessAt: null,
  consecutiveFailures: 0,
  noTabs: false,
  deadSince: null, // epoch ms since the current ok->fail incident began, or null
  history: [] // [{ at, lastAt, count, type, detail, status?, redirected?, finalUrl?, snippet? }]
};

// ---------------- storage helpers ----------------

async function getState() {
  var got = await chrome.storage.local.get(STORAGE_KEY);
  return Object.assign({}, DEFAULT_STATE, got[STORAGE_KEY]);
}

async function setState(patch) {
  var cur = await getState();
  var next = Object.assign({}, cur);
  // Skip undefined values so a caller can pass `undefined` to mean
  // "leave this field alone" instead of clobbering it.
  for (var key in patch) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

// Decide whether a candidate entry should be merged into the most recent
// history entry instead of appended as a new one: same type, and for ping
// entries also the same status + redirected flag (so e.g. a run of
// identical "status 200, not redirected" failures collapses into one entry
// with a growing count instead of flooding the ring buffer).
function matchesPrev(prev, entry) {
  if (!prev || prev.type !== entry.type) return false;
  if (entry.type === 'ping-ok' || entry.type === 'ping-fail') {
    return prev.status === entry.status && prev.redirected === entry.redirected;
  }
  return true;
}

// Append `entry` to state.history, coalescing into history[0] when
// matchesPrev() says they represent the same ongoing condition. The first
// occurrence's detail/snippet/finalUrl are kept on merge (most informative);
// only `lastAt` and `count` change.
function appendOrCoalesce(state, entry) {
  var history = state.history || [];
  var prev = history[0];
  if (matchesPrev(prev, entry)) {
    var merged = Object.assign({}, prev, { lastAt: entry.at, count: (prev.count || 1) + 1 });
    return [merged].concat(history.slice(1)).slice(0, MAX_HISTORY);
  }
  var fresh = Object.assign({ count: 1, lastAt: entry.at }, entry);
  return [fresh].concat(history).slice(0, MAX_HISTORY);
}

// Always append a brand-new entry, bypassing coalescing — for events where
// every single occurrence is individually meaningful (e.g. the page's own
// logout timer firing).
function appendFresh(state, entry) {
  var history = state.history || [];
  var fresh = Object.assign({ count: 1, lastAt: entry.at }, entry);
  return [fresh].concat(history).slice(0, MAX_HISTORY);
}

// ---------------- badge ----------------

function expiredTitle(state) {
  var title = 'Server session has expired';
  if (state.deadSince) title += ' (expired since ' + new Date(state.deadSince).toLocaleTimeString() + ')';
  return title;
}

function computeBadge(state) {
  if (!state.enabled) return { text: 'OFF', color: '#9ca3af', title: 'Keep-alive is paused' };

  if (state.noTabs) {
    return { text: '—', color: '#9ca3af', title: 'No ERP tab is open' };
  }

  if (state.lastPing && !state.lastPing.ok) {
    if (state.lastPing.error) {
      return { text: 'NET', color: '#f59e0b', title: 'Heartbeat failed (network). Retrying...' };
    }
    return { text: 'EXP', color: '#ef4444', title: expiredTitle(state) };
  }

  if (state.expiry) {
    var remainMin = Math.round((state.expiry - Date.now()) / 60000);
    if (remainMin <= 0) return { text: 'EXP', color: '#ef4444', title: expiredTitle(state) };
    var color = remainMin < 10 ? '#f59e0b' : '#10b981';
    return { text: remainMin + 'm', color: color, title: remainMin + ' minutes remaining' };
  }

  return { text: '...', color: '#9ca3af', title: 'Waiting for first session reading' };
}

async function refreshBadge(state) {
  if (!state) state = await getState();
  var badge = computeBadge(state);
  await chrome.action.setBadgeText({ text: badge.text });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
  await chrome.action.setTitle({ title: 'ERP Session Active — ' + badge.title });
}

// ---------------- alarms ----------------

async function ensureAlarms(state) {
  await chrome.alarms.clear(HEARTBEAT_ALARM);
  if (state.enabled) {
    chrome.alarms.create(HEARTBEAT_ALARM, {
      periodInMinutes: state.intervalMinutes,
      delayInMinutes: state.intervalMinutes
    });
  }
}

function scheduleRetry(consecutiveFailures) {
  var idx = Math.min(consecutiveFailures - 1, RETRY_DELAYS_MIN.length - 1);
  var delay = RETRY_DELAYS_MIN[Math.max(idx, 0)];
  chrome.alarms.create(RETRY_ALARM, { delayInMinutes: delay });
}

// ---------------- tabs ----------------

async function findErpTabs() {
  try {
    return await chrome.tabs.query({ url: ERP_URL_PATTERN });
  } catch (e) {
    return [];
  }
}

async function pingViaTab(tab) {
  try {
    var result = await chrome.tabs.sendMessage(tab.id, { type: 'PING_KEEPALIVE' });
    return result || null;
  } catch (e) {
    return null; // no content script listening yet (frozen/discarded/just opened)
  }
}

async function pingDirect() {
  try {
    var res = await fetch(KEEPALIVE_URL, { credentials: 'include', cache: 'no-store' });
    var text = await res.text();
    var ok = res.status === 200 && !res.redirected && text.indexOf('Session Extended') !== -1;
    var result = { ok: ok, status: res.status, at: Date.now(), source: 'sw', redirected: res.redirected, finalUrl: res.url };
    if (!ok) result.snippet = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    return result;
  } catch (e) {
    return { ok: false, status: 0, error: String(e), at: Date.now(), source: 'sw' };
  }
}

async function markAutoDiscardable(tabId) {
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
  } catch (e) {
    /* tab may have closed; ignore */
  }
}

// ---------------- heartbeat ----------------

async function recordPingResult(result, meta) {
  var state = await getState();
  var patch = { lastPing: result, noTabs: !!(meta && meta.noTabs) };

  if (result.ok) {
    patch.consecutiveFailures = 0;
    patch.lastSuccessAt = result.at;
    patch.deadSince = null;
  } else {
    if (!state.consecutiveFailures) patch.deadSince = result.at;
    patch.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
  }

  var detail = result.ok
    ? 'Session extended' + (meta && meta.source === 'sw' ? ' (direct, no tab answered)' : '')
    : result.error
    ? 'Ping failed: ' + result.error
    : 'Ping returned status ' + result.status + ' (session likely expired)';

  var entry = {
    at: result.at,
    type: result.ok ? 'ping-ok' : 'ping-fail',
    detail: detail,
    status: result.status,
    redirected: result.redirected
  };
  if (result.finalUrl) entry.finalUrl = result.finalUrl;
  if (result.snippet) entry.snippet = result.snippet;

  patch.history = appendOrCoalesce(state, entry);

  var next = await setState(patch);
  await refreshBadge(next);
  return next;
}

async function runHeartbeat() {
  var state = await getState();
  if (!state.enabled) {
    await refreshBadge(state);
    return;
  }

  var tabs = await findErpTabs();
  var result = null;

  for (var i = 0; i < tabs.length; i++) {
    result = await pingViaTab(tabs[i]);
    if (result) break;
  }

  var viaTab = !!result;
  if (!result) {
    // No tab answered (none open, or all frozen/discarded): keep the server
    // session alive directly from the service worker.
    result = await pingDirect();
  }

  var next = await recordPingResult(result, { noTabs: tabs.length === 0, source: viaTab ? 'tab' : 'sw' });

  if (!result.ok) {
    scheduleRetry(next.consecutiveFailures);
  } else {
    await chrome.alarms.clear(RETRY_ALARM);
  }
}

// ---------------- lifecycle ----------------

async function init() {
  var state = await getState();
  await ensureAlarms(state);
  await refreshBadge(state);
  await runHeartbeat();
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === HEARTBEAT_ALARM || alarm.name === RETRY_ALARM) {
    runHeartbeat();
  }
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete' && tab.url && tab.url.indexOf('erp.iitkgp.ac.in/IIT_ERP3/') !== -1) {
    markAutoDiscardable(tabId);
  }
});

// ---------------- messages (content scripts + popup) ----------------

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'HELLO': {
      if (sender.tab && sender.tab.id != null) markAutoDiscardable(sender.tab.id);
      setState({ expiry: msg.expiry != null ? msg.expiry : undefined, noTabs: false }).then(function (next) {
        refreshBadge(next);
      });
      return false;
    }

    case 'EXPIRY_UPDATE': {
      setState({ expiry: msg.expiry != null ? msg.expiry : undefined, noTabs: false }).then(refreshBadge);
      return false;
    }

    case 'PING_RESULT': {
      // An autonomous ping (modal watcher / visibilitychange / resume), not
      // one the SW asked for directly — still record it the same way.
      recordPingResult(msg.result, { noTabs: false, source: 'tab' });
      return false;
    }

    case 'LOGOUT_BLOCKED': {
      getState().then(function (state) {
        var entry = { at: Date.now(), type: 'logout-blocked', detail: 'Automatic logout intercepted — session was still alive' };
        return setState({ history: appendOrCoalesce(state, entry) });
      });
      return false;
    }

    case 'LOGOUT_ALLOWED': {
      getState().then(function (state) {
        var entry = { at: Date.now(), type: 'logout-allowed', detail: 'Server session had actually expired — logout allowed' };
        return setState({ history: appendOrCoalesce(state, entry) });
      });
      return false;
    }

    case 'LOGOUT_INTERCEPT_ATTEMPT': {
      getState().then(function (state) {
        var at = msg.at || Date.now();
        var entry = {
          at: at,
          type: 'logout-intercept-attempt',
          detail: "Page's own session timer tried to log out at " + new Date(at).toLocaleTimeString()
        };
        return setState({ history: appendFresh(state, entry) });
      }).then(function (next) {
        refreshBadge(next);
      });
      return false;
    }

    case 'PING_NOW': {
      runHeartbeat().then(function () { sendResponse({ ok: true }); });
      return true;
    }

    case 'SET_ENABLED': {
      setState({ enabled: !!msg.enabled }).then(async function (next) {
        await ensureAlarms(next);
        await refreshBadge(next);
        if (next.enabled) await runHeartbeat();
        sendResponse({ ok: true, state: next });
      });
      return true;
    }

    case 'SET_INTERVAL': {
      var minutes = Number(msg.intervalMinutes) || DEFAULT_STATE.intervalMinutes;
      setState({ intervalMinutes: minutes }).then(async function (next) {
        await ensureAlarms(next);
        sendResponse({ ok: true, state: next });
      });
      return true;
    }

    case 'GET_STATE': {
      getState().then(function (state) { sendResponse(state); });
      return true;
    }

    default:
      return false;
  }
});

// Fire immediately on every wake, in case onInstalled/onStartup already fired
// before this run and the SW was simply re-spawned by an incoming event.
init();
