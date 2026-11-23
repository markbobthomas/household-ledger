'use strict';
const assert=require('node:assert/strict');
const M=require('../ledger-data.js');
const tx=(id,account,amount,merchant='Market',date='2026-10-10')=>({transaction_id:id,account_id:account,amount,merchant_name:merchant,date,pending:false});
const s=M.migrate({});
M.applyPlaidSync(s,{itemId:'a',accounts:[{account_id:'checking',name:'Checking',type:'depository'}],added:[tx('t1','checking',22)],modified:[],removed:[],nextCursor:'c1'});
const snapshot=JSON.stringify(s);
assert.throws(()=>M.applyPlaidSync(s,{itemId:'a',added:[tx('x','checking',30),tx('x','checking',32)],modified:[],removed:[],nextCursor:'c2'}),/Conflicting repeated/);
assert.equal(JSON.stringify(s),snapshot,'Bad batch cannot partially commit');
assert.throws(()=>M.applyPlaidSync(s,{itemId:'b',added:[tx('t1','checking',22)],modified:[],removed:[],nextCursor:'b1'}),/multiple Plaid Items/);
assert.equal(JSON.stringify(s),snapshot);
assert.throws(()=>M.applyPlaidSync(s,{itemId:'a',accounts:[{account_id:'card',type:'credit'}],added:[{...tx('posted','card',22),pending_transaction_id:'t1'}],modified:[],removed:[],nextCursor:'c3'}),/another account/);
assert.equal(JSON.stringify(s),snapshot);
M.applyPlaidSync(s,{itemId:'a',added:[tx('t1','checking',22)],modified:[],removed:[],nextCursor:'c4'});
assert.equal(s.transactions.length,1,'Idempotent replay');
const amb=M.migrate({accounts:[{id:'check',name:'Checking',type:'checking'},{id:'c1',name:'Card one',type:'credit'},{id:'c2',name:'Card two',type:'credit'}],
 transactions:[{id:'out',accountId:'check',date:'2026-10-10',merchant:'Credit Card Payment',amount:100,type:'expense'},
 {id:'in1',accountId:'c1',date:'2026-10-10',merchant:'Payment Thank You',amount:100,type:'income'},
 {id:'in2',accountId:'c2',date:'2026-10-10',merchant:'Payment Thank You',amount:100,type:'income'}]});
const before=JSON.stringify(amb.transactions),audit=M.accountingView(amb);
assert.equal(audit.summary.matchedTransfers,0,'Ambiguity must not automatically match');
assert.ok(audit.issues.some(i=>i.status==='ambiguous'));
assert.equal(JSON.stringify(amb.transactions),before,'Audit never mutates source');
const legacy=M.migrate({});
M.applyPlaidSync(legacy,{added:[tx('legacy-1','checking',11)],modified:[],removed:[],nextCursor:'legacy-a'});
M.applyPlaidSync(legacy,{added:[],modified:[tx('legacy-1','checking',12)],removed:[],nextCursor:'legacy-b'});
assert.equal(legacy.transactions.length,1,'Legacy sync without Item ID remains an idempotent upsert');
assert.equal(legacy.transactions[0].amount,12);
// A retailer may return part of several purchases as a merchant-labelled
// credit with no literal "refund" in the original bank description.
const retail=M.migrate({});
const retailTx=(id,account,amount,merchant,date,primary='SHOPPING',level='HIGH')=>({
 ...tx(id,account,amount,merchant,date),
 personal_finance_category:{primary,detailed:primary+'_OTHER',confidence_level:level}
});
M.applyPlaidSync(retail,{itemId:'retail',accounts:[
 {account_id:'card',type:'credit',name:'Cashback Card'},
 {account_id:'cash',type:'depository',subtype:'checking',name:'Checking'}
],added:[
 retailTx('store-a','card',65,'Market House','2026-09-12'),
 retailTx('store-b','card',70,'Market House','2026-09-21'),
 retailTx('merchant-credit','card',-28,'Market House','2026-10-03'),
 retailTx('unproven-credit','card',-9,'Unfamiliar Shop','2026-10-02'),
 retailTx('generic-adjust','card',-8,'Account Adjustment','2026-10-02','OTHER'),
 retailTx('card-payment-out','cash',100,'Credit Card Payment','2026-10-05','TRANSFERS'),
 retailTx('card-payment-in','card',-100,'Payment Thank You','2026-10-05','TRANSFERS')
],modified:[],removed:[],nextCursor:'r1'});
const byProvider=id=>M.records(retail).find(t=>t.source?.providerTransactionId===id);
const merchantCredit=byProvider('merchant-credit');
assert.equal(merchantCredit.type,'refund','Confident merchant-labelled return is not an internal transfer');
assert.equal(merchantCredit.spendingAmount,-28,'Return reduces economic spending');
assert.equal(merchantCredit.refundSuggestedCategory,'Shopping');
assert.equal(M.accountingView(retail).summary.spending,107,'Several store purchases net the merchant credit exactly once');
assert.equal(byProvider('card-payment-in').type,'transfer','Card settlement stays a transfer');
assert.equal(byProvider('card-payment-out').type,'transfer','Checking settlement stays a transfer');
assert.equal(byProvider('unproven-credit').type,'transfer','No historical purchase: no invented refund');
assert.equal(byProvider('generic-adjust').type,'transfer','Generic credit: no invented refund');
assert.ok(M.categoryReviewQueue(retail).transactions.some(t=>t.id===byProvider('unproven-credit').id&&t.creditKind),
 'Unclassified incoming card credit remains reviewable');
M.setCategory(retail,merchantCredit.id,'Transfer');
const conflict=M.categoryReviewQueue(retail).transactions.find(t=>t.id===merchantCredit.id);
assert.ok(conflict&&/Merchant refund/.test(conflict.reason),'Outdated manual Transfer category requires review');
assert.equal(conflict.suggested,'Shopping','Use evidence from matched purchases, not a forced override');
assert.equal(byProvider('merchant-credit').category,'Transfer','Saved owner category remains unchanged');
console.log('PASS Phase 1 atomic duplicate/cross-account safeguards and human review flags');
