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
- Inference scans up to six recent calendar months, requires history in the latest completed month, and generally needs two or three observed months with stable merchant, account, posting dates and amounts. Weekly and every-two-week charges are identified from regular intervals even when the count varies across months. Bank-paid transactions are suppressed to avoid counting them twice. Future one-time expected expenses can be added to a category as **predictions only**.
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

## Reviews: action-oriented uncertainty queue

The new **Reviews** tab automatically creates review tasks from source transaction history and dated spending predictions. The queue is recalculated from the current facts when a page loads or an item changes; it is not a static list.

- **Category reviews:** Expenses marked `Other` or lacking a category; provider-labeled category confidence under 70%; merchants with inconsistent category assignments; ambiguous home-improvement demo records. Tasks consider source rows from the preceding 90 days, excluding unrelated income/transfers.
- **Prediction reviews:** Dated merchant predictions labeled `Medium` or `Pattern` rather than `High`. Shows date, projected amount and supporting historical months. Evidence without a sufficiently defensible dated prediction is not fabricated.
- **Decisions:** Confirm a category, change its category, confirm a prediction, edit its expected amount/date, or exclude a prediction. Confirmation creates a review-decision record; changing a category creates a category override; changing a forecast creates an expected-transaction override. None rewrite source bank transactions.
- **Persistence:** Review confirmations are stored under `reviews.categoryConfirmed` and `reviews.predictionConfirmed`. If a source transaction changes, its category confirmation is reconsidered; if an automatically inferred predicted date, amount or evidence changes, its confirmation is reconsidered. Explicit user prediction edits are already resolved.
- **Simulated data:** The fictional sample ledger includes **Home Depot** purchases, where Housing versus Shopping is ambiguous, plus repeating merchant purchases with lower prediction confidence. These are flagged as *Demo* tasks, even when the demo ledger was created in an earlier version. No fake bank record is inserted merely to show Reviews.

Filter **All / Categories / Predictions** to work through the tasks. The dedicated mobile layout has the fifth **Reviews** tab in both top and bottom navigation.

## Phase 1: Longer-history pattern detection (October 2026)

Phase 1 improves the local inference engine in `forecast.js`; it does **not** activate Plaid or change any source transaction values.

- Scans up to 24 calendar months of dated, nonpending records. It supports stable weekly, every-two-week, twice-monthly, monthly, quarterly, semiannual and annual patterns, including an independent `forecastIncome()` API for paychecks (not yet connected to the 90-day bank simulator).
- Bills and subscriptions can tolerate several days of posting drift and modest amount variation. Variable utilities can use a same-season prior-year reference when there is sufficient history. Annual patterns require two years; quarterly/six-month cycles require repeated evidence.
- It only presents future estimated charges after the calculation's as-of date and attempts to match already-paid transactions to avoid double-counting.
- The calendar schedule is **conservative** for shopping: irregular merchant visits are not given fictional exact transaction dates. An `unscheduled` risk estimate exposes a historical range of nondated spending; it is **informational** and excluded from the hot-pink dated-payments total.
- Forecast evidence and cadence appear beneath each expandable expected transaction. Confidence labels are heuristics, **not calibrated percentages**. Source data may be incomplete or stale.
- A deterministic, completely fictitious 25-month dataset is in `tests/fixtures/household-25months.cjs` (541 simulated records). `tests/prediction-phase1-smoke.cjs` verifies the engine detects real patterns, avoids seasonal/quarterly false positives, ignores unseen future transactions, and does not create a dated expense for inconsistent grocery purchases.

**The demo app still uses its existing three-month fictional ledger; the 25-month fixture exists only for automated tests and is never inserted into user browser storage.** This avoids overwriting household financial data and preserves the current sample's transaction IDs.

**Next:** Phase 2 — make Budget, Reviews, Insights and the 90-day cash-flow chart share the same dated forecast events and override decisions. See [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) for the complete saved phases.
