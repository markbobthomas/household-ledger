/* Full Ledger only. Separate paid category AI from financial analysis.
 * Never start a provider request in a shared Lite session or without an
 * authenticated, enabled and cost-checked owner page load.
 */
(function(){
'use strict';
if(!window.HouseholdLiveSource)return;
let settings=null,revision='',started=false,loading=false;
const statusText=msg=>{
 let el=document.getElementById('ledger-category-ai-progress');
 if(!el){
  el=document.createElement('div');el.id='ledger-category-ai-progress';
  el.setAttribute('role','status');el.setAttribute('aria-live','polite');
  el.style.cssText='margin:8px 16px;font-size:13px;color:#37516c;';
  document.querySelector('.main-navigation')?.after(el);
 }
 if(el)el.textContent=msg;
};
async function api(path,body,withRevision=false){
 const res=await fetch('/api/ledger/category-automation'+path,{
  method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
  headers:body===undefined?{}:{
   'Content-Type':'application/json','X-Pilot-Action':'1',
   ...(withRevision&&revision?{'X-Ledger-Revision':revision}:{})
  },
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(data.error||'Categorization request failed');
 const next=res.headers.get('x-ledger-revision');
 if(next&&/^[a-f0-9]{64}$/i.test(next))revision=next;
 return data;
}
async function syncSettings(){
 settings=await api('');
 paint();
 return settings;
}
function paint(){
 const root=document.getElementById('ledger-category-ai-controls');
 if(!root||!settings)return;
 root.innerHTML='';
 const heading=document.createElement('h2');heading.textContent='Categorization';root.append(heading);
 const caption=document.createElement('p');caption.textContent=
  'These controls apply to all purchases, not just Amazon. Your existing manual decisions are never overwritten.';
 root.append(caption);
 for(const [id,label,desc] of [
  ['automatic','Automatic categorization','When off, purchases without human confirmation go to Lite, even if the bank suggested a category.'],
  ['ai','AI categorization','Paid AI runs once when you open Full Ledger. Off stops all new categorization API requests.']
 ]){
  const row=document.createElement('div');row.style.cssText=
   'display:flex;justify-content:space-between;align-items:center;gap:12px;margin:14px 0;';
  const copy=document.createElement('div');
  const strong=document.createElement('strong');strong.textContent=label;
  const small=document.createElement('p');small.textContent=desc;small.style.cssText='font-size:13px;margin:4px 0;';
  copy.append(strong,small);
  const button=document.createElement('button');button.type='button';button.className='btn';
  button.dataset.categorySetting=id;button.textContent=settings[id]?'ON':'OFF';
  button.setAttribute('aria-pressed',String(settings[id]));
  button.setAttribute('aria-label',label+': '+button.textContent+'. Click to turn '+(settings[id]?'off':'on'));
  button.style.cssText='min-width:68px;min-height:44px;white-space:nowrap;font-weight:700;';
  row.append(copy,button);root.append(row);
 }
 const status=document.createElement('p');status.style.cssText='font-size:13px;color:#526071;';
 status.textContent='AI already examined '+settings.reviewed+' purchases; '+settings.unavailable+
  ' could not be confidently identified.'+
  (settings.interrupted?' '+settings.interrupted+' interrupted attempts require manual attention.':'')+
  (!settings.available?' AI provider is not configured.':'');
 root.append(status);
}
function mount(){
 const page=document.querySelector('.settings-page');
 if(!page||page.querySelector('#ledger-category-ai-controls'))return;
 const root=document.createElement('section');root.className='panel';
 root.id='ledger-category-ai-controls';root.setAttribute('aria-label','Categorization automation settings');
 (page.querySelector('.page-heading')||page).after(root);
 if(!loading){loading=true;syncSettings().catch(err=>{
  root.textContent='Categorization controls unavailable: '+err.message;
 }).finally(()=>{loading=false})}
 else paint();
}
const target=document.getElementById('planner-main');
if(target)new MutationObserver(()=>mount()).observe(target,{childList:true,subtree:false});
document.addEventListener('click',async ev=>{
 const button=ev.target.closest?.('[data-category-setting]');
 if(!button||!settings||loading)return;
 const key=button.dataset.categorySetting;
 if(!['automatic','ai'].includes(key))return;
 loading=true;button.disabled=true;
 try{
  const saved=await api('',{action:'set',automatic:key==='automatic'?!settings.automatic:settings.automatic,
   ai:key==='ai'?!settings.ai:settings.ai},true);
  settings={...settings,...saved};
  paint();
  statusText('Categorization settings saved.'+(key==='ai'&&saved.ai?
   ' AI will check unreviewed purchases the next time you open Ledger.':''));
 }catch(err){statusText('Could not save categorization settings: '+err.message)}
 finally{loading=false;button.disabled=false}
});
async function onLoaded(){
 if(started)return;started=true;
 try{
  const plan=await api('/plan');
  if(!plan.enabled||!plan.count)return;
  let approved=false;
  if(plan.requiresApproval){
   // Explicit per-run user gesture; approval is never persisted.
   approved=window.confirm('AI categorization can review '+plan.count+
    ' new purchases.\nEstimated maximum API cost: $'+plan.maximumUsd.toFixed(4)+
    '.\n\nThis exceeds your $0.08 automatic approval limit. Approve this run?');
   if(!approved){statusText('AI review skipped. Purchases remain available next time.');return}
  }
  statusText('AI categorization: reviewing '+plan.count+' previously unchecked purchases…');
  const result=await api('/run',{planHash:plan.planHash,approved,
   maximumUsd:approved?plan.maximumUsd:0},true);
  statusText('AI checked '+result.reviewed+' purchases: '+result.assigned+
   ' categorized, '+result.suggested+' suggested, '+result.unable+
   ' left for manual review.'+
   (result.remaining?' '+result.remaining+' deferred.':''));
  if(result.assigned)await window.HouseholdLiveSource.enterReal();
  await syncSettings().catch(()=>{});
 }catch(err){statusText('AI categorization did not finish: '+err.message)}
}
document.addEventListener('ledger-full-loaded',()=>{onLoaded()},{once:true});
})();
