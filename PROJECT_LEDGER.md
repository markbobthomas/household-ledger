# Household Ledger — persistent project ledger

**Updated:** 2026-10-22 (Pacific)  
**Repository:** https://github.com/markbobthomas/household-ledger  
**Working instructions:** [AGENTS.md](AGENTS.md)

This file is the continuity record for future ChatGPT conversations. **Read it first, and append a concise entry after every Household Ledger user request, even discussion-only requests.** Keep the snapshot up to date; preserve earlier log entries.

## Mission and product direction

Household Ledger is a **calendar-first checking-account balance forecaster**, not a traditional budget tracker. It should answer: what will the main checking account balance be on each future day, which major deposits/withdrawals are included, and when might funds run low?

Product priorities:
- A clear daily calendar showing predicted ending balance and dated predictions.
- High confidence that income, housing payments, card payments, utilities, insurance and other major recurring items occur in each applicable month of a 30/60/90-day view.
- Simple, consistent inline editing of individual predicted payments and recurring schedules. Minimize screen-hopping, duplicate lists, unnecessary controls and multi-step workflows.
- Explicit separation of actual posted bank activity from future predictions. Show uncertain patterns for review instead of inventing payments or offering unwarranted certainty.
- A single canonical future ledger driving all account-balance math. Reconcile predicted-to-posted transactions and transfers without double counting.

**Scheduling decision:** Change **one** dated future payment or **all future** payments of a schedule. The arbitrary partial date-range/batch scheduling option was removed by explicit request. Preexisting stored range settings may need safe backward compatibility, not a new creation UI.

**Recurring decision:** Detect recurring items using their account, direction, merchant/identity and timing, not an identical amount requirement. Variable bill amounts and timing differences should not cause duplicates. Two alternating biweekly income amounts can be two independent four-week schedules offset by fourteen days, even with the same payer.

**Banking safety:** Preserve the current GitHub, Plaid and private Render architecture. Actual source transactions/balances remain authoritative and unchanged by editable predictions. Do not use public fictional Demo data as if it were real bank data. This repository is public: do not put actual financial records, private amounts, authentication details, or private user messages in this ledger.

## Current state (as verified October 22, 2026)

- GitHub repo: `markbobthomas/household-ledger`; default branch `main`.
- [PR #30](https://github.com/markbobthomas/household-ledger/pull/30) **merged**: shared expandable editing rows across Calendar, Schedules and Predictions; day selection no longer creates a second, competing editing list.
- [PR #31](https://github.com/markbobthomas/household-ledger/pull/31) **merged**: remove new partial-range schedule estimates; edit one payment or all future payments, while protecting existing saved overrides.
- [PR #34](https://github.com/markbobthomas/household-ledger/pull/34) **merged** as `495b930720ad88750f99f0ccc1dbe5c896613aee`: schedule-aware historical actions and safer history-to-schedule saves; the monthly list now says **Upcoming predictions** with remaining dates and account.
- Latest validated application merge: `495b930720ad88750f99f0ccc1dbe5c896613aee`. Always re-check `main` rather than treating this as permanent.
- **PR #34 required checks passed** on head `f368657ec9844209cb8b5123628393652920418e`: GitHub Actions Real-account pilot safety checks and Browser interaction test (desktop Chromium/iPhone WebKit). They establish tested repository behavior, not live private Render deployment.
- GitHub Pages publication for PR #34 merge: **not yet independently verified**; check post-merge Pages workflow.
- Private Render's running deployment SHA has **not** been independently confirmed here. A GitHub merge or Pages publish does not establish the private server's deployed revision. See [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md).
- Requested items #1 and #2 are merged. Item #3 remains **assessment only**; do not implement new coverage logic until explicitly requested.

## UI/forecast follow-ups (2026-10-22)

- **Implemented and merged — schedule-aware history buttons:** Shared `historicalScheduleMatches` uses linked bank IDs first (even after provider classification/description changes), then account, direction, merchant aliases and unambiguous payroll phase without matching exact amounts. Calendar/History now open an existing schedule or require selection if ambiguous. Historical save guard blocks conflicting duplicate creation from already linked bank entries. Truly independent same-payee schedules remain explicitly possible.
- **Implemented and merged — monthly list wording:** “Upcoming predictions” shows the chosen account, remaining future forecast dates, and excludes already-posted bank history. It does not change the balance computation.
- **Unverified private forecast coverage:** A short list might simply reflect the remaining days of the month or selected account, but could also expose an omitted recurring bill. The public code and a user-provided screenshot cannot establish which saved private schedules exist or whether Render has the same revision. Verify privately and safely by comparing saved schedule identifiers against canonical future-ledger events and posted-cycle reconciliation; no account data in GitHub.

## Historical decisions / why the app looks this way

**Oct 15–18 — foundational app:** Early versions emphasized budgets, spending categorization and a synthetic recurrence/accuracy laboratory. Those experiments are preserved in the repo but are not the current product goal. Synthetic tests show algorithm behavior, not proven real-bank forecast accuracy.

**Oct 19 — simplify:** User chose to preserve integrations and styling while effectively restarting the UI as an automatic main-checking balance planner. Existing backup branches are described in [README.md](README.md).

**Oct 19–20 — missing essential payments:** Clear regular housing payments were not always predicted. The user requested better recurring detection, the ability to designate any historical bank transaction as recurring, and a Reviews surface for uncertain matches. A confirmed schedule must supersede a duplicate automatic pattern. Editing a prediction must never change source bank records.

**Oct 20–21 — reconciliation issues:** Variable utility payments were being counted twice when amounts differed from actual charges. Alternating biweekly pay amounts should be represented as independent schedules rather than merged by employer. Manual links to relevant historical transactions and persistent overrides should improve predictions over time.

**Oct 21–22 — useful coverage, simpler editing:** An earlier summary sometimes failed to identify already predicted major payments. The user wanted a calendar where each day displays its projected balance and expected transactions. Navigation and editors were too complex; unified expandable rows and one-or-all schedule editing were requested and merged as PR #30 and #31.

## Source of truth / engineering guide

Read the current source before making changes; old docs sometimes describe superseded screens.

- [README.md](README.md): canonical future ledger and current main architecture.
- `planner-core.js`: prediction analysis, materialization, daily projection.
- `planner-transactions.js`: confirmed schedules, one-off entries, individual exceptions.
- `planner.js`, `planner-summary.js`, `planner.css`: current UI and transaction editors.
- `planner-history.js`: historical actual transaction interactions.
- `payment-obligations.js`: card statement / settlement handling.
- `pilot/server.cjs`, `pilot/data-source.js`: existing private authenticated Plaid/backend design.
- [ACCOUNTING_MODEL.md](ACCOUNTING_MODEL.md): reconciliation safeguards.
- [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md): separate GitHub, Pages and private Render checks.
- [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md): older phase background, not necessarily current app scope.

Engineering workflow: inspect `main`, work on branch/PR, validate banking safety and desktop/iPhone interactions for functional edits, merge passing work, independently verify deployment if available, and update this ledger in the same task.

## Running task log (append at end for each prompt)

Use: **date — goal; decision; changes (or “no code change”); PR/commit; checks; deployment; next action.** Keep only non-sensitive decisions. Do not paste raw prompts. Don't erase earlier entries. If GitHub writes are unavailable, plainly report that the ledger couldn't be updated.

### 2026-10-22 — create cross-chat project memory

- **Goal:** Keep project intent and progress accessible even when a ChatGPT conversation becomes too long.
- **Decision:** This single ledger is the canonical project handoff; [AGENTS.md](AGENTS.md) instructs each subsequent chat to read and update it **for every project prompt**, including product discussion.
- **Changes:** Add two documentation files on a focused branch; no runtime or prediction code changes.
- **Validation:** Docs only. Do not imply that banking/browser tests were re-run.
- **Deployment:** No private Render deployment claimed.
- **Next:** Continue from current `main` and append the next task outcome here.


### 2026-10-22 — explain historical calendar recurrence buttons and two-entry monthly forecast

- **Goal:** Determine why two already scheduled posted utility transactions offer “Make recurring,” and why the October monthly transaction list contains only two items.
- **Findings:** Calendar historical row actions are hardcoded in `planner-summary.js:postedDay()`, unlike History's partial linked-rule lookup; History's exact-amount requirement can miss variable charges. The monthly list counts only projected, future-dated events for the chosen account (starting at the source as-of date), while prior October bank postings are displayed separately as actuals. A small future list alone does not prove incorrect forecasting.
- **Decision:** Explain the distinction, recommend stable schedule-aware historical actions and a clearer **Upcoming predictions** label; investigate possible missing scheduled future events only with private/authorized forecast data.
- **Changes:** Documentation only; no runtime, forecast or bank-state modifications. No new recurring schedule was created.
- **Verification:** Read `main` versions of `planner-summary.js`, `planner.js`, `planner-transactions.js` and `PROJECT_LEDGER.md`; private Render deployment and private recurring-rule data unavailable for verification. No browser or banking tests run for this docs change.
- **Next action:** With explicit request to fix, implement guarded schedule-aware buttons, forecast-range labeling, and browser regressions; validate on fictional fixtures and separately verify Render.


### 2026-10-22 — safe historical schedule actions; clearer upcoming predictions; coverage design assessment

- **Goal:** Prevent the Calendar and History screens from offering duplicate recurring plans for payments already covered by a schedule; clarify month counts; assess a simpler approach to major-payment coverage without introducing another inference system.
- **Decision:** Both historical surfaces should use one shared schedule-identity lookup. First trust explicit bank transaction links (even after provider renames/type changes), then check account/cash direction and saved merchant aliases, **never an exact dollar amount**. A uniquely matched payment opens its existing schedule; several plausible matches require a choice; an unmatched payment may be planned. Stale historical forms must refuse to create a second plan when the source is already linked. Deliberately separate schedules remain possible for independent bills/paycheck phases.
- **Code (PR [#34](https://github.com/markbobthomas/household-ledger/pull/34)):** \`planner-transactions.js\` shared \`historicalScheduleMatches\` + protected \`defineRecurring\`; \`planner.js\` Calendar/History click routing and selection dialog; \`planner-summary.js\` posted-day button and renamed **Upcoming predictions** list with remaining forecast dates, account and posted-history distinction; \`index.html\` script cache refresh. No provider/source-data mutation or forecast math change.
- **Regression tests:** Variable utility amounts, bank-record renames/reclassification, duplicate prevention for stale forms, independent same-payee four-week payroll, ambiguous schedule choice, and a History reopen flow. **Both required PR checks passed**: private pilot safety and desktop Chromium/iPhone WebKit browser workflow on `f368657ec9844209cb8b5123628393652920418e`. PR #34 was merged at `495b930720ad88750f99f0ccc1dbe5c896613aee`. These checks do not verify private Render.
- **Coverage (#3) — recommendation only, NOT implemented:** Replace several overlapping heuristic mortgage/category/coverage checks with a **user-confirmed Essential payments roster** sourced from existing saved schedules (not an independent detector). Show a simple month-by-month status for each confirmed commitment: **Already posted / Upcoming in forecast / Skipped or not due / Needs attention** using its actual schedule ID and bank links. Surface uncertainty when matching ambiguous, never mark it verified or invent new transactions. Onboarding can suggest likely major items from history once, but the user confirms each commitment; the ongoing assurance derives only from confirmed plans and canonical ledger entries. Hide or retire competing heuristic coverage summaries after validating this replacement, only with explicit user approval.
- **Deployment:** GitHub commit/PR is distinct from GitHub Pages and the private Render service; check them separately. No private Render verification claimed.
- **Next:** If requested, design a single compact Essential payments roster and inspect which existing coverage panels can be removed, without adding forecast transactions automatically.


### 2026-10-22 — selected-day editing with optional month disclosure

- **Goal:** Make the calendar easier to scan by showing only predictions for the selected date, while keeping the rest of the month available on demand.
- **Decision:** Keep the calendar as the primary navigator. The selected-day balance panel includes that day's editable predicted payments. The month-wide list starts **collapsed** behind a plain "See all [month] predictions" disclosure, and opens when requested. Changing days re-focuses the selected day; do not auto-scroll down to a long list.
- **Changes:** `planner-summary.js` shares one payment-row renderer between daily and monthly views (both use the **same canonical forecast identities**); protects dirty inline edits when changing dates; `planner.css` styles compact day rows; `index.html` changes static asset cache keys; `tests/planner-browser.cjs` covers optional month disclosure and selected-day inline edits on desktop Chromium and iPhone WebKit.
- **Safety:** This is UI-only; no new forecasts, calculations, recurrence rules, bank updates, or saved preference modifications. Historical posted-day actions remain separate and unchanged. Important unconfigured-card warnings remain visible **outside** the collapsed month list, preserving existing payment warnings.
- **Verification:** PR [#35](https://github.com/markbobthomas/household-ledger/pull/35) passed the required **Browser interaction test** (desktop Chromium + iPhone WebKit and related browser regressions) and **Real-account pilot safety checks** on head `c03d1e65f53fc94cee836d55cabb4b16ceb967ee` on October 22, 2026. Both checks completed successfully. The PR was merged into `main` at `ed95239511b16b706afa28676efc34d874590106`. Earlier failing intermediate test runs were updated to reflect intentional collapsed-list navigation and to keep missing-card warnings visible; the final checks passed.
- **Deployment:** Merge verified on GitHub; GitHub Pages and private Render deployment are independent. Private Render `/healthz` could not be accessed from this session, so running private revision remains **unverified**. Do not claim this is live on Render until its actual deployed commit is confirmed.
- **Next:** Confirm the current private Render deployment commit before claiming live availability; further coverage UX remains out of scope unless requested.


### 2026-10-22 — one lowest balance over a fixed three-year window; retire major-payment checks

- **Goal:** Eliminate 30/60/90/120/180/360-day selectors, display one lowest modeled balance across a long/infinite-feeling period capped at three years, and remove the confusing Major Payments assurance UI until an understandable alternative is designed.
- **Product decision:** The Calendar and forecast use one fixed **1095-day (about three years)** modeled horizon. The header and Summary period selectors are gone; the Summary foreground shows one lowest amount and its date, which opens that day in Calendar. No month-by-month Major Payments checklist, coverage matrix, colored 'covered/missing' assurance status, or duplicate payment-review count is shown in Calendar. The optional graph is labeled a three-year illustration. An explicit caveat notes that future pay/bills vary and unscheduled everyday purchases are omitted, so the low value is **not** a guaranteed safe-to-spend minimum.
- **Technical change:** Extend fixed/inferred weekly recurring date generation and configured card autopay loops to the same long horizon, avoiding their prior 60/110/18-cycle truncations. Keep the single canonical bank-safe projection, independent schedules, individual overrides, read-only Plaid source transactions, and historical postings unchanged. Existing category and mortgage coverage implementations may remain in source for now but no longer render in the Calendar; **do not reintroduce that UI without user direction**.
- **Validation:** PR #36 passed its final two checks (pilot safety and desktop Chromium/iPhone WebKit browsers) and was merged on 2026-10-22 at `81979dc17bd6a2be807d578f7d7061f835b3c023`. The tests confirm code behavior on fixtures, not a private live deployment.
- **Follow-up decision (not implemented):** Reconsider essential-payment completeness as a small user-confirmed roster referencing **existing schedule IDs** and canonical prediction events, not a separate heuristic category/mortgage confidence engine. Do not add this yet.
- **Deployment:** GitHub merge, Pages publishing and private Render revision require independent verification. Never treat a green test as proof of the private banking deployment.


### 2026-10-22 — chart-only horizons and raw reported current

- **Goal:** Provide six independent Balance Trend views (10, 30, 90, 180, 360 days and 3 years) while showing the actual Plaid-reported current account balance directly beside the unchanged 3-year projected minimum.
- **Decision:** Trend selection is a view-only redraw of existing canonical daily balances. It cannot change forecast materialization, saved schedules, the selected Calendar day or the fixed three-year headline minimum. The trend defaults to three years when the Summary is freshly rendered. The current value comes exclusively from the read-only snapshot `account.current`, **not** `account.available`, the projection opening balance or guessed transactions. Missing `current` displays "Not reported"; Demo is labeled as sample data.
- **Files:** `planner-summary.js`, `planner.css`, `index.html`, and browser/smoke tests. No bank state writes or changes to the core forecasting engine.
- **Validation:** [PR #37](https://github.com/markbobthomas/household-ledger/pull/37) passed the required Real-account pilot safety and desktop Chromium/iPhone WebKit browser checks on head `97cf52caa944d9ad28914b077a3da89b547c83a0`, and was merged to `main` as `c76006b42768ef51d94df266cb9155a85837ac50`. Tests include current vs available bank balance and all six trend ranges; earlier test-only assertions were corrected before final success. Private Render deployment and GitHub Pages publication remain unverified.
- **Next:** Preserve distinction between bank-reported current, potentially different available cash, and forecast lows when improving balance explanations.

## Reusable new-chat prompt

> Continue Household Ledger. Read https://github.com/markbobthomas/household-ledger/blob/main/PROJECT_LEDGER.md and AGENTS.md first, inspect current GitHub main, then handle my request. Update the ledger in GitHub after **every prompt**, including discussions. Preserve the existing Plaid/Render setup and verify deployment before claiming it is live.
