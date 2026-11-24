# Amazon → Ledger browser sync (desktop Chrome / Edge)

This is an **unpacked Manifest V3 extension**, not a Chrome Web Store listing.
It is experimental until verified against live Amazon order pages. It uses the
already-deployed Ledger Amazon CSV importer and **never writes bank transactions**.

## Install and use

1. Download the Ledger repository ZIP from GitHub and unzip it locally.
2. Open Chrome or Edge on a computer → Extensions → enable Developer mode →
   Load unpacked. Select the folder \`browser/amazon-ledger\`.
3. Sign in to your private Ledger website in the **same browser**.
4. Open the extension, paste your private Ledger website address, and click
   **Connect Ledger**. Approve access only to that Ledger website.
5. Sign in to \`amazon.com\`, open **Your Orders** (choose a desired order
   period), open the extension and click **Sync Amazon orders**.
6. Ledger opens its existing **Check matches** preview automatically. Review
   the totals and click **Apply categories** if correct. Nothing is saved
   before that final action.

The extension reads the page you opened and up to four additional order-history
pages, with a short delay. It may skip pages that need extra authentication.
It currently sends only **single-item orders with a clear order total and date**.
Multi-item orders, refunds and unclear prices must be handled with the Amazon
ZIP/CSV importer or a future verified detail-page extractor. It is deliberately
conservative to avoid allocating an incorrect amount to a budget category.
The same CSV matching logic checks exact posted Amazon charges, date windows,
manual category overrides, and duplication rules in Ledger.

## Privacy and limitations

- No Amazon login, cookies, credentials, or bank information are read by the
  extension. Amazon's signed-in session stays in the browser.
- Extraction runs **only when Sync is clicked**. No scheduled scraping,
  browsing-history monitoring, analytics or background order polling.
- The site permission for the specific private Ledger origin is requested
  during **Connect Ledger**; no wildcard host permission is granted by default.
- Item-level descriptions are sent directly to your authenticated private
  Ledger page and then its existing authenticated import API. They are not
  sent to a developer server or AI provider.
- The extension stores only the Ledger origin, **not** purchase records.
- Amazon can change the page structure and break extraction. If it does, the
  previous ZIP/CSV importer remains available. No claim of verified live
  Amazon compatibility is made without an actual signed-in acceptance test.
- Chrome and Edge extensions cannot be installed in iOS/iPadOS Chrome or Safari.

## Developer smoke test

Run \`node tests/amazon-browser-sync-smoke.cjs\` using synthetic page fixtures.
No real Amazon account or bank account is used.
