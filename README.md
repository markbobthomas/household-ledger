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

This initial GitHub version is a **simplified working reconstruction**, not an exact copy of the original ChatGPT Site. A richer project version is also available as the earlier download in the ChatGPT conversation, with additional item-linking workflows and more sophisticated presentation. To replace this simplified version with the richer project, upload its extracted files to the repository root.

## Important privacy information

No finance data is included in the repository. All imported and manually entered transactions stay in the local browser storage on the device where you use the site. No account sync or bank credential connection is implemented. Keep JSON backups safely; they are unencrypted. A public GitHub Pages site is visible to others even though your private browser data is not published by this app.

