# Household Ledger — internal architecture simplification audit

**Date:** October 24, 2026  
**Baseline:** GitHub `main` after PR #137 (`884759b06447f443ea9cdf14d63f166943736e9d`).  
**Scope:** Architecture and data-flow assessment only. **No runtime code, saved records, UI, forecasting behavior, infrastructure, or banking state changed.** Source inspection, not measured runtime benchmarking. Private Render deployment not verified.

## Executive conclusion

The active app has the right accounting direction: one canonical future ledger, immutable connected-bank facts, separate editable predictions, guarded card statements/payments, and a 3-year projection. The major simplification opportunity is *repeated work and multiple generations of code/tests*, not a need to replace Plaid, Render, or the prediction model.

**Do not rewrite the app or switch stacks.** Consolidate the live data path, optimize indexes and recomputation, retire truly inactive modules only after proving all consumers and saved-state compatibility, and rationalize CI without deleting safety coverage. Commit each change in small, reversible PRs, validated against a frozen, fictional input/output baseline. The behavior contract includes the current full three-year horizon, current card Calendar statement/90-day low, review trail, all legacy-migration decisions, and exact edit/save semantics.

## Actual data path (current live app)

1. **Plaid intake:** `pilot/server.cjs:75-144` pages `/transactions/sync`, fetches account balances, stages all item updates, preserves pending-to-posted category overrides, then atomically encrypts/persists source bank state. The server exposes `GET /api/ledger` at lines 181-186. Authentication, encryption, origin/action guards, and immutable bank source facts must remain.
2. **Real browser adapter:** `pilot/data-source.js:36-90` converts signed Plaid rows into display/planner records, assigns conservative preliminary classification, and invokes `HouseholdLedgerData.migrate`. This boundary also merges persisted forecast/category preferences. It is not itself the calculation engine.
3. **Read-only reconciliation:** `ledger-data.js:110-111` calls `HouseholdAccounting.reconcile(state)` and then per-record category resolution. `accounting.js:107-193` conservatively pairs bank transfers and identifies refunds, payroll and card payments. Source records are not edited.
4. **Canonical future ledger:** `planner.js:112-120` invokes `HouseholdFutureLedger.materialize`; `planner-core.js:234-407` assembles confirmed repeating schedules, any guarded legacy history estimates, one-offs, posted-transaction suppression, card payment/statement obligations, individual edits, transfers, balance projection and integrity checks.
5. **Account projection and screens:** `planner-core.js:410-548` computes projected balances for the active 1,095-day horizon. `planner.js:1790-1883` recomputes the bundle on render, then builds the selected tab. The card Calendar summary uses canonical statement data and the first 90 days of card-debt points (`planner-summary.js:495-530`); checking shows its unchanged metrics.

**Important distinction:** The private Node/Render server is primarily a secured Plaid sync and persistence boundary. Most recurring detection, reconciliation, materialization and balance calculations execute in browser JavaScript, not in the Render process.

## Findings, evidence, and changes worth making

### P0 — Avoid expensive repeated calculations; benchmark before altering logic

- `planner.js:1790-1809` rebuilds the full forecast during `render()`; `forecastFor` also appears in numerous interaction handlers (for example around lines 837, 882, 1901, 1933, 1945, 2043, 2228, 2266, 2427, 2455 and 2718). Some interactions thus can redo the same full calculation despite no underlying bank or plan changes.
- `planner.js:31` sets a 1,095-day horizon. `planner-core.js:386-389` projects and audits the full horizon. **Keep that visible horizon and all warnings exactly unchanged.**
- Start with synthetic performance counters around reconcile, detect, posted match, payment obligations, projection, integrity check and render, at representative sizes (e.g. 100/1,000/10,000 fictional transactions; several cards, two-phase payroll, varied schedules). Measure actual times and counts in desktop Chromium and iPhone WebKit; none are measured in this audit.
- After baseline, compute the normalized records and forecast bundle once per *explicit* bank/state revision and as-of date. Reuse that immutable result across tabs and interaction handlers. Invalidate on bank refresh, source snapshot change, approved schedule or individual edit, review/migration decision, card configuration, category/identity changes that affect classification, account removal, or day rollover. Do not key caches only on mutable object identity; do not persist derived forecasts as authoritative records.

### P0 — Replace full cross-products with indexed matching, without changing ambiguity behavior

- `accounting.js:121-135` compares every eligible pair of historical bank rows before checking amount, date and direction: quadratic potential, and it is reached by `model.records()` on re-renders. Partition by account direction, cents and bounded date before applying the *same* conservative priority/ambiguity rules.
- `planner-transactions.js:720-758` iterates over eligible posted rows and *all* generated schedule occurrences. With a 3-year horizon and growing history, this creates avoidable candidate work. Index occurrences by account, kind/direction, date window, and only then apply the existing merchant/linked-ID/phase ranking. **Preserve explicit bank links, distinct four-week payroll phases, monthly tolerance, genuine ambiguous choices and one posted-to-one scheduled suppression.**
- `ledger-data.js:73-108` calls `categoryRuleSafety`, which rescans the full transaction array for an applicable learned rule. Precompute merchant/account/type aggregates *once* for the reconciliation pass; preserve mixed-use merchant safeguards and confidence rules.
- These are static complexity findings, not an observed slowdown or proven bug; tests must compare exact fixture output and warnings, not just totals.

### P1 — One coherent data transformation boundary

- `pilot/data-source.js:36-90` classifies raw bank activity, `accounting.js:107-193` reconciles transfer/refund semantics, and `ledger-data.js:80-111` resolves categories with possible second categorization. Not all passes are redundant: they intentionally separate trusted original data from derived interpretations. Reduce repeated passes/objects and resolve category and transfer facts in one *derived normalization pipeline* with clear input/output contracts, never by changing provider source amounts or types.
- `planner-core.js:308-322` applies the same `adjust` helper to `entries`, then to the adjusted list concatenated with generated bill events. Confirm whether repeated edits are identical for all migrated states before restructuring to a single explicit per-event finalization pass. Preserve card-bill suppression priority and modifications to event IDs/account/date.
- Keep clear separation of raw Plaid rows, normalized actuals, approved schedules, ephemeral review suggestions, forecast-only event overrides, card statement obligations, canonical dated future ledger, and projected balances. No parallel, editable copy of posted bank facts.

### P1 — Consolidate recurrence identity/matching *primitives* before choosing a single detector

- Live calculations use `planner-core.js:73-220` for detecting legacy automatic estimates and review, `planner-history.js:122-277` for history recommendations, `planner.js:1471-1565` for persistent/ignored review trail, and `planner-transactions.js` for confirmed schedules and posted matching. These overlap in account resolution, merchant cleanup, interval detection and history matching, but are **not interchangeable policies**.
- Unloaded-on-the-current-index older engines (`forecast.js`, `recurring.js`, `planner-recurrence.js`, `planner-intelligence.js`, `account-forecast.js`, `forecast-ledger.js`, `cashflow.js`) have related logic; some remain useful to isolated tests/backups. `index.html:46-57` establishes the active browser module list; do not equate not loaded by that page with safe-to-delete repository-wide.
- First share a small set of *tested* primitives: canonical account ID resolution, normalized merchant identity/aliases, calendar recurrence dates, posted-cycle identity, cents and date operations. Then retain one canonical saved-schedule generator and one suggestion policy; make explicit why a historical stream is or is not proposed. Do not cause ignored recommendations to disappear or merge independent same-merchant payroll phases.
- Retain `recurringForecastMode` legacy transitional behavior and older saved fields until migration/restore fixtures prove compatibility. Do not make historical auto-suggestions affect future balances once `approved-only` is active.

### P1 — Rationalize the regression suite and workflows

- Repository tree has **86 `tests/*.cjs` files**, about **710 KB** of test source. Five configured non-deployment workflows collectively list **96** `node tests/...` invocations representing **47 distinct test scripts**; **29** scripts are listed in two or more workflows. These are counts of configured invocations, *not* executions within any one PR.
- Active `ui-smoke.yml` lists **35** tests including the large desktop/iPhone WebKit `planner-browser.cjs` (about 125 KB). `pilot-safety.yml` lists **16**. The `parity-audit.yml` push-to-main job lists **16**, mostly overlapping. The previous rebuild branch workflow lists **23**, overlapping heavily and not triggered by normal main PRs. Reconciliation adds **6** more after merges.
- **39 test-path files** are not named in any of these workflow command lists; this includes fixtures/stubs and historical feature/phase tests. Being unlisted does not prove that a test is unused or safe to delete.
- Docs-only PRs currently trigger the full UI browser workflow, although the pilot-safety workflow ignores Markdown changes. Separate lightweight docs/static lint, mandatory model+banking safety, and UI-specific Chromium/WebKit suites. Put tests behind one maintained command/manifest rather than repeated hard-coded lists; run expensive long historical suites on affected-module changes, scheduled full sweeps or explicit manual requests. Preserve a required protection gate for all logic affecting money.
- Avoid unconditionally reinstalling browsers on checks not needing browser tests. Reduce redundancy across workflows without deleting assertions covering read-only Plaid data, card payments, one-off vs recurring collisions, posted suppression, transfer conservation and desktop/iPhone parity.

### P2 — Isolate persistence and legacy compatibility without weakening data safety

- `pilot/server.cjs:9-12,40-67` intentionally keeps forecast edits in a small separate encrypted `.forecasts` file; that avoids rewriting the encrypted bank-history store for every edit. **Keep this independence.** The original main state contains a legacy prediction copy for migration; the sidecar takes precedence at load.
- `pilot/server.cjs:230-264` has a newer forecast-only write route and an older all-adjustments route for compatibility. Audit real callers and saved-state migrations before retiring older endpoints. Do not collapse forecast updates into the bank-sync state write.
- Verify serialized writes and atomic recovery under concurrent forecast/category changes, bank sync, crash/restart, account deletion and failed disk writes. Source/account linkage, secrets, disk paths and Plaid cursors are high-risk; never reconfigure them as part of a code-style cleanup.
- The large `PROJECT_LEDGER.md` historical log and phase documents increase navigation burden. Keep the current-state summary concise and leave a stable history archive if updating handoff conventions in a separate docs-only PR.

## Recommended target architecture — preserve contracts, do not rewrite infrastructure

```text
Plaid → protected sync/storage (source immutable)
      → one derived actuals/reconciliation snapshot (per bank revision)
      → canonical confirmed schedules + persisted review decisions
      → single future dated ledger (with card obligations + user exceptions)
      → one projection (with integrity/conservation audit)
      → read-only page selectors and existing UI
```

An account's actual balance never comes from a prediction; card purchases and the corresponding checking/card settlement remain separate economic events. The review service creates recommendations only (except for grandfathered legacy estimates before the guarded migration); saved schedules and explicit one-offs provide future movements. Preserve the current existing account/transfer/frequency/date/amount rules verbatim until behavior equivalence is demonstrated.

## Safe implementation order (separate small PRs)

1. **Freeze behavior and measure (zero behavior change).** Add deterministic fictional *golden outputs* for all active screens and ledger event sets, including exact 3-year monthly lows, 90-day card lows, statement labels, monthly major-bill coverage, independent alternating income, variables, ignore/review persistence, legacy modes and existing saved overrides. Capture stable response shape, warnings, conflicts, amount/date/cashflow, not screenshots alone. Add per-stage benchmark timers to test runs only. Establish a reproducible baseline at current `main`.
2. **Simplify CI configuration first.** Centralize test groups, remove repeated invocations, keep mandatory bank and forecast tests and Chromium/WebKit for UI changes. Docs-only PRs must not run full browser suite. Confirm the effective required checks still protect merges.
3. **Optimize cost without replacing algorithms.** Index conservative bank transfer and posted-cycle matching; cache normalized rows and materialized projection by explicit revision; ensure clear invalidation. Use golden-output parity and performance comparisons before and after.
4. **Consolidate source-to-forecast contracts.** Explicitly name one normalizer and one forecast materializer, share tested date/account/merchant primitives, consolidate edit application. Do not modify persistence data shape or statement semantics in the same PR.
5. **Prune unused legacy code cautiously.** Inspect all scripts referenced by HTML, server asset allowlist, tests, CI, backup branches, migration/restore paths and manually supported tooling. Retire truly unreachable engines/endpoints in small PRs with rollback, only after a versioned saved-state fixture proves equivalence.

## Required acceptance conditions for EVERY internal refactor

- **User-visible output:** identical pages, navigation, filters, labels, saved settings, review entries, edit actions, dates, numbers and warnings; no new options, removed controls or changed styling.
- **Financial correctness:** identical canonical event identity and linked-transfer semantics, equal projected per-account daily balances and min dates, preserved 1,095-day checking behavior and 90-day card low, identical issued vs estimated statements, no double counting, immutable actuals.
- **State compatibility:** load older encrypted prediction settings and Demo local settings; maintain ignored suggestions and previously confirmed schedules; do not drop older saved individual exceptions or payment-bill rules.
- **Security/reliability:** existing credentials, disks, keys, hosted private service, Plaid links and schema unchanged; no raw bank data in public repo, fixtures or logs; atomic safe saves under concurrency.
- **Test safety:** required money/security suite must pass, and UI-change PRs must pass desktop Chromium and iPhone WebKit. Compare exact frozen outputs and measure performance; no claimed speedup without timings.
- **Release boundary:** verify GitHub PR merge and separately verify current private Render `/healthz` SHA and Deploys live status.

## Immediate decision

This is an **audit, not authorization for a mass deletion/refactor**. No production code changes or new regression runs were made. Start with behavior freeze and CI consolidation, then cost/index optimizations. Never delete a test because its filename looks obsolete or remove a migration field merely because the current UI no longer creates it.
