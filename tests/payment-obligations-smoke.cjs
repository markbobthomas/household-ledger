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
assert.throws(()=>Model.setCardPaymentRule(state,'visa',{fromAccountId:'checking-1',closingDay:18,lastStatementClose:'2026-11-13',nextPaymentDate:'2026-11-12',lastStatementBalance:1000}),/valid statement/);
const direct=payments.build(snapshot,[],[],{paymentBills:[{id:'mort',name:'Mortgage',fromAccountId:'checking-1',date:'2026-11-01',amount:2800,frequency:'monthly',category:'Housing'}]});
assert.equal(direct.billEvents.length,3,'Explicit monthly mortgage is projected on each date within 90 days');
console.log('PASS card purchases never debit checking; statement autopay debits checking and debt once; mortgage dedupe; future estimated statements; missing funding warnings; model validation');
