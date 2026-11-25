'use strict';
const el=id=>document.getElementById(id);
const AMAZON_ACCESS='https://www.amazon.com/*';
let current={ledgerOrigin:null,autoEnabled:false};
function originOf(value){
 const u=new URL(String(value||'').trim());
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/')
  throw Error('Enter only the Ledger website address, with no path or password.');
 if(u.protocol!=='https:'&&
    !(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))
  throw Error('Ledger must use HTTPS (except local development).');
 if(/(?:^|\.)amazon\.com$/i.test(u.hostname))
  throw Error('Enter the private Ledger address, not Amazon.');
 return u.origin;
}
const message=text=>{el('message').textContent=text};
const dateText=iso=>iso?new Date(iso).toLocaleString():'Not yet';
function busy(state){
 for(const id of ['save','sync','auto-toggle','run-now'])el(id).disabled=state;
}
async function send(type,args={}){
 const res=await chrome.runtime.sendMessage({type,...args});
 if(!res?.ok||res.busy)throw Error(res?.busy?'Another Amazon sync is already running.':res?.error||'Amazon sync could not complete.');
 return res;
}
async function refresh(){
 const data=await chrome.storage.local.get([
  'ledgerOrigin','autoEnabled','lastAutoAttempt','lastAutoSuccess','lastAutoError','lastAutoResult']);
 current={ledgerOrigin:data.ledgerOrigin,autoEnabled:!!data.autoEnabled};
 if(data.ledgerOrigin)el('ledger').value=data.ledgerOrigin;
 el('auto-toggle').textContent=data.autoEnabled?'Turn off automatic sync':'Enable automatic sync';
 el('run-now').hidden=!data.autoEnabled;
 let text=data.autoEnabled?'Automatic sync is on. Runs approximately every 6 hours when Chrome/Edge is running.':
  'Automatic sync is off.';
 if(data.lastAutoAttempt)text+='\nLast check: '+dateText(data.lastAutoAttempt);
 if(data.lastAutoSuccess)text+='\nLast success: '+dateText(data.lastAutoSuccess);
 if(data.lastAutoResult&&data.lastAutoSuccess)text+='\nLast result: '+
  Number(data.lastAutoResult.items||0)+' Amazon items read; '+
  Number(data.lastAutoResult.applied||0)+' saved changes.';
 if(data.lastAutoError)text+='\nNeeds attention: '+data.lastAutoError;
 el('auto-details').textContent=text;
}
el('save').addEventListener('click',async()=>{
 busy(true);
 try{
  const origin=originOf(el('ledger').value);
  const allowed=await chrome.permissions.request({origins:[origin+'/*']});
  if(!allowed)throw Error('Allow access to the private Ledger website.');
  const old=await chrome.storage.local.get(['ledgerOrigin','autoEnabled']);
  if(old.ledgerOrigin&&old.ledgerOrigin!==origin&&old.autoEnabled)
   await send('LEDGER_AMAZON_AUTO_DISABLE');
  await chrome.storage.local.set({ledgerOrigin:origin});
  message('Ledger connected. You can enable automatic Amazon sync below.');
  await refresh();
 }catch(error){message(error.message)}
 finally{busy(false)}
});
el('auto-toggle').addEventListener('click',async()=>{
 busy(true);message('');
 try{
  // Prompt for Amazon access directly from the click gesture: no
  // asynchronous storage read may intervene before permissions.request.
  if(current.autoEnabled){
   await send('LEDGER_AMAZON_AUTO_DISABLE');
   message('Automatic sync turned off.');
  }else{
   if(!current.ledgerOrigin)throw Error('Connect your private Ledger website first.');
   const granted=await chrome.permissions.request({origins:[AMAZON_ACCESS]});
   if(!granted)throw Error('Automatic sync needs permission to read Amazon order pages.');
   const ledgerAccess=await chrome.permissions.contains({origins:[current.ledgerOrigin+'/*']});
   if(!ledgerAccess)throw Error('Reconnect to Ledger above to approve site access.');
   await send('LEDGER_AMAZON_AUTO_ENABLE');
   message('Automatic sync enabled. Checking current Amazon orders…');
   await refresh();
   // First check runs immediately. Subsequent checks use a persistent alarm.
   const result=await send('LEDGER_AMAZON_AUTO_NOW');
   message('Synced '+Number(result.items||0)+' order items; '+
    Number(result.applied||0)+' saved changes.');
  }
 }catch(error){message(error.message)}
 finally{await refresh();busy(false)}
});
el('run-now').addEventListener('click',async()=>{
 busy(true);message('Checking Amazon and saving confirmed matches…');
 try{
  const result=await send('LEDGER_AMAZON_AUTO_NOW');
  message('Synced '+Number(result.items||0)+' order items; '+
   Number(result.applied||0)+' saved changes.');
 }catch(error){message(error.message)}
 finally{await refresh();busy(false)}
});
el('sync').addEventListener('click',async()=>{
 busy(true);
 try{
  const {ledgerOrigin}=await chrome.storage.local.get('ledgerOrigin');
  if(!ledgerOrigin)throw Error('Connect your private Ledger address above.');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab||!/^https:\/\/(?:[a-z0-9-]+\.)?amazon\.com\//i.test(tab.url||'')||
   !/\/(?:your-orders|gp\/your-account\/order-history|gp\/your-account\/order-details)/i.test(
    new URL(tab.url).pathname))
   throw Error('Open Amazon Your Orders first to use the manual preview.');
  message('Reading Amazon orders…');
  await send('LEDGER_AMAZON_SYNC',{tabId:tab.id,ledgerOrigin});
  message('Opened Ledger manual preview; review and click Import and save.');
 }catch(error){message(error.message)}finally{busy(false)}
});
refresh().catch(error=>message(error.message));
