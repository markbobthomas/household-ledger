# Ledger — current project handoff

**Updated:** 2026-11-27 (Pacific)  
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

## Product interfaces: Ledger Lite (Lite) and full Ledger

- **Ledger Lite** (shorthand: **Lite**) names the existing mobile-first household categorization page and its concluding expandable Budget view. The full application remains **Ledger** (the advanced financial management interface). The name is a user-interface distinction, not a fork of financial records or calculation rules.
- Preserve the stable permanent /categorize share URL and /categorize/manage owner manager. Existing share tokens are intentionally limited to the current categorization, personal-note editing and spending Budget scope (including category/Note correction on existing posted Budget purchase lines). They do not authenticate someone into full Ledger or grant access to bank balances, account controls, budget targets or forecast management.
- **Current Lite:** One-at-a-time uncategorized review plus the existing expandable monthly Budget. Each posted Budget purchase has a compact Edit for its category and personal Note; pending/expected items remain read-only. Full and Lite switch at the top; the signed-in owner can open Lite without a sharing token, and sharing/revocation controls remain in Lite. Advanced bill scheduling, checking-balance planning, AI analysis, settings and diagnostics stay in full Ledger. Both use the same private authoritative accounting, revisions and conflict checks.
- **Lite review contract (PR #790):** Skip is only movement to the next purchase, not a stored decision or a separate skipped state. Refresh always restarts the current uncategorized queue, including purchases passed over; categorization and note saves persist. At the end of a pass use the same Refresh action; do not add a separate skipped-item review flow.
- **Lite header (PR #792):** The top bar has only the Ledger Lite name and a direct Full Ledger link. The one-line review heading shows the uncategorized count, with no repetitive introduction. The signed-in owner can manage sharing from a small link below the content; this link is not exposed to shared-link recipients.
- Further increasing scope, especially financial balances, older-month history or account activity beyond the currently shared Budget, requires an explicit privacy/access design. PR #786 deliberately extended the existing bearer link only to correcting already-shared posted Budget purchase category/Notes; do not extend it implicitly again. Never duplicate transaction or budget logic. Both interfaces should remain coherent on desktop and mobile; "Lite" is a UX choice, not a separate physical app.

## Deployment, privacy and safety

- **Public GitHub repo.** Use only fictional test records and aggregate descriptions. Do **not** put private banking values, transaction identifiers, passwords, secrets, category-sharing tokens or real financial exports in this file or public tests.
- Existing private Render/Plaid server uses encrypted state, separate forecasts and encrypted analysis/session files. Never change live disk paths, persistent storage, encryption key, institution connections, authentication, infrastructure or production bank state without specific approval and verified preconditions.
- A **merged PR**, public GitHub Pages publish, passing checks and **private Render live deploy** are four distinct facts. Verify existing private service deploy and read-only `/healthz` full SHA independently; do not infer live deployment from merge or a demo publish. See [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md).
- Use a focused branch and checked PR. For banking/server code, run mandatory core banking/forecast CI; add Chromium/iPhone WebKit checks for changed UI/interaction. Merge only on passing relevant checks. Update this compact file with actual results.
- After each Ledger task update **Current state / Next action** and append one concise dated entry under **Recent decisions and releases**. Archive older entries when the active document approaches ~40 KB, retaining a stable link and chronological history. Avoid rewriting an ever-growing full historical snapshot for each prompt.

## Current state / Next action

**2026-11-27 — Unmatched Amazon purchase owner resolution merged:** [PR #842](https://github.com/markbobthomas/household-ledger/pull/842) merged as `82cbcd894f709350eae44a65606845c25146f581`. The completed TinyFish report could not establish a unique automatic product-to-bank match; retrying it cannot restore missing prices. Added a small authenticated **Review unmatched Amazon charge** panel to show bounded nearby order titles/dates/totals from the *same completed run*, with an explicit owner choice that saves an account-qualified Note and owner-confirmed evidence only. Paid starts unchanged; original bank records, manual Notes/categories and split allocations protected, and automatic updates remain OFF. [Banking/forecast CI #46111909295](https://github.com/markbobthomas/household-ledger/actions/runs/46111909295) and [Chromium/iPhone WebKit CI #46111909327](https://github.com/markbobthomas/household-ledger/actions/runs/46111909327) both passed on final PR head `cce2cdc398eafd208bceda74ca20bc3e3063805f`. **Next:** owner checks the correct products in Amazon, then uses the new review panel once its existing private Render deployment updates. The connected Render workspace exposes only the sandbox service, so **private production deployment and live-charge resolution are not verified**. Manual ZIP/CSV fallback remains.

**2026-11-27 — Verified Amazon order-total Note recovery merged:** [PR #840](https://github.com/markbobthomas/household-ledger/pull/840) merged as `1557a7991713a46fe83d3a339f8e04b6f29d3e7d`. Completed TinyFish result contained several unpriced orders with consistent positive total. Ledger can now save product-title **Notes only** where a single-shipment full-order amount uniquely matches one posted charge in a short date window; duplicate/unknown/competing orders block the match, no item price, allocation or category is invented. [Core banking/forecast CI #46111363997](https://github.com/markbobthomas/household-ledger/actions/runs/46111363997) and [desktop Chromium/iPhone CI #46111364032](https://github.com/markbobthomas/household-ledger/actions/runs/46111364032) passed for final source head `cb65c18f653cd62fad679f37520572c052f7def7`. No paid TinyFish Agent rerun, real bank mutation, or private deployment change. Connected Render workspace only exposes a **test sandbox service**; private production `/healthz` SHA cannot be independently verified. **Next:** once existing private deployment updates, owner uses **Recheck saved result** (not Check now) to evaluate the prior completed run without another paid Agent launch; still may remain paused if bank charge does not exactly match.

**2026-11-27 — Amazon missing-price recovery merged:** [PR #838](https://github.com/markbobthomas/household-ledger/pull/838) merged as `a3ebcfbe5aba9902f400fa85218ef28d4e05ddd4`. TinyFish now requests verified item prices or null (not guessed zeros), discards whole unpriced orders and out-of-window history, blocks ambiguous exact matches, and marks only verified bank charges as checked; partial/unmatched reports pause future Agent checks. Owner-only **Recheck saved result** uses an existing completed TinyFish run from the same pinned profile by read-only GET, without another paid Agent launch or daily-limit change; active status refreshes. [Core banking/forecast CI #46110545351](https://github.com/markbobthomas/household-ledger/actions/runs/46110545351) and [Chromium/iPhone CI #46110545319](https://github.com/markbobthomas/household-ledger/actions/runs/46110545319) passed on final head `fba748c984bb05df7d68af09eee962d906e8830b`. **Next:** verify existing private Render `/healthz` SHA (unverified here), then owner may reprocess the prior completed Amazon check using its TinyFish Run ID without starting another Agent. Real Amazon matching remains to be confirmed; source bank data untouched.

Earlier current-state snapshots are preserved [verbatim in the dated archive](docs/archive/PROJECT_LEDGER_2026-11-27_prior_current_state_snapshots.md); the latest status above supersedes them.

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

**Archived 2026-11-26 entries:** [Chronological release notes](docs/archive/PROJECT_LEDGER_updates_2026-11-26.md). All original entries are preserved in that archive; the latest decisions remain below.

**Earlier releases (Nov 27):** [Mortgage/payment reconciliation and card-calendar releases archived verbatim](docs/archive/PROJECT_LEDGER_2026-11-27_early_releases.md). Subsequent decisions follow.

**Earlier 2026-11-27 decisions:** [Initial Amazon/AI design and categorization agreements, archived verbatim](docs/archive/PROJECT_LEDGER_2026-11-27_initial_ai_and_amazon_decisions.md).

**Earlier 2026-11-27 category / Amazon cloud research:** [archived verbatim](docs/archive/PROJECT_LEDGER_2026-11-27_early_amazon_notes.md).

**Earlier 2026-11-27 TinyFish initial setup and release notes:** [archived verbatim](docs/archive/PROJECT_LEDGER_2026-11-27_tinyfish_early_setup.md).

### 2026-11-27 — Full Amazon cloud lifecycle containment audit (implementation under review)

**Findings:** Existing behavior could re-try failed paid runs, mistake blank reports for success, use a changed default TinyProfile, or import older/unrelated charges on enable. Earlier run payload included fields not supported by published TinyFish Agent request schema.
**Changes:** New-charge baseline, 1/Pacific-day + 13/rolling-30-day run starts, pinned verified TinyProfile ID, documented Agent request only with mandatory 45-step beta cap, exact reserved charge-only reconciliation, complete signed-in report requirement, no speculative Possible Notes/categories, no changes to Plaid facts, and pause-after-failure with visible reason. Active run blocks key changes; disabling stops future jobs. The owner UI shows short status and expandable troubleshooting.
**Checks/deployment:** PR/source checks pending. Fictional mock tests cover limits, isolation, bad report handling and setup; no provider browser run, secrets, real transactions or Render infrastructure touched. Actual Amazon profile extraction and private Render SHA remain unverified.

### 2026-11-27 — Verified contained TinyFish sync release and corrected API assumptions

**Merged:** [PR #825](https://github.com/markbobthomas/household-ledger/pull/825), `d83c270a30040df261da5e6488f727ae90f5062a`. Safe first-enable baseline; 1 agent launch/Pacific day + 13 launches/rolling 30 days; only exact reserved target charge matches; no possible-product guess; pause on provider/incomplete/blank/no-match failure; active-run key-change guard; status and troubleshooting collapse.
**API correction:** Official TinyFish Agent request lists neither `session_id` nor a non-beta `mode`; these were removed. Setup verifies default TinyProfile via read-only `GET /v1/profiles` instead of wallet (can fail on legacy billing), pins its ID, and retains beta-gated 45-step cap rather than running uncapped.
**Checks:** [Banking/forecast CI #46039607395](https://github.com/markbobthomas/household-ledger/actions/runs/46039607395) and [Chromium/iPhone WebKit #46039607409](https://github.com/markbobthomas/household-ledger/actions/runs/46039607409) passed on `c76cb6487ba07a4f337c10b6aa562a9b755491ec`. Fictional bad-report, exact-import, auth and bank immutability regressions passed.
**Limit:** Private Render production deployment, actual signed-in Amazon extraction and 45-step performance for high purchase volume remain unverified; manual ZIP fallback persists. No live provider run, private bank edit, secret or infrastructure change.

### 2026-11-27 — Correct TinyFish setup for the visible Agent Playground

**Correction:** User sees “What do you want your agent to do?” rather than a TinyProfiles menu. TinyFish's current [illustrated official guide](https://docs.tinyfish.ai/agent/how-to/create-google-form-with-profile) links directly to [saved profiles](https://agent.tinyfish.ai/profiles) and uses Create profile → Next → Open a browser and sign in → Save. The Agent prompt alone cannot persist the Amazon sign-in Ledger's API requires.
**Changes:** Revised on-page nine-step help, direct profile/API-key links, explicit “do not Run an agent” notice, unavailable-feature explanation, and linked manual ZIP/CSV fallback; synced [setup guide](docs/AMAZON_CLOUD_SETUP.md) and browser checks. No backend, cost-policy, banking or credentials altered.
**Release:** Feature PR and banking/desktop/iPhone checks pending; deployment remains unverified.

### 2026-11-27 — TinyFish Agent Playground help correction merged

**Merged:** [PR #827](https://github.com/markbobthomas/household-ledger/pull/827) as `8417a70bd353c8919daf57d852648f91088c68be`. Ledger now recognizes the actual “What do you want your agent to do?” screen as Agent Playground, gives a verified direct [saved-profiles URL](https://agent.tinyfish.ai/profiles), current Create profile → Next → Open a browser and sign in → Save actions, and the direct API Keys/Connect/Enable sequence. Unavailable profiles show a stop-and-manual-import fallback rather than a paid Agent prompt.
**Checks:** [Banking CI #46103278446](https://github.com/markbobthomas/household-ledger/actions/runs/46103278446) and [desktop/iPhone CI #46103278447](https://github.com/markbobthomas/household-ledger/actions/runs/46103278447) passed on `b11524cb071d9820e0a0172c202140b4c8b02c7a`. No TinyFish runs, credentials, bank data or backend behavior changed. Private production Render and owner profile availability unverified.

### 2026-11-27 — TinyFish Amazon 400 request validator correction (implementation in review)

**Symptom:** Owner's Ledger reports a new unmatched Amazon charge and paused `TinyFish declined ... (400)` while TinyFish shows an API access. Connected TinyFish profile shows Amazon sign-in; no accepted recent Agent run. **Root-cause code defect found:** `output_schema` uses JSON Schema type array for nullable integer, explicitly unsupported by TinyFish; the API can record the access without starting the Agent.
**Change:** Use the published `nullable:true` schema form; add tests that reject any `type` arrays and require clean provider 400/INVALID_INPUT details with safely redacted keys and request correlation ID. Leave all step-cost limits, paused state, matching, source-bank records and schedule unchanged.
**Verification:** Source PR under test, no live paid run or private state edit, no direct production Render verification. After deployed revision the owner may explicitly re-enable following review; no automatic retry.

### 2026-11-27 — TinyFish rejected-schema fix merged after all safety gates

**Merged:** [PR #829](https://github.com/markbobthomas/household-ledger/pull/829), `701bb23134744f9cb9936af9dd521a37e57e2326`. Root-cause request defect: `output_schema` union type array for nullable integer, expressly rejected HTTP 400 under TinyFish's structured-output validator; changed to `type:'integer',nullable:true`. Enhanced owner-visible redacted provider error code/reason/request ID without exposing API keys or auto-retrying a rejected charge.
**Verified:** [Bank/forecast #46105357935](https://github.com/markbobthomas/household-ledger/actions/runs/46105357935) and [Chromium/iPhone #46105357939](https://github.com/markbobthomas/household-ledger/actions/runs/46105357939) passed on `338b1552465bf1fb30df3c64f59ffebdf90a4859`. TinyFish shows saved Amazon profile but zero recent accepted Agent runs; no user credentials, bank data, paid job or live Render state changed.
**Remaining:** Exact private provider rejection body and private Render live SHA cannot be confirmed; after deploy owner must explicitly re-enable. Beta-gated 45-step limit remains fail-closed and may require provider enablement.

### 2026-11-27 — Explain beta-only TinyFish Agent step limits without unsafe fallback

**Finding:** After fixing the output schema, the provider rejected `agent_config.max_steps:45` because it is beta-only. TinyFish documents `max_duration_seconds` as generally available but not a monetary cap; without the beta limit the default is 150 steps, about $2.40 of agent charges at the observed price before browser time. No risk-free <$1 replacement confirmed.
**UI/help change:** On the existing Amazon owner page, detect this paused reason and show direct [TinyFish beta enrollment](https://agent.tinyfish.ai/beta), the exact permission name, and a manual ZIP/CSV fallback. Keep automatic launch OFF, 45-step guard intact, no paid probe or stored-key changes. Update setup guide and browser regression.
**Status:** PR tests/merge pending. Private Render production deploy and live accepting run not verified.

### 2026-11-27 — TinyFish beta step-limit guidance merged after safety checks

**Merged:** [PR #831](https://github.com/markbobthomas/household-ledger/pull/831) `f0b9e67caa57f42de6693f40e0793d21a598352a`. Ledger keeps the 45-step fail-closed guard rather than incur standard 150-step charges, and displays actionable beta enrollment, exact feature name, and manual import fallback only on the matching paused error.
**Verified:** Banking/forecast [#46106182969](https://github.com/markbobthomas/household-ledger/actions/runs/46106182969) and desktop/iPhone [#46106182864](https://github.com/markbobthomas/household-ledger/actions/runs/46106182864) both passed on `8c74fcfa736c88a93110c54978b619da92fa67f0`. Fictional UI test confirms no paid run while paused. No credentials, bank values, provider jobs or hosting were changed.
**Remaining:** Owner must ask TinyFish to enable `agent_config.max_steps`; live Render SHA and real Amazon execution unverified. Manual ZIP remains usable.

### 2026-11-27 — Non-beta TinyFish alternatives and cost-policy clarification (discussion only)

- **Outcome:** Reviewed non-beta Amazon sync options against `main` `878f52e9f9b63fa2abb9ebdfeadd26e70993b06c`, PRs #831/#832, `pilot/amazon-cloud.cjs`, owner setup guide and deployment docs. No application code change. Beta enrollment is no longer the recommended next action; the existing guard remains until a replacement policy is selected.
- **Simplest option:** Standard TinyAgent, omitting beta-only `max_steps`/`mode`, retaining the 600-second duration bound and existing new-charge, one-per-day, rolling-launch and pause-on-failure controls. [Official limits](https://docs.tinyfish.ai/tinyagent/explanation/agent-modes) confirm the default maximum of 150 steps. [Published pricing](https://www.tinyfish.ai/pricing) models 150 x $0.016 + 10 x $0.002 = $2.42/run; 13 runs = $31.46, or five = $12.10 per rolling 30 days if deliberately reduced. These are conditional cost models, not guaranteed provider dollar caps or measured typical usage; AI categorization is separate.
- **Optional monitoring:** [Run status and cancellation](https://docs.tinyfish.ai/tinyagent/api/runs) allow an external step watcher and stop request. Telemetry delay, cancellation latency and controller failure mean this is best-effort protection, not a replacement guarantee for a provider-side 45-step limit. A small wallet also is not a run cap: provider pricing says an underway Agent run can finish after the wallet reaches zero.
- **Lower-cost development alternative:** [TinyBrowser](https://docs.tinyfish.ai/tinybrowser/reference) is generally available and billed by browser minutes (ten minutes models to $0.02). Direct sessions are isolated; its documented create request does not take `profile_id`. Reusable Amazon login, a fixed extractor, layout-change handling and explicit termination need separate implementation/validation. Its `timeout_seconds` is an inactivity timeout, not a total-runtime or spending guarantee.
- **Checks/status:** [Documentation PR #833](https://github.com/markbobthomas/household-ledger/pull/833). Cross-checked official documentation, read-only rate metadata and source; cost arithmetic and diff/history/privacy review passed. [Docs-aware CI #46107079287](https://github.com/markbobthomas/household-ledger/actions/runs/46107079287) passed on `a1f57f70b268663bc1ad9c90caeb0a6b9346a433`, correctly skipping browser execution; Markdown-only changes do not require runtime banking/browser suites. No paid browser run, beta request, wallet setting, stored login, bank record, application setting or Render infrastructure changed. Only the fictional Render test service is visible through the connection; private production SHA/live Amazon extraction and Pages remain unverified. Follow up after choosing a non-beta policy; no automatic paid test is authorized by this discussion.


**2026-11-27 — Non-beta Agent code change:** On branch `fix/tinyfish-standard-agent-2035`, removed the beta-only Agent step setting, retained the 10-minute timeout, updated cost modeling, on-page setup, documentation and fictional run assertions; supersedes the #831 beta-access instructions. The 13/30-day limit is a count of starts, **not** a guaranteed spending ceiling. This is source only pending CI/merge; live private Render SHA and Amazon extraction remain unverified. No paid TinyFish call was initiated.

**2026-11-27 — Post-merge verification:** PR #834 is confirmed merged; final banking/forecast and desktop/iPhone GitHub checks succeeded. The Render connector has no selected workspace, so the existing private live deployment/revision was **not verified**. No banking credentials, live data or provider run touched. Public Pages and provider extraction results also remain unverified.

### 2026-11-27 — Amazon run duration and report quality investigation (docs only)

Observed a completed signed-in TinyFish run that took several minutes and used fewer than the Agent's default 150 steps; no second paid run was initiated. Provider declared completion, but numerous item-level prices were nonpositive, which violates the strict Ledger cloud import schema and requires the fail-closed `invalid-report` outcome. The server polls every three minutes; the Amazon owner page does not auto-refresh status, so 'in progress' can persist until reload. No runtime changes, no private transaction details recorded. Private Render status and owner UI outcome are not independently verified. Follow-up only on explicit request: redesign extraction for valid per-item prices and improve progress display without weakening exact matching or retry controls.

### 2026-11-27 — Owner-confirmed Amazon run failure (investigation only)

The on-page status confirms the first standard Agent run was recorded and Ledger paused due to invalid returned item prices, with the daily no-repeat limit working. Examined current cloud parser, order-price matcher, and server fail-closed path: incomplete/unverified item rows are rejected before application and do not mutate bank transactions. Recommend fixing extraction accuracy and enforcing exact-match-only acceptance, not relaxing amount checks or retrying at cost without changes. No app/runtime code, paid provider action or bank data change in this task; no regression tests required for docs-only investigation. Private Render deployment remains unverified.

### 2026-11-27 — Amazon partial-price and prior-run recovery source fix (checks pending)

Improved the cloud Agent prompt and nullable item-price schema after an actual completed report contained many zero prices and out-of-window orders. The parser now excludes unpriced *order groups* but can retain uniquely verified priced orders; ambiguous price/date overlaps fail closed. Per-target scan markers are written only for exact matches; incomplete reports pause scheduled work. The owner can recheck a recent previously completed run from the same saved profile through read-only TinyFish run retrieval without launching a new paid Agent, while keeping authorization and bank-source immutability. Client run status refreshes while active. Source/tests/docs staged for CI on `fix/tinyfish-unpriced-order-replay-20261127`; no provider run or live bank write, private Render deployment unverified.

**2026-11-27 — Post-merge verification:** Verified #838 merged, core CI and desktop/iPhone browser CI successful. No paid TinyFish run started by the change, no credentials, live bank records, or private Render infrastructure touched. The connected Render account has no confirmed selected workspace; existing private Render deployment and `/healthz` SHA remain **unverified**, not claimed live. Only a read-only owner-triggered recheck after verified deployment can establish whether the prior provider result contains a safe exact match; ambiguity still fails closed.

### 2026-11-27 — Order-level verified Note recovery for incomplete Amazon receipts (checks pending)

Owner reports no unambiguous priced-order match after free replay. Read-only inspection of the previously completed provider result found a subset of unpriced orders with consistent positive order totals. New source supports single-shipment, unique exact-total + close-date **Notes only**, with explicit competition/duplicate/unknown-total guards. Item allocations and automatic categories remain forbidden for this source, preserving all bank originals and paid-run caps. Fictional unit/replay regressions and docs added, release still under tests; private Render and any actual live matching unverified.

### 2026-11-27 — Completed order-total Notes recovery release and live verification boundary

[PR #840](https://github.com/markbobthomas/household-ledger/pull/840) merged; core banking/forecast and desktop Chromium/iPhone suites green on the final source. The owner-approved prior run was read only, not rerun. New match requires unique same-shipment order total and posted bank charge with no competing historical charge/order; preserves item-level price uncertainty and prohibits auto-categorization. Compact handoff archived superseded current-state snapshots verbatim. Only the Render sandbox test service was visible to the connected workspace, so the **private live deployment remains unverified**. The owner may recheck the stored completed result after deployment; no claim that this particular charge matched.

### 2026-11-27 — Practical manual confirmation for still-unmatched Amazon charges (implementation under review)

Owner reported no safely verified match after the fixed read-only replay. Rather than weakening price/date matching or charging for more browsing, added a collapsed owner-only order-candidate review sourced from the previously completed TinyFish result. User selection must explicitly confirm products; the write is Note + owner evidence/scan marker only, never Plaid or category. Empty/unknown candidates keep the manual ZIP fallback. Banking, browser and source CI are pending on the feature branch; no provider Agent run, live bank change or infrastructure modification was made.

### 2026-11-27 — Owner confirmation release verified on GitHub; private deployment not independently confirmed

[PR #842](https://github.com/markbobthomas/household-ledger/pull/842) merged, with core banking/forecast and desktop Chromium/iPhone tests green. Source confirms owner-only previous-run candidate GET and explicit Note/evidence-only POST; no live Amazon Agent started, source bank rows unchanged, no category or item-cost inference. This avoids repeating futile free replays for absent details. Existing Render connection shows only a test sandbox, not the private production service; production `/healthz` SHA and an actual owner-selected product Note remain unverified. The owner can review the remaining charge in Ledger after private deploy and must personally confirm the matching product.
