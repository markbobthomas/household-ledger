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
// A merchant credit after multiple purchases is a refund, not an internal
// transfer. Keep the source immutable and unrelated card credits conservative.
const retail=M.migrate({});
M.applyPlaidSync(retail,{itemId:'retail',accounts:[{account_id:'retail-card',type:'credit'}],
 added:[tx('buy-a','retail-card',80,'Example Retail','2026-10-01'),
  tx('buy-b','retail-card',35,'Example Retail','2026-10-04'),
  tx('return','retail-card',-18.5,'Example Retail','2026-10-09'),
  tx('payment','retail-card',-50,'Payment Thank You','2026-10-10'),
  tx('unknown','retail-card',-3,'Statement Adjustment','2026-10-11')],
 modified:[],removed:[],nextCursor:'r'});
const originalRetail=JSON.stringify(retail.transactions);
const mapped=new Map(M.records(retail).map(t=>[t.source.providerTransactionId,t]));
assert.equal(mapped.get('return').type,'refund','Merchant credit counts despite multiple source purchases');
assert.equal(mapped.get('return').spendingAmount,-18.5,'Refund reduces net spending');
assert.equal(mapped.get('return').reconciliationStatus,'needs-review',
 'Multiple possible purchase categories remain in Review');
assert.equal(mapped.get('payment').type,'transfer','Card settlement is still a transfer');
assert.equal(mapped.get('unknown').type,'transfer','Unknown adjustment is not assumed a refund');
assert.equal(M.accountingView(retail).summary.spending,96.5,
 'Purchases minus evidenced refund without double-counting card payment');
assert.equal(JSON.stringify(retail.transactions),originalRetail,'Read-only provider state');

console.log('PASS Phase 1 atomic duplicate/cross-account safeguards and human review flags');
