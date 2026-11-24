'use strict';
const el=id=>document.getElementById(id);
function originOf(value){
 const u=new URL(String(value||'').trim());
 if(u.username||u.password||u.search||u.hash)throw Error('Enter only your Ledger website address.');
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))
  throw Error('Ledger must use HTTPS (except local development).');
 if(/(?:^|\.)amazon\.com$/i.test(u.hostname))throw Error('Enter the Ledger address, not Amazon.');
 return u.origin;
}
function status(message){el('message').textContent=message}
function busy(state){el('save').disabled=state;el('sync').disabled=state}
async function save(){
 const origin=originOf(el('ledger').value);
 const granted=await chrome.permissions.request({origins:[origin+'/*']});
 if(!granted)throw Error('Ledger site access was not granted.');
 await chrome.storage.local.set({ledgerOrigin:origin});
 status('Ledger connected. Open amazon.com/your-orders and select Sync.');
 return origin;
}
el('save').addEventListener('click',async()=>{
 busy(true);try{await save()}catch(e){status(e.message)}finally{busy(false)}
});
el('sync').addEventListener('click',async()=>{
 busy(true);
 try{
  const {ledgerOrigin}=await chrome.storage.local.get('ledgerOrigin');
  if(!ledgerOrigin)throw Error('First connect your private Ledger address above.');
  const approved=await chrome.permissions.contains({origins:[ledgerOrigin+'/*']});
  if(!approved)throw Error('Ledger access was revoked. Connect it again.');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab||!/^https:\/\/(?:[a-z0-9-]+\.)?amazon\.com\//i.test(tab.url||'')||
      !/\/(?:your-orders|gp\/your-account\/order-history|gp\/your-account\/order-details)/i.test(new URL(tab.url).pathname))
   throw Error('Open the Amazon Your Orders page, then click Sync.');
  status('Reading Amazon order pages…');
  const result=await chrome.runtime.sendMessage({type:'LEDGER_AMAZON_SYNC',tabId:tab.id,ledgerOrigin});
  if(!result?.ok)throw Error(result?.error||'Sync did not complete.');
  status('Opened the Ledger preview. Check matches before saving.');
 }catch(e){status(e.message)}finally{busy(false)}
});
chrome.storage.local.get('ledgerOrigin').then(({ledgerOrigin})=>{if(ledgerOrigin)el('ledger').value=ledgerOrigin;});
