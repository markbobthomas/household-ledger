/* Household Ledger local forecasting model. No Plaid tokens, network access, or bank credentials. */
(function(root){
'use strict';
function round(n){return Math.round((Number(n)+Number.EPSILON)*100)/100}
function median(values){const s=values.slice().sort((a,b)=>a-b);return s.length%2?s[Math.floor(s.length/2)]:(s[s.length/2-1]+s[s.length/2])/2}
function localDay(value){const v=String(value||'');return /^\d{4}-\d{2}-\d{2}$/.test(v)?v.slice(8):''}
function forecast(transactions, month, category, todayDate){
  const today=String(todayDate||new Date().toLocaleDateString('en-CA'));
  const current=today.slice(0,7);
  const selected=(transactions||[]).filter(t=>t.type==='expense'&&t.category===category&&String(t.date).slice(0,7)===month);
  const actual=round(selected.reduce((a,t)=>a+Math.max(0,Number(t.amount)||0),0));
  const result={actual,additional:0,projectedTotal:actual,recurring:0,variable:0,recurringDetails:[],method:'actual only',historyMonths:[]};
  if(month!==current)return result;
  const day=Number(today.slice(8,10));
  const days=Number(new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate());
  if(!Number.isInteger(day)||day<1||day>days)return result;
  const priorMonths=[...new Set(transactions.filter(t=>t.type==='expense'&&String(t.date).slice(0,7)<month).map(t=>String(t.date).slice(0,7)))].sort().slice(-3);
  result.historyMonths=priorMonths;
  const past=transactions.filter(t=>t.type==='expense'&&t.category===category&&priorMonths.includes(String(t.date).slice(0,7)));
  const merchantGroups=new Map();
  for(const tx of past){
    const key=String(tx.merchant).trim().toLowerCase();
    if(!merchantGroups.has(key))merchantGroups.set(key,[]);
    merchantGroups.get(key).push(tx);
  }
  const recurringKeys=new Set();
  // Conservative local heuristic for regular bills; Plaid recurring streams may supersede it later.
  const recurringCategories=['Housing','Utilities','Subscriptions','Insurance','Kids & Family'];
  if(priorMonths.length>=2&&recurringCategories.includes(category)){
    for(const [key,all] of merchantGroups){
      const byMonth=new Map();
      for(const tx of all){const mon=String(tx.date).slice(0,7);if(!byMonth.has(mon))byMonth.set(mon,[]);byMonth.get(mon).push(tx)}
      const records=[...byMonth.values()];
      if(records.length<2||records.length<Math.ceil(priorMonths.length*0.67)||records.some(a=>a.length!==1))continue;
      const name=String(all[0].merchant||'').toLowerCase();
      if(category==='Housing'&&!/mortgage|rent|home loan|hoa|property tax/.test(name))continue;
      if(category==='Kids & Family'&&!/daycare|childcare|preschool|tuition|school fee/.test(name))continue;
      const prices=records.map(a=>Number(a[0].amount));
      const dates=records.map(a=>Number(localDay(a[0].date)));
      if(prices.some(n=>!Number.isFinite(n)||n<=0)||Math.max(...prices)/Math.min(...prices)>1.35||Math.max(...dates)-Math.min(...dates)>5)continue;
      recurringKeys.add(key);
      const dueDay=Math.round(median(dates));
      const paidAlready=selected.some(t=>String(t.merchant).trim().toLowerCase()===key);
      if(dueDay>day&&!paidAlready){
        const amount=round(median(prices));
        result.recurringDetails.push({merchant:all[0].merchant,amount,day:dueDay});
      }
    }
  }
  result.recurring=round(result.recurringDetails.reduce((a,x)=>a+x.amount,0));
  if(priorMonths.length>=2){
    let totalRemainder=0;
    for(const m of priorMonths){
      totalRemainder+=past.filter(t=>String(t.date).slice(0,7)===m&&Number(localDay(t.date))>day&&!recurringKeys.has(String(t.merchant).trim().toLowerCase())).reduce((a,t)=>a+Math.max(0,Number(t.amount)||0),0);
    }
    result.variable=round(totalRemainder/priorMonths.length);
    result.method='historical remainder + recurring bills';
    // If a new category lacks usable history, fall back to a pace estimate.
    if(!past.length&&actual>0){result.variable=round(actual/day*Math.max(0,days-day));result.method='current-month pace (limited history)'}
  }else if(day>=5){
    result.variable=round(actual/day*Math.max(0,days-day));
    result.method='current-month pace (limited history)';
  }else{
    result.method='insufficient history';
  }
  result.additional=round(Math.max(0,result.recurring+result.variable));
  result.projectedTotal=round(result.actual+result.additional);
  return result;
}
const api={forecast};
root.HouseholdForecast=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
