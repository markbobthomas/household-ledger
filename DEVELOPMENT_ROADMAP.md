# Household Ledger · Development Roadmap

This is the durable, project-owned plan for continuing the finance predictor work without requiring the user to repeat the phases. **Do not implement later phases automatically without user approval.** At the end of each phase, identify the next recommended step.

## Phase 1 — Pattern detection and realistic simulations

**Status: Implemented; confidence and browser checks must pass before marked complete.**

- Detect weekly, every-two-week, monthly, twice-monthly, quarterly, six-monthly, and annual repeating payments, with tolerance for posting-date slippage.
- Detect repeating income/paychecks separately from expense predictions; future UI use in Phase 2.
- Consider variable utility amounts with seasonal history; handle missing or canceled patterns cautiously.
- Distinguish irregular spending from individually scheduled payments. Show an honest unscheduled risk range; do **not** create fictional expected charges or add risk bands to dated totals.
- Use up to 24 months of historical records, respecting the as-of date (no lookahead) and skipping pending/transfer rows.
- Keep confidence/evidence visible and protect source transaction immutability.
- Maintain a deterministic fictional 25-month household fixture in `tests/fixtures/household-25months.cjs`. It contains no real personal data and is separate from the user's demo ledger. Test annual/quarterly fees, seasonal bills, biweekly income, variable shopping, missing history and no future leakage.

**Completion check:** All existing browser/integrity tests plus `tests/prediction-phase1-smoke.cjs` pass in GitHub Actions. The engine remains heuristic and **not validated on bank data**.

## Phase 2 — One unified forecasting engine (NEXT)

Currently `forecast.js` powers category/month predictions, and `cashflow.js` separately computes a 90-day demo-balance forecast from recurring schedules and variable daily spend. This can produce contradictory predictions.

- Build one account-aware, dated forecast event stream for both incoming and outgoing expected transactions.
- Share it across **Budget, Insights, Reviews and 90-day cash flow**. Changes to a bill in Budget instantly update balance projections.
- Preserve already-posted ledger transactions and immutable bank balance snapshots, prevent double counting transfers and credit-card payments across accounts.
- Handle expenses without exact predicted dates as a clearly labeled uncertainty/range, never as a fabricated bank charge.
- Add end-to-end regression tests asserting a corrected payment updates every view consistently and that source records are unchanged.
- No Plaid connection required.

## Phase 3 — Learning from Reviews

- Confirmations and corrections become reusable, reversible merchant/account/category and schedule rules rather than being scoped to a single prediction or transaction.
- Show which rule applied, its confidence, evidence, history and ability to undo.
- Auto-apply high-evidence corrections cautiously, treat ambiguous merchants (Costco, Amazon, Walmart) at transaction or merchant-pattern level rather than blanket rules.
- Keep Reviews an exception queue, revisit decisions when evidence changes, avoid asking the same thing repeatedly.
- Test persistence, rule conflicts and changing provider records without modifying source transactions.
- No Plaid connection required.

## Phase 4 — Automated accuracy laboratory

- Run walk-forward backtests on 12–24 months of **fictional** fixture data first: at each historical as-of date, allow only older transactions to inform the forecast, hide future actuals.
- Score recurring detection precision/recall, missed/false predicted events, date and amount error, forecast coverage and 30/60/90-day cash-flow error (where valid opening balance evidence exists).
- Report results per cadence/category, highlight unreliable segments, track regression of metrics over time and tune thresholds with honest holdout periods.
- Later support user-provided historical statements in an isolated evaluation tool; never mix them into the read-only bank ledger.

## Phase 5 — Plaid, only after user chooses

- Build a secure authenticated household backend before Plaid Link and transaction sync. Never expose tokens on GitHub Pages or use browser-local data as source-of-truth.
- Use Plaid's account/transaction data and sync reconciliation; clearly distinguish verified records and fictional demo data.
- Validate model performance on real household data after consent, starting in observation mode rather than assuming predictions are accurate.

**Product principle:** Automation should steadily reduce manual reviews without fabricating certainty. Test suites verify correctness of software behavior; real-world reliability needs measured out-of-sample accuracy.
