'use strict';
const assert=require('node:assert/strict');
const M=require('../ledger-data.js'),R=require('../reviews.js');
const ac=['checking-a','checking-b','savings-a','visa','amex','card-3'].map((id,i)=>({account_id:id,name:id,type:i>=3?'credit':'depository',subtype:i===2?'savings':i>=3?'credit card':'checking'}));
const tx=(id,account,amount,name,date='2026-10-10',extra={})=>({transaction_id:id,account_id:account,amount,merchant_name:name,date,pending:false,...extra});
const rows=[
 tx('salary','checking-a',-2400,'Payroll'),
 tx('grocery','visa',68.2,'Safeway'),
 tx('card-out','checking-a',100,'Credit Card Payment'),
 tx('card-in','visa',-100,'Payment Thank You'),
 tx('internal-out','checking-b',80,'Transfer to Savings'),
 tx('internal-in','savings-a',-80,'Transfer from Checking'),
 tx('partial-out','checking-b',23,'Credit Card Payment'),
 tx('partial-in','amex',-23,'Payment Thank You'),
 tx('other-card','card-3',93,'Amazon'),
 tx('uncertain-card','card-3',-13,'Adjustment'),
 tx('unmatched','checking-b',55,'Credit Card Payment'),
 tx('cash-purchase','checking-a',14,'Coffee Shop'),
 tx('refund','visa',-20,'Refund Safeway'),
 tx('pending','amex',31,'Pending Merchant','2026-10-11',{pending:true})
];
const s=M.migrate({});
M.applyPlaidSync(s,{itemId:'bank-one',accounts:ac.slice(0,4),added:rows.filter(t=>ac.slice(0,4).some(a=>a.account_id===t.account_id)),modified:[],removed:[],nextCursor:'one'});
M.applyPlaidSync(s,{itemId:'bank-two',accounts:ac.slice(4),added:rows.filter(t=>ac.slice(4).some(a=>a.account_id===t.account_id)),modified:[],removed:[],nextCursor:'two'});
const original=JSON.stringify(s.transactions);
let audit=M.accountingView(s);
assert.equal(audit.accounts.length,6);
assert.equal(audit.summary.matchedTransfers,3);
assert.equal(audit.summary.unmatchedTransfers,1);
assert.equal(audit.summary.spending,155.2,'68.2+93+14-20, excluding pending');
assert.equal(audit.summary.income,2400);
assert.ok(audit.issues.some(i=>i.status==='unmatched'));
assert.ok(audit.issues.some(i=>i.status==='needs-review'));
assert.equal(JSON.stringify(s.transactions),original);
let tasks=R.build(s,null,'2026-10-19').tasks;
assert.ok(tasks.some(t=>t.kind==='accounting'));
assert.ok(tasks.some(t=>t.kind==='category'&&/amazon/i.test(t.merchant)));
let issue=tasks.find(t=>t.kind==='accounting');
R.confirm(s,issue);
assert.ok(!R.build(s,null,'2026-10-19').tasks.find(t=>t.id===issue.id));
assert.equal(JSON.stringify(s.transactions),original,'Acknowledgement never alters bank facts');
M.setCategory(s,'plaid:bank-two:other-card','Shopping');
assert.equal(M.records(s).find(t=>t.id==='plaid:bank-two:other-card').category,'Shopping');
M.applyPlaidSync(s,{itemId:'bank-two',added:[tx('posted','amex',31,'Pending Merchant','2026-10-12',{pending_transaction_id:'pending'})],modified:[],removed:[],nextCursor:'two-new'});
assert.equal(s.transactions.filter(t=>t.source?.providerTransactionId==='pending').length,0);
assert.equal(s.transactions.filter(t=>t.source?.providerTransactionId==='posted').length,1);
assert.equal(s.sync.itemCursors['bank-one'],'one');
M.applyPlaidSync(s,{itemId:'bank-two',added:[],modified:[],removed:[],nextCursor:'two-new'});
assert.equal(s.transactions.length,rows.length,'Repeated sync idempotent');
assert.equal(M.records(s).find(t=>t.id==='plaid:bank-two:other-card').category,'Shopping','Manual choice survives sync');
const changed=M.migrate(s);changed.transactions.find(t=>t.id===issue.targetId).amount+=1;
assert.ok(R.build(changed,null,'2026-10-19').tasks.find(t=>t.id===issue.id),'Changed source reopens acknowledged review');
assert.ok(audit.summary.matchedTransfers*2===M.records(M.migrate({accounts:ac,transactions:s.transactions.filter(t=>!['posted','pending'].includes(t.source?.providerTransactionId))})).filter(t=>t.pairedTransactionId).length);
console.log('PASS: 6-account cross-bank conservation, pending posting, uncertainty review, manual choices, immutable source');
