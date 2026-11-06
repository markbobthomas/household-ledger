# Ledger backend simplification and test-logic audit — November 6, 2026

**Scope:** Read-only review of current GitHub \`main\` after PR #542 (navigation reordering). No actual financial data, protected accounts, source transactions, passwords, secrets, Render settings, or user preferences inspected or changed. This is a source-level architecture assessment, **not** a production profile or certification of financial correctness.

## Executive decision

Do **not** rebuild Ledger or delete banking guards immediately. The canonical architecture is already present in \`planner-core.js\`: materialize exactly one dated future transaction ledger and project balances from it. The redesign should reduce the many independent **interpretations, normalization passes, reporting passes, historic engines, caches and migrations** around that core.

Preferred direction: a small **modular monolith**, with one authenticated backend process, one encrypted transactional state store, one provider ingestion path, one normalized economic-transaction/read model, one recurrence-analysis service, one saved-plan/occurrence system, one forecast/materialization service, and reusable report selectors. No Kafka, Redis, microservices or separately deployed analytics stack.

## Evidence-backed duplication and reduction candidates

| Priority | Current evidence | Duplication / risk | Proposed consolidation | Removal condition |
| --- | --- | --- | --- | --- |
| P0 | \`pilot/server.cjs\` ~173-340 stages and commits live Plaid sync; \`ledger-data.js\` ~658-773 has separate \`applyPlaidSync\`/\`applyPlaidSyncPages\` | Two normalizers/reducers for the same provider changes; tests of the latter do not automatically prove behavior of the live route. Different provider-ID shapes and pending-to-posted handling complicate parity. | One pure provider-sync reducer, called by the existing live connector and fictional test harness. Plaid fetch and auth stay backend-only. | Demonstrate identical multi-Item, pagination, update/delete, pending→posted, failed-batch rollback and preserved owner metadata in synthetic fixtures before removing the old adapter. |
| P0 | \`pilot/data-source.js\` ~70-134 classifies raw source rows, \`accounting.js\` ~80-200 infers accounting kind/transfer pairings, \`ledger-data.js\` ~337-380 resolves categories, \`planner-history.js\` ~50-90 separately recognizes some settlements, \`payment-obligations.js\` ~133-624 matches payments | Multiple places decide whether the same row is a purchase, refund, loan withdrawal, card settlement or transfer. Some layers have legitimate roles but separate classifiers risk disagreement. | One immutable provider transaction plus one normalized **economic classification** with stable transfer/payment links and explicit category provenance. Account/report/card consumers use this single definition. | Cross-check Budget/Insights/Statements/Transactions, one-sided and paired transfers, refunds, ambiguous links and bank facts before eliminating report-specific detectors. |
| P0 | \`planner-core.js\` \`analyze\` ~73-222; \`planner-history.js\` \`guessFrequency\`, \`candidates\`, \`recommendedRepeating\` ~152-335; \`planner-coverage.js\` \`cadenceFor\`, \`projectedIncomeSlots\`, \`incomeCoverage\` ~434-520 | Multiple cadence/grouping engines with different merchant, amount, phase and tolerance rules may disagree on repeating evidence, coverage and warnings. | One recurrence evidence index, producing independent streams and explicit confidence; forecasting, Review and coverage consume the same stream IDs. Review is a view of candidates, not a separately inferred set. | Preserve alternating 14-day-offset pay streams, one-post mortgage, variable utilities, exclusions and distinct same-payee schedules; no new duplicate predictions. |
| P1 | \`pilot/server.cjs\` ~13-16, 64-124 writes encrypted main state plus \`.forecasts\` sidecar; ~80-85 replays pending/posted identity migration after loading; two write queues around ~40 and ~104 | A practical optimization that leaves two authorities for one logical household revision and complicates crash recovery and category/forecast changes. Both queues may still defend different write paths. | Transactional store with one authoritative revision, atomic source changes + owner decisions + alias map; one serialized mutation boundary. | Dual-read migration, snapshot/backup verification, retry/409 tests, restart replay, cross-device conflicts and no lost notes/categories. Never directly replace current encrypted disk. |
| P1 | \`pilot/server.cjs\` ~397-404 invalidates prepared result after **every** successful \`/api/ledger/\` write; \`planner.js\` ~3511-3519 and ~3676-3685 clear broad prepared caches | Note/budget/display-only edits can trigger too much preparation. Spending display filters drop both History and Activity prepared nodes, plus all Spending subviews. | Typed edits and selective invalidation of one normalized read model, one report, or canonical forecast only if its inputs change. | Assert prepared-generation and forecast-build counters stay unchanged for note, display preference, account/month filter and reporting-only changes, while genuine financial edits invalidate correctly. |
| P1 | \`pilot/prepared-forecast.cjs\` ~13-30 and \`planner.js\` ~57,144-184 share a **1095-day** projection, server-prepared when available and browser fallback when unavailable; \`planner-core.js\` ~784-834 audits all projected days | The **algorithm** is shared, not a second competing balance formula, which is good. But long projections, fail-closed audits and fallbacks can consume synchronous work; the backend read response may contain both raw transactions and \`bundle.rows\`. | One versioned projection build per changed input; indexed event-by-day calculations in integer cents, cached range/month read models; optional incremental extension to the full 3-year horizon. Move CPU-heavy builds off the HTTP event loop if profiling confirms blocking. | Maintain full historical/calendar navigation, 1095-day golden fixtures, exact bank baselines, conservation checks and bounded startup time. Do not silently shorten forecast coverage. |
| P1 | \`planner.js\` ~1296-1325, ~1455+, ~2382+, ~2599+ separately computes spending and report scopes; \`planner-history.js\` includes additional settlement detection | Budget, Month insights, Purchase Sizes, Merchants and scheduled-bill summaries perform distinct passes with overlapping classifications; the same amount can receive different meanings. | Define reusable read-model measures: \`posted_spending_cents\`, \`provisional_pending_spending_cents\`, \`forecast_spending_cents\`, \`checking_cash_delta_cents\`, \`card_liability_delta_cents\`. Require report scope (accounts, months, posted/pending/expected) explicitly. | Frozen cross-screen totals and refund/card-payment conservation fixtures must pass for single-account and all-account views. |
| P2 | \`planner.js\` is ~6,062 lines, \`planner-coverage.js\` ~819, \`planner-core.js\` ~1,011; browser warms six destinations plus Spending subviews at startup ~3474-3605 | Presentation, filters, notes, mutation commands, repeating Review and report math coexist. Preparing detached DOM pages can still be substantial startup work even though navigation later reuses nodes. | Separate commands and selectors from rendering by page; precompute inexpensive report data once, reuse existing DOM only where it helps. Preserve the user's explicit all-pages-ready startup requirement and instant prepared navigation. | Instrument real startup, no new fetch/reforecast on tab switch, no mobile overflow, no slower interaction. |
| P2 | \`tests/ci-suite.cjs\` has **55 core scripts** (1 baseline + 19 banking + 22 forecast + 1 parity + 12 reconciliation), **7 browser scripts**, 1 optional historic script. Each script is launched in its own Node subprocess ~23-40; browser scripts each separately launch Chromium/WebKit and a test server. \`planner-browser.cjs\` alone is ~2,484 lines. | Process/bootstrap repetition and accumulated historical scenarios make CI noisy and slow, but **these tests do not run in normal Ledger page loads**. Unique filenames do not mean unique test behavior. | Shared fixture/harness, domain-based unit suites, one Chromium/WebKit runner with separate browser contexts, per-PR targeted tests plus mandatory complete money-integrity gate. Track meaningful invariant/assertion coverage, not script count. | Preserve explicit coverage for immutability, atomic bank sync, linked transfers, card settlement, duplicate suppression, multi-device writes, pending migration, month navigation, responsive layouts and fast prepared-view filtering. |
| P2 | \`PHASE5_LEGACY_RETIREMENT.md\` and \`README.md\` say retired \`forecast.js\`, \`forecast-ledger.js\`, \`account-forecast.js\`, \`planner-intelligence.js\`, \`planner-recurrence.js\`, \`planner-backtest.js\` are test-only. Current core suite still includes tests importing them (e.g. \`planner-routine-smoke\`, \`planner-backtest-smoke\`, \`planner-income-smoke\`, \`planner-missing-mortgage-smoke\`, \`planner-early-recurrence-smoke\`, \`recurrence-early-dedupe-smoke\`, \`mortgage-prediction-smoke\`). | Tests of obsolete formulas can constrain the modern engine and keep dead product code in the tree. Some mixed tests also exercise current active helpers and cannot simply disappear. | Map every legacy-only assertion to the canonical engine or a migration fixture, then delete unused legacy tests, their historic implementation dependencies, and obsolete exports in a separate checked PR. Git history is the archive. | Search imports and actual production asset allowlists; demonstrate no active runtime consumers, preserve current-engine golden outputs and migration compatibility, pass banking/browser gates. |

### Runtime integrity checks: consolidate carefully; do not simply disable

- \`planner-transactions.js\` ~94-165 validates stored one-offs/rules and new duplicate introductions; \`planner-core.js\` ~258-260 rejects duplicate generated event IDs, ~754-783 deduplicates linked transfers, ~784-834 performs a post-projection conservation audit; \`pilot/server.cjs\` ~104-124 blocks duplicate writes. These guard **different boundaries**. A central set of pure validators can reduce repeated implementations while retaining guards on ingress, mutation, materialization, and read-model publication.
- The 1,095-day arithmetic audit may be optimized into a single indexed account/day pass and retained in comprehensive tests. Do not remove fail-closed account/household conservation until measured cost and equivalent runtime protection are proven.
- HTTP revision/idempotency/authorization validation, encrypted writes, pending-posted identity migration, Plaid cursor atomicity, source immutability and linked credit-card double-count prevention are high-value safeguards, **not wasteful checks**.

## Clean-sheet architecture for this particular household app

**Build one modular monolith, not a distributed finance platform.** Protect true source facts separately from user intent. Use deterministic domain code shared between real and fictional test inputs, but only the authenticated server owns real source state and writes. Browser state contains temporary view selections and cached read models, never provider secrets or authoritative source history.

\`\`\`text
Plaid Items + bank balance observations
           │ fetch full paginated sync / selected accounts
           ▼
  Atomic ingestion transaction
    ├─ bank accounts and balance snapshots
    ├─ immutable/versioned provider transactions
    ├─ pending→posted alias / removed-ID history
    └─ last-good per-Item cursors and sync diagnostics
           ▼
  One normalized bank ledger + economic classifications
           ├───────────────┐
           ▼               ▼
  Recurrence evidence   Owner decisions (categories, notes,
  and coverage facts    rules, one-offs, skips, overrides, ignores)
           └───────────────┘
                    ▼
          Canonical expected events
         (due date vs effective posting date)
              │           │
      single-account   linked transfer: two legs
              └───────────┘
                    ▼
       Reconcile actual/pending/expected ONCE
                    ▼
        Account/day balance projection
         + Spending/Statement read models
                    ▼
     Thin, cached Home / Spending / Bills /
          Transactions / Review API
\`\`\`

### Proposed persisted entities

1. \`plaid_items\` (encrypted tokens, cursor, connection status) and \`accounts\` (stable ID, institution Item, type, currency and owner-selected main-checking flag).
2. \`balance_snapshots\` (account ID, observed timestamp, **current** and **available** as distinct nullable integer cents; source freshness); snapshots never edited by the owner.
3. \`bank_transactions\` (provider source identity, account, Plaid signed amount and date, pending/posted status, immutable raw evidence, removal version); \`transaction_aliases\` for pending→posted migration, not fuzzy name/amount identity guesses.
4. \`economic_transaction_classifications\` / \`transfer_links\` (normalized kind and evidence, paired legs, confidence, original category and user effective category); classifications are derived/versioned, not provider writes.
5. \`recurring_streams\` (stable owner-specific schedule ID, cadence/phase, source evidence IDs, amount rule, active/stopped status) and \`occurrence_overrides\` (one dated occurrence, skip, move, amount change); owner-created one-offs and saved exclusions separate.
6. \`card_payment_rules\`, \`statement_cycles\`, \`settlement_links\` (issuer/payment-source IDs, cycle identity, entered issued amount versus estimate and linked actuals); no card purchase and repayment counted twice as spending.
7. \`categories\`, \`transaction_notes\`, \`review_decisions\`, and \`owner_revisions\` (all changes versioned and idempotent for multi-device safety).
8. **Derived, disposable** \`forecast_occurrences\`, \`forecast_legs\`, \`daily_account_balances\` and report aggregates, keyed by \`as_of\`, source revision, rules revision, algorithm version and range. These may be cached, never substitute for bank facts.

### Suggested financial model

- All monetary computation in **integer cents** and a specified currency. Do not recompute from dollar floats in each report.
- For cash/depository accounts, a deposit adds to balance and a payment subtracts. For cards, a purchase increases the **positive liability** and a merchant refund reduces it.
- A checking→card payment is **one** movement with two effects: checking cash decreases, card liability decreases, household net worth stays unchanged. A savings transfer has equal-and-opposite cash legs. Internal transfers and card payments are not spending or earned income.
- Pending bank items are *provisional*, distinct from posted actuals. A pending hold only suppresses an expected cash debit when specifically and safely linked; it is never a silently settled payment.
- Confirmed plan IDs own their occurrences. Suggested patterns are evidence only until accepted or the current defined auto-policy qualifies. Two independent alternating payroll streams never merge by merchant/amount.
- Actual bank posting date, planned due date and forecast-effective business date are separate fields. The Friday rule changes only the projected effective date.
- Daily balance is the account's latest trusted current snapshot plus the sum of **unreconciled future event legs after its as-of cut-off**, not a sum of card purchases and checking repayments twice.

### Storage/API choice

For a single household, single existing Render instance and current persistent volume, a **transactional encrypted SQLite database (SQLCipher or equivalent verified at-rest encryption)** would be a reasonable clean-sheet default; it supports atomic multi-table changes, indexed month/account lookups, WAL and easy local fictional fixtures without a separate DB service. A managed encrypted Postgres database is the alternative if multi-instance scaling is later needed. Encrypt provider tokens separately and preserve backup/restore procedures. This is an **architectural recommendation only**: no change to the live AES-GCM files, keys, disk, Render plan or credentials is authorized by this audit.

- \`POST /sync\`: backend-only, stage complete provider pages, atomically update source facts/cursors/aliases and bump source revision.
- \`GET /ledger?from=&to=&account=\`: coherent revisioned source/forecast read model with explicit posted/pending/expected kinds; avoid sending both a raw history and duplicate derived history in each response.
- \`GET /reports?months=&accounts=\`: Budget, Merchants, Purchase Sizes and Month insights query **shared measures** and independently labeled scopes.
- \`PATCH /decisions/:id\`: narrowly scoped user edit with \`If-Match\`/revision, idempotency key, typed invalidation; an annotation edit should not rebuild the forecast.
- \`GET /reviews\`: unresolved candidate/coverage/reconciliation states derived from the same evidence IDs, with explicit acknowledge, ignore or confirm actions.
- Financial compute stays one shared deterministic domain implementation. The server owns the real revision, calculation and caching; fictional Demo can execute the same pure functions locally with synthetic source facts.

## Lean test strategy (retain rigor, reduce process overhead)

**Fast mutation gate:** a small set of domain-focused, table-driven suites for ingestion/normalization, classification & transfers, recurrence/occurrences, card settlements, forecast conservation, reporting totals, and persistence/version conflicts.

**Canonical golden gate:** preserve \`tests/architecture-baseline.cjs\` and its 1,095-day fictional golden hash, \`planner-parity\`, \`planner-posted-matching-smoke\`, and prepared server/client equivalence. Extend coverage for Friday shifting, weekend history, past-month reconstruction and alternating payroll.

**Protected bank tests:** preserve atomic multi-Item Plaid sync, restart and failed-write rollback, pending/posted notes/categories, duplicate IDs, lost-update/409 protection, account removal, no persisted source edits, and no insecure asset access. These are non-negotiable even if wrapped into fewer files.

**Browser gate:** reuse a single Chromium and WebKit launch per CI worker, isolating browser contexts per scenario. Preserve navigation, account/month filters, actual category edits, card payment vs expense totals, no-overflow phone layout, and prepared-view counters; don't run seven independent browser+server launch sequences if a shared harness can produce the same evidence.

**Schedule:** prioritize impacted domain suites during a PR, but require the complete safety baseline before merging changes to financial computation, ingestion or persistence. A nightly exhaustive randomized/property-based run is useful for additional breadth, **not** a substitute for the merge-time safety baseline.

### Concrete first sequence, in separate reversible PRs

1. **Measure and lock invariants, without financial changes.** Capture timing, work counters and /api/ledger payload size using exclusively fictional data; map dependency imports and baseline the true live current engine. Define classification/forecast/report contracts and current output goldens.
2. **Retire historical-only tests/modules:** migrate meaningful legacy-only assertions into canonical-engine fixtures; share browser harness; remove obsolete code only once imports are proved absent. This primarily improves CI and maintenance, not live page speed.
3. **Unify interpretation:** one provider sync reducer and one normalized/economic bank read model; consolidate settlement classification, recurrence evidence and reporting dimensions, preserving all safety semantics.
4. **Reduce recomputation and duplicated payloads:** versioned derived projection, field-sensitive invalidation, indexed date/account read models, asynchronous heavy computation if instrumented to be needed, while preserving all prewarmed destinations and 3-year capability.
5. **Consider transactional storage only after parity:** build encrypted database migration and rollback rehearsals against isolated fictional state; no live cutover until exact snapshot/backup safety, all cross-device edits and all checks pass with explicit owner authorization.

## Current verification boundary

Only GitHub source and the manifest of current test scripts were inspected. No PR test run, real-user browser performance trace, authenticated account data, or live Render mutation was performed for this audit. Source findings are grounded; expected performance gains and safe removal counts remain **hypotheses** pending instrumentation and coverage mapping. Documentation changes alone require no banking/browser CI under \`AGENTS.md\`.