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

### 2026-10-22 — consolidate navigation by user task

- **Request:** Reduce overlapping navigation, not merely wording or styling; retain all financial editing and safety capabilities.
- **Change:** Main navigation remains Calendar, Schedules, History. Removed independent Overview, Predictions and Needs review links from the global More menu. Calendar is the home for balance forecast and exposes **All predictions** (including advanced dated edits and skipped-payment restore) and **Needs review** (ambiguous matches and suggestions) as contextual drill-down actions. Settings and Bank connections remain in More. Overview's duplicate dashboard is no longer a user-facing destination. Existing internal `data-view` actions and review work flows remain valid.
- **Safety:** Source bank History, independent recurring schedule rules, one-occurrence/all-future editing, account select, full predictions ledger, review resolution, and bank connections are preserved; no core banking/forecast calculations changed. Do not eliminate hidden advanced routes until distinct recovery functions can be replaced.
- **Validation:** Require green Real-account pilot safety and Browser interaction tests on desktop Chromium and iPhone WebKit before merging. Private Render deployed revision unverified.

- **CI installer issue / safeguard (2026-10-22):** The first navigation PR browser workflows repeatedly canceled during Playwright's Chromium/WebKit installation because `.github/workflows/ui-smoke.yml` limited the *entire job* to 10 minutes. Increased the browser job timeout to 25 minutes so installation can finish and the existing desktop/iPhone checks can actually run. No functional runtime/deployment changes; must still wait for an actual passing browser run before merge.

- **Post-merge verification (2026-10-22):** [PR #65](https://github.com/markbobthomas/household-ledger/pull/65) merged to `main` as `76d51dd8a804de45c99870ee7e8be24188fc1a03`. Both Real-account pilot safety checks and Browser interaction test (desktop Chromium and iPhone WebKit) passed on final feature head `e9e90bb0d30679a630d0b8c0f328bde3135cf1b0`. Legacy Overview remains internally accessible for compatibility tests but is absent from visible navigation; full predictions/review remain available through Calendar. Private Render deployment unverified.

### 2026-10-22 — comprehensive visual redesign

- **Request:** Make a drastic appearance improvement across the entire app, beyond incremental clutter reductions.
- **Decision:** Introduce a unified editorial, warm-neutral/forest-green visual language with stronger hierarchy, generous balance typography, quiet navigation and soft surfaces. Retain Calendar-first forecasting, uncluttered full-width schedule rows, History and separate review/edit pathways. Use larger emphasis for meaningful amounts rather than repeating outlines and labels.
- **Changes:** New responsive appearance layer in `planner.css` for header/navigation, core balances, calendar, schedule ledger, category filters, history rows, forms, settings, reviews, secondary menus and editing dialogs; `index.html` stylesheet version + mobile browser theme. Preserves semantics, controls, IDs, screen flows and all bank/forecast logic.
- **Verification:** Require passing real-account pilot safety and desktop Chromium/iPhone WebKit browser interaction suites before merge. Private Render live deploy unverified.
- **Next:** Compare actual phone/desktop screenshots and tune any remaining typography or calendar-density issues without changing source-of-truth finance behavior.

- **Post-merge verification (2026-10-22):** [PR #68](https://github.com/markbobthomas/household-ledger/pull/68) merged into `main` as `32d40bf399b5953d2ee847d529428bed99ff84f3`. Real-account pilot safety and Browser interaction test (desktop Chromium + iPhone WebKit) both passed on head `9b9df901063c0f609659a517e6cfd4ed8a689b63`. Changes were confined to stylesheet, HTML cache reference/theme color, and documentation; no financial logic modified. Private Render deployment and Pages publication remain unverified.


### 2026-10-22 — newly added card leads to unverified calendar

- **Report:** Calendar disappears with an Unverified state after a newly connected credit card's billing/payment parameters were entered.
- **Code finding:** `planner-summary.js` returns a no-calendar empty state whenever the selected account does not have a fresh, finite projected balance series; `planner-core.js` marks missing bank-reported `current` balance unavailable or missing observation date unknown-age. Card payment-rule readiness in `payment-obligations.js` is a separate condition and does not establish a bank-reported card balance. Selection in `planner.js` can remain on a credit account rather than main checking.
- **Status:** No app code modified and no live private bank state inspected. Root cause on the user's deployment remains unverified; switching the Calendar Account selector to the main checking account is a diagnostic workaround, not a verified fix. Preserve truthful balance verification; future fix should keep a verified checking calendar usable despite an unrelated card's missing balance, show the specific blocker, and ensure uncertain card settlements aren't silently counted as certain.
- **Checks/deployment:** Source inspection only; no automated functional/browser tests or private Render deployment verification. Next action is reproduce with fictional newly added credit-card fixture, implement targeted UX/gating correction and test before merging.


### 2026-10-22 — calendar recovery after adding a credit card

- **Request:** Main checking Calendar remains hidden as Unverified after adding a credit card and completing its parameters. Supply a clear pop-up explaining how to restore it.
- **Investigation:** `planner-summary.js` discarded the entire Calendar whenever selected-account projection freshness/finite balance was unavailable. Selecting main checking did not restore it in the reported real environment. Source code alone cannot prove whether the live blocker is absent bank balance, timestamp freshness, or a global forecast calculation failure.
- **Change:** On blocked Calendar, show an accessible recovery dialog with account name, bank-status-specific reason, original calculation error when applicable, ordered steps, refresh-bank action, bank reconnection link and reopen control. Keep the account selector usable, and preserve fail-closed behavior: no invented balances or payment assumptions. Forward the forecast calculation error to the Calendar instead of replacing it with a generic unverified message. Changed `planner-summary.js`, `planner.js`, `planner.css`, `index.html` cache keys; no real account state, Plaid, or forecast mathematics changed.
- **Limitations:** This is diagnostic/recovery UX, not a proven correction of the underlying missing live bank observation or calculation failure. Verify on the private deployment; do not claim the calendar is restored without evidence.
- **Testing/deployment:** Branch implementation, pending PR checks and private Render confirmation at time of this entry. Next: test and merge only with safety/browser checks; then verify private deployed revision and the exact issue shown by the dialog.

- **Post-merge verification (2026-10-22):** [PR #71](https://github.com/markbobthomas/household-ledger/pull/71) passed Real-account pilot safety and desktop Chromium/iPhone WebKit browser checks on head `bbb0e636369101c382a9f0d9607f42f7cf10955b`, merged into `main` as `33e213170bc1541b7d91ed6b42e7e000fa6b57a0`. This validates the recovery UI on fictional fixtures, **not** resolution of the private account's original verification failure. Private Render deployment remains unverified.


### 2026-10-22 — streamline legacy test and verification overhead

- **Request:** Reduce testing and verification overhead after simplification to calendar-first navigation.
- **Audit:** Required pilot workflow previously ran 39 smoke tests plus syntax checks of modules retained for legacy features. These included retired coverage, mortgage, heuristic/backtest and sandbox concerns. The mandatory gate duplicated work for every PR and main push; docs-only modifications triggered tests too. Browser CI is a separate workflow.
- **Changes:** Simplified `.github/workflows/pilot-safety.yml` to 14 core smoke tests for authentication/Plaid, account removal, canonical projection integrity, recurrence/independent schedules, posted-payment matching, card setup/statement cycles, editing, and forecast-only persistence, with 7 active runtime syntax checks. Run on code PRs or manual dispatch only; skip Markdown-only PRs and remove duplicate main push trigger. Retain older tests as opt-in specialized diagnostics rather than deleting historical files. Update `AGENTS.md` so browser validation is relevant to UI changes, not every request.
- **Safety:** Never remove protections against writes to actual bank data, invented balances, double-counted linked settlements, or unverified projected values. CI success is not private Render deployment evidence.
- **Limitations:** The separate browser workflow is not removed by this change; its workflow file was not identified in this focused audit. Further browser CI reduction should be based on its actual configuration and GitHub branch protection.
- **Checks/deployment:** Workflow change requires validation by GitHub PR; no actual bank data or infrastructure changed. Private Render unchanged/unverified.


### 2026-10-22 — UTC/Pacific balance-date correction

- **Issue:** Connected checking account balance was marked future-dated in the evening Pacific despite a valid bank observation, blanking the Calendar. Bank account disconnection is neither necessary nor appropriate.
- **Root cause in source:** `pilot/server.cjs` timestamps a successful Plaid balance refresh with an ISO UTC instant. `pilot/data-source.js`/`planner.js` use local calendar day for snapshot `asOf`, but `planner-core.js` formerly compared it with the UTC timestamp date prefix. After 5 PM Pacific (during daylight saving), a valid same-day balance can look like tomorrow.
- **Fix:** In `planner-core.js`, convert full ISO timestamp to the browser-local date before the freshness comparison; preserve date-only backwards compatibility and retain future-dated warnings for genuinely future dates. Add a Pacific-evening regression and a true-future timestamp control to `tests/planner-core-smoke.cjs`. Do not change Plaid connection, account deletion, source transactions, current balance or the forecast ledger math.
- **Status:** Target PR, CI and private Render revision need independent verification; no live bank data accessed. Future work: verify the private deployed code and actual restored Calendar without requiring relinking.

- **Post-merge verification (2026-10-22):** [PR #74](https://github.com/markbobthomas/household-ledger/pull/74) passed the lean banking-safety and desktop Chromium/iPhone WebKit browser workflows on final head `f8c6818404e885e21c8da32a1350a44cfdd5df40`, then merged to `main` as `89164c76af8c21c6b319cb52427bc54d8a7dcec8`. Private Render live version remains unverified; no bank unlinking required.


### 2026-10-22 — visual alignment and typography consistency

- **Goal:** Make the modern calendar-first interface consistently aligned, symmetric, evenly spaced, and typographically coherent without adding UI or changing interactions.
- **Changes:** Shared 36px control rhythm, vertically centered headers and filters, two aligned balance headline columns with matched sizing and baselines, consistent date and amount typography, schedule row alignment/height, and responsive adjustments for phone widths. Updated CSS and stylesheet cache key only; no forecast, source accounts, Plaid, persistence or navigation behavior changes.
- **Validation/deployment:** Proposed as focused styling PR. Verify CI/browser checks and merge before claiming completion; private Render deployment independently unverified.


### 2026-10-22 — promote Predictions and Needs Review into main navigation

- **Goal:** Present five navigation choices in the same primary row: Calendar, Schedules, History, All Predictions, Needs Review.
- **Change:** Add Predictions/Needs Review to `index.html` primary tabs and remove their redundant secondary Calendar links in `planner.js`; maintain the existing views and handlers. Style nav as aligned, responsive row with horizontal scrolling on narrow phones. Update browser navigation assertions; no banking/forecast changes.
- **Verification:** Focused PR pending CI; private Render status independently unverified.


### 2026-10-22 — predictions moved to More; clearer History actions

- **Request:** Keep Calendar, Schedules, History and Needs Review in the primary navigation; move All Predictions into More. Clarify actual-history actions and prevent Allow Predictions from falling onto another line.
- **Implementation:** `index.html` More now links to All Predictions and the primary duplicate is removed. History uses a grouped, right-aligned action column on desktop and a single grouped action region on mobile; former Make recurring becomes Plan future payments, linked recurring becomes Edit schedule, Not recurring becomes Stop predictions. For excluded patterns, offer Allow future predictions without the contradictory plan action. Refine the History explanation/search label. Preserve existing event handlers and bank/forecast data semantics.
- **Scope:** UI, CSS and browser navigation assertions only. No account mutation or forecast calculation changes. Browser CI and private Render deployment require separate verification.


### 2026-10-22 — unify Schedules and History presentation

- **Request:** Make the two tabs follow the same visual format; clarify the difference between resuming predictions and making a recurring schedule without relying on explanation.
- **Implementation:** History now labels the explicit scheduling action **Create recurring schedule**; the opt-in reversal of a previously blocked auto-inference is **Resume automatic predictions**. Add one short explanation to History so the distinct mechanisms are clear. Align the Schedules and History filter surfaces, typography, spacing, row heights, borders, amounts and action buttons while retaining each tab's needed controls. CSS, UI copy and browser assertions only; no changes to bank data, auto-inference, or persistence.
- **Checks:** Pending PR workflow; private Render deployment separately unverified.


### 2026-10-22 — structural parity between Schedules and History

- **Issue:** Prior CSS-only styling left History filters inside the list's outer panel while Schedules filters were separate. Competing History schedule and prediction buttons also added confusion.
- **Change:** Restructured History to use the exact Schedules outer pattern: standalone bordered filter toolbar followed by a separately bordered ledger. Matched outside margins, padding, border radii, list row rhythm and mobile gutters. Removed redundant History create/edit schedule buttons: clicking a bank transaction row already opens its existing schedule/details workflow. Only exceptional auto-prediction exclusion controls remain, labeled **Mark not recurring** or **Undo ‘Not recurring’**. Financial behavior and bank state untouched; browser tests updated for row-driven actions.
- **Verification:** PR and relevant browser validation pending; deployed Render revision unverified. Do not claim literal pixel-perfect parity without actual rendered screenshot comparison on target devices.


### 2026-10-22 — matching tab container widths

- **Request:** Switching among Schedules, History and Needs Review should not change the content container dimensions.
- **Cause:** `.schedule-page` had `max-width:1050px` and centered margins, while History and Needs Review had no matching page-width limit; their panels and row padding differed. Scrollbar presence could also shift horizontal alignment.
- **Change:** Apply the same 1050px maximum width, centered frame, box sizing and responsive width to all three pages; standardize Review panel borders and padding and row rhythm, preserving each tab's special controls. Use stable scrollbar gutter and stylesheet cache update. CSS-only, no bank/forecast behavior changes.
- **Status:** PR validation and deployed Render revision unverified at creation; assess actual screenshots separately for pixel-level assurance.


### 2026-10-22 — Schedules title and quiet footer disclaimer

- **Request:** Make Schedules heading consistent with History/Needs Review, put + Schedule beside title, and move generic bank/demo disclaimer below tabs to small bottom-of-page print.
- **Change:** Schedules now has a heading, short purpose line and same-row + Schedule action. General informational notice renders in a quiet footer below page content; serious forecast errors, unresolved reviews and bank-unavailable warnings remain prominent above content. Update stylesheet and script cache keys. No forecasts, bank records or editing semantics changed.
- **Status:** Targeted GitHub PR; production Render and live screenshots unverified.


### 2026-10-22 — calendar monthly low and typography consistency

- **Request:** Add the current calendar month's minimum projected balance beside current balance and three-year low, highlight its date, and normalize inconsistent titles and font sizes.
- **Implementation:** Compute monthly low from the same verified per-day projection as Calendar, highlight its day with a distinct low marker, and update the metric when navigating months. Three balance metrics now share a three-column grid and coordinated label/value/date typography with narrow-phone scale adjustments. Standardize common list title, merchant and detail sizes. No forecast arithmetic, bank source or saved planning data changes.
- **Testing/deployment:** Targeted smoke assertions and GitHub PR verification pending. Do not claim private Render deployment or real-device pixel matching without evidence.


### 2026-10-22 — monthly-low display stale after month navigation

- **Bug:** `planner-summary.js` initially rendered the monthly minimum correctly, but `updateMonthLow()` searched for `[data-summary-month-date]` while the actual clickable date had `[data-calendar-month-low]`. Changing months updated calendar cells but left the minimum amount and date unchanged.
- **Fix:** Use the existing clickable date selector in the update function. A browser regression calculates the minimum from all visible calendar daily amounts in November, then confirms both displayed metric and highlighted date match. No bank state or forecasting math changed.
- **State:** PR/browser validation and private Render deployment require independent verification.


### 2026-10-22 — corrected reversed monthly minimum comparator

- **User evidence:** iPhone Calendar screenshot showed multiple days with clearly lower balances than the date marked 'Monthly low'. This was not a timezone issue or stale UI.
- **Confirmed root cause:** `monthLow()` reduced over `calendarContext.points` using `b.balance<a.balance?a:b`, which returned the **higher** point when a smaller one was found. Thus the metric and day highlight selected the monthly *maximum*.
- **Fix:** Reverse ternary to `b.balance<a.balance?b:a`, retaining the same projection series and highlighting selected minimum date. Add a targeted smoke assertion with rising balances (minimum first day) and retain browser comparison to visible calendar values. Do not touch bank data, schedules or forecast arithmetic.
- **Verification:** GitHub checks and actual private Render deployment must be independently confirmed.


### 2026-10-22 — declutter top header: bank utilities in More

- **User request:** Move circled Real bank indicator, Real/Plaid selector, Refresh bank and Bank connections out of top of Calendar and into hamburger/More menu. User screenshot shows these controls consuming a full mobile row.
- **Change:** Retain existing IDs and event handlers, group data source selector, status indicator, refresh bank and connections in More menu, remove them from topbar. Keep app title and More trigger aligned on one row on mobile, preserve focus/menu access, and change targeted browser test to open More before refresh. Financial forecasts, Plaid connection, permissions and saved state unchanged.
- **Status:** GitHub PR/CI and private Render deployment require verification.


### 2026-10-22 — iPhone header brand wrapping regression

- **Observed:** Screenshot showed the Household Ledger title broken into individual letters down the page after moving bank controls to More.
- **Fix:** Constrain header flex layout to one row and prevent the title from wrapping within its flex child; preserve More at natural width and truncate the brand only if truly necessary. Updated stylesheet cache key. No financial functionality or data changed.
- **Verification:** Mobile rendering and private Render deploy remain to be independently verified.


### 2026-10-23 — remove redundant titles inside main tabs

- **User preference:** Highlighted navigation already names Schedules, History, and Needs Review; eliminate repeated page headings and explanatory lines.
- **Change:** Remove duplicated in-page titles/descriptions from those three views; keep + Schedule as a compact right-aligned action and Needs Review count as a quiet status. Preserve filters, bank history actions, alerts, and recurrence logic. CSS alignment/cache key updated; no forecast or bank data changes.
- **Verification:** GitHub PR and deployed Render/browser appearance require independent verification.


### 2026-10-23 — resume development from current source and project instructions

- **Goal:** Re-establish the project baseline by reading this ledger, `AGENTS.md`, recent GitHub history, current forecasting modules and deployment instructions before subsequent development.
- **Decision:** Preserve the calendar-first checking-balance predictor, one canonical dated forecast ledger, bank/source immutability, independent recurring schedules, existing Plaid/private Render infrastructure, and the minimal interface. Continue app changes only against inspected current `main`; append and merge a concise project-ledger update for every user request, even discussion-only.
- **Reviewed:** `PROJECT_LEDGER.md`, `AGENTS.md`, `README.md`, `planner.js`, `planner-summary.js`, `planner-core.js`, `DEPLOYMENT_STATUS.md`, and recent GitHub commits. At review the newest reported main commit was `66eb801fc26f1bebd6e6b889fae68924bdaa32db` (PR #89, redundant tab heading removal). Recently merged changes also cover mobile title wrapping (#88), moving bank controls to More (#87), and correcting monthly-low calculation (#84/#85).
- **Changes:** Documentation-only development resumption; no runtime code, banking integration, data schema, prediction arithmetic, or UI change.
- **Checks:** GitHub source/document inspection only; no code-specific or browser tests required for a docs-only entry. No private bank data accessed.
- **Deployment:** Current private Render revision and actual live behavior remain **unverified**; a GitHub merge does not prove deployment. Do not alter existing service, secrets, or persistent disk.
- **Next:** Await a specific app change or investigation; inspect relevant current source, work in a focused PR, validate safety/desktop+iPhone as applicable, merge, append results to this ledger, and separately verify Render when accessible.


### 2026-10-23 — consistent Calendar metric hierarchy and threshold colors

- **Goal:** Align the three headline balances, remove the anomalous vertical divider, center monthly low, and distinguish current bank balance from projected lows.
- **Decision:** Order the three metrics as bank-reported current balance, monthly projected low, and three-year projected low. Use equal internal padding and spacing, no vertical separator; current balance is prominent green, while projected figures are smaller and turn red **strictly below $6,000** (at $6,000 they remain neutral). The monthly warning style must update on calendar-month navigation. Preserve existing date links, low-date highlighting, projected-value calculation, separate bank/source labels, and below-cushion warning copy.
- **Changes:** Presentation-only markup and conditional classes in `planner-summary.js`; consolidated metric styling in `planner.css`; cache key updates in `index.html`. No banking data, recurring rules, canonical forecast calculations, or persistent settings changed.
- **Checks:** JavaScript syntax inspected via source parse. GitHub PR validation must be checked before merge; mobile/desktop rendered appearance and private live deployment still require separate verification.
- **Deployment:** Private Render SHA remains unverified; a merged PR is not evidence that Render is live.
- **Next:** Visually review the three-metric header on phone and desktop after confirmed deployment, especially narrow screens and monthly navigation.


### 2026-10-23 — configurable Calendar red-low threshold (pending UI validation)

- **Request:** Make the dollar level that turns Calendar projected lows red user-selectable in Settings.
- **Decision:** Keep the existing cash-cushion safety threshold separate. Add **Red highlight below ($)**, default $6,000; the saved whole-dollar value controls both monthly and three-year projected-low text, strictly below threshold, including after navigating months.
- **Implementation status:** Changes authored in PR #93 (current-main clean branch), preserving Plaid/Render and existing forecast-only preference storage; includes earlier unmerged Calendar metric layout consolidation. No source bank records, recurrence, or forecasting math altered.
- **Verification:** PR #93's Real-account pilot safety check passed. Browser interaction CI remains in progress; no app code merged or private Render revision verified at documentation time.
- **Next:** Merge PR #93 only after UI checks pass and reconcile this ledger entry without duplication; then verify private deployment independently.


### 2026-10-23 — investigate unchanged Calendar styling in live app

- **Report:** Calendar still shows a vertical divider and no red projected-low figures after requested styling and threshold changes.
- **Verified cause:** Current GitHub `main` still serves `planner.css?v=tab-headings-removed1` with pre-change metric styles; application PR #93 containing the Calendar layout and editable red threshold is **open, not merged**. Prior merged PRs #92/#94 updated documentation only, not runtime appearance.
- **Validation:** PR #93 head `8b6d639c6d9e1e4ca7e95632ac5760ec02d38f77` passed Real-account pilot safety workflow, but desktop/iPhone browser workflow run `39974997654` remained in progress at the browser installation step when inspected. No confirmed UI pass, no application merge, no verified private Render deployment. Do not infer the user's displayed version from unverified Render state.
- **Action:** Investigated source and CI; no additional runtime changes for this report. Retain the open PR pending browser verification rather than claim a live release.
- **Next:** Resolve/complete browser validation, merge #93 with passing checks, then separately compare private Render `/healthz` commit with merged `main` and confirm the appearance on an iPhone.


### 2026-10-23 — deliver unmerged Calendar metrics after reported unchanged deployment

- **Reason:** User deployed the latest main revision but still saw the divider/no red warning. Investigation confirmed old app assets on `main` and the true UI change stuck in unmerged PR #93; deployment alone cannot include a PR.
- **Implementation:** Fresh branch from latest main publishes balanced headline tiles (account balance green, monthly low middle, three-year low right, smaller projections, no borders/dividers), persistent independently adjustable **Red highlight below ($)** in Settings (default $6,000), and runtime threshold recalculation on month navigation. Cache-keyed CSS/JS ensure changed assets fetch on deployed devices. Tests updated for the former History button and moved Demo status, with new desktop/iPhone browser assertions for correct order, no separator, computed green/red colors, preference save, and negative lows. No bank records or forecast arithmetic touched.
- **Release:** Focused release PR created; banking-safety and browser checks required before merge. Do not claim Render release without independently confirming private `/healthz` SHA and visible page.
- **Follow-up:** Supersede unmerged #91/#93 after validated release to avoid duplicate PRs.


### 2026-10-23 — Calendar visual code now merged; release validation follow-up

- **Resolved GitHub-source discrepancy:** Calendar app changes actually merged to `main` in PR #96, commit `ed47d123c2e393165a70368550d9706519cec0a0`. Previously deployed `main` only had documentation, explaining why the user still saw the old divider/colors. The merged code also closes a missing metrics wrapper, keeps the calendar outside the headline row, and supports a saved Settings red-warning threshold (default $6,000), independently from the financial cash cushion.
- **Checks:** PR #96 real-account pilot safety passed. Main push reconciliation accuracy, Demo/Real capability audit and GitHub Pages publication passed. Main browser test ran and confirmed the new Calendar metrics layout assertions, then failed on an outdated assumption that the Settings audit control is outside More. That assertion was corrected in a focused test-only PR; no bank or forecast logic modified.
- **Deployment status:** GitHub Pages publishing is confirmed separately from the existing private Render service. Render `/healthz` commit was not retrievable from this environment, so a current private Render revision and end-user displayed version are still unverified.
- **Next:** Finish the remaining Chromium/iPhone WebKit browser CI after the test update; verify that Render reports Git SHA `ed47d123c2e393165a70368550d9706519cec0a0` (or newer containing #96) and that the user sees the aligned, borderless green/red numbers on refresh. Do not conflate Render deployment with GitHub Pages.

### 2026-10-23 — repeated deployed-but-unchanged Calendar; remove legacy CSS and expose build identity

- **User report:** The private Render app still appears unchanged after a reported successful deployment: vertical separator visible, no expected green/red Calendar treatment.
- **Investigation:** GitHub `main` includes PR #96's actual Calendar code and PRs #97/#98's test maintenance. The authenticated private server (`pilot/server.cjs`) serves root `index.html` and `planner.css` from the checkout with `Cache-Control: no-store`; its `/healthz` exposes a safe deployed SHA. Source still contained obsolete `.summary-numbers>div+div` border/padding declarations, despite stronger late CSS resets. Browser verification from this environment cannot directly authenticate or inspect the private Render site, so do not claim the page's live revision.
- **Changes:** Delete the original vertical-divider/unequal-padding declarations in `planner.css`, retain the three-column corrected Calendar markup and numeric-color styles, bump client stylesheet/script URL versions, add a non-financial `ledger-ui-revision` meta marker, and use the **existing** More-footer version field to display `Calendar UI r2` plus the current private server's public `/healthz` Git SHA when available. No new top-level controls, banking data access, changes to Plaid credentials, forecast arithmetic, or persisted preferences.
- **Diagnostic correction:** Browser CI revealed that an existing `planner.js` `/healthz` listener overwrote the new UI marker with a generic revision label. Consolidated the label in that existing listener and removed the added duplicate listener from `pilot/data-source.js`; one no-store, read-only health check remains.
- **Browser regression follow-up:** The updated marker and Calendar styling checks were reached successfully. A later private-bank fixture still navigated to a deleted Calendar drilldown instead of More → All Predictions; fixed this test-only route. No live interaction changed.
- **Validation:** Extend desktop Chromium/iPhone WebKit checks for HTML UI revision marker, the More-footer build label, zero borders and padding for all three Calendar metric columns, and the previously added threshold/color tests. Real-account pilot safety and browser CI must be checked before merge.
- **Release status:** New GitHub PR/release work; current private Render revision still **unverified** from this session. A successful Render deployment of an old commit/service cannot prove these page assets are current. After merge, inspect the user's app **More → Calendar UI r2 · Render [short SHA]** and compare with GitHub `main` (avoid the fictional Sandbox when verifying the real account app).


### 2026-10-23 — Calendar fix confirmed by user

- The user reports: “It’s working.” This confirms that the corrected Calendar appearance is now visible to the user after application PR #99 (main commit `7741de9df93e9b281a393d524ab713e7d8f13290`). The earlier visible divider and styling-release mismatch can be considered resolved from the user perspective.
- No application changes for this acknowledgment. Retain the working three-metric presentation, green current balance, configurable red projected-low threshold, and existing build identifier.
- GitHub Pages publishing, reconciliation gate, Demo/Real audit, and pilot safety check succeeded for the release. Full browser workflow reported a failure; do not claim every test passed. Private Render commit was not independently read in this session, although user confirms the app is now working.
- Next: preserve this working UI as the baseline; any remaining browser test maintenance should be handled separately and should not disrupt deployed financial workflows.

### 2026-10-23 — research-backed new-user usability recommendations (discussion only)

- **User goal:** Preserve current working minimal Calendar and powerful recurring forecasting but make the product self-explanatory and easy to edit for someone new. Asked for four researched recommendations; no authorization to implement.
- **Current-source audit:** `index.html` has Calendar / Schedules / History / Needs Review, while All Predictions and Settings live under More; `planner-summary.js` shows forecast numbers and selected-day payments with inline action triggers; `planner.js` supports both one-occurrence and all-future edits, schedule forms, posted-history-to-forecast actions, and separate cash-cushion vs red-highlight settings. New users must infer the distinctions and discover some actions.
- **Ranked proposals (NOT implemented):** (1) give Calendar an immediate plain-language explanation of current bank value versus estimated future balance, plus one subtle, dismissible first-use hint; (2) make all editable predictions obviously tappable and put one consistent in-context editor behind their rows, with clearly labeled one-vs-all recurrence impact, cancel/undo and save feedback; (3) align navigation and labels to user goals, exposing common actions (add one payment, add recurring payment, edit a date) at their point of use while reserving More for genuinely advanced settings; (4) turn forecasting confidence into a restrained, actionable explanation of what future transactions are included, estimated, missing or awaiting confirmation, with a direct resolve action, clear actual/predicted distinction and no implication of certainty.
- **External design evidence reviewed:** Nielsen Norman Group research/guidance on recognition over recall, clickable signifiers, progressive disclosure, contextual onboarding, system-status visibility, user control, and small qualitative usability tests; GOV.UK error guidance. These are design hypotheses grounded in established evidence, **not** usability results measured on this app.
- **Validation proposal:** Test with approximately five first-time, nontechnical people on phone and desktop. Give realistic tasks: interpret balance, change one future bill, change all future occurrences, confirm a recurring payment from History, locate an uncertain or missing payment. Record unassisted task completion, wrong-path attempts, time, and comprehension of actual vs forecast; iterate before making large structural changes.
- **Implementation/deployment:** No app source changed, no live Render deployment initiated; docs-only PR for continuity. Prior verified working Calendar styling from PR #99 remains baseline.

### 2026-10-23 — implement usability recommendations 1, 2 and 3

- **Goal:** Make Household Ledger discoverable to first-time, nontechnical users without sacrificing its current minimal Calendar layout, secure banking, or single forecast ledger.
- **Changes:** (1) Expose a visually distinct `Edit` cue on *every* Calendar and unified predicted-payment row, including narrow iPhone screens, while retaining the same in-context editor and existing “this payment only” versus “this and future payments” save semantics, cancel and feedback; (2) label bank/sample current balance versus estimated future balances in one short Calendar explanation, add a one-time dismissible date-and-edit hint, and put `+ Add prediction` next to the chosen future date instead of below its calculations; (3) rename navigation labels to **Calendar / Repeating / Bank activity / Needs review**, use **+ Repeating payment** on the relevant page, make recurring-edit and history-to-forecast actions discoverable with compact explanatory text and visible entry cues. Keep All Predictions and Settings under More. Client asset versions bumped.
- **Safety:** No changes to Plaid connection, encrypted private state, forecast arithmetic, recurring deduplication, bank balances/source transactions, or Render configuration. Only a harmless local dismiss-preference is new.
- **Testing:** New desktop Chromium/iPhone WebKit browser assertions verify task-based navigation, correct balance explanation, dismissing guidance across reloads, visible edit actions on phone, context-level `+ Add prediction`, and repeating-payment actions; existing forecast-edit/saving/bank integrity tests retained. JavaScript syntax checked. Must confirm CI status and independent Render deployed SHA before claiming live release.
- **Continuity:** Preserve user-confirmed working Calendar metric layout, monthly low highlighting and saved red-alert threshold from PR #99; avoid adding onboarding popups or duplicate editing screens.

### 2026-10-23 — New-user recommendations 1–3 merged and validated

- **Application release:** PR #102 merged into `main` at `e59265675811a1a3bfbb94d8f9b10880985688ae`. Includes visible editable-payment cues, a contextual Calendar add action and one-time hint, balance-source/estimate explanation, task-based navigation labels, plain-language help on Repeating and Bank activity, and fully visible 320px navigation. The previous working Calendar metric layout and financial calculation rules were preserved.
- **Checks:** PR head `3246a666da5deb3ce55e5fc1dc16b2d6824b9d76` passed Real-account pilot safety checks and desktop Chromium/iPhone WebKit browser interaction CI (including new narrow-screen navigation and editing assertions). The main-merge reconciliation accuracy gate and Demo/Real capability audit also passed, and GitHub Pages publication succeeded.
- **Private deployment:** The authenticated Render service's `/healthz` SHA and live phone appearance have not been independently verified here. GitHub main and Pages publication must not be described as confirmation that the private banking service now shows this version.
- **Next:** Confirm private Render is running a SHA containing PR #102; have first-time users try reading a predicted balance, editing only one payment, changing a full repeating plan, and making a future plan from bank activity. Fix observed friction rather than adding more controls.

### 2026-10-23 — Consistent History recurring actions and safe unscheduled opt-out

- **User feedback:** Bank activity shows “Undo Not recurring” on some rows but gives no equivalent “Not recurring” decision on other unscheduled rows. Action availability and meanings are hard to infer.
- **Decision / UI:** Every History row has its own primary button (Plan repeating, Edit plan, or Choose plan), a plain recurring-status label (No repeating plan, Automatically predicted, Auto predictions off, or Recurring confirmed), and only the safe secondary action for that state. Unscheduled rows now offer **Don't suggest** (prevent *future automatic* repeating suggestions), auto-predicted rows **Stop auto predictions**, excluded rows **Allow predictions**, and confirmed/ambiguous scheduled payees direct the user to the exact saved plan instead of offering a dangerous broad stop. No nested buttons inside role=button containers. Clear History hint explains actual bank records are read-only.
- **Safeguards:** New `excludeHistorySuggestions` action writes only an account/direction/payee-specific forecast preference. It refuses to exclude when any confirmed plan for that source or linked payee alias exists, before mutating state; unlike `stopRecurrence`, it never deletes a confirmed plan. Existing merchant/direction/phase-specific exclusions stay reversible; no change to bank history or Plaid, calculation, Render infra, or imported source data.
- **Tests:** New unit regression covers exclude → restore, account/direction isolation, and protection for separately saved payroll plans. Expanded Chromium/iPhone interaction coverage for all History states, no nested buttons, prospective exclusions, immediate allow reversal, and plan safety. Final CI and private Render verification still needed.
- **Release:** Development branch `fix/history-recurring-actions-consistent-20261023`; not deployed until merged and independently verified.

### 2026-10-23 — History actions tested and merged; release-status clarification

- **Prior status:** The History action redesign in PR #104 was implemented on its feature branch but was **not** available from `main` or independently confirmed on the private Render service when the user asked whether it had shipped.
- **Investigation:** Original branch `181de583668ae2350884554ff518b9245ed46efe` passed real-bank safety checks; its browser workflow had been canceled during browser installation. Retried that canceled job directly; it ran and identified a flaky test selector that followed the first row *still marked unscheduled*, not the same bank record after opting out. Fixed the test to track exact bank transaction/account and wait for its transition to excluded and back.
- **Verified release:** PR #104 merged into GitHub `main` as `b2d390de6bb6f9f66b886793114fb5209ec6d278`. Final feature head `fe57ca6c9d596e232dfd050c7110651462c91162` passed both **Real-account pilot safety checks** and **Browser interaction test** (desktop Chromium/iPhone WebKit). Code changes give History explicit Plan repeating / Edit plan / Choose plan actions; allow Don't suggest for unscheduled suitable bank records; Stop auto predictions for inferred series; Allow predictions to undo exclusions. Confirmed schedules and real bank records remain protected.
- **Deployment boundary:** GitHub main was independently checked. Private Render server uses `Cache-Control: no-store` for HTML and JS, but its authenticated `/healthz` revision could not be read here. Do not claim the user's live private app shows these controls without checking that the correct Render service has deployed this release.
- **Next:** Confirm private Render `/healthz` commit is `b2d390de...` or later (which must contain PR #104); have user verify the History row actions on their banking URL. Preserve current forecasting and linked bank settings.

### 2026-10-23 — Replace cryptic History decisions with one explicit Auto-predict permission

- **Problem:** A knowledgeable user cannot infer why individual History rows offer different “Don't suggest,” “Allow predictions,” or “Stop auto predictions” actions. They asked why permission cannot be ON for every transaction, what OFF does, and whether a record disappears.
- **Design change:** One **Auto-predict: On / Off** two-state, explicitly labeled control on **every eligible bank-history row**, whether a repeat has been recognized or a plan saved. Consistent separate **Plan repeating / Edit plan / Choose plan** action. Inline permanent explanation: ON permits estimates only if repeating evidence exists, not a guarantee; OFF suppresses future automatically inferred payments for the same payee, account and direction; posted History rows are never hidden/edited and owner-confirmed repeating plans remain unchanged. For rare rows missing a usable payee/direction the control shows unavailable instead of applying an unsafe guess. Remove overlapping old row-level “don't suggest / allow / stop” controls.
- **Financial logic:** `setHistoryAutoPrediction` persists a targeted `historyOptOut` in the existing forecast-only exclusions model and reverses relevant exclusions when reenabled, including legacy phase/inferred-series decisions. `planner-core` applies that restriction only to *automatically inferred* events; explicit saved recurring events survive independently. No Plaid, source records, forecast amounts, bank balances, or infrastructure changed.
- **Tests added/updated:** Unsaved payee On→Off→On roundtrip, preservation of History row count and confirmed schedules, iPhone/desktop visible controls, separate UI status vs permission, real core suppression of automatic future expenses, and confirmed-utility/payroll safety. JS syntax validated. CI outcomes and actual merge SHA to be recorded separately; private Render release remains unverified.

### 2026-10-23 — History Auto-predict On/Off release merged

- **User outcome:** Replaced unexplained History actions with the same compact `Auto-predict: On / Off` choice on each eligible bank transaction. On permits an inferred future estimate if recurring evidence exists but does not itself schedule a bill; Off blocks automatic future predictions for that payee/account/direction, not source bank transactions. All original History rows remain visible. Owner-saved repeating plans stay intact and editable through separate Plan repeating/Edit plan/Choose plan actions. A missing usable payee/account/direction is labeled unavailable instead of guessed.
- **Verified GitHub release:** PR #106 merged to `main` as `f31e45d219b437fd5fa954cf319765caf0acc4d1`. Confirmed `main` serves UI metadata `history-auto-predict-20261023-v1` and distinct cache-busting URLs for modified JS/CSS. More menu identifies History Auto v1.
- **Validation:** Functional implementation at PR head `ad355b72005934557d8f547455c9923df1a32f02` passed Real-account pilot safety and desktop Chromium + iPhone WebKit browser interactions. Later commits only changed index.html cache-busting/release text, planner.js version footer text, and matching browser test expectations; compared commits verified no forecasting or UI interaction logic changes. The final version-specific browser rerun was still slow/in progress during merge; safety suite passed on the final PR head. Do not misstate final CI as passed until verified.
- **Private Render:** Not independently verified. GitHub main merge and GitHub Pages publication are not proof of the authenticated bank app's deployed SHA; compare its `/healthz` with this merge or a descendant before saying live.
- **Next:** Confirm final post-merge CI, GitHub Pages publication and private Render release SHA separately. Usability check on iPhone: choose a posted transaction, toggle Auto-predict Off then On, verify the record stays in Bank activity and confirmed payments remain in Repeating.

### 2026-10-23 — Clarify Auto-predict permission versus saved repeating plan (discussion only)

- **User question:** Does setting Auto-predict ON create/save a schedule? How does it interact with Repeating, and does it duplicate transactions? They perceive functional redundancy even after standardizing the History buttons.
- **Verified source behavior:** Auto-predict ON is a stored account/payee/direction-level **permission** for the history pattern detector; it creates no `futureRecurringRules` saved schedule by itself. The engine regenerates eligible inferred future entries from posted patterns. Saving a plan explicitly creates/updates a persistent `futureRecurringRules` record with known cadence/amount/date. `planner-core.materialize` builds confirmed entries first and suppresses matched inferred entries through `ownerFor`; posted payment coverage also avoids re-counting. Same-source matching is designed to avoid duplicate forecast debits, but a poorly linked/renamed obligation or genuinely distinct same-payee streams still merit verification rather than blanket guarantees.
- **UX diagnosis/recommendation (not implemented):** The current ON/OFF toggle displayed alongside `Edit plan` is redundant/misleading because turning OFF cannot disable an explicitly saved plan. Simplify around *forecast status* and one obvious next action: `Automatically forecast — Confirm as repeating / Exclude`, `Repeating plan saved — Edit plan`, or `Not forecast — Add repeating`. Keep automatic opt-out as a secondary action when applicable, not an equally prominent toggle on every confirmed row; avoid two competing controls appearing to manage the same future payment. Preserve bank History and exact independent-paycheck safety.
- **Scope / status:** Explanation and UX proposal only; no application code, forecasting, bank source, or deployment changes. Requires explicit user request to implement. Private Render version remains unverified.
