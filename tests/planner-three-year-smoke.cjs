'use strict';
const assert=require('node:assert/strict');
const Core=require('../planner-core.js');
const Schedules=require('../planner-transactions.js');
const Payments=require('../payment-obligations.js');
const accounts=[{id:'checking',name:'Fictional Checking',accountType:'checking',
 current:100000,available:100000,simulated:true}];
const snapshot={asOf:'2026-10-22',mode:'demo',accounts};
const state={predictions:{}};
Schedules.defineRecurring(state,{date:'2026-10-29',merchant:'Fictional Weekly Bill',
 amount:25,accountId:'checking',type:'expense',frequency:'weekly'},accounts,snapshot.asOf);
const original=JSON.stringify(state);
const forecast=Core.materialize(snapshot,[],state.predictions,Schedules,Payments,1095);
const checking=forecast.projection.accounts.find(a=>a.id==='checking');
const bill=forecast.ledger.filter(e=>e.merchant==='Fictional Weekly Bill');
assert.equal(checking.series.length,1096,'Three-year minimum uses every daily balance');
assert.ok(bill.length>=155,'Confirmed weekly schedule does not stop at 60 payments');
assert.ok(bill.some(e=>e.date>'2029-01-01'),'Weekly forecast extends into third year');
assert.equal(checking.minimum,checking.series.reduce((m,p)=>Math.min(m,p.balance),Infinity));
assert.equal(JSON.stringify(state),original,'Long forecasts do not modify saved schedules');
assert.equal(forecast.projection.diagnostics.balanceMismatches.length,0,
 'Long-range daily balance reconciliation remains exact');
const history=['2026-09-28','2026-10-05','2026-10-12','2026-10-19']
 .map((date,i)=>({id:'weekly-'+i,date,merchant:'Fictional Cleaning Service',
 amount:15,type:'expense',accountId:'checking',pending:false}));
const inferred=Core.analyze(history,accounts,snapshot.asOf,{},1095).automatic
 .filter(e=>e.merchant==='Fictional Cleaning Service');
assert.ok(inferred.length>=150,'Inferred weekly recurring payments cover the entire horizon');
const cards=[...accounts,{id:'visa',name:'Fictional Visa',accountType:'credit',
 current:200,available:null,simulated:true}];
const configured={paymentRules:{visa:{
 billingStartDate:'2026-09-19',billingEndDate:'2026-10-18',
 nextPaymentDate:'2026-11-11',nextDueDate:'2026-11-12',
 fromAccountId:'checking',autopayEnabled:true,method:'fixed',fixedAmount:75,
 closingDay:18
}}};
const cardPlan=Payments.build({...snapshot,accounts:cards},[],[],configured,{days:1095});
const cardDates=cardPlan.plans.filter(p=>p.toAccountId==='visa').map(p=>p.anchorDate);
assert.ok(cardDates.length>=34,'Confirmed fixed card autopay is not truncated after 18 months');
assert.ok(cardDates.some(d=>d>'2029-01-01'),
 'Confirmed card autopay remains in the final forecast year');
console.log('PASS three-year forecast: daily minima, weekly and inferred recurrence, fixed card payments, immutable preferences and reconciliation');
