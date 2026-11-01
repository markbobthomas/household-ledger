# Ledger responsiveness contract

**Status:** Adopted following the verified spreadsheet-style filter improvement in [PR #439](https://github.com/markbobthomas/household-ledger/pull/439). This is a maintained engineering invariant, not a performance claim about the private production server. Read alongside [AGENTS.md](AGENTS.md) and [ACCOUNTING_MODEL.md](ACCOUNTING_MODEL.md).

## Core rule: navigate and filter data already in memory

Ledger is a small, interactive financial viewer, not a server-rendered report generator. After initial preparation, switching between prepared pages should move existing DOM, not recalculate balances or reconstruct unrelated screens. When only a visual filter changes, recompute just the visible report from the in-memory model; do not invalidate the whole application. More loading indicators are not a substitute for removing work.

| Change | Required update scope | Must not happen |
| --- | --- | --- |
| Prepared main-page navigation, Spending/Bills/Review subtab | Reuse cached prepared nodes or switch already-built panes | Full bank fetch, forecast recomputation, global cache invalidation |
| Spending/Activity month, account, category filter, sort, search | Refresh current report using cached normalized posted records | Rebuild Home, Bills, Review, Settings; recalculate 1,095-day forecast |
| Budget amount and category display order | Save the preference and refresh affected Budget report | Change canonical cash flow or invalidate unrelated views |
| Actual transaction category, learned merchant rule, category registry changes | Save authoritative user override, then invalidate and regenerate affected derived history/recommendations and forecasts where relevant | Edit read-only provider bank facts or retain stale labels/results |
| Future dated payment, recurrence, linked card rule, bank refresh, account/mode change | Invalidate the appropriate canonical forecast and derived caches; update all dependent screens coherently | Display stale balance projections or double-count card/transfer legs |
| Cold navigation after a real edit | Select destination immediately; show **page-local** loading feedback while rebuilding | Leave previous tab highlighted, block the UI without feedback, or mistake an old prepared generation for current state |

### Current architecture to preserve

- `planner.js`: `preparedViews` / `preparedHistoryViews` and `preparedContext` reuse DOM and the canonical future bundle. `renderHistoryFilters()` is the scoped presentation-only path. `historyDataCache` caches normalized posted rows, category options, and card settlements in the current browser tab; `invalidatePreparedViews()` clears this display cache on a full update. `forecastFor()` owns the single canonical client fallback, with matching server-prepared bundles accepted when available.
- Activity builds a lookup of automatic projected recurrence identities **once per report**, then does set membership for each displayed transaction; do not reintroduce a full 1,095-day scan per visible row.
- `HouseholdPlannerWorkStats()` returns **numeric, in-memory-only counters** (`forecastBuilds`, `historyNormalizations`, `historyPageBuilds`, `filterRefreshes`). They indicate unnecessary work, not elapsed time. Do not persist, transmit, or log real financial data to measure speed.
- Full opening preparation remains behind the startup screen. Afterwards, background preparation yields to idle opportunities. When a real edit invalidates a page, a destination click should acknowledge immediately and show local loading until the page is ready.
- All derived caches are disposable and are **not** financial authorities. They must not be stored in `localStorage`, service-worker/Cache Storage, analytics, or public endpoints. Plaid transactions/balances remain authoritative and read-only; only authenticated private overrides change.

## Required PR regression checks

For UI changes that touch navigation, rendering, filtering, data invalidation, or cache preparation, run the **existing** `tests/planner-prepared-navigation-browser.cjs` inside `tests/ci-suite.cjs browser` in desktop Chromium and iPhone WebKit, plus the mandatory banking/forecast safety workflow. Prefer extending this suite over adding more runtime checks or overlapping CI suites.

A change passes only if the fictional browser tests demonstrate:

1. Startup completes all required prepared pages; cached navigation and Spending/Bills/Review subtabs do not advance the global preparation epoch.
2. Repeated Activity filters (sort, category, account, month, search and clearing search) update the report **without increasing** `forecastBuilds`, `historyNormalizations`, or `HouseholdPreparedViewGeneration()`; unrelated prepared Home/Bills pages remain available.
3. Filtered results and selected controls reflect the requested filter. Returning to another page preserves calendar state, forecast totals, and Review counts.
4. A saved data-changing edit still invalidates stale derived history and returns the updated category/data on a cold destination, with immediate selection feedback and local loader; financial safety tests still prove no duplicate predictions or unauthorized source edits.

Avoid synthetic speed thresholds for full report construction, because CI machine speed varies. Keep the existing immediate-click acknowledgment assertions; for device performance, measure **actual elapsed interaction time** separately and only with fictional or permissioned sanitized data. If a genuine real-device slowdown remains, profile row construction/rendering before introducing virtualization or a new data-loading framework.

## Future change checklist

Before merging: identify whether an edit is *display-only*, *reporting preference*, *bank history classification*, or *forecast-affecting*; document which cache is invalidated and why; keep unnecessary work off the main thread; verify the fictional UI invariants and banking checks; test category edits and calendar month movement; update `PROJECT_LEDGER.md`. Avoid declaring Render deployed from a GitHub merge or a public Pages publish—verify the private `/healthz` commit separately.

**Known limit:** Filter changes still generate HTML for the visible report, and category-classification edits still conservatively refresh wider caches. These are deliberate follow-on profiling candidates, not a reason to abandon the scoped-update architecture.
