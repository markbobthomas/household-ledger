const assert=require('node:assert/strict');
const C=require('../categorization.js'),M=require('../ledger-data.js');
const classify=(primary,detailed,confidence_level='VERY_HIGH',name='Unrecognized Merchant')=>
 C.classify({merchant_name:name,personal_finance_category:{primary,detailed,confidence_level}});
assert.equal(classify('FOOD_AND_DRINK','FOOD_AND_DRINK_GROCERIES').category,'Groceries');
assert.equal(classify('FOOD_AND_DRINK','FOOD_AND_DRINK_FAST_FOOD').category,'Dining');
assert.equal(classify('GENERAL_MERCHANDISE','GENERAL_MERCHANDISE_SUPERSTORES','HIGH').category,'Shopping');
assert.equal(classify('TRANSPORTATION','TRANSPORTATION_GAS','MEDIUM').category,'Transportation');
assert.equal(classify('RENT_AND_UTILITIES','RENT_AND_UTILITIES_RENT').category,'Housing');
assert.equal(classify('RENT_AND_UTILITIES','RENT_AND_UTILITIES_INTERNET_AND_CABLE').category,'Utilities');
assert.equal(classify('MEDICAL','MEDICAL_PHARMACIES_AND_SUPPLEMENTS').category,'Health');
assert.equal(classify('INSURANCE','INSURANCE_AUTO').category,'Insurance');
assert.equal(classify('FOOD_AND_DRINK','FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK').category,'Other',
 'Broad food categories cannot guess between groceries and restaurants');
assert.equal(classify('GENERAL_MERCHANDISE','GENERAL_MERCHANDISE_SUPERSTORES','LOW').category,'Other',
 'Low confidence generic merchant remains Other');
assert.equal(C.classify({name:'Amazon'}).category,'Other','Do not guess mixed-use merchant categories');
assert.equal(C.classify({name:'Costco Warehouse'}).category,'Other','Costco is mixed use');
assert.equal(C.classify({name:'Safeway Groceries'}).category,'Groceries');
assert.equal(C.classify({name:'Refund Market Grocery'}).category,'Groceries');
assert.equal(C.classify({name:'Pending Merchant'}).category,'Other','Unclear merchant remains visible for review');
assert.equal(C.classify({name:'Burger King'}).category,'Dining');
assert.equal(classify('GENERAL_MERCHANDISE','GENERAL_MERCHANDISE_SUPERSTORES','VERY_HIGH','Costco').category,'Shopping',
 'Clear Plaid category outranks unsafe merchant-name inference');
assert.equal(classify('INCOME','INCOME_WAGES').category,'Other','Payroll uses income accounting, not a spending budget');
assert.equal(classify('TRANSFER_OUT','TRANSFER_OUT_ACCOUNT_TRANSFER').category,'Other',
 'Internal transfers use account reconciliation, never an expense budget');
const t=(transaction_id,amount,merchant_name,extra={})=>({
 transaction_id,account_id:'card',date:'2026-10-12',amount,merchant_name,...extra});
const pfc=(primary,detailed,confidence_level='VERY_HIGH')=>({primary,detailed,confidence_level});
const state=M.migrate({});
M.applyPlaidSync(state,{itemId:'fixtureA',simulated:true,
 accounts:[{account_id:'card',type:'credit',subtype:'credit card',name:'Visa'}],
 added:[
  t('grocery',90,'Market Grocery',{personal_finance_category:pfc('FOOD_AND_DRINK','FOOD_AND_DRINK_GROCERIES')}),
  t('refund',-15,'Refund Market Grocery',{personal_finance_category:pfc('FOOD_AND_DRINK','FOOD_AND_DRINK_GROCERIES')}),
  t('pending',22,'Pending Merchant',{pending:true,personal_finance_category:pfc('GENERAL_MERCHANDISE','GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE','MEDIUM')}),
  t('unknown',45,'Unrecognized Merchant')
 ],modified:[],removed:[],nextCursor:'a'});
const byName=new Map(M.records(state).map(x=>[x.merchant,x]));
assert.equal(byName.get('Market Grocery').category,'Groceries');
assert.equal(byName.get('Market Grocery').method,'plaid-category');
assert.equal(byName.get('Pending Merchant').category,'Shopping');
assert.equal(byName.get('Refund Market Grocery').category,'Groceries');
assert.equal(byName.get('Unrecognized Merchant').category,'Other','Unknown remains transparently unclassified');
assert.equal(state.transactions.find(x=>x.merchant==='Market Grocery').source.personalFinanceCategory.primary,'FOOD_AND_DRINK');
assert.equal(state.transactions.find(x=>x.merchant==='Market Grocery').source.categoryConfidence,0.99);
assert.equal(M.accountingView(state).summary.spending,75,'Expense and refund net correctly; pending excluded');
const baseline=JSON.stringify(state.transactions);
M.records(state);M.records(state);
assert.equal(JSON.stringify(state.transactions),baseline,'Derived categorization reads cannot mutate source bank facts');
const groceryId=byName.get('Market Grocery').id;
M.setCategory(state,groceryId,'Shopping');
assert.equal(M.records(state).find(x=>x.id===groceryId).category,'Shopping',
 'Manual category overrides confident Plaid categorization');
assert.equal(M.records(state).find(x=>x.id===groceryId).method,'manual');
M.applyPlaidSync(state,{itemId:'fixtureA',simulated:true,added:[],modified:[
 t('grocery',90,'Market Grocery',{personal_finance_category:pfc('FOOD_AND_DRINK','FOOD_AND_DRINK_GROCERIES')})
],removed:[],nextCursor:'b'});
assert.equal(M.records(state).find(x=>x.id===groceryId).category,'Shopping',
 'Resync cannot discard manual corrections');
const pendingId=byName.get('Pending Merchant').id;
M.setCategory(state,pendingId,'Health');
M.applyPlaidSync(state,{itemId:'fixtureA',simulated:true,added:[
 t('posted',22,'Pending Merchant',{pending_transaction_id:'pending',pending:false,
  personal_finance_category:pfc('GENERAL_MERCHANDISE','GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE','HIGH')})
],modified:[],removed:[{transaction_id:'pending'}],nextCursor:'c'});
assert.equal(M.records(state).find(x=>x.source.providerTransactionId==='posted').category,'Health',
 'Manual category must survive pending to posted');
assert.equal(M.records(state).filter(x=>x.merchant==='Pending Merchant').length,1);
const older=M.migrate({accounts:state.accounts,transactions:[
 {id:'plaid:fixtureA:legacy',date:'2026-10-11',merchant:'Market Grocery',amount:75,type:'expense',
  category:'Other',accountId:'card',source:{provider:'plaid',providerTransactionId:'legacy',
   accountId:'card',itemId:'fixtureA',verified:true,simulated:true,plaidAmount:75}},
 {id:'plaid:fixtureA:older-pfc',date:'2026-10-11',merchant:'Unrecognized Merchant',
  amount:25,type:'expense',category:'Other',accountId:'card',source:{provider:'plaid',
   providerTransactionId:'older-pfc',plaidAmount:25,accountId:'card',verified:true,
   personalFinanceCategory:pfc('GENERAL_MERCHANDISE','GENERAL_MERCHANDISE_SUPERSTORES')}}
]});
const before=JSON.stringify(older.transactions);
const olderCategories=Object.fromEntries(M.records(older).map(x=>[x.id,{category:x.category,method:x.method}]));
assert.deepEqual(olderCategories['plaid:fixtureA:legacy'],{category:'Groceries',method:'merchant-match'});
assert.deepEqual(olderCategories['plaid:fixtureA:older-pfc'],{category:'Shopping',method:'plaid-category'});
assert.equal(JSON.stringify(older.transactions),before,
 'Backfill prior Sandbox records in presentation without rewriting source rows');
M.setCategory(older,'plaid:fixtureA:legacy','Dining');
assert.equal(M.records(older)[0].category,'Dining');
const demo=M.migrate({transactions:[{id:'demo-generic',date:'2026-10-11',merchant:'Demo Purchase',
 amount:16,type:'expense',category:'Other',account:'Checking',
 source:{provider:'demo',verified:false}}]});
assert.equal(M.records(demo)[0].category,'Other',
 'Ordinary demo data without Plaid metadata must still render safely');
console.log('PASS: Plaid PFCv1/v2 and merchant categorization, low confidence safeguards, legacy backfill, manual overrides, refunds, pending-posted and source immutability');
