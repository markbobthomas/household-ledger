# Plaid integration: authoritative bank ledger and editable predictions

**Status (Oct 2026): Planned — no live bank connection, authentication, or banking tokens.** The publicly deployed static UI uses fictional demo feeds and browser-local storage. Do not request or expose credentials in a static site.

## Source of truth

The app must never let users manually change bank transaction facts. These are sourced by Plaid's authenticated transaction sync:

- A secure backend creates a Plaid Link token and performs the public-token exchange; store encrypted Plaid access tokens **server-side only** under an authenticated household.
- Fetch account identities and balances separately. Opening cash balances for projections come from authenticated account snapshots; **not from a manually entered value**. Persist observation timestamps and whether balance is *available* or *current*.
- Use Plaid `/transactions/sync` with all pages/cursors and webhooks. Normalize transactions using stable provider transaction IDs and account IDs. Reconcile `added`, `modified`, `removed`, and pending-to-posted replacements; never duplicate a charge.
- Keep account-specific ledgers separate. Classify transfers and credit-card settlement properly so spending isn't double-counted across checking and card accounts. Treat Plaid amount sign conventions correctly (money out vs. money in); take care with refunds, reversals and balance availability.
- Bank transactions are **server-authoritative**. The server is the only actor permitted to change transaction facts. Expose a read-only transaction API and a separate authenticated user-preferences API; do not expose client endpoints that accept arbitrary transaction rows.
- Store encrypted tokens, secure household access control, webhook validation, retention/deletion rights, relink flow, secret rotation, audit logs and a provider timestamp.

`ledger-data.js` implements a draft client-side normalization contract via `applyPlaidSync()` and records `source.provider='plaid'` with stable IDs. This is a **preparatory data model**, not an active Plaid integration or a security control.

## Editable decisions — separate tables / collections

1. `transaction_category_overrides`: `household_id`, `bank_transaction_id`, `category`, `changed_at`. Category corrections are overlays, never rewritten bank transaction records. Preserve mappings through pending-to-posted ID reconciliation.
2. `prediction_settings`: household/account, `month`, category, monthly budget and future additional-spending override. Automatic predictions remain separate from posted totals.
3. `forecast_stream_overrides`: account, inferred stream ID, expected amount, due day, include/exclude status. These edit *predicted* recurring transactions only.
4. `forecast_one_off_events`: account, expected date, direction, amount, user description. Never part of the actual transaction ledger.
5. `forecast_variable_daily`: account-level average daily future spending override.

Actuals and forecasts must remain visually and logically distinct. The current blue budget bar represents recorded spending and hot pink represents predicted remaining spending. User forecast adjustments can shift the projected balance/date, but **never** mutate the authoritative balance or recorded transactions.

## What works now

- Read-only transaction lists, category-only corrections, prediction editors and data migration are implemented in static browser UI.
- Historical records are labeled `legacy-unverified` because the provenance of previously imported or manually entered browser data can't be validated retroactively.
- Fictional bank feed in `bank-feed.js` anchors the demonstrator's 90-day projection and is **intentionally isolated** from local source records.
- Browser-local edits are not synchronized between devices; no actual banking data is fetched.

## Next implementation

1. Implement a small authenticated household API with encrypted database and Plaid Sandbox connection.
2. Implement the server-controlled ingest/upsert/tombstone transaction sync pipeline, account balance snapshots and deduplication; verify pending/posted and multiple linked institutions.
3. Persist category/prediction overrides server-side under household permissions and reconcile them to stable transaction identities.
4. Replace `bank-feed.js` demo adapter with the authenticated account snapshot/transaction API, while retaining an explicit demo mode. Never put tokens in GitHub Pages.
5. Add tests for Plaid Sandbox, stale balances, same-account filtering, refunds/transfers, account removals, webhooks, consent/relink/disconnect and no mutations from client forms.

## Documentation

- [Plaid Link](https://plaid.com/docs/link/)
- [Plaid Transactions](https://plaid.com/docs/transactions/)
- [Plaid Balance](https://plaid.com/docs/balance/)
- [Plaid Recurring](https://plaid.com/docs/api/products/transactions/#transactionsrecurringget)
