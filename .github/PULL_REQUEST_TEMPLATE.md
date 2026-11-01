## Purpose

Briefly describe what changes for the user and why.

## Impact and cache invalidation

- [ ] I identified whether this changes **display-only filtering**, **reporting preferences**, **bank-history classification**, or **canonical forecasting** (or documented why none applies).
- [ ] Prepared Home, Spending, Activity, Bills and Review pages are reused for navigation/filtering; no unnecessary global invalidation or three-year forecast recalculation. If unavoidable, explain why.
- [ ] Actual bank-data changes and saved prediction/category edits invalidate every dependent cache so stale totals, selections and recommendations do not survive.
- [ ] The selected tab acknowledges clicks immediately and a genuinely cold page shows a page-local loader.
- [ ] No private bank values, account records, credentials or private user details are present in public code, tests, logs or documentation.

## Verification

- [ ] Banking/forecast safety checks passed, or this is documentation-only.
- [ ] Desktop Chromium and iPhone WebKit browser checks passed for UI changes, including the responsiveness checks in `tests/planner-prepared-navigation-browser.cjs`.
- [ ] If filters/navigation changed: verified `HouseholdPlannerWorkStats()` forecast/history normalization counters and `HouseholdPreparedViewGeneration()` do not increase for display-only updates. Validated affected financial totals and results.
- [ ] Updated `PROJECT_LEDGER.md` and, when relevant, [`PERFORMANCE_ARCHITECTURE.md`](../PERFORMANCE_ARCHITECTURE.md).

## Release status

GitHub merged SHA: **not yet merged**

Public GitHub Pages publish: **not yet verified**

Private Render deployed SHA: **unverified unless separately checked with live Deploys and `/healthz`**

See [`AGENTS.md`](../AGENTS.md) and [`PERFORMANCE_ARCHITECTURE.md`](../PERFORMANCE_ARCHITECTURE.md). The checkboxes are a review aid, **not** a replacement for passing CI.
