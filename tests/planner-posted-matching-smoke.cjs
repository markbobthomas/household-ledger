'use strict';
const assert=require('node:assert/strict');
const T=require('../planner-transactions.js'),Core=require('../planner-core.js');
const asOf='2026-10-22';
const accounts=[{id:'checking',name:'Fictional Checking',accountType:'checking',
 current:8000,available:8000,simulated:true},
 {id:'other',name:'Fictional Other',accountType:'checking',
 current:3000,available:3000,simulated:true}];
const snapshot={asOf,accounts,mode:'demo'};
const post=(id,merchant,amount,date='2026-10-21',accountId='checking')=>
 ({id,merchant,amount,date,accountId,type:'expense',pending:false});
function newRule(state,merchant,amount,date='2026-10-24'){
 return T.defineRecurring(state,{
   date,merchant,amount,type:'expense',accountId:'checking',frequency:'monthly',
   separateSchedule:'on',category:'Utility'
  },accounts,asOf);
}
function cover(state,records,through='2026-11-30'){
 const rules=state.predictions.futureRecurringRules;
 return T.postedCoverage(T.generatedRecurring(rules,asOf,through),
  rules,records,accounts,asOf);
}
const unique={predictions:{}};
const utility=newRule(unique,'Fictional Power',125);
const posted=post('posted-renamed','Unrecognizable Bank ACH',200);
const id=T.linkPostedToSchedule(unique,posted.id,utility.id,[posted],accounts);
assert.equal(id,utility.id);
assert.ok(unique.predictions.futureRecurringRules[0].exampleIds.includes(posted.id));
const covered=cover(unique,[posted]);
assert.ok(!covered.events.some(e=>e.date==='2026-10-24'),
 'Explicit bank transaction ID prevents double counting even if Plaid renamed the merchant and bill amount changed');
assert.ok(covered.events.some(e=>e.date==='2026-11-24'),
 'Only the matching future occurrence is suppressed; later utility bills remain');
const verified=Core.materialize(snapshot,[posted],unique.predictions,T,null,70);
assert.equal(verified.postedMatchReview.length,0);
assert.ok(!verified.ledger.some(e=>e.ruleId===utility.id&&e.date==='2026-10-24'));
assert.ok(verified.ledger.some(e=>e.ruleId===utility.id&&e.date==='2026-11-24'));
assert.ok(verified.projection.diagnostics.balanceMismatches.length===0);
const independent={predictions:{}},water=newRule(independent,'Fictional Water',100),
 irrigation=newRule(independent,'Fictional Water',200);
const uncertain=post('posted-uncertain','Fictional Water',150);
const before=cover(independent,[uncertain]);
assert.equal(before.review.length,1,'Competing similarly timed bills with uncertain amounts need one actionable review');
assert.deepEqual(new Set(before.review[0].candidates.map(c=>c.ruleId)),
 new Set([water.id,irrigation.id]));
assert.equal(before.events.filter(e=>e.date==='2026-10-24').length,2,
 'Uncertain posted bank payment does not silently erase an independent obligation');
const bankCopy=JSON.stringify(uncertain);
T.linkPostedToSchedule(independent,uncertain.id,irrigation.id,[uncertain],accounts);
assert.equal(JSON.stringify(uncertain),bankCopy,'Confirming a bank link never alters bank facts');
const decided=cover(independent,[uncertain]);
assert.equal(decided.review.length,0);
assert.ok(decided.events.some(e=>e.ruleId===water.id&&e.date==='2026-10-24'),
 'The unrelated independent bill remains due');
assert.ok(!decided.events.some(e=>e.ruleId===irrigation.id&&e.date==='2026-10-24'),
 'Confirmed posted payment suppresses exactly its intended schedule occurrence');
assert.equal(decided.events.filter(e=>e.date==='2026-11-24').length,2);
assert.equal(independent.predictions.futureRecurringRules.length,2,
 'Review choices link existing schedules, never create new ones');
const clear={predictions:{}},low=newRule(clear,'Fictional Water',100),
 high=newRule(clear,'Fictional Water',200);
const unambiguous=cover(clear,[post('clear','Fictional Water',100)]);
assert.equal(unambiguous.review.length,0,
 'Strong exact-amount evidence may disambiguate independent streams without adding a review');
assert.ok(!unambiguous.events.some(e=>e.ruleId===low.id&&e.date==='2026-10-24'));
assert.ok(unambiguous.events.some(e=>e.ruleId===high.id&&e.date==='2026-10-24'));
const otherAccount=cover(unique,[post('bad-account','Unrecognizable Bank ACH',200,'2026-10-21','other')]);
assert.ok(otherAccount.events.some(e=>e.date==='2026-10-24'),
 'A payment on another account never covers a checking schedule');
assert.throws(()=>T.linkPostedToSchedule(unique,'bad-account',utility.id,
 [post('bad-account','Unrecognizable Bank ACH',200,'2026-10-21','other')],accounts),/Bank account/);
const pending={...posted,pending:true};
assert.ok(cover(unique,[pending]).events.some(e=>e.date==='2026-10-24'),
 'Pending transactions do not prematurely suppress confirmed predictions');
const distant={predictions:{}};
newRule(distant,'Fictional Service',175,'2026-10-30');
assert.ok(cover(distant,[post('distant','Fictional Service',175,'2026-10-01')]).events
 .some(e=>e.date==='2026-10-30'),'A distant earlier payment in the same calendar month must not remove a later bill');
// Regression: a due withdrawal that has not posted must not silently vanish
// into an already-reported bank balance. Pending is not posted; refresh is.
const overdueAsOf='2026-10-27',overdueSnapshot={mode:'demo',asOf:overdueAsOf,
 accounts:accounts.map(a=>({...a}))},overdueRule={
 id:'unpaid-housing',kind:'event',accountId:'checking',type:'expense',
 anchorDate:'2026-10-26',frequency:'monthly',amount:1600,
 merchant:'Fictional Housing',scheduleLabel:'Fictional Housing'
},overduePrefs={futureRecurringRules:[overdueRule]},options={weekendPolicy:'friday'};
const missed=Core.materialize(overdueSnapshot,[],overduePrefs,T,null,65,options);
assert.equal(missed.overduePayments.length,1,'A due but unposted bill enters Review');
assert.equal(missed.overduePayments[0].expectedDate,'2026-10-26');
assert.deepEqual(missed.ledger.filter(e=>e.ruleId===overdueRule.id).map(e=>e.date).slice(0,2),
 ['2026-10-28','2026-11-26'],'Carry one missed debit, not a duplicate or shifted future schedule');
assert.equal(missed.projection.accounts.find(a=>a.id==='checking').series.find(p=>p.date==='2026-10-28').balance,6400,
 'Projected checking balance reserves the missed debit once');
const unsettled=[post('unsettled','Fictional Housing',1600,'2026-10-26')];
unsettled[0].pending=true;
const pendingDue=Core.materialize(overdueSnapshot,unsettled,overduePrefs,T,null,65,options);
assert.equal(pendingDue.overduePayments.length,1,'Pending bank activity does not count as a posted debit');
const sourcePosted=post('settled','Fictional Housing',1600,'2026-10-27');
const postedDue=Core.materialize(overdueSnapshot,[sourcePosted],overduePrefs,T,null,65,options);
assert.equal(postedDue.overduePayments.length,0,'Refreshed posted bank data clears the alert');
assert.ok(!postedDue.ledger.some(e=>e.ruleId===overdueRule.id&&e.date==='2026-10-28'),
 'The already-posted occurrence cannot debit the forecast again');
assert.equal(postedDue.ledger.filter(e=>e.ruleId===overdueRule.id).length,1,
 'Later regular monthly recurrence remains anchored');
assert.equal(sourcePosted.date,'2026-10-27','Actual bank transaction is read-only');
console.log('PASS posted matching: explicit bank ID, renamed merchant, variable amount, ambiguous independent streams, chosen schedule, immutable bank facts, month boundary and reconciliation');
