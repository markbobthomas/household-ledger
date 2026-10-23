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

- GitHub repo: `markbobthomas/household-ledger`; default branch `main`. Development-resumption review baseline: `b9fc75928227c1661542ea8a4c8b91a14c0b9edb` (merged documentation PR #50).
- [PR #30](https://github.com/markbobthomas/household-ledger/pull/30) **merged**: shared expandable editing rows across Calendar, Schedules and Predictions; day selection no longer creates a second, competing editing list.
- [PR #31](https://github.com/markbobthomas/household-ledger/pull/31) **merged**: remove new partial-range schedule estimates; edit one payment or all future payments, while protecting existing saved overrides.
- [PR #34](https://github.com/markbobthomas/household-ledger/pull/34) **merged** as `495b930720ad88750f99f0ccc1dbe5c896613aee`: schedule-aware historical actions and safer history-to-schedule saves; the monthly list now says **Upcoming predictions** with remaining dates and account.
- Latest validated **functional** merge at this review: [PR #49](https://github.com/markbobthomas/household-ledger/pull/49), merged as `9babafba84b2ee1474b6fd234e56d59e39d38eb8` (Schedule calendar-month income totals). [PR #46](https://github.com/markbobthomas/household-ledger/pull/46), merged as `c05465ec51630d7fff16bd3f8efddaf9f7ed0462`, added inline schedule categories/search and posted-payment matching. Re-check `main` on every request.
- **PR #49 required checks passed** on head `2d7d811952ec39aafa5a5a4eabe1db45e7f7d5e4`: Real-account pilot safety and Browser interaction test (desktop Chromium/iPhone WebKit). These are GitHub test results, not independent proof of private Render deployment.
- GitHub Pages: **Publish Household Ledger** push workflow on reviewed baseline `b9fc75928227c1661542ea8a4c8b91a14c0b9edb` completed successfully (GitHub Actions run `39884872149`). Public-site content was not independently inspected; Pages success does not verify private Render.
- Private Render's running deployment SHA has **not** been independently confirmed here. A GitHub merge or Pages publish does not establish the private server's deployed revision. See [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md).
- Earlier recommended work items #1–#3 (one-tap schedule categories, live schedule search, posted-payment matching) were implemented and merged in PR #46. Do not reintroduce the retired heuristic major-payment assurance screen or unrelated budgeting modules.

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


### 2026-10-22 — site-wide navigation and redundancy reduction

- **Goal:** Inspect the full Household Ledger user interface for repeated totals, duplicated explanations, unnecessary controls and navigation. In particular, the selected Calendar day must show its ending balance **only once, at the bottom of the small balance calculation**.
- **Changes:** Calendar removes the duplicate day-heading balance, retains the single end-of-day math footer, presents one concise empty-day message, removes a redundant month-list "Expand" label, trims repetitive posted/pending wording, and renames the optional chart title "Balance trend" so it remains correct at 10-day through three-year scales. Schedule cards no longer repeat the merchant when title and merchant are identical or show meaningless three-year occurrence counts. The all-future/individual edit guidance is condensed while retaining both distinct controls. History removes a second overall count and compresses filtered count copy. Settings removes the separate "Recurring payment changes" shortcut and hides the "Not recurring" management panel when empty (while still exposing exclusions and restore buttons when present). The global header removes "New Foundation," redundant introduction text and an extra visible source label; its dropdown remains accessibility-labeled.
- **Preserved intentionally:** One canonical three-year forecast, raw Plaid current balance, card-payment warnings, optional all-month list, detailed all-predictions and Overview tools, real-bank history, account selection, recurrence rule identities, edits and saved-state behavior. No new forecasting, reconciliation or bank changes.
- **Verification:** PR #38 passed both required GitHub CI jobs on head `9f4b5311ce8f10e9098031a00e16e5c1ef309e08`: real-account pilot/banking-safety checks and desktop Chromium/iPhone WebKit browser regression tests (single closing balance, concise empty-day/disclosure UI, preserved inline editors, Settings navigation). Merged to `main` as `a2879dfdd9dd3e333b437e848d349611421fbb7f` on 2026-10-22. GitHub merge does not verify live Render or GitHub Pages publication.
- **Next:** Test with fictional data and merge on green CI; check private Render deployment independently. Future structural simplification of Overview and advanced tools should be evaluated with usage evidence rather than silently removing unique capabilities.


### 2026-10-22 — follow-up: closing balance as the last row of each day

- **Request:** Re-audit site-wide navigation and UI redundancies; user's specific requirement is one end-of-day balance at the **bottom of the entire daily transaction panel**, not a repeated number at the top and bottom.
- **Investigation:** PR #38 already removed the duplicated balance *heading*, but the day arithmetic panel still came before the transactions, and empty selected days repeated the same unchanged balance as both the starting and ending balance while showing zero deposit and withdrawal rows. Settings also duplicated forecast assumptions already explained on Calendar and used two panels for banking status.
- **UI changes:** `planner-summary.js` now renders the selected day's date, only meaningful arithmetic rows **if transactions exist**, editable payment list, add/edit actions, and exactly **one closing-balance footer as the final element**. Zero-transaction dates show one concise empty-day message and the closing balance, without an unnecessary identical opening number or zero sums. `planner.js` condenses Settings' bank connection status/actions into one section and omits the redundant planning-assumptions panel. `planner.css` defines the closing footer style and `index.html` refreshes asset cache keys.
- **Safety:** No changes to the forecast engine, bank current/available distinctions, stored recurrence or edit data, linked transfers or immutable source records. The bottom footer continues to use the identical canonical `point.balance` already shown in Calendar.
- **Verification:** [PR #39](https://github.com/markbobthomas/household-ledger/pull/39) passed its final required **Real-account pilot safety checks** and **desktop Chromium/iPhone WebKit browser interaction checks** on final head `21fcce630e20f3695dc0e426220b4bbd2c1125bc`; merged to `main` as `cdc48a3cac702f223ebca407b04cca950e0da417`. Interim regression runs uncovered outdated assertions expecting the former zero-value daily breakdown; the new suite tests empty dates, adding an actual predicted expense, and the one closing footer at the panel bottom. The forecast engine and Plaid data remain unchanged.
- **Deployment:** GitHub branch/PR validation is independent of the private Render deployment; do not claim live until commit is checked.


### 2026-10-22 — remove heuristic same-merchant section and number schedules

- **Request:** Reconsider the "Multiple payments to the same merchant" Schedules section and give each saved schedule an easy human-readable number starting with 1.
- **Decision:** Remove the same-day/same-merchant bank-history discovery panel and its "Create separate schedule" prompts; it is speculative and can encourage conflicting schedules when bank records have legitimate same-merchant repeats. Preserve the **actual safeguards** and independent saved schedule identities, the main **+ New schedule** action, History's schedule-aware editing, and each card's **+ Separate bill** option. Simplify the New Schedule heading.
- **Numbering:** Show a subdued numeric label **1, 2, 3…** on every schedule card, following the existing saved `futureRecurringRules` array order, and use the same reference in linked-schedule choices/edit dialogs. Labels are **view-only ordinals**. Existing canonical `rule.id` values and rules are unchanged. Numbers are deterministic across a refresh as long as saved order is unchanged, but **renumber after a schedule is removed or list order changes**; they are not permanent IDs. If immutable human references become necessary, that would require a separately approved persisted numbering design.
- **Code:** `planner.js` eliminates duplicate-detection UI, removes now-unreachable handler, adds an ID-to-ordinal display helper and schedule numbers to cards and linked choices. `planner.css` styles the identifiers; `index.html` refreshes browser asset versions; `tests/planner-browser.cjs` checks ordered consecutive numbers and two saved same-merchant plans remaining independent.
- **Safety:** No new bank writes, no changes to Plaid state, forecast arithmetic, recurring schedule creation logic, duplicate prevention or reconciliation. Remove only the heuristic *presentation*.
- **Verification and deployment:** [PR #40](https://github.com/markbobthomas/household-ledger/pull/40) passed both required GitHub checks on final head `c8cee1b5df2eed520e5bac87e07e1e9bf3cdc4a2`: **Real-account pilot banking-safety checks** and **Browser interaction test** (desktop Chromium and iPhone WebKit), including independent same-merchant payments and numbered schedule cards. Merged to `main` as `3201286e2cb7e80a19610bfd56a59e0be5a4404a`. Private Render deployment was not independently verified; do not claim live availability from the GitHub merge.


### 2026-10-22 — compact, single-row Schedule list

- **Request:** Fit substantially more schedules on the Schedules screen without losing editing, duplication, removal, or any other schedule function.
- **UI decision:** Replace stacked multi-line cards and 3 always-visible action buttons with a **one-column, dense list**. Each collapsed schedule has a single full-width clickable row displaying its existing 1-based list number, name, account/cadence, next date, amount, and estimated/fixed distinction; opening the row expands the same inline schedule editor and dated payment overrides as before. A separate keyboard- and touch-accessible **⋯** menu retains **+ Separate bill** and **Remove schedule**. Removing a schedule still requires the existing second confirmation and now offers explicit cancellation inside the menu. Display numbering continues to derive from saved rule order; internal rule IDs never change.
- **Safety:** No forecast, recurrence inference, Plaid source, bank balance, canonical prediction identity, account mapping, or saved financial preference calculations changed. Existing per-occurrence and all-future editor, historical date-range exceptions, independent same-merchant schedules, and double-count safeguards remain.
- **Files:** `planner.js`, `planner.css`, `index.html`, and `tests/planner-browser.cjs`. Tests check row height/density and single-column alignment on desktop and mobile, existing edit opening, separate-bill creation through More, and two-step remove/cancel without data loss.
- **Verification:** [PR #41](https://github.com/markbobthomas/household-ledger/pull/41) passed the required **Real-account pilot banking-safety checks** and **desktop Chromium/iPhone WebKit browser interaction checks** on final feature head `ede8249551b559df009c0a959b3dccca072fcc13`. The regression suite covered compact single-column row heights, schedule numbering, inline edits, independent same-merchant payments, separate-bill creation via More and two-step removal with cancel. Merged into `main` as `1ad3447286acc0a83011df624e270ae4f113ff94`. The private Render deployment remains **unverified**, so a GitHub merge is not proof this UI is live.


### 2026-10-22 — schedule categories, amount sorting, filtering and category totals

- **Request:** Sort compact Schedule rows by value or category, assign a category to every schedule (e.g. Subscription, Insurance, Utility, Mortgage), add categories directly on the Schedules page, show category totals when grouped, and ensure the category **persists on every predicted transaction generated by that schedule**.
- **Decision:** Keep saved-order numbering as before, even when sorted/grouped. Add compact Sort (original, amount descending/ascending, category), Show category filter and inline **+ Category** input. Predefined categories include Uncategorized, Mortgage, Rent, Utility, Insurance, Subscription, Loan, Transportation, Healthcare, Childcare, Groceries, Tax, Income, Savings, Transfer and Other. Custom categories live in the **encrypted forecast preference data** as `predictions.scheduleCategories` (not historical bank categories or a new database); capped and validated. Legacy schedules are shown as **Uncategorized** until assigned; future edits preserve assigned values. Category is editable alongside the schedule defaults. Explicit duplicate/split schedule creation carries its category.
- **Canonical data requirement:** `planner-transactions.js` stores a validated `category` in every saved `futureRecurringRules` rule and copies it to every generated event or transfer. `planner-core.js` carries that field through every derived projected account event, including both sides of linked transfers; individual dated edits preserve the category without changing bank history. Category groups show **average monthly forecast outflows, deposits, and transfers separately** from canonical, dated ledger events in the next 365 days, divided by 12, rather than misleadingly summing weekly and monthly face values or double-counting transfers. Value sort follows the next visible payment amount (not an unrelated total).
- **Safety:** All category edits are forecast metadata only. Do not write categories back to Plaid or historical transactions, change balances, create extra schedules, or change existing double-count/reconciliation rules. Category creation does not rerender or discard an unsaved schedule editor; changing sort/filter prompts before dropping unsaved edits.
- **Code/tests:** `planner.js`, `planner-transactions.js`, `planner-core.js`, `planner.css`, `index.html`, browser regression tests and `tests/planner-schedule-categories-smoke.cjs`, required in both banking and browser CI. Synthetic fixtures verify saved categories, category propagation into dated ledger/daily projection, transfer legs and individual overrides, amount sorting, custom category creation and correct group totals.
- **Verification/deployment:** [PR #42](https://github.com/markbobthomas/household-ledger/pull/42) passed both required checks on final head `3f51c974ca2b60e538a9187e4d57b54b33842e73`: Real-account pilot banking-safety checks (including category propagation into dated predictions and transfers) and the desktop Chromium/iPhone WebKit browser interaction suite (category creation, amount sorting/filtering, grouped monthly totals and schedule editing). Merged to `main` as `e04a5cfc19ede9f7545bdf425162d82bf4126d13`. Private Render deployment remains **unverified**, so do not claim the private banking site is updated.


### 2026-10-22 — next simplification priorities (design discussion; no app code change)

- **Request:** Recommend next Household Ledger product improvements after shipping compact categorized, sortable Schedules and three-year calendar-first forecast.
- **Assessment grounded in `main`:** The Schedules page already supports category sort/filter and custom category creation, but assigning a category still requires opening the full schedule form. The compact list lacks a text search. `planner-transactions.js` and `planner-core.js` contain the actual/forecast posted-coverage reconciliation and identity protections, which remain worth testing against variable bills and alternating paychecks. The earlier heuristic "Major Payments" assurance panel was deliberately retired; it should **not** be reintroduced under another name. The deployment-version menu text and prior ledger entries are not proof that private Render has the current commit.
- **Prioritized recommendations (not implemented):** (1) One-tap category picker directly on compact schedule rows, plus an explicit Uncategorized focus/filter, preserving category propagation to all future occurrences; (2) lightweight schedule search by name/merchant/category with no new navigation screen; (3) strengthen posted bank-actual to predicted-occurrence reconciliation and only surface actionable ambiguous matches, preserving independent same-payee streams and nonduplicated balances; (4) if needed later, a minimal **schedule-based due-date gap alert** driven solely by owner-confirmed schedule IDs and canonical future ledger (never a separate mortgage/merchant guessing engine or broad checklist); (5) establish and expose the **actual private Render deployed revision**, since GitHub merges/tests do not independently confirm what users see.
- **Guardrails:** No new budgeting modules, opaque major-payment coverage matrices, notifications, extra tabs or automatic category assignments. Avoid user-visible false confidence in the three-year minimum; it is based only on currently modeled future transactions.
- **Work/checks:** Review/discussion only; **no app or financial data changes** and no new functional tests required. Document-only PR and merge status to be recorded once complete. Private Render deployment remains **unverified**.

### 2026-10-22 — quick categories, instant schedule search and posted-payment matching

- **Request:** Implement the first three recommended priorities: (1) one-tap category assignment directly from compact schedule rows plus Uncategorized filtering, (2) fast schedule search by schedule title/merchant/category, and (3) more reliable matching of posted bank payments to already confirmed predictions while preserving independent same-merchant streams.
- **UX:** Each compact row has a native category picker with automatic save through existing private forecast-preference persistence; no need to open the full editor. Search filters the existing Schedules list immediately without navigating or discarding unsaved form fields; category-group monthly totals update to the visible search results. Existing Uncategorized filter remains available. Sorted/category-filtered views and their original saved schedule numbering are preserved.
- **Bank-safety logic:** `postedCoverage` in `planner-transactions.js` honors explicitly linked bank transaction IDs, including Plaid merchant-description changes and variable amounts, before matching by verified merchant/account/cash direction and nearby date. Same-payee independent schedules are matched to a single bank posting only when clearly distinguishable; genuinely competing cases remain visible with an actionable **Choose matching schedule** option on the existing Needs Review screen. That choice links the posted bank ID to the chosen *existing* schedule only and recalculates the canonical forecast; it does **not** create a schedule, mutate the bank record or reclassify bank history. Distant same-month postings may not silently suppress another due date. `planner-core.js` exposes actionable ambiguous matches from canonical reconciliation, never a new general-purpose heuristic coverage panel.
- **Tests:** New `tests/planner-posted-matching-smoke.cjs` in both required CI jobs covers renamed Plaid merchants, explicitly linked IDs, variable amounts, pending/other-account safeguards, competing confirmed schedules, one-time choice and future occurrence retention. Existing Chromium/iPhone WebKit UI test gains row quick-category save/reload, instant search, and category subtotal recalculation checks. Forecast and Plaid data remain read-only.
- **Verification:** The first PR #44 was closed without merging because the intervening recommendations-only PR #43 caused a ledger merge conflict. The implementation was ported onto the latest `main` as [PR #46](https://github.com/markbobthomas/household-ledger/pull/46). Final head `8f2e3d906ecf7b73ae1618558b47d70dbef17f27` passed both required checks: **Real-account pilot banking-safety** (including renamed ACH, variable amount, early utility, independent same-payee payments, matched posted IDs and category persistence) and **Browser interaction test** (desktop Chromium and iPhone WebKit, row category edit/save/reload, quick search, live category totals and existing schedule editors). Several interim regressions were corrected before final green CI, including the missing demo custom-category restore. **Merged to `main`** as `c05465ec51630d7fff16bd3f8efddaf9f7ed0462`. The private Render deployed revision remains **unverified**; the GitHub merge is not proof the private banking site has deployed this commit.

## Reusable new-chat prompt

> Continue Household Ledger. Read https://github.com/markbobthomas/household-ledger/blob/main/PROJECT_LEDGER.md and AGENTS.md first, inspect current GitHub main, then handle my request. Update the ledger in GitHub after **every prompt**, including discussions. Preserve the existing Plaid/Render setup and verify deployment before claiming it is live.

### 2026-10-22 — correct income category totals using calendar-month deposits

- **Issue:** The Income category group showed an `In $X/mo` number calculated as a rolling 365-day average. This was mistaken for (and is not) the amount deposited in a specific month, especially with alternating paychecks every four weeks.
- **Resolution:** On the Schedules page, use the bank-safe canonical forecast ledger to show (1) the **next complete calendar month** and its exact sum, (2) the following **12 complete calendar months** and their sum, and (3) the distinctly labeled monthly average. Aggregate in integer cents to avoid accumulated rounding error. Use forecast event identities, preserving individual payment edits, account separation, and incoming/outgoing/internal transfer distinctions. When searching within category groups, recalculate totals using only matching visible schedules and the current snapshot date.
- **Regression:** [PR #49](https://github.com/markbobthomas/household-ledger/pull/49) passed both required checks on final head `2d7d811952ec39aafa5a5a4eabe1db45e7f7d5e4`: pilot banking-safety checks and desktop Chromium/iPhone WebKit interaction tests. Fictional independent four-week paychecks of $3,040 and $3,075 reconcile to November 2026 $6,115; next 12 full months $79,495 (13 payments each); average/month $6,624.58. PR merged to `main` as `9babafba84b2ee1474b6fd234e56d59e39d38eb8`. Actual private Render deployment remains unverified.
- **Integration:** Port only this correction on a new branch from the latest `main` (which already includes 1/2/3 from PR #46); do not merge the older divergent PR #48. Private Render deployed version remains unverified.


### 2026-10-22 — resume development and confirm working baseline

- **Request:** Resume Household Ledger development, read the project ledger, AGENTS.md and latest code; keep an updated merged project ledger after every request.
- **Decision:** Preserve GitHub/Plaid/private Render architecture, canonical calendar-first checking forecast, independent recurring schedules, bank-source immutability and straightforward inline editing. No additional feature was requested in this prompt.
- **Review:** Read current main versions of PROJECT_LEDGER.md, AGENTS.md, planner.js, planner-transactions.js and planner-summary.js. Latest documented feature merge is PR #49 (calendar-month category income totals); previous PR #46 implemented quick categories, search and posted-payment matching.
- **Changes:** Documentation-only continuity entry; no application, forecast, bank or infrastructure changes.
- **Validation/deployment:** No functional tests required or run for this documentation-only entry. Private Render running commit remains unverified; do not claim deployment.
- **Next:** Ask for the next specific product change, inspect the relevant complete code and tests, implement on a separate branch/PR, validate required safety and browser checks, merge, and record results here.


### 2026-10-22 — reconcile stale current-state handoff after resumption

- **Request:** Resume development from the current repository and maintain a merged, concise per-prompt handoff, without changing app behavior absent a feature request. The prior docs-only resumption entry already exists in merged PR #50.
- **Decision/results:** Reconciled the summary's obsolete PR #34 "latest validated" line against current source and merged PRs: PR #46 provides quick categories, schedule search and posted reconciliation; PR #49 is the latest verified functional merge for calendar-month income totals. At review start, `main` was `b9fc75928227c1661542ea8a4c8b91a14c0b9edb` (PR #50 documentation merge). Reviewed `AGENTS.md`, `README.md`, `DEPLOYMENT_STATUS.md`, core planner/transactions/summary/history code and private server design.
- **Changes:** Documentation-only correction to this current-state snapshot plus this entry. No UI, forecast algorithm, source bank data, Plaid, secrets, persisted preferences or Render infrastructure changed.
- **Checks:** No new banking/browser functional tests were run for this docs-only change. PR #49's required banking and browser checks were verified successful; GitHub Pages publish workflow on baseline `b9fc759` was successful. Private Render's deployed SHA and live status **remain unverified**; GitHub Pages does not establish a private deploy.
- **Next:** Await a specific product/bug request; start from newest `main`, inspect relevant code, implement with focused tests and PR, separately confirm any private deploy, and append a concise ledger outcome for each request.

### 2026-10-22 — compact Schedule category totals (next calendar month only)

- **Request:** Remove the 12-month total and monthly average from category group headings on the Schedules page.
- **Decision:** Retain only the exact **next complete calendar month's** category total, computed from the existing dated canonical forecast, for deposits, withdrawals and transfers. Live search recalculates this same month-only value using visible schedules. Keep category assignments, distinct recurring streams, individual occurrence adjustments and forecasting arithmetic unchanged.
- **Changes:** [PR #52](https://github.com/markbobthomas/household-ledger/pull/52) updates both category-header rendering paths in `planner.js`, adds concise-label/search assertions in `tests/planner-browser.cjs`, and refreshes the planner asset version in `index.html`. No bank records, Plaid connections, private forecasts or deployment settings were touched.
- **Checks:** Real-account pilot safety checks passed on application/test commit `088e34318813126db716af5f0fcb744c9fdffbc1`. Desktop Chromium and iPhone WebKit browser workflow was **in progress when this entry was recorded**; verify its final result on PR #52 before merging. No direct live-account testing was run.
- **Deployment:** No private Render deployment asserted; independently verify live service revision before claiming the change appears in the private banking site. GitHub merge and Pages publishing are separate statuses.
- **Next:** Merge only with required checks green; keep the category view uncluttered and prioritize forecast integrity in future changes.

- **Post-merge verification (2026-10-22):** Both required checks **passed** on rebased PR #52 feature head `d031d6075a19e43e4002c90ff169d864a1064291`: **Real-account pilot safety checks** and **Browser interaction test** (desktop Chromium and iPhone WebKit). PR #52 merged to `main` as `6aa387ea79bc23856c59836a723f742a85236ad3`, and the updated ledger entry was confirmed on `main`. Private Render deployment remains **unverified**; browser checks test fictional fixtures and code, not private bank deployment.

### 2026-10-22 — minimal, calendar-first visual overhaul

- **Request:** Substantially simplify the entire visual interface and remove unnecessary decorative text and UI while retaining usable functionality.
- **Decision:** Keep Calendar, Schedules and History as main navigation; keep advanced tools in existing More menu. Maintain visible bank source/mode, forecast low-balance alerts, actual-versus-predicted distinctions, forms and interactive actions. Do not hide financial warnings, essential labels or edit paths.
- **UI changes:** Simplified page identity/header and removed duplicated decorative footer copy; flattened navigation into understated text tabs; reduced whitespace, borders, colors, roundness and extra headings; tightened calendar, category toolbar, schedule list and editors across desktop/mobile. Shortened selected schedule/forecast labels. Preserved original control IDs and event handlers.
- **Source:** `index.html`, `planner.css`, `planner.js`, `planner-summary.js`. No accounting model, recurrence, forecast rules, bank source, private preferences, Plaid, security or deployment modifications.
- **Verification:** Target PR requires passing Real-account pilot safety checks and desktop Chromium/iPhone WebKit Browser interaction tests; document final outcome when known. No live account tests. Private Render deployment unverified.
- **Next:** Visually evaluate the compact layouts on actual desktop/iPhone after deploying, and make targeted follow-up adjustments without restoring decorative clutter.

- **Post-merge verification (2026-10-22):** [PR #54](https://github.com/markbobthomas/household-ledger/pull/54) passed Real-account pilot safety and Browser interaction tests (desktop Chromium, iPhone WebKit) on feature head `48892722b4f3fb713664893c644427188e50e432`; merged to `main` as `708b2f13ad8ebb3651047be1322035e145edef5c`. Tests initially flagged assertions referencing intentionally removed labels; those were updated before the final green run. The visual cleanup does not alter forecast or bank state. GitHub Pages publication and private Render live revision are not independently confirmed.

### 2026-10-22 — second-pass ultra-minimal interface

- **Request:** Simplify the appearance further while retaining the direction of the preceding visual overhaul.
- **Decision:** Prioritize dense calendar and schedule information over decorative framing; preserve keyboard/tap actions, account/source distinctions, projected minimum and warning text, schedules, edit forms, bank safety and forecasting calculations.
- **Changes:** Second-pass responsive style reductions in `planner.css`: smaller header/navigation, tighter calendar cells and headings, more compact schedule rows and filters, reduced panel/form spacing, fewer duplicated helper captions. Removed empty footer from `index.html`, versioned CSS asset, and relabeled calendar return control from Start to Today in `planner-summary.js`. The CSS hides only repeated secondary summary context text, not the primary current-balance source label. All existing IDs, handlers, values, forecast/transaction paths retained.
- **Checks:** Require green Real-account pilot safety and desktop Chromium/iPhone WebKit browser workflow on PR before merging; no live bank tests. Private Render deployed revision unverified.
- **Next:** Confirm real-world calendar legibility and mobile tap usability after verified deployment; refine only any proven density problems.

- **Post-merge verification (2026-10-22):** [PR #56](https://github.com/markbobthomas/household-ledger/pull/56) merged to `main` as `7f645e67b03e42d36f39ecb4f0d9e8ef5013c400` after **Real-account pilot safety checks** and **Browser interaction test** (desktop Chromium and iPhone WebKit) passed on feature commit `7c245153018db310e27612542cefb2a94d2f72b2`. The first browser run revealed a hidden historical-bank-versus-prediction label; restored it and reran green. Private Render live deployment and GitHub Pages publication remain independently unverified.

### 2026-10-22 — uniform-width, border-light Schedule list

- **Request:** Make all Schedule items the same width and remove excessive borders and framing.
- **Diagnosis/decision:** Multiple historical grid/card rules compete with category-group and ungrouped flex layout. Enforce one full-width, stretch-aligned schedule list and consistent group/row widths; use subtle row separators instead of boxed cards. Retain keyboard focus styles, form controls, categories, menus and expanded editors.
- **Changes:** Focused Schedule CSS overrides in `planner.css`, stylesheet cache refresh in `index.html`; no changes to prediction logic, bank data, account security, category persistence or schedule behavior.
- **Checks:** Require pilot safety and desktop Chromium/iPhone WebKit browser tests before merging. Private Render deployment unverified.

- **Post-merge verification (2026-10-22):** [PR #58](https://github.com/markbobthomas/household-ledger/pull/58) merged to `main` as `a331b74b7655fd5989d6ef7dfbfcdebe0e7b2f96` after successful **Real-account pilot safety checks** and **Browser interaction test** (desktop Chromium and iPhone WebKit) on feature head `3526f770cdce82a6e06d50ed542342581c4a6e25`. No financial logic was modified. Private Render deployment and Pages publication unverified.

### 2026-10-22 — clarify redundant Separate bill shortcut

- **Request:** Explain why Schedule items have a “+ Separate bill” action and whether it is needed.
- **Finding:** `planner.js` duplicates a schedule as an editable new-schedule preset, copies payee, amount, frequency, account and category, and appends “— second bill” to its title. It does not edit the source schedule. Independent recurring streams remain necessary for distinct obligations and alternating paychecks, but the `+ New schedule` path already creates independent rules.
- **Decision/recommendation:** The duplicate shortcut is redundant UI; recommend removing it in a follow-up implementation while preserving independently editable schedules and existing forecast/deduplication behavior. Discussion only; no app code changed.
- **Verification:** Inspected current `main` behavior; no functional checks or private Render deployment verification for this documentation-only record.

### 2026-10-22 — remove duplicate-schedule shortcut

- **Request:** Remove the redundant “+ Separate bill” action and explain how to create a second independent payment instead.
- **Decision/implementation:** Remove its Schedule row menu action and preset-copy handler. Preserve `+ New schedule`, whose hidden `separateSchedule=on` creates a new independent recurring stream, even with the same payee/date; edit the name, merchant, amount, account, category and recurrence in the regular form. No cloning behavior or financial rules changed.
- **Tests:** Update browser regression to create two same-merchant bills using the normal new-schedule form and assert shortcut absence; run pilot security and Chromium/iPhone WebKit workflows before merging. Private Render deployment unverified.

- **Post-merge verification (2026-10-22):** [PR #61](https://github.com/markbobthomas/household-ledger/pull/61) merged as `c98ae738fe0138d9a669d6ddf5fa638f36635941` after Real-account pilot safety and desktop Chromium/iPhone WebKit Browser interaction tests passed on feature head `4e8888443302fd1a3f66104ea6e924e01bad9cb8`. Browser coverage validates two independent same-merchant schedules via `+ New schedule`; the redundant shortcut is absent. Private Render deployment unverified.

### 2026-10-22 — full navigation and UI redundancy review

- **Request:** Audit the entire app much more thoroughly for unnecessary wording, controls, navigation, duplication and clutter after previous superficial cleanup left a redundant action.
- **Review scope:** `index.html`, `planner.js`, `planner-summary.js`, `planner-history.js`, `planner-transactions.js`, `planner.css` and existing end-to-end coverage; examined primary Calendar/Schedules/History, secondary Predictions/Needs review/Overview/Settings, account/source navigation, schedule creation/editing, history-derived recurrence, individual forecast edits and transaction details.
- **Removed in this pass:** The Schedule tab's repeated “Schedules” title; duplicated instruction above expanded schedule editing; subtitle listing fields immediately below “Repeating payment defaults”; verbose Predictions editor/navigation explanation; redundant Predictions and History footnotes; duplicate Settings intro and empty Review navigation; duplicate Calendar editor X (the clearly labeled Cancel action remains, as does outside backdrop dismissal); unnecessary Predictions panel border. Retained source-data labels, actual versus projected distinctions, warnings, same-merchant independence, all access paths and real bank safeguards.
- **Important retained distinctions:** `Calendar` gives day balance/forecast context, `History` is immutable posted bank activity, `Schedules` manages recurring rules, `Predictions` is a comprehensive dated forecast/restore path; `Needs review` is exception handling, while `Settings` holds card/account configuration. These aren't interchangeable without losing capability. The merchant-collision checkbox on history-to-recurrence and calendar creation should not be removed blindly because it controls deduplication behavior; evaluate separately before replacing it.
- **Verification:** Require real-account pilot safety and desktop Chromium/iPhone WebKit browser checks before merging. Do not claim private Render deployment without verification.
- **Next:** After this safe sweep, audit information architecture on actual device screens; any more aggressive consolidation (e.g. folding Predictions into Calendar) should include replacement access for skipped-occurrence restoration and cross-account/date browsing.

- **Post-merge verification (2026-10-22):** [PR #63](https://github.com/markbobthomas/household-ledger/pull/63) merged to `main` as `a9233c519ca8956a7cf343b2b86ec37019cf7f39`. Both Real-account pilot safety and Browser interaction test (desktop Chromium + iPhone WebKit) passed on final feature head `db12b2125e272a44b059e7c51d910befafd7fb79`. These tested the repository/fictional flows, not the private bank deployment. Private Render revision and GitHub Pages publication remain unverified. Full consolidation of overlapping secondary pages was deliberately deferred until every unique recovery/review capability can be preserved.
