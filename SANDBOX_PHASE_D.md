# Plaid Sandbox — Phase D

This is a **local-only test harness**. Public GitHub Pages is still demo-only, and no real bank accounts are connected.

## Start with fictional data (no credentials required)

1. Download the Household Ledger GitHub repository and install [Node.js 22 LTS or newer](https://nodejs.org/).
2. On macOS, double-click **start-sandbox.command**, or run this command in the project directory:

    node sandbox/server.cjs

3. Open **http://127.0.0.1:8766**, then **Settings → Plaid Sandbox**.
4. Add **First Platypus Bank** and **First Gingham Credit Union**. Each gets checking, savings and credit-card accounts, including synthetic transactions.
5. Check **Activity** and **Overview**. Use **Refresh** to simulate pending-to-posted replacement, then **Sync**. **Disconnect** the test institutions to restore the original local demo data.

Fixture mode imitates Plaid's response shape but sends **no requests to Plaid**, so it is not genuine Plaid Sandbox verification.

## Use genuine Plaid Sandbox (developer keys required)

1. Obtain a Plaid **client ID** and **Sandbox secret** at [Plaid Dashboard](https://dashboard.plaid.com/).
2. Copy **.sandbox.env.example** to **.sandbox.env** in the repository. Fill in PLAID_CLIENT_ID and PLAID_SANDBOX_SECRET with Sandbox-only credentials. Never upload, paste into ChatGPT, or commit the resulting file.
3. Restart **start-sandbox.command**. The local test UI should show **Plaid Sandbox credentials configured**.
4. Add First Platypus Bank via the Sandbox-only public-token bypass, or use **Open Plaid Link (Sandbox)** to exercise the interactive test flow. Test pending/posted behavior with the **Dynamic** scenario.
5. Add a second test institution. Each Item is synchronized separately with full pagination via the Plaid Transactions Sync API and account metadata via Accounts Get.

**No developer credentials were provided in this conversation. Consequently actual Plaid API calls could not be tested or verified yet.** Both the public website and this repository remain unable to access real checking or credit-card accounts.

## Important safeguards and limits

- The service binds to loopback 127.0.0.1, checks requests, never exposes server code, and never sends a Plaid access token or secret to the browser. Tokens are kept **only in server memory**, not stored durably.
- Sandbox transactions may be cached **in local browser storage** and explicitly marked simulated for this test. When all test institutions are disconnected, the original local dataset is restored. This is not suitable for production bank data or multi-device use.
- A stopped process forgets its Item access tokens; disconnect Items before stopping, or review Items in Plaid Dashboard. Account balances from Plaid Accounts Get may be cached and must not be treated as verified real-time cash.
- The local test service intentionally cannot be reached from GitHub Pages, so the live public site stays demo-only. The connection form appears only on localhost.
- Partial transaction sync pages never commit independently. Mutation-during-pagination errors restart the complete page loop. Duplicate source rows and pending-to-posted replacements are reconciled before commit.
- The separate webhook verification utility validates ES256 signature, Plaid JWK, timestamp and exact body hash. **A public HTTPS webhook receiver and true Plaid webhook deliveries have not been connected**; local-only testing cannot receive internet webhooks directly.
- This implementation is for Sandbox only: it has no production Plaid host, household authentication, encrypted persistent database, production OAuth redirect handling, signed public webhook endpoint, or secure cloud hosting. Those are future prerequisites for live bank connection.

Run Phase D API test with: node tests/sandbox-phaseD-smoke.cjs

Run Phase D browser test (after installing Playwright): node tests/sandbox-phaseD-ui-smoke.cjs

Provider docs: https://plaid.com/docs/sandbox/ and https://plaid.com/docs/transactions/ and https://plaid.com/docs/api/webhooks/webhook-verification/

## Categorization fix for Sandbox transactions

Sandbox imports now use a single shared categorization model (`categorization.js`) instead of always assigning `Other`.

- Genuine Plaid `personal_finance_category.primary`, `detailed`, and `confidence_level` travel through `/transactions/sync`, the local service, and browser normalization. A sufficiently confident Plaid category maps to the Ledger's existing category list.
- When Plaid provides no usable category, recognizable merchants can be categorized conservatively. Mixed-use retailers such as Amazon, Costco, and Walmart are **not automatically classified from their names** because their purchases span multiple categories.
- Uncertain purchases deliberately stay **Other** and display **Needs category**. The Category dropdown remains editable directly, and a manual choice always wins over an automatic suggestion.
- Older Sandbox records stored with `Other` are categorized in the derived Activity/Budget views at load time without rewriting source transaction facts. Updated provider transactions can acquire a better category during a later sync. Pending-to-posted replacements retain explicit category overrides.
- Payroll and checking-to-credit-card payments remain income or transfers for accounting purposes; they are never classified as consumer spending just to avoid an `Other` label.
- The fixture contains high-confidence grocery/refund examples and a medium-confidence Shopping purchase. The UI labels automated categories as **Auto · Plaid category** or **Auto · Merchant match**, so the categorization source is transparent.

After pulling the updated code, **stop and restart** the local Sandbox server; previously downloaded copies of the app do not update automatically. Then reconnect test institutions. No real bank data or production access is used.
