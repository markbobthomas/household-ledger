# Legacy Amazon desktop extension (superseded)

**Recommended setup:** [Automatic Amazon updates using TinyFish](../../docs/AMAZON_CLOUD_SETUP.md). This no-PC-required flow is now shown in Ledger's Amazon purchases page. Existing extension files are kept for compatibility but should not be installed for a new setup; turn off the legacy extension if switching to TinyFish.

---

# Automatic Amazon → Ledger sync (desktop Chrome / Edge)

**Status:** Implemented as an opt-in desktop extension. Fictional tests cover
scheduling, automatic order extraction, the authenticated Ledger importer,
session failures and pause/resume. **Signed-in live Amazon acceptance remains
unverified**; Amazon may change its order pages.

Once installed and enabled, the extension checks approximately **every six
hours while Chrome or Edge is running**. It matches readable Amazon orders to
existing posted bank purchases, saves product names in Ledger Notes, applies
only supported high-confidence category matches, and leaves uncertain purchases
for Review. **It does not create transactions or edit source bank records.**

## Install once

1. On a **computer** (not iPad/iPhone), download the
   [Ledger repository ZIP](https://github.com/markbobthomas/household-ledger/archive/refs/heads/main.zip)
   and unzip it.
2. In desktop Chrome open `chrome://extensions` (Edge:
   `edge://extensions`). Turn on **Developer mode** and choose
   **Load unpacked**. Select the exact
   `household-ledger-main/browser/amazon-ledger` folder containing
   `manifest.json`, not the outer repository folder. Pin **Ledger Amazon
   Orders Sync** from the browser's Extensions menu.
3. Open your **private Ledger website** and Amazon.com in the **same browser
   profile**, and sign in to both.
4. In Ledger → **Amazon purchases**, expand
   **Set up automatic Amazon sync on desktop** and choose
   **Copy this Ledger address**.
5. Open the pinned extension, paste the address and click **Connect Ledger**.
   Approve access only to that private Ledger site. Click
   **Enable automatic sync**, then approve access to Amazon order pages.

The first check runs when you enable it. Later checks happen through the
browser's scheduled alarms. The extension opens temporary inactive tabs to
read your signed-in Amazon order pages and save through your signed-in Ledger
website. The tabs close afterward.

**No repeated download, upload or Import and save click is required for the
automatic path.** The extension displays the last check, last successful
check and any sign-in errors. Choose **Sync now** for an extra check or
**Turn off automatic sync** to stop future checks.

## What it does—and doesn't—sync

- The order reader covers up to five Amazon order-history pages, currently
  accepting only **clearly priced single-product orders** with recognizable
  dates and totals. It skips uncertain, cancelled, mixed-item and refund
  records rather than guessing.
- The existing private Ledger importer matches by dates and amounts, adds
  product Notes, avoids duplicate expenses and respects saved manual category
  choices. Some uncertain matches may generate a clearly labeled possible
  product Note; they must not be treated as confirmed.
- Automatic importing does **not** automatically call paid AI categorization.
  Ledger's built-in matching/category rules are applied when safe. You can
  separately opt in to AI suggestions from Ledger.
- ZIP/CSV import still handles multi-item purchases and longer order history.
  The browser extension is **not** a replacement for that full export yet.
- If the desktop browser is closed, alarms cannot run. Checks resume when
  Chrome/Edge is running and the scheduled alarm fires. A session expiration,
  Amazon security challenge or site-layout change may block checks.
- Amazon browser sync and bank/Plaid refresh are separate: the matching uses
  whatever bank transactions Ledger already has.

## Security and privacy

The owner authorized credential storage if required, but this implementation
**does not need or store passwords**. It reuses existing signed-in Amazon and
Ledger browser sessions. No password, session token, Amazon cookies or item
titles are written into extension storage. It keeps only the private Ledger
origin, on/off preference, timestamps, error/status text and aggregate
counts. Product data travels only between Amazon pages and the existing
authenticated Ledger import endpoint. No separate data-collection server is
created.

Automatic sync is **off by default**. Site access is requested only when you
connect and enable it; no Amazon permissions are required for the existing
manual Ledger ZIP importer.

## Troubleshooting

| Problem | Action |
| --- | --- |
| Can't install extension | Use Chrome/Edge on a computer. Select the exact folder containing `manifest.json`; enable Developer mode. |
| Ledger connection rejected | Copy only the private site's HTTPS origin (no path, query or password). |
| Amazon permission denied | Click **Enable automatic sync** again and approve Amazon access. |
| Last check says sign in to Amazon | Open Amazon.com Your Orders, sign in or finish any verification, then click **Sync now**. |
| Last check says sign in to Ledger | Open your private Ledger site in the same browser profile and sign in; click **Sync now**. |
| No readable orders | Check a signed-in order page or use the Amazon ZIP/CSV importer for multi-item orders. |
| No matching Ledger purchase | Wait for the bank charge to post or use the fuller ZIP/CSV import; automatic checks retry later. |
| Nothing happens with browser closed | Keep desktop Chrome/Edge running for periodic checks. |
| Want to stop | Open the extension and click **Turn off automatic sync**. |
| Want to review each imported CSV | Use **Manual import (optional)**, open Amazon Your Orders, and click **Open manual import preview**. |

## Technical scope and verification

The extension uses Manifest V3 `chrome.alarms` (six-hour interval),
separately approved Amazon and Ledger origins, temporary same-origin tabs,
an in-origin authenticated upload with Ledger's revision guard and importer,
and no direct writes to bank history. A single-flight guard avoids concurrent
automatic/manual syncs, and temporary tabs are closed on failure. A failed
check is recorded and not reported as success. Server-side manual overrides
and duplicate prevention remain authoritative.

Run `node tests/amazon-browser-sync-smoke.cjs` for synthetic extraction
and extension integration tests. The private banking/forecast and
desktop/iPhone browser regression suites must also pass before release.

This is an unpacked extension, not a Chrome Web Store listing, and it cannot
run on iOS/iPadOS Chrome or Safari. Live Amazon-page compatibility is still
a separate owner-side acceptance step.
