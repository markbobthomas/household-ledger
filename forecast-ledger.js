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
 const events=[],categoryViews={},risk=[];
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
   events.push({...item,type:'income',category:'Income',description:'Estimated incoming payment'});
  }
 }
 for(const item of state?.predictions?.cashFlowEvents||[]){
  if(item.date<=asOf||item.date>end||!['income','expense'].includes(item.type)||!(Number(item.amount)>0))continue;
  if(known.has(item.id))continue;
  known.add(item.id);
  events.push({id:item.id,date:item.date,amount:Number(item.amount),type:item.type,category:'One-time forecast',
   merchant:item.description||'One-time forecast',description:'User forecast',accountId:item.accountId||'',source:'manual'});
 }
 events.sort((a,b)=>a.date.localeCompare(b.date)||a.merchant.localeCompare(b.merchant));
 return {asOf,through:end,events,categoryViews,risk,months,
   totalIncome:round(events.filter(e=>e.type==='income').reduce((n,e)=>n+e.amount,0)),
   totalExpense:round(events.filter(e=>e.type==='expense').reduce((n,e)=>n+e.amount,0))};
}
const api={build};
root.HouseholdForecastLedger=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
