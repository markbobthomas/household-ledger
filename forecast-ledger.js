/* Single source of future events for Budget, Insights, Reviews and cash flow.
 * Only dated, enabled predicted transactions become cash events.
 * Unscheduled spending is disclosed separately, never made into a fake charge.
 */
(function(root){
'use strict';
const CATS=['Groceries','Shopping','Housing','Utilities','Transportation','Dining','Health','Entertainment','Kids & Family','Insurance','Subscriptions','Other'];
const round=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;
const shiftMonth=(month,n)=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1,12)).toISOString().slice(0,7)};
function build(state,records,asOf,days,forecast,dataModel){
 if(!forecast?.forecast||!dataModel?.expectedForCategory)throw Error('Forecast and state model are required');
 const last=new Date(asOf+'T12:00:00Z');last.setUTCDate(last.getUTCDate()+days);
 const end=last.toISOString().slice(0,10),endMonth=end.slice(0,7);
 const count=(Number(endMonth.slice(0,4))-Number(asOf.slice(0,4)))*12+Number(endMonth.slice(5,7))-Number(asOf.slice(5,7));
 const months=Array.from({length:count+1},(_,i)=>shiftMonth(asOf.slice(0,7),i));
 const rules=state?.predictions?.patternRules||{};
 // A manually reviewed transfer direction is a forecasting assumption only.
 // Keep the posted source record unchanged, even when its direction is unknown.
 const transferProjectionRows=(records||[]).map(t=>{
  if(t.type!=='transfer')return t;
  const key=forecast.patternKey('transfer','Income',t.accountId||t.account||'Unknown',t.merchant);
  const directive=rules[key];
  return directive?.mode==='schedule'&&['in','out'].includes(directive.cashDirection)?
    {...t,cashDirection:directive.cashDirection}:t;
 });
 const events=[],categoryViews={},risk=[];

const toDate=s=>new Date(s+'T12:00:00Z');
function priorMonth(base,n){
 const [y,m]=base.split('-').map(Number);
 return new Date(Date.UTC(y,m-1+n,1,12)).toISOString().slice(0,7);
}
function calcUndatedRisk(rows,asOf,events,state){
 // This is a statistical *range* of shopping/other non-scheduled expenses,
 // never an invented entry in events[] or the source transaction ledger.
 const scheduled=new Set(events.filter(t=>t.type==='expense').map(t=>
   String(t.account||t.accountId||'Unknown')+'|'+String(t.merchant||'').toLowerCase().trim()));
 const rejected=new Set(Object.entries(state?.predictions?.patternRules||{}).filter(([k,r])=>r?.mode==='none')
   .map(([k])=>k.split('|').slice(2).map(decodeURIComponent).join('|')));
 const base=asOf.slice(0,7);
 const complete=Array.from({length:6},(_,i)=>priorMonth(base,-6+i));
 const past=(rows||[]).filter(t=>t.type==='expense'&&t.date<base+'-01'&&t.date<=asOf&&!t.pending);
 const present=new Set(past.map(t=>t.date.slice(0,7)));
 const months=complete.filter(m=>present.has(m));
 if(months.length<3)return {method:'Not enough fully observed months',historyMonths:months.length,
   dailyEstimated:0,dailyLow:0,dailyHigh:0,available:false,confidence:'Unavailable',
   includedInDatedEvents:false};
 const spending=months.map(m=>past.filter(t=>t.date.slice(0,7)===m)
   .filter(t=>{
    const acct=String(t.account||t.accountId||'Unknown'),merchant=String(t.merchant||'').toLowerCase().trim();
    return !scheduled.has(acct+'|'+merchant)&&!rejected.has(acct+'|'+merchant);
   }).reduce((n,t)=>n+Number(t.amount||0),0)).sort((a,b)=>a-b);
 const median=spending.length%2?spending[(spending.length-1)/2]:
   (spending[spending.length/2-1]+spending[spending.length/2])/2;
 const percentile=p=>{
  const at=p*(spending.length-1),i=Math.floor(at),weight=at-i;
  return spending[i]*(1-weight)+spending[Math.min(spending.length-1,i+1)]*weight;
 };
 if(Math.max(...spending)<=0)return {method:'No meaningful historical non-scheduled spending',historyMonths:months.length,
   dailyEstimated:0,dailyLow:0,dailyHigh:0,available:false,confidence:'Unavailable',
   includedInDatedEvents:false};
 const perDay=n=>round(Math.max(0,n)/30.44);
 return {method:'Historical unscheduled expense range, not a dated payment',
  historyMonths:months.length,dailyEstimated:perDay(median),dailyLow:perDay(percentile(.2)),
  dailyHigh:perDay(percentile(.8)),monthlyMedian:round(median),confidence:'Illustrative',
  includedInDatedEvents:false,available:true};
}

 const known=new Set();
 for(const month of months){
  for(const category of CATS){
   const detected=forecast.forecast(records,month,category,asOf,rules);
   const edited=dataModel.expectedForCategory(state,detected.expected,month,category,asOf);
   categoryViews[month+'|'+category]={...detected,expected:edited,
    active:edited.filter(e=>e.enabled!==false&&e.date>asOf&&e.date<=end&&e.date.startsWith(month))};
   const active=categoryViews[month+'|'+category].active;
   categoryViews[month+'|'+category].additional=round(active.reduce((n,e)=>n+Number(e.amount),0));
   categoryViews[month+'|'+category].projectedTotal=round(detected.actual+categoryViews[month+'|'+category].additional);
   if(month===asOf.slice(0,7)&&detected.unscheduled?.estimate>0)risk.push({category,...detected.unscheduled});
   for(const item of active){
    if(known.has(item.id))continue;
    known.add(item.id);
    events.push({...item,type:'expense',account:item.account||'Checking',category,description:item.manualRule?'Confirmed repeating expense':'Estimated payment'});
   }
  }
  const income=forecast.forecastIncome(records,month,asOf,rules);
  for(const item of income.expected){
   if(item.date<=asOf||item.date>end||known.has(item.id))continue;
   known.add(item.id);
   // Separate read-only income estimates from source deposits.
   events.push({...item,type:'income',category:'Income',postingStatus:'unconfirmed',confirmed:false,description:'Estimated incoming payment — unconfirmed until posted'});
  }
 }
 // Transfer is not consumption. Forecast ONLY explicitly directed
 // checking outflows, avoiding guesses from unlabeled internal transfers.
 if(typeof forecast.forecastTransfers==='function'){
  for(const month of months){
   const outgoing=forecast.forecastTransfers(transferProjectionRows,month,asOf,rules);
   const incoming=typeof forecast.forecastTransferInflows==='function'?
     forecast.forecastTransferInflows(transferProjectionRows,month,asOf,rules):{expected:[]};
   for(const item of [...outgoing.expected,...incoming.expected]){
    if(item.date<=asOf||item.date>end||known.has(item.id))continue;
    known.add(item.id);
    events.push({...item,type:'transfer',category:'Cash transfer',
     cashDirection:item.cashDirection,account:item.account||'Checking',
     description:'Expected '+(item.cashDirection==='in'?'incoming':'outgoing')+' transfer (not spending or earned income)',
     postingStatus:'unconfirmed',confirmed:false});
   }
  }
 }
 for(const item of state?.predictions?.cashFlowEvents||[]){
  if(item.date<=asOf||item.date>end||!['income','expense'].includes(item.type)||!(Number(item.amount)>0))continue;
  if(known.has(item.id))continue;
  known.add(item.id);
  events.push({id:item.id,date:item.date,amount:Number(item.amount),type:item.type,category:'One-time forecast',
   merchant:item.description||'One-time forecast',description:'User forecast',accountId:item.accountId||'',source:'manual',postingStatus:item.type==='income'?'unconfirmed':undefined,confirmed:false});
 }
 events.sort((a,b)=>a.date.localeCompare(b.date)||a.merchant.localeCompare(b.merchant));
 const uncertainty=calcUndatedRisk(records,asOf,events,state);
 const uncertaintyByAccount={};
 for(const accountName of new Set((records||[]).map(t=>String(t.account||t.accountId||'Unknown')))){
  const subset=records.filter(t=>String(t.account||t.accountId||'Unknown')===accountName);
  uncertaintyByAccount[accountName]=calcUndatedRisk(subset,asOf,events.filter(t=>String(t.account||t.accountId||'Unknown')===accountName),state);
 }
 return {asOf,through:end,events,categoryViews,risk,uncertainty,uncertaintyByAccount,months,
   totalIncome:round(events.filter(e=>e.type==='income').reduce((n,e)=>n+e.amount,0)),
   totalExpense:round(events.filter(e=>e.type==='expense').reduce((n,e)=>n+e.amount,0))};
}
const api={build};
root.HouseholdForecastLedger=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
