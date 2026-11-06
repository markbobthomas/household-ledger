# Ledger data and display consistency audit — November 6, 2026

**Baseline:** `main` at `17f2e31ff732071ce44275eca597f3a28745d868`. **Method:** Read-only GitHub source inspection of live JS/UI modules, adapters, forecast engine, and repository guidance. **Not performed:** private bank-data inspection, browser reproduction, CI execution, or Render deployment check. **No runtime/source-bank changes.** Each finding needs a fictional regression fixture before any production logic change.

## Evidence-backed discrepancies

| Priority | Finding | Evidence | Proposed resolution |
| --- | --- | --- | --- |
| P1 | Recurring rule catalog lists only expense events even though Upcoming and the recurring editor handle income/refunds/transfers. In particular, recurring two-phase paychecks are absent from Recurring. | `planner.js:1141-1183,1688-1727,1830-1855` | Show all saved recurring kinds, distinguish bill/deposit/transfer with filters and separate outflow totals. Include card autopay as a link to its authoritative settings, not a duplicate rule. |
| P1 | Budget percentage counts posted + pending + future expected, while Month insights percentage counts posted + future expected (pending omitted). | `planner.js:1296-1318,2025-2147,2368-2490` | Reuse one shared budget aggregation for both screens, with distinct posted/provisional/expected amounts and period/account scope. |
| P1 | Pending-to-posted Plaid ID replacement migrates manual category overrides but does not remap `predictions.transactionNotes`, whose keys contain the bank transaction ID. A note on a pending item can become orphaned when it posts. | `pilot/server.cjs:285-321`; `planner.js:2502-2542` | During atomic pending-to-posted migration, rekey notes by account and transaction ID without overwriting a note already saved on the posted ID. Audit other user-ID-linked metadata and removal/relink paths. |
| P1 | Different screens label different economic sets as Bills: Month insights monthly bill total includes saved expense charges (including card purchases), excludes card repayments; its next-bills widget uses checking withdrawals + cash-to-card payments; Bills Upcoming includes all predicted transfers, deposits, and card purchases. | `planner.js:532-608,2368-2490,1830-1910` | Separate three titled scopes: Scheduled expenses, Checking outflows (including repayments), and All expected activity. Show composition and avoid comparable-looking totals for different scopes. |
| P2 | Unpaired, outward bank-coded transfers manually recategorized as household expenses count in Budget but not Merchants/Purchase sizes, which use purchase/refund-only amount function. | `planner-history.js:35-49`; `planner.js:1296-1318,2025-2075,2270-2315` | Define one canonical reporting-spend amount by transaction, or clearly label Merchant and Size as purchases-only, with an explained transfer exclusion. |
| P2 | Budget includes provisional pending charges even when they are Uncategorized/low confidence, but the Things-to-check category queue removes *all* pending rows, leaving no review item until posting. | `planner.js:1296-1318,2025-2147`; `ledger-data.js:393-426` | Show explicit pending/unreviewable category status in Budget and route it to the transaction editor; or allow pending categorization with safe ID migration. |
| P2 | Weekday-only Calendar grid deliberately omits Saturday/Sunday bank rows, while Activity and the monthly activity drawer retain their actual dates. Weekend actuals can appear missing in the grid. | `planner-summary.js:357-436,530-645` | Keep the five-day layout, but offer an unambiguous weekend-activity indicator/drill on the adjacent workweek. Do not rewrite actual posting dates. |
| P3 | Calendar transaction notes are separate `small` subtitles, while Activity/future transaction rows display the note inline at the same title level. | `planner-summary.js:205-285`; `planner.js:770-797` | Reuse the shared inline transaction-title-with-note markup in Calendar. |

## Important *intentional* differences to preserve and label

- **Pending vs posted:** Budget deliberately includes pending purchases provisionally. Posted card statement totals exclude pending; neither should duplicate future checking withdrawals.
- **Current vs available:** Per-checking daily forecast starts from available where provided; historical reconstruction begins from current and explicitly is *not* a verified bank historical balance. Household net accounting uses current. The values can differ for valid reasons; present their basis wherever compared (`planner-core.js:836-950`, `planner-summary.js:31-82,673-694`).
- **Transfers/card payments:** Card purchases are expenses on charge date; checking repayments are cash flows, not second spending. A single paired movement must be counted once on each account and zero times as earned income or purchase spending.
- **Business-date shifting:** Forecasted weekend bills are moved to Friday as an estimate. Actual bank dates must stay on their bank-posted day.
- **Time-zone risk, not a reproduced defect:** Browser as-of is device-local (`bank-feed.js:6-14`) but snapshot observation freshness converts timestamps to Pacific (`planner-core.js:836-865`) and server-preparation keys are Pacific (`pilot/prepared-forecast.cjs:17-31`). Verify day-boundary behavior on a device set to another zone; do not change policies without a fixture.

## Minimum fictional consistency acceptance matrix

1. For a fixed as-of month and selected account(s), posted expense + pending expense + future expense subtotals tie between Budget and Month insights, including refunds and unbudgeted categories; Month insights' posted-only metric explicitly says posted-only.
2. A card purchase increases spending/card debt once; the subsequent payment changes checking/card debt once; no transfer appears as an additional expense. The three Bills scopes explain their different totals.
3. Weekly same-merchant schedule, alternating independent four-week payrolls, recurring refund, transfer, card autopay: each is shown where manageable, with stable identities and correct future dated occurrences.
4. A categorized outward Zelle-like payment appears in every report intended to mean household spending, and is excluded from reports explicitly defined as purchases-only.
5. A pending card/checking transaction with a private note and category survives pending→posted ID replacement with exactly one source record, one effective category and the retained note.
6. On Saturday/Sunday actual transaction dates, bank activity remains accessible from Calendar without shifting its source date, and the selected day's forecast arithmetic still conserves balance.
7. Low-confidence provisional pending categories are consistently explained as provisional or actionable, not counted in one page but mysteriously absent from Review.
8. Pacific and non-Pacific client dates around midnight do not silently mislabel stale snapshots or post weekend event dates.

**Status:** Source-supported findings and proposed tests only. No evidence of a currently incorrect live private bank balance; no claims of live reproduction or deployment verification. 

## Implementation checklist — November 6, 2026

- [x] Pending-to-posted notes/categories/review confirmations/recurring example IDs; account isolation, collision precedence and restart replay.
- [x] Shared Budget and Insights posted/provisional/expected aggregation and account/month scope.
- [x] Explicit scheduled-expense, checking-outflow and all-expected-activity definitions.
- [x] Purchases-only Merchant/Size definitions; categorized outward spending retained in Budget.
- [x] Provisional pending category status and review timing explained in Budget details.
- [x] All saved recurring kinds; directional totals; authoritative autopay settings link.
- [x] Weekend bank-date drilldowns in five-day Calendar; shared inline notes.
- [ ] Desktop Chromium/iPhone WebKit CI (including Pacific/non-Pacific midnight) and release verification pending.

Core fictional suite: 55 scripts passed locally. No private bank-record reproduction. Intentional accounting differences above remain unchanged.
