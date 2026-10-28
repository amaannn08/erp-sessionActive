// ERP Session Keeper — Content Script (ISOLATED world, top frame only)
//
// - Pings keepAlive.htm on request from the background service worker, or on
//   its own when the session-expiry modal shows up, the tab becomes visible
//   again, or a frozen tab thaws.
// - Reports the real session-expiry (read straight from localStorage) to the
//   background worker so the badge/popup reflect the page's own truth.
// - Answers guard.js (MAIN world) when it intercepts a script-driven logout:
//   pings the server and tells guard.js whether to let the logout through.
(function () {
  'use strict';

  var KEEPALIVE_URL = 'https://erp.iitkgp.ac.in/IIT_ERP3/keepAlive.htm';
  var SRC_GUARD = 'erp-keeper-guard';
  var SRC_CONTENT = 'erp-keeper-content';

  var lastPingResult = null; // { ok, status, at, error? }
  var pingPromise = null; // de-dupe concurrent pings

  function getExpiry() {
    var raw = null;
    try {
      raw = localStorage.getItem('session-expiry');
    } catch (e) {
      /* localStorage can throw in rare sandboxed contexts; ignore */
    }
    return raw ? Number(raw) : null;
  }

  function send(msg) {
    try {
      var p = chrome.runtime.sendMessage(msg);
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {
      /* extension context can be invalidated on reload; ignore */
    }
  }

  function reportExpiry() {
    send({ type: 'EXPIRY_UPDATE', expiry: getExpiry() });
  }

  function ping() {
    if (pingPromise) return pingPromise;

    pingPromise = (function () {
      return fetch(KEEPALIVE_URL, { credentials: 'include', cache: 'no-store' })
        .then(function (res) {
          return res.text().then(function (text) {
            var ok = res.status === 200 && !res.redirected && text.indexOf('Session Extended') !== -1;
            lastPingResult = { ok: ok, status: res.status, at: Date.now() };
          });
        })
        .catch(function (err) {
          lastPingResult = { ok: false, status: 0, error: String(err), at: Date.now() };
        })
        .then(function () {
          reportExpiry();
          send({ type: 'PING_RESULT', result: lastPingResult });
          return lastPingResult;
        });
    })();

    return pingPromise.finally(function () {
      pingPromise = null;
    });
  }

  // --- messages from the background service worker ---
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'PING_KEEPALIVE') {
      ping().then(sendResponse);
      return true; // keep the message channel open for the async response
    }
    if (msg && msg.type === 'GET_STATUS') {
      sendResponse({ expiry: getExpiry(), lastPing: lastPingResult });
      return false;
    }
  });

  // --- messages from guard.js (MAIN world) ---
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== SRC_GUARD) return;

    if (data.type === 'LOGOUT_INTERCEPTED') {
      ping().then(function (result) {
        window.postMessage(
          { source: SRC_CONTENT, type: result.ok ? 'LOGOUT_BLOCKED' : 'ALLOW_LOGOUT' },
          location.origin
        );
        send({ type: result.ok ? 'LOGOUT_BLOCKED' : 'LOGOUT_ALLOWED' });
      });
    }
  });

  // --- modal watcher: ping immediately if the warning modal appears ---
  function watchModal() {
    var modal = document.getElementById('sessionModal');
    if (!modal) return;

    function isVisible() {
      return modal.classList.contains('in') || modal.style.display === 'block';
    }

    var wasVisible = isVisible();
    var observer = new MutationObserver(function () {
      var nowVisible = isVisible();
      if (nowVisible && !wasVisible) ping();
      wasVisible = nowVisible;
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  // --- another tab reset/extended/logged out: push the new expiry along ---
  window.addEventListener('storage', function (event) {
    if (event.key === 'session-expiry' || event.key === 'session-event') {
      reportExpiry();
    }
  });

  // --- catch up immediately after being hidden/frozen ---
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') ping();
  });
  // Page Lifecycle API: fires when a bfcache-frozen tab thaws.
  document.addEventListener('resume', function () {
    ping();
  });

  // --- init ---
  watchModal();
  reportExpiry();
  send({ type: 'HELLO', expiry: getExpiry() });
})();
