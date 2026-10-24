'use strict';
const assert=require('node:assert/strict');
const M=require('../ledger-data.js'),R=require('../reviews.js');
const pfc=(primary,detailed,confidence_level)=>({primary,detailed,confidence_level});
const row=(id,merchant,category,confidence='VERY_HIGH')=>({transaction_id:id,account_id:'card',amount:28,date:'2026-10-12',merchant_name:merchant,
 personal_finance_category:pfc('GENERAL_MERCHANDISE','GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE',confidence)});
const s=M.migrate({});
M.applyPlaidSync(s,{itemId:'bank',accounts:[{account_id:'card',name:'Card',type:'credit'}],
 added:[row('market','Amazon','Shopping'),row('grocery','Safeway','Groceries'),row('unknown','Mystery Market','Other','LOW')],
 modified:[],removed:[],nextCursor:'x'});
let reviews=R.build(s,null,'2026-10-19');
assert.ok(reviews.tasks.some(t=>t.merchant==='Amazon'&&t.kind==='category'),'Multi-purpose merchant requires review even when Plaid is confident');
assert.ok(!reviews.tasks.some(t=>t.merchant==='Safeway'&&t.kind==='category'),'Clear recognized category needs no review');
assert.ok(reviews.tasks.some(t=>t.merchant==='Mystery Market'&&t.kind==='category'),'Low confidence requires review');
const amazon=reviews.tasks.find(t=>t.merchant==='Amazon');R.confirm(s,amazon);
assert.ok(!R.build(s,null,'2026-10-19').tasks.some(t=>t.id===amazon.id),'Confirmation persists while transaction stable');
M.applyPlaidSync(s,{itemId:'bank',added:[],modified:[],removed:[],nextCursor:'y'});
assert.ok(!R.build(s,null,'2026-10-19').tasks.some(t=>t.id===amazon.id),'Replay preserves confirmation');
M.applyPlaidSync(s,{itemId:'bank',added:[],modified:[{...row('market','Amazon','Shopping'),amount:29}],removed:[],nextCursor:'z'});
assert.ok(R.build(s,null,'2026-10-19').tasks.some(t=>t.id===amazon.id),'Changed amount reopens confirmation');
// The optimized full-history learned-category index must produce the exact
// same classification as isolated, source-backed category lookups.
const learned=M.migrate({accounts:[{id:'checking',name:'Fictional Checking',type:'checking'}],
 transactions:[
  {id:'a',date:'2026-10-05',merchant:'Fictional Coffee',amount:5,accountId:'checking',type:'expense',category:'Other'},
  {id:'b',date:'2026-10-12',merchant:'Fictional Coffee',amount:7,accountId:'checking',type:'expense',category:'Other'},
  {id:'c',date:'2026-10-15',merchant:'Fictional Coffee',amount:9,accountId:'checking',type:'expense',category:'Other'},
  {id:'d',date:'2026-10-16',merchant:'Amazon',amount:21,accountId:'checking',type:'expense',category:'Other'}]});
M.learnCategory(learned,'a','Dining');
let grouped=M.records(learned);
for(const entry of grouped)assert.equal(entry.category,M.categoryFor(learned,entry.id),
 'Indexed merchant safety must match per-record category resolution');
M.setCategory(learned,'b','Groceries');
grouped=M.records(learned);
for(const entry of grouped)assert.equal(entry.category,M.categoryFor(learned,entry.id),
 'Manual changes and mixed merchant history must invalidate safety conclusions');
assert.equal(grouped.find(x=>x.id==='b').category,'Groceries');
console.log('PASS conservative merchant categorization and indexed learning parity');
