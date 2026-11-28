# Archived November 27, 2026 TinyFish initial setup releases

### 2026-11-27 — TinyFish PC-free Amazon sync merged after financial and mobile checks

**Merged:** [PR #819](https://github.com/markbobthomas/household-ledger/pull/819), merge SHA 6ed21b33331596c0ac790abcdb38c02adab10a88. Replaces PC setup with owner-only cloud connection and OFF-by-default controls. Secure Plaid sync on Mon/Thu/Sat after 8 AM Pacific; only new posted unmatched Amazon charges launch the capped TinyFish Agent, then existing conservative local importer annotates saved purchases without changing bank facts. Existing desktop extension remains legacy, ZIP/CSV fallback preserved.
**Verified:** banking/forecast suite [#46034692783](https://github.com/markbobthomas/household-ledger/actions/runs/46034692783) and Chromium/iPhone WebKit [#46034692729](https://github.com/markbobthomas/household-ledger/actions/runs/46034692729) passed on feature head a8e5047c14c6495914861ff672bfbff0dd73ab24. Mocked TinyFish completed-order import, auth, state encryption, skip-if-no-charge and bank immutability covered.
**Not verified live:** Private Render deployed SHA, user Amazon saved browser sign-in, actual Amazon order extraction, and real TinyFish costs. No paid browser Agent run, credentials, production data, infrastructure or private connections changed. Setup needs owner participation; feature disabled until enabled.

### 2026-11-27 — TinyFish provider step-cap compatibility fix (checks pending)

**Issue:** TinyFish documents custom `agent_config.max_steps` as beta-restricted. The earlier cloud integration could be rejected with 403, and retrying it uncapped would expose the household to unexpected agent costs.
**Change:** Submit a fresh UUID `session_id` with each run, fail closed when a provider rejects the 45-step cap, distinguish definite 4xx refusal (free reservation to allow future user retry) from uncertain network/5xx (retain block to avoid duplicate paid jobs), and explain setup limitation clearly. Keeps cloud sync OFF by default.
**Verification:** Fictional unit/server banking and Chromium/iPhone checks to be validated in follow-up PR; no TinyFish credentials, live orders, production bank records or Render infrastructure changed.

### 2026-11-27 — Verified TinyFish compatibility and simpler setup release

**Merged:** [PR #821](https://github.com/markbobthomas/household-ledger/pull/821), merge SHA `3b229b7877b254a8a01ef6f5d83523d18fb52b69`, corrects TinyFish session UUIDs and beta-gated step-cap errors without silently removing the cost guard; definite provider refusals release reserved work and uncertain outcomes block duplicate paid starts. Ledger Settings and Amazon page now lead with the plain-language TinyFish setup, with ZIP/CSV fallback below.
**Verified:** [banking/forecast CI #46035794034](https://github.com/markbobthomas/household-ledger/actions/runs/46035794034) and [Chromium/iPhone WebKit CI #46035794044](https://github.com/markbobthomas/household-ledger/actions/runs/46035794044) passed on final source head `2ca51c1ad2d3384679932c76af48fcf9bf3e997e`; mocked provider rejection, existing-note import, private auth and bank immutability covered.
**Remaining:** TinyFish default Amazon profile must be saved by owner; an API key must be connected in private Ledger and updates enabled. The private Render production deployment and real Amazon extraction are unverified. No paid agent, credentials or live bank records were touched in this development run.

### 2026-11-27 — TinyFish step-by-step self-service setup (feature in review)

**Goal:** Remove assumed TinyFish knowledge from the Amazon owner setup. Verified TinyFish's current **TinyProfiles** terminology, default-profile behavior, **Create Profile → Set as default → Create and set up** flow, and direct [API Keys](https://agent.tinyfish.ai/api-keys) page from official documentation.
**Changes:** Added nine short detailed steps with direct TinyFish/docs/API-key links, exact Amazon order address, explicit login/save and key-copy/paste instructions, encrypted key connection and enable buttons. Setup guide remains re-openable after connecting. Updated companion setup manual and added simulated Connect→Enable regression checks on desktop Chromium/iPhone WebKit.
**Validation:** PR CI pending; no paid browser runs, actual Amazon login, private bank data, deployment or secrets touched. The underlying TinyFish API is unchanged and may still require beta-gated max_steps access.

### 2026-11-27 — Nine-step TinyFish Amazon setup merged after mobile and bank safety checks

**Merged:** [PR #823](https://github.com/markbobthomas/household-ledger/pull/823), `66d26d9f7d713bf7e64da8805250a43b46d48959`. The Amazon owner page now gives a complete, mobile-readable sign-up → default TinyProfile → Amazon sign-in/save → TinyFish API Keys create/copy → Ledger key paste/Connect → Enable walkthrough, with direct verified links and re-openable help. Fixed existing Connect action leaving the Enable button disabled.
**Checks:** [Banking/forecast #46037608915](https://github.com/markbobthomas/household-ledger/actions/runs/46037608915) and [Chromium/iPhone WebKit #46037608597](https://github.com/markbobthomas/household-ledger/actions/runs/46037608597) passed on feature head `a6f3ed49bfd6e40d1e9d6f013e2294ce7f949290`; browser test simulated Connect/Enable with fictional API key, source financial checks unchanged.
**Not verified:** The private household Render deployment, real Amazon session and TinyFish run; owner still must sign in and enable. No paid TinyFish calls, secrets, live Plaid records or hosting changes.

