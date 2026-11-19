# Ledger AI Analysis — adaptive financial analyst product brief

**Decision date:** 2026-11-19. **Status:** first evidence-grounded AI outlook implementation merged in [PR #606](https://github.com/markbobthomas/household-ledger/pull/606). Full adaptive investigation over every raw source record, historical model backtesting, and private live acceptance remain future work. The 20-question questionnaire, if completed, expresses preferences rather than a rigid ruleset.

## Mandate

Treat the user's authorized Ledger dataset as the input to an open-ended, comprehensive financial review. The central question is whether the household can meet future payment obligations and what cash balances are likely to be, on which dates, and why. The AI must independently identify what is material; it is not limited to checking the questionnaire's choices or issuing a fixed number of suggestions. Empty/good-news conclusions are valid when supported.

**Key distinction:** Ledger's deterministic, canonical financial engine computes actual balances, dates, obligations, forecast events, and reconciliations. The AI interprets those facts, investigates anomalies, frames uncertainty, prioritizes insight, and proposes next steps. Never allow the language model's arithmetic or guesses to replace the authoritative balance calculator.

## Required data context before model interpretation

Build a read-only, purpose-specific financial-analysis snapshot from the existing authenticated server state and prepared forecast, not parallel accounting logic:

- Per-account current balance and bank-sync freshness, account type, projection anchor date, and actual/forecast provenance.
- Every relevant canonical expected deposit, withdrawal, credit-card settlement, transfer, user-confirmed override and recurring occurrence in the analysis horizon; reconcile posted/pending/expected exactly once.
- Key credit-card statement dates, autopay obligation and payment source where configured; avoid deducting card purchases from checking until a payment is expected.
- Existing rules, already-covered predictions, ignored/dismissed and review-needed items, so the AI does not rediscover implemented logic.
- Historical income, spending trends and coverage estimates as supporting evidence, including uncertainty in variable spending. Do not silently treat excluded discretionary spending as zero.
- Liquidity and account transfer availability as separate from scheduled checking cash; do not assume an unscheduled transfer occurs.
- Transparent coverage limitations: data age, missing connections, unavailable statement schedules, partial history, ambiguous merchant/type classification and gaps in future prediction coverage.

Provide the model with sanitized, minimally necessary summaries and evidence references after an explicit, updated per-run consent describing any newly shared fields. The current consent to restricted recent transaction fields must **not** be treated as permission to transmit complete bank state or full forecast details. Keep secret credentials, bank tokens, full account numbers, private storage, raw Plaid objects and authentication data off-model. Treat external output as untrusted. No changes to money, banking settings or forecasts.

## Analyst behavior (adaptive, not rigid)

- Investigate across accounts, dates, repeating bills, income, credit-card payment cycles, variable spending and liquidity, focusing on *material* consequences for future balances.
- Decide what is worth discussing based on severity, magnitude, time until impact, confidence, novelty and ability to act. A risk with major consequences outranks an arbitrary user preference; explain the reason.
- Compare all suggestions against canonical expected events and known decisions **before and after** model inference. Never recommend adding a rule/event that Ledger already includes; never confuse expected and paid transactions or double count a transfer.
- Search for missing obligations, unusual changes, forecast gaps, tight timing, seasonal spikes and deterioration in the lowest future balance. Do not call an unconfirmed hypothesis a fact.
- Offer realistic and conservative views when inputs allow, with explicitly labeled assumptions and sensitivity ranges. If affordability cannot be established from available records, say so.
- Rank actions that actually change the outlook; quantify how much and on what date when deterministic scenario recomputation supports it. Otherwise state that impact is unknown. Do not invent a savings estimate.
- Provide a balanced view: what looks safe, what is uncertain, what may go wrong, and the highest-value opportunity. Suppress trivial, repeated or purely descriptive suggestions.
- Treat questionnaire responses as soft guidance on tone, horizon, caution, detail and autonomy, not filters that block discovery; retain the ability to change emphasis as new facts emerge.

## Report shape

Open with a concise, plain-English financial outlook written *after* examining all evidence. Follow with sections only when informative:

1. **Can upcoming obligations be covered?** Identify the account, dates, and major payment coverage; separate confirmed and forecast expenses and disclose unknown spending.
2. **Future balance outlook.** Lowest projected balance and date (especially next 30/90 days), payment-caused troughs, recovery dates and changes over time. Distinguish checking from other accessible funds.
3. **Important risks and blind spots.** Payment collisions, uncertain inflows, stale data, missing expected costs, reconciliation anomalies or unexpectedly large card payments, with severity and confidence.
4. **What is working.** Positive evidence, meaningful cash-flow headroom or expected improvements where demonstrable.
5. **Recommended actions.** Prioritized, concrete, nonredundant next steps with timing, estimated effect when calculable, and clear confirmation requirements.
6. **Why this conclusion.** Expandable transaction/forecast evidence, calculations, assumptions, as-of date, data coverage, and unresolved questions.

No forced risk count, fixed score, repeated generic spending tips, or "suggestion" requirement. The report may be short when finances are stable and deeper when significant concerns emerge. No action suggestions are preferable to weak advice.

## Engineering acceptance criteria

- Inspect current `pilot/ai-private-adapter.cjs`, `pilot/ai-forecast-reconcile.cjs`, `pilot/server.cjs` and `pilot/ai-review.html`: they currently analyze at most 240 posted rows and filter some proposals against a private forecast **after** inference; they do not constitute comprehensive financial analysis.
- Design a bounded, safe server-side report-context builder using prepared/canonical forecast results. Prefer precomputed financial metrics and small evidence windows to sending years of raw transactions; disclose scope limits.
- Use deterministic coverage/low-water-mark calculations and exact source IDs for all numerical claims; validate model-derived recommendations against known future events and user decisions.
- Add a report response contract separate from the existing advisory array; preserve explicit consent, read-only operation, failure-code discipline and stable existing review behavior during migration.
- Check missing bill, duplicate payment, posted-vs-expected, variable spend excluded, card settlement, stale sync, forecast gaps, account mismatch and fabricated impact in **fictional** fixtures.
- Test on desktop and iPhone for report UI; no extra synchronous analysis during ordinary tab navigation. Run AI only after user action until newly authorized otherwise.
- Do not claim the report exists, has run on live data, or is deployed until code, review, tests, merge and private deployment are independently verified.

## First implementation milestone

Replace the 'only suggestions' output with an **AI financial outlook report** backed by a read-only deterministic 30/90-day coverage and low-balance summary; keep existing advisory findings as a supporting section. Before any expansion of OpenAI data sharing, update the per-run consent text to enumerate exactly what is disclosed. Next add deeper risk/sensitivity analysis and a complete recommendation-reconciliation pass.
