# Phase 1 — Frozen behavior and performance baseline

**Date:** 2026-10-24  
**Scope:** Test-only additions. No runtime modules, stored financial facts, website layout, UI behavior or private deployment settings were changed.

## What is frozen

The new `tests/architecture-baseline.cjs` compares its synthetic current-output capture to committed `tests/fixtures/architecture-golden.json` using exact structural equality. The checked data includes:

- Reconciled historical bank transaction classification and transfer matching, and a hash of source data to detect accidental mutation.
- Full canonical future-ledger event identities, dates, amounts, accounts, sources and stable per-day balance/event signatures through **1,095 days** across checking, savings and two fictional credit cards.
- Four different modes: approved recurring rules with one-off and one-occurrence edits, a calculated card statement, an entered issued statement, and the preapproval/legacy automatic-recurring mode.
- Two independently confirmed four-week payroll phases; a variable-amount utility, a mortgage and a skipped payment; card autopay as a linked movement; one-off expense and savings transfer; read-only posted and pending activity.
- Calendar's *visible* monthly checking low, three-year checking low, credit-card issued/estimated statement, card 90-day low, and unconfigured card **Not available**.
- Recurrence review inventory, warnings, integrity diagnostics and accounting conservation.

**Limitations:** These are representative *fictional* snapshots, not real-account output evidence, exhaustive migration coverage or a substitute for desktop/mobile UI tests. Existing banking and Chromium/iPhone WebKit regression suites remain necessary. No private account records appear in this repo.

## How to run

```bash
node tests/architecture-baseline.cjs
node tests/architecture-baseline.cjs --profile
```

For diagnostics **only**, `node tests/architecture-baseline.cjs --capture` prints current calculated reference JSON. Do not overwrite the committed golden reference just because a refactor fails: inspect every difference, compare to the unchanged reference commit, and fix the code or secure explicit product acceptance before changing it. `--profile` never mutates a fixture and never asserts elapsed-time thresholds.

The required **Real-account pilot safety checks** PR workflow runs the frozen-output comparison and an exploratory profile before existing financial/banking tests. Existing browser CI separately verifies desktop Chromium and iPhone WebKit interactions. Browser tests and source code remain untouched by Phase 1.

## Example single-run measurements on GitHub Actions (Node 22.23.3)

These are **exploratory measurements**, not controlled benchmarks. Each run includes the standard fictional bank rows plus more unrelated synthetic activity. Figures vary substantially with machine load, JIT warmup and garbage collection.

| Synthetic transactions | Normalize + reconcile | Recurrence scan | Card obligations | Materialize + project + audit | Project only |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 120 | 13.2 ms | 8.6 ms | 7.2 ms | 33.9 ms | 5.2 ms |
| 370 | 8.2 ms | 13.1 ms | 3.6 ms | 32.6 ms | 3.7 ms |
| 920 | 41.0 ms | 39.9 ms | 7.3 ms | 44.3 ms | 3.2 ms |

The materialize operation includes overlapping work with the separately measured scan, card, projection and audit stages; **do not add these columns together** as if they were independent pipeline segments. More controlled warmup/repeated trials and desktop/iPhone measurements are necessary before claiming an optimization improved speed. This initial baseline is intended primarily to make later changes measurable and behavior-safe.

## Safeguards for the next phases

1. Treat the committed reference as read-only in behavior-preserving refactors; compare exact outputs across all supported cases, not just final balances.
2. Do not remove old saved preference fields or automatic migration behavior without additional compatibility fixtures.
3. Keep the banking safety and browser tests in effect; Phase 2 can deduplicate *invocations* only after verifying equivalent required protections.
4. Compare performance at consistent input sizes/runtime and measure warm runs; do not use performance measurements as a substitute for correctness or privacy checks.
5. GitHub merge does not verify the private authenticated Render service's deployed SHA.
