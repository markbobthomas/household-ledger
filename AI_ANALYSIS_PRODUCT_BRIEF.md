# Ledger AI Analysis — adaptive financial analyst product brief

**Decision date:** 2026-11-19. **Status:** AI-directed, one-pass targeted investigation and flexible charts implemented after first evidence-grounded AI outlook merge in [PR #606](https://github.com/markbobthomas/household-ledger/pull/606). Full adaptive investigation over every raw source record, historical model backtesting, and private live acceptance remain future work. The 20-question questionnaire, if completed, expresses preferences rather than a rigid ruleset.

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

## 2026-11-19 extension: adaptive report and investigation

The AI may plan up to five bounded, read-only follow-up queries against current Ledger history and canonical projections before composing a report. The model may select and order substantive narrative sections, supporting observations and precomputed balance/income/spending charts. Evidence and methods are expandable to keep primary presentation concise. This remains a consent-scoped investigation of available records, not a claim that every real-world bill or every individual raw record was examined by the model. Post-merge CI, private deployment and live quality validation are tracked in PROJECT_LEDGER.md.


## 2026-11-19 pivot: conversational financial analysis

The owner rejected another fixed report. The primary interface is a **private Financial Chat** at the existing /ai-review URL. The existing structured report endpoint remains for compatibility, but is no longer the default product. A chat turn is an independent, read-only investigation: the AI receives aliased canonical data and coverage, may request additional specific evidence against complete server-held financial sources, requests its own Ledger-calculated charts, and chooses its own sequence of plain-language observations, compact metric cards, visuals, and follow-up suggestions. The browser renders only validated evidence-backed blocks, never arbitrary AI HTML or unvalidated graph points. Subsequent turns include short in-session conversation context; no prompts, financial source records or chat history are persisted in Ledger storage.

**Critical distinction:** the AI does not get a literal copy of every raw Plaid transaction, nor does it inherit ChatGPT's native interface or proprietary visual widgets. Ledger scans its source records locally, shares an initial bounded context, and makes the rest queryable through explicitly authorized and capped read-only tools. That is more accountable than uploading a massive bank dump: it permits targeted hypothesis checks, coherent three-year cash-balance math and disclosure of missing evidence. Model-generated claims are checked against cited authoritative fact IDs. Graph data is calculated exclusively from canonical server records, then rendered interactively on the client. Predefined chart options remain as seeds, not the report's mandatory structure.

The new explicit per-turn opt-in is financial-chat-v1. No stored permission is inferred from financial-outlook-v2. The previous /api/ai/report endpoint is retained for backward compatibility. All queries retain an upper bound on provider calls, a small evidence response, aliased identifiers and a no-writes guarantee. The UI must remain legible on mobile and not interfere with prepared calendar navigation. Verify CI, merge, private Render revision, and real-data answer quality independently.


## 2026-11-19 owner clarification — one-click autonomous analysis, NOT chat

The owner explicitly rejected the conversation UI. The default product is a **single Analyze button** producing a complete adaptive AI-chosen report/dashboard. No question box, messages, conversational history or follow-up chips. The model can perform repeated typed read-only investigations across complete source history and canonical forecasts, independent source-calculated grouped/period-comparison aggregations, original interactive views and (when relevant) privacy-isolated public research on an allowlisted generic topic. The model chooses substantive issues, evidence, sequence, prominence and presentation mix: no fixed report-section checklist and no minimum number of recommendations.

Consent financial-analysis-v3 is explicitly granted each run. Server-side checks reject or omit unsupported dollar/date claims and record withheld blocks in a visible per-run correction log. The banking system is NOT a writable AI agent: posted activity and bank balances remain immutable and user-controlled forecasts/categories are unchanged. An automatic change to a forecast rule would require separately verified, narrowly scoped, reversible reconciliation logic, a persistent audit log and fictional proof of safety. The user authorized automatic **verified** corrections in principle, not blind model edits. Current implementation auto-repairs only derived presentation errors; do not claim Ledger financial records were automatically corrected.

External research uses an isolated OpenAI Responses web search receiving only a fixed public topic (e.g., BLS inflation) and no Ledger financial numbers, history or prompts; it can fail or be unavailable with the configured provider/model. Source conclusions remain separate from external context. Every AI call is capped; not unlimited autonomous execution, no arbitrary executable model code, no arbitrary URLs, and not a proof that every historical item was transmitted or individually reasoned over.

Private Render deployment, signed-in model quality, latency and the availability of public web research on the configured key/model must be verified separately after CI and merge. Existing legacy /api/ai/chat and /api/ai/report remain for compatibility, but /ai-review uses only /api/ai/analyze.


## 2026-11-19 independent forecast and glance review

Owner flagged AI forecast assumptions and missing income. The AI must no longer merely restate Ledger's own 1,095-day path. A distinct, deterministic, read-only inference module first examines **posted checking history without inspecting any Ledger future forecast**: identifies strongly repeated wage/ACH incoming credits (including alternating biweekly pay amounts), conservatively models stable regular checking expenses and does not treat credit-card charges, paired account transfers, pending entries or discretionary retail purchases as future checking cash movements. Repeating unpaired ACH credits classified as transfers are explicitly **provisional income**, not confirmed salary.

Only after building that source-independent history model does the analyst compare its next-90-day income dates and amounts with Ledger's canonical expected income and daily balance series. It identifies covered dates including Friday/weekend shifts, possible missing income, material amount differences and Ledger-only planned income. **Never conclude that divergence proves Ledger wrong:** owner-confirmed rules, scheduled one-offs, credit-card settlements, internal transfers and variable spending create legitimate differences. The independent history line is explicitly a partial recurrence-only cross-check, not a comprehensive alternative forecast or a replacement for the canonical ledger.

The first screen uses a glance summary of four sourced comparison figures, a dual-line chart, and the most material income questions. Other findings, full pattern coverage, classifications, evidence and methods remain available via expandable sections. Extended mandatory fictional regressions cover alternating income, unpaired versus paired transfers, missing earnings, intentional Ledger-only income, a Friday shift, card purchase exclusion, poor sample coverage, privacy, and desktop/iPhone display. The core analysis remains opt-in, read-only and private; authenticated real-data conclusions need separate acceptance.

## 2026-11-21 priority correction — decision relevance above anomaly volume

The owner reported that the analysis called attention to negligible ordinary account interest. This is a failure of financial prioritization, not transaction coverage. Keep complete source records and accurate canonical balances, but require the autonomous analyst and independent reviewer to assess cumulative cash impact, forecast sensitivity, confidence, novelty, urgency and a concrete decision before elevating anything to a headline, warning or recommendation. Small transactions can still be important when they expose consequential fraud, systemic duplication, coverage errors or growing costs; do not use a global expense-dollar cutoff.

The history-only independent comparison now screens aggregate low-impact income patterns *only for its discrepancy questions and analyst evidence* so harmless pennies are not characterized as missing payroll or proof that the forecast is incomplete. Raw history and canonical calculations are unchanged. A narrow standalone sub-dollar block backstop prevents a trivial micro-transaction from becoming a report card or finding; it does not suppress small supporting evidence in a larger, substantive issue. A good outcome may have few or no recommendations. Authenticated live AI quality and Render release remain separately verifiable.


## 2026-11-21 — Open-ended, evidence-led analysis instead of a forecast template

The owner observed that even the improved AI report remains too prescribed. The desired mental model is a capable analyst seeing unfamiliar household records: the data determines which insights emerge, how deeply they are pursued, whether they are useful and what the report looks like. Do not assume that an independent forecast comparison or any particular financial issue must be shown.

**Implemented approach:**

- The one-click AI starts with a balanced, aliased sample of multiple source-fact families and coverage metadata; **not** a mandated 90-day comparison, predetermined metrics or fixed financial checklist. Ledger still retains the full authorized source history locally, queryable by bounded, read-only tool calls.
- The model chooses its own hypotheses, dates, grouping dimensions, follow-up source investigations, calculations, charts and final presentation. It must complete six distinct valid source checks before synthesis, with a larger bounded tool budget. This is an investigation-depth minimum, **not** a requirement for six findings, particular topics or any chart.
- A separate history-only recurrence comparison remains available as an optional analysis tool. Only when selected does the model receive comparison evidence and a source-computed comparison chart; the UI never inserts a comparison in front of the AI-selected report. If the tool is used, methodology and candidate differences remain available in collapsed detail.
- The autonomous model must test alternative explanations and cite exact source evidence for displayed dollar/date claims. The independent second-pass auditor now receives broader source facts and coverage, not just the analyst's selected citations, and can reject interpretations that present speculation or contradicted assumptions as fact.
- Unsourced free-text model limitations are not shown as verified claims; deterministic known scope limitations and explicitly labeled unresolved reviewer questions appear in expandable details. Uncertain deposits, recurring patterns, savings and affordability are **not** treated as established facts. Source bank data, canonical forecasting, user rules, consents and deployed secrets are unchanged.

**Honest evidence boundary:** The system cannot guarantee zero model errors or prove that every unobserved real-world transaction is covered. It can reject unsupported exact amounts/dates, subject material claims to a separate evidence review, limit presentation to verified findings, and disclose what the records do not establish. A deep investigation is constrained by available bank records, authorized tool queries, provider capabilities, and bounded execution; it is not a literal upload of the entire raw bank database into a model. Do not assert it investigated every possible question or produced a perfect audit.

Validate with fictional end-to-end tests for two genuinely different model-chosen reports: one that never requests the historical comparison, and another that requests it, with independent evidence validation and desktop/iPhone layout. Verify live signed-in quality separately.


## 2026-11-21 — Deep report synthesis, encrypted precomputation after bank refresh

Owner feedback: the evidence-led report remained shallow and the on-demand run forced waiting each time the AI page opened. The desired experience is a high-quality independent investigation completed in advance after substantive new bank data is imported, with a ready-to-read verified report on every page visit. The report should synthesize the household story, important drivers, actionable trade-offs and limitations rather than generate generic risk blurbs or enumerate harmless exceptions.

**Implementation:** Increase autonomous investigation to at least 12 distinct, diversified successful read-only source checks before synthesis and allow a bounded 12-minute processing budget. This is a maximum investigation budget, **not a false claim that the model always spent 10 minutes reasoning**; artificial delay is not evidence of analytical quality. Add a stronger, source-supported executive synthesis emphasis and show the first two AI-selected substantive paragraphs prominently. An independent second-pass evidence reviewer and exact amount/date checks remain required. No arbitrary AI code execution or source banking mutations.

A new authenticated private server cache stores model output and a standing-sharing preference in the existing AES-GCM format at `PILOT_STATE_PATH.analysis`, beside (not inside) the authoritative bank and forecast snapshots. It uses a private source-version HMAC over bank transactions, balances, owner decisions and forecast anchor date; no raw revision data leave the server. Successful Plaid sync triggers a nonblocking, deduplicated background analysis **only when the owner has explicitly enabled ongoing data sharing**. The first opt-in requires the user to acknowledge that sanitized financial data will be sent to OpenAI after subsequent changes. Consent is initially off and can be disabled; manual one-time analysis still requires its own action. Page load reads the saved encrypted report without an OpenAI call or forecast rebuild. Changed data invalidate the old displayed report, and a report finishing after a subsequent bank update cannot be published as current.

Persistence survives app restarts, and the encrypted report/consent are included as an optional fourth file in portable backup and isolated restore. Legacy three-file archives remain restorable. Disconnect clears the saved report and ongoing-sharing authorization. Failed provider runs do not alter source bank facts or cause automatic retry storms. Browser tests cover ready-on-load, new AI results, distinct layouts, opt-in/opt-out and mobile responsiveness; financial tests cover cancellation-of-publish, snapshot deduplication, restart, encryption and privacy boundaries.

**Limits:** OpenAI calls incur usage charges when source data changes. A sleeping or offline service cannot initiate a job until it resumes. Deep analyses can fail, hit provider quotas or return uncertainty; the page must display the actual status rather than claim a fresh successful report. The analysis is not proven error-free. Authentic live-report quality and exact Render revision must be verified separately.
