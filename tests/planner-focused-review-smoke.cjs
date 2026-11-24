'use strict';
const assert=require('node:assert/strict');
const H=require('../planner-history.js'),M=require('../ledger-data.js');
const accounts=[{id:'main',name:'Checking',accountType:'checking'},
 {id:'card',name:'Credit',accountType:'credit'}];
const row=(id,date,merchant,amount,type='expense',extra={})=>({
 id,date,merchant,amount,type,accountId:'main',pending:false,...extra});
const transactions=[
 row('one','2026-10-09','Amazon',54),
 row('coffee','2026-10-08','Corner Cafe',11),
 row('bill1','2026-07-12','Electric Utility',145),
 row('bill2','2026-08-12','Electric Utility',118),
 row('bill3','2026-09-12','Electric Utility',173),
 row('bill4','2026-10-12','Electric Utility',139),
 row('mortgage','2026-09-09','Mortgage ACH',2000),
 row('pay-a1','2026-08-14','Regional Payroll',3020,'income'),
 row('pay-b1','2026-08-28','Regional Payroll',3075,'income'),
 row('pay-a2','2026-09-11','Regional Payroll',3020,'income'),
 row('pay-b2','2026-09-25','Regional Payroll',3075,'income'),
 row('pay-a3','2026-10-09','Regional Payroll',3020,'income'),
 row('linked','2026-10-10','Savings Transfer',500,'transfer',{
  cashDirection:'out',pairedTransactionId:'pair'})
];
const copy=JSON.stringify(transactions),asOf='2026-10-20';
const list=H.recommendedRepeating(transactions,accounts,asOf);
assert.ok(!list.some(x=>x.merchant==='Amazon'||x.merchant==='Corner Cafe'));
const bills=list.filter(x=>x.merchant==='Electric Utility');
assert.equal(bills.length,1,'Variable utilities group into one candidate despite different amounts');
assert.equal(bills[0].occurrences,4);
assert.equal(bills[0].amount,139);
assert.equal(bills[0].frequency,'monthly');
assert.equal(new Set(bills[0].examples.map(x=>x.id)).size,4);
assert.equal(list.filter(x=>x.merchant==='Mortgage ACH').length,1,
 'One clear mortgage posting remains worth confirmation');
const payroll=list.filter(x=>x.merchant==='Regional Payroll');
assert.equal(payroll.length,2,'Alternating payroll phases stay independent');
assert.deepEqual(payroll.map(x=>x.frequency),['every-4-weeks','every-4-weeks']);
assert.equal(new Set(payroll.map(x=>x.key)).size,2);
assert.ok(!list.some(x=>x.merchant==='Savings Transfer'),
 'Paired bank transfers are not recurring bill suggestions');
const cardSourceRows=[
 row('card-post-a','2026-09-13','Visa Autopay',500,'transfer',{
  cashDirection:'out',accountingKind:'card_payment'}),
 row('card-post-b','2026-10-13','Visa Autopay',500,'transfer',{
  cashDirection:'out',accountingKind:'card_payment'}),
 row('card-narrative-a','2026-09-14','Credit card payment',165),
 row('card-narrative-b','2026-10-14','Credit card payment',165),
 row('utility-a','2026-09-15','Example Utility Autopay',72),
 row('utility-b','2026-10-15','Example Utility Autopay',72)
];
const withCardSource=[...transactions,...cardSourceRows];
for(const suggestions of [H.recommendedRepeating(withCardSource,accounts,asOf),
 H.candidates(withCardSource,accounts,asOf,{
  paymentRules:{card:{fromAccountId:'main',autopayEnabled:true}}},[])]) {
 assert(!suggestions.some(v=>/visa autopay|credit card payment/i.test(v.merchant)),
  'Neither historical scanner may propose an already modeled card payment');
 assert(suggestions.some(v=>v.merchant==='Example Utility Autopay'),
  'Unrelated real utility autopay is still eligible');
}
assert.equal(JSON.stringify(transactions),copy,'Read-only scanners cannot modify bank rows');
assert.equal(JSON.stringify(transactions),copy,'Recommendation discovery never edits bank records');
const bank=M.migrate({accounts,transactions:[row('g','2026-10-09','Safeway',55,'expense',{category:'Groceries'})]});
M.setCategory(bank,'g','Shopping');
assert.equal(M.categoryFor(bank,'g'),'Shopping');
assert.equal(bank.transactions[0].category,'Groceries',
 'Categories are a reversible overlay, never a source bank record mutation');
assert.equal(bank.categoryOverrides.g,'Shopping');
M.setCategory(bank,'g','Groceries');
assert.equal(bank.categoryOverrides.g,undefined,'Restoring original category clears override');
console.log('PASS focused recurrence discovery, variable bills, independent payroll and immutable category overlays');
