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
  await page.locator('#real-account-status a[href="/bank-connect"]').waitFor();
  await page.locator('aside [data-page=overview]').click();
  await page.locator('#real-account-status').waitFor();
  await page.locator('aside [data-page=transactions]').click();
  await page.locator('#real-account-status').waitFor();
  await page.goto('http://127.0.0.1:'+port+'/bank-connect',{waitUntil:'load'});
  await page.locator('#connect').waitFor();
  assert.match(await page.locator('#status').innerText(),/No account connected/);
  assert.deepEqual(errors,[],'No runtime JavaScript errors in live Ledger or connection screen');
  console.log('PASS private existing Ledger navigation, bank UI, connection screen, no browser exceptions');
 }finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
