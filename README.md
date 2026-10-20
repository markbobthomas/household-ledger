# Household Ledger — Balance Planner

A focused, account-by-account cash planning tool. The new default interface replaces the earlier budget, merchant, itemization, Insights and Reviews screens with three essentials:

- Bank-reported checking, savings and credit-card balances.
- A clearly labeled **provisional** 30/60/90-day balance trajectory derived from dated forecasts.
- A readable list of future expected money in and money out, with visible bank freshness and uncertainty.

**The existing full Ledger has not been erased.** Before the reset, an identical copy of the original default branch (commit `53975e8672ab56fb5b29bf14ff94dc1746987928`) was saved to [`backup/full-ledger-before-balance-planner-2026-10-19`](https://github.com/markbobthomas/household-ledger/tree/backup/full-ledger-before-balance-planner-2026-10-19).

## Safety and infrastructure

GitHub ownership, the GitHub Pages demo pipeline, the existing Render services, the private password-protected Plaid connection routes, and the encrypted server-side bank source store are retained.

This reset changes the **frontend**, not the authenticated bank connector or existing encrypted transaction records. There is no banking migration or credential re-entry required by this commit. The new interface does not write real bank data to browser localStorage. Existing historical and planning adjustments remain in the existing server-backed state and can still influence draft predictions. No mortgage, income or credit-card prediction should be considered a guaranteed future payment.

The separate `render.yaml` blueprint currently describes the **fictional hosted Sandbox**; it is not a replacement for an independently configured private Real/Plaid service. In the public Pages and fictional Sandbox modes, balances are sample data. Only a correctly configured private service can show live bank data.

## Files

- `index.html`, `planner.css`, `planner.js`: the new, intentionally small interface.
- `pilot/server.cjs`, `pilot/data-source.js`, `pilot/index.html`: existing authenticated Plaid server and bank connection flow.
- `account-forecast.js`, `forecast-ledger.js`, `forecast.js`, `payment-obligations.js`, `ledger-data.js`, `accounting.js`: retained read-only calculation and classification machinery.
- `tests/planner-browser.cjs`, `tests/planner-parity.cjs`: new planner-focused browser and source-parity checks.

Older analysis and budgeting source files/tests remain in Git history and in the backup branch. They are **not loaded** by the new page. New design decisions—how to identify obligations, statement handling, income estimates, low-balance thresholds, account funding and alert rules—are intentionally deferred until the owner answers six planning questions.

## Test

The GitHub Actions workflows check the new demo and private-Real planner layouts, mobile browser usability, bank-feed security, statement and mortgage accounting invariants, source parity, and existing reconciliation invariants. No actual Plaid credentials are used in automated browser tests.

This application **does not initiate or schedule bank payments**. It predicts balances and shows uncertainties.
