/* Persistent, read-only-bank-derived repeating recommendations.
 * Nothing here creates a future payment. Only an approved repeating rule does.
 */
(function(root){
'use strict';
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const idFor=(accountId,type,merchant,phase='')=>
 'recommend|'+[accountId,type,norm(merchant),phase].map(encodeURIComponent).join('|');
const phaseFor=series=>{
 const m=String(series||'').match(/every-4-weeks\|phase(\d+)/);
 return m?'28-day-phase-'+m[1]:'';
};
const valid=x=>x&&typeof x==='object'&&!Array.isArray(x)&&x.accountId&&x.merchant&&
 ['income','expense'].includes(x.type);
function discover(bundle={}){
 const found=new Map();
 const add=(raw,source)=>{
  if(!valid(raw))return;
  const phase=raw.phase||phaseFor(raw.seriesKey||raw._seriesKey);
  const key=idFor(raw.accountId,raw.type,raw.merchant,phase);
  const examples=(raw.examples||[]).map(x=>typeof x==='string'?{id:x}:x)
   .filter(x=>x&&x.id).slice(0,8);
  const candidate={key,accountId:String(raw.accountId),accountName:String(raw.accountName||raw.accountId),
   merchant:String(raw.merchant),type:raw.type,category:String(raw.category||'Other'),
   frequency:String(raw.frequency||raw.cadence||'monthly'),
   amount:Number(raw.amount||0),nextDate:String(raw.nextDate||raw.date||''),
   lastDate:String(raw.lastDate||''),phase,examples,
   occurrences:Number(raw.occurrences||examples.length||1),source,
   confidence:String(raw.confidence||'Needs confirmation')};
  const old=found.get(key);
  if(!old||source==='strong'||source==='history'&&old.source==='weak'){
   if(old&&candidate.examples.length===0)candidate.examples=old.examples;
   found.set(key,candidate);
  }
 };
 // Potential repeated payments include strong, formerly auto-forecasted
 // patterns as well as weaker ones. Every one now requires approval.
 const groups=new Map();
 for(const e of bundle.automaticRecurrence?.events||[]){
  if(!e||!['income','expense'].includes(e.type))continue;
  const phase=phaseFor(e._seriesKey);
  const key=idFor(e.accountId,e.type,e.merchant,phase);
  const old=groups.get(key);
  if(!old||e.date<old.date)groups.set(key,e);
 }
 for(const e of groups.values())add({accountId:e.accountId,merchant:e.merchant,
  type:e.type,category:e.category,frequency:e.cadence,amount:e.amount,date:e.date,
  _seriesKey:e._seriesKey,examples:(e.historicalIds||[]).map(id=>({id})),
  confidence:'Detected pattern'},'strong');
 for(const e of bundle.historyCandidates||[])add(e,'weak');
 // Historical candidate discovery catches a broader set of single/irregular
 // bills. Keep them visible too; they are NOT approved forecasts.
 for(const e of bundle.bankRecommendationCandidates||[])add(e,'history');
 return [...found.values()];
}
function reconcile(existing={},bundle={},rules=[],records=[],accounts=[]){
 const stored=existing&&typeof existing==='object'&&!Array.isArray(existing)?existing:{};
 const next={...stored},bank=records||[],all=discover(bundle);
 let changed=false;
 for(const candidate of all){
  const old=next[candidate.key];
  if(!old){
   next[candidate.key]={...candidate,decision:'pending'};
   changed=true;
  }else{
   const fresh={...old,
    // Preserve decision and prior clues. New bank evidence may refine the
    // suggested date/amount, but old recommendations never disappear.
    ...candidate,decision:old.decision==='ignored'?'ignored':'pending',
    examples:candidate.examples.length?candidate.examples:old.examples||[]};
   if(JSON.stringify(fresh)!==JSON.stringify(old)){next[candidate.key]=fresh;changed=true}
  }
 }
 const recordsById=new Map(bank.map(t=>[String(t.id),t]));
 const items=Object.values(next).filter(valid).map(r=>{
  const example=(r.examples||[]).map(x=>recordsById.get(String(x.id))).find(Boolean);
  const matched=example&&root.HouseholdPlannerTransactions?.historicalScheduleMatches(
   example,accounts,rules)||[];
  const exact=rules.filter(rule=>
   String(rule.originalAccountId||rule.accountId)===String(r.accountId)&&
   rule.type===r.type&&
   [rule.originalMerchant,rule.merchant,...(rule.matchNames||[])]
    .some(name=>norm(name)===norm(r.merchant))&&
   (!r.phase||rule.frequency==='every-4-weeks'&&
    (r.examples||[]).some(x=>(rule.exampleIds||[]).includes(String(x.id)))));
  const scheduled=matched.length||exact.length;
  return {...r,decision:scheduled?'scheduled':r.decision==='ignored'?'ignored':'pending',
   scheduleIds:[...new Set([...matched,...exact].map(x=>x.id))]};
 }).sort((a,b)=>{
  const rank=x=>x.decision==='pending'?0:x.decision==='ignored'?1:2;
  return rank(a)-rank(b)||
   (a.source==='strong'?-1:1)-(b.source==='strong'?-1:1)||
   String(b.nextDate||'').localeCompare(String(a.nextDate||''))||
   a.merchant.localeCompare(b.merchant);
 });
 return {stored:next,items,changed};
}
function setIgnored(state,key,ignored){
 const p=state?.predictions||{};
 const item=p.recurringRecommendations?.[key];
 if(!item)throw Error('The recommendation is no longer available');
 p.recurringRecommendations[key]={...item,decision:ignored?'ignored':'pending'};
 return p.recurringRecommendations[key];
}
const api={discover,reconcile,setIgnored,idFor};
root.HouseholdRepeatingRecommendations=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
