(function () {
  'use strict';

  var ERP_URL = 'https://erp.iitkgp.ac.in/IIT_ERP3/showmenu.htm';

  var els = {
    toggle: document.getElementById('enabledToggle'),
    dot: document.getElementById('statusDot'),
    label: document.getElementById('statusLabel'),
    countdown: document.getElementById('countdown'),
    lastPingTime: document.getElementById('lastPingTime'),
    lastPingStatus: document.getElementById('lastPingStatus'),
    pingNowBtn: document.getElementById('pingNowBtn'),
    openTabBtn: document.getElementById('openTabBtn'),
    intervalSelect: document.getElementById('intervalSelect'),
    historyList: document.getElementById('historyList')
  };

  var tickTimer = null;
  var currentState = null;

  function fmtClock(ms) {
    if (ms == null || ms <= 0) return '00:00';
    var totalSec = Math.floor(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  function fmtTime(at) {
    if (!at) return '—';
    var d = new Date(at);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function historyClass(type) {
    if (type === 'ping-ok' || type === 'logout-blocked') return 'ok';
    if (type === 'ping-fail') return 'warn';
    if (type === 'logout-allowed') return 'bad';
    return '';
  }

  function render(state) {
    currentState = state;

    els.toggle.checked = !!state.enabled;
    els.intervalSelect.value = String(state.intervalMinutes || 5);

    var remainMs = state.expiry ? state.expiry - Date.now() : null;
    var expired = state.lastPing && !state.lastPing.ok && !state.lastPing.error;

    els.dot.className = 'dot';
    if (!state.enabled) {
      els.dot.classList.add('off');
      els.label.textContent = 'Paused';
    } else if (expired || (remainMs != null && remainMs <= 0)) {
      els.dot.classList.add('bad');
      els.label.textContent = 'Session expired';
    } else if (state.lastPing && !state.lastPing.ok) {
      els.dot.classList.add('warn');
      els.label.textContent = 'Network issue — retrying';
    } else if (remainMs != null && remainMs < 10 * 60 * 1000) {
      els.dot.classList.add('warn');
      els.label.textContent = 'Active & Protected';
    } else {
      els.dot.classList.add('ok');
      els.label.textContent = 'Active & Protected';
    }

    els.countdown.textContent = state.noTabs && remainMs == null ? '--:--' : fmtClock(remainMs);

    if (state.lastPing) {
      els.lastPingTime.textContent = fmtTime(state.lastPing.at);
      els.lastPingStatus.textContent = state.lastPing.ok
        ? '200 OK'
        : state.lastPing.error
        ? 'Failed (network)'
        : 'HTTP ' + state.lastPing.status;
    } else {
      els.lastPingTime.textContent = '—';
      els.lastPingStatus.textContent = '—';
    }

    els.historyList.innerHTML = '';
    (state.history || []).slice(0, 8).forEach(function (entry) {
      var li = document.createElement('li');
      li.className = historyClass(entry.type);
      var time = document.createElement('span');
      time.className = 'time';
      time.textContent = fmtTime(entry.at);
      var detail = document.createElement('span');
      detail.textContent = entry.detail || entry.type;
      li.appendChild(time);
      li.appendChild(detail);
      els.historyList.appendChild(li);
    });
  }

  function refresh() {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, function (state) {
      if (state) render(state);
    });
  }

  function tick() {
    // Smooth the countdown between background refreshes without re-querying.
    if (currentState && currentState.expiry) {
      var remainMs = currentState.expiry - Date.now();
      els.countdown.textContent = fmtClock(remainMs);
    }
  }

  els.toggle.addEventListener('change', function () {
    chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: els.toggle.checked }, function (res) {
      if (res && res.state) render(res.state);
    });
  });

  els.intervalSelect.addEventListener('change', function () {
    chrome.runtime.sendMessage(
      { type: 'SET_INTERVAL', intervalMinutes: Number(els.intervalSelect.value) },
      function (res) {
        if (res && res.state) render(res.state);
      }
    );
  });

  els.pingNowBtn.addEventListener('click', function () {
    els.pingNowBtn.disabled = true;
    els.pingNowBtn.textContent = 'Pinging...';
    chrome.runtime.sendMessage({ type: 'PING_NOW' }, function () {
      els.pingNowBtn.disabled = false;
      els.pingNowBtn.textContent = 'Ping Now';
      refresh();
    });
  });

  els.openTabBtn.addEventListener('click', function () {
    chrome.tabs.create({ url: ERP_URL });
  });

  refresh();
  tickTimer = setInterval(tick, 1000);
  // Pick up background-driven changes (new ping result, badge state, etc.)
  setInterval(refresh, 5000);
})();
