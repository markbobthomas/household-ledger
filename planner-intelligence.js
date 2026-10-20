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
const mortgageName=/\b(?:mortgage|mtg|home\s+loan|pennymac|loandepot|newrez|shellpoint|mr\s+cooper)\b/i;
function identity(event){
 const slot=event.slot!==undefined&&String(event.cadence||'').toLowerCase()==='twice monthly'?'|slot:'+String(event.slot):'';
 return [event.type,account(event),clean(event.merchant)].join('|')+slot;
}
function baseIdentity(event){return [event.type,account(event),clean(event.merchant)].join('|')}
function periodic(name,category,sourcePfc){
 const p=sourcePfc||{},primary=String(p.primary||'').toUpperCase(),detailed=String(p.detailed||'').toUpperCase();
 const named=billDescription.test(String(name||''))||mortgageName.test(String(name||''));
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
 const last=recent.slice(-3),amounts=last.map(t=>cents(t.amount)),amount=amounts[0];
 const isIncome=event.type==='income';
 // Strict to the cent for bills; earnings can vary slightly from taxes or
 // hours. Use the lowest observed paycheck, never an optimistic median.
 const low=Math.min(...amounts),high=Math.max(...amounts),vary=isIncome&&low!==high;
 if(!(low>0))return {stable:false,reason:'invalid payment amount'};
 if(!isIncome&&amounts.some(n=>n!==amount))return {stable:false,reason:'amount has changed'};
 if(isIncome&&high/low>1.10)return {stable:false,reason:'paycheck amount varies by more than 10%'};
 if(isIncome&&Math.abs(cents(event.amount)-low)>Math.max(1,low*.1))
  return {stable:false,reason:'expected income amount differs from posted history'};
 if(!isIncome&&cents(event.amount)!==amount)
  return {stable:false,reason:'expected amount differs from posted pattern'};
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
 return {stable:recently,reason:recently?(vary?'recurring paycheck with slightly variable amount':'stable repeating amount'):'no recent posted evidence',
  amount:(isIncome?low:amount)/100,variableIncome:vary,frequency:cadence,observed:group.length,key:identity(event),
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
   // If a potentially large mortgage was forecast by the historical engine
   // but rejected by this safety layer, do not leave an unexplained hole in
   // the cash projection. Keep the charge excluded, and tell the owner why.
   const mortgage= mortgageName.test(String(e.merchant||''))||
    /MORTGAGE/.test(String(providerPfc?.detailed||'').toUpperCase());
   if(allowed&&!evidence.stable&&e.type==='expense'&&mortgage&&
      !warnings.some(w=>w.key===key))
    warnings.push({key,merchant:e.merchant,reason:evidence.reason});
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
    observed:evidence.observed,next:e.date,last:evidence.mostRecentDate,
    ...(evidence.variableIncome?{note:'Paycheck amount varies slightly; planning uses the lowest recent amount.'}:{})});
  }
  future.push({...e,amount:e.type==='income'&&evidence.variableIncome?evidence.amount:e.amount,
   planConfidence:evidence.variableIncome?'variable-paycheck-estimate':confirmed?'confirmed':'suggested',
   routineKey:key});
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

/* A true recurring mortgage can be missing before the general detector finds
 * three reliable months. Never silently insert an unverified $2k debit:
 * surface recent, source-backed payment examples for owner confirmation.
 * Suggestions are independent of the forecast inference preconditions. */
function missingMortgages(records,projection,accounts,asOf,options={}){
 if(!validDate(asOf))return [];
 const byId=new Map((accounts||[]).map(a=>[String(a.id),a]));
 const byAlias=value=>{
  const raw=String(value||''),matches=(accounts||[]).filter(a=>
   [a.id,a.name,a.transactionAccount].some(v=>String(v||'')===raw));
  return matches.length===1?matches[0]:byId.get(raw)||null;
 };
 const pfcMortgage=t=>{
  const p=t.personal_finance_category||t.personalFinanceCategory||t.source?.personalFinanceCategory||
   t.source?.personal_finance_category||{};
  return /\bMORTGAGE\b|HOME_LOAN|HOME_EQUITY/.test(String(p.detailed||'').toUpperCase());
 };
 const money=t=>Number(t.amount||0);
 const groups=new Map();
 for(const t of records||[]){
  if(!t||t.pending||!validDate(t.date)||t.date>asOf||gap(asOf,t.date)>110||
   t.type!=='expense'||money(t)<=0||
   !(mortgageName.test(String(t.merchant||''))||pfcMortgage(t)))continue;
  const account=byAlias(t.accountId||t.account);
  if(!account||String(account.accountType||account.type||'').toLowerCase()==='credit')continue;
  const amount=cents(money(t));
  const merchant=clean(t.merchant||'Mortgage payment');
  if(!merchant)continue;
  const key=['mortgage',String(account.id),merchant,String(amount)].map(encodeURIComponent).join('|');
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(t);
 }
 const alreadyForecast=(accountId,merchant,amount)=>{
  const rows=projection?.events||[];
  return rows.some(e=>{
   if(e.date<=asOf||gap(e.date,asOf)>90||!['expense','transfer_out'].includes(e.kind))return false;
   const account=byAlias(e.accountId||e.account);
   if(!account||String(account.id)!==accountId)return false;
   const name=clean(e.merchant),sameMerchant=name===merchant;
   // A renamed forecast bill may still be the same mortgage, not a second one.
   const sameMortgage=mortgageName.test(name)&&mortgageName.test(merchant);
   return sameMerchant||sameMortgage&&Math.abs(cents(e.amount)-amount)<=1000;
  });
 };
 const dismissed=new Set(options.dismissed||[]);
 const output=[];
 for(const [id,group] of groups){
  group.sort((a,b)=>b.date.localeCompare(a.date));
  const latest=group[0],account=byAlias(latest.accountId||latest.account),
   amount=cents(latest.amount),merchant=clean(latest.merchant);
  if(!account||gap(asOf,latest.date)>70||dismissed.has(id)||
   alreadyForecast(String(account.id),merchant,amount))continue;
  let next=latest.date;
  for(let i=0;i<5&&next<=asOf;i++){
   const [y,m,d]=latest.date.split('-').map(Number);
   const offset=i+1,first=new Date(Date.UTC(y,m-1+offset,1,12)),
    last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
   next=first.toISOString().slice(0,7)+'-'+String(Math.min(d,last)).padStart(2,'0');
  }
  if(!validDate(next)||next<=asOf||gap(next,asOf)>90)continue;
  output.push({id,accountId:String(account.id),account:account.name||String(account.id),
   merchant:String(latest.merchant),amount:amount/100,lastDate:latest.date,nextDate:next,
   observed:group.length,examples:group.slice(0,4).map(t=>({
    id:String(t.id||''),date:t.date,amount:money(t),merchant:String(t.merchant||'')
   }))});
 }
 return output.sort((a,b)=>a.nextDate.localeCompare(b.nextDate)||b.amount-a.amount).slice(0,8);
}
const api={project,scan,stableEvidence,saveDecision,identity,periodic,missingMortgages};
root.HouseholdPlannerIntelligence=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);