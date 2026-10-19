/* Local or password-protected hosted Phase D Sandbox controls.
 * Public GitHub Pages displays nothing; tokens remain server-side.
 */
(function(root){
'use strict';
const LOCAL=['127.0.0.1','localhost'].includes(root.location?.hostname||'')||Boolean(root.document?.querySelector('meta[name="household-sandbox-hosted"]'));
const api='/api/sandbox/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BACKUP='household-ledger-pre-sandbox-backup-v1';
let lastStatus=null,loading=false,context=null,lastLoadedSignature=null;
async function req(route,body){
 const response=await fetch(api+route,{
  method:body===undefined?'GET':'POST',cache:'no-store',
  headers:body===undefined?{}:{'Content-Type':'application/json','X-Household-Sandbox':'1'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 let data={};
 try{data=await response.json()}catch{}
 if(!response.ok)throw Error(data.error||'Sandbox service unavailable');
 return data;
}
function panel(){
 if(!LOCAL)return '';
 return '<div class="panel settings-block sandbox-panel" id="sandbox-panel">'+
  '<div class="section-top"><h3>Plaid Sandbox</h3><span class="budget-summary-meta">Simulated only</span></div>'+
  '<p class="prediction-note">Test several checking, savings and credit-card accounts without connecting real banks. Plaid credentials never enter the browser.</p>'+
  '<div id="sandbox-status" role="status">Checking test service…</div>'+
  '<label for="sandbox-institution" class="sandbox-label">Test institution</label>'+
  '<select id="sandbox-institution">'+
   '<option value="ins_109508">First Platypus Bank</option>'+
   '<option value="ins_109509">First Gingham Credit Union</option>'+
   '<option value="ins_109510">Tattersall Federal Credit Union</option></select>'+
  '<label for="sandbox-profile" class="sandbox-label">Test scenario</label>'+
  '<select id="sandbox-profile">'+
   '<option value="standard">Standard household accounts</option>'+
   '<option value="dynamic">Pending and posted transactions</option></select>'+
  '<div class="sandbox-actions"><button class="btn primary" id="sandbox-connect" type="button">Add test institution</button>'+
  '<button class="btn" id="sandbox-sync" type="button" disabled>Sync test transactions</button>'+
  '<button class="btn" id="sandbox-link" type="button" hidden>Open Plaid Link (Sandbox)</button></div>'+
  '<div id="sandbox-items"></div>'+
  '<p class="prediction-note">This is not live banking. The public GitHub Pages Ledger stays demo-only. This test website is separate from the public Ledger.</p>'+
  '</div>';
}
function accountSnapshot(snapshot){
 return {asOf:snapshot.asOf,source:snapshot.source,
  mode:'demo',connected:false,lastSuccessfulSync:snapshot.lastSuccessfulSync,
  accounts:snapshot.accounts.map(a=>({
   ...a,simulated:true,currency:a.iso_currency_code||'USD',
   balanceAsOf:a.balanceAsOf,transactionAccount:a.transactionAccount||a.name
  }))};
}
function restoreOriginal(){
 const backup=localStorage.getItem(BACKUP);
 if(backup&&context){
  try{
   const parsed=JSON.parse(backup);
   context.setData(context.Model.migrate(parsed));
   context.setSnapshot(null);
   context.persistAndRender();
   localStorage.removeItem(BACKUP);
   lastLoadedSignature=null;
  }catch{ /* Keep backup for manual recovery; do not overwrite a corrupt record. */ }
 }
}
async function loadSnapshot(){
 const snap=await req('snapshot');
 if(!context)return;
 const signature=JSON.stringify((snap.items||[]).map(i=>[i.itemId,i.lastSuccessfulSync,i.transactionCount,i.accountCount]));
 if(signature===lastLoadedSignature)return;
 if(!snap.items?.length){lastLoadedSignature=null;restoreOriginal();return}
 if(!localStorage.getItem(BACKUP))
  localStorage.setItem(BACKUP,JSON.stringify(context.getData()));
 const state=context.Model.migrate(context.getData());
 const liveItems=new Set(snap.items.map(i=>i.itemId));
 state.accounts=(state.accounts||[]).filter(a=>!a.itemId||liveItems.has(a.itemId));
 // Only the separate local service can supply source rows for this fixture.
 // Never fold real accounts into the public demo origin.
 state.transactions=state.transactions.filter(t=>t.source?.provider!=='demo'&&
  !(t.source?.provider==='plaid'&&t.source?.simulated===true));
 // Existing historical non-demo records are preserved.
 for(const item of snap.items){
  const existing=state.transactions.filter(t=>t.source?.provider==='plaid'&&t.source?.itemId===item.itemId);
  const incoming=new Set(item.transactions.map(t=>String(t.transaction_id)));
  const removed=existing.filter(t=>!incoming.has(String(t.source.providerTransactionId)))
   .map(t=>({transaction_id:t.source.providerTransactionId}));
  context.Model.applyPlaidSyncPages(state,{
   itemId:item.itemId,
   accounts:item.accounts,
   pages:[{added:item.transactions,modified:[],removed,hasMore:false,
    nextCursor:item.cursorPresent?'snapshot-'+item.itemId:'initial-'+item.itemId,
    simulated:true}]
  });
 }
 lastLoadedSignature=signature;
 context.setData(state);
 context.setSnapshot(accountSnapshot(snap));
 context.persistAndRender();
}
function paint(){
 const rootPanel=document.getElementById('sandbox-panel');
 if(!rootPanel)return;
 const status=rootPanel.querySelector('#sandbox-status'),items=rootPanel.querySelector('#sandbox-items');
 const data=lastStatus;
 const active=Boolean(data?.connected);
 const mode=data?.mode||'offline';
 status.textContent=data?data.mode==='fixture'?
  'Fictional Sandbox mode · no Plaid API requests. '+data.items.length+' test institution(s).':
  'Plaid Sandbox credentials configured · '+data.items.length+' test institution(s).':
  'Sandbox service unavailable. Refresh or check its hosting status.';
 rootPanel.querySelector('#sandbox-connect').disabled=loading||!data;
 rootPanel.querySelector('#sandbox-sync').disabled=loading||!active;
 const link=rootPanel.querySelector('#sandbox-link');
 link.hidden=data?.mode!=='plaid';link.disabled=loading;
 items.innerHTML=(data?.items||[]).map(item=>
  '<div class="sandbox-item"><span><strong>'+esc(item.institution)+'</strong>'+
  '<small>'+item.accountCount+' accounts · '+item.transactionCount+' transactions'+
  (item.warning?' · '+esc(item.warning):'')+'</small></span>'+
  '<div class="sandbox-item-actions"><button class="btn" type="button" data-sandbox-refresh="'+esc(item.itemId)+'">Refresh</button>'+
  '<button class="btn" type="button" data-sandbox-disconnect="'+esc(item.itemId)+'">Disconnect</button></div></div>').join('');
 items.querySelectorAll('[data-sandbox-refresh]').forEach(b=>b.onclick=()=>act(async()=>{
  await req('refresh',{itemId:b.dataset.sandboxRefresh});
  await req('sync',{itemId:b.dataset.sandboxRefresh});
 }));
 items.querySelectorAll('[data-sandbox-disconnect]').forEach(b=>b.onclick=()=>act(async()=>{
  await req('disconnect',{itemId:b.dataset.sandboxDisconnect});
 }));
}
async function act(fn){
 if(loading)return;
 loading=true;paint();
 try{
  await fn();
  lastStatus=await req('status');
  lastLoadedSignature=null;
  await loadSnapshot();
 }catch(e){
  const el=document.getElementById('sandbox-status');
  if(el)el.textContent='Sandbox test: '+e.message;
 }finally{loading=false;paint()}
}
async function link(){
 const token=await req('link-token',{});
 if(!token.link_token)throw Error('Plaid did not return a Link token');
 if(!root.Plaid){
  await new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://cdn.plaid.com/link/v2/stable/link-initialize.js';
   script.onload=resolve;script.onerror=()=>reject(Error('Unable to load Plaid Link'));
   document.head.appendChild(script);
  });
 }
 await new Promise((resolve,reject)=>{
  const handler=root.Plaid.create({token:token.link_token,
   onSuccess:async(publicToken,metadata)=>{
    try{await req('exchange',{publicToken,institutionId:metadata?.institution?.institution_id});resolve()}
    catch(e){reject(e)}
   },
   onExit:err=>err?reject(Error(err.display_message||'Plaid Link cancelled')):resolve()
  });
  handler.open();
 });
}
async function bind(ctx){
 if(!LOCAL||!document.getElementById('sandbox-panel'))return;
 context=ctx;
 const el=document.getElementById('sandbox-panel');
 el.querySelector('#sandbox-connect').onclick=()=>act(async()=>{
  await req('connect',{institutionId:el.querySelector('#sandbox-institution').value,
   profile:el.querySelector('#sandbox-profile').value});
 });
 el.querySelector('#sandbox-sync').onclick=()=>act(()=>req('sync',{}));
 el.querySelector('#sandbox-link').onclick=()=>act(link);
 try{
  lastStatus=await req('status');paint();
  if(lastStatus.connected)await loadSnapshot();
  else if(localStorage.getItem(BACKUP))restoreOriginal();
 }catch{lastStatus=null;paint()}
}
root.HouseholdSandboxUI={panel,bind,available:LOCAL};
})(typeof window!=='undefined'?window:globalThis);
