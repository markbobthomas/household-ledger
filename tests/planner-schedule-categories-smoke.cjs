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
}),/Choose an existing prediction category/);
assert.equal(state.predictions.futureRecurringRules.find(r=>r.id===rule.id).category,'Pet Care',
 'Unknown category cannot corrupt the saved schedule');
// A repeating plan's category must also appear on uniquely related ACTUAL
// transactions in History/Budget. The bank facts stay immutable and an
// independent per-transaction category override always takes precedence.
const Model=require('../ledger-data.js');
const actual=(id,merchant,accountId='checking',extra={})=>({
 id,date:'2026-10-12',merchant,amount:18.95,type:'expense',accountId,
 category:'Other',pending:false,source:{provider:'demo',verified:true},...extra
});
const bankView=Model.migrate({
 accounts,transactions:[
  actual('linked-bank','Fictional Vet'),
  actual('later-bank','Fictional Vet'),
  actual('manual-bank','Fictional Vet'),
  actual('other-account','Fictional Vet','savings'),
  actual('other-merchant','Another Store'),
  actual('paired-bank','Fictional Vet','checking',{type:'transfer',cashDirection:'out',pairedTransactionId:'paired-credit'}),
  actual('paired-credit','Fictional Vet','savings',{type:'transfer',cashDirection:'in',pairedTransactionId:'paired-bank'})
 ],
 predictions:{futureRecurringRules:[{...updated,category:'Pet Care',exampleIds:['linked-bank']}]},
 categoryOverrides:{'manual-bank':'Insurance'}
});
const sourceBefore=JSON.stringify(bankView.transactions);
const find=id=>Model.records(bankView).find(t=>t.id===id);
assert.equal(find('linked-bank').category,'Pet Care');
assert.equal(find('later-bank').category,'Pet Care',
 'Posted payment on the same account and payee inherits the saved repeating category');
assert.equal(Model.categoryFor(bankView,'later-bank'),'Pet Care',
 'The inline actual-transaction selector uses the same effective category');
assert.equal(find('manual-bank').category,'Insurance',
 'An individually confirmed bank category wins over the repeating default');
assert.equal(find('other-account').category,'Other','Other bank accounts stay independent');
assert.equal(find('other-merchant').category,'Other','Unrelated payees retain their category');
assert.equal(find('paired-bank').category,'Other',
 'A bank item with an internal paired transfer must never be automatically recategorized');
assert.equal(find('later-bank').method,'recurring');
assert.ok(!Model.categoryReviewQueue(bankView).transactions.some(t=>t.id==='later-bank'),
 'Confirmed repeating-category history is not a low-confidence category review item');
bankView.predictions.futureRecurringRules[0].category='Groceries';
assert.equal(find('later-bank').category,'Groceries',
 'Editing the repeating category updates associated past activity automatically');
assert.equal(find('manual-bank').category,'Insurance');
bankView.predictions.futureRecurringRules.push({
 ...updated,id:'another-independent-plan',category:'Housing',exampleIds:[],
 originalMerchant:'Fictional Vet',matchNames:['fictional vet']
});
assert.equal(find('linked-bank').category,'Groceries',
 'Explicit bank-example ownership disambiguates two same-merchant schedules');
assert.equal(find('later-bank').category,'Other',
 'Independent same-merchant streams without linked evidence remain ambiguous');
assert.equal(JSON.stringify(bankView.transactions),sourceBefore,
 'Neither repeating category changes nor derived history classification edit Plaid bank facts');

console.log('PASS schedule category preservation: encrypted-forecast preference shape, custom categories, individual edits and linked-transfer legs');
