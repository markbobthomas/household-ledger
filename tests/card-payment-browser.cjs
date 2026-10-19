'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-card-browser-')),port=19866,pass=crypto.randomBytes(24).toString('hex');
 const child=spawn(process.execPath,['sandbox/server.cjs'],{cwd:path.resolve(__dirname,'..'),env:{
  ...process.env,HOSTED_SANDBOX:'1',LIVE_PLAID_ENABLED:'1',PORT:String(port),PILOT_PASSWORD:pass,
  PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'mock',PLAID_SECRET:'mock',
  PLAID_ENV:'sandbox',PILOT_STATE_PATH:path.join(dir,'ledger.enc'),SANDBOX_TEST_PASSWORD:pass
 },stdio:'ignore'});
 let browser;
 const add=(n)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 try{
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:'+port+'/healthz')).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
  browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({httpCredentials:{username:'pilot',password:pass}});
  const page=await ctx.newPage(),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  const observedAt=new Date().toISOString(),accounts=[
   {id:'checking-1',name:'Test Checking',type:'depository',subtype:'checking',current:5000,available:4800,balanceObservedAt:observedAt},
   {id:'card-1',name:'Test Visa',type:'credit',subtype:'credit card',current:1000,available:null,balanceObservedAt:observedAt}
  ];
  await page.route('**/api/ledger',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   connected:true,lastSync:observedAt,accounts,account:accounts[0],adjustments:{},
   transactions:[
    {id:'card-purchase',accountId:'card-1',date:add(-1),merchant:'Grocery card purchase',amount:300,pending:false,category:{primary:'FOOD_AND_DRINK'}},
    {id:'card-payment',accountId:'card-1',date:add(-2),merchant:'Payment Thank You',amount:-100,pending:false,category:{primary:'TRANSFER_IN'}}
   ]
  })}));
  await page.route('**/api/ledger/adjustments',route=>{
   writes.push(route.request().postDataJSON());
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({saved:true})});
  });
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'load'});
  await page.locator('aside [data-page=settings]').click();
  await page.locator('#ledger-mode-switch').selectOption('real');
  await page.locator('#demo-banner').getByText('REAL BANK · PLAID').waitFor();
  await page.locator('aside [data-page=overview]').click();
  assert.match(await page.locator('.overview-balance-value').innerText(),/\$5,000\.00/,'Card debt not subtracted from main checking current balance');
  assert.match(await page.locator('.overview-available').innerText(),/\$4,800\.00/,'Available checking stays distinct');
  assert.equal(await page.locator('.account-projection-row').count(),2,'Both bank accounts have independent forecasts');
  assert.equal(await page.locator('[data-card-payment]').count(),1,'Linked card exposes statement/autopay configuration');
  await page.locator('.payment-setup > summary').click();
  const form=page.locator('[data-card-payment="card-1"]');
  await form.locator('[name=lastStatementClose]').fill(add(-4));
  await form.locator('[name=closingDay]').fill('18');
  await form.locator('[name=nextPaymentDate]').fill(add(10));
  await form.locator('[name=nextDueDate]').fill(add(11));
  await form.locator('[name=lastStatementBalance]').fill('1200');
  await form.locator('button[type=submit]').click();
  await page.locator('.coverage-row').filter({hasText:'Test Visa'}).first().waitFor();
  assert.match(await page.locator('.coverage-row').filter({hasText:'Test Visa'}).first().innerText(),/\$1,200\.00/,'Scheduled card payment debits checking');
  assert.match(await page.locator('.account-projection-row').filter({hasText:'Test Visa'}).innerText(),/Credit card/,'Card liability tracked separately');
  assert.match(await page.locator('.statement-breakdown').first().innerText(),/Credit card statements/,'Statement cycle breakdown visible');
  assert.equal(await page.locator('.overview-balance-value').innerText(),'$5,000.00','Scheduling cannot mutate the bank balance snapshot');
  const bill=page.locator('[data-payment-bill]');
  await bill.locator('[name=name]').fill('Mortgage');
  await bill.locator('[name=amount]').fill('2000');
  await bill.locator('[name=date]').fill(add(5));
  await bill.locator('[name=frequency]').selectOption('once');
  await bill.locator('button[type=submit]').click();
  await page.locator('.coverage-row').filter({hasText:'Mortgage'}).waitFor();
  assert.match(await page.locator('.coverage-row').filter({hasText:'Mortgage'}).innerText(),/\$2,000\.00/,'Mortgage is a dated checking withdrawal');
  await page.locator('.payment-setup [data-cash-cushion] [name=amount]').fill('2000');
  await page.locator('.payment-setup [data-cash-cushion] button[type=submit]').click();
  assert.match(await page.locator('.coverage-row').filter({hasText:'Test Visa'}).first().innerText(),/BELOW CUSHION/,'Checks cash after both obligations');
  for(let i=0;i<60&&!writes.some(x=>x.predictions?.paymentRules?.['card-1']&&x.predictions?.paymentBills?.length&&x.predictions?.cashCushion===2000);i++)
   await new Promise(r=>setTimeout(r,50));
  assert.ok(writes.some(x=>x.predictions?.paymentRules?.['card-1']?.fromAccountId==='checking-1'),'Card funding source persisted');
  assert.ok(writes.some(x=>x.predictions?.paymentBills?.some(b=>b.name==='Mortgage')),'Mortgage forecast persisted');
  assert.ok(writes.some(x=>x.predictions?.cashCushion===2000),'Minimum cushion persisted');
  assert.deepEqual(errors,[],'No page script exceptions');
  console.log('PASS multi-account Real Overview: card spending does not drain checking; statement source, mortgage and low-cash cushion persisted; no source balances changed');
 }finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
