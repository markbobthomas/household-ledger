'use strict';
const assert=require('node:assert/strict');
const payments=require('../payment-obligations.js');
const accountForecast=require('../account-forecast.js');
const Model=require('../ledger-data.js');
const snapshot={asOf:'2026-10-19',mode:'demo',accounts:[
 {id:'checking-1',name:'Checking',accountType:'checking',current:5000,available:4800,simulated:true},
 {id:'visa',name:'Visa',accountType:'credit',current:1000,simulated:true}
]};
const state=Model.migrate({});
Model.setCardPaymentRule(state,'visa',{
 fromAccountId:'checking-1',closingDay:18,lastStatementClose:'2026-10-18',
 nextPaymentDate:'2026-11-12',lastStatementBalance:1000,method:'statement'});
Model.setCashCushion(state,500);
Model.savePaymentBill(state,{name:'Mortgage',fromAccountId:'checking-1',date:'2026-11-01',
 amount:2800,frequency:'monthly',category:'Housing'});
const future=[
 {id:'visa-purchase',date:'2026-10-22',accountId:'visa',type:'expense',merchant:'Groceries',amount:300},
 {id:'mortgage-bank-pattern',date:'2026-11-01',accountId:'checking-1',type:'expense',merchant:'Mortgage',amount:2800}
];
const generated=payments.build(snapshot,[],future,state.predictions,{days:90});
assert.equal(generated.plans[0].amount,1000,'Next payment is issued statement, not current card debt plus new purchases');
assert.equal(generated.plans[0].fromAccountId,'checking-1');
assert.ok(generated.statements.some(x=>x.dueDate==='2026-12-12'&&x.estimated),'Later statements are explicitly estimates');
assert.ok(generated.warnings.length===0,'Valid schedules do not invent warnings');
assert.equal(generated.billEvents.length,2,'Existing November mortgage is not double-counted; December and January are retained');
const multi=accountForecast.build(snapshot,[...future,...generated.billEvents],generated.plans,{days:90,records:[]});
const check=multi.accounts.find(a=>a.id==='checking-1'),card=multi.accounts.find(a=>a.id==='visa');
assert.equal(check.series.find(x=>x.date==='2026-10-22').balance,4800,
 'A credit-card purchase cannot deduct checking');
assert.equal(card.series.find(x=>x.date==='2026-10-22').balance,1300,
 'Card purchase raises debt');
assert.equal(check.series.find(x=>x.date==='2026-11-01').balance,2000,
 'Mortgage lowers checking once, even when user supplied a duplicate bill rule');
assert.equal(check.series.find(x=>x.date==='2026-11-12').balance,1000,
 'Statement autopay deducts funded checking on its withdrawal date');
assert.equal(card.series.find(x=>x.date==='2026-11-12').balance,300,
 'Same transfer lowers card debt');
assert.equal(multi.diagnostics.pairedMovements.filter(x=>x.date==='2026-11-12').length,1,
 'One autopay produces only one reconciled two-sided movement');
assert.equal(multi.household.conservationDifference,0,
 'A card payment changes no household net worth and does not count as a second expense');
assert.equal(multi.household.expectedSpending>=3100,true,
 'Groceries plus mortgage are spending; card payment is not additional spending');
const missing=payments.build(snapshot,[],[],{paymentRules:{visa:{fromAccountId:'missing',closingDay:18,lastStatementClose:'2026-10-18',nextPaymentDate:'2026-11-12',lastStatementBalance:1000}}});
assert.equal(missing.plans.length,0,'Never route a payment to a guessed or disconnected account');
assert.ok(missing.warnings.length,'Missing payment source must show a warning');
assert.throws(()=>Model.setCardPaymentRule(state,'visa',{fromAccountId:'checking-1',closingDay:18,lastStatementClose:'2026-11-13',nextPaymentDate:'2026-11-12',lastStatementBalance:1000}),/valid billing period/);
const direct=payments.build(snapshot,[],[],{paymentBills:[{id:'mort',name:'Mortgage',fromAccountId:'checking-1',date:'2026-11-01',amount:2800,frequency:'monthly',category:'Housing'}]});
assert.equal(direct.billEvents.length,3,'Explicit monthly mortgage is projected on each date within 90 days');
// UI statement dividers use exact saved closing dates; never infer an
// issuer cycle without them or mistakenly label a payment as a purchase.
const cycle={billingStartDate:'2026-10-01',billingEndDate:'2026-10-31',closingDay:31};
const period=date=>payments.statementPeriodFor(cycle,date);
assert.deepEqual(period('2026-10-01'),{start:'2026-10-01',end:'2026-10-31'});
assert.deepEqual(period('2026-10-31'),{start:'2026-10-01',end:'2026-10-31'});
assert.deepEqual(period('2026-11-01'),{start:'2026-11-01',end:'2026-11-30'});
assert.deepEqual(period('2027-02-28'),{start:'2027-02-01',end:'2027-02-28'});
assert.deepEqual(period('2026-09-30'),{start:'2026-09-01',end:'2026-09-30'});
assert.deepEqual(payments.statementPeriodFor(
 {billingStartDate:'2024-01-31',billingEndDate:'2024-01-31',closingDay:31},'2024-02-29'),
 {start:'2024-02-01',end:'2024-02-29'});
assert.equal(payments.statementPeriodFor({},'2026-10-01'),null,
 'No guessed statement period on an unconfigured card');
assert.equal(payments.statementPeriodFor(cycle,'not-a-date'),null);
// Statement comparisons remain advisory. A period-matched issuer amount
// cannot silently overwrite a calculated payment or source card history.
const issuerSnapshot={...snapshot,mode:'connected',connected:true,accounts:[
 {...snapshot.accounts[0]}, {...snapshot.accounts[1],
  liabilities:{last_statement_balance:55,last_statement_issue_date:'2026-10-18',
   next_payment_due_date:'2026-11-12'}}]};
const cardRows=[
 {id:'premium',accountId:'visa',date:'2026-10-03',
  amount:27.25,type:'expense',merchant:'Fictional Insurance PYMT',accountingKind:'purchase'},
 {id:'app',accountId:'visa',date:'2026-10-05',
  amount:19.40,type:'expense',merchant:'Fictional App PYMT',accountingKind:'purchase'}];
const issuerRule={paymentRules:{visa:{
 fromAccountId:'checking-1',billingStartDate:'2026-09-19',
 billingEndDate:'2026-10-18',closingDay:18,nextPaymentDate:'2026-11-12',
 method:'statement'}}};
const discrepancy=payments.build(issuerSnapshot,cardRows,[],issuerRule,{days:45});
assert.equal(discrepancy.statements[0].bankPurchases,46.65);
assert.equal(discrepancy.plans[0].amount,46.65,'The issuer comparison must not silently change a forecast');
assert.equal(discrepancy.statements[0].statementReconciliation.status,'difference');
assert.equal(discrepancy.statements[0].statementReconciliation.source,'issuer-reported');
assert.equal(discrepancy.statements[0].statementReconciliation.difference,8.35);
assert.ok(discrepancy.warnings.some(w=>w.includes('issuer-reported')&&w.includes('identified card activity')),
 'Issuer mismatch must be visible in forecast warnings');
assert.ok(discrepancy.warningActions.some(w=>w.kind==='card-statement-difference'));
const noMatchedIssuer=payments.build({...issuerSnapshot,accounts:[
 issuerSnapshot.accounts[0],
 {...issuerSnapshot.accounts[1],liabilities:{
  ...issuerSnapshot.accounts[1].liabilities,last_statement_issue_date:'2026-09-18'}}
]},cardRows,[],issuerRule,{days:45});
assert.equal(noMatchedIssuer.statements[0].statementReconciliation.status,'no-period-matched-issued-amount',
 'Old statements must not be compared with the wrong cycle');

console.log('PASS card purchases never debit checking; statement autopay debits checking and debt once; mortgage dedupe; future estimated statements; missing funding warnings; model validation');
