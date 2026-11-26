# Ledger — current project handoff

**Updated:** 2026-11-26 (Pacific)  
**Repo:** [household-ledger](https://github.com/markbobthomas/household-ledger)  
**Instructions:** [AGENTS.md](AGENTS.md)  
**Complete history, preserved byte-for-byte:** [archived handoff through 2026-11-26](docs/archive/PROJECT_LEDGER_full_through_2026-11-26.md)

**Read this compact handoff first.** The archive is the exact former 1.45 MB `PROJECT_LEDGER.md`, not a deleted/reconstructed summary. Consult its relevant dated section for historical why/how; do not read or rewrite all 1.45 MB on every task. Git history also preserves all prior revisions. Future tasks append short entries here and maintain the live state below.

## Product goal and invariants

Ledger is a **calendar-first checking-balance forecaster**, not primarily a budget. It must answer what the main checking balance will be on a future day, what dated bills/deposits produce that balance, and when cash might run low.

- **One canonical expected-transaction ledger** and one balance calculator; actual bank balances and Plaid transactions are authoritative and read-only. A user edits forecasts/overrides, never bank facts.
- Forecast major recurring bills, independent alternating four-week paychecks, known transfers and linked credit-card payments. Card purchases count toward spending/card debt, **not checking outflow until payment**. Never count transfers/payments twice; uncertainty goes to Review.
- Preserve separate recurrence streams by account, payee, direction and cadence; changing one occurrence vs **all future** must be clear. Never invent a third partial-range recurrence editor.
- Default calendar-first Home and four primary tabs; use scoped, cached reporting and collapsed secondary details. Display/filter changes must not cause a 1,095-day forecast rebuild or bank fetch. See [PERFORMANCE_ARCHITECTURE.md](PERFORMANCE_ARCHITECTURE.md).
- Treat the next 90 days of **main-checking liquidity** as the primary safety horizon. Everyday variable purchases are deliberately excluded from the authoritative checking projection. The AI report may estimate uncertain spending separately; never silently merge it into bank-cash forecasts.
- All categories need a home; user overrides control manual categorization. Owner-defined category rules: Groceries = food/drinks and delivery fees; Dining = restaurants/takeout/coffee; Insurance = insurance premiums plus protection plans/deductibles, excluding health premiums (Healthcare); Subscriptions = digital services only; mixed Costco/Target/Walmart purchases use the predominant category.
- Expose important warnings first and secondary explanations on demand, with evident edit controls, legible spacing, and fast phone/tablet operation.

## Product interfaces: Ledger Simple and full Ledger

- **Ledger Simple** names the existing mobile-first household categorization page and its concluding expandable Budget view. The full application remains **Ledger** (the advanced financial management interface). The name is a user-interface distinction, not a fork of financial records or calculation rules.
- Preserve the stable permanent /categorize share URL and /categorize/manage owner manager. Existing share tokens are intentionally limited to the current categorization, personal-note editing and read-only spending Budget scope; they do not authenticate someone into full Ledger or grant access to bank balances, account controls or forecast management.
- **Future direction, not yet implemented:** grow Ledger Simple into a focused everyday interface with a small task queue, quick notes and categorization, recent spending and expandable budget; keep bill scheduling, future checking-balance planning, AI analysis, settings and diagnostics in full Ledger. Both must use the same authoritative encrypted data and server-owned accounting, revisions and conflict checks.
- Increasing scope, especially financial balances or account activity beyond current Budget, requires a new explicit privacy/access design (for example independently authenticated household roles). Never silently broaden the bearer link's permissions or duplicate transaction/budget logic. Both interfaces should remain coherent on desktop and mobile; "Simple" is a UX choice, not a separate physical app.

## Deployment, privacy and safety

- **Public GitHub repo.** Use only fictional test records and aggregate descriptions. Do **not** put private banking values, transaction identifiers, passwords, secrets, category-sharing tokens or real financial exports in this file or public tests.
- Existing private Render/Plaid server uses encrypted state, separate forecasts and encrypted analysis/session files. Never change live disk paths, persistent storage, encryption key, institution connections, authentication, infrastructure or production bank state without specific approval and verified preconditions.
- A **merged PR**, public GitHub Pages publish, passing checks and **private Render live deploy** are four distinct facts. Verify existing private service deploy and read-only `/healthz` full SHA independently; do not infer live deployment from merge or a demo publish. See [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md).
- Use a focused branch and checked PR. For banking/server code, run mandatory core banking/forecast CI; add Chromium/iPhone WebKit checks for changed UI/interaction. Merge only on passing relevant checks. Update this compact file with actual results.
- After each Ledger task update **Current state / Next action** and append one concise dated entry under **Recent decisions and releases**. Archive older entries when the active document approaches ~40 KB, retaining a stable link and chronological history. Avoid rewriting an ever-growing full historical snapshot for each prompt.

## Current state / Next action

**Last independently verified private Render app revision:** 2026-11-25 account-nickname release PR #763, app SHA `414bf7ac521b17b26721eaf4d29983aba681c10e`; later changes were merged but *their private deployment was not independently verified*. This is the last **verified** revision, not a claim the service is still running it.

**Prior November releases:** PR #775 merged `67160c2468d1a82f1700614fd3a0f1489bb7f4d4` (documentation-only). The 2026-11-26 prioritization PR #776 merged `dbe0c7429ac6b91878a5e5b94a7c518670cedb51`.

**Recent behavior already merged to source:**
- PR #751 UI refresh, #754 control spacing, #758 compact expandable warnings, #763 private account nicknames (last confirmed live).
- PR #770 desktop Chrome/Edge Amazon extension: user must install, grant permissions, sign into both sites and opt in; checks roughly every six hours *while browser is running*. Actual signed-in Amazon compatibility, multi-item orders and refunds remain unverified; retain ZIP/CSV fallback. No Amazon password storage.
- PR #772 a permanent, owner-recoverable **categorization** sharing URL; every visit/revisit shows the current uncategorized queue, existing personal/Amazon Notes, safeguards for manually selected Other, and revocation.
- PR #774 “See our budget” and clear “Open full Ledger app” end links; normal sign-in required for full app, share token not forwarded. PR #775 recorded checks. The latest private deployment is unverified.
- PR #779 shared Budget rows expand to show their source spending transactions (posted, pending, expected); the share recipient may edit and save personal Notes on live category tasks, while imported Amazon evidence remains read-only. Main Budget transaction action is now compact “Edit”, including on phones. The owner link manager discloses wider budget transaction visibility.
- PR #781 branded the current household shared page **Ledger Simple** in full Ledger's share entry point, the shared manager, recipient header, and browser title. Existing permanent URLs and permission checks remain unchanged.

**NOV 26 BACKEND MAINTENANCE — SOURCE MERGED, BANKING CI GREEN, PRIVATE RENDER UNVERIFIED:** [PR #777](https://github.com/markbobthomas/household-ledger/pull/777) merged as `b700bf69b64af53b93975fe1e56cbe7274e78817`. Source inspection confirmed the original archive blob matches exactly and the active handoff is 8.7 KB instead of ~1.45 MB. Idle hourly work no longer rebuilds unchanged same-day 1,095-day forecasts; saved forecast edits and bank sync still invalidate caches, and Pacific day rollover triggers re-preparation. Banking/forecast core and browser gate passed on the feature head. Private Render SHA has not been independently verified; no real-device speed claim.

**Next actions:** (1) Verify the private Render revision and Ledger Simple naming separately from GitHub; (2) accept-test permanent sharing, personal Notes and expandable Budget on actual household phones; (3) design any expanded Ledger Simple permissions before exposing more sensitive data; (4) reconcile the next 90 days' checking forecast with actual large payments; (5) validate owner-held encrypted backup/recovery and browser-based Amazon import. Keep any transactional-store cutover separately gated; old proof-of-concept was never a live migration.

## Reference map

- [README.md](README.md): current architecture and canonical ledger
- [ACCOUNTING_MODEL.md](ACCOUNTING_MODEL.md): posted/card/transfer invariants, historical stage boundaries
- [PERFORMANCE_ARCHITECTURE.md](PERFORMANCE_ARCHITECTURE.md): selective client/server cache invalidation
- [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md): source vs Pages vs Render verification
- [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md): encrypted backup and isolated restore
- [AI_ANALYSIS_PRODUCT_BRIEF.md](AI_ANALYSIS_PRODUCT_BRIEF.md): AI outlook goals and evidence standards
- [docs/ledger-release-roadmap.md](docs/ledger-release-roadmap.md): completed releases 1–3
- [Full historical handoff archive](docs/archive/PROJECT_LEDGER_full_through_2026-11-26.md): every prior dated note and status, unchanged

## Recent decisions and releases

### 2026-11-26 — Backend maintenance and handoff compaction (source merged)

**Request:** Make Ledger changes faster and clearer by reducing backend/log overhead.  
**Findings:** Live backend stdout/stderr uses only a small number of sanitized startup/error messages; no growing application log file was identified in `pilot/server.cjs`. The oversized project handoff was ~1.45 MB, and an hourly timer invalidated the RAM-only 1,095-day projection even when same-day inputs were unchanged. Neither finding by itself proves observed device latency.  
**Changes:** Archive the previous handoff bit-for-bit; replace active handoff with this compact decision-oriented summary; change hourly maintenance to rebuild only when the cache is missing, invalidated or has crossed the Pacific date boundary. Keep bank sync/forecast mutations, revocation retries, 1,095-day safety window and sensitive-data rules unchanged.  
**Checks/deploy:** [PR #777](https://github.com/markbobthomas/household-ledger/pull/777) merged as `b700bf69b64af53b93975fe1e56cbe7274e78817`. Final feature `b6c6096f0566276cf0de1b0b6749b44d0c147fd9` passed the Real-account pilot safety workflow [#45839860853](https://github.com/markbobthomas/household-ledger/actions/runs/45839860853) (full fictional core regression, including new hourly-cache policy assertions) and Browser interaction test [#45839860651](https://github.com/markbobthomas/household-ledger/actions/runs/45839860651) (gate succeeded; full browser suite not required for server/docs-only changes). Independently verified GitHub main commit, merged PR, smaller handoff and archive blob SHA `02dc50d5faf778befcacf7979031579b5cee8c61` matching the original exact content. No Render infrastructure or bank data changed. **Private Render live deployment and owner-device speedup remain unverified.**

### 2026-11-26 — Shared category-link budget detail, Notes, and compact Edit (source merged)

**Request:** Allow each category in the final shared Budget to expand into constituent transactions; shrink the oversized Budget transaction button to “Edit”; let the recipient edit a personal Note while categorizing.  
**Changes:** [PR #779](https://github.com/markbobthomas/household-ledger/pull/779) merged to `main` as `5ecb6f681f40988f7dd6647b7820ec243d63b3ad`. Shared Budget expands posted/pending/expected itemized spending without new bank fetches; shared Note edits are revision-checked, live-review-task-scoped and stored in existing encrypted forecast preferences. Imported Amazon evidence and actual bank facts remain read-only. Main Budget has a phone-sized “Edit” action. Owner consent text warns that share recipients can inspect category spending beyond the review queue.  
**Checks/deploy:** Final feature head `c8a050a8fc5e745671e4dad52f7d7f3e252194b4` passed full [banking/forecast CI #45890944194](https://github.com/markbobthomas/household-ledger/actions/runs/45890944194) and [desktop Chromium/iPhone WebKit #45890943535](https://github.com/markbobthomas/household-ledger/actions/runs/45890943535), including note authorization and budget detail regression assertions. Verified PR merge and matching `main` SHA. **Private Render live deployment remains unverified** (connected Render workspace only exposed a fictional sandbox service), and no private bank state or infrastructure was changed.

### 2026-11-26 — Name the everyday household interface Ledger Simple

**Decision:** Call the existing one-tap shared category-review and final Budget interface **Ledger Simple**, alongside **Ledger** for the full/advanced application. The successful simplified workflow is the intended foundation of a more capable mobile-first household experience, not a separate bank system. Both interfaces must use the same canonical encrypted ledger, accounting rules and existing private backend. Keep Simple intentionally focused, with user-permitted scope and clear paths to full Ledger; additional financial data access requires explicitly designed authentication/permissions.
**Verified source change:** [PR #781](https://github.com/markbobthomas/household-ledger/pull/781) merged as `70d3949e02f13c6fa8ee59f6edbff0d274e368cc`. Page title/header, share-manager name and full Ledger share entry use **Ledger Simple**. The permanent shared URL, revocation, categorization/budget behavior, forecast math, token scope and private state were not modified. Future feature expansion is a product direction, **not implemented in this rename**.
**Checks/deploy:** Final feature head `80cf731fc09843dcf6577c59fb42d3f390e57f42` passed [banking/forecast safety CI #45908481608](https://github.com/markbobthomas/household-ledger/actions/runs/45908481608) and [desktop Chromium/iPhone WebKit suite #45908481598](https://github.com/markbobthomas/household-ledger/actions/runs/45908481598). Confirmed PR merge. **Private live Render revision remains unverified**; no connected production service was available to verify, and no infrastructure or bank data was changed.
