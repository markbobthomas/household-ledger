# Phase 2 — Single-inventory CI regression plan

**2026-10-24.** This is a workflow-only/test-runner refactor. No production JavaScript, HTML, CSS, private financial data, bank integration, forecasting calculation, or saved state changes.

## What changed

- **One canonical inventory:** `tests/ci-suite.cjs` defines disjoint baseline, banking, forecasting, parity and reconciliation groups. `node tests/ci-suite.cjs core` runs all **45 unique non-browser tests exactly once**, including the Phase 1 frozen three-year forecast contract and every assertion formerly used in the four regular GitHub Actions workflows.
- **Required PR gate:** `Real-account pilot safety checks` still runs on all non-documentation pull requests and remains one job named `pilot`. It validates syntax, canonical forecasts, Plaid safety, encrypted forecast saves, reconciliation, card obligations, independent recurring income and parity *before merge*. The un-warmed profiler is no longer executed on every change; run it manually with `node tests/architecture-baseline.cjs --profile`.
- **Browser interactions:** `Browser interaction test` remains one PR job named `smoke-test`. For UI-relevant changes it runs the same **two browser scripts** in desktop Chromium and iPhone WebKit, with Playwright installed only for those changes. It always reports a completed workflow/check on documentation-only or server-only PRs, but performs no browser installation there. Unknown diff state errs towards **running**, not skipping. Manual dispatch always runs browsers.
- **No redundant main push check:** The two existing historical/parity and reconciliation push-to-main workflows are changed to **manual-only** focused diagnostics; their assertions now run before merge in `core`. The browser job no longer repeats its PR suite on the post-merge `main` push. The separate `Publish Household Ledger` deployment workflow and production infrastructure are unchanged.
- **Legacy rebuild workflow:** Reuses `core`, two browser scripts, and an extra historical recurrence test in its branch/manual jobs. Its narrow automatic trigger still refers only to `rebuild/unified-future-ledger`.

## What did not change

No test implementation or test assertion was deleted. Existing tests remain on disk and runnable individually. No web page was altered. No live bank credentials or data were accessed. The Phase 1 golden `tests/fixtures/architecture-golden.json` was not regenerated. The previously parallel workflows were redundant in their *script invocation*, not necessarily in internal assertions.

## Execution map

| Trigger | Financial core | Chromium + iPhone WebKit | Other |
| --- | --- | --- | --- |
| Non-UI app pull request | 45 unique scripts | Skipped when no website-facing files changed | One completed browser check, no Playwright install |
| UI/interaction pull request | 45 unique scripts | 2 browser scripts | Each script runs once on PR |
| Documentation-only PR | Skipped (existing `paths-ignore`) | Skipped after lightweight change detection | Does not install browsers |
| Manual `Browser interaction test` | — | 2 browser scripts | Useful for unconditional UI verification |
| Manual parity/reconciliation workflow | Focused 1/6 script subsets | — | Already included in standard PR core |
| Main push | No duplicated parity/UI work | No duplicated Playwright run | Existing Pages publish remains unchanged |

The test runner has additional group commands: `node tests/ci-suite.cjs browser` (requires Playwright/browsers), `node tests/ci-suite.cjs parity`, `node tests/ci-suite.cjs reconciliation`, and `node tests/ci-suite.cjs historic`. For an inventory, `node tests/ci-suite.cjs core --list`.

## Safety / future work

Changing `tests/ci-suite.cjs` or `.github/workflows/ui-smoke.yml` itself forces browser checks to run. UI-sensitive files include the loaded browser script modules, HTML, stylesheets and interactive browser tests. The previous workflow's job names `pilot` and `smoke-test` were preserved to avoid unexpected changes to any branch protection that refers to those jobs. Because docs-only changes skip the existing pilot-safety workflow, strict branch-protection configurations with required *workflow-level* checks should be verified in repository settings.

**Acceptance:** Both required PR workflows green, actual job logs showing 45 distinct nonbrowser tests (including frozen outputs, parity and reconciler) and both browser scripts green, diff shows only CI/workflow/docs files, merged source SHA confirmed separately from private Render deployment.

**Next:** Phase 3 can work on internal dataflow using the unchanged golden fixture. For performance comparisons use warmed, repeated runs on fixed synthetic workloads; test optimization claims instead of assuming them.
