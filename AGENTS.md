# Household Ledger — instructions for every future development chat

**Start here:** Read [PROJECT_LEDGER.md](PROJECT_LEDGER.md) at the beginning of **every task** in this repository. Treat the latest ledger snapshot as the handoff, then inspect the current `main` branch, source code, relevant existing technical docs, recent merged PRs, and deployment status before acting. The ledger describes intent, not proof of deployed code; if it conflicts with current code, investigate and reconcile.

## Non-negotiable workflow: update the ledger for EVERY user request

For **every prompt/task about Household Ledger**, including design discussion, investigation, bug reports, implementation, and deployment questions:

1. Check the latest GitHub `main`, read this file and `PROJECT_LEDGER.md`, and understand the current objective and any prior explicit decisions.
2. Do the requested work. Favor simple calendar-first checking-balance forecasting over conventional budgeting, extra screens, or multi-step interactions. Preserve existing infrastructure and financial safety.
3. **Before reporting the task complete, update `PROJECT_LEDGER.md` in GitHub** with a concise dated entry: the user's requested outcome, the decision/rationale, actual work done (or explicitly *no code change*), file/PR/commit refs, checks and their outcomes, confirmed vs unverified deployment, and outstanding items. Refresh the current ledger first and append rather than replacing previous history.
4. Update the compact **Current state / Next action** portion if anything changed. If an earlier entry was wrong, correct it with a dated clarification rather than silently rewriting history.
5. Prefer committing ledger changes together with related code on a feature branch and merging the checked PR. For discussion-only prompts, use a small docs-only PR/commit. Do not claim that a ledger update, merge, test, or deployment happened until verified.
6. In your response, say briefly where the ledger update is and whether it's merged. If you have no authorized GitHub write access in the chat, state that plainly and provide the proposed entry; do not suggest that GitHub was updated.
7. Never wait to accumulate multiple turns: the user wants a durable handoff even when the conversation ends abruptly.

**Keep entries concise**: log decisions, results, and follow-ups, not the full private chat transcript. Preserve the full longitudinal history through append-only dated entries, not by duplicating prior entries verbatim.

## Product and engineering guardrails

- The core experience is a **calendar-first forecast of the main checking-account balance** from dated future deposits and withdrawals. Prioritize clarity, credible coverage of major bills/income, and trustworthy low-balance warnings. Users can plan in the same interface instead of navigating to separate editors.
- One canonical future transaction ledger drives all balance views. Individual prediction edits are permitted; a confirmed schedule changes **one occurrence or all future occurrences**, never a newly defined partial date-range batch.
- Preserve independent streams even for similar amounts or identical payees (e.g. alternating paychecks), and do not double count a payment when it posts or overlaps a suggested rule. Separate credit-card charges and linked settlement; count transfers correctly.
- Actual connected bank transactions and actual bank balances are read-only and server-authoritative. A user's edits change **forecasts/overrides only**. Keep Plaid secrets and encrypted live state on the existing private backend. Never change or recreate Render infrastructure, live secrets, persistent disk, or bank account linkages without specific approval and verified preconditions.
- Public GitHub repository: **NEVER put actual account numbers, balances, amounts, transactions, credentials, links containing secrets, bank screenshots, passwords, private personal details, or raw private user prompts in the ledger.** Describe patterns generically instead. Use only fictional fixture data in public tests.
- Before code changes, inspect the current code and deployment architecture. Use a focused feature branch and PR, a short mandatory banking/forecast integrity suite; run desktop Chromium and iPhone WebKit only for UI or interaction changes. Do not require browser suites for docs-only or purely server-side edits. Reserve older specialized tests for changes in those modules. Merge only after relevant checks. Keep GitHub merge, GitHub Pages publish, and **private Render deployment** as independently verified statuses; see [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md).
- See [README.md](README.md), [ACCOUNTING_MODEL.md](ACCOUNTING_MODEL.md), and [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md) for technical details. Some older docs describe earlier versions: prefer current merged source plus this ledger for latest product direction.

## Suggested new-chat instruction

> Continue Household Ledger: https://github.com/markbobthomas/household-ledger/blob/main/PROJECT_LEDGER.md. Read it and AGENTS.md first, inspect current GitHub main, then handle my request. Update and merge the ledger after **every** prompt, including discussion-only prompts. Preserve banking safety and verify rather than assume deployment.
