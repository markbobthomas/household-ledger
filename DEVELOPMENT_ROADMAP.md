# Household Ledger · Development Roadmap

This is the durable, project-owned plan for continuing the finance predictor work without requiring the user to repeat the phases. **Do not implement later phases automatically without user approval.** At the end of each phase, identify the next recommended step.

## Phase 1 — Pattern detection and realistic simulations

**Status: COMPLETE (October 17, 2026).** The 25-month simulation, historical detection, source-integrity checks and cross-browser regression suite passed. This verifies test behavior, not real-bank forecast accuracy.

- Detect weekly, every-two-week, monthly, twice-monthly, quarterly, six-monthly, and annual repeating payments, with tolerance for posting-date slippage.
- Detect repeating income/paychecks separately from expense predictions; future UI use in Phase 2.
- Consider variable utility amounts with seasonal history; handle missing or canceled patterns cautiously.
- Distinguish irregular spending from individually scheduled payments. Show an honest unscheduled risk range; do **not** create fictional expected charges or add risk bands to dated totals.
- Use up to 24 months of historical records, respecting the as-of date (no lookahead) and skipping pending/transfer rows.
- Keep confidence/evidence visible and protect source transaction immutability.
- Maintain a deterministic fictional 25-month household fixture in `tests/fixtures/household-25months.cjs`. It contains no real personal data and is separate from the user's demo ledger. Test annual/quarterly fees, seasonal bills, biweekly income, variable shopping, missing history and no future leakage.

**Completion check:** All existing browser/integrity tests plus `tests/prediction-phase1-smoke.cjs` pass in GitHub Actions. The engine remains heuristic and **not validated on bank data**.

## Phase 2 — One unified forecasting engine (COMPLETE · October 17, 2026)

**Status: Complete and tested.** `forecast-ledger.js` supplies the date/account/category-tagged events for Budget, Insights, Reviews and the app's 90-day cash forecast. Repeating payments detected from three matching calendar-month charges receive stronger evidence; manual monthly/not-recurring decisions survive reload and can be reversed. The existing independent `cashflow.js` heuristic remains only as a compatibility path for isolated historical engine tests. Future changes to a monthly prediction flow through its shared event into the projected balance, without editing posted facts.

**Validation:** GitHub Actions browser smoke suite (12 PASS lines) including the new `tests/unified-forecast-smoke.cjs`, iPhone WebKit and immutable source records. Balance remains fictional until a real bank connection exists. Irregular-spending range is disclosed separately, not silently added to the dated balance curve.



Currently `forecast.js` powers category/month predictions, and `cashflow.js` separately computes a 90-day demo-balance forecast from recurring schedules and variable daily spend. This can produce contradictory predictions.

- Build one account-aware, dated forecast event stream for both incoming and outgoing expected transactions.
- Share it across **Budget, Insights, Reviews and 90-day cash flow**. Changes to a bill in Budget instantly update balance projections.
- Preserve already-posted ledger transactions and immutable bank balance snapshots, prevent double counting transfers and credit-card payments across accounts.
- Handle expenses without exact predicted dates as a clearly labeled uncertainty/range, never as a fabricated bank charge.
- Add end-to-end regression tests asserting a corrected payment updates every view consistently and that source records are unchanged.
- No Plaid connection required.

## Phase 3 — Learning from Reviews (COMPLETE · October 17, 2026)

**Status: Complete and browser-tested.** Reviews now learns reversible merchant/category rules scoped to transaction type and account. A saved decision automatically classifies matching expenses only when they are unclassified or low-confidence and the merchant has consistent categorization. Conflicting bank categories and multi-purpose merchants trigger suggestions rather than silently overriding source values. Activity also offers an opt-in to remember corrections. Users can inspect and undo these rules in Reviews, and Activity shows the provenance of learned classifications.

**Recurring learning:** Confirming an expected payment can store a trusted pattern without freezing future amounts/dates; materially changed patterns reopen Reviews. Month-specific forecast edits remain month-specific unless the user explicitly asks to apply the corrected monthly schedule going forward. Manual recurring/not-recurring decisions are reversible.

**Validation:** The GitHub Actions suite passed 13 browser checks, including `tests/learning-phase3-smoke.cjs` (safe auto-classification, ambiguous suggestions, conflict recovery, new source changes, reversibility and mobile interaction). This proves the implemented rules behave as specified, **not** that prediction accuracy is validated on real bank records. Existing source transactions were not edited.



- Confirmations and corrections become reusable, reversible merchant/account/category and schedule rules rather than being scoped to a single prediction or transaction.
- Show which rule applied, its confidence, evidence, history and ability to undo.
- Auto-apply high-evidence corrections cautiously, treat ambiguous merchants (Costco, Amazon, Walmart) at transaction or merchant-pattern level rather than blanket rules.
- Keep Reviews an exception queue, revisit decisions when evidence changes, avoid asking the same thing repeatedly.
- Test persistence, rule conflicts and changing provider records without modifying source transactions.
- No Plaid connection required.

## Phase 4 — Automated accuracy laboratory (COMPLETE · October 17, 2026)

- Run walk-forward backtests on 12–24 months of **fictional** fixture data first: at each historical as-of date, allow only older transactions to inform the forecast, hide future actuals.
- Score recurring detection precision/recall, missed/false predicted events, date and amount error, forecast coverage and 30/60/90-day cash-flow error (where valid opening balance evidence exists).
- Report results per cadence/category, highlight unreliable segments, track regression of metrics over time and tune thresholds with honest holdout periods.
- Later support user-provided historical statements in an isolated evaluation tool; never mix them into the read-only bank ledger.


**Status: Implemented, tested, and deployed.** A new **Insights → Accuracy** view runs a deterministic, entirely fictional 25-month household through twelve month-start walk-forward 90-day evaluations (August 2025–July 2026). Each forecast sees only transactions available as of its own historical date; hidden recurring-truth labels and future records are stripped before reaching the prediction engine. Actual future records are used only for evaluation.

The lab computes one-to-one event matching by merchant, account, type and date tolerance (2–5 days). It reports precision, recall, missed/false recurring payment opportunities, average matched date/amount error, share of all expense dollars covered by matched scheduled payments, separate category/cadence/confidence breakdowns, and 30/60/90-day cash-balance mean absolute errors. Cash balances are mathematically anchored in **fictional** starting cash, not bank snapshots. The current predictor does not schedule some checking transfers or non-dateable shopping, a material limitation of its balance curve.

**Baseline on the invented dataset (not household accuracy):**
- 377 expected recurring-payment/deposit opportunities, 336 matched; precision **89.12%**, recall **58.95%** of 570 actual recurring opportunities.
- Matched posting date MAE **0.09 days**, matched amount MAE **$0.87**, but only **29.8%** of all expense dollars are covered by correctly matched scheduled outflows.
- Fictional balance MAE: **$1,483.19 at 30 days**, **$7,752.66 at 60 days**, **$7,781.64 at 90 days**. These values are too high for a dependable safe-to-spend prediction.
- Annual and variable recurring charges have weaker coverage; false predictions and missing income patterns also affect cash-flow error.
- The 12 overlapping holdout windows intentionally count the same true transaction in multiple independently prepared forecast opportunities. These metrics are not real-world performance guarantees.

**Automation and safeguards:** `accuracy-lab.js` runs the evaluation independently of localStorage, Plaid and the user ledger. `accuracy-fixture.js` is the only source of fictional ground truth and is shared by browser UI/tests. `tests/accuracy-phase4-smoke.cjs` guards against future-truth leakage, duplicated matching, score instability and mutation; `tests/accuracy-regression-baseline.json` defines modest regression alert floors on these invented results. All **14 browser checks passed**, including iPhone Safari.

### Phase 4.1 — Improve measured prediction accuracy (COMPLETE · October 17, 2026)

Before adding Plaid, improve the model using the Accuracy report:
1. Extend **monthly, semimonthly and annual recurring forecasts through the entire 90-day horizon**; the current model is strong on certain near-term dates but often misses later months.
2. Reconcile **income timing, account transfers, and credit-card cash movements** without double counting expenses; don't mistake transfer outflows for ordinary spending.
3. Represent irregular retail spending as an **honest probabilistic/range forecast** in the cash-balance uncertainty view, without inventing exact dated bank transactions.
4. Rerun identical **held-out fictional accuracy tests**, avoid overfitting one fixture, and add distinctly different holdout households before treating improvements as generalizable.
5. Optionally evaluate user-supplied historical statements in a **strictly isolated, read-only sandbox** after explicit approval; not as manual inserts into the source ledger.

**Plaid remains deferred until the user explicitly asks for it.** Phase 4.1 is an accuracy-improvement pass, not an automatic bank-connection task.


**Status: Implemented and verified on two fictional households.** The predictor now anchors monthly and twice-monthly schedules to the latest fully observed calendar months so it repeats charges and paychecks throughout the full 90-day horizon instead of stopping after the first month. Weekly/14-day paychecks use cadence anchored to the as-of date. Quarterly and semiannual predictions retain historical evidence limits; annual renewals remain difficult to validate with the currently available 25-month fixture and 90-day windows.

**Cash movements:** Only explicitly directed checking-transfer outflows can become future cash events; these are separate from spending categories and never treated as new purchases. Internal Savings transfer credits do not count toward Checking balances. Unknown-direction transfers are not guessed. The 90-day simulator, Budget and Insights continue using the same dated forecast events.

**Irregular spending:** An independently derived, account-scoped statistical range uses the median and 20th/80th percentiles of unscheduled spending over the last 3–6 complete months. It remains entirely separate from dated forecast events, cannot be edited as a bank transaction, and is explicitly presented as an *illustrative balance scenario*, not a guaranteed safe-to-spend amount. The historical Accuracy tab reports both scheduled-only and statistically adjusted cash errors.

**Test results, synthetic only** (12 overlapping 90-day historical windows per household; not real-world accuracy):

| Metric | Phase 4 primary fixture | Phase 4.1 primary fixture | Phase 4.1 independent fictional holdout |
| --- | ---: | ---: | ---: |
| Recurring event precision | 89.12% | 100.00% | 99.36% |
| Recurring event recall | 58.95% | 98.95% | 93.23% |
| Recurring events matched | 336 | 564 | 468 |
| Share of all expense dollars covered by matched scheduled charges | 29.80% | 84.71% | 75.84% |
| 90-day scheduled-only checking balance MAE | $7,781.64 | $2,190.69 | $1,379.17 |
| 90-day balance MAE with undated spending scenario | Not available | $403.30 | $915.11 |

**Caveat:** The primary and holdout fixtures were developed to test the algorithm, so neither represents a blind externally sourced holdout. The near-perfect recurring precision on synthetic data should not be generalized to live bank histories. Confidence labels are still heuristic. No Plaid connection or real spending data is involved.

**Regression controls:** The original Phase 4 baseline is retained in \`tests/accuracy-regression-baseline.json\` along with Phase 4.1 results and stricter checks for both fictional households. \`tests/phase41-smoke.cjs\` tests recurring horizon, transfer isolation, uncertainty ranges, source immutability, hidden future data and desktop/iPhone user flows. 15 automated browser tests passed.

### Recommended next — Phase 4.2: reliability stress-testing (NEXT)

Before Plaid, expand fictional robustness checks to missing/intermittent bank history, shifted paydays, provider-delayed posting, annual and semiannual renewals, income interruption, new merchants, refunds, and multi-account reconciliation. Improve confidence calibration using genuinely varied datasets rather than only repeated clean schedules. Optionally provide a **separate read-only statement evaluation sandbox** with explicit user approval, never inserting statement data into bank source records. Reassess whether balance ranges are good enough for decisions. Then return to Plaid only if the user chooses.

## Phase 5 — Plaid, only after user chooses

- Build a secure authenticated household backend before Plaid Link and transaction sync. Never expose tokens on GitHub Pages or use browser-local data as source-of-truth.
- Use Plaid's account/transaction data and sync reconciliation; clearly distinguish verified records and fictional demo data.
- Validate model performance on real household data after consent, starting in observation mode rather than assuming predictions are accurate.

**Product principle:** Automation should steadily reduce manual reviews without fabricating certainty. Test suites verify correctness of software behavior; real-world reliability needs measured out-of-sample accuracy.
