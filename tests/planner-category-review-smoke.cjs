'use strict';
const assert=require('node:assert/strict');
const M=require('../ledger-data.js');
const T=require('../planner-transactions.js');
const date='2026-10-20';
const row=(id,category,extra={})=>({
 id,date,merchant:'Fictional '+id,amount:25,type:'expense',accountId:'checking',
 category,source:{provider:'plaid',verified:true},...extra
});
const s=M.migrate({accounts:[{id:'checking',name:'Fictional Checking',type:'checking'}],
 transactions:[
  row('missing','Other'),
  row('low','Shopping',{categoryConfidence:.4}),
  row('high','Groceries',{categoryConfidence:.99}),
  row('suggested','Dining',{categoryConfidence:.65}),
  row('income','Other',{type:'income',categoryConfidence:.2}),
  row('transfer','Other',{type:'transfer',categoryConfidence:.2}),
  row('pending','Other',{pending:true})
 ],
 predictions:{
  futureRecurringRules:[{id:'r1',merchant:'Fictional Bill',category:'Uncategorized',amount:25,
   accountId:'checking',type:'expense',frequency:'monthly',anchorDate:date},
   {id:'r2',merchant:'Fictional Certain Bill',category:'Insurance',categoryConfidence:.3,
    amount:30,accountId:'checking',type:'expense',frequency:'monthly',anchorDate:date}],
  futureTransactionAdds:[{id:'once',merchant:'Fictional One-off',category:'Other',
   accountId:'checking',type:'expense',amount:16,date}],
  paymentBills:[{id:'legacy-bill',name:'Fictional Old Bill',category:'Other',amount:12,date}]
 }});
const source=JSON.stringify(s.transactions);
let issues=M.categoryReviewQueue(s);
const flagged=new Set(issues.transactions.map(x=>x.id));
assert.deepEqual([...flagged].sort(),['low','missing','suggested']);
assert.equal(issues.plans.length,4,'Missing and uncertain recurring, one-off and legacy bills need review');
assert.ok(issues.plans.every(x=>x.kind!=='transaction'));
assert.equal(M.records(s).find(x=>x.id==='income').category,'Income',
 'Income receives its type-backed category without a guessed merchant classification');
assert.equal(M.records(s).find(x=>x.id==='transfer').category,'Transfer',
 'Transfers have their own category and do not count as spending');
assert.equal(JSON.stringify(s.transactions),source,'Review must never modify authoritative bank records');
M.setCategory(s,'low','Shopping',true);
assert.ok(!M.categoryReviewQueue(s).transactions.some(x=>x.id==='low'),
 'Explicitly confirming the existing low-confidence category clears Review');
assert.equal(s.categoryOverrides.low,'Shopping','Same-category confirmation is saved as manual overlay');
M.setCategory(s,'missing','Housing',true);
assert.ok(!M.categoryReviewQueue(s).transactions.some(x=>x.id==='missing'));
T.setScheduleCategory(s,'r2','Insurance');
assert.ok(!M.categoryReviewQueue(s).plans.some(x=>x.id==='r2'),
 'Explicitly confirming a bill category clears low-confidence review');
assert.ok(s.predictions.futureRecurringRules.find(x=>x.id==='r2').categoryReviewed);
assert.equal(JSON.stringify(s.transactions),source,'Bill and transaction reviews cannot alter bank rows');
console.log('PASS categorized transaction/bill review, uncertain sources, confirmation and bank immutability');
