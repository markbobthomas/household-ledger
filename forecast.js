/* Dated, transaction-level month forecast. Never modifies source transactions.
   Conservative recurring merchant detection. No undated catch-all variable spend. */
(function(root){
'use strict';
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const median=xs=>{const s=xs.slice().sort((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2};
const validDate=s=>/^\d{4}-\d\d-\d\d$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const dateUTC=s=>new Date(s+'T12:00:00Z');
const iso=d=>d.toISOString().slice(0,10);
const shiftMonth=(month,offset)=>{const [y,m]=month.split('-').map(Number);return iso(new Date(Date.UTC(y,m-1+offset,1,12))).slice(0,7)};
const endDay=month=>new Date(Date.UTC(+month.slice(0,4),+month.slice(5,7),0)).getUTCDate();
const normalize=x=>String(x||'').trim().toLowerCase().replace(/\s+/g,' ');
const billCategory=new Set(['Housing','Utilities','Subscriptions','Insurance','Kids & Family']);
const likelyBill=t=>billCategory.has(t.category)&&(
 t.category==='Utilities'||t.category==='Subscriptions'||t.category==='Insurance'||
 (t.category==='Housing'&&/mortgage|rent|home loan|hoa|tax|property|insurance/i.test(t.merchant))||
 (t.category==='Kids & Family'&&/daycare|childcare|preschool|tuition|school fee/i.test(t.merchant))
)||/auto loan|car payment|student loan|loan payment/i.test(t.merchant||'');
const accountKey=t=>String(t.accountId||t.account||'Unknown');
function completeMonths(records,month){
 // An account has at least one recorded entry in a month; the coverage is a
 // heuristic, not a bank-verified proof that the month is complete.
 const eligible=Array.from({length:6},(_,i)=>shiftMonth(month,-i-1));
 const present=new Set(records.filter(t=>validDate(t.date)).map(t=>t.date.slice(0,7)));
 return eligible.filter(m=>present.has(m)).sort();
}
function infer(transactions,month,category,asOf){
 const today=String(asOf||new Date().toLocaleDateString('en-CA'));
 const actualRows=(transactions||[]).filter(t=>t.type==='expense'&&t.category===category&&validDate(t.date)&&t.date.slice(0,7)===month&&t.date<=today);
 const actual=round(actualRows.reduce((a,t)=>a+Math.max(0,Number(t.amount)||0),0));
 const result={actual,additional:0,projectedTotal:actual,expected:[],recurring:0,variable:0,recurringDetails:[],historyMonths:[],method:'No dated predictions'};
 if(month!==today.slice(0,7))return result;
 const all=Array.isArray(transactions)?transactions:[];
 const previous=completeMonths(all,month);
 result.historyMonths=previous;
 if(previous.length<2){result.method='Insufficient completed-month history (need at least two months)';return result}
 if(!previous.includes(shiftMonth(month,-1))){result.method='Last completed month is missing: no trusted schedule forecast';return result}
 const latest=previous.slice(-3);
 const groups=new Map();
 const historical=all.filter(t=>t.type==='expense'&&t.category===category&&latest.includes(String(t.date||'').slice(0,7))&&validDate(t.date)&&Number(t.amount)>0&&!t.pending);
 for(const t of historical){
  const key=accountKey(t)+'|'+normalize(t.merchant);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(t);
 }
 const candidates=[];
 for(const [groupKey,rows] of groups){
  const byMonth=new Map(latest.map(m=>[m,[]]));
  for(const t of rows)byMonth.get(t.date.slice(0,7)).push(t);
  const used=latest.filter(m=>byMonth.get(m).length);
  const bills=rows.some(likelyBill);
  if(used.length<2||used.length<Math.ceil(latest.length*.67))continue;
  if(latest.length>=3&&!used.includes(latest[latest.length-1]))continue; // stale merchants
  const sorted=used.map(m=>byMonth.get(m).sort((a,b)=>a.date.localeCompare(b.date)));
  const n=sorted[0].length;
  // When a charge happens every 7/14 days, months may have 4 vs 5
  // occurrences. Detect calendar intervals rather than forcing fixed
  // monthly slots; require consistent posting gaps and charge amounts.
  if(sorted.some(a=>a.length!==n)){
   const observed=all.filter(t=>t.type==='expense'&&t.category===category&&!t.pending&&
      validDate(t.date)&&t.date<=today&&t.date.slice(0,7)>=latest[0]&&
      accountKey(t)===accountKey(rows[0])&&normalize(t.merchant)===normalize(rows[0].merchant))
     .sort((a,b)=>a.date.localeCompare(b.date));
   const amounts=observed.map(t=>Number(t.amount));
   const medAmount=median(amounts);
   const dists=observed.slice(1).map((t,i)=>(dateUTC(t.date)-dateUTC(observed[i].date))/86400000);
   const interval=[7,14].find(d=>dists.length>=4&&dists.filter(gap=>Math.abs(gap-d)<=(d===7?1:2)).length/dists.length>=.85);
   const amountsStable=amounts.length>=5&&medAmount>0&&
      Math.max(...amounts.map(v=>Math.abs(v-medAmount)/medAmount))<=(bills?.35:.27);
   const last=observed[observed.length-1];
   if(interval&&amountsStable&&last&&((dateUTC(today)-dateUTC(last.date))/86400000)<interval*2+4){
    const confidence=used.length>=3?'High':'Medium';
    const merchant=last.merchant,account=accountKey(last);
    let cursor=dateUTC(last.date),slot=0;
    while(true){
     cursor=new Date(cursor.getTime()+interval*86400000);
     const date=iso(cursor);
     if(date.slice(0,7)>month)break;
     if(date<=today)continue;
     const id=['hist',month,category,encodeURIComponent(account),encodeURIComponent(normalize(merchant)),'interval'+interval+'-'+slot].join('|');
     candidates.push({id,merchant,account,category,date,amount:round(medAmount),cadence:interval===7?'weekly':'every 2 weeks',
       confidence,evidence:used.length,source:'historical',pattern:{day:Number(date.slice(8,10)),amount:round(medAmount)},slot,groupKey});
     slot++;
    }
   }
   continue;
  }
  if(n<1||n>(bills?3:6)||sorted.some(a=>a.length!==n))continue;
  // Non-bills require at least three distinct months of consistent behavior.
  if(!bills&&used.length<3)continue;
  const first=rows[0],merchant=first.merchant,account=accountKey(first);
  for(let slot=0;slot<n;slot++){
   const observed=sorted.map(a=>a[slot]);
   const amounts=observed.map(t=>Number(t.amount));
   const days=observed.map(t=>Number(t.date.slice(8,10)));
   const dateVariation=Math.max(...days)-Math.min(...days);
   const medAmount=median(amounts);
   const amountVariation=Math.max(...amounts.map(a=>Math.abs(a-medAmount)/medAmount));
   // Bills permit a few days of posting slippage and variable utility amounts;
   // other purchases require a consistent calendar slot across three months.
   if(dateVariation>(bills?6:3)||amountVariation>(bills?.55:.4))continue;
   const day=Math.min(Math.round(median(days)),endDay(month));
   const confidence=used.length>=3&&dateVariation<=2&&amountVariation<=.15?'High':bills&&used.length>=2?'Medium':'Pattern';
   const id=['hist',month,category,encodeURIComponent(account),encodeURIComponent(normalize(merchant)),slot].join('|');
   candidates.push({id,merchant,account,category,date:month+'-'+String(day).padStart(2,'0'),
    amount:round(medAmount),cadence:n===1?'monthly':n+' / month',
    confidence,evidence:used.length,source:'historical',pattern:{day,amount:round(medAmount)},slot,
    groupKey});
  }
 }
 // Match expected charge against posted transactions in the target month, one
 // actual charge per candidate; don't forecast something that was already paid.
 const consumed=new Set(),expected=[];
 for(const c of candidates.sort((a,b)=>a.date.localeCompare(b.date)||a.merchant.localeCompare(b.merchant))){
  const expectedDay=Number(c.date.slice(8,10));
  let best=null,bestDelta=Infinity;
  for(const t of actualRows){
   if(consumed.has(t.id)||accountKey(t)!==c.account||normalize(t.merchant)!==normalize(c.merchant))continue;
   const delta=Math.abs(Number(t.date.slice(8,10))-expectedDay);
   if(delta<=6&&delta<bestDelta){best=t;bestDelta=delta}
  }
  if(best){consumed.add(best.id);continue}
  if(c.date<=today)continue;
  expected.push(c);
 }
 result.expected=expected.sort((a,b)=>a.date.localeCompare(b.date)||a.merchant.localeCompare(b.merchant));
 result.recurring=round(expected.reduce((a,e)=>a+e.amount,0));
 result.additional=result.recurring;result.projectedTotal=round(result.actual+result.additional);
 result.recurringDetails=expected.map(x=>({merchant:x.merchant,amount:x.amount,day:Number(x.date.slice(8,10)),date:x.date}));
 result.method='Dated merchant patterns from '+latest.length+' historical months; unpredictable purchases omitted';
 return result;
}
function forecast(transactions,month,category,todayDate){return infer(transactions,month,category,todayDate)}
const api={forecast,infer};
root.HouseholdForecast=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
