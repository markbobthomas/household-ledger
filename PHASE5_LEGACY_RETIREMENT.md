# Phase 5 — Legacy laboratory retirement and compatibility audit

**Date:** 2026-10-24  
**Baseline:** GitHub `main` after PR #146.  
**Scope:** Only historical test laboratories, obsolete browser assets, and the loader for one current integration test. No HTML, CSS, financial engine, Plaid adapter, bank state, persistence format, credit-card formula, or API behavior change.

## Determination

The live entrypoint `index.html` loads the canonical `planner-core.js`, `planner-transactions.js`, `planner-history.js`, `planner-coverage.js`, `planner-summary.js`, `payment-obligations.js` and source/accounting modules. **It does not load any legacy accuracy/readiness/stress laboratory.**

Before removal, the seven research scripts below were imported by **only four retired historical tests** whose browser assertions still targeted the old Overview / Insights / Accuracy interface. None of those four tests was referenced in `tests/ci-suite.cjs` (45 required core tests and two desktop Chromium / mobile WebKit browser scripts), nor in the manual historical `historic` group. The historical tests are preserved in Git history, not as functioning tests of today's UI.

### Retired as one isolated obsolete subsystem

| Class | Paths | Reason |
| --- | --- | --- |
| Legacy analytic scripts (7) | `accuracy-fixture.js`, `accuracy-fixture-holdout.js`, `accuracy-fixture-seasonal.js`, `accuracy-lab.js`, `stress-lab.js`, `readiness-lab.js`, `feed-health.js` | Generated fictional scoring/stress/feed-readiness outputs for an obsolete separate Insights/Accuracy interface; never loaded by the current website |
| Old browser/research regressions (4) | `tests/accuracy-phase4-smoke.cjs`, `tests/phase41-smoke.cjs`, `tests/phase42-smoke.cjs`, `tests/phase43-smoke.cjs` | Depend on the removed laboratories and obsolete `data-page`/Accuracy visual elements; none is in current mandatory/historic CI suites |
| Obsolete research baselines (2) | `tests/accuracy-regression-baseline.json`, `tests/phase42-stress-baseline.json` | Referenced by retired lab tests only |

That is **13 retired files**, approximately **75 KB** of historical implementation/tests/fixtures. These are deletions from the *current tree*, not destruction of Git history. A rollback can restore precisely these paths from the commit preceding this PR.

Both static server allowlists (`pilot/server.cjs`, `sandbox/server.cjs`) no longer advertise the deleted seven scripts. The private banking test `tests/pilot-security-smoke.cjs` asserts that current planner assets still return HTTP 200 and each retired lab script returns 404. This limits stale web exposure without changing any active HTML requests or banking route.

The actively required `tests/planner-recurrence-integration-smoke.cjs` no longer preloads **six unrelated retired forecast implementations** to test the canonical planner. This is safe because `index.html` itself never loaded them; the test still loads all the canonical modules it actually needs and preserves its forecast/interaction assertions.

## Explicitly retained — no unsupported mass deletion

The following are **not loaded by the modern website**, but are still referenced by existing financial, migration, regression, or archive tests and remain available as isolated, test-only implementations:

- `forecast.js`, `forecast-ledger.js`, `account-forecast.js`: older forecasting engines still used by independent historical tests, several of which remain in the current mandatory suite (`planner-routine-smoke`, `planner-backtest-smoke`, `mortgage-prediction-smoke`).
- `planner-intelligence.js`, `planner-recurrence.js`, `planner-backtest.js`: still exercised by financial regression tests.
- `cashflow.js`, `recurring.js`, `reviews.js`: historical tests and some review/reconciliation checks depend on their behavior.
- `payment-obligations.js`, `planner-core.js`, `planner-transactions.js`, `planner-history.js`, `planner-coverage.js`, `planner-summary.js`, banking/accounting modules, encrypted forecast sidecar, compatibility endpoints and legacy saved preference migration fields: retain **without modification**.

Do **not** delete a module merely because it is not listed in `index.html`. It may support a required regression or a saved-data migration. An additional deletion requires a separate consumer audit and exact preservation of the 1,095-day golden forecast.

## Required validation

- `node tests/ci-suite.cjs core`: 45 mandatory distinct scripts; includes the frozen financial outputs, read-only bank facts, linked card bills, category learning, recurring payroll phases and Demo/Real parity.
- `node tests/ci-suite.cjs browser` (with Playwright): both current Chromium and iPhone WebKit interaction scripts, verifying no website change.
- `tests/pilot-security-smoke.cjs` must validate present-day protected assets and retired lab 404 responses, with no private data fixture.
- GitHub merge must be verified separately from authenticated private Render `/healthz` running SHA.

The removals are about maintainability and obsolete tests, **not** a claim of faster live forecast calculations. There are no changed forecast algorithms or client UI components in this phase.
