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

## Three-cycle recurrence decisions and Phase 2 unified forecast

A **three-charge monthly pattern** (the same merchant and account in three consecutive historical months, within three calendar days and with essentially identical amounts) is treated as **High** recurrence evidence regardless of the merchant's category. Less regular bills and shopping use stricter heuristics and can still trigger Reviews; confidence labels remain uncalibrated.

In **Budget → expand category → Manage recurring merchant rules**, a user can explicitly mark a historically observed merchant as **not recurring**, restore **automatic detection**, or **establish a monthly recurring charge** with a chosen day and amount. Detected expected items also offer a quick **Not recurring** action. These decisions live in `predictions.patternRules`, keyed by transaction type, category, account and normalized merchant. They do not rewrite bank records. A user can establish a monthly schedule from even a single prior charge. An explicit decision takes precedence over the detector; updating the rule clears obsolete per-payment overrides for that merchant.

**Phase 2:** `forecast-ledger.js` is now the single source for dated future income/expense events (including category prediction overrides and user-added one-time estimates). The app's Budget, the upcoming forecast in Insights, the Reviews uncertainty queue and the 90-day cash-flow simulator use the same candidate schedules. A change to an expected payment in Budget immediately changes the cash-flow chart and projected low balance on the same date. The 90-day simulation no longer has a separate monthly bill detector; its older calculation remains as a compatibility fallback only for isolated engine tests.

The bank balance is still fictional. Nondateable everyday spending is disclosed as an uncertainty range **outside** the scheduled events rather than silently charging a fictitious amount per day. Transfers and credit-card settlements are intentionally not forecast as purchases. The demo-balance projection is isolated from browser records that cannot be established as belonging to the fictional account. If real accounts are introduced, account-aware balance/transfer treatment and source reconciliation must be validated through Plaid before claiming real-world reliability.

**Next recommended phase:** Phase 3 — learn reusable categorization and schedule decisions from Reviews. See `DEVELOPMENT_ROADMAP.md`. Phase 4 (backtesting) and Plaid remain future steps.

## Phase 3: Learning from Reviews (October 2026)

**The read-only bank ledger stays authoritative.** Reviewing a category or a repeated payment creates a separate, reversible learning decision. Rules are stored in browser-local data and do not modify original source fields.

### Category rules
- In **Reviews**, confirm or change a transaction's category and leave **Remember this decision for similar transactions** selected. The Activity category editor also offers an optional **Remember this merchant** choice.
- Rules are scoped to the **account, transaction type and normalized merchant**. If the merchant has consistently one category and the user explicitly saves the rule, subsequent *unclassified or low-confidence expense transactions* can receive that category automatically. Specific high-confidence provider categories are never overwritten.
- Multi-purpose merchants (e.g. Amazon, Costco, Walmart, Home Depot, PayPal) and merchants with conflicting historical categories receive **suggestion-only** rules. Reviewers still decide each ambiguous purchase.
- If new provider data conflicts with an automatic rule, that rule stops silently classifying the merchant and a review can reopen. The user can remove any learned rule in **Reviews → Learned rules**. Individual manual category corrections remain unchanged.
- Every auto-classified record carries its classification provenance and can still be individually corrected.
- Existing data migrates from v2 to v3: `learning.categoryRules` and a small `learning.ruleHistory` are added, without replacing transactions.

### Prediction learning
- **Confirm estimate** in Reviews teaches the model to *trust the historical recurring pattern*, without permanently freezing future amounts or dates. Confirmed subscriptions and bills can update from newer bank history.
- Strong changes in expected amount, posting day or cadence trigger an **uncertainty review** rather than continued silent confirmation.
- Editing an individual predicted payment still changes only that date's forecast; for monthly payments there is an explicit opt-in to apply the changed date and amount to future monthly charges.
- Manual recurring / not-recurring rules from Phase 2 remain in effect, and all learned recurrence rules can be restored to automatic mode from **Reviews → Learned rules**.

### Boundaries and accuracy
Confidence labels remain uncalibrated heuristics. Confirmed history reduces *repeated requests*, but does not prove a particular future charge or amount is correct. Rules stored in browser-local storage do not sync across devices and are not tamper-proof until the secure backend exists. The next phase will measure performance using held-out historical transactions.

See [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) for Phase 4, **automated accuracy backtesting**, then Plaid later when chosen by the user.
