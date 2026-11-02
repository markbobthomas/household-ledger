'use strict';
// Real browser interaction with the private Bank Connections interface.
// The Plaid and bank accounts here are fictional, served by the offline stub.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{chromium,webkit}=require('playwright');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-remove-browser-')),
  port=19862,pass=crypto.randomBytes(24).toString('hex');
 const env={...process.env,PORT:String(port),PILOT_PASSWORD:pass,
  PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'fictional',
  PLAID_SECRET:'fictional',PLAID_ENV:'sandbox',PILOT_REMOVE_TEST:'1',
  PILOT_INVALID_FIELD_TEST:'1',PILOT_INVALID_FIELD_AFTER_STAGE:'1',
  PILOT_STATE_PATH:path.join(dir,'bank.enc')};
 const child=spawn(process.execPath,['--require','./tests/pilot-plaid-stub.cjs','pilot/server.cjs'],
  {cwd:path.resolve(__dirname,'..'),env,stdio:'ignore'});
 let chrome,iphone;
 const api=(route,body)=>new Promise((resolve,reject)=>{
  const json=body===undefined?null:JSON.stringify(body);
  const r=http.request({hostname:'127.0.0.1',port,path:route,method:json?'POST':'GET',
   headers:{Authorization:'Basic '+Buffer.from('pilot:'+pass).toString('base64'),
    ...(json?{'Content-Type':'application/json','X-Pilot-Action':'1'}:{})}},res=>{
    let t='';res.on('data',c=>t+=c);res.on('end',()=>{
     try{resolve({code:res.statusCode,data:JSON.parse(t)})}
     catch{reject(Error('Unexpected private response '+t.slice(0,50)))}
    });
   });r.on('error',reject);r.end(json);
 });
 const ready=async()=>{
  for(let i=0;i<100;i++){try{if((await api('/api/status')).code===200)return}catch{}
   await new Promise(r=>setTimeout(r,50))}
  throw Error('Private bank test server unavailable');
 };
 try{
  await ready();
  assert.equal((await api('/api/exchange',{publicToken:'public-test',
   accountIds:['acct-1','acct-2']})).code,200);
  assert.equal((await api('/api/ledger/forecasts',{predictions:{
   primaryAccountId:'acct-1',
   futureTransactionEdits:{'event|planned-event|acct-1':{accountId:'acct-1',amount:123}}
  }})).code,200);
  const invalidRefresh=await api('/api/sync',{});
  const beforeBrowserDiagnostics=(await api('/api/status')).data.diagnostics;
  assert.equal(beforeBrowserDiagnostics.environment,'sandbox');
  assert.equal(beforeBrowserDiagnostics.lastSyncAttempt.outcome,'failed');
  assert.equal(beforeBrowserDiagnostics.lastPlaidCall.outcome,'provider_error');
  assert.equal(invalidRefresh.data.code,'INVALID_FIELD',
   'Synthetic request-validation error is stored without unlinking banks');
  chrome=await chromium.launch({headless:true});iphone=await webkit.launch({headless:true});
  for(const [browser,mobile] of [[iphone,true],[chrome,false]]){
   const ctx=await browser.newContext({
    viewport:mobile?{width:390,height:844}:{width:1200,height:900},
    httpCredentials:{username:'pilot',password:pass}});
   await ctx.route('https://cdn.plaid.com/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:'window.Plaid={create(){return {open(){}}}};'}));
   // The private service now shows a password page rather than emitting a
   // Basic challenge. Proactively send the EXISTING test credentials only to
   // the local private server to cover legacy-client migration safely.
   // Do not send Authorization headers to Plaid CDN or other origins.
   await ctx.route('http://127.0.0.1:'+port+'/**',route=>
    route.continue({headers:{...route.request().headers(),
     authorization:'Basic '+Buffer.from('pilot:'+pass).toString('base64')}}));
   const page=await ctx.newPage();
   page.on('dialog',d=>d.accept());
   // A second device has no localStorage mode preference. Signing in to the
   // private site must automatically load the same encrypted server records;
   // a missing browser preference must not silently substitute Demo data.
   await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'load'});
   await page.waitForFunction(()=>document.querySelector('#source-type')?.textContent==='REAL BANK',
    null,{timeout:30000});
   assert.equal(await page.locator('#ledger-mode-switch').inputValue(),'real',
    'A fresh '+(mobile?'iPhone':'desktop')+' selects shared Real mode without setup');
   assert.equal(await page.evaluate(()=>localStorage.getItem('household-ledger-view-mode')),'real',
    'The Real preference is initialized on this new device');
   assert.match(await page.locator('#planner-main').innerText(),/\$300\.10/,
    'The private Home shows the fictional bank-reported available balance on the new device');
   assert.match(await page.locator('#summary-account option:checked').textContent(),/Test Checking.*Main/,
    'The server-saved main-account preference is restored on every device');
   if(!mobile){
    // Only a deliberate Demo choice should be local to this browser. It must
    // survive reload without deleting or overwriting saved household state.
    await page.locator('#planner-menu > summary').click();
    await page.locator('#ledger-mode-switch').selectOption('demo');
    await page.reload({waitUntil:'load'});
    assert.equal(await page.locator('#source-type').textContent(),'DEMO DATA',
     'Explicit Demo selection is respected on this device after reload');
    await page.locator('#planner-menu > summary').click();
    await page.locator('#ledger-mode-switch').selectOption('real');
    await page.waitForFunction(()=>document.querySelector('#source-type')?.textContent==='REAL BANK',
     null,{timeout:30000});
    assert.match(await page.locator('#summary-account option:checked').textContent(),/Test Checking.*Main/,
     'Switching back to Real restores the same private account and its saved main-account setting');
   }
   await page.goto('http://127.0.0.1:'+port+'/bank-connect',{waitUntil:'domcontentloaded'});
   await page.locator('[data-remove-account="acct-2"]').waitFor();
   await page.locator('#sync-issue').waitFor({state:'visible'});
   const diagnosticText=await page.locator('#private-diagnostics').innerText();
   assert.match(diagnosticText,/Plaid environment: Sandbox/,
    'Private bank page shows the server actual Plaid environment');
   assert.match(diagnosticText,/Latest refresh: .*failed/,
    'Private page distinguishes a failed recent refresh from an older saved warning');
   assert.match(diagnosticText,/Latest direct Plaid call during refresh:.*provider_error.*INVALID_FIELD/,
    'Private page proves a provider error came from a server-side Plaid call');
   assert.match(diagnosticText,/fictional-request-id-42/,
    'Safe Plaid request ID is tied to the last actual provider response');
   assert.match(await page.locator('#sync-issue').innerText(),/INVALID_FIELD/);
   assert.match(await page.locator('#sync-issue').innerText(),/\/transactions\/sync/);
   assert.match(await page.locator('#sync-issue').innerText(),/fictional-request-id-42/);
   assert.ok(await page.locator('#retry-sync').isVisible(),
    'Bank error has an actual retry button on '+(mobile?'iPhone':'desktop'));
   assert.ok(await page.locator('[data-reconnect-account="acct-1"]').isVisible(),
    'Existing-bank access can be renewed without deleting Plaid Items');
   assert.equal(await page.locator('[data-remove-account]').count(),2,
    'Each connected card/checking account shows its own Remove account action');
   assert.equal(await page.locator('[data-remove-account="acct-1"]').isDisabled(),true,
    'Main account with saved future edits cannot be removed even when names match');
   assert.equal(await page.locator('[data-remove-account="acct-2"]').isEnabled(),true,
    'New duplicate without forecast references can be removed');
   assert.match(await page.locator('#report').innerText(),/Has saved links/);
   assert.match(await page.locator('#report').innerText(),/No saved prediction links found/);
   assert.ok(await page.locator('[data-remove-account="acct-2"]').isVisible(),
    'Removal control accessible on desktop and mobile');
   if(!mobile){
    await page.locator('#retry-sync').click();
    await page.locator('#sync-issue').waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.querySelector('#private-diagnostics-detail')?.textContent.includes('(success)'));
    assert.equal((await api('/api/status')).data.accounts.every(a=>!a.syncIssue),true,
     'A successful retry clears only the error, not banking state');
    await page.locator('[data-remove-account="acct-2"]').click();
    await page.getByText('1 account(s) remain connected').waitFor();
    assert.equal(await page.locator('[data-remove-account]').count(),1,
     'Click removes only selected card, leaving checking visible');
    assert.equal((await api('/api/status')).data.accounts[0].id,'acct-1');
   }
   await ctx.close();
  }
  console.log('PASS desktop Chromium and iPhone WebKit per-account removal plus Plaid INVALID_FIELD recovery and retry controls');
 }finally{
  if(chrome)await chrome.close();if(iphone)await iphone.close();
  child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
