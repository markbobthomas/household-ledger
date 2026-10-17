# Future bank connection: Plaid integration plan

**Status:** Planned only. There is currently **no connection to banks, PayPal, Plaid, or remote storage**. The hosted site is static and saves all imported data in browser local storage.

## Desired household flow

1. In Settings, the household owner chooses **Connect a bank**, then selects their institution using Plaid Link.
2. A protected backend obtains a short-lived Link token. Plaid Link asks the user to authorize accounts; the site **never collects online-banking passwords**.
3. A backend exchanges the short-lived public token for an access token and saves it **encrypted server-side** under the authenticated household account. Never put Plaid secrets or persistent bank access tokens in JavaScript, GitHub repositories, GitHub Pages, local storage, or screenshots.
4. The backend fetches initial transaction history through **/transactions/sync** and maintains it via cursor-based, paginated incremental updates/webhooks. Preserve Plaid transaction IDs and account IDs, reconcile modifications/removals/pending-to-posted changes, and avoid duplicate transactions when the same card payment appears as a bank debit and a card credit.
5. The backend optionally uses **/transactions/recurring/get** for recurring streams once product access is enabled, or applies a transparent local detection model to synchronized history.
6. A secure per-household API returns normalized transactions and candidate recurring charges to this UI. Merge manual entries and imported purchases without overwriting user corrections.
7. Predicted bill dates/amounts appear in the budget forecast as an *estimate*, visually separate from actual spending, with a way to reject or confirm recurring merchants.

## Initial projection implementation (today)

`forecast.js` is a **client-side heuristic**, not a Plaid connection.
- For current-month spending: totals recorded expenses up through the imported transaction dates; never counts income and transfers.
- For future spending: uses the average of the remaining days in up to three earlier recorded months. Where a merchant and its billing day/amount appear repeatedly in the records, eligible bill-like categories have a conservative recurring estimate. Recognized bills are excluded from the variable historical remainder so they are not counted twice.
- When historical coverage is limited, uses a basic elapsed-month pace estimate.
- In the Budgets view, teal is actual and amber is projected additional expense. Projected totals may exceed the budget even if the bar itself stops at 100%. Clicking a category shows actual transactions and the estimate's breakdown.
- Historical months display actuals only. Estimates are not guaranteed, especially with partial history, unusual spending, new bills, refunds, or shifted pay dates.
- This version provides no automatic bank data import, no scheduled recurring-bill sync, no guarantee of future charges, and no authenticated multi-device synchronization.

## Server-side security and privacy to build before turning on bank connections

Use a small protected API (for example, a serverless backend) with:
- authenticated household users and session controls;
- encrypted storage for Plaid access tokens and sensitive financial data;
- least-privilege permissions, rate limiting, audited access, careful logging, and secrets in the platform's secure secret store;
- webhook validation, incremental sync robustness, token refresh/relink handling, and disconnect/delete-data functionality;
- an explicit consent experience that shows what will be imported and who can see it;
- separation between sandbox/demo and production financial records.

**Do not connect real bank accounts to a purely static GitHub Pages deployment.** This site cannot safely hold the Plaid secret or persistent access tokens.

## Plaid documentation (confirm pricing, product eligibility and access before implementation)

- [Link](https://plaid.com/docs/link/)
- [Transactions Sync](https://plaid.com/docs/transactions/)
- [Recurring Transactions](https://plaid.com/docs/api/products/transactions/#transactionsrecurringget)

### Future implementation milestone

Build/test the backend against **Plaid Sandbox** first. Then add secure household login/storage and launch the actual bank connection flow. After bank transactions are normalized and reconciled, use Plaid's recurring streams (if enabled) as a stronger signal for estimated upcoming bills. Do not label projections as confirmed without evidence.

## 90-day lowest bank-balance forecast (implemented as a demo)

The Budgets home page now has a **90-day cash-flow forecast**. It is driven by the read-only provider adapter in `bank-feed.js` and the calculation engine in `cashflow.js`. The adapter returns an account snapshot with a current/available balance and account ID. There is **no manual starting-balance entry**.

For now, `bank-feed.js` returns a completely fictional checking account (available balance $5,400.25). The demo forecast always loads its own synthetic transaction series from `demo-data.js`, even when the user has imported real transactions into browser storage. This intentional isolation prevents the false impression that private browser transactions were reconciled to the sample balance.

- The 90-day forecast starts from the sample available balance **as of today** and projects each next day's end-of-day balance.
- It estimates periodic income, eligible monthly expenses, regular savings transfers/credit-card payments, and average irregular daily spending using three historical months.
- It reports the lowest future end-of-day balance and its date, projects net income/outflows, and displays a daily chart with itemized forecast entries.
- The forecast has explicit uncertainty: institution posting timing, unrecognized one-off obligations, available-versus-current differences, overdraft rules, and credit-card reconciliation can significantly change the result.
- No bank account has been connected and no personal transactions are used in sample forecasts.

### Future Plaid upgrade to this feature

The secure backend should call [`/accounts/balance/get`](https://plaid.com/docs/balance/) for current and available bank balances (Balance works in combination with other products such as Transactions), rather than treating recent transaction sums as a bank balance. Use [`/transactions/sync`](https://plaid.com/docs/transactions/) for reconciled account-specific transactions. Normalize account IDs and run the forecasting engine against authenticated **matching-account transactions**, not transactions from unrelated cards or other checking/savings accounts. Plaid balance `available` can be absent for some institutions; clearly state whether the forecast anchors to available or current balance. Use the recurring transaction product, if enabled, to improve the cash-flow prediction. Track last-updated timestamps and warn when balance data is stale.

Do not deploy bank credentials or long-lived Plaid access tokens in the GitHub Pages front end. Add a secure backend and user consent/authentication before activating any live account connections.
