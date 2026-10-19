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

## Important separation and limits

- This is a **read-only single checking account pilot** inside the same Ledger. It shows the bank balance on Overview and Settings and all imported transactions on the protected Bank Connection page. Real transactions are not yet used to change the demo budgeting/forecast model; those components stay expressly fictional until reconciliation is reviewed. This prevents financial source data from silently contaminating the existing model.
- Only Plaid Link handles bank authorization; no bank username/password is sent directly to Household Ledger.
- Plaid access tokens and transaction snapshots remain encrypted on Render persistent storage, are not written to browser localStorage, and are never committed to GitHub.
- The live/private Render URL uses a password and is not the public GitHub Pages URL. HTTPS is required before use.
- `/accounts/get` provides the most recent Plaid-reported bank balance available at refresh time. The display never computes a balance from transactions. Plaid's value may lag the bank's own app.
- Clicking Disconnect attempts to remove the Plaid Item and erase stored pilot data. Keep the encryption key secured until then.
- If a bank requires OAuth redirects, the current one-account pilot needs additional configuration before you can connect it. Do not attempt to bypass that.
- Set `LIVE_PLAID_ENABLED` to `0` to return to the fictional Sandbox (the encrypted real account file is kept on disk until you disconnect/erase it while live mode is running). Do not mix the two modes.
- There is no multi-user identity, transaction editing or production-grade administration. Do not share this private pilot with others.
