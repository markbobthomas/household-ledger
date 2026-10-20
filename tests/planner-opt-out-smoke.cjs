'use strict';
const assert=require('node:assert/strict');
const T=require('../planner-transactions.js'),C=require('../planner-core.js'),
 P=require('../payment-obligations.js'),H=require('../planner-history.js');
const accounts=[
 {id:'checking',name:'Checking',accountType:'checking',type:'depository',
  current:5000,available:5000,simulated:true},
 {id:'savings',name:'Savings',accountType:'savings',type:'depository',
  current:1500,available:1500,simulated:true}
],snapshot={asOf:'2026-10-20',mode:'demo',accounts};
const txn=(id,date,merchant,amount,type='expense',accountId='checking',extra={})=>
 ({id,date,merchant,amount,type,accountId,pending:false,...extra});
const history=[
 txn('m1','2026-09-15','Mortgage ACH',2000,'transfer','checking',{cashDirection:'out'}),
 txn('p1','2026-09-09','ABC Draft 984',82.35),
 txn('p2','2026-10-09','ABC Draft 984',82.35),
 txn('other1','2026-09-09','ABC Draft 984',82.35,'expense','savings'),
 txn('other2','2026-10-09','ABC Draft 984',82.35,'expense','savings'),
 txn('income1','2026-09-09','ABC Draft 984',82.35,'income','checking'),
 txn('income2','2026-10-09','ABC Draft 984',82.35,'income','checking')
];
const state={predictions:{}},clone=JSON.stringify(history);
const bundle=()=>C.materialize(snapshot,history,state.predictions,T,P,90);
const rows=b=>b.projection.events.filter(x=>!x.transferGroupId);
const match=(b,account,type)=>rows(b).filter(e=>e.accountId===account&&
 e.type===type&&e.merchant==='ABC Draft 984');
const initial=bundle();
assert.equal(match(initial,'checking','expense').length,3);
assert.equal(match(initial,'savings','expense').length,3);
assert.equal(match(initial,'checking','income').length,3);
const original=match(initial,'checking','expense')[0];
const key=T.keyEvent(original.id,original.accountId);
T.saveEdit(state,key,{date:'2026-11-13',accountId:'checking',merchant:'My Mistaken Name',
 type:'expense',amount:88},accounts,snapshot.asOf);
const edited=bundle().projection.events.find(e=>e.id===original.id);
assert.equal(edited.merchant,'My Mistaken Name');
assert.equal(edited.sourceMerchant,'ABC Draft 984',
 'An edited prediction still carries its original bank merchant');
assert.equal(edited.sourceAccountId,'checking');
const stop=T.stopRecurrence(state,{kind:'event',accountId:edited.accountId,
 type:edited.type,merchant:edited.merchant,sourceMerchant:edited.sourceMerchant,
 sourceAccountId:edited.sourceAccountId,sourceType:edited.sourceType,
 seriesKey:edited.seriesKey});
assert.equal(stop.merchant,'ABC Draft 984');
assert.equal(stop.type,'expense');
assert.ok(!state.predictions.futureTransactionEdits[key],
 'Stale mistaken one-time edits must be cleared for the rejected series');
assert.equal(match(bundle(),'checking','expense').length,0,
 'Rejecting one automatically recognized recurrence removes all future occurrences');
assert.equal(match(bundle(),'savings','expense').length,3,
 'The same merchant at another account is not affected');
assert.equal(match(bundle(),'checking','income').length,3,
 'The same merchant in the opposite money direction is not affected');
assert.ok(!C.analyze(history,accounts,snapshot.asOf,state.predictions).review.some(x=>
 x.accountId==='checking'&&x.type==='expense'&&x.merchant==='ABC Draft 984'));
assert.ok(!H.candidates(history,accounts,snapshot.asOf,state.predictions).some(x=>
 x.accountId==='checking'&&x.type==='expense'&&x.merchant==='ABC Draft 984'));
const alteredHistory=history.map(x=>({...x}));
alteredHistory.push(txn('p3','2026-10-18','ABC Draft 984',90));
assert.equal(C.analyze(alteredHistory,accounts,snapshot.asOf,state.predictions).automatic
 .filter(e=>e.merchant==='ABC Draft 984'&&e.accountId==='checking').length,0,
 'A later Plaid refresh or changed amount must not reinstate a rejected recurrence');
assert.equal(JSON.stringify(history),clone,'Actual bank history is immutable');
assert.deepEqual(Object.keys(state.predictions.futureRecurrenceExclusions).length,1);
T.restoreRecurrence(state,stop.key);
assert.equal(match(bundle(),'checking','expense').length,3,
 'Explicit re-enable restores automatic predictions without altering bank history');
// Confirmed mortgage: stopping it must NOT cause auto detection to re-create it.
const accountState={predictions:{}};
const mortgageRef={kind:'event',accountId:'checking',type:'transfer',
 merchant:'Mortgage ACH',amount:2000,date:'2026-09-15'};
const rule=T.defineRecurring(accountState,{date:'2026-11-25',merchant:'Edited Loan Bill',
 accountId:'checking',type:'expense',amount:2100,frequency:'monthly'},
 accounts,snapshot.asOf,mortgageRef,history,['m1']);
const mortgageBundle=()=>C.materialize(snapshot,history,accountState.predictions,T,P,90);
const loan=mortgageBundle().projection.events.find(e=>e.recurringRuleId===rule.id);
assert.ok(loan,'Saved schedule must appear in future ledger');
assert.equal(loan.sourceMerchant,'Mortgage ACH');
const cancelled=T.stopRecurrence(accountState,{kind:'event',accountId:loan.accountId,
 type:loan.type,merchant:loan.merchant,recurringRuleId:loan.recurringRuleId,
 seriesKey:loan.seriesKey,sourceAccountId:loan.sourceAccountId,sourceMerchant:loan.sourceMerchant,
 sourceType:loan.sourceType});
assert.equal(accountState.predictions.futureRecurringRules.length,0);
assert.equal(mortgageBundle().ledger.filter(e=>/Mortgage|Loan Bill/.test(e.merchant)).length,0,
 'Stopping an edited confirmed mortgage removes the rule AND prevents the old auto forecast');
assert.equal(cancelled.merchant,'Mortgage ACH');
T.restoreRecurrence(accountState,cancelled.key);
assert.equal(mortgageBundle().ledger.filter(e=>e.merchant==='Mortgage ACH').length,3,
 'Allowing detection back restores automatic bank forecast (not discarded custom edits)');
// A manually added one-off can be promoted then marked not recurring without
// losing the original manually added transaction.
const manual={predictions:{}};
const extra=T.add(manual,{date:'2026-11-20',merchant:'Garage Fee',amount:25,
 type:'expense',accountId:'checking'},accounts,snapshot.asOf);
const manualRule=T.defineRecurring(manual,{date:'2026-11-20',merchant:'Garage Fee',
 amount:25,type:'expense',accountId:'checking',frequency:'monthly'},accounts,snapshot.asOf,
 {...extra,kind:'event',addedId:extra.id});
const before=C.materialize(snapshot,history,manual.predictions,T,P,90);
assert.ok(before.ledger.filter(e=>e.merchant==='Garage Fee').length>=2);
const one=before.projection.events.find(e=>e.recurringRuleId===manualRule.id);
T.stopRecurrence(manual,{...one,kind:'event',
 recurringRuleId:manualRule.id,sourceAccountId:one.sourceAccountId,
 sourceMerchant:one.sourceMerchant,sourceType:one.sourceType});
const after=C.materialize(snapshot,history,manual.predictions,T,P,90);
assert.equal(after.ledger.filter(e=>e.merchant==='Garage Fee').length,1,
 'Stopping manual recurrence retains only its original one-off transaction');
assert.equal(after.ledger.find(e=>e.merchant==='Garage Fee').date,'2026-11-20');
// Confirming from History explicitly reinstates a previously excluded pattern.
T.stopRecurrence(state,{kind:'event',accountId:'checking',type:'expense',
 merchant:'ABC Draft 984'});
const newRule=T.defineRecurring(state,{date:'2026-11-09',merchant:'ABC Draft 984',
 accountId:'checking',type:'expense',amount:82.35,frequency:'monthly'},
 accounts,snapshot.asOf,txn('p2','2026-10-09','ABC Draft 984',82.35),history,['p2']);
assert.ok(newRule.id);
assert.equal(Object.keys(state.predictions.futureRecurrenceExclusions).length,0,
 'An explicit new recurring confirmation reverses an old rejection');
const moves={predictions:{}};
const transfer=T.defineRecurring(moves,{date:'2026-11-05',merchant:'Savings Sweep',
 type:'transfer',fromAccountId:'checking',toAccountId:'savings',amount:125,
 frequency:'every-4-weeks'},accounts,snapshot.asOf);
const transferRows=()=>C.materialize(snapshot,[],moves.predictions,T,P,90).projection.plans;
assert.equal(transferRows().length,3);
T.stopRecurrence(moves,{...transferRows()[0],kind:'movement',
 recurringRuleId:transfer.id,accountId:'checking',sourceMerchant:'Savings Sweep'});
assert.equal(transferRows().length,0,'Rejected linked transfer removes BOTH future bank-account legs');
assert.equal(C.materialize(snapshot,[],moves.predictions,T,P,90).projection.household.conservationDifference,0);
console.log('PASS recurring opt-out: auto and edited schedules, restored patterns, new Plaid amounts, source isolation, existing one-offs, transfers, immutable bank facts');
