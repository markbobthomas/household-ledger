'use strict';
const assert=require('node:assert/strict');
const M=require('../ledger-data.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const bankRows=[
 {id:'groceries-1',date:'2026-10-12',merchant:'Fictional Grocer',
  category:'Groceries',type:'expense',accountId:'checking',amount:10},
 {id:'other-1',date:'2026-10-13',merchant:'Fictional Shop',
  category:'Other',type:'expense',accountId:'checking',amount:15},
 {id:'income-1',date:'2026-10-14',merchant:'Fictional Pay',
  category:'Income',type:'income',accountId:'checking',amount:200}
];
const s=M.migrate({transactions:bankRows,predictions:{
 scheduleCategories:['Pet Care'],categoryMonthlyBudgets:{Groceries:80,'Pet Care':50},
 futureRecurringRules:[{id:'bill',merchant:'Fictional Grocery Bill',category:'Groceries',categoryReviewed:true,amount:30,anchorDate:'2026-11-01'}],
 futureTransactionAdds:[{id:'oneoff',merchant:'Fictional Pet',category:'Pet Care',categoryReviewed:true,amount:20,date:'2026-11-02'}],
 paymentBills:[{id:'legacy',merchant:'Fictional Income Bill',category:'Income',amount:25,date:'2026-11-03'}]
 }});
const original=JSON.stringify(s.transactions),
 paymentAmounts=s.predictions.futureRecurringRules.map(r=>r.amount);
assert.ok(M.categories(s).includes('Other'));
assert.equal(M.removeCategory(s,'Groceries'),'Groceries','Built-ins can now be deleted');
assert.ok(!M.categories(s,['Groceries']).includes('Groceries'),'Source-observed removed names stay hidden');
assert.equal(M.categoryFor(s,'groceries-1'),'Uncategorized');
assert.equal(s.categoryOverrides['groceries-1'],'Uncategorized');
assert.ok(M.categoryReviewQueue(s).transactions.some(x=>x.id==='groceries-1'),'Affected historical transaction needs review');
assert.equal(s.predictions.futureRecurringRules[0].category,'Uncategorized');
assert.equal(s.predictions.futureRecurringRules[0].categoryReviewed,false);
assert.ok(M.categoryReviewQueue(s).plans.some(x=>x.id==='bill'),'Affected saved bill needs review');
assert.deepEqual(s.predictions.futureRecurringRules.map(r=>r.amount),paymentAmounts,'Payment amounts preserved');
assert.equal(s.predictions.categoryMonthlyBudgets.Groceries,undefined,'Removed category budget no longer active');
assert.equal(M.removeCategory(s,'Pet Care'),'Pet Care','Used custom categories also delete');
assert.equal(s.predictions.futureTransactionAdds[0].category,'Uncategorized');
assert.ok(M.categoryReviewQueue(s).plans.some(x=>x.id==='oneoff'));
assert.equal(M.removeCategory(s,'Other'),'Other','Other is not protected from deletion');
assert.ok(!M.categories(s).includes('Other'));
assert.equal(M.categoryFor(s,'other-1'),'Uncategorized');
assert.equal(M.removeCategory(s,'Income'),'Income','Income is a removable named category');
assert.ok(M.categoryReviewQueue(s).transactions.some(x=>x.id==='income-1'),
 'Deleting the Income category must not silently classify this transaction as Income');
assert.ok(M.categoryReviewQueue(s).plans.some(x=>x.id==='legacy'));
assert.deepEqual(JSON.stringify(s.transactions),original,'Actual posted transaction source stays identical');
const refreshed=M.migrate(clone(s));
assert.ok(!M.categories(refreshed,bankRows.map(t=>t.category)).includes('Groceries'),
 'Deleted category remains hidden after reloading provider source history');
assert.equal(M.categoryFor(refreshed,'groceries-1'),'Uncategorized');
assert.equal(M.addCategory(refreshed,'Groceries'),'Groceries','A deleted built-in can be restored intentionally');
assert.ok(M.categories(refreshed).includes('Groceries'));
assert.equal(M.categoryFor(refreshed,'groceries-1'),'Uncategorized',
 'Restoring a category does not silently recategorize already-unassigned records');
assert.equal(M.addCategory(refreshed,'Pet Care'),'Pet Care','Deleted custom categories can be restored');
assert.throws(()=>M.removeCategory(refreshed,'Uncategorized'),/not available/,
 'Unassigned remains an internal status rather than a named category');
console.log('PASS any category deletion, historical/forecast Unassigned review, tombstones, restart, and banking immutability');
