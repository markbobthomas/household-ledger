'use strict';
const assert=require('node:assert/strict');
const Transactions=require('../planner-transactions.js');
const Core=require('../planner-core.js');
const asOf='2026-10-22',through='2027-11-21',days=395;
const accounts=[
 {id:'checking',name:'Fictional Checking',accountType:'checking',type:'depository',current:100000,available:100000,simulated:true},
 {id:'savings',name:'Fictional Savings',accountType:'savings',type:'depository',current:10000,available:10000,simulated:true}
];
const snapshot={asOf,accounts,mode:'demo'};
const state={predictions:{}};
assert.equal(Transactions.addScheduleCategory(state,'Pet Care'),'Pet Care');
assert.ok(Transactions.scheduleCategories(state).includes('Insurance'));
assert.ok(Transactions.scheduleCategories(state).includes('Pet Care'));
assert.throws(()=>Transactions.addScheduleCategory(state,'PET CARE'),/already exists/);
assert.throws(()=>Transactions.addScheduleCategory(state,'<script>'),/Category must/);
const rule=Transactions.defineRecurring(state,{
 date:'2026-11-10',merchant:'Fictional Vet',accountId:'checking',amount:125,
 type:'expense',frequency:'monthly',amountBasis:'fixed',category:'Pet Care',separateSchedule:'on'
},accounts,asOf);
assert.equal(rule.category,'Pet Care');
const transfer=Transactions.defineRecurring(state,{
 date:'2026-11-15',merchant:'Fictional Savings Transfer',fromAccountId:'checking',
 toAccountId:'savings',amount:200,type:'transfer',frequency:'monthly',
 amountBasis:'fixed',category:'Savings',separateSchedule:'on'
},accounts,asOf);
assert.equal(transfer.category,'Savings');
const generated=Transactions.generatedRecurring(state.predictions.futureRecurringRules,asOf,through);
assert.ok(generated.events.length>=12);
assert.ok(generated.events.every(e=>e.category==='Pet Care'));
assert.ok(generated.plans.every(e=>e.category==='Savings'));
const key=Transactions.keyEvent(generated.events[0].id,'checking');
Transactions.saveEdit(state,key,{
 date:generated.events[0].date,amount:145,merchant:'Fictional Vet',
 accountId:'checking',type:'expense'
},accounts,asOf);
const original=JSON.stringify(state.predictions);
const result=Core.materialize(snapshot,[],state.predictions,Transactions,null,days);
assert.equal(JSON.stringify(state.predictions),original,'Projection must not edit saved category assignments');
const pets=result.ledger.filter(e=>e.ruleId===rule.id);
assert.ok(pets.length>=12);
assert.ok(pets.every(e=>e.category==='Pet Care'),
 'Every dated recurring prediction retains the schedule category including a one-time amount edit');
assert.ok(pets.some(e=>e.amount===145),'Individual amount override applied');
const legs=result.projection.events.filter(e=>e.recurringRuleId===transfer.id);
assert.ok(legs.length>=24&&legs.every(e=>e.category==='Savings'),
 'Linked transfers retain the assigned category on both projected account legs');
assert.ok(result.projection.accounts.flatMap(a=>a.events)
 .filter(e=>e.recurringRuleId===rule.id).every(e=>e.category==='Pet Care'),
 'Daily account projections expose the category as data for every schedule prediction');
// Older schedules acquire a safe, explicit category when edited.
const updated=Transactions.defineRecurring(state,{
 date:'2026-11-10',merchant:'Fictional Vet',accountId:'checking',amount:150,
 type:'expense',frequency:'monthly',amountBasis:'fixed'
},accounts,asOf,{
 kind:'event',recurringRuleId:rule.id,accountId:'checking',sourceAccountId:'checking',
 originalMerchant:'Fictional Vet',originalType:'expense',sourceAmount:125,
 date:'2026-11-10'
});
assert.equal(updated.category,'Pet Care','Editing defaults without a category preserves assigned category');
assert.throws(()=>Transactions.defineRecurring(state,{
 date:'2026-11-10',merchant:'Fictional Vet',accountId:'checking',amount:150,
 type:'expense',frequency:'monthly',category:'Not Defined'
},accounts,asOf,{
 kind:'event',recurringRuleId:rule.id,accountId:'checking',sourceAccountId:'checking',
 originalMerchant:'Fictional Vet',originalType:'expense',sourceAmount:125,
 date:'2026-11-10'
}),/Choose an existing schedule category/);
assert.equal(state.predictions.futureRecurringRules.find(r=>r.id===rule.id).category,'Pet Care',
 'Unknown category cannot corrupt the saved schedule');
assert.deepEqual(Transactions.setScheduleCategory(state,rule.id,'Insurance'),
 {id:rule.id,category:'Insurance'},
 'Quick schedule category update returns the existing ID and new category');
const recategorized=Core.materialize(snapshot,[],state.predictions,Transactions,null,days);
assert.ok(recategorized.ledger.filter(e=>e.ruleId===rule.id)
 .every(e=>e.category==='Insurance'),
 'One-tap category changes propagate to every future forecast occurrence, including saved one-date edits');
assert.ok(recategorized.projection.accounts.flatMap(a=>a.events)
 .filter(e=>e.recurringRuleId===rule.id).every(e=>e.category==='Insurance'),
 'Balance-projection event data retains the quick category change');
assert.throws(()=>Transactions.setScheduleCategory(state,rule.id,'Unknown category'),/Choose an existing/);
assert.equal(state.predictions.futureRecurringRules.find(r=>r.id===rule.id).category,'Insurance');
assert.throws(()=>Transactions.setScheduleCategory(state,'unknown rule','Insurance'),/schedule changed/);
console.log('PASS schedule category preservation: encrypted-forecast preference shape, custom categories, individual edits and linked-transfer legs');
