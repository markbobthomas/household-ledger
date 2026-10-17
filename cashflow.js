/* Household Ledger 90-day bank-balance forecasting; deterministic and bank-provider agnostic. */
(function(root){
'use strict';
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''));
const isoUTC=d=>d.toISOString().slice(0,10);
const fromISO=s=>new Date(String(s)+'T12:00:00Z');
const addDays=(s,n)=>{const d=fromISO(s);d.setUTCDate(d.getUTCDate()+n);return isoUTC(d)};
const monthLength=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
const median=xs=>{const a=xs.slice().sort((x,y)=>x-y);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2};
function isPredictable(t){
  const name=String(t.merchant||'').toLowerCase();
  if(t.type==='income')return true;
  if(t.type==='transfer')return /transfer to savings|credit card payment|card payment|loan payment|transfer to investment/i.test(name);
  if(t.type!=='expense')return false;
  if(t.category==='Housing')return /mortgage|rent|hoa|home loan|property tax/i.test(name);
  if(t.category==='Kids & Family')return /daycare|childcare|preschool|tuition/i.test(name);
  if(['Utilities','Subscriptions','Insurance'].includes(t.category))return true;
  return /car payment|auto loan|student loan|loan payment/i.test(name);
}
function cashFlowFromExpected(input){
 const account=input.account,asOf=input.asOf,days=input.days??90;
 if(!account||!validDate(asOf))throw Error('A balance snapshot and date are required');
 if(!Number.isInteger(days)||days<1||days>366)throw Error('Invalid forecast horizon');
 const opening=Number.isFinite(account.available)?account.available:account.current;
 if(!Number.isFinite(opening))throw Error('Bank balance is unavailable');
 const all=Array.isArray(input.expectedEvents)?input.expectedEvents:[];
 const eventsByDate=new Map();
 for(const e of all){
  if(!validDate(e.date)||e.date<=asOf||!Number.isFinite(Number(e.amount))||Number(e.amount)<=0||
    !['income','expense'].includes(e.type))continue;
  if(e.accountId&&e.accountId!==account.id)continue;
  if(e.account&&!e.accountId&&e.account!==account.transactionAccount&&e.account!==account.id)continue;
  if(!eventsByDate.has(e.date))eventsByDate.set(e.date,[]);
  eventsByDate.get(e.date).push(e);
 }
 // The opening balance already reflects every posted transaction at asOf.
 // Do not emit historical deposits, transfers or purchases into future cash.
 let balance=round(opening),minimum=Infinity,lowestDate='',expectedIncome=0,expectedOutflow=0;
 const series=[{date:asOf,balance,starting:true,income:0,outflow:0,events:[]}];
 for(let i=1;i<=days;i++){
  const date=addDays(asOf,i);
  const events=(eventsByDate.get(date)||[]).map(e=>({
   id:e.id,merchant:e.merchant,amount:round(e.amount),type:e.type,
   category:e.category,description:e.description||'Dated expected transaction'
  }));
  const income=round(events.filter(e=>e.type==='income').reduce((n,e)=>n+e.amount,0));
  const outflow=round(events.filter(e=>e.type==='expense').reduce((n,e)=>n+e.amount,0));
  balance=round(balance+income-outflow);
  expectedIncome=round(expectedIncome+income);expectedOutflow=round(expectedOutflow+outflow);
  series.push({date,balance,income,outflow,events});
  if(balance<minimum){minimum=balance;lowestDate=date}
 }
 return {source:input.source||'Forecast ledger',accountId:account.id,accountName:account.name,
  balanceBasis:Number.isFinite(account.available)?'available':'current',asOf,opening:round(opening),
  minimum:round(minimum),lowestDate,closing:balance,days,through:addDays(asOf,days),
  series,expectedIncome,expectedOutflow,dailyVariable:0,
  streams:all.filter(e=>e.source==='historical'||e.manualRule),
  historyMonths:input.historyMonths||[],
  method:'Unified dated expense and income forecast; irregular spending shown separately',
  estimated:true,unified:true};
}

function cashFlow90(input){
  if(Array.isArray(input?.expectedEvents))return cashFlowFromExpected(input);
  const account=input?.account, asOf=input?.asOf, days=input?.days??90, rows=input?.transactions||[], predictionOverrides=input?.predictionOverrides||{};
  const streamAdjustments=predictionOverrides.streams||{};
  const additionalEvents=Array.isArray(predictionOverrides.events)?predictionOverrides.events:[];
  if(!account||!validDate(asOf))throw new Error('A bank snapshot with an as-of date is required');
  if(!Number.isInteger(days)||days<1||days>366)throw new Error('Forecast must be 1–366 days');
  const opening=Number.isFinite(account.available)?account.available:account.current;
  if(!Number.isFinite(opening))throw new Error('This account does not have an available/current balance');
  const before=asOf.slice(0,7);
  // A future bank adapter must use normalized account IDs, not guesses from merchant descriptions.
  const historical=rows.filter(t=>(
    (t.accountId ? t.accountId===account.id : t.account===account.transactionAccount) &&
    validDate(t.date)&&t.date<asOf&&Number.isFinite(Number(t.amount))&&Number(t.amount)>0 &&
    ['income','expense','transfer'].includes(t.type)
  ));
  const months=[...new Set(historical.filter(t=>t.date.slice(0,7)<before).map(t=>t.date.slice(0,7)))].sort().slice(-3);
  const history=historical.filter(t=>months.includes(t.date.slice(0,7)));
  const group=new Map();
  for(const t of history){
    if(!isPredictable(t))continue;
    const key=t.type+'|'+String(t.merchant||'').trim().toLowerCase();
    if(!group.has(key))group.set(key,new Map());
    const records=group.get(key),mon=t.date.slice(0,7);
    if(!records.has(mon))records.set(mon,[]);
    records.get(mon).push(t);
  }
  let streams=[];
  const scheduledKeys=new Set();
  if(months.length>=2){
    for(const [key,perMonth] of group){
      const matched=months.filter(m=>perMonth.has(m));
      if(matched.length<2||matched.length<Math.ceil(months.length*0.67))continue;
      const records=matched.map(m=>perMonth.get(m).slice().sort((a,b)=>a.date.localeCompare(b.date)));
      const n=records[0].length;
      if(n<1||n>3||records.some(a=>a.length!==n))continue;
      const candidates=[];
      for(let slot=0;slot<n;slot++){
        const txs=records.map(a=>a[slot]);
        const amounts=txs.map(t=>Number(t.amount));
        const due=txs.map(t=>Number(t.date.slice(8,10)));
        if(Math.min(...amounts)<=0||Math.max(...amounts)/Math.min(...amounts)>1.4||Math.max(...due)-Math.min(...due)>5)continue;
        candidates.push({key,merchant:txs[0].merchant,type:txs[0].type,day:Math.round(median(due)),amount:round(median(amounts)),category:txs[0].category});
      }
      if(candidates.length===n){streams.push(...candidates);scheduledKeys.add(key)}
    }
  }
  // A modified predicted payment is never a modified bank transaction.
  streams=streams.map((stream,i)=>{
    const streamKey=account.id+'|'+stream.key+'|'+stream.day+'|'+i;
    const override=streamAdjustments[streamKey];
    return {...stream,key:streamKey,originalAmount:stream.amount,originalDay:stream.day,
      amount:override?round(Number(override.amount)):stream.amount,
      day:override?Number(override.day):stream.day,
      enabled:override?override.enabled!==false:true,
      edited:Boolean(override)};
  });
  // Spread uncommitted variable expenses across future days, excluding predicted bills.
  const irregular=history.filter(t=>t.type==='expense'&&!scheduledKeys.has(t.type+'|'+String(t.merchant||'').trim().toLowerCase()));
  const observedDays=months.reduce((n,m)=>n+monthLength(Number(m.slice(0,4)),Number(m.slice(5,7))),0);
  const modeledDaily=observedDays?round(irregular.reduce((n,t)=>n+Number(t.amount),0)/observedDays):0;
  const dailyVariable=predictionOverrides.dailyVariable===null||predictionOverrides.dailyVariable===undefined?modeledDaily:Math.max(0,round(Number(predictionOverrides.dailyVariable)));
  let balance=round(opening),minimum=Infinity,lowestDate='',expectedIncome=0,expectedOutflow=0;
  const series=[{date:asOf,balance,starting:true,income:0,outflow:0,events:[]}];
  for(let index=1;index<=days;index++){
    const date=addDays(asOf,index);
    const year=Number(date.slice(0,4)),month=Number(date.slice(5,7)),day=Number(date.slice(8,10));
    const actualLast=monthLength(year,month);
    const events=[];
    let income=0,outflow=0;
    for(const stream of streams){
      if(!stream.enabled||day!==Math.min(stream.day,actualLast))continue;
      const isIncome=stream.type==='income';
      events.push({merchant:stream.merchant,amount:stream.amount,type:stream.type,category:stream.category,description:isIncome?'Estimated recurring deposit':stream.type==='transfer'?'Estimated outgoing bank transfer':'Estimated recurring bill'});
      if(isIncome)income+=stream.amount;else outflow+=stream.amount;
    }
    if(dailyVariable>0){outflow+=dailyVariable;events.push({merchant:'Other purchases',amount:dailyVariable,type:'expense',category:'Variable spending',description:'Estimated daily non-recurring spending'})}
    // Explicit one-off forecast events affect the prediction only, never actuals.
    for(const planned of additionalEvents){
      if(planned.date!==date||(planned.accountId&&planned.accountId!==account.id))continue;
      const amount=Number(planned.amount);
      if(!Number.isFinite(amount)||amount<=0||!['income','expense'].includes(planned.type))continue;
      events.push({merchant:String(planned.description||'One-time forecast'),amount,type:planned.type,category:'User forecast',description:'User-entered prediction only',predictionId:planned.id});
      if(planned.type==='income')income+=amount;else outflow+=amount;
    }
    income=round(income);outflow=round(outflow);
    balance=round(balance+income-outflow);
    expectedIncome=round(expectedIncome+income);expectedOutflow=round(expectedOutflow+outflow);
    series.push({date,balance,income,outflow,events});
    if(balance<minimum){minimum=balance;lowestDate=date}
  }
  return {
    source:input.source||'Bank feed',accountId:account.id,accountName:account.name,
    balanceBasis:Number.isFinite(account.available)?'available':'current',
    asOf,opening:round(opening),minimum:round(minimum),lowestDate,
    closing:balance,days,through:addDays(asOf,days),series,
    expectedIncome,expectedOutflow,dailyVariable,streams,historyMonths:months,
    method:months.length>=2?'Recurring-pattern model + average irregular expenses':'Limited history: forecast may omit upcoming bills',
    estimated:true
  };
}
const api={cashFlow90};
root.HouseholdCashFlow=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
