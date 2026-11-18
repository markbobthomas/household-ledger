# Ledger end-to-end QA/QC review — 2026-11-17

**Scope:** Read-only review of public source, the existing fictional-data test inventory, successful recent GitHub Actions results, private Render deployment metadata, events, and aggregate metrics. **This is not a transaction-by-transaction audit of the owner's encrypted live bank records.** No private data, keys, disks, Plaid connections, or runtime settings were changed. No application code was modified in this review.

## Evidence and scope

- Reviewed bank ingestion/sync and records in `pilot/server.cjs`, `pilot/data-source.js`, `ledger-data.js`; accounting/classification in `accounting.js`, `categorization.js`; recurrence, projected cash balances, one-to-one posted matching, and card cycles in `planner-core.js`, `planner-transactions.js`, `payment-obligations.js`; account/transaction/budget/report/calendar UI in `planner.js`, `planner-history.js`, `planner-summary.js`; security/storage and CI in `pilot/session-auth.cjs`, `pilot/transactional-store.cjs`, `tests/ci-suite.cjs` and existing focused tests; operating instructions and performance/deployment architecture docs.
- Last merged **application-code** revision: [Sunday-first calendar PR #581](https://github.com/markbobthomas/household-ledger/pull/581), `ffb3933dc82e4dcfe1c4f1d25bb450c69e9974e6`. The later `main` revisions before this audit were `[skip render]` documentation only. Existing financial/bank safety [run #44201444752](https://github.com/markbobthomas/household-ledger/actions/runs/44201444752) and Chromium/iPhone WebKit [run #44201444693](https://github.com/markbobthomas/household-ledger/actions/runs/44201444693) **passed**. The inventory contains 51 unique core scripts and 7 shared browser specifications. These are **previously executed CI results**, not a newly rerun test suite.
- Private Render reports deploy `dep-dbued82vcj2c738lfdgg` **live** at the exact code SHA above. Recent service events show successful build/deploy and no returned server-failure events in the examined range. Render aggregate HTTP metrics for Nov 16–17 included **four 502 responses** (source/endpoint not identified); app logs reviewed showed live startup, but did not establish a root cause. The private HTTP `/healthz` and authenticated UI were **not** independently read back in this session.
- A separate local Node demonstration of the exact month-addition pattern in `payment-obligations.js` reproduced January 31 → February 28 → March 28 → April 28 instead of a month-end-anchored 31/28/31/30 sequence. This isolates a mathematical edge case; it did not execute the production test suite or access real card data.
- Direct transaction-level checks (Plaid transaction completeness, bank balance readback, exact category overrides, present-month budget totals, reconciliation of individual posted vs predicted bills, and user-specific future-low accuracy) are **unverified** without authorized read-only access to the private live ledger.

## Results by subsystem

| Subsystem | Evidence from source / previous checks | QA/QC status |
| --- | --- | --- |
| Plaid ingestion / source fidelity | Complete paging staged before cursor/source commit; provider IDs used for upserts; pending→posted metadata remapping; connection tests | Design and fictional tests support consistency; concurrency and recovery hazards below |
| Transaction types / reporting | Shared signed-cent measures; conservative paired transfers; card settlement excluded from duplicate spending; manual category learning / budget parity tests | Mostly consistent; unclear incoming credits may be treated as earned income |
| Recurring forecast / checking balances | One canonical future ledger; projected daily reconciliation/conservation assertion; two same-payee posted payments guarded by recent regression | Strong synthetic controls; owner-specific missed/duplicated bills unverified |
| Credit-card statements and autopay | Issued vs estimated amounts separated; posted card purchases and dated forecasts, no average statement estimate; checking→card movements | Matched flow is conservative; inferred unconfigured card monthly date can drift |
| Spending, Budget, Activity, Review, Calendar | Shared reporting measures; provisional pending budget; reviewed seven-day Sun–Sat UI and Friday prediction scheduling | Recent desktop/iPhone and financial CI passed; live visual/data parity not observed |
| Preferences / cross-device edits | 409 stale-revision guard, forecast write queue, idempotent retry, encrypted separate forecast file | Good for forecast-only collisions; bank-sync + other source mutations lack one global write boundary |
| Security / deployment | Encrypted server files, session-cookie auth, anti-CSRF action/origin checks, no-store private assets; Render exact code live | Source-level controls present; recovery and 502 response attribution unresolved |
| Performance | Prepared forecast and client-side prepared views, in-memory work counters, regression coverage for filter invalidation | Passing prior automated checks; no authenticated real-device latency benchmark taken |

## Prioritized findings

### P1 — high-impact recovery and persistence safety

**F-01 — Provider revocation precedes durable account removal. Code-confirmed failure-order hazard, not observed live.** In `pilot/server.cjs` around lines 829–844, removing the final account on an Item calls Plaid `/item/remove` **before** writing the new local encrypted state. If the subsequent disk write fails, the handler restores its in-memory `state`, but cannot restore the already revoked remote access token; reconnect work may then be necessary. The all-account `/api/disconnect` path similarly revokes remote Items before committing the local removal and deleting its forecast file (lines 848–854). Existing tests exercise a **failed Plaid revoke**, not a **disk failure after successful revoke**. **Remediation:** Use a durable, recoverable multi-step disconnect intent / verified commit protocol; test post-revocation write failure without ever running on real records.

**F-02 — Shared encrypted bank-file `.tmp` path is not globally serialized. Code-confirmed race risk, not observed live.** `atomicEncryptedWrite(file,...)` uses a fixed filename `file+'.tmp'` (lines 87–95). Forecast saves have their own queue, and `/api/ledger/*` preference edits have a request queue, but `/api/sync`, connection management, and several direct bank-file saves do not share a global bank-file writer/mutation queue. Concurrent writes can both touch the same temp pathname, leading to competing content or a failed rename; overlapping refresh/removal may also apply one view of source state after another operation. **Remediation:** Serialize bank-state mutations and disk writes (or uniquely name temp files *and* guard state revisions); test concurrent refresh, category changes, reconnect/remove and crash recovery using isolated fictional data.

**F-03 — Independently restorable bank-state backup remains unverified. Operational risk, not a newly discovered corruption.** The authoritative encrypted bank snapshot, separate forecast preferences and sessions reside on the existing private persistent disk. Prior checks established presence and rehearsal of an isolated storage candidate, but did **not** establish a separately held, consistent, off-disk copy with a successful isolated restore of all three production state files. GitHub source control is not a backup of these private records. **Remediation:** Make a private encrypted, consistent recovery set and test restoring in isolation before any future live storage migration. No production restore, data transfer or new service authorized/performed in this review.

### P2 — data-meaning and freshness risks

**F-04 — Unidentified incoming checking credits default to income. Code-confirmed policy gap; live incidence unknown.** `accounting.js` `initialKind()` ends with `if(dir==='in')return 'income'`; `classifyPlaidSource()` likewise labels incoming non-card, non-transfer entries as income absent recognized refund evidence. A merchant refund lacking explicit "refund"/PFC markers may therefore count as income rather than offset spending, distorting income totals and possibly recurrence inference. **Remediation:** Distinguish verified wages/benefits from unknown credits, and send genuinely ambiguous credits to Review; include a fictional descriptor-free checking refund regression.

**F-05 — Two-day-old bank observations are still marked `fresh`, while the private app does not sync automatically on open. Explicit existing policy, correctness exposure.** `planner-core.js` around lines 872–883 marks `age<=2` as `fresh`; `pilot/data-source.js` `enter()` fetches the most recently saved snapshot but does not run `/api/sync`; the hourly server job recomputes prepared views, not bank transactions. Consequently, forecast start balances can be one or two calendar days behind bank activity while the UI says "BANK REPORTED." The app does separately show last-sync time and marks `age>2` stale. **Remediation:** Make observation timestamp and unrefreshed-period risk conspicuous at the forecast point; consider refresh-on-open with safe bounded sync or require same-day bank confirmation before high-confidence claims.

**F-06 — Legacy bulk adjustment endpoint can replace unrelated settings on a partial request. Code-confirmed compatibility risk; normal modern UI uses scoped saves.** `pilot/server.cjs` lines 734–754 replace `state.ledgerAdjustments` with only the allowed fields included in `/api/ledger/adjustments`. A historical client submitting a subset can temporarily erase omitted forecast/category/review settings from the active state; `/forecasts` is now a safer separate endpoint and its file is replayed on restart. **Remediation:** Enforce full-snapshot shape with explicit revision or switch to clearly scoped merge semantics and add a save/restart parity regression.

### P3 — narrow but reproducible date edge case

**F-07 — Inferred monthly card-payment dates drift after February when starting on the 29th–31st. Reproduced with fictional dates.** `payment-obligations.js` around lines 9–11 and 167 uses a clamped month-addition helper repeatedly on its *previous generated date* for inferred, not fully configured, card payment plans. E.g., an end-of-month 31st date becomes Feb 28 then March 28, rather than returning to March 31. User-configured card rules use anchored offsets and are not implicated. **Remediation:** Generate each inferred occurrence from its original anchor with integer month offset; extend existing card-cycle smoke tests.

### Operational signal requiring attribution

**F-08 — Four HTTP 502 responses in available 48-hour Render aggregate metrics (Nov 16–17). Observed, cause unverified.** The private endpoint maps some Plaid `INVALID_FIELD` errors to 502, but aggregate metrics do not identify which requests produced these responses, and available app-log summaries cannot establish a cause. **Remediation:** Inspect private request status/path and safe Plaid diagnostic fields during the next occurrence; do not reconnect, rotate credentials, or infer source-data loss from HTTP status alone.

## Proposed implementation sequence

1. **Storage safety:** F-01 and F-02 as a single controlled, isolated failure-injection and concurrency project; preserve existing Plaid/disk architecture and demand banking safety CI.
2. **Recovery:** F-03 owner-controlled, access-restricted, consistent off-disk backup and isolated restoration exercise before storage migration.
3. **Financial interpretation:** F-04, then F-05, using the current canonical accounting boundary, one Review decision, visible last-sync context and targeted fixture tests; no new source interpretation in individual UI tabs.
4. **Compatibility and calendar:** F-06 and F-07 with focused regressions in existing suites; do not rebuild unrelated reports.
5. **Operational diagnostics:** Attribute F-08 in private logs/status metadata, without copying transactions or keys into GitHub or ChatGPT.

## What this review did not certify

- Actual private Plaid counts, institution coverage, account-by-account transaction reconciliation, card issuer statements, forecast-vs-posted accuracy in the owner's last 90 days, or live duplicate/category counts.
- A successful offsite restore, private disk snapshot inventory, authenticated live browser layout, or independent direct HTTP `/healthz` response.
- No discovered issue is proof that existing private financial records have been lost or altered. **No app code, private bank records, settings, tokens, disk or Render service was changed by this audit.**

## Second-pass verification — 2026-11-17, ~16:19 Pacific

This second pass **independently reran** the last exact application-code PR's two GitHub checks without modifying Ledger source or deploying the private service. GitHub Actions reruns used the PR head `c775932f027bc3b6c388d7d3915966f9f457d3e9`, whose application files are identical to the private Render live squash merge `ffb3933dc82e4dcfe1c4f1d25bb450c69e9974e6` (subsequent merged commits only changed documents).

| Fresh check | Result | Evidence |
| --- | --- | --- |
| Mandatory finance / Plaid / canonical forecast / category parity | **PASS**, attempt 2, 51 distinct core scripts | [Real-account pilot safety run #44201444752](https://github.com/markbobthomas/household-ledger/actions/runs/44201444752); new job `134473773163`; log ends `PASS core regression suite (51 tests)` |
| Desktop Chromium and iPhone WebKit | **PASS**, attempt 2, 7 distinct specs in both browser engines | [Browser interaction run #44201444693](https://github.com/markbobthomas/household-ledger/actions/runs/44201444693); new job `134473792785`; each of 7 spec outcomes shows PASS |
| Private production source | **Live**, unchanged application code | Render existing deployment `dep-dbued82vcj2c738lfdgg` at `ffb3933dc82e4dcfe1c4f1d25bb450c69e9974e6` |
| Isolated same-temp-path write collision reproduction | **Reproduced:** 100/100 concurrent write *pairs* encountered at least one failed rename | Independent local Node exercise of the exact `writeFile(file+'.tmp')` then `rename(file+'.tmp',file)` pattern used by `pilot/server.cjs` |
| Inferred card month-end behavior | **Reproduced:** Jan 31 → Feb 28 → Mar 28 → Apr 28 under repeated clamped increment | Isolated date-helper calculation of `payment-obligations.js` inference pattern; anchored monthly offsets yield Mar 31, Apr 30 |
| Authenticated live data readback / direct `/healthz` | **Not done** | No access to owner's private session or source files via this read-only audit |

### F-09 — Missing server-side gzip response compression (new, confirmed source bug; P2 performance)

`pilot/server.cjs` checks the browser's `Accept-Encoding` with a double-escaped regular expression in the response handler for large authenticated `GET /api/ledger` responses (around lines 426–433). It contains **literal double backslashes** in the source pattern, so the branch does not activate for the conventional header `gzip, deflate, br`. A direct Node comparison reproduced **false** for the production expression and **true** for the intended word-boundary matching. This is a network/performance issue (possibly mitigated separately by hosting-edge compression), **not a forecast arithmetic discrepancy**. Fix by correcting the expression and verifying the actual HTTP `Content-Encoding` response with a fictional payload and both gzip-accepting and identity clients; assess synchronous compression's event-loop impact before enabling it on large payloads.

### What the tests do not prove

- Green canonical-balance arithmetic and 58 scripts prove **internal calculation and scenario consistency on fictional data**, not the completeness of actual bank records, reliability of the linked financial institutions, exact recurrence coverage, or independently backed-up, recoverable encrypted state.
- The temporary-file exercise demonstrates an actual concurrency hazard in the **same I/O pattern**. It does **not** prove two requests overlapped on production or that private records are corrupt. The code's shared `.tmp` pathname is the mechanism to fix; test the real server in a fault-injected fictional environment before production release.
- Do not infer success or failure of private bank refresh from Render's four previously reported 502 responses: this response category alone cannot attribute the cause. No bank record, account configuration, secret, Render disk or production infrastructure was altered.
- This is **QA/QC evidence and an implementation backlog**, not a claim that all defects were repaired. Future changes must be separately checked, merged and deployed; fix F-01/F-02 first because their consequences affect recoverability.



### F-02 release verification — November 17, 2026

**Fixed in source and released, with remaining real-data uncertainty:** [PR #586](https://github.com/markbobthomas/household-ledger/pull/586), code merge `111add1f693160ce530269742a265661cba7886f`. The private bank server now serializes all bank-state-changing POST routes and uses exclusive unique temp files, an ordered per-filename encrypted-write queue, and atomic rename. Previously independent bank sync and user category updates now commit in one order. Extended the existing fictional bank-flow test for two concurrent refreshes, an overlapping category decision, saved forecast/selected account preservation, and decrypted fictional persisted bank-file verification. The [51-core banking CI](https://github.com/markbobthomas/household-ledger/actions/runs/44209082628) **passed**; [non-UI browser workflow](https://github.com/markbobthomas/household-ledger/actions/runs/44209082635) **completed successfully** (no UI suite executed on server-only diff). Private Render reports existing-service deploy `dep-dbuf61ijnfac73bg3r7g` **live** at the exact code SHA. No real bank data or filesystem was accessed from ChatGPT. This resolves the identified shared filename/unsynchronized-mutation failure mode; a real bank data audit and independent backup remain unverified. **Next fix F-01** (remote revoke-before-local-save failure sequence). F-03 backup and restore is a separate owner-controlled safeguard.
