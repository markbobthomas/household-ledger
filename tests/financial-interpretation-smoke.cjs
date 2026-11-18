'use strict';
// Phase-2 contract: one read-only classification/reporting boundary and one
// recurrence evidence source shared by Forecast, Reviews and Coverage.
// Every account, amount and transaction below is fictional.
const assert=require('node:assert/strict');
const Accounting=require('../accounting.js');
const M=require('../ledger-data.js');
const Core=require('../planner-core.js');
const Categorization=require('../categorization.js');
const History=require('../planner-history.js');
const Shared=require('../planner-transactions.js');
const accounts=[
 {id:'checking',name:'Example Checking',type:'checking',accountType:'checking'},
 {id:'savings',name:'Example Savings',type:'savings',accountType:'savings'},
 {id:'card',name:'Example Visa',type:'credit',accountType:'credit'}
];
const bank=(id,date,merchant,amount,type='expense',accountId='checking',extra={})=>({
 id,date,merchant,amount,type,accountId,accountType:accountId==='card'?'credit':'checking',
 pending:false,...extra
});
const pfc={primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_MORTGAGE_PAYMENT'};
assert.equal(Accounting.classifyPlaidSource({
 amount:2500,merchant:'Home Mortgage ACH',description:'Home Mortgage ACH',pfc
},accounts[0],Categorization).type,'expense','Mortgage is an external cash bill');
const cardSettled=Accounting.classifyPlaidSource({
 amount:300,merchant:'Example Visa Credit Card Payment',description:'Credit Card Payment',
 pfc:{primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'}
},accounts[0],Categorization);
assert.equal(cardSettled.type,'transfer','Card settlement is not a second expense');
assert.equal(cardSettled.transfer,true);
assert.equal(Accounting.classifyPlaidSource({
 amount:-2000,merchant:'Employer Payroll',description:'Direct Deposit',
 pfc:{primary:'INCOME',detailed:'INCOME_WAGES'}
},accounts[0],Categorization).type,'income','Bank payroll is earned income');
// F-04: an unlabeled cash credit must not become earned income or a
// repeating deposit without affirmative bank evidence or owner confirmation.
const pfcWage={primary:'INCOME',detailed:'INCOME_WAGES'};
const fictional=M.migrate({});
const added=[
 {transaction_id:'mystery-a',account_id:'cash',amount:-35,date:'2026-08-04',
  merchant_name:'Fictional Store',name:'Fictional Store'},
 {transaction_id:'mystery-b',account_id:'cash',amount:-35,date:'2026-09-04',
  merchant_name:'Fictional Store',name:'Fictional Store'},
 {transaction_id:'mystery-c',account_id:'cash',amount:-35,date:'2026-10-04',
  merchant_name:'Fictional Store',name:'Fictional Store'},
 {transaction_id:'payroll-credit',account_id:'cash',amount:-1200,date:'2026-10-05',
  merchant_name:'Example Payroll',name:'Direct Deposit',personal_finance_category:pfcWage},
 {transaction_id:'explicit-refund',account_id:'cash',amount:-17,date:'2026-10-06',
  merchant_name:'Refund Fictional Market',name:'Refund Fictional Market'},
 {transaction_id:'bank-transfer',account_id:'cash',amount:-70,date:'2026-10-07',
  merchant_name:'Transfer from Savings',name:'Transfer from Savings',
  personal_finance_category:{primary:'TRANSFER_IN',detailed:'TRANSFER_IN_ACCOUNT_TRANSFER'}}
];
M.applyPlaidSync(fictional,{itemId:'example-item',
 accounts:[{account_id:'cash',name:'Example Checking',type:'depository',subtype:'checking'}],
 added,modified:[],removed:[],nextCursor:'a'});
const sourceBefore=JSON.stringify(fictional.transactions),creditId='plaid:example-item:mystery-c';
const raw=f=>f.transactions.find(x=>x.id===creditId);
assert.equal(raw(fictional).type,'transfer','Plaid import must not label unidentified cash credits income');
const rows=M.records(fictional),mystery=rows.find(t=>t.id===creditId);
assert.equal(mystery.type,'transfer');
assert.equal(mystery.accountingKind,'unclassified_credit');
assert.equal(mystery.reconciliationStatus,'needs-review');
assert.equal(Accounting.reportingMeasures(mystery).postedIncomeCents,0);
assert.equal(M.accountingView(fictional).summary.income,1200,'Only the recognized paycheck counts');
assert.equal(rows.find(t=>t.source.providerTransactionId==='explicit-refund').type,'refund');
assert.equal(rows.find(t=>t.source.providerTransactionId==='bank-transfer').type,'transfer');
assert.equal(M.categoryReviewQueue(fictional).transactions.filter(t=>t.creditKind).length,3);
const cashAccounts=[{id:'cash',name:'Example Checking',type:'checking',accountType:'checking'}];
assert.equal(Core.analyze(rows,cashAccounts,'2026-10-20').automatic.filter(e=>
 e.type==='income'&&e.merchant==='Fictional Store').length,0,
 'Three identical unidentified credits are not payroll evidence');
assert.equal(History.recommendedRepeating(rows,cashAccounts,'2026-10-20').filter(e=>
 e.type==='income'&&e.merchant==='Fictional Store').length,0,
 'An ambiguous cash inflow is not a proposed recurring paycheck');
fictional.reviews.transactionKinds[creditId]='refund';
assert.equal(M.records(fictional).find(t=>t.id===creditId).type,'refund');
assert.equal(M.accountingView(fictional).summary.income,1200);
fictional.reviews.transactionKinds[creditId]='income';
assert.equal(M.accountingView(fictional).summary.income,1235,'Owner-approved income counts once');
assert.equal(M.categoryReviewQueue(fictional).transactions.some(t=>t.id===creditId),false);
fictional.reviews.transactionKinds[creditId]='transfer';
assert.equal(M.records(fictional).find(t=>t.id===creditId).type,'transfer');
assert.equal(M.accountingView(fictional).summary.income,1200,'Confirmed transfer is not earned income');
delete fictional.reviews.transactionKinds[creditId];
assert.equal(M.categoryReviewQueue(fictional).transactions.some(t=>t.id===creditId),true,
 'Resetting the decision returns the unidentified credit to Review');
assert.equal(JSON.stringify(fictional.transactions),sourceBefore,
 'Credit review changes preferences only, not immutable bank source records');
const Model=require('../ledger-data.js');
const unknownFromBank=Accounting.classifyPlaidSource({
 amount:-43.17,merchant:'Shop refund without reference',description:'ACH CREDIT 8019',pfc:{primary:'OTHER'}
},accounts[0],Categorization);
assert.equal(unknownFromBank.type,'transfer','An unidentified checking credit must not be called income');
assert.equal(Accounting.classifyPlaidSource({
 amount:-43.17,merchant:'Purchase Return Store',description:'Purchase Return Store',pfc:{primary:'OTHER'}
},accounts[0],Categorization).type,'refund','Explicit merchant returns remain refunds');
const possibleRefund=Model.migrate({
 accounts:[{id:'checking',name:'Example Checking',type:'checking'}],
 transactions:[bank('unknown-credit','2026-10-10','Shop credit',43.17,'transfer','checking',{
  description:'ACH CREDIT 8019',cashDirection:'in',source:{provider:'plaid',plaidAmount:-43.17,verified:true}
 })]
});
const untouched=JSON.stringify(possibleRefund.transactions);
const ambiguousCredit=Model.records(possibleRefund)[0];
assert.equal(ambiguousCredit.accountingKind,'unclassified_credit');
assert.equal(ambiguousCredit.reconciliationStatus,'needs-review');
assert.equal(ambiguousCredit.earnedIncomeAmount,0);
assert.equal(Accounting.reportingMeasures(ambiguousCredit).postedIncomeCents,0);
assert.ok(Model.categoryReviewQueue(possibleRefund).transactions.some(t=>
 t.id==='unknown-credit'&&t.creditKind),'Uncertain checking credit is visible in Review');
for(const [decision,expectedType,earned,spending] of [
 ['income','income',43.17,0],['refund','refund',0,-43.17],['transfer','transfer',0,0]]){
 possibleRefund.reviews.transactionKinds={'unknown-credit':decision};
 const result=Model.records(possibleRefund)[0];
 assert.equal(result.type,expectedType,'Owner chose '+decision);
 assert.equal(result.earnedIncomeAmount,earned);
 assert.equal(result.spendingAmount,spending);
 assert.equal(result.reconciliationStatus,'confirmed');
 assert.ok(!Model.categoryReviewQueue(possibleRefund).transactions.some(t=>
  t.id==='unknown-credit'&&t.creditKind),'Confirmed credit does not remain an unclassified credit');
}
possibleRefund.reviews.transactionKinds={};
assert.equal(Model.records(possibleRefund)[0].reconciliationStatus,'needs-review',
 'Clearing an owner decision returns the credit to Review');
assert.equal(JSON.stringify(possibleRefund.transactions),untouched,'Classification decisions must never mutate source bank rows');
const expense=bank('purchase','2026-10-03','Purchase',85.12);
const refund=bank('refund','2026-10-05','Refund',13.19,'refund','card');
const pending=bank('pending','2026-10-06','Pending Grocery',22.25,'expense','checking',{pending:true});
const income=bank('pay','2026-10-07','Employer Payroll',3000,'income');
const transfer=bank('transfer','2026-10-08','Savings Transfer',400,'transfer','checking',
 {cashDirection:'out',accountingKind:'internal_transfer',pairedTransactionId:'other'});
const manual=bank('owner','2026-10-09','Childcare ACH',59,'transfer','checking',
 {cashDirection:'out',method:'manual',accountingKind:'internal_transfer',reconciliationStatus:'unmatched',category:'Childcare'});
const before=JSON.stringify([expense,refund,pending,income,transfer,manual]);
assert.equal(Accounting.reportingMeasures(expense).postedSpendingCents,8512);
assert.equal(Accounting.reportingMeasures(refund).purchaseCents,-1319);
assert.equal(Accounting.reportingMeasures(pending).postedSpendingCents,0);
assert.equal(Accounting.reportingMeasures(pending).provisionalPendingSpendingCents,2225);
assert.equal(Accounting.reportingMeasures(income).postedIncomeCents,300000);
assert.equal(Accounting.reportingMeasures(transfer).postedSpendingCents,0);
assert.equal(Accounting.reportingMeasures(manual).manualOutflowCents,5900,
 'A specifically categorized unpaired debit may count as spending, not a matched transfer');
assert.equal(History.categorizedOutflowCents(manual),5900,
 'History consumes the shared classification rather than reclassifying independently');
const settlementIds=new Set(['purchase','refund']);
assert.equal(Accounting.reportingMeasures(expense,settlementIds).postedSpendingCents,0,
 'Confirmed settlement evidence wins over merchant-category interpretation');
assert.equal(Accounting.reportingMeasures(refund,settlementIds).purchaseCents,0);
assert.equal(Accounting.forecastSpendingCents({kind:'event',type:'expense',amount:100}),10000);
assert.equal(Accounting.forecastSpendingCents({kind:'event',type:'refund',amount:25}),-2500);
assert.equal(Accounting.forecastSpendingCents({kind:'movement',type:'transfer',amount:100}),0);
assert.equal(JSON.stringify([expense,refund,pending,income,transfer,manual]),before,
 'Report measures never mutate provider rows');
const cardCredit=bank('card-credit','2026-10-14','Payment Received',500,'transfer','card',
 {cashDirection:'in',accountingKind:'card_payment'});
const cashDebit=bank('cash-debit','2026-10-13','ACH PMT Example Visa',500,'expense','checking',
 {cashDirection:'out'});
const settlements=Accounting.budgetCardSettlementIds([cardCredit,cashDebit]);
assert.deepEqual([...settlements].sort(),['card-credit','cash-debit']);
assert.deepEqual([...History.budgetCardSettlementIds([cardCredit,cashDebit])].sort(),
 [...settlements].sort(),'Budget and History use one settlement decision');
const ambiguity=Accounting.budgetCardSettlementIds([cardCredit,cashDebit,
 {...cashDebit,id:'second-debit',date:'2026-10-14'}]);
assert.equal(ambiguity.size,0,'Ambiguous matching must not silently cancel another bank debit');

const wageRows=[
 bank('pay-a','2026-08-01','Shared Employer',2900,'income'),
 bank('pay-b','2026-09-01','Shared Employer',3100,'income'),
 bank('pay-c','2026-10-01','Shared Employer',2900,'income'),
 bank('pay-other','2026-10-01','Shared Employer',2900,'income','savings')
];
const source=JSON.stringify(wageRows);
const grouped=Shared.recurrenceEvidence(wageRows,accounts,'2026-10-20',{
 eligible:r=>!r.pending,typeOf:r=>r.type
});
assert.equal(grouped.size,2,'Streams remain account-specific, even for identical merchants');
const checking=[...grouped.values()].find(g=>g.accountId==='checking');
assert.equal(checking.rows.length,3,'Variable amounts share one merchant/direction evidence stream');
assert.equal(checking.id,['checking','income',Shared.merchantKey('Shared Employer')]
 .map(encodeURIComponent).join('|'));
const byAmount=Shared.recurrenceEvidence(wageRows,accounts,'2026-10-20',{
 includeAmount:true,typeOf:r=>r.type
});
assert.equal(byAmount.size,3,'Compatibility Review keys retain optional amount identity');
assert.equal(Shared.recurrenceCadence(['2026-09-03','2026-10-03'],'forecast'),'monthly');
assert.equal(Shared.recurrenceCadence(['2026-08-01','2026-09-01','2026-10-01'],'review'),'monthly');
assert.equal(Shared.recurrenceCadence(['2026-08-02','2026-09-03','2026-10-02'],'coverage'),'monthly');
assert.equal(Shared.recurrenceCadence(['2026-09-04','2026-09-18'],'forecast'),'biweekly');
assert.equal(JSON.stringify(wageRows),source,'Recurrence evidence does not rewrite historical rows');
console.log('PASS phase-2 shared classification, signed reporting, card settlement, stream identity, policy-specific cadence and immutable facts');
