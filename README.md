# Household Ledger

A lightweight, functional household finance website, published from GitHub.

## Launch the website

Go to **Settings → Pages** in this repository. Under **Build and deployment**, choose **GitHub Actions** as the source. The included `.github/workflows/pages.yml` handles deployment.

Your expected site address after the workflow succeeds is:

https://markbobthomas.github.io/household-ledger/

## What is included

- Overview dashboard showing expenses, income, net cash flow, and purchase counts.
- Transaction entry, editing and deletion.
- CSV imports with transfer/payment detection and duplicate checks.
- Merchant totals separating Costco Gas and Costco Warehouse.
- Price-band analysis and monthly category budgets.
- JSON backup and restore.
- Local-only browser data, responsive layout.
- 90-day minimum projected checking-account balance with a simulated read-only bank feed, daily cash-flow chart, and recurring bill/paycheck estimates. No balance entry is required.

This initial GitHub version is a **simplified working reconstruction**, not an exact copy of the original ChatGPT Site. A richer project version is also available as the earlier download in the ChatGPT conversation, with additional item-linking workflows and more sophisticated presentation. To replace this simplified version with the richer project, upload its extracted files to the repository root.

## Important privacy information

No finance data is included in the repository. All imported and manually entered transactions stay in the local browser storage on the device where you use the site. No account sync or bank credential connection is implemented. Keep JSON backups safely; they are unencrypted. A public GitHub Pages site is visible to others even though your private browser data is not published by this app.


## 90-day cash-balance simulator

The Budgets landing page includes **Lowest projected balance (next 90 days)**. The starting *available* balance is supplied by `bank-feed.js`, which currently returns an explicitly fictional Sample Bank checking-account snapshot (`$5,400.25` available). `cashflow.js` calculates 90 future end-of-day balances and returns the lowest day and balance. The projection contains expected recurring income, eligible bill and transfer patterns, and a historical average of day-to-day spending. Expand the daily forecast to see the predicted transactions and estimates.

**This is not a real bank connection.** No actual account balance or Plaid data has been retrieved. The sample balance is never mixed with the user's imported transaction data: when the provider is in demo mode, the cashflow calculator uses a separate fictional dataset only. The rest of the household app can still store imported personal records locally in the user's browser. There is no manual balance field. A real Plaid Balance integration requires an authenticated server-side connection; see [Plaid Integration Plan](PLAID_INTEGRATION_PLAN.md).
