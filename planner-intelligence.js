/* Focused bank balance planner: only repeatable dated obligations and paychecks.
 * The old spending detector is useful for candidate dates, but general spending
 * forecasts are not suitable for the user's checking cash commitments.
 *
 * This layer never changes a posted bank record. Confirm/reject is saved as a
 * reusable decision per account + merchant; a changed payment amount reopens
 * review rather than silently reusing stale confidence.
 */
(function(root){
'use strict';
const DAY=86400000;
const cents=n=>Math.round(Number(n)*100);
const monthIndex=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7));
const lastDay=s=>new Date(Date.UTC(Number(s.slice(0,4)),Number(s.slice(5,7)),0)).getUTCDate();
const clean=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const gap=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/DAY);
const account=t=>String(t.accountId||t.account||'');
const routineCategory=new Set(['Housing','Insurance','Subscriptions','Utilities','Kids & Family']);
const billDescription=/\b(?:mortgage|rent|home loan|mtg|loan payment|auto loan|car payment|insurance|premium|subscription|membership|internet|electric|water|sewer|utility|daycare|tuition|cellular|phone plan)\b/i;
const irregularName=/\b(?:costco|safeway|walmart|target|amazon|grocery|groceries|fuel|restaurant|coffee|starbucks|shell|chevron|uber|lyft)\b/i;
function identity(event){
 const slot=event.slot!==undefined&&String(event.cadence||'').toLowerCase()==='twice monthly'?'|slot:'+String(event.slot):'';
 return [event.type,account(event),clean(event.merchant)].join('|')+slot;
}
function baseIdentity(event){return [event.type,account(event),clean(event.merchant)].join('|')}
function periodic(name,category,sourcePfc){
 const p=sourcePfc||{},primary=String(p.primary||'').toUpperCase(),detailed=String(p.detailed||'').toUpperCase();
 const named=billDescription.test(String(name||''));
 if(irregularName.test(String(name||''))&&!named&&primary!=='SUBSCRIPTIONS')return false;
 return routineCategory.has(String(category))||named||primary==='SUBSCRIPTIONS'||
  /(?:SUBSCRIPTION|RECURRING|INSURANCE|UTILITIES|RENT|MORTGAGE|LOAN_PAYMENT)/.test(detailed);
}
function scan(records,asOf){
 const groups=new Map();
 for(const t of records||[]){
  if(!t||t.pending||!validDate(t.date)||t.date>asOf||!['income','expense'].includes(t.type)||
   !(Number(t.amount)>0)||!account(t))continue;
  const key=baseIdentity(t);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(t);
 }
 for(const group of groups.values())group.sort((a,b)=>a.date.localeCompare(b.date));
 return groups;
}
function stableEvidence(group,event,asOf){
 if(!Array.isArray(group)||group.length<3)return {stable:false,reason:'fewer than three observed transactions'};
 // Use only most recent three (or more) observations. Latest payments must
 // be close in time and identical down to the cent.
 let recent=group.slice(-8);
 const cadence=String(event.cadence||'').toLowerCase();
 if(cadence==='twice monthly'){
  // A 1st-and-15th paycheck must be compared with the SAME calendar slot
  // over three months, not with alternating monthly paychecks.
  const expectedDay=Number(event.date.slice(-2));
  recent=group.filter(t=>Math.abs(Number(t.date.slice(-2))-expectedDay)<=3).slice(-6);
 }
 if(recent.length<3)return {stable:false,reason:'fewer than three matching pay dates'};
 const last=recent.slice(-3),amount=cents(last[0].amount);
 if(!(amount>0)||last.some(t=>cents(t.amount)!==amount))return {stable:false,reason:'amount has changed'};
 if(cents(event.amount)!==amount)return {stable:false,reason:'expected amount differs from posted pattern'};
 const months=new Set(last.map(t=>t.date.slice(0,7)));
 let calendar=false,interval=false;
 const monthlyStep={monthly:1,'twice monthly':1,quarterly:3,semiannual:6,annual:12}[cadence];
 if(monthlyStep){
  const days=last.map(t=>Number(t.date.slice(-2)));
  const spread=Math.max(...days)-Math.min(...days);
  // Same posted calendar day alone is not enough: three January/April/July
  // bills are quarterly evidence, not evidence of a monthly debit.
  calendar=months.size===3&&spread<=6&&last.slice(1).every((t,i)=>
   monthIndex(t.date)-monthIndex(last[i].date)===monthlyStep);
  if(calendar){
   const projectedDay=Number(event.date.slice(-2));
   const ordered=[...days].sort((a,b)=>a-b),center=ordered[1];
   const atMonthEnd=last.every(t=>lastDay(t.date.slice(0,7))-Number(t.date.slice(-2))<=3);
   const forecastAtEnd=lastDay(event.date.slice(0,7))-projectedDay<=3;
   if(Math.abs(projectedDay-center)>6&&!(atMonthEnd&&forecastAtEnd))
    calendar=false;
  }
 }
 if(['weekly','every 2 weeks','biweekly'].includes(cadence)){
  const step=cadence==='weekly'?7:14;
  const lastDate=last.at(-1).date;
  const forecastGap=gap(event.date,lastDate),deviation=((forecastGap%step)+step)%step;
  interval=last.slice(1).every((t,i)=>Math.abs(gap(t.date,last[i].date)-step)<=2)&&
   forecastGap>0&&Math.min(deviation,step-deviation)<=2;
 }
 // A second/third monthly transaction under the same merchant is not
 // a three-month history. Unsupported multi-payment cadences stay excluded
 // unless a user confirms an explicit schedule.
 if(!calendar&&!interval)return {stable:false,reason:'repeat timing is not yet consistent'};
 const lastDate=last.at(-1).date;
 const maxAge=interval?(cadence==='weekly'?24:38):
  monthlyStep===12?400:monthlyStep===6?205:monthlyStep===3?115:70;
 const recently=gap(asOf,lastDate)<=maxAge;
 return {stable:recently,reason:recently?'stable repeating amount':'no recent posted evidence',
  amount:amount/100,frequency:cadence,observed:group.length,key:identity(event),
  mostRecentDate:lastDate,category:event.category};
}
function acceptedManual(event){
 return event.source==='manual'||event.source==='owner-bill'||event.manualRule===true;
}
function project(state,records,events,asOf){
 const decisions=state?.predictions?.plannerRoutineDecisions||{},groups=scan(records,asOf);
 const future=[],suggestions=new Map(),suppressed=[],warnings=[];
 for(const e of events||[]){
  if(e.enabled===false||!validDate(e.date)||e.date<=asOf||!(Number(e.amount)>0)){continue}
  if(e.type==='transfer'){
   // Transfers without a verified direction are not forecast. Explicitly
   // reviewed outgoing/incoming plans are handled by account-forecast.
   if(acceptedManual(e)&&['in','out'].includes(e.cashDirection))future.push(e);
   else suppressed.push({id:e.id,merchant:e.merchant,reason:'Unconfirmed transfer'});
   continue;
  }
  if(!['expense','income'].includes(e.type)){
   suppressed.push({id:e.id,merchant:e.merchant,reason:'Not a repeating bill or paycheck'});
   continue;
  }
  if(acceptedManual(e)){future.push({...e,planConfidence:'confirmed'});continue}
  const key=identity(e),history=groups.get(baseIdentity(e))||[];
  const evidence=stableEvidence(history,e,asOf);
  const providerPfc=history.at(-1)?.source?.personalFinanceCategory||history.at(-1)?.personal_finance_category;
  const allowed=e.type==='income'||
   periodic(e.merchant,e.category,providerPfc);
  if(!allowed||!evidence.stable){
   suppressed.push({id:e.id,merchant:e.merchant,reason:!allowed?'not a routine bill':evidence.reason});
   continue;
  }
  const decision=decisions[key];
  const decisionMatches=decision&&decision.amount===evidence.amount&&decision.frequency===evidence.frequency;
  if(decisionMatches&&decision.status==='excluded'){
   suppressed.push({id:e.id,merchant:e.merchant,reason:'User marked this routine as not expected'});
   continue;
  }
  const confirmed=decisionMatches&&decision.status==='confirmed';
  if(!confirmed&&!suggestions.has(key)){
   suggestions.set(key,{key,merchant:e.merchant,account:account(e),type:e.type,category:e.category,
    amount:evidence.amount,frequency:evidence.frequency,slot:e.slot,
    observed:evidence.observed,next:e.date,last:evidence.mostRecentDate});
  }
  future.push({...e,planConfidence:confirmed?'confirmed':'suggested',routineKey:key});
 }
 const result={events:future,review:[...suggestions.values()].sort((a,b)=>
  a.next.localeCompare(b.next)||a.merchant.localeCompare(b.merchant)),
  suppressed,warnings,counts:{confirmed:future.filter(e=>e.planConfidence==='confirmed').length,
   suggested:future.filter(e=>e.planConfidence==='suggested').length,excluded:suppressed.length}};
 return result;
}
function saveDecision(state,item,status){
 if(!['confirmed','excluded'].includes(status)||!item||typeof item.key!=='string'||
  !['expense','income'].includes(item.type)||!Number.isFinite(Number(item.amount))||
  Number(item.amount)<=0||!item.frequency||item.key!==identity({type:item.type,account:item.account,
    merchant:item.merchant,cadence:item.frequency,slot:item.slot}))
  throw Error('Invalid recurring payment confirmation');
 state.predictions??={};state.predictions.plannerRoutineDecisions??={};
 state.predictions.plannerRoutineDecisions[item.key]={
  status,amount:Number(item.amount),frequency:String(item.frequency)
 };
}
const api={project,scan,stableEvidence,saveDecision,identity,periodic};
root.HouseholdPlannerIntelligence=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);