const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const M=require('../ledger-data.js'),F=require('../forecast.js'),L=require('../forecast-ledger.js');
const tx=(transaction_id,account_id,amount,merchant_name,date='2026-10-09')=>({transaction_id,account_id,amount,merchant_name,date,pending:false});
const accounts=[{account_id:'checking-a',type:'depository',subtype:'checking',name:'Everyday Checking'},
 {account_id:'checking-b',type:'depository',subtype:'checking',name:'Reserve Checking'},
 {account_id:'savings',type:'depository',subtype:'savings',name:'Emergency Savings'},
 {account_id:'card-visa',type:'credit',subtype:'credit card',name:'Visa Rewards'},
 {account_id:'card-amex',type:'credit',subtype:'credit card',name:'Amex Gold'}];
const source=[
 tx('visa-grocery','card-visa',200,'Grocery Shop'),tx('visa-pay-out','checking-a',200,'Credit Card Payment'),
 tx('visa-pay-in','card-visa',-200,'Payment Thank You'),tx('savings-out','checking-a',100,'Transfer to Savings'),
 tx('savings-in','savings',-100,'Transfer from Checking'),tx('visa-refund','card-visa',-20,'Refund Grocery Shop'),
 tx('payroll','checking-a',-1000,'Payroll'),tx('amex-charge','card-amex',80,'Gym Store'),
 tx('amex-partial-out','checking-b',30,'Card Payment'),tx('amex-partial-in','card-amex',-30,'Payment Thank You'),
 tx('unmatched-card-pay','checking-b',15,'Credit Card Payment'),tx('ordinary-income','savings',-10,'Interest Earned'),
 tx('unclassified-credit','card-amex',-11,'Adjustment'),tx('other-purchase','checking-b',25,'Corner Store')
];
function make(){
 const s=M.migrate({});
 M.applyPlaidSync(s,{itemId:'bank-a',accounts:accounts.slice(0,4),added:source.filter(t=>t.account_id!=='card-amex'),modified:[],removed:[],nextCursor:'a'});
 M.applyPlaidSync(s,{itemId:'bank-b',accounts:accounts.slice(4),added:source.filter(t=>t.account_id==='card-amex'),modified:[],removed:[],nextCursor:'b'});
 return s;
}
const state=make(),original=JSON.stringify(state.transactions);
const view=M.records(state),byId=new Map(view.map(x=>[x.source.providerTransactionId,x]));
const audit=M.accountingView(state);
assert.equal(M.accountsFor(state).length,5,'All five accounts registered');
assert.deepEqual(M.accountsFor(state).map(x=>x.type).sort(),['checking','checking','savings','credit','credit'].sort());
for(const id of ['visa-pay-out','visa-pay-in','amex-partial-out','amex-partial-in','savings-out','savings-in']){
 assert.equal(byId.get(id).type,'transfer',id+' is not household spending');
 assert.ok(byId.get(id).pairedTransactionId,id+' matched');
}
assert.equal(byId.get('visa-pay-out').pairedTransactionId,byId.get('visa-pay-in').id);
assert.equal(byId.get('savings-out').pairedTransactionId,byId.get('savings-in').id);
assert.equal(byId.get('unmatched-card-pay').type,'transfer');
assert.equal(byId.get('unmatched-card-pay').reconciliationStatus,'unmatched');
assert.equal(byId.get('visa-refund').spendingAmount,-20);
assert.equal(byId.get('unclassified-credit').type,'transfer','Unknown credit card credit is not earned income');
assert.equal(byId.get('unclassified-credit').reconciliationStatus,'needs-review');
assert.equal(audit.summary.spending,285,'Household spending is 200+80+25-20, not card settlements');
assert.equal(audit.summary.income,1010,'Payroll and earned interest only');
assert.equal(audit.summary.matchedTransfers,3);
assert.equal(audit.summary.unmatchedTransfers,1);
assert.equal(audit.summary.needsReview,1);
assert.equal(JSON.stringify(state.transactions),original,'Accounting derives facts without mutating Plaid');
assert.equal(state.sync.itemCursors['bank-a'],'a');assert.equal(state.sync.itemCursors['bank-b'],'b');
M.applyPlaidSync(state,{itemId:'bank-a',added:[],modified:[],removed:[],nextCursor:'a2'});
assert.equal(state.sync.itemCursors['bank-b'],'b','Plaid Item cursors independent');
assert.equal(new Set(M.records(state).map(t=>t.id)).size,source.length,'No duplicate source records');
assert.equal(F.forecast(M.records(state),'2026-10','Groceries','2026-10-17').actual,180,
 'Grocery purchase less its card refund appears in Groceries');
assert.equal(F.forecast(M.records(state),'2026-10','Other','2026-10-17').actual,105,
 'Unrecognized gym and corner-store purchases remain Other, not invented categories');
assert.equal(['Groceries','Other'].reduce((n,cat)=>
 n+F.forecast(M.records(state),'2026-10',cat,'2026-10-17').actual,0),285,
 'Category budgets sum to reconciled household spending without duplicate card payments');
L.build(state,M.records(state),'2026-10-17',90,F,M);
assert.equal(JSON.stringify(state.transactions),original,'Forecast cannot mutate source ledger');
const posted=M.migrate({accounts:[{id:'cc',name:'Credit',type:'credit'}]});
M.applyPlaidSync(posted,{itemId:'item-c',added:[{...tx('pending','cc',20,'Book Store'),pending:true}],modified:[],removed:[],nextCursor:'p'});
M.setCategory(posted,'plaid:item-c:pending','Shopping');
M.applyPlaidSync(posted,{itemId:'item-c',added:[{...tx('posted','cc',20,'Book Store'),pending_transaction_id:'pending'}],modified:[],removed:[],nextCursor:'q'});
assert.equal(posted.transactions.length,1,'Pending/posting cannot double a charge');
assert.equal(M.records(posted)[0].category,'Shopping','Overrides migrate to posted transaction');
const ambiguous=M.migrate({accounts:[{id:'c',type:'checking',name:'Checking'},
 {id:'cc1',type:'credit',name:'Card A'},{id:'cc2',type:'credit',name:'Card B'}],
 transactions:[{id:'out',type:'expense',date:'2026-10-10',accountId:'c',merchant:'Credit Card Payment',amount:100},
 {id:'in1',type:'income',date:'2026-10-10',accountId:'cc1',merchant:'Payment Thank You',amount:100},
 {id:'in2',type:'income',date:'2026-10-10',accountId:'cc2',merchant:'Payment Thank You',amount:100}]});
assert.equal(M.records(ambiguous).filter(t=>t.pairedTransactionId).length,0,'Ambiguous identical card settlements remain unmatched');
assert.equal(M.accountingView(ambiguous).summary.spending,0,'Ambiguous transfers do not become spending');
const incoming=M.migrate({accounts:[{id:'check',type:'checking',name:'Checking'}],
 transactions:[{id:'client-fee',date:'2026-10-10',accountId:'check',merchant:'Payment received',amount:125,type:'income'}]});
assert.equal(M.records(incoming)[0].type,'transfer','An unlabeled checking credit is not proof of earned income');
assert.equal(M.records(incoming)[0].reconciliationStatus,'needs-review');
assert.equal(M.accountingView(incoming).summary.income,0);

const unknown=M.migrate({transactions:[{id:'a',type:'income',date:'2026-10-01',amount:150,account:'Unverified Account',merchant:'Deposit'}]});
assert.equal(M.accountsFor(unknown)[0].type,'unknown','Never invent verified account types');
// Multiple real purchases at one merchant must not make a subsequent
// source-evidenced card credit disappear from net spending. Do not change the
// source transactions or turn a genuine card settlement into a refund.
const storeCreditState=M.migrate({});
M.applyPlaidSync(storeCreditState,{itemId:'refund-item',
 accounts:[{account_id:'card-refunds',type:'credit',subtype:'credit card',name:'Test Card'}],
 added:[
  tx('store-first','card-refunds',80,'Example Superstore','2026-10-01'),
  tx('store-second','card-refunds',35,'Example Superstore','2026-10-04'),
  {...tx('store-credit','card-refunds',-18.5,'Example Superstore','2026-10-09'),
   personal_finance_category:{primary:'SHOPPING',detailed:'SHOPPING_SUPERSTORES',confidence_level:'VERY_HIGH'}},
  tx('card-settlement','card-refunds',-50,'Payment Thank You','2026-10-10'),
  tx('unknown-credit','card-refunds',-3,'Statement Adjustment','2026-10-11'),
  tx('unverified-credit','card-refunds',-2,'Example Superstore','2026-10-12')
 ],modified:[],removed:[],nextCursor:'ref-credit'});
const beforeStoreCredit=JSON.stringify(storeCreditState.transactions);
const storeCreditRows=new Map(M.records(storeCreditState).map(t=>[t.source.providerTransactionId,t]));
const storeRefund=storeCreditRows.get('store-credit');
assert.equal(storeRefund.type,'refund','Merchant credit offsets spending despite several prior purchases');
assert.equal(storeRefund.spendingAmount,-18.5);
assert.equal(storeRefund.reconciliationStatus,'needs-review','Ambiguous original purchase/category stays in review');
assert.equal(storeCreditRows.get('card-settlement').type,'transfer','Card settlement must remain a transfer');
assert.equal(storeCreditRows.get('card-settlement').spendingAmount,0);
assert.equal(storeCreditRows.get('unknown-credit').type,'transfer','Unidentified statement credit stays under review');
assert.equal(storeCreditRows.get('unknown-credit').spendingAmount,0);
assert.equal(storeCreditRows.get('unverified-credit').type,'transfer',
 'Without independent bank category evidence, repeated merchant matches do not prove a refund');
assert.ok(M.categoryReviewQueue(storeCreditState).transactions.some(t=>
 t.id===storeCreditRows.get('unverified-credit').id&&t.creditKind),
 'Unverified card credit remains reviewable');
assert.equal(M.accountingView(storeCreditState).summary.spending,96.5,
 'Two charges less the supported merchant credit, without card payment duplication');
assert.equal(JSON.stringify(storeCreditState.transactions),beforeStoreCredit,
 'Refund reconciliation must not mutate raw source transactions');

// Reclassification is derived from the signed provider amount, even for
// historical source records previously imported as transfers.
const DirectionAccounting=require('../accounting.js');
const categoryEngine=require('../categorization.js');
const insuranceCode={primary:'INSURANCE',detailed:'INSURANCE_OTHER',confidence_level:'HIGH'};
assert.equal(DirectionAccounting.classifyPlaidSource({
 amount:27.25,merchant:'Fictional Insurance PYMT',description:'PREMIUM PYMT',pfc:insuranceCode
 },{type:'credit'},categoryEngine).type,'expense','A card debit containing PYMT is a purchase, not a transfer');
assert.equal(DirectionAccounting.classifyPlaidSource({
 amount:19.40,merchant:'Fictional App PYMT',description:'SUBSCRIPTION PYMT'
 },{type:'credit'},categoryEngine).type,'expense','App charges containing PYMT remain spending');
assert.equal(DirectionAccounting.classifyPlaidSource({
 amount:-100,merchant:'Payment Thank You',description:'Payment Received'
 },{type:'credit'},categoryEngine).type,'transfer','An incoming card settlement is still a transfer');
const directionState=M.migrate({accounts:[
 {id:'checking-direction',name:'Checking',type:'checking'},
 {id:'card-direction',name:'Card',type:'credit'}],transactions:[
 {id:'insurance-pymt',accountId:'card-direction',date:'2026-10-02',
  merchant:'Fictional Insurance PYMT',description:'PREMIUM PYMT',type:'transfer',amount:27.25,
  category:'Insurance',source:{provider:'plaid',plaidAmount:27.25}},
 {id:'app-pymt',accountId:'card-direction',date:'2026-10-03',
  merchant:'Fictional App PYMT',type:'transfer',amount:19.40,
  category:'Subscriptions',source:{provider:'plaid',plaidAmount:19.40}},
 {id:'cash-card-repayment',accountId:'checking-direction',date:'2026-10-04',
  merchant:'Credit Card Payment',type:'transfer',amount:100,
  source:{provider:'plaid',plaidAmount:100}},
 {id:'issuer-card-repayment',accountId:'card-direction',date:'2026-10-04',
  merchant:'Payment Thank You',type:'transfer',amount:100,
  source:{provider:'plaid',plaidAmount:-100}}]});
const directionOriginal=JSON.stringify(directionState.transactions);
const corrected=M.records(directionState),correctedById=new Map(corrected.map(x=>[x.id,x]));
for(const id of ['insurance-pymt','app-pymt']){
 assert.equal(correctedById.get(id).type,'expense','Card charge now counts toward spending: '+id);
 assert.equal(correctedById.get(id).pairedTransactionId,null);
}
assert.equal(correctedById.get('cash-card-repayment').accountingKind,'card_payment');
assert.equal(correctedById.get('issuer-card-repayment').accountingKind,'card_payment');
assert.equal(correctedById.get('cash-card-repayment').pairedTransactionId,'issuer-card-repayment');
assert.equal(M.accountingView(directionState).summary.spending,46.65,
 'Recomputed historical spending includes the two falsely excluded card purchases');
assert.equal(JSON.stringify(directionState.transactions),directionOriginal,
 'Reclassification cannot rewrite original bank transactions');

async function browserCase(browser,opts,mobile){
 const page=await browser.newPage(opts),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const Base=Date;class Fixed extends Base{
 constructor(...v){if(v.length)super(...v);else super('2026-10-17T12:00:00Z')}
 static now(){return new Base('2026-10-17T12:00:00Z').getTime()}}window.Date=Fixed;});
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  await page.evaluate(({accounts,source})=>{
   const M=window.HouseholdLedgerData,s=M.migrate({});
   M.applyPlaidSync(s,{itemId:'bank-a',accounts:accounts.slice(0,4),added:source.filter(t=>t.account_id!=='card-amex'),modified:[],removed:[],nextCursor:'a'});
   M.applyPlaidSync(s,{itemId:'bank-b',accounts:accounts.slice(4),added:source.filter(t=>t.account_id==='card-amex'),modified:[],removed:[],nextCursor:'b'});
   localStorage.setItem('household-ledger-v1',JSON.stringify(s));
  },{accounts,source});
  await page.reload({waitUntil:'load'});
  const nav=x=>mobile?'.mobile-top-nav [data-page='+x+']':'aside [data-page='+x+']';
  await page.locator(nav('transactions')).click();
  assert.ok((await page.locator('.ledger-table tbody tr').filter({hasText:'Credit Card Payment'}).first().innerText()).toLowerCase().includes('card payment'));
  const refund=await page.locator('.ledger-table tbody tr').filter({hasText:'Refund Grocery Shop'}).innerText();
  assert.ok(refund.includes('Refund')&&refund.includes('20.00'));
  const before=await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.getItem('household-ledger-v1')).transactions));
  await page.locator(nav('insights')).click();await page.locator('[data-insight=categories]').click();
  const summary=await page.locator('.stats').innerText();
  assert.ok(summary.includes('$285.00'),'Category spending reconciles across 5 accounts: '+summary);
  // Categories now shares Budget's monthly values; all-source income remains
  // available in Merchants and still excludes card settlements.
  await page.locator('[data-insight=merchants]').click();
  const incomeSummary=await page.locator('.stats').innerText();
  assert.ok(incomeSummary.includes('$1,010.00'),'Income excludes credit card payments: '+incomeSummary);
  await page.locator(nav('settings')).click();
  const settings=await page.locator('#view').innerText();
  assert.ok(settings.includes('5 recorded accounts')&&settings.includes('3 matched internal/card payments'));
  assert.ok(settings.includes('Visa Rewards'));
  assert.equal(await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.getItem('household-ledger-v1')).transactions)),before);
  if(mobile)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
 }finally{await page.close()}
}
(async()=>{
 const chrome=await chromium.launch({headless:true});try{await browserCase(chrome,{viewport:{width:1300,height:850}},false)}finally{await chrome.close()}
 const safari=await webkit.launch({headless:true});try{await browserCase(safari,{...devices['iPhone 13']},true)}finally{await safari.close()}
 console.log('PASS: Phase A accounts, card purchases and settlements, partial payments, transfer matching, refunds, per-Item cursors, pending-posted, budgets, desktop and iPhone');
})().catch(e=>{console.error(e);process.exit(1)});
