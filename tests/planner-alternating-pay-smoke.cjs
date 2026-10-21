'use strict';
const assert=require('node:assert/strict'),T=require('../planner-transactions.js'),
 C=require('../planner-core.js'),H=require('../planner-history.js'),P=require('../payment-obligations.js');
const accounts=[{id:'checking',name:'Main Checking',type:'depository',
 accountType:'checking',current:2500,available:2500,simulated:true}];
const asOf='2026-10-20',snapshot={asOf,mode:'demo',accounts};
const check=(id,date,amount,merchant='North Coast Payroll',accountId='checking')=>({
 id,date,merchant,type:'income',amount,accountId,pending:false,
 personal_finance_category:{detailed:'INCOME_WAGES'}});
const history=[
 check('a1','2026-08-14',3020),check('b1','2026-08-28',3075),
 check('a2','2026-09-11',3020),check('b2','2026-09-25',3075),
 check('a3','2026-10-09',3020)
],frozen=JSON.stringify(history);
const horizon=()=>C.materialize(snapshot,history,{},T,P,90);
const own=p=>C.materialize(snapshot,history,p,T,P,90);
const income=p=>own(p).ledger.filter(e=>e.type==='income'&&e.accountId==='checking');
const initial=horizon().ledger.filter(e=>e.merchant==='North Coast Payroll');
assert.deepEqual(initial.map(e=>e.date),[
 '2026-10-23','2026-11-06','2026-11-20','2026-12-04',
 '2026-12-18','2027-01-01','2027-01-15'],
 'Two four-week phases together still give one paycheck every 14 days');
assert.deepEqual(initial.map(e=>e.amount),[3075,3020,3075,3020,3075,3020,3075],
 'Similar A/B paychecks keep independent values');
assert.equal(new Set(initial.map(e=>e._seriesKey)).size,2,
 'Automatic detection creates TWO independent stream identities');
assert.ok(initial.every(e=>e.cadence==='every-4-weeks'));
const draftA=H.draftFor(history[4],history,accounts,asOf);
assert.equal(draftA.frequency,'every-4-weeks');
assert.equal(draftA.amount,3020);
assert.equal(draftA.nextDate,'2026-11-06','History picks the next SAME-phase payday');
assert.deepEqual(draftA.examples,['a1','a2','a3']);
const draftB=H.draftFor(history[3],history,accounts,asOf);
assert.equal(draftB.frequency,'every-4-weeks');
assert.equal(draftB.amount,3075);
assert.equal(draftB.nextDate,'2026-10-23');
assert.deepEqual(draftB.examples,['b1','b2']);
const state={predictions:{}},base={type:'income',accountId:'checking',
 frequency:'every-4-weeks',merchant:'North Coast Payroll'};
const first=T.defineRecurring(state,{...base,date:'2026-11-06',amount:3020},
 accounts,asOf,history[4],history,history.map(x=>x.id));
assert.deepEqual(first.exampleIds,['a1','a2','a3'],
 'First phase is linked only to its historical paychecks');
assert.equal(state.predictions.futureRecurringRules.length,1);
const half=income(state.predictions);
assert.equal(half.length,initial.length,'Confirming only A does not make B disappear');
assert.deepEqual(half.map(e=>e.amount),initial.map(e=>e.amount));
const second=T.defineRecurring(state,{...base,date:'2026-10-23',amount:3075},
 accounts,asOf,history[3],history,history.map(x=>x.id));
assert.notEqual(first.id,second.id,'Each payday is a separate recurring rule');
assert.equal(state.predictions.futureRecurringRules.length,2);
assert.deepEqual(second.exampleIds,['b1','b2']);
assert.deepEqual(income(state.predictions).map(e=>e.amount),initial.map(e=>e.amount),
 'Two confirmed rules replace BOTH auto streams without duplicate income');
const changed=T.defineRecurring(state,{...base,date:'2026-11-06',amount:3080},
 accounts,asOf,history[4],history,['a2','a3']);
assert.equal(changed.id,first.id,'Reconfirming same payday updates its existing schedule');
assert.equal(state.predictions.futureRecurringRules.length,2);
assert.deepEqual(income(state.predictions).map(e=>e.amount),
 [3075,3080,3075,3080,3075,3080,3075],
 'Editing A never changes B, even when amounts become similar');
const aFirst=income(state.predictions).find(e=>e.date==='2026-11-06');
const stopped=T.stopRecurrence(state,{...aFirst,kind:'event',recurringRuleId:first.id,
 sourceAccountId:'checking',sourceMerchant:'North Coast Payroll',
 sourceType:'income',seriesKey:T.manualSeriesKey(first.id),baseDate:aFirst.date});
assert.ok(stopped.key.includes('|phase'),'Stopping one four-week phase is scoped');
assert.equal(state.predictions.futureRecurringRules.length,1,
 'Not recurring removes ONLY paycheck A');
assert.deepEqual(income(state.predictions).map(e=>e.amount),
 [3075,3075,3075,3075],'Paycheck B continues every four weeks; A remains excluded');
T.restoreRecurrence(state,stopped.key);
assert.ok(income(state.predictions).length>=7,'Restoring A permits automatic historical inference');
const restored=T.defineRecurring(state,{...base,date:'2026-11-06',amount:3080},
 accounts,asOf,history[4],history,['a1','a3']);
assert.equal(restored.id,first.id);
assert.equal(state.predictions.futureRecurringRules.length,2);
assert.equal(income(state.predictions).length,7);
assert.equal(T.generatedRecurring([restored],'2026-12-20','2027-03-01').events[0].amount,3080);
const actualPaid=[...history,check('b3','2026-10-22',3073)];
const paid=C.materialize({...snapshot,asOf:'2026-10-27'},actualPaid,
 state.predictions,T,P,90);
assert.equal(paid.ledger.filter(e=>e.date==='2026-10-23').length,0,
 'Bank posting for B replaces that specific forecast even if net pay varies');
assert.ok(paid.ledger.some(e=>e.date==='2026-11-06'&&e.amount===3080));
const newAccount=[...history,check('other1','2026-09-11',3020,'Other Employer')];
assert.ok(C.materialize(snapshot,newAccount,state.predictions,T,P,90)
 .ledger.some(e=>e.merchant==='North Coast Payroll'),'Another employer does not hijack source identity');
assert.equal(JSON.stringify(history),frozen,'Real posted bank transactions remain immutable');
const simple={predictions:{}};
T.defineRecurring(simple,{...base,frequency:'biweekly',date:'2026-10-23',amount:3000},
 accounts,asOf);
assert.deepEqual(T.generatedRecurring(simple.predictions.futureRecurringRules,
 asOf,'2026-11-25').events.map(e=>e.amount),[3000,3000,3000],
 'Normal same-amount biweekly schedule remains supported');
console.log('PASS 2 independent four-week paycheck streams: history A/B selection, owner overlays, editing, no duplicates, phase-only stop and restore, posted reconciliation');
