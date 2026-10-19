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
function realView(tab){
 if(tab==='Budgets'||tab==='Insights'||tab==='Reviews'){
  return '<section class="panel" aria-label="Real data status"><h3>'+esc(tab)+' · Real data</h3>'+
   '<p>Real-account '+esc(tab.toLowerCase())+' calculations are not enabled yet. Demo totals have been hidden so no fictional data can be mistaken for real spending.</p>'+
   '<p>Connect and verify bank transactions first. <a href="/bank-connect">Inspect the connected account</a>.</p></section>';
 }
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
