'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-live-browser-')),port=19848,pass=crypto.randomBytes(24).toString('hex');
 const child=spawn(process.execPath,['sandbox/server.cjs'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,HOSTED_SANDBOX:'1',LIVE_PLAID_ENABLED:'1',PORT:String(port),PILOT_PASSWORD:pass,PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'placeholder',PLAID_SECRET:'placeholder',PLAID_ENV:'sandbox',PILOT_STATE_PATH:path.join(dir,'pilot.enc'),SANDBOX_TEST_PASSWORD:pass},stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:'+port+'/healthz');if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
  browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({httpCredentials:{username:'pilot',password:pass}});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'load'});
  assert.equal(await page.locator('aside [data-page=settings]').count(),1);
  await page.locator('aside [data-page=settings]').click();
  await page.locator('#ledger-mode-switch').waitFor();
  assert.equal(await page.locator('#ledger-mode-switch').inputValue(),'demo');
  await page.locator('#ledger-mode-switch').selectOption('real');
  assert.equal(await page.locator('#ledger-mode-switch').inputValue(),'demo','Cannot switch to real without verified connected account');
  await page.locator('aside [data-page=overview]').click();
  assert.equal(await page.locator('#real-mode-surface').count(),0,'Demo overview remains visible');
  await page.locator('aside [data-page=transactions]').click();
  assert.equal(await page.locator('#real-mode-surface').count(),0,'Demo transactions remain visible');
  const bankTest=await ctx.newPage();
  await bankTest.route('**/api/status',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   connected:true,lastSync:'2026-10-19T12:00:00Z',account:{name:'Test account',current:1000,available:950,balanceObservedAt:'2026-10-19T12:00:00Z'},
   transactions:[{id:'posted',date:new Date().toISOString().slice(0,10),merchant:'Cafe',amount:25,pending:false,category:{primary:'FOOD_AND_DRINK',detailed:'FOOD_AND_DRINK_RESTAURANT',confidence_level:'HIGH'}},
    {id:'pending',date:new Date().toISOString().slice(0,10),merchant:'Pending cafe',amount:60,pending:true,category:{primary:'FOOD_AND_DRINK'}},
    {id:'transfer',date:new Date().toISOString().slice(0,10),merchant:'Savings transfer',amount:400,pending:false,category:{primary:'TRANSFER_OUT'}}]
  })}));
  await bankTest.goto('http://127.0.0.1:'+port+'/',{waitUntil:'load'});
  await bankTest.locator('aside [data-page=settings]').click();
  await bankTest.locator('#ledger-mode-switch').selectOption('real');
  await bankTest.locator('aside [data-page=budgets]').click();
  const budget=bankTest.locator('section[aria-label="Real overall budget"]');
  await budget.waitFor();
  assert.ok((await budget.innerText()).includes('$25.00'),'Only posted cafe charge counts in real budget');
  assert.ok(!(await budget.innerText()).includes('$400.00'),'Transfers excluded');
  assert.equal(await bankTest.locator('#demo-banner').innerText(),'REAL BANK · PLAID','Real mode must never show DEMO badge');
  assert.equal(await bankTest.locator('[data-real-budget="Needs review"]').count(),0,'Uncategorized is never a budget category');
  assert.equal(await bankTest.locator('[data-real-budget="Debt payments"]').count(),0,'Loan payments are not spending budget categories');
  assert.equal(await bankTest.locator('#period').isVisible(),false,'Demo month control hidden in real mode');
  await bankTest.locator('aside [data-page=insights]').click();
  assert.match(await bankTest.locator('#real-mode-surface').innerText(),/Real spending insights/i);
  await bankTest.locator('aside [data-page=reviews]').click();
  assert.match(await bankTest.locator('#real-mode-surface').innerText(),/pending transaction/);
  assert.equal((await bankTest.locator('#real-mode-surface').innerText()).includes('Demo totals'),false);
  await bankTest.close();
  await page.goto('http://127.0.0.1:'+port+'/bank-connect',{waitUntil:'load'});
  await page.locator('#connect').waitFor();
  await page.locator('#status').getByText('No account connected').waitFor();
  assert.deepEqual(errors,[],'No runtime JavaScript errors in live Ledger or connection screen');
  console.log('PASS private existing Ledger navigation, bank UI, connection screen, no browser exceptions');
 }finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
