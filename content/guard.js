// ERP Session Keeper — Logout Guard
// Runs in the page's MAIN world at document_start, so it is in place before
// session_timeout.js's own logoutTimer can fire.
//
// session_timeout.js's logout() does `location.href = logoutUrl` whenever its
// *local* timer expires — even if the server session is still alive (e.g. the
// tab was frozen/throttled and missed a reset). This guard intercepts that
// script-driven navigation via the Navigation API, asks content.js (isolated
// world) to check with the server first, and only lets the logout through if
// the server actually says the session is gone. A real click on the page's
// own "Logout" link is untouched — that navigation is userInitiated.
(function () {
  'use strict';

  if (window.__erpKeeperGuardInstalled) return;
  window.__erpKeeperGuardInstalled = true;

  var LOGOUT_PATH = '/IIT_ERP3/logout.htm';
  var SRC_GUARD = 'erp-keeper-guard';
  var SRC_CONTENT = 'erp-keeper-content';
  var STUCK_TIMEOUT_MS = 10000; // don't trap the user if content.js never answers

  var pending = null; // { url, timeoutId }

  function isLogoutUrl(urlStr) {
    try {
      var u = new URL(urlStr, location.href);
      return u.pathname === LOGOUT_PATH;
    } catch (e) {
      return false;
    }
  }

  function releasePending() {
    if (pending && pending.timeoutId) clearTimeout(pending.timeoutId);
    pending = null;
  }

  function askContentScript(url) {
    if (pending) return; // one in-flight logout check at a time
    pending = { url: url };
    window.postMessage({ source: SRC_GUARD, type: 'LOGOUT_INTERCEPTED', url: url }, location.origin);

    pending.timeoutId = setTimeout(function () {
      // content.js didn't respond (e.g. failed to load). Don't block the user
      // from ever logging out — let the original navigation proceed.
      var stuckUrl = pending && pending.url;
      releasePending();
      if (stuckUrl) location.href = stuckUrl;
    }, STUCK_TIMEOUT_MS);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== SRC_CONTENT || !pending) return;

    if (data.type === 'ALLOW_LOGOUT') {
      var url = pending.url;
      releasePending();
      location.href = url;
    } else if (data.type === 'LOGOUT_BLOCKED') {
      // Server session is alive. The page's own cookie poller will reset
      // the modal, countdown and session-expiry within ~2s on its own.
      releasePending();
    }
  });

  if (!('navigation' in window)) {
    // Navigation API unavailable in this browser: nothing safe to intercept.
    return;
  }

  navigation.addEventListener('navigate', function (e) {
    if (!isLogoutUrl(e.destination.url)) return;
    if (e.userInitiated) return; // real click on the Logout link: let it through
    if (!e.cancelable) return; // can't stop it anyway

    e.preventDefault();
    askContentScript(e.destination.url);
  });
})();
