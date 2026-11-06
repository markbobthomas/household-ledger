'use strict';
// Phase-2 contract: one read-only classification/reporting boundary and one
// recurrence evidence source shared by Forecast, Reviews and Coverage.
// Every account, amount and transaction below is fictional.
const assert=require('node:assert/strict');
const Accounting=require('../accounting.js');
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
