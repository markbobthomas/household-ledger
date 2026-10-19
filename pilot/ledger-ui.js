/* Same-origin, read-only live Plaid status. Never store real bank transactions in localStorage. */
(function(){
 'use strict';
 const escapeText=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
 const dollars=n=>n===null||n===undefined?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
 let current=null,pending=false;
 async function update(){
  if(pending)return;pending=true;
  try{const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error('Cannot read secure bank connection');current=await r.json()}
  catch(e){current={error:'Bank connection unavailable'}; }
  finally{pending=false;paint()}
 }
 function paint(){
  const mount=document.querySelector('#real-account-status');if(!mount)return;
  if(!current){mount.textContent='Checking bank connection…';return}
  if(current.error){mount.textContent=current.error;return}
  if(!current.connected){mount.innerHTML='<p>No real bank connected yet. Fictional demonstration data below remains separate.</p><p><a href="/bank-connect">Connect one checking account securely</a></p>';return}
  const a=current.account;
  mount.innerHTML='<div><strong>'+escapeText(a?.name||'Checking account')+'</strong> · Bank-reported current balance: <strong>'+dollars(a?.current)+'</strong></div>'+
   '<p>Bank-reported available balance: '+dollars(a?.available)+' · Retrieved '+escapeText(a?.balanceObservedAt||'unknown')+'</p>'+
   '<p>Imported transactions: '+Number(current.transactions?.length||0)+' · <a href="/bank-connect">View transactions, refresh or disconnect</a></p>'+
   '<p class="prediction-note">These values come directly from Plaid. The fictional forecast below does not use or adjust this bank balance.</p>';
 }
 function place(){
  if(!document.querySelector('#real-account-status')){
   const container=document.createElement('section');container.className='panel';container.setAttribute('aria-label','Real checking account');
   container.innerHTML='<div class="section-top"><h3>Real checking account</h3><span class="budget-summary-meta">Read-only Plaid report</span></div><div id="real-account-status">Checking bank connection…</div>';
   const view=document.querySelector('#view');
   if(view&&document.querySelector('#title')?.textContent==='Overview')view.prepend(container);
   else if(view&&document.querySelector('#title')?.textContent==='Settings')view.prepend(container);
   else return;
  }
  paint();
 }
 const observer=new MutationObserver(()=>{if(!document.querySelector('#real-account-status')&&['Overview','Settings'].includes(document.querySelector('#title')?.textContent))place()});
 document.addEventListener('DOMContentLoaded',()=>{observer.observe(document.querySelector('#view'),{childList:true});place();update()});
})();
