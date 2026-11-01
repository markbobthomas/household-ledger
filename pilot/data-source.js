/* Real Plaid and fictional Demo are DATA SOURCES for the same Ledger UI.
 * Bank source facts remain in encrypted server storage and RAM, never localStorage. */
(function(root){
'use strict';
const MODE='household-ledger-view-mode';
const Accounting=root.HouseholdAccounting||(typeof require==='function'?require('../accounting.js'):null);
const Categorization=root.HouseholdCategorization||(typeof require==='function'?require('../categorization.js'):null);
const DataModel=root.HouseholdLedgerData||(typeof require==='function'?require('../ledger-data.js'):null);
let host=null,live=false,loading=false,writeQueue=Promise.resolve(),loadedAccount=null,lastError='',lastErrorKind='bank',serverRevision='';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;','"':'&#39;'}[c]));
const BankFeed=root.HouseholdBankFeed||(typeof require==='function'?require('../bank-feed.js'):null);
const today=()=>{
 if(typeof BankFeed?.localDate==='function')return BankFeed.localDate();
 // The adapter can be loaded independently by an isolated private-save test.
 // Keep its fallback ISO/local even without the normal browser bank-feed module.
 const d=new Date();
 return [String(d.getFullYear()).padStart(4,'0'),
  String(d.getMonth()+1).padStart(2,'0'),
  String(d.getDate()).padStart(2,'0')].join('-');
};
const statusText=()=>lastError?'<p role="alert">'+esc(lastError)+'</p>':''; 
const reconnectMessage='Your bank connection needs attention. Plaid requires you to sign in again or renew permission. Previously imported transactions and saved predictions are preserved; refresh results may be out of date.';
const warningBanner=()=>live&&lastError?
 '<div class="notice danger" role="alert"><div><strong>'+
 (lastErrorKind==='save'?'Could not save changes.':'Bank connection needs attention.')+
 '</strong> '+esc(lastError)+'</div>'+
 (lastErrorKind==='bank'?'<a class="btn" href="/bank-connect">Reconnect bank</a>':'')+
 '</div>':'';
const selection=()=>live?'real':'demo';
async function request(path,body){
 const url='/api/ledger'+path,options={cache:'no-store',credentials:'same-origin',
  method:body===undefined?'GET':'POST',
  headers:body===undefined?{}:{'Content-Type':'application/json','X-Pilot-Action':'1',
   ...(serverRevision?{'X-Ledger-Revision':serverRevision}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})};
 let response;
 try{response=await fetch(url,options)}
 catch(error){
  // Safari calls a dropped connection "Load failed". Repeating a complete
  // forecast-settings snapshot is safe: it neither adds another bill nor
  // mutates bank data. Retry only transport failures, not rejected edits.
  if(path!=='/forecasts')throw error;
  if(typeof setTimeout==='function')await new Promise(resolve=>setTimeout(resolve,450));
  try{response=await fetch(url,options)}
  catch{
   throw Error('Connection to the private bank server was interrupted. Your save was not confirmed. Keep this page open and try Save again.');
  }
 }
 if(response.status===401)throw Error('Private bank session needs to be reopened. Reload the private bank page and sign in.');
 const ct=response.headers.get('content-type')||'';
 if(!ct.includes('application/json'))throw Error('The private bank server is temporarily unavailable or updating. Try saving again after reopening the page.');
 let result;try{result=await response.json()}catch{throw Error('Bank server response could not be read')}
 if(!response.ok)throw Error(result.error||'Bank server request failed');
 const nextRevision=response.headers.get('x-ledger-revision');
 if(typeof nextRevision==='string'&&/^[a-f0-9]{64}$/i.test(nextRevision))serverRevision=nextRevision;
 return result;
}
function record(t,account){
 const amount=Number(t.amount),pfc=t.category||null;
 if(!t.id||!/^\d{4}-\d{2}-\d{2}$/.test(String(t.date))||!Number.isFinite(amount))return null;
 const name=String(t.merchant||t.name||'Bank transaction').slice(0,250);
 const code=String(pfc?.primary||'').toUpperCase(),lower=name.toLowerCase();
 const incoming=amount<0,card=account.type==='credit';
 const obligation=Categorization?.loanBill?.({merchant:name,personal_finance_category:pfc});
 // External mortgage and other bank-coded loan installments are cash bills,
 // NOT internal account transfers. Card settlements remain transfers.
 const payment=/\b(payment thank you|autopay payment|payment received|credit card payment|card payment|payment to .*card)\b/i.test(name)||
   code==='LOAN_PAYMENTS'&&obligation?.isCardSettlement;
 const earned=incoming&&!card&&Accounting?.recognizedIncome?.({
  merchant:name,personal_finance_category:pfc,source:{plaidAmount:amount}
 },account);
 const transfer=!earned&&(/^(?:TRANSFER_IN|TRANSFER_OUT)$/.test(code)||
  lower.includes('transfer to ')||lower.includes('transfer from ')||payment);
 const type=transfer?'transfer':incoming&&(card||obligation?.isBill)?'refund':incoming?'income':'expense';
 const row={id:String(t.id),date:t.date,merchant:name,description:'Bank-imported transaction',amount:Math.abs(amount),
  type,account:account.name,accountId:account.id,pending:!!t.pending,category:'Other',
  ...(transfer?{cashDirection:incoming?'in':'out'}:{}),personal_finance_category:pfc,
  source:{provider:'plaid',verified:true,itemId:account.itemId||'connected-bank-item',
   providerTransactionId:String(t.id),accountId:account.id,plaidAmount:amount,personalFinanceCategory:pfc,
   categoryConfidence:pfc?.confidence_level==='VERY_HIGH'?.99:pfc?.confidence_level==='HIGH'?.93:0}};
 const classification=Categorization?.classify(row);
 if(!transfer&&classification?.category&&classification.category!=='Other'){
  row.category=classification.category;
  row.categoryConfidence=classification.confidence;
  row.source.categoryOrigin=classification.method;
 }
 return row;
}
function prepare(payload,asOf=today()){
 const banks=Array.isArray(payload.accounts)&&payload.accounts.length?payload.accounts:payload.account?[payload.account]:[];
 if(!payload.connected||!banks.length)throw Error('Connect at least one bank account under Bank Connection');
 const byId=new Map(banks.map(a=>[String(a.id),a]));
 const rows=(payload.transactions||[]).map(t=>{
  const bank=byId.get(String(t.accountId||t.account_id||''))||(banks.length===1?banks[0]:null);
  return bank?record(t,bank):null;
 }).filter(Boolean);
 const adjustments=payload.adjustments||{};
 const state=DataModel.migrate({
  transactions:rows,items:[],
  accounts:banks.map(a=>({id:a.id,name:a.name,type:a.type,subtype:a.subtype,
   institution:'Connected via Plaid',itemId:a.itemId||'connected-bank-item'})),
  ...Object.fromEntries(['categoryOverrides','predictions','reviews','learning','customCategories']
   .filter(k=>adjustments[k]!==undefined).map(k=>[k,adjustments[k]]))
 });
 const snapshot={asOf,mode:'plaid',connected:true,source:'Plaid bank-reported balances',
  lastSuccessfulSync:payload.lastSync,expectedAccountIds:banks.map(a=>a.id),
  accounts:banks.map(a=>({id:a.id,name:a.name+(a.mask?' ••'+a.mask:''),
   accountType:a.type==='credit'?'credit':a.subtype==='savings'?'savings':'checking',
   type:a.type,subtype:a.subtype,transactionAccount:a.name,current:a.current??null,
   available:a.available??null,balanceAsOf:a.balanceObservedAt||null,
   currency:a.currency||'USD',simulated:false}))};
 return {state,snapshot,preparedForecast:payload.preparedForecast||null,account:banks[0],accounts:banks,
  reconnectAccounts:Array.isArray(payload.reconnectAccounts)?payload.reconnectAccounts:[]};
}
async function enter(){
 if(loading)return;serverRevision='';loading=true;lastError='';lastErrorKind='bank';localStorage.setItem(MODE,'real');
 // The last preference is Real: do not briefly show fictional balances or
 // "bank not connected" while the authenticated bank snapshot loads.
 host.render();
 try{
  const data=prepare(await request(''));
  host.enterReal(data.state,data.snapshot,data.preparedForecast);
  loadedAccount=data.account;live=true;
  if(data.reconnectAccounts.length)lastError=reconnectMessage;
  localStorage.setItem(MODE,'real');
 }catch(e){
  // Never silently show fictional balances after an explicit Real choice.
  lastError=e.message;live=false;loadedAccount=null;
  if(typeof host.enterUnavailable==='function'){
   host.enterUnavailable();localStorage.setItem(MODE,'real');
  }else{
   host.enterDemo();localStorage.setItem(MODE,'demo');
  }
 }
 finally{loading=false;host.render()}
}
async function refresh(){
 if(loading||!live)return;
 loading=true;lastError='';lastErrorKind='bank';host.render();
 try{
  // Finish the user's category and schedule writes before retrieving a new
  // server state, otherwise the screen could overwrite their latest decision.
  await writeQueue;
  const response=await fetch('/api/sync',{method:'POST',cache:'no-store',
   headers:{'X-Pilot-Action':'1','Content-Type':'application/json'},body:'{}'});
  const result=await response.json();
  if(!response.ok){
   const error=new Error(result?.error||'The bank could not complete this sync');
   error.code=result?.code||'';throw error;
  }
  const updated=prepare(await request(''));
  host.enterReal(updated.state,updated.snapshot,updated.preparedForecast);
  loadedAccount=updated.account;
  lastError=updated.reconnectAccounts.length?reconnectMessage:'';
 }catch(e){
  lastError=e.code==='ITEM_LOGIN_REQUIRED'?reconnectMessage:
   'Bank refresh failed: '+e.message+'. Check Bank connections and try again.';
 }
 finally{loading=false;host.render()}
}
function demo(){
 live=false;loadedAccount=null;lastError='';lastErrorKind='bank';localStorage.setItem(MODE,'demo');
 host.enterDemo();host.render();
}
function panel(){
 return '<section class="panel settings-block" aria-label="Ledger data source">'+
  '<h3>Data source</h3><label for="ledger-mode-switch">Choose your data</label>'+
  '<select id="ledger-mode-switch" aria-label="Choose demo or real data source"'+(loading?' disabled':'')+'>'+
   '<option value="demo"'+(!live&&!loading?' selected':'')+'>Demo / simulated</option>'+
   '<option value="real"'+(live||loading?' selected':'')+'>Real / Plaid</option></select>'+
  '<p>Both modes show the same focused balance planner. Bank transactions and balances remain read-only; only future projections change.</p>'+
  '<p>Real data is stored on the private server, separate from fictional data. Only your mode preference is stored on this device.</p>'+
  '<a href="/bank-connect">Connect, sync or disconnect bank account</a>'+statusText()+'</section>';
}
function persistCategory(transactionId,category,remember=false){
 if(!live)return Promise.reject(new Error('Connect Real Bank mode to save a private category'));
 const task=writeQueue.catch(()=>{}).then(()=>request('/category',{
  transactionId:String(transactionId),category,...(remember?{remember:true}:{})
 }));
 writeQueue=task.catch(()=>{});
 return task.then(result=>{
  if(!result||result.saved!==true||result.scope!=='category')
   throw Error('Bank category change was not acknowledged');
  lastError='';return result;
 });
}
function deleteCategory(category){
 if(!live)return Promise.reject(new Error('Connect Real Bank mode to delete a category'));
 const task=writeQueue.catch(()=>{}).then(()=>request('/categories/delete',{category:String(category)}));
 writeQueue=task.catch(()=>{});
 return task.then(result=>{
  if(!result||result.saved!==true||result.scope!=='category-deletion')
   throw Error('Category deletion was not acknowledged by the private server');
  lastError='';return result;
 });
}
function renameCategory(from,to){
 if(!live)return Promise.reject(new Error('Connect Real Bank mode to rename a category'));
 const task=writeQueue.catch(()=>{}).then(()=>request('/categories/rename',{
  from:String(from),to:String(to)
 }));
 writeQueue=task.catch(()=>{});
 return task.then(result=>{
  if(!result||result.saved!==true||result.scope!=='category-rename')
   throw Error('Category rename was not acknowledged by the private server');
  lastError='';return result;
 });
}
function forgetCategoryRule(ruleKey){
 if(!live)return Promise.reject(new Error('Connect Real Bank mode to remove a learned category'));
 const task=writeQueue.catch(()=>{}).then(()=>request('/category-rule',{ruleKey:String(ruleKey)}));
 writeQueue=task.catch(()=>{});
 return task.then(result=>{
  if(!result||result.saved!==true||result.scope!=='category-rule')
   throw Error('Removing the learned category was not acknowledged');
  lastError='';return result;
 });
}
function persistForecast(predictions){
 if(!live)return Promise.reject(new Error('Connect Real Bank mode to save private forecast settings'));
 // Snapshot immediately, before a user can make another forecast edit.
 // Encrypted planning preferences are distinct from the read-only source
 // bank transactions and from historical category corrections.
 const body={predictions:JSON.parse(JSON.stringify(predictions||{}))};
 const task=writeQueue.catch(()=>{}).then(()=>request('/forecasts',body));
 // A failed forecast save must reject its own action, but should not poison
 // unrelated subsequent bank refreshes or later successful forecast saves.
 writeQueue=task.catch(()=>{});
 return task.then(result=>{
  if(!result||result.saved!==true||result.scope!=='predictions')
   throw Error('The forecast update was not acknowledged');
  lastError='';
  return result;
 }).catch(error=>{
  // Forecast-validation errors are NOT Plaid login problems.
  lastErrorKind='save';
  lastError='The predicted transaction could not be saved: '+error.message;
  throw new Error(lastError);
 });
}
function persist(data){
 if(!live)return;
 const body={categoryOverrides:data.categoryOverrides||{},predictions:data.predictions||{},
  reviews:data.reviews||{},learning:data.learning||{},customCategories:data.customCategories||[]};
 // Capture this exact snapshot; serialize writes so rapid edits cannot reverse their order.
 writeQueue=writeQueue.catch(()=>{}).then(()=>request('/adjustments',body)).catch(e=>{
  lastErrorKind='save';
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
if(typeof module!=='undefined'&&module.exports)module.exports={record,prepare};
root.HouseholdLiveSource={bind,panel,warningBanner,persist,persistForecast,persistCategory,deleteCategory,renameCategory,forgetCategoryRule,enterReal:enter,refresh,mode:selection,
 get loading(){return loading},get error(){return lastError}};
})(typeof window!=='undefined'?window:globalThis);
