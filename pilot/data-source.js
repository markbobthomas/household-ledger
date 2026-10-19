/* Real Plaid and fictional Demo are DATA SOURCES for the same Ledger UI.
 * Bank source facts remain in encrypted server storage and RAM, never localStorage. */
(function(root){
'use strict';
const MODE='household-ledger-view-mode';
let host=null,live=false,loading=false,writeQueue=Promise.resolve(),loadedAccount=null,lastError='';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;','"':'&#39;'}[c]));
const today=()=>new Date().toLocaleDateString('en-CA');
const statusText=()=>lastError?'<p role="alert">'+esc(lastError)+'</p>':'';
const selection=()=>live?'real':'demo';
async function request(path,body){
 const response=await fetch('/api/ledger'+path,{cache:'no-store',
  method:body===undefined?'GET':'POST',
  headers:body===undefined?{}:{'Content-Type':'application/json','X-Pilot-Action':'1'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const ct=response.headers.get('content-type')||'';
 if(!ct.includes('application/json'))throw Error('Bank server returned an unexpected response. Wait for Render to finish deploying.');
 let result;try{result=await response.json()}catch{throw Error('Bank server response could not be read')}
 if(!response.ok)throw Error(result.error||'Bank server request failed');
 return result;
}
function record(t,account){
 const amount=Number(t.amount),pfc=t.category||null;
 if(!t.id||!/^\d{4}-\d{2}-\d{2}$/.test(String(t.date))||!Number.isFinite(amount))return null;
 const name=String(t.merchant||t.name||'Bank transaction').slice(0,250);
 const code=String(pfc?.primary||'').toUpperCase();
 const incoming=amount<0;
 const transfer=/^(?:TRANSFER_IN|TRANSFER_OUT|LOAN_PAYMENTS)$/.test(code)||name.toLowerCase().includes('transfer to ')||name.toLowerCase().includes('transfer from ');
 const type=transfer?'transfer':incoming?'income':'expense';
 const row={id:String(t.id),date:t.date,merchant:name,description:'Bank-imported transaction',amount:Math.abs(amount),
  type,account:account.name,accountId:account.id,pending:!!t.pending,category:'Other',
  personal_finance_category:pfc,
  source:{provider:'plaid',verified:true,itemId:'connected-bank-item',providerTransactionId:String(t.id),
   accountId:account.id,plaidAmount:amount,personalFinanceCategory:pfc,
   categoryConfidence:pfc?.confidence_level==='VERY_HIGH'?.99:pfc?.confidence_level==='HIGH'?.93:0}};
 const classification=root.HouseholdCategorization?.classify(row);
 if(!transfer&&classification?.category&&classification.category!=='Other'){
  row.category=classification.category;
  row.categoryConfidence=classification.confidence;
  row.source.categoryOrigin=classification.method;
 }
 return row;
}
function prepare(payload){
 if(!payload.connected||!payload.account)throw Error('Connect one bank account first under Bank Connection');
 const bank=payload.account;
 const rows=(payload.transactions||[]).map(t=>record(t,bank)).filter(Boolean);
 const adjustments=payload.adjustments||{};
 const state=root.HouseholdLedgerData.migrate({
  transactions:rows,items:[],
  accounts:[{id:bank.id,name:bank.name,type:bank.type,subtype:bank.subtype,institution:'Connected via Plaid',itemId:'connected-bank-item'}],
  ...Object.fromEntries(['categoryOverrides','predictions','reviews','learning','customCategories'].filter(k=>adjustments[k]!==undefined).map(k=>[k,adjustments[k]]))
 });
 const snapshot={asOf:today(),mode:'plaid',connected:true,source:'Plaid bank-reported balance',lastSuccessfulSync:payload.lastSync,
  expectedAccountIds:[bank.id],
  accounts:[{id:bank.id,name:bank.name+(bank.mask?' ••'+bank.mask:''),accountType:bank.type==='credit'?'credit':bank.subtype==='savings'?'savings':'checking',
   type:bank.type,subtype:bank.subtype,transactionAccount:bank.name,current:bank.current??null,
   available:bank.available??null,balanceAsOf:bank.balanceObservedAt||null,
   currency:bank.currency||'USD',simulated:false}]};
 return {state,snapshot,account:bank};
}
async function enter(){
 if(loading)return;loading=true;lastError='';
 // The last preference is Real: do not briefly show fictional balances or
 // "bank not connected" while the authenticated bank snapshot loads.
 host.render();
 try{
  const data=prepare(await request(''));
  host.enterReal(data.state,data.snapshot);
  loadedAccount=data.account;live=true;
  localStorage.setItem(MODE,'real');
 }catch(e){lastError=e.message;host.enterDemo();live=false;localStorage.setItem(MODE,'demo')}
 finally{loading=false;host.render()}
}
async function refresh(){
 if(loading||!live)return;
 loading=true;lastError='';host.render();
 try{
  // Finish the user's category and schedule writes before retrieving a new
  // server state, otherwise the screen could overwrite their latest decision.
  await writeQueue;
  const response=await fetch('/api/sync',{method:'POST',cache:'no-store',
   headers:{'X-Pilot-Action':'1','Content-Type':'application/json'},body:'{}'});
  const result=await response.json();
  if(!response.ok)throw Error(result?.error||'The bank could not complete this sync');
  const updated=prepare(await request(''));
  host.enterReal(updated.state,updated.snapshot);
  loadedAccount=updated.account;
 }catch(e){lastError='Bank refresh failed: '+e.message}
 finally{loading=false;host.render()}
}
function demo(){
 live=false;loadedAccount=null;lastError='';localStorage.setItem(MODE,'demo');
 host.enterDemo();host.render();
}
function panel(){
 return '<section class="panel settings-block" aria-label="Ledger data source">'+
  '<h3>Data source</h3><label for="ledger-mode-switch">Choose your data</label>'+
  '<select id="ledger-mode-switch" aria-label="Choose demo or real data source"'+(loading?' disabled':'')+'>'+
   '<option value="demo"'+(!live&&!loading?' selected':'')+'>Demo / simulated</option>'+
   '<option value="real"'+(live||loading?' selected':'')+'>Real / Plaid</option></select>'+
  '<p>Both modes use the same Ledger pages, category controls, budgets, forecasts and Insights. Bank transactions and balances cannot be edited.</p>'+
  '<p>Real data is stored on the private server, separate from fictional data. Only your mode preference is stored on this device.</p>'+
  '<a href="/bank-connect">Connect, sync or disconnect bank account</a>'+statusText()+'</section>';
}
function persist(data){
 if(!live)return;
 const body={categoryOverrides:data.categoryOverrides||{},predictions:data.predictions||{},
  reviews:data.reviews||{},learning:data.learning||{},customCategories:data.customCategories||[]};
 // Capture this exact snapshot; serialize writes so rapid edits cannot reverse their order.
 writeQueue=writeQueue.catch(()=>{}).then(()=>request('/adjustments',body)).catch(e=>{
  lastError='Your latest real-data change was not saved: '+e.message;
  const flash=document.getElementById('flash');if(flash)flash.textContent=lastError;
  return null;
 });
 return writeQueue;
}
function bind(callbacks){
 host=callbacks;
 document.addEventListener('change',e=>{
  if(e.target?.id!=='ledger-mode-switch')return;
  if(e.target.value==='real')enter();else demo();
 });
 if(localStorage.getItem(MODE)==='real')enter();
}
root.HouseholdLiveSource={bind,panel,persist,enterReal:enter,refresh,mode:selection,
 get loading(){return loading},get error(){return lastError}};
})(typeof window!=='undefined'?window:globalThis);
