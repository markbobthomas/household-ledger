'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-mortgage-')),port=19867,pass=crypto.randomBytes(24).toString('hex');
 const child=spawn(process.execPath,['sandbox/server.cjs'],{cwd:path.resolve(__dirname,'..'),env:{
  ...process.env,HOSTED_SANDBOX:'1',LIVE_PLAID_ENABLED:'1',PORT:String(port),PILOT_PASSWORD:pass,
  PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'mock',PLAID_SECRET:'mock',
  PLAID_ENV:'sandbox',PILOT_STATE_PATH:path.join(dir,'ledger.enc'),SANDBOX_TEST_PASSWORD:pass
 },stdio:'ignore'});
 let browser;
 const observedAt='2026-10-19T09:00:00Z';
 const mortgagePfc={primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_MORTGAGE_PAYMENT',confidence_level:'HIGH'};
 const months=['2026-06-02','2026-07-03','2026-08-02','2026-09-02','2026-10-02'];
 const transactions=months.map((date,i)=>({id:'mort-'+i,accountId:'checking-1',date,
  merchant:'Home Mortgage ACH',name:'Home Mortgage ACH',amount:2590,pending:false,category:mortgagePfc}));
 const account={id:'checking-1',name:'Checking',mask:'2345',type:'depository',subtype:'checking',
  current:12000,available:11500,balanceObservedAt:observedAt};
 const payload={connected:true,lastSync:observedAt,accounts:[account],account,transactions,adjustments:{}};
 try{
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:'+port+'/healthz')).ok)break}catch{}
   await new Promise(r=>setTimeout(r,50))}
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({httpCredentials:{username:'pilot',password:pass}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const Base=Date;class FixedDate extends Base{
   constructor(...args){if(args.length)super(...args);else super('2026-10-19T12:00:00Z')}
   static now(){return new Base('2026-10-19T12:00:00Z').getTime()}
  }window.Date=FixedDate;});
  await page.route('**/api/ledger',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}));
  await page.route('**/api/ledger/adjustments',route=>route.fulfill({status:200,contentType:'application/json',body:'{"saved":true}'}));
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'load'});
  await page.locator('aside [data-page=settings]').click();
  await page.locator('#ledger-mode-switch').selectOption('real');
  await page.locator('#demo-banner').getByText('REAL BANK · PLAID').waitFor();
  await page.locator('aside [data-page=transactions]').click();
  const posted=page.locator('select[data-category="mort-4"]');
  assert.equal(await posted.inputValue(),'Housing','Imported LOAN_PAYMENTS mortgage is correctly categorized Housing');
  const octMortgageRow=posted.locator('xpath=ancestor::tr');
  assert.match(await octMortgageRow.innerText(),/expense/,'Existing bank mortgage is reconciled to household cash expense');
  await page.locator('aside [data-page=budgets]').click();
  assert.equal(await page.locator('[data-budget-category=Housing] .budget-summary-amount').innerText(),'$2,590.00',
   'Posted October mortgage is counted as actual, not a second prediction');
  assert.equal(await page.locator('[data-budget-category=Housing] .budget-row-projection').innerText(),
   'Projected $2,590.00','Mortgage October is not double booked');
  assert.ok((await page.locator('#period option').allTextContents()).some(t=>t==='November 2026'),
   'Upcoming November is selectable from Budget');
  await page.locator('#period').selectOption('2026-11');
  const november=page.locator('[data-budget-category=Housing]');
  assert.match(await november.locator('.budget-row-projection').innerText(),/Projected \$2,590\.00/,
   'Future November budget includes mortgage forecast');
  await november.locator(':scope > details > summary').click();
  assert.equal(await november.locator('.expected-tx').count(),1,'One expected mortgage in November');
  assert.match(await november.locator('.expected-tx').innerText(),/Home Mortgage ACH/);
  await page.locator('#period').selectOption('2026-12');
  const december=page.locator('[data-budget-category=Housing]');
  assert.match(await december.locator('.budget-row-projection').innerText(),/Projected \$2,590\.00/,
   'December is also forecast, not mislabeled as a completed month');
  await page.locator('aside [data-page=overview]').click();
  assert.match(await page.locator('.overview-balance-value').innerText(),/\$12,000\.00/,
   'Bank-reported checking remains unchanged');
  const audit=page.locator('.prediction-ledger');
  await audit.waitFor();
  assert.match(await audit.innerText(),/5 recorded mortgage payment/,'Overview explains historical mortgage evidence');
  assert.match(await audit.innerText(),/3 future mortgage withdrawal/,'Overview confirms dated mortgage forecasts');
  await audit.locator(':scope > details > summary').click();
  assert.equal(await audit.locator('.prediction-ledger-row').filter({hasText:'Home Mortgage ACH'}).count(),3,
   'Three future mortgages visible as distinct expected entries');
  assert.equal(await page.locator('.coverage-row').filter({hasText:'Home Mortgage ACH'}).count(),3,
   'Checking cash coverage includes one debit per forecast month');
  await page.locator('.payment-setup > summary').click();
  const bill=page.locator('[data-payment-bill]');
  await bill.locator('[name=name]').fill('Mortgage');
  await bill.locator('[name=amount]').fill('2590');
  await bill.locator('[name=date]').fill('2026-11-01');
  await bill.locator('[name=frequency]').selectOption('monthly');
  await bill.locator('button[type=submit]').click();
  assert.equal(await page.locator('.coverage-row').filter({hasText:'Mortgage'}).count(),3,
   'Owner-entered Mortgage with different label does not double book bank-inferred Home Mortgage ACH');
  assert.deepEqual(errors,[],'No client script errors in Real recurring mortgage views');
  console.log('PASS Real mortgage PFC import, October posted, November/December future budgets, three Overview forecasts, source-balance preservation and manual-schedule dedupe');
 }finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
