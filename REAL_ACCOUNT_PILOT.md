# Real bank pilot — one checking account

This is a separate application from the fictional Sandbox. **Never put real Plaid credentials in the existing household-ledger-test service or public GitHub Pages.**

## One-time Render setup

1. In Render, select **New → Web Service**, connect GitHub repository `markbobthomas/household-ledger`, name it `household-ledger-pilot`. Set runtime **Node**, branch `main`, Build Command `node --version`, Start Command `node pilot/server.cjs`, and health check `/healthz`. Use a paid Starter instance with a **persistent disk** mounted at `/var/data` (1 GB). Set automatic deployments on.
2. In the new service's **Environment** tab, create:
   - `PILOT_PASSWORD`: a NEW password of at least 20 characters, different from the fictional Sandbox password
   - `PILOT_ENCRYPTION_KEY`: a NEW randomly generated secret of at least 32 characters; **save it securely** (changing it later prevents decrypting existing records)
   - `PLAID_CLIENT_ID`: your Plaid client ID, from the Plaid Dashboard
   - `PLAID_SECRET`: your **production** Plaid secret, from the Plaid Dashboard, if your Plaid account is approved for live use
   - `PLAID_ENV`: `production`
   - `PILOT_STATE_PATH`: `/var/data/pilot.enc`
   Keep each value **Secret** in Render. Never send them through chat, email or GitHub.
3. Wait for the Render deployment to say Live. Open the new pilot URL. Log in with username **pilot** and the new `PILOT_PASSWORD`. Select **Connect one checking account**, sign in through Plaid, and choose **exactly one checking account**. Compare the bank's balance with the pilot screen, noting Plaid's observation time. Do not assume same-second agreement: Plaid may hold a cached bank snapshot.

**Do not connect a real bank** until the pilot's automated tests pass, its URL uses HTTPS, your Plaid account has live-data access, and its new Render disk is mounted. **Never enter bank credentials directly into Household Ledger**. Only enter them into Plaid's own Link screen.

## Constraints

- The server accepts at most one connected Plaid Item and stores only the chosen checking account's details and transactions.
- It uses Plaid Link and server-side public-token exchange. The Plaid access token is encrypted with AES-256-GCM on a Render persistent disk and never sent to the browser.
- Displayed **current** and **available** balance values are Plaid's reported values, timestamped at retrieval. Nothing is adjusted by ledger transactions. No manual transaction editing is provided.
- Plaid may return delayed/partial transactions. Initial sync is not a guarantee of a complete transaction history.
- This is an **isolated proof of concept**, not household multi-user production infrastructure. It uses a single strong HTTP Basic login over Render HTTPS, not a full identity/authentication system. Do not grant other users access.
- **Disconnect and erase pilot** calls Plaid Item removal before deleting local stored pilot data. In the event of a Plaid-side failure, it leaves local state in place and reports an error rather than claiming success.
- For OAuth institutions, Plaid may require a registered redirect URL. That enhancement is not yet implemented. Start with a checking institution that supports the ordinary Link flow. If Plaid flags a redirect requirement, stop rather than inventing a URL.
- Never migrate production tokens or private bank data into the hosted fictional Sandbox or the public demo.
