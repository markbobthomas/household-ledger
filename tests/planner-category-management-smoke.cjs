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
// Bank providers can supply an 'Other' category even though History displays
// the known income/transfer type. Deleting either displayed category must
// move those records to Unassigned without changing the source.
const displayOnly=M.migrate({transactions:[
 {id:'wages',date:'2026-10-16',merchant:'Fictional Payroll',category:'Other',
  type:'income',accountId:'checking',amount:900},
 {id:'move',date:'2026-10-17',merchant:'Fictional Transfer',category:'Other',
  type:'transfer',cashDirection:'in',accountId:'checking',amount:90},
 {id:'handpicked',date:'2026-10-18',merchant:'Fictional Other Deposit',
  category:'Other',type:'income',accountId:'checking',amount:100}
],categoryOverrides:{handpicked:'Savings'}});
const bankOriginal=JSON.stringify(displayOnly.transactions);
assert.equal(M.removeCategory(displayOnly,'Income'),'Income');
assert.equal(displayOnly.categoryOverrides.wages,'Uncategorized',
 'Displayed Income must be unassigned even when source bank category is Other');
assert.equal(displayOnly.categoryOverrides.handpicked,'Savings',
 'A manually categorized income transaction keeps its separate category');
assert.ok(M.categoryReviewQueue(displayOnly).transactions.some(t=>t.id==='wages'),
 'Unassigned incoming bank records re-enter review');
assert.equal(M.removeCategory(displayOnly,'Transfer'),'Transfer');
assert.equal(displayOnly.categoryOverrides.move,'Uncategorized');
assert.ok(M.categoryReviewQueue(displayOnly).transactions.some(t=>t.id==='move'),
 'Unassigned transfers re-enter review');
displayOnly.transactions.push({id:'new-wages',date:'2026-10-19',
 merchant:'Fictional Payroll',category:'Other',type:'income',
 accountId:'checking',amount:950});
assert.equal(M.categoryFor(displayOnly,'new-wages'),'Uncategorized',
 'Newly synced bank income cannot resurrect a deleted display category');
assert.deepEqual(JSON.stringify(displayOnly.transactions.slice(0,3)),bankOriginal,
 'No original bank transaction data is changed by deleting displayed categories');
console.log('PASS any category deletion, historical/forecast Unassigned review, tombstones, restart, and banking immutability');
