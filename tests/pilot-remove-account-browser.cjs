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
  chrome=await chromium.launch({headless:true});iphone=await webkit.launch({headless:true});
  for(const [browser,mobile] of [[iphone,true],[chrome,false]]){
   const ctx=await browser.newContext({
    viewport:mobile?{width:390,height:844}:{width:1200,height:900},
    httpCredentials:{username:'pilot',password:pass}});
   await ctx.route('https://cdn.plaid.com/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:'window.Plaid={create(){return {open(){}}}};'}));
   const page=await ctx.newPage();
   page.on('dialog',d=>d.accept());
   await page.goto('http://127.0.0.1:'+port+'/bank-connect',{waitUntil:'domcontentloaded'});
   await page.locator('[data-remove-account="acct-2"]').waitFor();
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
    await page.locator('[data-remove-account="acct-2"]').click();
    await page.getByText('1 account(s) remain connected').waitFor();
    assert.equal(await page.locator('[data-remove-account]').count(),1,
     'Click removes only selected card, leaving checking visible');
    assert.equal((await api('/api/status')).data.accounts[0].id,'acct-1');
   }
   await ctx.close();
  }
  console.log('PASS desktop Chromium and iPhone WebKit per-account Remove button; scoped account survives safely');
 }finally{
  if(chrome)await chrome.close();if(iphone)await iphone.close();
  child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
