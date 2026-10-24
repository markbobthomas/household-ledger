'use strict';
const assert=require('node:assert/strict');
const C=require('../planner-core.js');
const T=require('../planner-transactions.js');
const P=require('../payment-obligations.js');
globalThis.HouseholdPlannerTransactions=T;
const R=require('../planner-recommendations.js');
const accounts=[{id:'checking',name:'Checking',accountType:'checking',current:10000,available:10000}],
 snapshot={asOf:'2026-10-20',accounts};
const bank=[
 {id:'m1',accountId:'checking',date:'2026-08-05',merchant:'Mortgage Test',amount:2400,type:'expense',category:'Housing'},
 {id:'m2',accountId:'checking',date:'2026-09-05',merchant:'Mortgage Test',amount:2400,type:'expense',category:'Housing'},
 {id:'m3',accountId:'checking',date:'2026-10-05',merchant:'Mortgage Test',amount:2400,type:'expense',category:'Housing'},
 {id:'p1',accountId:'checking',date:'2026-09-18',merchant:'Test Employer',amount:3100,type:'income'},
 {id:'p2',accountId:'checking',date:'2026-10-02',merchant:'Test Employer',amount:2800,type:'income'},
 {id:'p3',accountId:'checking',date:'2026-10-16',merchant:'Test Employer',amount:3100,type:'income'}
];
const state={predictions:{}};
const first=C.materialize(snapshot,bank,state.predictions,T,P,90);
assert.equal(first.ledger.filter(x=>x.merchant==='Mortgage Test').length,0,
 'An inferred mortgage cannot be counted until a saved schedule exists');
assert.ok(first.automaticRecurrence.events.some(x=>x.merchant==='Mortgage Test'),
 'Inference evidence still exists to recommend the recurring mortgage');
const candidateBundle={...first,bankRecommendationCandidates:[]};
const discovered=R.reconcile({},candidateBundle,[],bank,accounts);
const mortgage=discovered.items.find(x=>x.merchant==='Mortgage Test');
assert.ok(mortgage,'The missing mortgage must be a persistent recommended repeat');
assert.equal(mortgage.decision,'pending');
state.predictions.recurringRecommendations=discovered.stored;
R.setIgnored(state,mortgage.key,true);
const ignored=R.reconcile(state.predictions.recurringRecommendations,{},
 [],[],accounts);
assert.equal(ignored.items.find(x=>x.key===mortgage.key).decision,'ignored',
 'Ignored entries persist even if bank history or detection disappears');
R.setIgnored(state,mortgage.key,false);
const item=R.reconcile(state.predictions.recurringRecommendations,candidateBundle,
 [],bank,accounts).items.find(x=>x.key===mortgage.key);
assert.equal(item.decision,'pending','Ignored items can always be reconsidered');
const saved=T.defineRecurring(state,{date:item.nextDate,
 merchant:item.merchant,amount:item.amount,type:item.type,
 accountId:item.accountId,frequency:item.frequency},
 accounts,snapshot.asOf,{kind:'event',accountId:item.accountId,
 type:'expense',merchant:item.merchant,date:'2026-10-05',amount:item.amount,
 bankTransactionId:'m3'},bank,['m1','m2','m3']);
const forecast=C.materialize(snapshot,bank,state.predictions,T,P,90);
assert.ok(forecast.ledger.some(x=>x.merchant==='Mortgage Test'),
 'Only approved saved mortgage schedules debit the forecast');
assert.ok(!forecast.ledger.some(x=>String(x.id).startsWith('auto|')),
 'No automatic inferred event reaches the canonical future ledger');
const scheduled=R.reconcile(state.predictions.recurringRecommendations,{},[
 saved],bank,accounts).items.find(x=>x.key===mortgage.key);
assert.equal(scheduled.decision,'scheduled',
 'The original recommendation remains visible as Scheduled');
assert.equal(JSON.stringify(bank),JSON.stringify([
 {id:'m1',accountId:'checking',date:'2026-08-05',merchant:'Mortgage Test',amount:2400,type:'expense',category:'Housing'},
 {id:'m2',accountId:'checking',date:'2026-09-05',merchant:'Mortgage Test',amount:2400,type:'expense',category:'Housing'},
 {id:'m3',accountId:'checking',date:'2026-10-05',merchant:'Mortgage Test',amount:2400,type:'expense',category:'Housing'},
 {id:'p1',accountId:'checking',date:'2026-09-18',merchant:'Test Employer',amount:3100,type:'income'},
 {id:'p2',accountId:'checking',date:'2026-10-02',merchant:'Test Employer',amount:2800,type:'income'},
 {id:'p3',accountId:'checking',date:'2026-10-16',merchant:'Test Employer',amount:3100,type:'income'}
]),'Nothing in the bank source changed');
const split=R.reconcile({},{
 automaticRecurrence:{events:[
  {_seriesKey:'series|checking|income|employer|every-4-weeks|phase1',accountId:'checking',type:'income',merchant:'Employer',date:'2026-11-13',amount:3100,cadence:'every-4-weeks'},
  {_seriesKey:'series|checking|income|employer|every-4-weeks|phase15',accountId:'checking',type:'income',merchant:'Employer',date:'2026-11-27',amount:2800,cadence:'every-4-weeks'}
 ]}
},[],[],accounts);
assert.equal(split.items.length,2,'Independent alternating paychecks are not merged into a single proposed plan');
console.log('PASS approved-only forecasts, permanent ignored recommendations, reversible decisions, saved schedule ownership and split payroll');
