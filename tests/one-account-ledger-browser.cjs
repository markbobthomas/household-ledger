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
  await page.locator('#demo-banner').getByText('DEMO').waitFor();
  assert.equal(await page.locator('#ledger-mode-switch').inputValue(),'demo','Cannot enter Real without a connected account');
  await page.locator('#add-custom-category [name=name]').fill('Pet supplies');
  await page.locator('#add-custom-category button[type=submit]').click();
  assert.ok((await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')))).customCategories.includes('Pet supplies'),'Demo category creation uses original Ledger state');
  const bankTest=await ctx.newPage(),postedDate=new Date().toISOString().slice(0,10);
  await bankTest.route('**/api/ledger',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   connected:true,lastSync:'2026-10-19T12:00:00Z',
   account:{id:'acct-1',name:'Test Checking',type:'depository',subtype:'checking',current:1000,available:950,balanceObservedAt:'2026-10-19T12:00:00Z'},
   adjustments:{},transactions:[
    {id:'posted',date:postedDate,merchant:'Cafe',amount:25,pending:false,category:{primary:'FOOD_AND_DRINK',detailed:'FOOD_AND_DRINK_RESTAURANT',confidence_level:'HIGH'}},
    {id:'pending',date:postedDate,merchant:'Pending cafe',amount:60,pending:true,category:{primary:'FOOD_AND_DRINK'}},
    {id:'transfer',date:postedDate,merchant:'Savings transfer',amount:400,pending:false,category:{primary:'TRANSFER_OUT'}},
    {id:'unknown',date:postedDate,merchant:'Mystery',amount:19,pending:false,category:null}]
  })}));
  let adjustments=[];
  await bankTest.route('**/api/ledger/adjustments',async route=>{adjustments.push(route.request().postDataJSON());await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({saved:true})})});
  const errorsReal=[];bankTest.on('pageerror',e=>errorsReal.push(e.message));
  await bankTest.goto('http://127.0.0.1:'+port+'/',{waitUntil:'load'});
  await bankTest.locator('aside [data-page=settings]').click();
  await bankTest.locator('#ledger-mode-switch').selectOption('real');
  await bankTest.locator('#demo-banner').getByText('REAL BANK · PLAID').waitFor();
  await bankTest.locator('aside [data-page=budgets]').click();
  assert.equal(await bankTest.locator('.budget-entry[data-budget-category="Groceries"]').count(),1,'Original category budget rows retained');
  assert.equal(await bankTest.locator('section[aria-label="Overall monthly budget"]').count(),1,'Same overall budget renderer');
  await bankTest.locator('aside [data-page=transactions]').click();
  const editor=bankTest.locator('select[data-category="posted"]').first();
  await editor.waitFor();
  await editor.selectOption('Groceries');
  for(let i=0;i<60&&!adjustments.some(a=>a.categoryOverrides?.posted==='Groceries');i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(adjustments.some(a=>a.categoryOverrides?.posted==='Groceries'),'Category edit saved via encrypted server preferences');
  await bankTest.locator('aside [data-page=settings]').click();
  await bankTest.locator('#add-custom-category [name=name]').fill('Hobbies');
  await bankTest.locator('#add-custom-category button[type=submit]').click();
  for(let i=0;i<60&&!adjustments.some(a=>a.customCategories?.includes('Hobbies'));i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(adjustments.some(a=>a.customCategories?.includes('Hobbies')),'Real category creation is persisted separately');
  const stored=await bankTest.evaluate(()=>localStorage.getItem('household-ledger-v1'));
  assert.equal(stored.includes('posted'),false,'Real bank source transactions never written to localStorage');
  await bankTest.locator('aside [data-page=insights]').click();
  assert.equal(await bankTest.locator('[data-insight=merchants]').count(),1,'Original insights controls retained');
  assert.equal(await bankTest.locator('[data-insight=recurring]').count(),1,'Original recurring analysis retained');
  await bankTest.locator('aside [data-page=reviews]').click();
  assert.equal(await bankTest.locator('.review-filters').count(),1,'Original Reviews controls retained');
  await bankTest.locator('aside [data-page=overview]').click();
  assert.equal(await bankTest.locator('#cashflow').count(),1,'Original 90-day forecast retained');
  assert.equal(await bankTest.locator('#real-mode-surface').count(),0,'Second interface eliminated');
  assert.deepEqual(errorsReal,[],'No JS errors after data-source switching');
  await bankTest.close();
  await page.goto('http://127.0.0.1:'+port+'/bank-connect',{waitUntil:'load'});
  await page.locator('#connect').waitFor();
  await page.locator('#status').getByText('No account connected').waitFor();
  assert.deepEqual(errors,[],'No runtime JavaScript errors in live Ledger or connection screen');
  console.log('PASS private existing Ledger navigation, bank UI, connection screen, no browser exceptions');
 }finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
