const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const B=require('../account-forecast.js'),M=require('../ledger-data.js');
const asOf='2026-10-17';
const snapshot={asOf,mode:'connected',connected:true,accounts:[
 {id:'checking-a',name:'Checking A',accountType:'checking',current:5000,available:4900,balanceAsOf:asOf},
 {id:'checking-b',name:'Checking B',accountType:'checking',current:1000,available:1000,balanceAsOf:asOf},
 {id:'savings',name:'Savings',accountType:'savings',current:2000,available:2000,balanceAsOf:asOf},
 {id:'visa',name:'Visa',accountType:'credit',current:1200,available:2800,balanceAsOf:asOf,
  liabilities:{next_payment_due_date:'2026-11-05',minimum_payment_amount:60,last_statement_balance:800,last_statement_issue_date:'2026-10-08'}},
 {id:'amex',name:'Amex',accountType:'credit',current:600,available:4400,balanceAsOf:asOf,
  liabilities:{next_payment_due_date:'2026-11-03',minimum_payment_amount:150,last_statement_balance:600}},
 {id:'mastercard',name:'Mastercard',accountType:'credit',current:100,available:1900,balanceAsOf:asOf}
]};
const event=(id,accountId,type,amount,date='2026-10-22')=>({id,accountId,type,amount,date,merchant:id});
const plan=(id,from,to,amount,date='2026-10-25',extra={})=>
 ({id:'movement|'+id,fromAccountId:from,toAccountId:to,amount,anchorDate:date,frequency:'once',...extra});
const original=JSON.stringify(snapshot);
const baseline=B.build(snapshot,[],[],{days:90});
assert.equal(baseline.household.openingCash,8000);
assert.equal(baseline.household.openingDebt,1900);
assert.equal(baseline.household.openingNet,6100);
assert.equal(baseline.household.conservationDifference,0);
assert.equal(baseline.household.readyForLive,false,'Missing Mastercard statement details prevent complete live readiness');
assert.ok(baseline.diagnostics.statementWarnings.some(c=>c.accountId==='visa'));
assert.ok(baseline.diagnostics.statementWarnings.some(c=>c.accountId==='amex'));
assert.ok(baseline.diagnostics.statementChecks.some(c=>c.accountId==='mastercard'&&c.status==='unknown'));
const mix=[
 event('groceries','visa','expense',225),event('refund','visa','refund',25,'2026-10-23'),
 event('check-debit','checking-a','expense',80),event('check-refund','checking-a','refund',20,'2026-10-24'),
 event('wages','checking-b','income',750),event('hobby','amex','expense',44)
];
const payments=[
 plan('visa','checking-a','visa',100,'2026-10-26'),
 plan('amex-part1','checking-a','amex',70,'2026-10-27'),
 plan('amex-part2','checking-b','amex',80,'2026-11-01'),
 plan('savings','checking-b','savings',200,'2026-10-29')
];
const run=B.build(snapshot,mix,payments,{days:90});
assert.equal(run.household.expectedSpending,304,'Refunds net out of spending');
assert.equal(run.household.expectedIncome,750);
assert.equal(run.household.conservationDifference,0,'Partial settlements and savings transfer do not affect net wealth');
assert.equal(run.household.closingNet,run.household.openingNet+750-304);
assert.equal(run.diagnostics.pairedMovements.length,4);
assert.equal(run.diagnostics.statementChecks.find(c=>c.accountId==='visa').status,'covered');
assert.equal(run.diagnostics.statementChecks.find(c=>c.accountId==='amex').status,'covered');
const card=run.accounts.find(a=>a.id==='visa');
assert.equal(card.closing,1300,'Card debt increases for purchases and decreases for refunds and settlement');
assert.equal(card.openingAvailable,null,'Available credit is never deposited into household cash');
const returned=plan('return','checking-a','visa',150,'2026-10-26',
 {status:'returned',reversalDate:'2026-10-28'});
const retry=plan('retry','checking-a','visa',150,'2026-10-30');
const returnedResult=B.build(snapshot,[],[returned,retry],{days:90});
assert.equal(returnedResult.accounts.find(a=>a.id==='checking-a').closing,4850,'Return cancels original payment, retry clears');
assert.equal(returnedResult.accounts.find(a=>a.id==='visa').closing,1050,'Card refund of payment must restore debt before retry');
assert.equal(returnedResult.diagnostics.returnedPayments.length,1);
assert.equal(returnedResult.diagnostics.pairedMovements.length,3);
assert.equal(returnedResult.household.conservationDifference,0);
const returnedStandalone=B.build(snapshot,[],[returned],{days:90});
assert.equal(returnedStandalone.household.closingNet,baseline.household.closingNet);
assert.equal(returnedStandalone.accounts.find(a=>a.id==='checking-a').closing,5000);
assert.equal(returnedStandalone.accounts.find(a=>a.id==='visa').closing,1200);
const crossed=B.build(snapshot,[],[plan('prior','checking-a','visa',175,'2026-10-15',
 {status:'returned',reversalDate:'2026-10-19'})],{days:90});
assert.equal(crossed.accounts.find(a=>a.id==='checking-a').closing,5175,'Only a future reversal is booked after opening snapshot');
assert.equal(crossed.accounts.find(a=>a.id==='visa').closing,1375);
assert.equal(crossed.household.conservationDifference,0);
assert.ok(crossed.diagnostics.returnedPayments[0].originalIncludedInSnapshot);
const cancelled=B.build(snapshot,[],[plan('cancel','checking-a','visa',400,'2026-10-27',{status:'cancelled'})],{days:90});
assert.equal(cancelled.diagnostics.pairedMovements.length,0);
assert.equal(cancelled.household.closingNet,baseline.household.closingNet);
const duplicate=B.build(snapshot,[event('same','visa','expense',50),event('same','visa','expense',50)],[],{days:90});
assert.equal(duplicate.household.expectedSpending,50,'Repeated event ID can only be applied once');
assert.equal(duplicate.diagnostics.duplicateEvents.length,1);
assert.equal(duplicate.household.complete,false,'Duplicated provider items must be surfaced');
const overlapping=B.build(snapshot,[],[plan('dup-a','checking-a','visa',120),
 plan('dup-b','checking-a','visa',120)],{days:90});
assert.equal(overlapping.diagnostics.pairedMovements.length,1,'Overlapping same-dollar same-day plans cannot double pay');
assert.equal(overlapping.diagnostics.ambiguousMovements.length,1);
assert.equal(overlapping.household.complete,false);
const normalTwo=B.build(snapshot,[],[plan('two-a','checking-a','visa',120,'2026-10-25'),
 plan('two-b','checking-a','visa',120,'2026-11-02')],{days:90});
assert.equal(normalTwo.diagnostics.pairedMovements.length,2,'Distinct dates remain separate legitimate payments');
const stale=JSON.parse(JSON.stringify(snapshot));stale.accounts[0].balanceAsOf='2026-10-10';
const staleResult=B.build(stale,[],[],{days:90});
assert.equal(staleResult.diagnostics.staleSnapshots.length,1);
assert.equal(staleResult.household.complete,false);
assert.equal(staleResult.household.readyForLive,false);
const missing=JSON.parse(JSON.stringify(snapshot));delete missing.accounts[1].balanceAsOf;
assert.equal(B.build(missing,[],[],{days:90}).diagnostics.missingTimestamps.length,1);
const disconnected=JSON.parse(JSON.stringify(snapshot));disconnected.accounts[0].disconnected=true;
const dc=B.build(disconnected,[],[],{days:90});
assert.equal(dc.accounts.find(a=>a.id==='checking-a').valid,false);
assert.equal(dc.household.complete,false);
assert.ok(dc.diagnostics.staleSnapshots.some(a=>a.status==='disconnected'));
assert.equal(JSON.stringify(snapshot),original,'No synthetic state may mutate source bank snapshots');
const state=M.migrate({transactions:[]});
const t=(transaction_id,account_id,amount,date='2026-10-10')=>({transaction_id,account_id,amount,date,name:'Payment'});
const pages=[
 {added:[{...t('hold','checking-a',45),pending:true}],modified:[],removed:[],hasMore:true,nextCursor:'A1'},
 {added:[{...t('settled','checking-a',45,'2026-10-12'),pending_transaction_id:'hold'}],
  modified:[],removed:[{transaction_id:'hold'}],hasMore:false,nextCursor:'A2'}
];
M.applyPlaidSyncPages(state,{itemId:'bank-A',accounts:[{account_id:'checking-a',type:'depository',subtype:'checking',name:'Checking A'}],pages});
assert.equal(state.transactions.length,1,'Pending-to-posted transition across two pages is one row');
assert.equal(state.transactions[0].id,'plaid:bank-A:settled');
assert.equal(state.sync.itemCursors['bank-A'],'A2');
M.applyPlaidSyncPages(state,{itemId:'bank-B',accounts:[{account_id:'visa',type:'credit',subtype:'credit card',name:'Visa'}],
 pages:[{added:[t('settled','visa',72)],modified:[],removed:[],hasMore:false,nextCursor:'B1'}]});
assert.equal(state.transactions.length,2,'Same provider transaction ID on separate Items remains unique');
assert.equal(state.sync.itemCursors['bank-A'],'A2');
assert.equal(state.sync.itemCursors['bank-B'],'B1');
const safe=JSON.stringify(state);
assert.throws(()=>M.applyPlaidSyncPages(state,{itemId:'bank-A',
 pages:[{...pages[0]},{...pages[1],hasMore:true}]}),/incomplete/);
assert.equal(JSON.stringify(state),safe,'Incomplete paginated sync leaves source and cursors unchanged');
assert.throws(()=>M.applyPlaidSyncPages(state,{itemId:'bank-A',
 pages:[{...pages[0]},{...pages[1],added:[{...t('bad','checking-a',9),amount:null}]}]}),/Invalid provider transaction/);
assert.equal(JSON.stringify(state),safe,'Malformed second page rolls back entire Plaid update');
assert.throws(()=>M.applyPlaidSync(state,{itemId:'bank-A',...pages[0]}),/applyPlaidSyncPages/);
assert.equal(JSON.stringify(state),safe,'Partial Item page must not advance cursor');
assert.throws(()=>M.applyPlaidSyncPages(state,{itemId:'bank-B',
 accounts:[{account_id:'checking-a',type:'depository',name:'Conflict'}],
 pages:[{added:[t('same','checking-a',8)],modified:[],removed:[],hasMore:false,nextCursor:'B2'}]}),/Duplicate account ID/);
assert.equal(JSON.stringify(state),safe,'Cross-institution account ID conflict rejected atomically');
const planState=M.migrate({});
assert.throws(()=>M.saveAccountMovement(planState,plan('monthly-return','checking-a','visa',50,'2026-11-12',
 {status:'returned',reversalDate:'2026-11-15',frequency:'monthly'})),/returned payment/);
const rid=M.saveAccountMovement(planState,returned);
assert.equal(M.migrate(planState).predictions.accountMovements[0].reversalDate,'2026-10-28');
assert.equal(planState.transactions.length,0);
M.removeAccountMovement(planState,rid);assert.equal(planState.predictions.accountMovements.length,0);
// Fixed-seed generated transfers must conserve household position regardless of
// source/destination pair, frequency, and account balance ordering.
let seed=27401;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
for(let i=0;i<80;i++){
 const pool=snapshot.accounts.map(a=>a.id),from=pool[Math.floor(rand()*pool.length)];
 let to=pool[Math.floor(rand()*pool.length)];if(to===from)to=pool[(pool.indexOf(from)+1)%pool.length];
 const amt=Math.round((1+rand()*600)*100)/100;
 const day=String(20+Math.floor(rand()*7)).padStart(2,'0');
 const m=B.build(snapshot,[],[plan('random-'+i,from,to,amt,'2026-10-'+day)],{days:90});
 assert.equal(m.household.conservationDifference,0,'Randomized paired transfer must be net zero');
 assert.equal(m.household.closingNet,m.household.openingNet,'Any internal funds movement preserves household net position');
}
async function browserCase(browser,opts,mobile){
 const page=await browser.newPage(opts),errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.addInitScript(()=>{const Base=Date;class Fixed extends Base{
  constructor(...v){if(v.length)super(...v);else super('2026-10-17T12:00:00Z')}
  static now(){return new Base('2026-10-17T12:00:00Z').getTime()}}window.Date=Fixed;});
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const snapBefore=await page.evaluate(()=>window.HouseholdBankFeed.getSnapshot('2026-10-17'));
  const txBefore=await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.getItem('household-ledger-v1')).transactions));
  const card=page.locator('#cashflow');
  await card.locator('.account-plan-detail > summary').click();
  const form=card.locator('#account-movement-form');
  await form.locator('[name=status]').selectOption('returned');
  assert.equal(await form.locator('[name=frequency]').inputValue(),'once');
  assert.equal(await form.locator('[name=reversalDate]').isVisible(),true);
  await form.locator('[name=fromAccountId]').selectOption('demo-checking');
  await form.locator('[name=toAccountId]').selectOption('demo-visa');
  await form.locator('[name=anchorDate]').fill('2026-10-25');
  await form.locator('[name=reversalDate]').fill('2026-10-28');
  await form.locator('[name=amount]').fill('150');
  await form.locator('button[type=submit]').click();
  await page.locator('.account-plan-detail > summary').click();
  assert.match(await page.locator('.account-movement-row').innerText(),/Returned 2026-10-28/);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')).predictions.accountMovements);
  assert.equal(saved[0].status,'returned');assert.equal(saved[0].reversalDate,'2026-10-28');
  const after=await page.evaluate(()=>window.HouseholdBankFeed.getSnapshot('2026-10-17'));
  assert.deepEqual(after,snapBefore,'Manual reversal can never alter provider balance');
  assert.equal(await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.getItem('household-ledger-v1')).transactions)),txBefore);
  await page.reload({waitUntil:'load'});
  await page.locator('.account-plan-detail > summary').click();
  assert.match(await page.locator('.account-movement-row').innerText(),/Returned 2026-10-28/);
  await page.locator('.account-reliability > summary').click();
  assert.match(await page.locator('.account-reliability-lines').innerText(),/Returned payment/);
  if(mobile)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Reliability UI fits iPhone');
  assert.deepEqual(errs,[]);
 }finally{await page.close()}
}
(async()=>{
 const chrome=await chromium.launch({headless:true});
 try{await browserCase(chrome,{viewport:{width:1280,height:850}},false)}finally{await chrome.close()}
 const safari=await webkit.launch({headless:true});
 try{await browserCase(safari,{...devices['iPhone 13']},true)}finally{await safari.close()}
 console.log('PASS: Phase C 6 accounts/3 cards, returns/retries, statements, stale/missing/disconnected balances, ambiguous transfers, 80 conservation scenarios, atomic multi-Item Plaid sync, Chromium and iPhone Safari');
})().catch(e=>{console.error(e);process.exit(1)});
