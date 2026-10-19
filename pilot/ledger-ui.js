/* Private live Ledger: explicit display modes. Real financial facts are never copied to localStorage. */
(function(){
'use strict';
const KEY='household-ledger-view-mode';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
const money=n=>n===null||n===undefined||!Number.isFinite(Number(n))?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n));
let current=null,mode=localStorage.getItem(KEY)==='real'?'real':'demo',busy=false;
async function reload(){
 if(busy)return;busy=true;
 try{const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok||!(r.headers.get('content-type')||'').includes('application/json'))throw Error('Private bank service unavailable');current=await r.json()}
 catch{current={error:'Bank connection unavailable'};}finally{busy=false;draw()}
}
function safeReal(){
 const a=current?.account;
 return !!(current?.connected&&a&&a.current!==null&&a.current!==undefined&&Number.isFinite(Number(a.current)));
}
function details(tab){
 if(current?.error)return '<p role="status">'+esc(current.error)+'</p>';
 if(!current?.connected)return '<p>No real account connected. <a href="/bank-connect">Connect one bank account</a>.</p>';
 const a=current.account;
 const head='<p><strong>'+esc(a?.name||'Bank account')+'</strong> · Bank-reported current balance <strong>'+money(a?.current)+'</strong></p>'+
  '<p>Bank-reported available balance '+money(a?.available)+' · Retrieved '+esc(a?.balanceObservedAt||'unknown')+'</p>'+
  '<p>'+Number(current.transactions?.length||0)+' imported transactions · <a href="/bank-connect">Refresh or disconnect</a></p>';
 const t=current.transactions||[];
 if(tab==='Transactions'){
  return head+'<div class="cash-table-wrap"><table class="cash-table"><thead><tr><th>Posted date</th><th>Merchant</th><th>Bank amount</th><th>Status</th></tr></thead><tbody>'+
   t.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.merchant)+'</td><td>'+money(x.amount)+'</td><td>'+esc(x.pending?'Pending':'Posted')+'</td></tr>').join('')+
   '</tbody></table></div><p class="prediction-note">Only transactions from the connected bank account. Pending transactions are identified, not included as posted spending.</p>';
 }
 return head+'<p class="prediction-note">Exact Plaid-reported balance, not reconstructed from transactions. Plaid may lag your bank.</p>';
}
const CATEGORY_MAP={FOOD_AND_DRINK:'Dining',GENERAL_MERCHANDISE:'Shopping',HOME_IMPROVEMENT:'Housing',RENT_AND_UTILITIES:'Housing',TRANSPORTATION:'Transportation',TRAVEL:'Transportation',ENTERTAINMENT:'Entertainment',MEDICAL:'Health',PERSONAL_CARE:'Health',BANK_FEES:'Fees',GOVERNMENT_AND_NON_PROFIT:'Other',GENERAL_SERVICES:'Services',LOAN_PAYMENTS:'Debt payments'};
const TRANSFER_CATEGORIES=new Set(['TRANSFER_IN','TRANSFER_OUT','INCOME']);
const CAP_KEY='household-ledger-real-budget-caps-v1';
function caps(){try{const v=JSON.parse(localStorage.getItem(CAP_KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}catch{return {}}}
function categorized(t){
 const raw=t.category||{},primary=String(raw.primary||'').toUpperCase(),detail=String(raw.detailed||'').toUpperCase();
 if(detail.includes('GROCER'))return 'Groceries';
 if(detail.includes('RESTAURANT')||detail.includes('COFFEE'))return 'Dining';
 if(detail.includes('UTILIT'))return 'Utilities';
 if(detail.includes('INSURANCE'))return 'Insurance';
 if(detail.includes('CHILDCARE'))return 'Kids & Family';
 if(detail.includes('SUBSCRIPTION'))return 'Subscriptions';
 if(TRANSFER_CATEGORIES.has(primary)||primary.startsWith('TRANSFER_'))return 'Transfer / non-spending';
 return CATEGORY_MAP[primary]||'Needs review';
}
function verifiedRows(){
 if(!current?.connected)return [];
 return (current.transactions||[]).filter(t=>!t.pending&&/^\\d{4}-\\d{2}-\\d{2}$/.test(String(t.date))&&Number.isFinite(Number(t.amount))).map(t=>({...t,bucket:categorized(t)}));
}
function spentRows(month){
 return verifiedRows().filter(t=>t.date.startsWith(month)&&Number(t.amount)>0&&t.bucket!=='Transfer / non-spending');
}
function realBudget(){
 if(!current?.connected)return '<section class="panel">Connect a bank account before using real budgets.</section>';
 const month=new Date().toISOString().slice(0,7),rows=spentRows(month),settings=caps();
 const groups=[...new Set([...rows.map(t=>t.bucket),...Object.keys(settings)])].sort();
 const spent=rows.reduce((n,t)=>n+Number(t.amount),0),limit=Object.values(settings).reduce((n,x)=>n+(Number(x)>0?Number(x):0),0),percent=limit?Math.min(100,spent/limit*100):0;
 const line=(name)=>{
  const amount=rows.filter(t=>t.bucket===name).reduce((n,t)=>n+Number(t.amount),0),cap=Number(settings[name])||0,pct=cap?Math.min(100,amount/cap*100):0;
  return '<div class="budget-entry"><div class="budget-heading"><strong>'+esc(name)+'</strong><strong>'+money(amount)+'</strong></div>'+
   '<div class="budget-progress" role="img" aria-label="'+esc(name)+' spent '+money(amount)+' of '+money(cap)+'"><i class="actual" style="width:'+pct.toFixed(2)+'%"></i></div>'+
   '<label>Monthly cap for '+esc(name)+' <input type="number" inputmode="decimal" min="0" step="0.01" data-real-budget="'+esc(name)+'" value="'+(cap||'')+'" placeholder="Not set"></label></div>';
 };
 return '<section class="panel" aria-label="Real overall budget"><div class="section-top"><h3>Overall budget · '+esc(month)+'</h3><strong>'+money(spent)+' spent</strong></div>'+
  '<div class="budget-progress" role="img" aria-label="Overall real budget '+money(spent)+' spent of '+money(limit)+'"><i class="actual" style="width:'+percent.toFixed(2)+'%"></i></div>'+
  '<div class="budget-heading"><span>Total caps '+money(limit)+'</span><span>'+rows.length+' posted spending transactions</span></div>'+
  '<p class="prediction-note">Real posted transactions only; pending charges and identified transfers excluded. No forecast or fictional spending included. Caps are separate from demo budgets.</p></section>'+
  '<section class="panel" aria-label="Real category budgets"><h3>Spending by category</h3>'+(groups.map(line).join('')||'<p>No posted spending in this month yet.</p>')+
  '<p class="prediction-note">Categories are preliminary. Uncertain transactions stay in Needs review rather than being guessed. Edit caps above; no bank transaction changes.</p></section>';
}
function realInsights(){
 if(!current?.connected)return '<section class="panel">Connect a bank account first.</section>';
 const rows=verifiedRows().filter(t=>Number(t.amount)>0&&t.bucket!=='Transfer / non-spending'),groups={};
 for(const t of rows){const name=t.bucket;groups[name]=(groups[name]||0)+Number(t.amount)}
 return '<section class="panel"><h3>Real spending insights · all imported dates</h3><p class="prediction-note">Posted purchases only. No demo records or predicted spending.</p>'+
  Object.entries(groups).sort((a,b)=>b[1]-a[1]).map(([name,value])=>'<div class="row"><strong>'+esc(name)+'</strong><strong>'+money(value)+'</strong></div>').join('')+
  '</section>';
}
function realReviews(){
 const pending=(current?.transactions||[]).filter(t=>t.pending);
 const uncertain=verifiedRows().filter(t=>t.bucket==='Needs review');
 return '<section class="panel"><h3>Real bank reviews</h3><p>'+uncertain.length+' posted transaction(s) need category review · '+pending.length+' pending transaction(s) excluded from spending.</p>'+
  uncertain.map(t=>'<div class="row"><span>'+esc(t.date)+' · '+esc(t.merchant)+'</span><strong>'+money(t.amount)+'</strong></div>').join('')+
  '<p class="prediction-note">Bank values cannot be edited here. Category overrides are not yet enabled for real records.</p></section>';
}
function realView(tab){
 if(tab==='Budgets')return realBudget();
 if(tab==='Insights')return realInsights();
 if(tab==='Reviews')return realReviews();
 return '';
}
function draw(){
 const view=document.querySelector('#view'),tab=document.querySelector('#title')?.textContent;
 if(!view||!tab)return;
 const active=mode==='real',connected=!!current?.connected;
 let overlay=document.querySelector('#real-mode-surface');
 if(overlay)overlay.remove();
 // Keep original application state untouched. Hide, never reclassify or copy demo data.
 const existing=view.children;
 for(const child of existing)child.hidden=active;
 if(active){
  overlay=document.createElement('div');overlay.id='real-mode-surface';overlay.setAttribute('data-real-view','');
  if(['Overview','Transactions','Settings'].includes(tab)){
   overlay.innerHTML='<section class="panel" aria-label="Real checking account"><div class="section-top"><h3>Real bank account · Plaid</h3><span class="budget-summary-meta">Read-only</span></div>'+
    details(tab)+'</section>'+(tab==='Settings'?settingsControl():'');
  }else overlay.innerHTML=realView(tab);
  view.prepend(overlay);
 }else if(tab==='Settings'){
  overlay=document.createElement('div');overlay.id='real-mode-surface';overlay.innerHTML=settingsControl();view.prepend(overlay);
 }
 document.querySelectorAll('[data-real-budget]').forEach(input=>input.onchange=()=>{const value=Number(input.value),name=input.dataset.realBudget;if(!Number.isFinite(value)||value<0)return alert('Enter a nonnegative budget amount');const limits=caps();if(value>0)limits[name]=Math.round(value*100)/100;else delete limits[name];localStorage.setItem(CAP_KEY,JSON.stringify(limits));draw()});
 const button=document.querySelector('#ledger-mode-switch');
 if(button)button.addEventListener('change',e=>{
  const requested=e.target.value;
  if(requested==='real'&&!connected){e.target.value='demo';alert('Connect your bank first before choosing Real data.');return}
  mode=requested;localStorage.setItem(KEY,mode);draw();
 });
}
function settingsControl(){
 return '<section class="panel" aria-label="Data mode settings"><div class="section-top"><h3>Data mode</h3><span class="budget-summary-meta">'+(mode==='real'?'REAL BANK':'SIMULATED')+'</span></div>'+
  '<label for="ledger-mode-switch">Show data from</label> <select id="ledger-mode-switch" aria-label="Choose demo or real bank data">'+
  '<option value="demo"'+(mode==='demo'?' selected':'')+'>Demo / simulated data</option>'+
  '<option value="real"'+(mode==='real'?' selected':'')+'>Real bank data</option></select>'+
  '<p class="prediction-note">This switches what is displayed. It does not change, combine or delete bank records. Real budgeting and forecasts will stay unavailable until they are verified.</p>'+
  '<p><a href="/bank-connect">Manage bank connection</a></p></section>';
}
const observer=new MutationObserver(()=>{const v=document.querySelector('#view');if(!v)return;const surface=document.querySelector('#real-mode-surface');const tab=document.querySelector('#title')?.textContent;if(mode==='real'||tab==='Settings'){if(!surface||surface.parentElement!==v)draw()}else if(surface&&surface.parentElement!==v)draw()});
document.addEventListener('DOMContentLoaded',()=>{
 observer.observe(document.querySelector('#view'),{childList:true});
 draw();reload();
});
})();
