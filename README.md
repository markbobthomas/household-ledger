# Household Ledger — Balance Planner

A focused, main-checking-first cash planning tool. The interface is organized into three focused tabs rather than the earlier budget, merchant, itemization, Insights and Reviews screens and implements the owner's planning decisions:

- Main checking is the default focus, and a different cash account can be selected as the saved **main account**.
- Automatically suggest **three-or-more evidence-based recurring payments** only when the latest observed amounts agree to the cent and dates are consistent; bills, mortgage, insurance and subscriptions qualify, while incidental shopping, groceries, gas and variable-amount spending do **not**.
- Present each suggested account/merchant pattern for a one-time **Confirm** or **Not repeating** choice; save this preference with the existing encrypted Real planning adjustments and reopen review if the amount materially changes.
- Plan a credit-card's **full-statement autopay** with an explicit paying checking account. Enter actual last statement amount, close date, withdrawal and due dates. Following statements remain unconfirmed estimates.
- Show **month-end available cash after dated payments**, **lowest balance in 90 days**, and **first projected negative balance date**.
- Defer optional what-if modifications: the owner chose to prioritize prediction accuracy.
- Add a **Prediction accuracy** section that runs only when requested, checking past forecasts against later bank transactions.

The interface retains:

- Bank-reported checking, savings and credit-card balances.
- A clearly labeled **provisional** 30/60/90-day balance trajectory derived from dated forecasts.
- A readable list of future expected money in and money out, with visible bank freshness and uncertainty.

**The existing full Ledger has not been erased.** Before the reset, an identical copy of the original default branch (commit `53975e8672ab56fb5b29bf14ff94dc1746987928`) was saved to [`backup/full-ledger-before-balance-planner-2026-10-19`](https://github.com/markbobthomas/household-ledger/tree/backup/full-ledger-before-balance-planner-2026-10-19).

## Actual billing-period activity vs. estimated future card payments

The card billing preview now lists **every retrieved settled card expense and refund dated within that card's own billing cycle**, with a transaction-by-transaction disclosure and exact net sum (purchases minus refunds). All card transactions are included, not just repeating ones. Pending transactions remain excluded from the posted sum until posted. A cycle not yet closed shows actual spending-to-date and **separately** shows identified future charges; a closed cycle uses the actual retrieved period net without future guesses. The net purchases total is a **bank-transaction sum, not necessarily the issuer's statement balance** (carried debt, issuer adjustments, interest and fees can differ). The user can enter the issued statement amount when known, and that overrides the planning amount for the already-closed period.

The configured future autopay date is a **planned** withdrawal date, not a bank-verified real payment date. Once the actual payment is posted and reconciled between the explicitly selected paying account and the credit card, the UI shows its **real posting date and amount** and suppresses the duplicate forecast transfer. A posted payment with an amount differing from the previous estimate also suppresses a duplicate full payment but triggers a warning to reconcile any possible remaining balance. With no matched posted bank transaction, the app never asserts that the future payment is actual.

Tests: `tests/card-statement-cycles-smoke.cjs` validates closed-cycle posted totals, open-cycle separate estimates, exact selected paying account, real posted dates, variable posted payment amounts, and source immutability.

## Credit-card billing cycle forecasts and linked autopay

In **Settings → Credit-card statements & autopay**, configure **each connected credit card individually**. Enter the first/last dates of a real billing period (the end is the statement closing date), next payment due date, actual bank withdrawal date, and the checking/savings account that automatically pays that card. The **issued statement balance** is optional: if a statement was already issued, its entered amount takes precedence for that period. Otherwise the app estimates the statement from the connected card's settled charges less refunds within that period, plus verified or owner-defined future recurring purchases on that card before the statement closes. A pending purchase is not silently treated as posted.

The same cycle start/end and due/withdrawal dates advance month by month, respecting short months and leap years. Each card shows a preview of the next statement amount, dates and funding account in Settings; the Overview also lists each card's next predicted bill. Cards without autopay can still show an estimated statement, but **no checking withdrawal is fabricated** and the planner warns about missing payment coverage. One completed bank transfer matched on both its checking and credit-card legs suppresses the corresponding predicted autopay so checking is never debited a second time.

**Limits:** This is a partial projection, not a bank-issued statement or guaranteed future amount. It only knows current connected posted transactions and identified future charges; it does not invent unknown groceries/shopping, fees, interest, carried debt or merchant refunds. An incorrectly linked account or incomplete Plaid history can affect the estimate. Nothing in Settings changes the bank's actual autopay instructions.

Regression: `node tests/card-statement-cycles-smoke.cjs` and `node tests/payment-obligations-smoke.cjs`.

## Forecast-only saves are independent from bank transaction updates

Confirming a recurring payment in **History** or **Reviews**, editing future payments, adjusting a card schedule, and choosing a main account now persist only the planner's `predictions` settings via the authenticated `POST /api/ledger/forecasts` endpoint. The old `/api/ledger/adjustments` path included saved transaction category overrides and could reject a perfectly valid forecast update if one of those overrides referred to a deleted or otherwise unavailable transaction. The forecast endpoint does **not** resubmit categories, raw Plaid transactions, balances, or provider tokens. It validates the forecast payload, preserves other settings, encrypts the saved state using the existing private storage, and acknowledges saves before the interface considers a user-confirmed forecast persisted.

The interface reports meaningful forecast-save errors and restores the prior prediction settings on failure. Failed requests remain retryable; subsequent saves and bank refreshes are not blocked by a stale rejected write. Private bank transactions remain read-only. The backend connection is used only as durable, authenticated storage for the *user's forecast preferences*, not as a way of changing their account or sending payments.

Regression coverage: `node tests/forecast-only-save-smoke.cjs`, `node tests/forecast-client-save-smoke.cjs`, and the Real-mode browser scenario in `tests/planner-browser.cjs`.

## Two dedicated tabs: actual History and payment Reviews

**History** lists every retrieved actual bank transaction (posted and pending), newest first, with account filtering, merchant/date/amount search and progressive loading for larger histories. The bank facts stay read-only. For settled expenses and income, **Make recurring** opens a proposed forecast with the source merchant, selected account, dollar amount, expected next date and frequency, editable before saving. It saves only `predictions.futureRecurringRules`, never a bank transaction.

**Reviews** centralizes uncertain patterns, existing stable-routine confirmations, and missing mortgage warnings. A new separate bank-history scanner detects **two exact-amount payments on a compatible recurring calendar/weekly schedule** (rather than waiting for three) and also offers a review for one clearly recognizable bill or Plaid recurring/mortgage category. These low-confidence findings do **not** debit the future balance until the user chooses **Review and confirm** and saves the frequency and next payment date. **Not recurring** stores a dismissal under `predictions.historyPatternDecisions`, which survives browser refresh and private Real mode through existing saved prediction adjustments. A new amount becomes a new review candidate. The existing three-observation model may still predict confidently recurring payments, and they are also reviewed in the Reviews tab rather than Settings.

The scanner is conservative about pending transactions, refunds, internal transfers, unrelated cards and accounts, lapsed activity, source gaps and already scheduled predictions. Confirmed manual recurring rules supersede matching inferred predictions to avoid duplicate withdrawals. Neither the History list nor the review queue is written to client localStorage in Real mode. Regression: `node tests/planner-history-smoke.cjs` and the desktop Chromium/iPhone WebKit UI test.

## Missing mortgage review from actual bank history

The strict automatic recurrence engine deliberately requires three similar monthly payments and a sufficiently complete recent history. That protects against fictional charges but can omit a real bill when a Plaid connection has only one or two months of history.

The planner independently checks **actual settled bank transactions** for mortgage descriptions or Plaid mortgage codes. If a recent mortgage is not present in the forecast, an explicit **Possible missing mortgage — not in forecast** panel appears on Overview, Transactions and Settings. It lists the **real dollar amount and paying account**, a suggested next monthly date based on the last posting day, and up to four source transaction examples. **Review and schedule** opens a prefilled but editable monthly payment form; **nothing enters the balance forecast until the user saves it**. **Not recurring** dismisses false positives persistently. The detector ignores stale mortgage activity, credit-card purchases, and mortgages already represented in the projected schedule. Bank source records are unchanged.

The app cannot infer a mortgage from a fully unrecognized merchant with no mortgage-specific bank category, or from transactions that the bank has not synced at all. In those cases use **Transactions → Add transaction** and enter the mortgage manually. The review date is a suggested **posting** date, not a verified lender due date.

Regression: `node tests/planner-missing-mortgage-smoke.cjs`.

## Confirm a recurring payment when automatic detection misses it

Any dated future transaction can now be converted into a repeating forecast from **Transactions → Edit → This and all future payments**. Choose a frequency (weekly, every two weeks, twice a month, monthly, quarterly, semiannual or annual) and save. These controls are available even if the prediction engine did **not** recognize a recurring pattern. For a bill missing from the entire future list, choose **+ Add transaction**, enter the account, merchant, amount and date, and select **Repeat** rather than One time.

For previously unrecognized payments, the editor offers **Help identify matching past payments**. It lists safe candidates with the same merchant, amount, bank account and transaction direction. The user can tick actual examples to explicitly confirm which historical payments belong to this series. If none match, the user can still define the frequency and amount manually, rather than have the planner guess. This does not edit bank history or assume that every incoming transfer is payroll.

The confirmed schedule is saved under `predictions.futureRecurringRules` and generates dated transactions for the entire forecast window and successive windows. When the original predicted charge is recognized, it is suppressed in favor of the owner-confirmed one, matching its **original** merchant/account/amount and original calendar pattern even when the new forecast shifts dates or amounts. The app never charges the same expected expense twice solely because the user corrected its recurrence. Per-payment exceptions remain supported; edits to one of the later confirmed recurring occurrences retain the earlier dates. Confirmed recurrence on a linked transfer updates both account legs. **Stop repeating** removes the confirmed rule and restores any historical automatic predictions that remain eligible.

Tests: `node tests/planner-recurring-confirmation-smoke.cjs`, `node tests/planner-series-smoke.cjs`, and the browser regression suite.

## Three-tab planning workspace

- **Overview** (default): summary of bank-reported current balances, projected month-end cash, lowest balance in the selected 30/60/90-day horizon, a short balance curve, and the next five expected movements. Select a main account to change the focus; click **View all and edit** to jump to Transactions.
- **Transactions**: chronological predicted transactions from **all linked accounts**, filterable by account. The page lists both manually planned and inferred future transactions, including income, bills, card purchases and paired card/account transfers. Click **Edit** to choose **This payment only** or **This and all future payments** for an identified recurring series. The recurring option saves a continuing forecast rule for that account and merchant, rather than only changing the three months currently visible. Change its amount, payment date, description, or applicable funding account; monthly rules use the chosen day of the month and twice-monthly/biweekly schedules retain their spacing. A recurring card autopay remains a linked, two-account movement. **Reset all future changes** restores automatic forecasts; **Reset this occurrence** removes a single exception. **Skip this occurrence** excludes only that one dated prediction. Click **+ Add transaction** to create a dated withdrawal, deposit, refund or linked transfer between two connected accounts, or **Remove** to delete a manually added one. All calculations immediately update account projections. The visible list respects the selected 30/60/90-day horizon; the app does not allow adding an invisible future date beyond it.
- **History**: bank-posted and pending transactions, account/search filters and user-confirmed conversion to recurring forecasts.
- **Reviews**: low-confidence two-payment recurrence candidates, identified one-off bills, routine confirmations and missing mortgages.
- **Settings**: credit-card statement payment setup, cash-cushion warning threshold, private bank connection, and the on-demand historical prediction audit.

Forecast overrides are stored in `predictions.futureTransactionEdits` and one-off additions in `predictions.futureTransactionAdds`. Existing bank facts remain immutable. The Demo saves only **fictional planning settings** in localStorage; Real saves planning adjustments through the encrypted private server. No Plaid token or real bank transaction is stored in localStorage.

When a future credit-card payment or transfer is edited, the balance engine posts one paired movement, updating both accounts exactly once. Editing a future card purchase also flows into later *estimated* statement-payment calculations. Editing an inferred recurring occurrence does not silently rewrite the entire repeating rule; routine confirmation/schedule settings remain separate. The app never initiates payments.

Regression checks: `node tests/planner-transactions-smoke.cjs` and the existing planner browser, mortgage and card-payment suites.

## Recurring income and paycheck safety

The Real/Plaid importer and the shared historical reconciliation engine recognize explicitly identified **payroll / salary / direct-deposit income**, including deposits Plaid places under generic `TRANSFER_IN` when merchant evidence is strong. Plaid `INCOME_WAGES` evidence is also recognized. Unlabeled ACH credits, transfers between household checking/savings, card settlements, refunds, and cash advances are **not** assumed to be earned income.

Recurring monthly, twice-monthly and biweekly income can enter the 90-day balance forecast when dates and history substantiate it. Bills still require exact-cent recurring amounts. Earned income that changes by up to 10% across the latest three comparable paychecks may use the **lowest** recent paycheck as a conservative dated estimate; greater variance remains excluded.

The **Overview > Expected income** section reports the number and total of dated income estimates for the selected account. If none qualify, it explains whether posted income exists but has no reliable recurrence, unverified inbound transfers are present, or bank paychecks have not been recognized. On the **Transactions** page, a missing deposit can be planned manually without changing the underlying Plaid bank records.

Regression tests: `node tests/planner-income-smoke.cjs` covers Plaid-coded payroll, exact and slightly variable monthly earnings, first-and-fifteenth and biweekly deposits, ordinary internal transfers and card payment exclusions.

## Historical prediction audit

Select your checking account and click **Check accuracy** in the main header. The planner runs the historical check immediately, scrolls to **Prediction accuracy**, and expands the report. Alternatively, open the optional **Prediction accuracy** panel and click **Run historical check**. The app tests up to six completed months on the selected account. For each month, it reconstructs predictions from transactions that had posted by the preceding month-end. Current recurring confirmations, future transactions and current card-statement settings are **not** applied retroactively.

It reports (1) how many predicted dated payments matched posted bank transactions, (2) how many repeatable posted transactions were captured, and (3) mortgage/bill misses, amount changes, extra/duplicate forecasts. Only candidate repeating bills and predictable payroll are eligible; ordinary shopping, gas and variable expenses are excluded. A test month with insufficient prior transaction-history coverage or no posted bank activity is skipped, not counted as a perfect forecast. If there is insufficient history, the panel says so rather than inventing a score.

This audits **amount and date predictions**, not an account's historical bank balance (past statement-balance snapshots are not available). Full-statement credit-card autopay is not scored without archived statement balances; observed historical card settlements are counted separately. Partial or missing bank sync history can still affect results. The report stays in temporary browser memory, no new records or adjustment settings are saved, and no external analytics service is called. The Real/Plaid and Demo modes use the same algorithm.

The historical regression suite is `node tests/planner-backtest-smoke.cjs`; GitHub Actions also run the browser and existing mortgage/statement tests.

## Safety and infrastructure

GitHub ownership, the GitHub Pages demo pipeline, the existing Render services, the private password-protected Plaid connection routes, and the encrypted server-side bank source store are retained.

This reset changes the **frontend**, not the authenticated bank connector or existing encrypted transaction records. There is no banking migration or credential re-entry required by this commit. The new interface does not write real bank data to browser localStorage. Existing historical and planning adjustments remain in the existing server-backed state and can still influence draft predictions. No mortgage, income or credit-card prediction should be considered a guaranteed future payment.

The separate `render.yaml` blueprint currently describes the **fictional hosted Sandbox**; it is not a replacement for an independently configured private Real/Plaid service. In the public Pages and fictional Sandbox modes, balances are sample data. Only a correctly configured private service can show live bank data.

## Files

- `index.html`, `planner.css`, `planner.js`: the new, intentionally small interface.
- `planner-intelligence.js`: conservative exact-amount repeat filter, validated calendar spacing and forecast dates, cadence-aware staleness limits, and durable confirm/exclude decisions.
- `planner-backtest.js`: read-only walk-forward test engine that computes historical recurring-payment match and coverage statistics.
- `planner-transactions.js`: validates and persists forecast-only one-off edits, additions, skipped occurrences, and paired-account movement edits.
- `pilot/server.cjs`, `pilot/data-source.js`, `pilot/index.html`: existing authenticated Plaid server and bank connection flow.
- `account-forecast.js`, `forecast-ledger.js`, `forecast.js`, `payment-obligations.js`, `ledger-data.js`, `accounting.js`: retained read-only calculation and classification machinery.
- `tests/planner-browser.cjs`, `tests/planner-parity.cjs`: new planner-focused browser and source-parity checks.

Older analysis and budgeting source files/tests remain in Git history and in the backup branch. They are **not loaded** by the new page. The optional what-if/simulation feature is explicitly deferred until prediction accuracy is established. Bank source records are immutable and real planning settings are persisted through the existing authenticated `/api/ledger/adjustments` endpoint.

## Test

The GitHub Actions workflows check the new demo and private-Real planner layouts, mobile browser usability, bank-feed security, statement and mortgage accounting invariants, source parity, and existing reconciliation invariants. Recurrence regressions now include correct month-to-month spacing, quarterly versus monthly charges, annual evidence, old inactive bills, forecast-day drift, and repeated charges within a single month. No actual Plaid credentials are used in automated browser tests.

This application **does not initiate or schedule bank payments**. It predicts balances and shows uncertainties.

Recurring-payment changes are forecast assumptions, not changes to actual bank-issued instructions or automatic payment authorizations. Only forecast events identified as recurring offer the all-future option; a one-time manually added event remains single-use. Regression: `node tests/planner-series-smoke.cjs`.
