'use strict';
const assert=require('node:assert/strict');
const T=require('../planner-transactions.js');
const C=require('../planner-core.js');
const H=require('../planner-history.js');
const P=require('../payment-obligations.js');
const accounts=[{id:'checking',name:'Main Checking',type:'depository',accountType:'checking',
 current:2500,available:2500,simulated:true}];
const asOf='2026-10-20',snapshot={asOf,mode:'demo',accounts};
const paycheck=(id,date,amount,merchant='North Coast Payroll',accountId='checking')=>({
 id,date,merchant,type:'income',amount,accountId,pending:false,
 personal_finance_category:{detailed:'INCOME_WAGES'}});
const history=[
 paycheck('a1','2026-08-14',3020),
 paycheck('b1','2026-08-28',3075),
 paycheck('a2','2026-09-11',3020),
 paycheck('b2','2026-09-25',3075),
 paycheck('a3','2026-10-09',3020)
],frozen=JSON.stringify(history);
const inferred=C.materialize(snapshot,history,{},T,P,90);
const actual=inferred.ledger.filter(e=>e.type==='income'&&e.merchant==='North Coast Payroll');
assert.deepEqual(actual.map(e=>e.date),[
 '2026-10-23','2026-11-06','2026-11-20','2026-12-04',
 '2026-12-18','2027-01-01','2027-01-15'
].filter(d=>d<='2027-01-18'),'Forecast exactly one payday every 14 days');
assert.deepEqual(actual.map(e=>e.amount),[3075,3020,3075,3020,3075,3020,3075],
 'A/B alternating payroll keeps distinct similar amounts, not their average');
assert.equal(inferred.ledger.filter(e=>e.merchant==='North Coast Payroll').length,actual.length);
const draft=H.draftFor(history.at(-1),history,accounts,asOf);
assert.equal(draft.frequency,'biweekly');
assert.equal(draft.amountPattern,'alternating','History suggests alternating pattern');
assert.equal(draft.amount,3075,'Next expected pay follows last $3020 with $3075');
assert.equal(draft.alternateAmount,3020,'Following paycheck alternates back');
assert.deepEqual(draft.examples,history.map(t=>t.id));
const state={predictions:{}},options={
 merchant:'My Paycheck',type:'income',accountId:'checking',date:'2026-10-23',
 amount:3075,amountPattern:'alternating',alternateAmount:3020,frequency:'biweekly'
};
const rule=T.defineRecurring(state,options,accounts,asOf,null,history,history.map(t=>t.id));
assert.equal(rule.amountPattern,'alternating');
assert.equal(rule.alternateAmount,3020);
assert.ok(rule.matchNames.includes('north coast payroll'));
let confirmed=C.materialize(snapshot,history,state.predictions,T,P,90);
assert.deepEqual(confirmed.ledger.filter(e=>e.type==='income').map(e=>e.amount),
 actual.map(e=>e.amount),'One confirmed rule replaces inferred alternating paychecks completely');
assert.equal(confirmed.ledger.filter(e=>e.type==='income').length,actual.length,
 'Forecast does not double-count one source with alternating values');
assert.equal(state.predictions.futureRecurringRules.length,1);
const repeated=T.defineRecurring(state,{...options,merchant:'North Coast Payroll',
 date:'2026-10-23',amount:3075,alternateAmount:3020},accounts,asOf,
 history.at(-1),history,history.map(t=>t.id));
assert.equal(repeated.id,rule.id,'Conflicting same-merchant recurrences merge into one');
assert.equal(state.predictions.futureRecurringRules.length,1);
assert.equal(C.materialize(snapshot,history,state.predictions,T,P,90).ledger
 .filter(e=>e.type==='income').length,actual.length);
const feb=T.generatedRecurring([rule],'2026-12-25','2027-03-01');
assert.deepEqual(feb.events.slice(0,4).map(e=>e.amount),[3020,3075,3020,3075],
 'Alternating phase stays tied to the original anchor across forecast windows');
assert.throws(()=>T.defineRecurring({predictions:{}},{...options,alternateAmount:0},
 accounts,asOf),/valid second paycheck amount/);
assert.throws(()=>T.defineRecurring({predictions:{}},{...options,frequency:'monthly'},
 accounts,asOf),/Alternating amounts require Every 2 weeks/);
const fixed={predictions:{}};
T.defineRecurring(fixed,{...options,amountPattern:'fixed',alternateAmount:''},accounts,asOf);
assert.deepEqual(T.generatedRecurring(fixed.predictions.futureRecurringRules,asOf,'2026-11-25')
 .events.map(e=>e.amount),[3075,3075,3075],
 'One-amount biweekly paychecks remain supported');
const modified={...snapshot,asOf:'2026-10-27'};
const posted=[...history,paycheck('b3','2026-10-22',3078)];
const paid=C.materialize(modified,posted,state.predictions,T,P,90);
assert.equal(paid.ledger.filter(e=>e.date==='2026-10-23').length,0,
 'A real posted paycheck with slightly different amount covers the scheduled payday');
assert.ok(paid.ledger.some(e=>e.date==='2026-11-06'&&e.type==='income'),
 'The next alternating payday still appears after an early bank posting');
assert.equal(JSON.stringify(history),frozen,'Plaid actuals remain immutable');
const salaryOther=[paycheck('q1','2026-08-14',3020,'Other Employer'),
 paycheck('q2','2026-08-28',3075,'Other Employer'),
 paycheck('q3','2026-09-11',3020,'Other Employer'),
 paycheck('q4','2026-09-25',3075,'Other Employer')];
const both=C.materialize(snapshot,[...history,...salaryOther],state.predictions,T,P,90);
assert.ok(both.ledger.some(e=>e.merchant==='Other Employer'),
 'An unrelated paycheck is not suppressed because its amount is similar');
console.log('PASS alternating biweekly pay: auto A/B inference, History defaults, one user series, manual override, restart-stable phase, no duplicate, posted coverage and independent employers');
