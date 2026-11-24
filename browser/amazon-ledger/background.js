'use strict';
// No Amazon passwords, cookies, session tokens, bank data, or order history are stored.
const amazonPage=url=>/^https:\/\/(?:[a-z0-9-]+\.)?amazon\.com\//i.test(url||'')&&
 /\/(?:your-orders|gp\/your-account\/order-history|gp\/your-account\/order-details)/i.test(new URL(url).pathname);
async function loaded(tabId){
 const tab=await chrome.tabs.get(tabId);
 if(tab.status==='complete')return tab;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(listener);reject(Error('Ledger page did not load.'))},25000);
  function listener(id,change,t){
   if(id===tabId&&change.status==='complete'){
    clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);resolve(t);
   }
  }
  chrome.tabs.onUpdated.addListener(listener);
 });
}
async function run(tabId,origin){
 const tab=await chrome.tabs.get(tabId);
 if(!amazonPage(tab.url))throw Error('Open Amazon Your Orders before syncing.');
 const {ledgerOrigin}=await chrome.storage.local.get('ledgerOrigin');
 if(!ledgerOrigin||origin!==ledgerOrigin)throw Error('Connect Ledger again.');
 const permitted=await chrome.permissions.contains({origins:[origin+'/*']});
 if(!permitted)throw Error('Ledger site permission is required.');
 await chrome.scripting.executeScript({target:{tabId},files:['scraper.js']});
 const result=await chrome.scripting.executeScript({target:{tabId},func:()=>globalThis.LedgerAmazonScraper.scan()});
 const scan=result?.[0]?.result;
 if(!scan||typeof scan.csv!=='string'||!scan.items||scan.csv.length>6*1024*1024)
  throw Error('Amazon did not provide a safe order list.');
 const dest=await chrome.tabs.create({url:origin+'/amazon-import',active:false});
 const ready=await loaded(dest.id);
 if(!ready.url||new URL(ready.url).origin!==origin||new URL(ready.url).pathname!=='/amazon-import'){
  await chrome.tabs.update(dest.id,{active:true});
  throw Error('Sign in to Ledger in the new tab, then run Sync again.');
 }
 const value=await chrome.scripting.executeScript({target:{tabId:dest.id},
  func:(csv,counts)=>{
   const input=document.getElementById('file'),check=document.getElementById('check');
   if(!input||!check)return false;
   const transfer=new DataTransfer();
   transfer.items.add(new File([csv],'Amazon-browser-sync.csv',{type:'text/csv'}));
   input.files=transfer.files;
   input.dispatchEvent(new Event('change',{bubbles:true}));
   const note=document.createElement('p');
   note.id='amazon-browser-sync-note';
   note.textContent='Browser sync: '+counts.items+' single-item purchases read from '+counts.pages+
    ' order pages; '+counts.skipped+' uncertain orders skipped.'+
    (counts.stoppedForLogin?' Amazon requested another sign-in; sync stopped early.':'')+
    ' Confirm the bank-charge matches below before applying.';
   note.style.fontWeight='600';
   input.closest('section')?.insertBefore(note,input.closest('label')||input);
   check.click();return true;
  },args:[scan.csv,{items:scan.items,pages:scan.pages,skipped:scan.skipped,stoppedForLogin:scan.stoppedForLogin}]});
 if(value?.[0]?.result!==true)throw Error('Ledger import page is unavailable. Sign in and retry.');
 await chrome.tabs.update(dest.id,{active:true});
 return {items:scan.items,pages:scan.pages,skipped:scan.skipped};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(sender.id!==chrome.runtime.id||message?.type!=='LEDGER_AMAZON_SYNC')return;
 run(message.tabId,message.ledgerOrigin).then(result=>sendResponse({ok:true,...result}))
  .catch(e=>sendResponse({ok:false,error:String(e.message||e)}));
 return true;
});
