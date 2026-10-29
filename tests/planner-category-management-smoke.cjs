'use strict';
const assert=require('node:assert/strict');
const M=require('../ledger-data.js');
const clone=s=>JSON.parse(JSON.stringify(s));
const state=M.migrate({
 transactions:[{id:'posted',date:'2026-10-12',merchant:'Fictional Kiosk',
  category:'Other',type:'expense',accountId:'checking',amount:10}],
 predictions:{categoryMonthlyBudgets:{},futureRecurringRules:[],futureTransactionAdds:[]}
});
const original=JSON.stringify(state.transactions);
assert.ok(M.categories(state).includes('Other'),'Other is a permanent built-in category');
assert.throws(()=>M.removeCategory(state,'Other'),/Built-in categories/);
assert.throws(()=>M.removeCategory(state,'Groceries'),/Built-in categories/);
M.addCategory(state,'Pet Care');
state.predictions.categoryMonthlyBudgets['Pet Care']=75;
assert.equal(M.removeCategory(state,'Pet Care'),'Pet Care',
 'Unused custom category can be deleted with its saved budget');
assert.ok(!M.categories(state).includes('Pet Care'));
assert.equal(state.predictions.categoryMonthlyBudgets['Pet Care'],undefined);
assert.deepEqual(JSON.stringify(state.transactions),original,'Removing category never edits posted bank data');
M.addCategory(state,'Vet visits');
state.categoryOverrides.posted='Vet visits';
assert.throws(()=>M.removeCategory(state,'Vet visits'),/Category is in use/,
 'Manual category overrides require reassignment before deleting');
assert.ok(M.categories(state).includes('Vet visits'),'Failed removal keeps the category');
delete state.categoryOverrides.posted;
state.learning.categoryRules.test={category:'Vet visits',mode:'suggest'};
assert.throws(()=>M.removeCategory(state,'Vet visits'),/Category is in use/,
 'Learned merchant categories cannot be orphaned');
delete state.learning.categoryRules.test;
state.predictions.futureRecurringRules.push({id:'bill',category:'Vet visits'});
assert.throws(()=>M.removeCategory(state,'Vet visits'),/Category is in use/,
 'Saved recurring bills remain protected');
state.predictions.futureRecurringRules=[];
state.predictions.futureTransactionAdds.push({id:'oneoff',category:'Vet visits'});
assert.throws(()=>M.removeCategory(state,'Vet visits'),/Category is in use/,
 'One-off future payments remain protected');
state.predictions.futureTransactionAdds=[];
assert.equal(M.removeCategory(state,'Vet visits'),'Vet visits');
assert.ok(!M.categories(state).includes('Vet visits'));
assert.equal(M.addCategory(state,'Vet visits'),'Vet visits','Deleted categories can be re-added');
assert.deepEqual(JSON.stringify(state.transactions),original,'All category actions preserve bank source history');
console.log('PASS Other permanent, create/delete, budget cleanup, and assigned-category safeguards');
