# Amazon browser sync — desktop setup

**Status:** Experimental. The extension is implemented and checked with
fictional Amazon pages, but it has **not been verified against a live,
signed-in Amazon order page**. It runs only when you click Sync.

The existing Amazon ZIP/CSV importer works without the extension and is the
more complete option for historical and multi-item orders.

## What you need

A desktop computer with **Google Chrome or Microsoft Edge**, your private
Ledger website, and an Amazon.com account. You will sign in to both sites
in the browser; you do **not** enter passwords into the extension.

**iPhone and iPad browsers cannot install this extension.**

## Install once

1. [Download the Ledger repository ZIP](https://github.com/markbobthomas/household-ledger/archive/refs/heads/main.zip)
   and unzip it somewhere you will keep. Inside it, find
   `household-ledger-main/browser/amazon-ledger`. This exact folder contains
   `manifest.json`.
2. Open desktop Chrome. Enter `chrome://extensions` in the address bar.
   In Edge, enter `edge://extensions`. Turn on **Developer mode**.
3. Click **Load unpacked** and select the exact
   `household-ledger-main/browser/amazon-ledger` folder. **Do not** select
   the outer `household-ledger-main` folder.
4. Open your private Ledger website in that browser and sign in. Navigate
   to **Amazon purchases**, expand **Set up Amazon browser sync on desktop**,
   and click **Copy this Ledger address**.
5. In the browser's Extensions (puzzle-piece) menu, pin **Ledger Amazon
   Orders Sync**. Open it, paste your private Ledger address, select
   **Connect Ledger**, and approve access to that specific Ledger website.
   The extension remembers only the Ledger website address.

## Sync when you choose to

1. Sign in at Amazon.com in the same Chrome/Edge profile. Open **Returns &
   Orders → Your Orders** and select the order period to read.
2. Click the Ledger Amazon Orders Sync extension icon and select
   **Sync Amazon orders**.
3. The extension reads the current page and up to four following order
   pages. It opens the authenticated Ledger **Amazon purchases** page with
   a CSV attached. **Review the products** and click **Import and save**
   to apply the matching and categorization. The import never creates new
   bank transactions.
4. Check the resulting transaction Notes and category review suggestions.
   Repeat only when you want to import another set of orders.

### Important coverage limits

The extension currently captures only orders with **a single identified
product**, a readable purchase date and a clearly labeled total. It skips
multi-item orders, uncertain prices, returns and refunds; it can stop if
Amazon asks for another sign-in. It does **not** guarantee that every Amazon
charge will have an item match.

Use the Amazon ZIP/CSV import for mixed orders and fuller coverage.
Changes to Amazon's website may require updating the scraper. A real
signed-in desktop test is still needed before live compatibility can be
confirmed.

## Troubleshooting

| Problem | Action |
|---|---|
| Chrome cannot load the extension | Select the folder **containing manifest.json**, not the outer repository folder. |
| Ledger address rejected | Use only the HTTPS base URL of your private Ledger site. No password, path, query or link fragment. |
| Permission denied | Click **Connect Ledger** again and approve that specific Ledger site. |
| Amazon page not recognized | Open Amazon.com **Your Orders**, then click Sync. |
| Ledger login requested during sync | Sign in to your private Ledger in the same browser profile, then retry. |
| No safe orders found | Try a period containing simple single-item orders. Otherwise use ZIP/CSV. |
| Some purchases missing | The extension intentionally skips ambiguous/multi-item orders and reads no more than five pages. |
| CSV opened in Ledger | This is the review step. Select **Import and save** after checking the products. |

## Privacy and safeguards

- The extension stores only the private Ledger site address, not Amazon
  purchase history, passwords, cookies, bank records or account details.
- It uses the existing signed-in website sessions. It does not monitor
  browsing activity or sync in the background.
- Extracted product descriptions go directly into the authenticated Ledger
  import page. No developer backend or AI model receives them from the
  extension. AI classification remains a separate optional choice in Ledger.
- It requests access to your private Ledger site when you connect. It is an
  **unpacked extension**, not a Chrome Web Store listing.
- Ledger's importer protects manual categories and saved Notes, matches
  against existing bank charges, and does not create duplicate expenses.

## Developer verification

Run `node tests/amazon-browser-sync-smoke.cjs` with fictional fixtures.
Extension source is in `manifest.json`, `popup.html`, `popup.js`,
`background.js` and `scraper.js`. Live signed-in Amazon acceptance has
not yet occurred.
