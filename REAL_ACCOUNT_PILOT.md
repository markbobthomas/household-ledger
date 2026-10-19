# Add Plaid to the existing Household Ledger (no new website)

The current Render service `household-ledger-test` is the existing private hosted Ledger. It remains a fictional Sandbox until you explicitly enable live mode. **Do not put any API secret into GitHub, chat, or the GitHub Pages site.**

## Activation in existing Render service

Open Render → **household-ledger-test** → Environment. Add these **secret** variables:

- `LIVE_PLAID_ENABLED` = `1`
- `PLAID_ENV` = `production`
- `PLAID_CLIENT_ID` = the Client ID in your Plaid Dashboard
- `PLAID_SECRET` = the **Production Secret** in your Plaid Dashboard
- `PILOT_PASSWORD` = a new, unique password of at least 20 characters
- `PILOT_ENCRYPTION_KEY` = a new random string of at least 32 characters (save this privately; changing it renders encrypted data unreadable)
- `PILOT_STATE_PATH` = `/var/data/pilot.enc`

The existing 1-GB persistent disk mounted at `/var/data` remains in place and keeps the live data encrypted at rest. The fictional Sandbox file is separate and is not migrated. **You do not need to create a second Render service or change its Start Command.** Save and redeploy the same service.

When deployment succeeds, open the **existing Render URL**. HTTP Basic auth username changes to `pilot`; password becomes `PILOT_PASSWORD`. Open **Settings** or **Overview** and choose **Connect one checking account**. Plaid Link asks you to authorize exactly one eligible checking account.

## One interface, two data sources

The private Render Ledger now uses **exactly the same** Overview, Budget, Activity, Insights, Reviews and Settings components for both Demo and Real modes. The selector is in **Settings → Data source**.

- In Demo, the existing fictional dataset and its adjustments remain in device local storage.
- In Real, `/api/ledger` supplies all imported bank transactions plus Plaid's bank-reported balance. The same categorization, budgeting, prediction and review engines operate on that dataset.
- Plaid source transactions and balances are **read-only**. Overrides, learned categories, custom categories, budgets and predictions are stored separately, encrypted on Render's disk through `POST /api/ledger/adjustments`. Real source facts are not saved in browser local storage.
- **Create Category** in Settings is shared by both modes. Real and demo category choices and budget amounts remain isolated (no accidental importing fictional values).
- The original forecast/chart is present in both modes. In Real, its starting bank balance is sourced directly from Plaid, while future amounts remain predictions, not bank-reported figures. If bank current balance is unavailable, no derived substitute appears.
- The one-account Plaid test still only connects one selected account. Plaid balances can lag the bank app and should be compared with the reported time.

A connection can be disconnected from the **Bank Connection** page. Disconnecting removes the Plaid Item and clears encrypted local pilot records; do not attempt this without understanding that it cannot be undone.

For OAuth-based institutions, a registered Plaid redirect configuration may still be needed. The live private Render site requires HTTPS and strong password protection. Never share production secrets in chat or public GitHub.

## Testing

`tests/demo-real-feature-parity-audit.cjs` compares the original interface in both modes and fails on missing baseline features. The full browser workflow also tests Plaid mock connection, category editing and encrypted-only persistence. `tests/pilot-plaid-flow.cjs` checks source immutability, exact bank balance authority, preferences, pending-to-posted correction preservation, and disconnect.
