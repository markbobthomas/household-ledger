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
assert.equal(F.forecast(M.records(state),'2026-10','Other','2026-10-17').actual,285,
 'Monthly budget actual accounts for card spending and refunds');
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
assert.equal(M.records(incoming)[0].type,'income','An ordinary received payment to checking is not card settlement');
assert.equal(M.accountingView(incoming).summary.income,125);

const unknown=M.migrate({transactions:[{id:'a',type:'income',date:'2026-10-01',amount:150,account:'Unverified Account',merchant:'Deposit'}]});
assert.equal(M.accountsFor(unknown)[0].type,'unknown','Never invent verified account types');
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
  assert.ok((await page.locator('.ledger-table tbody tr').filter({hasText:'Credit Card Payment'}).first().innerText()).includes('Card payment'));
  const refund=await page.locator('.ledger-table tbody tr').filter({hasText:'Refund Grocery Shop'}).innerText();
  assert.ok(refund.includes('Refund')&&refund.includes('20.00'));
  const before=await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.getItem('household-ledger-v1')).transactions));
  await page.locator(nav('insights')).click();await page.locator('[data-insight=categories]').click();
  const summary=await page.locator('.stats').innerText();
  assert.ok(summary.includes('$285.00'),'Spend totals reconcile across 5 accounts: '+summary);
  assert.ok(summary.includes('$1,010.00'),'Income excludes credit card payments: '+summary);
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
