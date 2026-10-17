/* Local recurring-expense analysis. Estimates only — no institution verification. */
(function(root){
'use strict';
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const dateOnly=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''));
const utc=d=>new Date(d+'T12:00:00Z');
const iso=d=>d.toISOString().slice(0,10);
const dayDiff=(a,b)=>Math.round((utc(b)-utc(a))/86400000);
const med=values=>{const a=values.slice().sort((x,y)=>x-y),k=Math.floor(a.length/2);return a.length%2?a[k]:(a[k-1]+a[k])/2};
const normalize=name=>String(name||'').trim().toLowerCase().replace(/\s+/g,' ');
function classify(merchant,category){
  const m=normalize(merchant);
  if(category==='Subscriptions'||/\b(netflix|spotify|hulu|disney\+?|disney plus|apple music|icloud|youtube premium|youtube music|hbo|max subscription|paramount\+?|adobe|dropbox|microsoft 365|office 365|audible|prime membership|amazon prime membership|peloton membership|subscription)\b/.test(m))return'subscription';
  // Reject shopping and grocery merchants which can coincidentally recur around payday.
  if(['Groceries','Shopping','Dining','Entertainment','Transportation'].includes(category))return null;
  if(['Housing','Utilities','Insurance','Kids & Family'].includes(category))return 'bill';
  if(/\b(mortgage|rent|daycare|childcare|electric|internet|water bill|gas bill|insurance|phone bill|loan payment|storage unit|gym membership)\b/.test(m))return 'bill';
  return null;
}
function classifyInterval(transactions){
 const ds=transactions.map(t=>t.date).sort();
 const gaps=ds.slice(1).map((s,i)=>dayDiff(ds[i],s));
 if(!gaps.length||gaps.some(x=>x<=0))return null;
 const schedules=[{days:7,tolerance:2,minCount:3,cadence:'Weekly',monthlyFactor:52/12},{days:14,tolerance:3,minCount:3,cadence:'Every 2 weeks',monthlyFactor:26/12},{days:30.4375,tolerance:5,minCount:2,cadence:'Monthly',monthlyFactor:1},{days:365.25,tolerance:8,minCount:2,cadence:'Yearly',monthlyFactor:1/12}];
 return schedules.find(s=>ds.length>=s.minCount&&gaps.every(d=>Math.abs(d-s.days)<=s.tolerance))||null;
}
function nextDue(series,cadence,asOf){
 const last=series.at(-1).date;
 if(cadence==='Monthly'){
   const day=Math.round(med(series.map(t=>Number(t.date.slice(8,10)))));
   const y=+asOf.slice(0,4),m=+asOf.slice(5,7);
   const candidate=(yr,mo)=>{const lastDay=new Date(Date.UTC(yr,mo,0)).getUTCDate();return yr+'-'+String(mo).padStart(2,'0')+'-'+String(Math.min(day,lastDay)).padStart(2,'0')};
   let year=y,month=m,due=candidate(year,month);
   if(due<=asOf||series.some(t=>t.date===due||t.date.slice(0,7)===due.slice(0,7))){month++;if(month===13){month=1;year++}due=candidate(year,month)}
   return due;
 }
 const step=cadence==='Weekly'?7:cadence==='Every 2 weeks'?14:365;
 let result=utc(last);
 while(iso(result)<=asOf){result.setUTCDate(result.getUTCDate()+step)}
 return iso(result);
}
function analyze(transactions,asOf){
 const current=dateOnly(asOf)?asOf:iso(new Date());
 const groups=new Map();
 for(const tx of transactions||[]){
   if(tx.type!=='expense'||!dateOnly(tx.date)||tx.date>current||!Number.isFinite(Number(tx.amount))||+tx.amount<=0)continue;
   const tag=classify(tx.merchant,tx.category);
   if(!tag)continue;
   const key=(tx.accountId||tx.account||'default')+'|'+normalize(tx.merchant);
   if(!groups.has(key))groups.set(key,{merchant:String(tx.merchant).trim(),category:tx.category,kind:tag,account:tx.account||'',transactions:[]});
   const g=groups.get(key);
   g.transactions.push(tx);
   if(tag==='subscription')g.kind='subscription';
 }
 const confirmed=[],review=[];
 for(const [key,g] of groups){
   const txs=g.transactions.slice().sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
   const monthly=classifyInterval(txs);
   const amounts=txs.map(t=>Number(t.amount)),middle=med(amounts),stable=middle>0&&amounts.every(x=>Math.abs(x-middle)/middle<=0.4);
   const stale=dayDiff(txs.at(-1).date,current)>75;
   const valid=monthly&&stable&&!stale;
   const out={id:key,merchant:g.merchant,category:g.category,kind:g.kind,account:g.account,transactions:txs,lastDate:txs.at(-1).date,firstDate:txs[0].date,
      count:txs.length,amount:round(middle),cadence:valid?monthly.cadence:null,
      monthlyEstimate:valid?round(middle*monthly.monthlyFactor):0,
      nextExpected:valid?nextDue(txs,monthly.cadence,current):null,
      status:valid?'pattern detected':stale?'not recently seen':'needs review'};
   if(valid)confirmed.push(out);
   else if(g.kind==='subscription')review.push(out);
 }
 confirmed.sort((a,b)=>a.kind===b.kind?b.monthlyEstimate-a.monthlyEstimate:a.kind==='subscription'?-1:1);
 review.sort((a,b)=>b.lastDate.localeCompare(a.lastDate));
 const subscriptions=confirmed.filter(g=>g.kind==='subscription');
 const bills=confirmed.filter(g=>g.kind!=='subscription');
 return{asOf:current,confirmed,subscriptions,bills,review,
   monthlyTotal:round(confirmed.reduce((n,x)=>n+x.monthlyEstimate,0)),
   subscriptionMonthly:round(subscriptions.reduce((n,x)=>n+x.monthlyEstimate,0)),
   billsMonthly:round(bills.reduce((n,x)=>n+x.monthlyEstimate,0))};
}
const api={analyze};
root.HouseholdRecurring=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
