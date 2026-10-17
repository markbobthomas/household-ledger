# Household Ledger

A privacy-conscious household-finance web app with a **source-of-truth ledger** and **editable forecasts**, currently published at:

https://markbobthomas.github.io/household-ledger/

## Data integrity design (v2)

**The ledger is read-only in the interface.** You cannot manually create, edit or delete posted transaction amounts, merchant names, dates, transaction types, account identifiers or recorded bank balances.

The stored data now has four distinct parts:

| Field | Purpose | May the user edit it? |
| --- | --- | --- |
| `transactions[]` | Original immutable source records: date, merchant, amount, type, account, stable ID and `source` provenance | **No** |
| `categoryOverrides` | Category corrections keyed by the source record's stable transaction ID | **Yes, category only** |
| `predictions` | Monthly budget targets, dated expected-transaction overrides and manual forecast items, plus 90-day balance assumptions | **Yes** |
| `sync` | Source synchronization metadata, including the future Plaid cursor | **No, provider-managed** |

The UI uses `HouseholdLedgerData.records(state)` to merge base source transactions with category overrides **for display and analysis only**. Category edits never rewrite `transactions[]`.

The source records carry `source.provider` and `source.providerTransactionId`. Demo data is marked `demo`; older browser entries are marked `legacy-unverified` and must **not** be mistaken for bank-verified records. The v1 localStorage data is migrated in place without losing the original transaction rows or budget targets. Only a properly authenticated future backend may designate imported records as Plaid source data.

### Predictions are not transactions

- Monthly budget targets remain editable, while expected category spending is now the **sum of dated, merchant-specific predicted transactions**. Expand a category to inspect the expected date, merchant, amount, evidence and confidence for each item, and edit/omit/reset it inline.
- Inference looks at up to six recent calendar months, requires history in the latest completed month, and normally requires two or three observed months with stable merchant, account, frequency, dates and amounts. Bank-paid transactions are suppressed to avoid counting them twice. Future one-time expected expenses can be added to a category as **predictions only**.
- **No generic undisclosed catch-all transaction** is inserted into monthly category estimates; irregular spending without a defensible expected date is omitted and may make projections optimistic. Amounts/dates are estimates, not commitments.
- The 90-day bank-balance projection supports changes to predicted recurring bill/paycheck amounts and schedule, predicted daily spending and one-time forecast-only events.
- These changes affect projected values, never recorded bank activity or the starting balance.
- Recurring detection and merchant/category analytics use the effective categories while preserving the original records.

`ledger-data.js` defines the data schema, migration, categorization and prediction methods and a provider-only `applyPlaidSync()` normalization/reconciliation contract. `cashflow.js` applies forecast overrides without incorporating them into actuals.

### Current data limitations

There is **no live Plaid connection**, login, bank synchronization or secure bank backend yet. The simulated starting bank balance and transactions used in the 90-day demo forecast remain fictional and segregated from local records. Bank statement/manual transaction creation/import and arbitrary backup restoration have been removed from the interface. The browser still has old imported records from earlier versions, but they are labeled **unverified**.

A static GitHub Pages app is **not tamper-proof**: local storage can be changed outside the app. Production integrity requires authoritative transaction storage and auditability on a secure authenticated backend, plus Plaid webhooks and transaction reconciliation. See [Plaid integration plan](PLAID_INTEGRATION_PLAN.md).

## Privacy and backup

This public GitHub repository does not include personal financial data. Transactions and category/prediction preferences currently remain in each device's browser storage; there is no cross-device synchronization. Settings provides a **read-only JSON export** for safekeeping, not a tool for restoring or fabricating ledger transactions. Exports are unencrypted—store privately.

## Developer tests

The GitHub Actions workflow `.github/workflows/ui-smoke.yml` executes Playwright tests for budget/merchant drill-downs, read-only categorization, the cash-flow engine, recurring detection and mobile/desktop layout. `tests/ledger-readonly-smoke.cjs` additionally verifies historical data migration, Plaid upsert/pending reconciliation, category overrides and separation of forecast changes from original source records.

### Historic aggregate adjustment compatibility

Earlier category-level `categoryForecasts` overrides are preserved in local storage for backward compatibility but **are not included** in the new dated category totals. This avoids silently creating an invented lump-sum transaction on an arbitrary date. Individual expected payments can be edited in each category instead.
