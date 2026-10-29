'use strict';
// Regression: an interrupted standalone classifier request must not break the
// private iPhone Calendar or mislead users into reconnecting their banks.
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium,webkit}=require('playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-private-category-'));
const port=19849,pass='test-'+crypto.randomBytes(24).toString('hex');
const env={...process.env,PORT:String(port),PILOT_PASSWORD:pass,
 PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),
 PLAID_CLIENT_ID:'fictional-browser-test',PLAID_SECRET:'fictional-browser-test',
 PLAID_ENV:'sandbox',PILOT_STATE_PATH:path.join(dir,'private.enc')};
const server=spawn(process.execPath,['pilot/server.cjs'],
 {cwd:path.resolve(__dirname,'..'),env,stdio:'ignore'});
const address='http://127.0.0.1:'+port+'/';
let desktop,iphone;
(async()=>{
 for(let i=0;i<100;i++){
  try{if((await fetch(address+'healthz')).ok)break}catch{}
  await new Promise(resolve=>setTimeout(resolve,80));
 }
 assert.equal((await fetch(address+'healthz')).status,200,'Private fixture server started');
 desktop=await chromium.launch({headless:true});
 iphone=await webkit.launch({headless:true});
 for(const [browser,name] of [[desktop,'Chromium'],[iphone,'iPhone WebKit']]){
  const context=await browser.newContext({
   viewport:name==='Chromium'?{width:1280,height:900}:{width:390,height:844},
   httpCredentials:{username:'pilot',password:pass}
  });
  const page=await context.newPage(),errors=[];
  let classifierRequests=0;
  page.on('pageerror',error=>errors.push(error.message));
  // Any request for the old standalone file would fail on an interrupted
  // network; the private page must not rely on that second fetch.
  await page.route('**/categorization.js',route=>{
   classifierRequests++;
   return route.abort();
  });
  await page.goto(address,{waitUntil:'load'});
  await page.locator('#planner-main .planner-page').first().waitFor();
  const outcome=await page.evaluate(()=>{
   const model=window.HouseholdLedgerData;
   const fixture=model.migrate({transactions:[{
    id:'fictional-plaid-grocery',date:'2026-10-14',merchant:'Fictional Grocery',
    type:'expense',category:'Other',amount:42,accountId:'fictional-checking',
    source:{provider:'plaid',plaidAmount:42,verified:true}
   }],predictions:{}});
   const records=model.records(fixture);
   return {classifier:typeof window.HouseholdCategorization?.classify,
    category:records.find(r=>r.id==='fictional-plaid-grocery')?.category,
    text:document.querySelector('#planner-main')?.textContent||''};
  });
  assert.equal(classifierRequests,0,name+': the private HTML embeds the classifier without another network request');
  assert.ok(await page.evaluate(()=>Boolean(window.HouseholdAccounting?.recognizedIncome)),
   name+': accounting helper initialized before the private bank adapter');
  assert.equal(outcome.classifier,'function',name+': browser has the required classifier');
  assert.ok(outcome.category&&outcome.category!=='Uncategorized',
   name+': Plaid expense can be classified without a null dereference');
  assert.ok(!/Calendar needs attention|categorization component failed to load/i.test(outcome.text),
   name+': no misleading missing-bank Calendar error');
  assert.deepEqual(errors,[],name+': no uncaught errors while loading private Calendar');
  await context.close();
 }
 console.log('PASS private inline classifier, blocked standalone fetch, and safe Plaid record processing in desktop Chromium and iPhone WebKit');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
 await desktop?.close();await iphone?.close();server.kill();
 fs.rmSync(dir,{recursive:true,force:true});
});