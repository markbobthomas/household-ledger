'use strict';
// Automatic sync uses existing signed-in browser sessions. No Amazon password,
// cookie, order CSV, bank data or Ledger session secret is persisted here.
const AMAZON_URL='https://www.amazon.com/your-orders';
const AMAZON_ACCESS='https://www.amazon.com/*';
const ALARM='ledger-amazon-every-six-hours';
const PERIOD_MINUTES=360;
let running=null;
const amazonPage=url=>/^https:\/\/(?:[a-z0-9-]+\.)?amazon\.com\//i.test(url||'')&&
 /\/(?:your-orders|gp\/your-account\/order-history|gp\/your-account\/order-details)/i.test(new URL(url).pathname);
function ledgerOrigin(value){
 try{
  const u=new URL(value);
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/')return null;
  return u.protocol==='https:'||
   u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)?u.origin:null;
 }catch{return null}
}
async function loaded(tabId){
 const tab=await chrome.tabs.get(tabId);
 if(tab.status==='complete')return tab;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{
   chrome.tabs.onUpdated.removeListener(listener);
   reject(Error('An order or Ledger page did not finish loading.'));
  },30000);
  function listener(id,change,t){
   if(id===tabId&&change.status==='complete'){
    clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);resolve(t);
   }
  }
  chrome.tabs.onUpdated.addListener(listener);
 });
}
async function scanTab(tabId){
 await chrome.scripting.executeScript({target:{tabId},files:['scraper.js']});
 const response=await chrome.scripting.executeScript({target:{tabId},
  func:()=>globalThis.LedgerAmazonScraper.scan()});
 const scanned=response?.[0]?.result;
 if(!scanned||typeof scanned.csv!=='string'||!scanned.items||
    scanned.csv.length>6*1024*1024)
  throw Error('No usable Amazon orders found. Check Amazon sign-in or use the ZIP importer.');
 return scanned;
}
async function manualPreview(tabId,origin){
 const tab=await chrome.tabs.get(tabId);
 if(!amazonPage(tab.url))throw Error('Open Amazon Your Orders before syncing.');
 const scan=await scanTab(tabId);
 const dest=await chrome.tabs.create({url:origin+'/amazon-import',active:false});
 const ready=await loaded(dest.id);
 if(!ready.url||new URL(ready.url).origin!==origin||
    new URL(ready.url).pathname!=='/amazon-import'){
  await chrome.tabs.update(dest.id,{active:true});
  throw Error('Sign in to Ledger in the new tab, then try Sync again.');
 }
 const result=await chrome.scripting.executeScript({target:{tabId:dest.id},
  func:(csv,counts)=>{
   const input=document.getElementById('file'),save=document.getElementById('import');
   if(!input||!save)return false;
   const transfer=new DataTransfer();
   transfer.items.add(new File([csv],'Amazon-browser-sync.csv',{type:'text/csv'}));
   input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
   const notice=document.createElement('p');
   notice.id='amazon-browser-sync-note';
   notice.textContent='Browser sync: '+counts.items+' single-item purchases from '+counts.pages+
    ' pages; '+counts.skipped+' uncertain orders skipped. Review and select Import and save.';
   notice.style.fontWeight='600';
   input.closest('section')?.insertBefore(notice,input.closest('label')||input);
   save.focus();
   return true;
  },args:[scan.csv,{items:scan.items,pages:scan.pages,skipped:scan.skipped}]});
 if(result?.[0]?.result!==true)throw Error('Ledger import page unavailable. Sign in and retry.');
 await chrome.tabs.update(dest.id,{active:true});
 return {items:scan.items,pages:scan.pages,skipped:scan.skipped};
}
// Runs in the already authenticated Ledger origin, not the extension origin.
// Ledger's own revision header and existing importer enforce durable save,
// manual-override protection and idempotent bank transaction matching.
async function importAutomatically(tabId,csv){
 const r=await chrome.scripting.executeScript({target:{tabId},
  func:async text=>{
   const auth=await fetch('/api/ledger/amazon-review',{credentials:'same-origin',cache:'no-store'});
   if(!auth.ok)throw Error('Sign in to private Ledger in this browser to resume auto sync.');
   const revision=auth.headers.get('x-ledger-revision');
   if(!revision)throw Error('Ledger revision unavailable. Sign in and retry.');
   const upload=await fetch('/api/ledger/amazon-import',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/octet-stream',
     'X-Pilot-Action':'1','X-Amazon-Filename':encodeURIComponent('Amazon-browser-sync.csv'),
     'X-Amazon-Dry-Run':'0','X-Ledger-Revision':revision},
    body:new Blob([text],{type:'text/csv'})
   });
   let body={};try{body=await upload.json()}catch{}
   if(!upload.ok)throw Error(
    upload.status===409?'Ledger was updated while syncing. Retry after refresh.':
    upload.status===401?'Sign in to private Ledger to resume automatic sync.':
    typeof body.error==='string'?body.error.slice(0,140):'Amazon import did not save.');
   return {applied:Number(body.applied||0),notes:Number(body.notesReady||0),
    categories:Number(body.confidentCategories||0)};
  },args:[csv]});
 const result=r?.[0]?.result;
 if(!result||!Number.isFinite(result.applied))throw Error('Ledger did not confirm the Amazon import.');
 return result;
}
async function automaticSync(origin){
 let amazonTab=null,ledgerTab=null;
 try{
  amazonTab=await chrome.tabs.create({url:AMAZON_URL,active:false});
  const order=await loaded(amazonTab.id);
  if(!amazonPage(order.url))throw Error(
   'Amazon needs sign-in or verification. Open Your Orders, sign in, then retry.');
  const scan=await scanTab(amazonTab.id);
  ledgerTab=await chrome.tabs.create({url:origin+'/amazon-import',active:false});
  const page=await loaded(ledgerTab.id);
  if(!page.url||new URL(page.url).origin!==origin||
     new URL(page.url).pathname!=='/amazon-import')
   throw Error('Sign in to your private Ledger in Chrome or Edge to resume syncing.');
  const saved=await importAutomatically(ledgerTab.id,scan.csv);
  return {items:scan.items,pages:scan.pages,skipped:scan.skipped,
   applied:saved.applied,notes:saved.notes,categories:saved.categories};
 }finally{
  if(amazonTab)try{await chrome.tabs.remove(amazonTab.id)}catch{}
  if(ledgerTab)try{await chrome.tabs.remove(ledgerTab.id)}catch{}
 }
}
async function permissionsFor(origin,auto=false){
 if(!origin||!await chrome.permissions.contains({origins:[origin+'/*']}))
  throw Error('Connect your private Ledger website in the extension.');
 if(auto&&!await chrome.permissions.contains({origins:[AMAZON_ACCESS]}))
  throw Error('Approve Amazon order-page access before enabling automatic sync.');
}
function singleFlight(task){
 if(running)return Promise.reject(Error('A sync is already running.'));
 const promise=Promise.resolve().then(task);
 running=promise;
 promise.finally(()=>{if(running===promise)running=null}).catch(()=>{});
 return promise;
}
async function schedule(){
 const {autoEnabled,ledgerOrigin:origin}=await chrome.storage.local.get(['autoEnabled','ledgerOrigin']);
 await chrome.alarms.clear(ALARM);
 if(autoEnabled&&ledgerOrigin(origin))
  await chrome.alarms.create(ALARM,{periodInMinutes:PERIOD_MINUTES});
}
async function autoRun(){
 const {autoEnabled,ledgerOrigin:origin}=await chrome.storage.local.get(['autoEnabled','ledgerOrigin']);
 if(!autoEnabled)return {disabled:true};
 if(running)return {busy:true};
 const start=new Date().toISOString();
 await chrome.storage.local.set({lastAutoAttempt:start});
 try{
  await permissionsFor(origin,true);
  const result=await singleFlight(()=>automaticSync(origin));
  await chrome.storage.local.set({lastAutoSuccess:new Date().toISOString(),
   lastAutoError:'',lastAutoResult:result});
  return result;
 }catch(error){
  const message=String(error?.message||error).slice(0,170);
  await chrome.storage.local.set({lastAutoError:message});
  throw Error(message);
 }
}
async function manualRun(tabId,origin){
 const {ledgerOrigin:saved}=await chrome.storage.local.get('ledgerOrigin');
 if(!ledgerOrigin(saved)||saved!==origin)throw Error('Connect Ledger again.');
 await permissionsFor(origin);
 return singleFlight(()=>manualPreview(tabId,origin));
}
chrome.alarms.onAlarm.addListener(alarm=>{
 if(alarm.name===ALARM)autoRun().catch(()=>{});
});
chrome.runtime.onStartup.addListener(()=>{schedule().catch(()=>{})});
chrome.runtime.onInstalled.addListener(()=>{schedule().catch(()=>{})});
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(sender.id!==chrome.runtime.id)return;
 const work=async()=>{
  if(message?.type==='LEDGER_AMAZON_SYNC')
   return manualRun(message.tabId,message.ledgerOrigin);
  if(message?.type==='LEDGER_AMAZON_AUTO_ENABLE'){
   const {ledgerOrigin:origin}=await chrome.storage.local.get('ledgerOrigin');
   await permissionsFor(origin,true);
   await chrome.storage.local.set({autoEnabled:true,lastAutoError:''});
   await schedule();return {enabled:true};
  }
  if(message?.type==='LEDGER_AMAZON_AUTO_DISABLE'){
   await chrome.storage.local.set({autoEnabled:false});
   await schedule();return {enabled:false};
  }
  if(message?.type==='LEDGER_AMAZON_AUTO_NOW')return autoRun();
  throw Error('Unknown Amazon sync command');
 };
 if(!['LEDGER_AMAZON_SYNC','LEDGER_AMAZON_AUTO_ENABLE',
   'LEDGER_AMAZON_AUTO_DISABLE','LEDGER_AMAZON_AUTO_NOW'].includes(message?.type))return;
 work().then(result=>sendResponse({ok:true,...result}))
  .catch(error=>sendResponse({ok:false,error:String(error.message||error)}));
 return true;
});
