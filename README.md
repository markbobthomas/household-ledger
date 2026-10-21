# Household Ledger — Balance Planner

Household Ledger is a cash balance prediction tool. Its job is intentionally narrow:

1. Read **actual** connected account balances and transactions through Plaid.
2. Find likely dated future deposits and withdrawals using transaction history.
3. Materialize exactly **one future transaction ledger**, editable by the account owner.
4. Project each account's daily balance solely from that ledger.
5. Surface uncertain patterns for review instead of inventing confident payments.

## Architecture

```
Plaid read-only snapshot
  ├── Actual bank ledger (immutable posted and pending transactions)
  └── Current balances (the sole starting balances)
               ↓
planner-core.js → analyze() → automatic transactions + Review candidates
               ↓
planner-transactions.js → confirmed rules + edits + one-off additions
               ↓
planner-core.js → materialize() → ONE canonical future ledger
               ├── event: one deposit / withdrawal / card purchase / refund
               └── movement: one linked transfer with exactly two account legs
               ↓
planner-core.js → project() → dated balance series / monthly availability / lowest point
```

The balance calculator does not recognize merchants, mortgages, or subscriptions. It only processes the finalized dated ledger. No other forecasting engine may feed balances; this is the central design rule.

The only financial specialty is a credit-card statement/autopay adapter (`payment-obligations.js`), which adds linked payments to the **same future ledger** before balance calculation. A card purchase raises that card's projected debt but does not debit checking until a separately forecast linked card payment occurs. Card statements are estimates unless an issued amount was entered, and no payments are initiated.

### Key files

- `planner-core.js`: one generalized bank-history analyzer, canonical future-ledger builder, pure balance calculator, and walk-forward accuracy audit.
- `planner-transactions.js`: saved owner decisions; recurring schedules, one-off additions, skips, and transaction edits.
- `planner-history.js`: history display and manual recurring-payment form suggestions. It does not feed balances.
- `payment-obligations.js`: linked credit-card statements/autopay, kept separate from ordinary pattern inference.
- `planner.js`, `planner.css`, `index.html`: same unified interface in Demo and Real mode.
- `ledger-data.js`, `accounting.js`, `categorization.js`: normalize the Plaid transactions without editing their source facts.
- `pilot/server.cjs`, `pilot/data-source.js`: retained authenticated Plaid connector and encrypted private forecast-preference storage.
- `sandbox/server.cjs`: optional fictional hosted Sandbox, **not** the private production bank server.

Legacy forecasting files remain in Git for historical test compatibility but are **not loaded by the application**.

## Predictive rules

- Every settled payment is analyzed by **bank account, merchant identity, posting cadence and money direction**. Dollar amounts are not part of recurring-payment identity: a utility or paycheck remains one stream even when the amount changes.
- Clearly identifiable monthly bills can forecast from one recent posting. Stable patterns can forecast automatically; variable utilities and net pay use the average of the latest three relevant actual transactions when repeated timing supports the inference. Ordinary variable shopping requires stronger proof. An owner-confirmed amount overrides automatic estimates.
- Weekly, biweekly, twice-monthly, monthly, quarterly, semiannual, and annual patterns are supported. For **alternating biweekly income**, create **two separate Every 4 weeks** recurring deposits, anchored 14 days apart. Each has its own amount, recurring rule, editable forecast and stop control, even when both come from the same employer. After two complete cycles, stable A/B payroll may also be recognized automatically as two independent four-week streams. Changes, unclear transfers, inconsistent timing, and other doubtful patterns belong in **Reviews**.
- A single incidental retail purchase does not become a new predicted debit or flood Reviews.
- An owner's confirmed recurring rule **supersedes the matching inferred series**. Individual exceptions and all-future edits are applied to the ledger, not to actual bank transactions.
- **Not recurring** in Future Transactions or History stops every inferred or confirmed occurrence for the original account, merchant, and direction, even if the predicted amount or name was edited. Settings lists those exclusions with **Allow predictions** to undo an error. A rejected pattern stays rejected after a Plaid refresh; posted bank history is never changed.
- The ledger is regenerated when a bank feed refreshes, but saved user decisions persist through the authenticated forecast-only endpoint. Real bank transaction records are never written to client localStorage.
- A paired household transfer is one ledger movement applied once to each associated account. Credit-card statement payment is a linked movement, not a second purchase. No payments are initiated.

## What can be edited?

Open **Future Transactions** to edit one future payment, change a recurring schedule, skip/restore an occurrence, or add a new dated transaction. To link an estimated utility bill or recurring paycheck to its real Plaid history, choose a recurring frequency and expand **Link related actual transactions**. Search the actual bank payee, select the relevant historical payments (different amounts are fine), and save. This creates **one** manually controlled schedule instead of a competing auto-prediction. When an earlier payment posts in its billing cycle, that cycle is not forecast again. Open **History** to turn *any actual transaction* into a confirmed recurring forecast without changing its bank classification. **Reviews** holds unconfirmed possible repeats. **Settings** holds card payment assumptions, warnings, and an optional historical prediction accuracy audit that now tests the *same new engine*.

## Security and deployment

The source of truth for opening balances is the latest Plaid-reported bank snapshot, with freshness shown to the user. Plaid credentials are not exposed to the public Demo, and only the password-protected Real service accesses encrypted connected-bank state. Planned transactions and owner overrides are stored separately from immutable bank history. Production deployment configuration is retained.

The previous production code was preserved as `backup/pre-unified-future-ledger-2026-10-20`. The original complete ledger before the earlier Balance Planner reset is also preserved as `backup/full-ledger-before-balance-planner-2026-10-19`.

## Verification

```bash
node tests/planner-core-smoke.cjs
node tests/planner-recurrence-integration-smoke.cjs
node tests/planner-parity.cjs
node tests/pilot-security-smoke.cjs
node tests/pilot-plaid-flow.cjs
node tests/card-statement-cycles-smoke.cjs
node tests/forecast-only-save-smoke.cjs
node tests/forecast-client-save-smoke.cjs
```

The dedicated rebuild workflow also checks the desktop Chromium and mobile WebKit interface. A successful unit test alone does not certify live Plaid or a Render deployment. Never use fictional Demo numbers as real household balances.
