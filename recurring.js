/* Local recurring-expense analysis. Estimates only — no institution verification. */
(function(root){
'use strict';
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const dateOnly=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''));
const utc=d=>new Date(d+'T12:00:00Z');
const iso=d=>d.toISOString().slice(0,10);
const dayDiff=(a,b)=>Math.round((utc(b)-utc(a))/86400000);
const med=values=>{const a=values.slice().sort((x,y)=>x-y),k=Math.floor(a.length/2);return a.length%2?a[k]:(a[k-1]+a[k])/2};
const normalize=name=>String(name||'').trim().toLowerCase().replace(/\s+/g,' ').replace(/(?:\s*[-#*]\s*\d{3,})$/,'').trim();
function classify(merchant,category){
  const m=normalize(merchant);
  if(category==='Subscriptions'||/\b(netflix|spotify|hulu|disney\+?|disney plus|apple music|icloud|youtube premium|youtube music|hbo|max subscription|paramount\+?|adobe|dropbox|microsoft 365|office 365|audible|prime membership|amazon prime membership|peloton membership|subscription)\b/.test(m))return'subscription';
  // Reject shopping and grocery merchants which can coincidentally recur around payday.
  if(['Groceries','Shopping','Dining','Entertainment','Transportation'].includes(category))return null;
  if(category==='Housing'&&/\b(mortgage|rent|hoa|home loan|property tax)\b/.test(m))return 'bill';
  if(category==='Kids & Family'&&/\b(daycare|childcare|preschool|tuition|school fee)\b/.test(m))return 'bill';
  if(['Utilities','Insurance'].includes(category))return 'bill';
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
// An explicit schedule is a user-maintained forecast rule, never a new bank fact.
const ruleKey=t=>['expense',t.category||'Other',String(t.accountId||t.account||'Unknown'),
  normalize(t.merchant)].map(encodeURIComponent).join('|');
const cadenceName={weekly:'Weekly',biweekly:'Every 2 weeks',monthly:'Monthly',
  quarterly:'Every 3 months',semiannual:'Every 6 months',annual:'Yearly'};
const monthlyFactor={weekly:52/12,biweekly:26/12,monthly:1,quarterly:1/3,
  semiannual:1/6,annual:1/12};
function nextRuleDue(rule,asOf,firstDate){
 const freq=rule.frequency,anchor=dateOnly(rule.anchorDate)?rule.anchorDate:firstDate;
 if(!dateOnly(anchor)||!cadenceName[freq])return null;
 if(freq==='weekly'||freq==='biweekly'){
  const step=freq==='weekly'?7:14,first=utc(anchor),now=utc(asOf);
  const count=Math.max(0,Math.floor((now-first)/86400000/step)+1);
  first.setUTCDate(first.getUTCDate()+count*step);
  return iso(first);
 }
 const interval={monthly:1,quarterly:3,semiannual:6,annual:12}[freq];
 const firstMonth=Number(anchor.slice(0,4))*12+Number(anchor.slice(5,7))-1;
 const currentMonth=Number(asOf.slice(0,4))*12+Number(asOf.slice(5,7))-1;
 let n=Math.max(0,Math.floor((currentMonth-firstMonth)/interval));
 const day=Number(rule.day)||Number(anchor.slice(8,10));
 for(let attempt=0;attempt<4;attempt++,n++){
  const index=firstMonth+n*interval,year=Math.floor(index/12),month=index%12+1;
  const max=new Date(Date.UTC(year,month,0)).getUTCDate();
  const due=year+'-'+String(month).padStart(2,'0')+'-'+String(Math.min(day,max)).padStart(2,'0');
  if(due>asOf&&due>=anchor)return due;
 }
 return null;
}
function analyze(transactions,asOf,patternRules={}){
 const current=dateOnly(asOf)?asOf:iso(new Date()),rules=patternRules||{};
 const groups=new Map();
 for(const tx of transactions||[]){
  // Pending charges are not additional posted evidence for a recurring payment.
  if(tx.type!=='expense'||tx.pending||!dateOnly(tx.date)||tx.date>current||
     !Number.isFinite(Number(tx.amount))||+tx.amount<=0)continue;
  const key=ruleKey(tx),directive=rules[key],tag=classify(tx.merchant,tx.category);
  if(!tag&&!directive)continue;
  if(!groups.has(key))groups.set(key,{id:key,ruleKey:key,merchant:String(tx.merchant).trim(),
    category:tx.category,kind:tag||'bill',account:tx.account||'',transactions:[]});
  const group=groups.get(key);
  group.transactions.push(tx);
  if(tag==='subscription')group.kind='subscription';
 }
 const confirmed=[],review=[],suppressed=[];
 for(const g of groups.values()){
  const txs=g.transactions.slice().sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
  const rule=rules[g.ruleKey],amounts=txs.map(t=>Number(t.amount)),middle=med(amounts);
  const stable=middle>0&&amounts.every(x=>Math.abs(x-middle)/middle<=0.4);
  const interval=classifyInterval(txs);
  const stale=dayDiff(txs.at(-1).date,current)>75;
  const valid=interval&&stable&&!stale;
  const explicit=rule?.mode==='schedule'&&cadenceName[rule.frequency]&&Number(rule.amount)>0;
  const legacy=rule?.mode==='monthly'&&Number(rule.amount)>0&&Number(rule.day)>=1&&Number(rule.day)<=31;
  const manual=Boolean(explicit||legacy);
  const cadence=manual?(explicit?cadenceName[rule.frequency]:'Monthly'):valid?interval.cadence:null;
  const amount=manual?Number(rule.amount):middle;
  const factor=manual?(explicit?monthlyFactor[rule.frequency]:1):valid?interval.monthlyFactor:0;
  const nextExpected=manual?nextRuleDue(explicit?rule:{frequency:'monthly',day:rule.day,
    anchorDate:txs[0].date},current,txs[0].date):
    valid?nextDue(txs,interval.cadence,current):null;
  const out={...g,transactions:txs,lastDate:txs.at(-1).date,firstDate:txs[0].date,
    count:txs.length,amount:round(amount),cadence,
    monthlyEstimate:round(amount*factor),
    nextExpected,source:manual?'manual':valid?'detected':'unconfirmed',
    status:manual?'schedule set by you':rule?.mode==='none'?'marked not recurring':
      valid?'pattern detected':stale?'not recently seen':'needs review'};
  if(rule?.mode==='none')suppressed.push(out);
  else if(manual||valid)confirmed.push(out);
  else if(g.kind==='subscription')review.push(out);
 }
 confirmed.sort((a,b)=>a.kind===b.kind?b.monthlyEstimate-a.monthlyEstimate:a.kind==='subscription'?-1:1);
 review.sort((a,b)=>b.lastDate.localeCompare(a.lastDate));
 suppressed.sort((a,b)=>b.lastDate.localeCompare(a.lastDate));
 const subscriptions=confirmed.filter(g=>g.kind==='subscription');
 const bills=confirmed.filter(g=>g.kind!=='subscription');
 return{asOf:current,confirmed,subscriptions,bills,review,suppressed,
   monthlyTotal:round(confirmed.reduce((n,x)=>n+x.monthlyEstimate,0)),
   subscriptionMonthly:round(subscriptions.reduce((n,x)=>n+x.monthlyEstimate,0)),
   billsMonthly:round(bills.reduce((n,x)=>n+x.monthlyEstimate,0))};
}
const api={analyze};
root.HouseholdRecurring=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
