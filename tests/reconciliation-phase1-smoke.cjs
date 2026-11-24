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
   {...tx('return','retail-card',-18.5,'Example Retail','2026-10-09'),
   personal_finance_category:{primary:'SHOPPING',detailed:'SHOPPING_SUPERSTORES',confidence_level:'HIGH'}},
  tx('payment','retail-card',-50,'Payment Thank You','2026-10-10'),
  tx('unknown','retail-card',-3,'Statement Adjustment','2026-10-11'),
  tx('unsupported','retail-card',-4,'Example Retail','2026-10-12')],
 modified:[],removed:[],nextCursor:'r'});
const originalRetail=JSON.stringify(retail.transactions);
const mapped=new Map(M.records(retail).map(t=>[t.source.providerTransactionId,t]));
assert.equal(mapped.get('return').type,'refund','Merchant credit counts despite multiple source purchases');
assert.equal(mapped.get('return').spendingAmount,-18.5,'Refund reduces net spending');
assert.equal(mapped.get('return').reconciliationStatus,'needs-review',
 'Multiple possible purchase categories remain in Review');
assert.equal(mapped.get('payment').type,'transfer','Card settlement is still a transfer');
assert.equal(mapped.get('unknown').type,'transfer','Unknown adjustment is not assumed a refund');
assert.equal(mapped.get('unsupported').type,'transfer','Repeated retail merchant without provider purpose is still uncertain');
assert.ok(M.categoryReviewQueue(retail).transactions.some(t=>
 t.id===mapped.get('unsupported').id&&t.creditKind),
 'Unproven incoming card credit must appear in Review');
M.setCategory(retail,mapped.get('return').id,'Transfer');
const merchantReview=M.categoryReviewQueue(retail).transactions.find(t=>t.id===mapped.get('return').id);
assert.ok(merchantReview&&/Merchant refund/.test(merchantReview.reason),
 'Manual Transfer category conflicting with refund is reviewable');
assert.equal(merchantReview.suggested,'Shopping','Bank-derived purchase category suggested without overwriting owner choice');
assert.equal(M.records(retail).find(t=>t.id===mapped.get('return').id).category,'Transfer',
 'Reconciliation leaves source and explicit owner category untouched');
assert.equal(M.accountingView(retail).summary.spending,96.5,
 'Purchases minus evidenced refund without double-counting card payment');
assert.equal(JSON.stringify(retail.transactions),originalRetail,'Read-only provider state');

// Equal amount and a nearby date are not proof of a transfer BETWEEN cards.
// The issuer-side receipt can still match a verified checking debit; an
// unrelated card merchant credit can instead refund a same-card purchase.
const twoCards=M.migrate({accounts:[
 {id:'cash-qa',name:'Fictional Checking',type:'checking'},
 {id:'card-a',name:'Fictional Card A',type:'credit'},
 {id:'card-b',name:'Fictional Card B',type:'credit'}
],transactions:[
 {id:'video',accountId:'card-a',date:'2026-10-24',type:'expense',
  merchant:'Fictional Video Membership',amount:27.42,
  source:{provider:'plaid',plaidAmount:27.42}},
 {id:'cloud-buy',accountId:'card-b',date:'2026-10-20',type:'expense',
  merchant:'Fictional Cloud Storage',amount:27.42,
  source:{provider:'plaid',plaidAmount:27.42}},
 {id:'cloud-return',accountId:'card-b',date:'2026-10-25',type:'transfer',
  merchant:'Fictional Cloud Storage',amount:27.42,
  source:{provider:'plaid',plaidAmount:-27.42,
   personalFinanceCategory:{primary:'TRANSFER_IN',detailed:'TRANSFER_IN_ACCOUNT_TRANSFER'}}},
 {id:'cash-card-payment',accountId:'cash-qa',date:'2026-10-26',type:'transfer',
  merchant:'Fictional Visa Credit Card Payment',amount:118.50,
  source:{provider:'plaid',plaidAmount:118.50}},
 {id:'issuer-payment',accountId:'card-b',date:'2026-10-25',type:'transfer',
  merchant:'AUTOMATIC PAYMENT - THANK',amount:118.50,
  source:{provider:'plaid',plaidAmount:-118.50}}
]});
const twoCardsSource=JSON.stringify(twoCards.transactions);
const conservative=new Map(M.records(twoCards).map(t=>[t.id,t]));
assert.equal(conservative.get('video').type,'expense');
assert.equal(conservative.get('video').pairedTransactionId,null,
 'An unrelated credit on another card cannot erase a genuine card purchase');
assert.equal(conservative.get('cloud-return').accountingKind,'refund',
 'A source TRANSFER_IN label cannot hide an evidenced same-card merchant refund');
assert.equal(conservative.get('cloud-return').pairedTransactionId,null);
assert.equal(conservative.get('cloud-return').spendingAmount,-27.42);
assert.equal(conservative.get('issuer-payment').accountingKind,'card_payment',
 'Exact issuer-side automatic-payment receipt is a repayment, not a refund');
assert.equal(conservative.get('issuer-payment').pairedTransactionId,'cash-card-payment');
assert.equal(conservative.get('cash-card-payment').pairedTransactionId,'issuer-payment');
assert.equal(JSON.stringify(twoCards.transactions),twoCardsSource,
 'Read-only reconciliation never changes bank source or owner decisions');


// The private Plaid adapter supplies raw bank types (depository/credit) to
// migrate(), not normalized account types from the sync registrar. Reconcile
// these source rows at read time, without writing to the source snapshot.
const rawBank=M.migrate({accounts:[
 {id:'raw-cash',name:'Checking',type:'depository',subtype:'checking'},
 {id:'raw-savings',name:'Savings',type:'depository',subtype:'savings'},
 {id:'raw-card-a',name:'Card A',type:'credit'},
 {id:'raw-card-b',name:'Card B',type:'credit'}
],transactions:[
 {id:'posted-cash-payment',accountId:'raw-cash',date:'2026-10-12',
  merchant:'Fictional Card Autopay',amount:142.31,type:'transfer',
  source:{provider:'plaid',plaidAmount:142.31}},
 {id:'generic-issuer-receipt',accountId:'raw-card-a',date:'2026-10-11',
  merchant:'ONLINE/MOBILE RECURRING',amount:142.31,type:'refund',
  source:{provider:'plaid',plaidAmount:-142.31}},
 {id:'savings-payment',accountId:'raw-savings',date:'2026-10-13',
  merchant:'Fictional Card Payment',amount:88.49,type:'transfer',
  source:{provider:'plaid',plaidAmount:88.49}},
 {id:'savings-card-receipt',accountId:'raw-card-b',date:'2026-10-14',
  merchant:'Payment Thank You',amount:88.49,type:'refund',
  source:{provider:'plaid',plaidAmount:-88.49}},
 {id:'ordinary-transfer',accountId:'raw-cash',date:'2026-10-14',
  merchant:'Transfer to savings',amount:64.17,type:'transfer',
  source:{provider:'plaid',plaidAmount:64.17}},
 {id:'unrelated-issuer-credit',accountId:'raw-card-a',date:'2026-10-14',
  merchant:'STATEMENT CREDIT',amount:64.17,type:'refund',
  source:{provider:'plaid',plaidAmount:-64.17}},
 {id:'unpaired-cash-payment',accountId:'raw-cash',date:'2026-10-15',
  merchant:'Credit Card Payment',amount:71.93,type:'transfer',
  source:{provider:'plaid',plaidAmount:71.93}},
 {id:'merchant-refund',accountId:'raw-card-a',date:'2026-10-15',
  merchant:'Refund Fictional Store',amount:71.93,type:'refund',
  source:{provider:'plaid',plaidAmount:-71.93}},
 {id:'ambiguous-payment',accountId:'raw-cash',date:'2026-10-16',
  merchant:'Card Payment',amount:48.90,type:'transfer',
  source:{provider:'plaid',plaidAmount:48.90}},
 {id:'ambiguous-credit-a',accountId:'raw-card-a',date:'2026-10-16',
  merchant:'ONLINE/MOBILE RECURRING',amount:48.90,type:'refund',
  source:{provider:'plaid',plaidAmount:-48.90}},
 {id:'ambiguous-credit-b',accountId:'raw-card-b',date:'2026-10-16',
  merchant:'ONLINE/MOBILE RECURRING',amount:48.90,type:'refund',
  source:{provider:'plaid',plaidAmount:-48.90}}
]});
const untouchedRaw=JSON.stringify(rawBank.transactions),rawTypes=new Map(M.accountsFor(rawBank).map(a=>[a.id,a.type]));
assert.equal(rawTypes.get('raw-cash'),'checking','Raw Plaid depository checking normalized before matching');
assert.equal(rawTypes.get('raw-savings'),'savings','Raw Plaid depository savings normalized before matching');
const rawRows=new Map(M.records(rawBank).map(row=>[row.id,row]));
assert.equal(rawRows.get('posted-cash-payment').pairedTransactionId,'generic-issuer-receipt');
assert.equal(rawRows.get('generic-issuer-receipt').pairedTransactionId,'posted-cash-payment');
assert.equal(rawRows.get('generic-issuer-receipt').accountingKind,'card_payment',
 'Unique generic card issuer credit closes a posted cash payment');
assert.equal(rawRows.get('generic-issuer-receipt').reconciliationStatus,'matched');
assert.equal(rawRows.get('savings-payment').pairedTransactionId,'savings-card-receipt',
 'Savings-funded issuer payment is treated as a paired transfer');
assert.equal(rawRows.get('ordinary-transfer').pairedTransactionId,null,
 'Generic savings transfer must not be mistaken for a card payment');
assert.equal(rawRows.get('unrelated-issuer-credit').accountingKind,'unclassified_card_credit',
 'Coincidentally equal unknown card credit remains reviewable');
assert.equal(rawRows.get('merchant-refund').type,'refund',
 'Explicit merchant refund cannot become a card payment on equal amount alone');
assert.equal(rawRows.get('merchant-refund').pairedTransactionId,null);
for(const id of ['ambiguous-payment','ambiguous-credit-a','ambiguous-credit-b'])
 assert.equal(rawRows.get(id).pairedTransactionId,null,
  'Competing equal-dollar card credits never get a guessed counterpart');
assert.equal(JSON.stringify(rawBank.transactions),untouchedRaw,
 'Source account and transaction records remain immutable during reconciliation');

// Many identical-merchant purchases need not block a refund when only ONE
// earlier charge has the same amount. Collisions stay in Review.
const exactRefunds=M.migrate({});
M.applyPlaidSync(exactRefunds,{itemId:'exact-credit',accounts:[
 {account_id:'credit-refund',type:'credit'}],added:[
 tx('order-a','credit-refund',60.78,'Fictional Marketplace','2026-10-01'),
 tx('order-b','credit-refund',99.26,'Fictional Marketplace','2026-10-04'),
 tx('return-b','credit-refund',-99.26,'Fictional Marketplace','2026-10-09'),
 tx('order-c','credit-refund',33.08,'Fictional Marketplace','2026-10-10'),
 tx('order-d','credit-refund',33.08,'Fictional Marketplace','2026-10-11'),
 tx('ambiguous-return','credit-refund',-33.08,'Fictional Marketplace','2026-10-13'),
 tx('unrelated-credit','credit-refund',-47.50,'Fictional Marketplace','2026-10-14')
],modified:[],removed:[],nextCursor:'matched'});
const exactOriginal=JSON.stringify(exactRefunds.transactions);
const exactRows=new Map(M.records(exactRefunds).map(t=>[t.source.providerTransactionId,t]));
assert.equal(exactRows.get('return-b').accountingKind,'refund',
 'Unique equal-amount credit is a supported refund even with multiple purchases');
assert.equal(exactRows.get('return-b').spendingAmount,-99.26);
assert.equal(exactRows.get('ambiguous-return').accountingKind,'unclassified_card_credit',
 'Two equal-dollar purchases do not establish which return was credited');
assert.equal(exactRows.get('unrelated-credit').accountingKind,'unclassified_card_credit',
 'A credit without matching purchase amount or provider evidence remains for Review');
assert.equal(JSON.stringify(exactRefunds.transactions),exactOriginal,
 'Refund reconciliation never rewrites bank data');

console.log('PASS Phase 1 atomic duplicate/cross-account safeguards and human review flags');
