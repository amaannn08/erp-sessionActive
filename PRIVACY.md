# Privacy Policy — ERP Session Keeper (IIT KGP)

**Last updated: 2026-10-28**

ERP Session Keeper does not collect, store, transmit, or sell any personal
data, browsing history, or ERP content to anyone, including the developer.

## What the extension does

- It sends periodic requests to `https://erp.iitkgp.ac.in/IIT_ERP3/keepAlive.htm`
  using your existing, already-authenticated browser session, to keep that
  session from timing out.
- It reads the ERP page's own `session-expiry` value (from `localStorage`) and
  the result of its own keep-alive pings, to show you a countdown and status
  in the extension popup and toolbar badge.
- It can prevent the ERP page's own script from navigating you to its logout
  page when its internal timer fires, by first confirming with the server
  that the session is actually still valid.

## What data is involved

- **Where it's processed**: entirely within your own browser.
- **Where it's stored**: `chrome.storage.local`, which lives only on your
  device and is never synced or transmitted anywhere by this extension.
- **What's stored**: session status (active/expired), timestamps of recent
  keep-alive pings, and your extension preferences (on/off, ping interval).
  No ERP page content, grades, personal records, or credentials are ever
  read, stored, or transmitted by this extension.
- **Third parties**: none. The only network requests this extension makes are
  to `erp.iitkgp.ac.in`, the same server your browser is already talking to
  when you use the ERP normally.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your on/off and interval preferences, and recent ping history, locally. |
| `alarms` | Run the periodic keep-alive ping on a schedule, even if the extension's background process has been put to sleep by the browser. |
| Host access to `erp.iitkgp.ac.in` | Needed to send the keep-alive request and to run the content script that reads the session countdown and guards against premature logout. No other site is ever accessed. |

## Contact

Questions about this policy or the extension can be raised via the GitHub
repository: https://github.com/amaannn08/erp-sessionActive
