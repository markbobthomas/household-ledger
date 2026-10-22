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
- Latest app commit confirmed before this documentation work: `3434c3769162bbf18e279b8d5758741fe403e9d1`. Always re-check `main` rather than treating this as permanent.
- Recent PRs document desktop Chromium, iPhone WebKit, banking-integrity and reconciliation tests. The creation of this ledger alone does **not** constitute a new browser or bank test run.
- GitHub Pages publishing was queued at the last reported check following the latest app merge. **Not reverified here.**
- Private Render's running deployment SHA has **not** been independently confirmed here. A GitHub merge or Pages publish does not establish the private server's deployed revision. See [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md).
- No new application work is pending from the previous request; wait for the next user-specified improvement.

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

## Reusable new-chat prompt

> Continue Household Ledger. Read https://github.com/markbobthomas/household-ledger/blob/main/PROJECT_LEDGER.md and AGENTS.md first, inspect current GitHub main, then handle my request. Update the ledger in GitHub after **every prompt**, including discussions. Preserve the existing Plaid/Render setup and verify deployment before claiming it is live.
