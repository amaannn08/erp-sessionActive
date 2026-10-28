# ERP Session Keeper (IIT KGP)

A Manifest V3 browser extension that keeps your IIT Kharagpur ERP
(`erp.iitkgp.ac.in`) session alive — including while the laptop is idle and
the screen is off — and prevents the ERP's own client-side timer from logging
you out of a session the server still considers valid.

See [`plan.md`](plan.md) for the full design, the live ERP behavior this was
verified against, and the "Always-On Mode" section (§7) covering idle/sleep.

## How it works

1. **Heartbeat** — every 5 minutes (configurable), the extension pings
   `IIT_ERP3/keepAlive.htm` with your session cookies. This is exactly what
   clicking "Continue" on the ERP's own warning modal does.
2. **Logout guard** — a `MAIN`-world content script intercepts the
   script-driven navigation to `logout.htm` that the ERP's own timer fires
   when it thinks the session has expired. Before letting it through, it asks
   the server directly; if the session is actually still alive, the
   navigation is cancelled and the page resets itself. A real click on the
   page's "Logout" link is never touched.
3. **Stays reachable** — the ERP tab is marked non-discardable so Chrome/Brave's
   memory saver won't freeze it away from the heartbeat; if no tab answers
   anyway, the background service worker pings the server directly.
4. **Resilience** — failed pings retry on a short backoff, and the popup/badge
   show `OK`/`NET`/`EXP` so you always know the real state.

## Install (unpacked)

1. Open `brave://extensions` (or `chrome://extensions`).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this directory.
4. Open or reload your ERP tab (`erp.iitkgp.ac.in/IIT_ERP3/showmenu.htm`) so
   the content scripts attach.
5. Click the extension icon to see live status, change the ping interval, or
   ping immediately.

## Files

```
manifest.json              Manifest V3 config
background/service-worker.js   Alarms, heartbeat orchestration, badge, state
content/guard.js            MAIN world — intercepts script-driven logout
content/content.js          ISOLATED world — pings, expiry reporting, modal watch
popup/                      Status UI
icons/                       Extension icons (generated from icons/icon.svg)
```

## Known limits

- If the laptop **suspends** (lid close, manual suspend) for longer than the
  session can tolerate, nothing running in the browser can prevent that — see
  plan.md §7.5. On this machine, idle with the screen off does **not**
  suspend; only lid-close/explicit suspend does.
- Whether `keepAlive.htm` also keeps sub-app sessions alive (Academic,
  Training & Placement) is unverified — see plan.md §7.6.
