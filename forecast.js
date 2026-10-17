/* Phase 1: explainable transaction-level pattern detector.
 * Source ledger rows remain untouched. All forecasts use history STRICTLY
 * before the as-of date; no unseen future values, no arbitrary future charges.
 * Phase 2 will unify the monthly and 90-day cash-flow views.
 */
(function(root){
'use strict';
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const median=xs=>{const a=xs.slice().sort((x,y)=>x-y);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2};
const validDate=s=>/^\d{4}-\d\d-\d\d$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const utc=s=>new Date(s+'T12:00:00Z');
const iso=d=>d.toISOString().slice(0,10);
const dayDiff=(a,b)=>Math.round((utc(a)-utc(b))/86400000);
const addDays=(date,n)=>{const d=utc(date);d.setUTCDate(d.getUTCDate()+n);return iso(d)};
const shiftMonth=(m,n)=>{const [y,mo]=m.split('-').map(Number);return iso(new Date(Date.UTC(y,mo-1+n,1,12))).slice(0,7)};
const endDay=m=>new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).getUTCDate();
const monthIndex=m=>Number(m.slice(0,4))*12+Number(m.slice(5,7));
const normalize=s=>String(s||'').toLowerCase().replace(/\s+/g,' ').replace(/(?:\s*[-#*]\s*\d{3,})$/,'').trim();
const accountKey=t=>String(t.accountId||t.account||'Unknown');
const periodicCategories=new Set(['Housing','Utilities','Subscriptions','Insurance','Kids & Family']);
const likelyBill=t=>periodicCategories.has(t.category)&&(
 ['Utilities','Subscriptions','Insurance'].includes(t.category)||
 (t.category==='Housing'&&/mortgage|rent|hoa|property|home loan|tax|insurance/i.test(t.merchant))||
 (t.category==='Kids & Family'&&/daycare|childcare|tuition|preschool|school fee/i.test(t.merchant))
 )||/auto loan|car payment|student loan|loan payment/i.test(t.merchant||'');
const skip=t=>!t||!validDate(t.date)||!Number.isFinite(Number(t.amount))||Number(t.amount)<=0||
 t.pending||(t.type==='transfer'&&!['in','out'].includes(t.cashDirection))||
 // Refund/reversal income belongs in actual history, but is not pay or a
 // recurring incoming payment. Never turn repeat refunds into a payday.
 (t.type==='income'&&/\b(refund|reversal|chargeback|cashback|rebate|return credit)\b/i.test(
  String(t.merchant||'')+' '+String(t.description||'')));
const confidence=(observations,months,stability,dateSpread,cadence)=>{
 // Labels are evidence heuristics, not measured probabilities.
 if(observations>=3&&months>=3&&stability<=.0005&&dateSpread<=3)return 'High';
 if(observations>=5&&months>=3&&stability<=.18&&dateSpread<=2)return 'High';
 if((cadence==='monthly'||cadence==='twice monthly'||cadence==='weekly'||cadence==='every 2 weeks')&&observations>=3&&stability<=.50)return 'Medium';
 return 'Pattern';
};
function coverage(records,target,lookback=24){
 const eligible=Array.from({length:lookback},(_,i)=>shiftMonth(target,-i-1));
 const present=new Set(records.filter(t=>validDate(t.date)).map(t=>t.date.slice(0,7)));
 return eligible.filter(m=>present.has(m)).sort();
}
function seasonalAmount(rows,month,baseline,variable){
 // A last-year same-calendar-month charge informs seasonal utilities only.
 // Require 12+ months of data and at least two same-season observations.
 if(!variable||rows.length<12)return {amount:baseline,seasonal:false};
 const amounts=rows.map(t=>Number(t.amount));
 if(Math.max(...amounts)-Math.min(...amounts)<1)return {amount:baseline,seasonal:false};
 const prev=shiftMonth(month,-12),season=rows.filter(t=>t.date.slice(0,7)===prev).map(t=>Number(t.amount));
 if(!season.length)return {amount:baseline,seasonal:false};
 const recent=rows.slice(-4).map(t=>Number(t.amount));
 const normal=median(recent),seasonValue=median(season);
 const ratio=normal>0?seasonValue/normal:1;
 if(ratio<.4||ratio>2.5)return {amount:baseline,seasonal:false};
 return {amount:round(.6*seasonValue+.4*baseline),seasonal:true};
}
function infer(transactions,month,category,asOf,mode='expense',patternRules={}){
 const today=String(asOf||new Date().toLocaleDateString('en-CA')).slice(0,10);
 const all=(Array.isArray(transactions)?transactions:[]).filter(t=>!skip(t)&&t.date<=today);
 const expenseMode=mode==='expense';
 const match=t=>t.type===mode&&(expenseMode?t.category===category:mode==='transfer'?t.cashDirection==='out':true);
 const actualRows=all.filter(t=>match(t)&&t.date.slice(0,7)===month);
 const actual=round(actualRows.reduce((a,t)=>a+Number(t.amount),0));
 const result={actual,additional:0,projectedTotal:actual,expected:[],recurring:0,variable:0,
  recurringDetails:[],historyMonths:[],method:'No dated predictions',
  unscheduled:{estimate:0,min:0,max:0,confidence:'Unknown',includedInDatedTotal:false},
  diagnostics:{candidateCount:0,patternCount:0,lookbackMonths:24}};
 if(month<today.slice(0,7))return result;
 const past=coverage(all,today.slice(0,7));
 result.historyMonths=past;
 const forced=Object.entries(patternRules||{}).some(([key,value])=>value?.mode==='monthly'&&
   key.startsWith([mode,category||'Income'].map(encodeURIComponent).join('|')+'|'));
 const lastMonth=shiftMonth(today.slice(0,7),-1),previousMonth=shiftMonth(today.slice(0,7),-2);
 const syncGap=!past.includes(lastMonth)&&past.includes(previousMonth)&&past.length>=4;
 if(!forced&&(past.length<2||(!past.includes(lastMonth)&&!syncGap))){
  result.method='Insufficient recent account history; no reliable dated schedule';
  return result;
 }
 if(syncGap){result.diagnostics.warning='Recent complete month missing: possible sync gap. Predictions are provisional and need review';
  result.diagnostics.syncGap=true;}
 const windowStart=shiftMonth(today.slice(0,7),-24);
 const records=all.filter(t=>match(t)&&t.date<=today&&t.date>=windowStart);
 const groups=new Map();
 for(const t of records){
  const key=accountKey(t)+'|'+normalize(t.merchant);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(t);
 }
 let candidates=[];
 const make=(group,slot,date,amount,cadence,obs,observedMonths,relativeSpread=0,dateSpread=0,extra={})=>{
  const stable=round(amount);if(!(stable>0)||!validDate(date))return;
  const id=['hist',month,category||'Income',encodeURIComponent(accountKey(group[0])),encodeURIComponent(normalize(group[0].merchant)),slot].join('|');
  return {id,merchant:group[0].merchant,account:accountKey(group[0]),category:category||'Income',
   type:mode,cashDirection:mode==='transfer'?'out':undefined,date,amount:stable,cadence,
   confidence:confidence(obs,observedMonths,relativeSpread,dateSpread,cadence),
   evidence:observedMonths,observations:obs,source:'historical',pattern:{day:Number(date.slice(8,10)),amount:stable},
   slot,seasonal:Boolean(extra.seasonal),groupKey:accountKey(group[0])+'|'+normalize(group[0].merchant)};
 };
 // Confirmation is reusable as long as the new evidence still resembles the
 // reviewed pattern. Changed cadence/date/amount reopens an uncertainty review.
 function applyTrustedEvidence(items,directive,key){
  if(directive?.mode!=='trust')return;
  for(const item of items){
   item.patternKey=key;
   const dayGap=Math.abs(Number(item.date.slice(8,10))-Number(directive.day));
   const amountGap=Math.abs(item.amount-Number(directive.amount))/Math.max(1,Number(directive.amount));
   const matches=item.cadence===directive.cadence&&dayGap<=3&&amountGap<=
     (item.category==='Utilities'?.55:.25);
   if(matches){item.confidence='Confirmed';item.learnedRule=true;}
   else {item.ruleChanged=true;item.ruleReason='The repeating pattern changed since your last confirmation';}
  }
 }
 const monthRecords=(rows,selectedMonth)=>rows.filter(t=>t.date.slice(0,7)===selectedMonth);
 function detectInterval(group){
  // Weekly/biweekly evidence must be based on a sequence (not count per month).
  const recent=group.filter(t=>t.date>=shiftMonth(today.slice(0,7),-4));
  if(recent.length<5)return false;
  const gaps=recent.slice(1).map((t,i)=>dayDiff(t.date,recent[i].date)).filter(n=>n>0);
  if(gaps.length<4)return false;
  let best=null;
  for(const period of [7,14]){
   const tolerance=mode==='income'?(period===7?2:4):period===7?1:2;
   const regular=gaps.filter(g=>Math.abs(g-period)<=tolerance).length;
   const nearMultiples=gaps.filter(g=>[1,2,3].some(k=>Math.abs(g-period*k)<=tolerance)).length;
   const standard=regular/gaps.length>=.70&&nearMultiples/gaps.length>=.88;
   const resilient=recent.length>=6&&regular/gaps.length>=.55&&nearMultiples/gaps.length>=.79;
   if(standard||resilient){best=period;break}
  }
  if(!best)return false;
  const amounts=recent.map(t=>Number(t.amount)),mid=median(amounts);
  const variability=Math.max(...amounts.map(a=>Math.abs(a-mid)/mid));
  const bill=mode==='income'||mode==='transfer'||group.some(likelyBill);
  if(variability>(bill?.6:.33))return false;
  const last=recent[recent.length-1];
  const stale=dayDiff(today,last.date)>best*2+4;
  if(dayDiff(today,last.date)>(syncGap?best*4+5:best*3+3))return false;
  const months=new Set(recent.map(t=>t.date.slice(0,7))).size;
  let cursor=last.date,n=0;
  while(n<25){
   cursor=addDays(cursor,best);
   if(cursor.slice(0,7)>month)break;
   if(cursor>today&&cursor.slice(0,7)===month){
    const c=make(group,'interval'+best+'-'+n,cursor,mid,best===7?'weekly':'every 2 weeks',recent.length,months,variability,0);
    if(c){if(stale||syncGap){c.confidence='Medium';c.historyGap=true;c.warning='Intermittent or missing recent transactions; confirm schedule';}candidates.push(c);}
   }
   n++;
  }
  return true;
 }
 function detectMonthly(group){
  // Anchor cadence to the most recent completed calendar months. Permit one
  // isolated missing billing month ONLY when longer source evidence supports
  // it, and flag the resulting estimate for Review instead of asserting High.
  const relevant=group.filter(t=>t.date>=shiftMonth(today.slice(0,7),-8)&&t.date<today.slice(0,7)+'-01');
  const observed=[...new Set(relevant.map(t=>t.date.slice(0,7)))].sort();
  if(observed.length<2)return;
  const bill=mode==='income'||mode==='transfer'||group.some(likelyBill);
  const latest=observed[observed.length-1];
  const lastGap=monthIndex(today.slice(0,7))-monthIndex(latest);
  if(lastGap>2)return;
  const byMonth=new Map(observed.map(m=>[m,monthRecords(relevant,m).sort((a,b)=>a.date.localeCompare(b.date))]));
  const recentMonths=observed.slice(-3);
  const consecutive=recentMonths.every((m,i)=>i===0||monthIndex(m)-monthIndex(recentMonths[i-1])===1);
  const fullRecent=lastGap===1&&consecutive;
  const counts=recentMonths.map(m=>byMonth.get(m).length);
  const count=counts[0];
  if(!count||count>5||counts.some(n=>n!==count))return;
  const historyGap=!fullRecent||recentMonths.length<3;
  if(historyGap&&(!bill||count!==1||observed.length<3||
      monthIndex(recentMonths[recentMonths.length-1])-monthIndex(recentMonths[0])>5))return;
  if(!bill&&(observed.length<3||!fullRecent))return;
  for(let slot=0;slot<count;slot++){
   const stableMonths=!bill&&observed.length>=5?observed.slice(-6):recentMonths;
   if(!bill&&observed.length>=5&&(
      monthIndex(stableMonths[stableMonths.length-1])-monthIndex(stableMonths[0])>6||
      stableMonths.some(m=>byMonth.get(m).length!==count)))continue;
   const rows=stableMonths.map(m=>byMonth.get(m)[slot]);
   const days=rows.map(t=>Number(t.date.slice(8,10)));
   const amounts=rows.map(t=>Number(t.amount)),mid=median(amounts);
   const dateSpread=Math.max(...days)-Math.min(...days);
   const variability=Math.max(...amounts.map(v=>Math.abs(v-mid)/mid));
   const nearFixed=variability<=.02;
   if(dateSpread>(bill?8:(!bill&&observed.length>=5?2:3))||
      variability>(bill?.75:(!bill&&observed.length>=5?.25:.4)))continue;
   const seasonal=seasonalAmount(group,month,mid,category==='Utilities');
   const endMonth=rows.every(t=>endDay(t.date.slice(0,7))-Number(t.date.slice(8,10))<=2);
   const due=endMonth?endDay(month):Math.min(endDay(month),Math.round(median(days)));
   const date=month+'-'+String(due).padStart(2,'0');
   const observedMonths=new Set(group.map(t=>t.date.slice(0,7))).size;
   const candidate=make(group,slot,date,seasonal.amount,count===1?'monthly':count===2?'twice monthly':count+' / month',
    Math.floor(group.length/Math.max(1,count)),observedMonths,variability,dateSpread,seasonal);
   if(candidate){
    if(historyGap||syncGap||dateSpread>5){
     candidate.confidence='Medium';candidate.historyGap=Boolean(historyGap||syncGap);
     candidate.warning=historyGap?'One or more months of this billing pattern are missing; verify it continues':
      syncGap?'Bank history may be incomplete':'Posting date has shifted; verify next charge date';
    }
    candidates.push(candidate);
   }
  }
 }
 function detectLongCycle(group){
  if(group.length<2)return;
  const months=[...new Set(group.map(t=>t.date.slice(0,7)))].sort();
  if(months.length<2)return;
  const gaps=months.slice(1).map((m,i)=>monthIndex(m)-monthIndex(months[i]));
  for(const [span,label] of [[3,'quarterly'],[6,'semiannual'],[12,'annual']]){
   // Annual needs two occurrences one year apart; shorter cycles need
   // three and consistent intervals to avoid classifying random purchases.
   if(months.length<(span===12?2:3)||gaps.some(g=>g!==span))continue;
   const mostRecent=months[months.length-1];
   if(monthIndex(month)-monthIndex(mostRecent)<span||(monthIndex(month)-monthIndex(mostRecent))%span!==0)continue;
   if(group.some(t=>!likelyBill(t))&&mode!=='income')continue; // long cycles need bill evidence
   const amounts=group.map(t=>Number(t.amount)),mid=median(amounts);
   const variability=Math.max(...amounts.map(v=>Math.abs(v-mid)/mid));
   const days=group.map(t=>Number(t.date.slice(8,10)));
   const dateSpread=Math.max(...days)-Math.min(...days);
   if(variability>.60||dateSpread>7)continue;
   const endMonth=group.every(t=>endDay(t.date.slice(0,7))-Number(t.date.slice(8,10))<=2);
   const due=endMonth?endDay(month):Math.min(endDay(month),Math.round(median(days)));
   const date=month+'-'+String(due).padStart(2,'0');
   const candidate=make(group,label,date,mid,label,group.length,months.length,variability,dateSpread);
   if(candidate)candidates.push(candidate);
   return;
  }
 }
 for(const group of groups.values()){
  group.sort((a,b)=>a.date.localeCompare(b.date));
  const key=normalize(group[0].merchant);
  if(!key)continue;
  const keyOfRule=[mode,category||'Income',accountKey(group[0]),key].map(encodeURIComponent).join('|');
  const directive=patternRules[keyOfRule];
  if(directive?.mode==='none')continue;
  if(directive?.mode==='monthly'){
   const day=Number(directive.day),amount=Number(directive.amount);
   if(day>=1&&day<=31&&Number.isFinite(amount)&&amount>0){
    const date=month+'-'+String(Math.min(endDay(month),day)).padStart(2,'0');
    const item=make(group,0,date,amount,'monthly',group.length,new Set(group.map(x=>x.date.slice(0,7))).size,0,0);
    if(item){item.confidence='Confirmed';item.manualRule=true;item.patternKey=keyOfRule;candidates.push(item);}
   }
   continue;
  }
  if(group.length<2)continue;
  // Trust the recurring behavior, not a forever-frozen estimate. The model
  // continues learning future amounts and dates from new source transactions.
  const beforeDetected=candidates.length;
  // A genuine two-paydays-per-month schedule stays anchored to calendar days;
  // a true biweekly schedule drifts across months and uses 14-day intervals.
  const recentThree=[...new Set(group.filter(t=>t.date>=shiftMonth(today.slice(0,7),-3)&&t.date<today.slice(0,7)+'-01').map(t=>t.date.slice(0,7)))].sort();
  const anchoredTwice=recentThree.length===3&&recentThree.every(m=>group.filter(t=>t.date.slice(0,7)===m).length===2)&&
    [0,1].every(slot=>{
      const days=recentThree.map(m=>group.filter(t=>t.date.slice(0,7)===m).sort((a,b)=>a.date.localeCompare(b.date))[slot]).map(t=>Number(t.date.slice(8,10)));
      return Math.max(...days)-Math.min(...days)<=2;
    });
  if(anchoredTwice){
   const before=candidates.length;detectMonthly(group);
   if(candidates.length>before){
    applyTrustedEvidence(candidates.slice(beforeDetected),directive,keyOfRule);
    continue;
   }
  }
  // For 4/5 weekly occurrences, interval detection must precede monthly slots.
  if(detectInterval(group)){
   applyTrustedEvidence(candidates.slice(beforeDetected),directive,keyOfRule);
   continue;
  }
  const countBefore=candidates.length;
  detectMonthly(group);
  if(candidates.length===countBefore)detectLongCycle(group);
  applyTrustedEvidence(candidates.slice(beforeDetected),directive,keyOfRule);
 }
 result.diagnostics.candidateCount=candidates.length;
 result.diagnostics.patternCount=groups.size;
 // One-to-one posted matching, per account and merchant, prevents duplicate
 // predictions after an early/late actual payment.
 const taken=new Set(),expected=[];
 for(const c of candidates.sort((a,b)=>a.date.localeCompare(b.date)||a.merchant.localeCompare(b.merchant))){
  let best=null,bestDistance=Infinity;
  for(const t of actualRows){
   if(taken.has(t.id)||accountKey(t)!==c.account||normalize(t.merchant)!==normalize(c.merchant))continue;
   const distance=Math.abs(dayDiff(t.date,c.date));
   const tolerance=c.cadence==='weekly'?2:c.cadence==='every 2 weeks'?3:7;
   const ratio=Math.abs(Number(t.amount)-c.amount)/Math.max(1,c.amount);
   if(distance<=tolerance&&ratio<.85&&distance<bestDistance){best=t;bestDistance=distance}
  }
  if(best){taken.add(best.id);continue}
  if(c.date<=today)continue;
  expected.push(c);
 }
 result.expected=expected;
 result.additional=round(expected.reduce((n,t)=>n+t.amount,0));
 result.projectedTotal=round(actual+result.additional);
 result.recurring=result.additional;
 result.recurringDetails=expected.map(t=>({merchant:t.merchant,amount:t.amount,day:Number(t.date.slice(8,10)),date:t.date}));
 // Irregular expenses may still occur. This is an explicitly UNSCHEDULED risk
 // band, not a fictional dated transaction or part of the hot-pink bar.
 if(expenseMode&&past.length>=3){
  const lastMonths=past.slice(-6);
  const totals=lastMonths.map(m=>all.filter(t=>match(t)&&t.date.slice(0,7)===m).reduce((n,t)=>n+Number(t.amount),0));
  const scheduledMean=lastMonths.map(m=>records.filter(t=>t.date.slice(0,7)===m&&
    groups.has(accountKey(t)+'|'+normalize(t.merchant))&&
    // Only subtract the most recent monthly bill-like patterns; irregular
    // everyday merchants remain part of unscheduled risk.
    likelyBill(t)).reduce((n,t)=>n+Number(t.amount),0));
  const residual=totals.map((v,i)=>Math.max(0,v-scheduledMean[i]));
  const remaining=Math.max(0,endDay(month)-Number(today.slice(8,10)))/endDay(month);
  result.unscheduled={estimate:round(median(residual)*remaining),
   min:round(Math.min(...residual)*remaining),max:round(Math.max(...residual)*remaining),
   confidence:'Low',includedInDatedTotal:false,
   method:'Historical variable-spending range; unscheduled, not an exact payment'};
 }
 result.method='Dated recurring patterns using up to 24 months; confidence labels are heuristics';
 return result;
}
function forecast(transactions,month,category,todayDate,patternRules){return infer(transactions,month,category,todayDate,'expense',patternRules)}
function forecastIncome(transactions,month,todayDate,patternRules){return infer(transactions,month,null,todayDate,'income',patternRules)}
function forecastTransfers(transactions,month,todayDate,patternRules){return infer(transactions,month,null,todayDate,'transfer',patternRules)}
function patternKey(type,category,account,merchant){return [type,category,account,normalize(merchant)].map(encodeURIComponent).join('|')}
const api={forecast,forecastIncome,forecastTransfers,infer,patternKey};
root.HouseholdForecast=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
