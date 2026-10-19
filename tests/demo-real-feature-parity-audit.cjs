'use strict';
/* UI parity audit. Uses fictional mock Plaid status; no real bank access. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const checks=[
 {tab:'budgets',name:'Overall budget progress',selector:'.budget-progress'},
 {tab:'budgets',name:'Category drill-downs',selector:'.budget-entry .drill-detail'},
 {tab:'budgets',name:'Editable category budget',selector:'[data-inline-budget]'},
 {tab:'budgets',name:'Expected-transaction detail',selector:'.expected-tx'},
 {tab:'overview',name:'90-day cashflow panel',selector:'#cashflow'},
 {tab:'overview',name:'Account projections',selector:'.account-projection-list'},
 {tab:'transactions',name:'Transaction category editor',selector:'[data-category]'},
 {tab:'transactions',name:'Transaction table',selector:'table'},
 {tab:'insights',name:'Merchant analysis',selector:'[data-insight=merchants]'},
 {tab:'insights',name:'Category analysis',selector:'[data-insight=categories]'},
 {tab:'insights',name:'Item price bands',selector:'[data-insight=bands]'},
 {tab:'insights',name:'Recurring analysis',selector:'[data-insight=recurring]'},
 {tab:'insights',name:'Prediction accuracy',selector:'[data-insight=accuracy]'},
 {tab:'reviews',name:'Review filters',selector:'.review-filters'},
 {tab:'reviews',name:'Actionable review tasks',selector:'.review-task'},
 {tab:'reviews',name:'Manual category review form',selector:'[data-review-category]'},
 {tab:'settings',name:'Default-tab setting',selector:'#default-page'},
 {tab:'settings',name:'Backup/export',selector:'#backup'}
];
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-parity-')),port=19857,pass=crypto.randomBytes(25).toString('hex');
 const child=spawn(process.execPath,['sandbox/server.cjs'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),LIVE_PLAID_ENABLED:'1',HOSTED_SANDBOX:'1',PILOT_PASSWORD:pass,PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'test',PLAID_SECRET:'test',PLAID_ENV:'sandbox',PILOT_STATE_PATH:path.join(dir,'state.enc'),SANDBOX_TEST_PASSWORD:pass},stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<120;i++){try{if((await fetch('http://127.0.0.1:'+port+'/healthz')).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({httpCredentials:{username:'pilot',password:pass}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const date=new Date().toISOString().slice(0,10);
  await page.route('**/api/status',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,lastSync:new Date().toISOString(),account:{name:'Mock Checking',current:1034.52,available:1034.52,balanceObservedAt:new Date().toISOString()},transactions:[{id:'a',date,name:'Coffee Shop',merchant:'Coffee Shop',amount:25,pending:false,category:{primary:'FOOD_AND_DRINK',detailed:'FOOD_AND_DRINK_COFFEE',confidence_level:'HIGH'}},{id:'b',date,name:'Uncertain Merchant',merchant:'Uncertain Merchant',amount:36,pending:false,category:null},{id:'c',date,name:'Pending',merchant:'Pending',amount:18,pending:true,category:{primary:'FOOD_AND_DRINK',detailed:'FOOD_AND_DRINK_COFFEE',confidence_level:'HIGH'}}]})}));
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'load'});
  async function snapshot(){
   const out={};
   for(const c of checks){
    await page.locator('aside [data-page='+c.tab+']').click();
    const element=page.locator(c.selector);
    out[c.name]=await element.count()>0&&(await element.first().isVisible());
   }
   return out;
  }
  await page.locator('aside [data-page=settings]').click();
  await page.locator('#ledger-mode-switch').waitFor();
  const demo=await snapshot();
  await page.locator('aside [data-page=settings]').click();
  await page.locator('#ledger-mode-switch').selectOption('real');
  const real=await snapshot();
  const viewLeaks={};
  for(const tab of [...new Set(checks.map(x=>x.tab))]){
   await page.locator('aside [data-page='+tab+']').click();
   viewLeaks[tab]=await page.evaluate(()=>{
    const v=document.querySelector('#view'),children=[...v.children].filter(e=>e.id!=='real-mode-surface');
    return {originals:children.length,markedHidden:children.filter(e=>e.hidden).length,visibleDespiteHidden:children.filter(e=>e.hidden&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0).length,realSurface:!!document.querySelector('#real-mode-surface')};
   });
  }
  console.log('VISUAL_MODE_ISOLATION_AUDIT '+JSON.stringify(viewLeaks));
  const total=checks.length,baseline=Object.values(demo).filter(Boolean).length,retained=checks.filter(c=>demo[c.name]&&real[c.name]).length;
  console.log('UI_PARITY_AUDIT_BEGIN');
  console.log(JSON.stringify({total,baseline,retained,matrix:checks.map(c=>({area:c.tab,capability:c.name,demo:demo[c.name],real:real[c.name]})),consoleErrors:errors},null,2));
  console.log('UI_PARITY_AUDIT_END');
  assert.ok(baseline>=12,'Demo baseline features not available in test');
  assert.deepEqual(errors,[],'Browser threw errors during audit');
 }finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exit(1)});
