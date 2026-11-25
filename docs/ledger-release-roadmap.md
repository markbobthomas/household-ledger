# Ledger refinements — durable three-release roadmap

Updated: November 24, 2026 (Pacific). Release 1 is completed, merged and verified live. Releases 2 and 3 are planned and require explicit owner authorization. Start new chats by reading `AGENTS.md`, `PROJECT_LEDGER.md`, this file, current `main`, and deployment status before making changes. This roadmap is a persistent project handoff, not a promise of a future automated task.

## Principle

Calendar-first checking-cash forecast, one canonical future ledger, actual bank records read-only. No duplicate parallel budgeting or forecasting engines, extra top-level navigation tabs, secrets in public GitHub, or simultaneous unsupervised storage migration. Treat current live behavior, code, tests, and owner decisions as the authority.

## Release 1 — clarity and fast actions (merged, verified live)

1. **One prioritized task queue:** On Things to check, put unconfirmed payments, risky older estimates, and recurring predictions before routine category labels. Offer All tasks by default with a simple secondary filter. Preserve all existing issue records, badge counts, payment adjustment/ignore/skip, category bulk-save, and history/schedule actions. Explicit missing mortgage evidence should be visible as a high-priority prompt.
2. **One-tap category decisions:** Show easy choices on each category item, including a reasoned suggestion when one exists. Reuse the exact existing category save paths, preserving financial source data and protected splits. Auto-save a selection; temporary Skip never dismisses the issue or changes the badge. Provide a last-choice Undo that restores the prior explicit/manual state. Keep the full category chooser and batch tools accessible.
3. **Clear Home forecast warnings:** Explain the low for the displayed month, with dated, scheduled withdrawals already present in the canonical projection and corresponding warnings for unverified major obligations, older estimates, or missing expected pay. Show real account observation date only when available. Make everyday unplanned spending and forecasting limitations explicit. Never present new or independent balance math.
4. **Acceptance:** Mandatory banking/forecast CI and desktop Chromium + iPhone WebKit browser tests. Review filter actions do not rebuild forecasts. Bank facts remain read-only. Confirm GitHub merge and private Render independently.

## Release 2 — make financial planning effortless (not yet authorized)

1. Use one consistent contextual transaction editor from Home, Bills, Transactions and Review, with actual bank fields read-only, editable category/Note and prediction settings clearly separated.
2. Add Home's date-specific hypothetical expense/deposit with live comparison to the canonical monthly low and affected balances, no saved state until owner selects Save; do not double count an existing bill.
3. Retain **This occurrence** and **All future occurrences** for repeating payments; no arbitrary partial date-range editor. Acceptance: source/balance conservation, phone-width UX and existing forecast regressions.

## Release 3 — evidence, quality, and durability (not yet authorized)

1. Evaluate real-household Amazon charge-to-item matching and classification acceptance with privacy-safe diagnostics, preserving original evidence and corrections; optimize the measured failure cases instead of adding new Amazon workflows.
2. Keep comprehensive independent AI Financial Analysis and separate QA/QC. Add concise actionable evidence-linked findings and source links only when corroborated by private records.
3. Profile actual mobile navigation/filter latency; remove truly redundant UI/style and historical compatibility paths only after usage and regression checks. Keep prepared navigation and 1,095-day canonical horizon.
4. Verify sync source freshness and recoverability; rehearse full encrypted backup restore away from production before storage migration.

## Next-chat instruction

"Continue Ledger from the Release roadmap in `docs/ledger-release-roadmap.md`. Read `AGENTS.md` and `PROJECT_LEDGER.md`, inspect latest `main` and verified deployment, then proceed with the next authorized work. Preserve the existing banking architecture, mandatory safety/browser tests, full project log and same-task merge rule."

## Status ledger

- Release 1: **Completed and verified live.** PR #742, merge `430c3bbb6da3130bc391c41ad993a10316f03023`; final banking/forecast CI #45546479822 and Chromium/iPhone WebKit #45546479889 passed. Existing private Render deploy `dep-dc366ogjo6nc73eb3910` is live and independently verified by the same `/healthz` SHA. Real-household acceptance remains untested.
- Release 2: planned; explicit owner authorization pending.
- Release 3: planned; explicit owner authorization pending.
