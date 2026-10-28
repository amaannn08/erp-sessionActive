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

## Install

This isn't published on the Chrome Web Store (no developer fee paid), so it's
installed the same way any unpacked/developer extension is — this works
identically in Chrome and Brave.

**1. Download the code**

- Go to https://github.com/amaannn08/erp-sessionActive
- Click the green **`<> Code`** button → **Download ZIP**
- Unzip it somewhere you won't delete (e.g. `Documents/erp-sessionActive`) —
  Chrome loads the extension from this folder every time it starts, so don't
  move or delete it afterwards.

(Or, if you use git: `git clone https://github.com/amaannn08/erp-sessionActive.git`)

**2. Load it into the browser**

1. Open `chrome://extensions` (or `brave://extensions` in Brave).
2. Turn on **Developer mode** — toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the unzipped `erp-sessionActive` folder (the one containing
   `manifest.json` directly inside it, not a subfolder).
5. The extension should now appear with the shield-and-clock icon.

**3. Activate it**

1. Open or reload your ERP tab (`erp.iitkgp.ac.in/IIT_ERP3/showmenu.htm`) so
   the content scripts attach — a tab that was already open before you loaded
   the extension needs a refresh.
2. Click the extension icon in the toolbar to see live status, change the
   ping interval, or ping immediately. Pin it (puzzle-piece icon → pin) so
   it's always visible.

**Note for anyone you share this with:** because it's unpacked rather than
from the Web Store, Chrome will occasionally show a one-time "Disable
developer mode extensions" nag banner on startup — this is normal for any
unpacked extension and can be dismissed; it does not disable the extension.

## Files

```
manifest.json              Manifest V3 config
background/service-worker.js   Alarms, heartbeat orchestration, badge, state
content/guard.js            MAIN world — intercepts script-driven logout
content/content.js          ISOLATED world — pings, expiry reporting, modal watch
popup/                      Status UI
icons/                       Extension icons (generated from icons/icon.svg)
```

## Privacy

This extension collects nothing and talks to no server other than
`erp.iitkgp.ac.in`. Full policy: [PRIVACY.md](PRIVACY.md) (also mirrored at
https://gist.github.com/amaannn08/08ba57918d198cda764fae30e3db8183).

## Known limits

- If the laptop **suspends** (lid close, manual suspend) for longer than the
  session can tolerate, nothing running in the browser can prevent that — see
  plan.md §7.5. On this machine, idle with the screen off does **not**
  suspend; only lid-close/explicit suspend does.
- Whether `keepAlive.htm` also keeps sub-app sessions alive (Academic,
  Training & Placement) is unverified — see plan.md §7.6.
