# Phase A — household accounting foundation (October 17, 2026)

This stage is implemented with fictional and future Plaid-shaped records. **No live Plaid connection, credentials, or server authentication** is present. Static GitHub Pages is not a secure home for real banking tokens.

## Modules and invariants

- `accounting.js` is the deterministic, read-only household accounting layer. Account IDs are authoritative; names are labels. Account metadata can be registered from verified provider results; unknown accounts remain explicitly `unknown` until metadata arrives.
- `ledger-data.js` stores the account registry in `accounts[]`. `migrate()` remains backward-compatible. `records(state)` presents source rows enriched with effective accounting classifications, category decisions, refund signs and transfer matches without mutating `transactions[]`.
- All credit-card purchases are expenses when charged, not when the checking payment clears. Matching checking debits and card credits are `card_payment` / `type:'transfer'`, excluded from spending and earned income. Checking/savings movements are `internal_transfer`.
- Matching retains **both** source entries, sets a stable `transferGroupId` and `pairedTransactionId`, requires equal amount, distinct account IDs, opposite direction and dates within five days, and requires unambiguous transfer/payment evidence. Equal-dollar competing matches remain unmatched and require review.
- Plaid credit-card credits without a clear origin are marked `unclassified_card_credit` and excluded from earned income; uncertain cases are surfaced by reconciliation status. A strong merchant refund label creates `type:'refund'` and a negative `spendingAmount`. Same-merchant, same-account refunds inherit the category of their original purchase or its manual category override where supportable.
- The user-facing Budget and Insights actuals consume derived spending amounts, including negative refunds. Recurring predictions read effective transaction classes and do not learn patterns from card payments as expenses or refunds as payroll. Original amounts/dates/accounts remain read-only.
- `applyPlaidSync` accepts provider-fetched `accounts[]` and optional `itemId`, preserves signed source Plaid amounts in `source.plaidAmount`, and stores individual cursors under `sync.itemCursors[itemId]`. Existing no-Item demo sync retains `sync.plaidCursor`. Pending-posted ID changes carry category overrides and remove the pending predecessor; all transaction/source facts remain provider-authoritative.

## Verification

`tests/accounting-phaseA-smoke.cjs` tests two checking accounts, savings, Visa and Amex, mirrored and partial card payments, unmatched/ambiguous credits, a refund, payroll, savings interest, source immutability, separate Plaid cursors, pending-to-posted replacement, and Budget/Insights/Settings in Chromium and iPhone Safari. Existing regression tests still run unchanged.

## Deliberately reserved for Phase B/C

Phase A **does not** calculate real credit-card liability balances, statement cycles, minimum payment schedules, aggregate net worth, or fully separate future cash-flow curves for each bank account. Phase B must use strictly assigned forecast event IDs and explicit paired credit-card settlements before displaying bank-connected cash forecasts. Phase C must add extensive multi-account stress testing and conservation identities (per-account postings, net-zero internal transfers, refund reversals, statement and pending balance cases).

There is no live bank authentication, Plaid connection, verified account balance ingestion, transfer partner linking from Plaid, or cross-device persistence.


## Phase B — unified per-account and card-liability forecast (October 17, 2026)

**Status: deployed on fictional data only; Plaid remains disconnected.** The new
\`account-forecast.js\` reads provider-shaped, dated balance snapshots, already
reconciled expected events from \`forecast-ledger.js\`, and forecast-only movements
stored in \`predictions.accountMovements\`.

- Depository accounts track opening **current** balances, and report **available**
  separately where the source supplies it. Neither source number is edited.
  The household cash-less-card-debt measure uses **current**, not available, for
  accounting consistency; available cash may differ because of holds and pending
  postings.
- Credit cards track **positive liability (money owed)**. A projected card purchase
  increases card debt, a card refund reduces card debt, and a linked card payment
  reduces both the checking cash balance and the card liability by the same
  amount. Credit available limit is **never** treated as spendable bank cash.
- A reviewed future transfer has one economic ID and two account legs; it cannot
  increase household income or spending or change cash less card debt.
  The model also joins mirrored predicted transfers when the historical source
  bank transactions are demonstrably paired. Explicit user plans suppress the
  same inferred movements instead of paying a card twice.
- Future events must resolve to **one** known account by stable ID or unique
  historical account label. Missing/ambiguous assignments and unsupported
  balances are **excluded with diagnostics**, not broadcast across accounts.
  Single-sided/unpaired transfers are flagged and household forecasts are marked
  incomplete rather than asserting accounting reconciliation.
- Scheduled cash spending and forecast income affect only the resolved deposit
  account; spending expected on a card accrues to **card debt immediately** at
  expected purchase date. Payment date is modeled independently.
- \`predictions.accountMovements\` supports one-off and weekly, every-two-weeks,
  monthly, quarterly, semiannual and annual estimated movements, with short-month
  day clamping. This is **not** an automatic statement-payoff calculator.
  User-entered forecasts never become posted transactions or provider balances.
- Budget shows a concise **Accounts · next 90 days** table, a cash/card-debt/net
  summary and a simple account-movement editor. The existing checking chart uses
  this same per-account event set. All displayed numbers remain labeled
  simulated until a real, authenticated banking backend exists.
- \`tests/account-forecast-phaseB-smoke.cjs\` checks six fictional accounts
  (including three cards), two-sided payment conservation, partial settlement,
  refunds, mixed cash/card expenses, ambiguity, duplicate suppression, 90-day
  recurrence, source immutability and Chromium/iPhone Safari UI behavior.

**Phase C priorities:** Plaid multi-Item stress fixtures; independently dated
account balances and missing/stale snapshots; payment retries, ACH reversals,
multiple payments on the same date, ambiguous card credits, account disconnection
and cross-bank transfers; statement-cycle/minimum-due logic; and reconciliation
between changing credit-card current balance and posted transaction cutoffs.
Never claim future bank-safe available funds or a complete household position
until actual account snapshots are fresh and reconciled.
