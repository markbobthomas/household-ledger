'use strict';
// A SECOND, history-derived read-only projection. No Ledger future events,
// recurring rules or projected series enter the inference step.
// Reconcile the result with canonical Ledger only AFTER independent inference.
const {cleanDescription}=require('./ai-private-adapter.cjs');
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const valid=s=>typeof s==='string'&&DATE.test(s)&&
 !Number.isNaN(Date.parse(s+'T12:00:00Z'))&&
 new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const ms=s=>Date.parse(s+'T12:00:00Z');
const day=(s,offset)=>new Date(ms(s)+offset*86400000).toISOString().slice(0,10);
const cents=n=>Math.round((n+Number.EPSILON)*100)/100;
const dollars=n=>'$'+cents(n).toFixed(2);
const label=s=>cleanDescription(String(s||'Unidentified')).slice(0,65);
const abs=n=>Math.abs(Number(n)||0);
const rangeMedian=values=>values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];
const monthAdvance=(date,offset,anchor)=>{
 const d=new Date(ms(date)),year=d.getUTCFullYear(),month=d.getUTCMonth()+offset;
 const y=year+Math.floor(month/12),m=((month%12)+12)%12;
 const end=new Date(Date.UTC(y,m+1,0)).getUTCDate();
 return y+'-'+String(m+1).padStart(2,'0')+'-'+String(Math.min(anchor,end)).padStart(2,'0');
};
function inferCadence(rows){
 if(rows.length<3)return null;
 const recent=rows.slice(-8).sort((a,b)=>a.date.localeCompare(b.date));
 const dates=recent.map(x=>x.date);
 const gaps=dates.slice(1).map((x,i)=>Math.round((ms(x)-ms(dates[i]))/86400000));
 if(gaps.some(g=>g<2))return null;
 const median=rangeMedian(gaps),tolerance=3;
 const options=[7,14,28];
 const fits=options.map(interval=>({days:interval,matched:gaps.filter(g=>Math.abs(g-interval)<=tolerance).length}))
  .filter(x=>x.matched>=gaps.length-1&&Math.abs(median-x.days)<=tolerance)
  .sort((a,b)=>b.matched-a.matched);
 let cadence=fits[0]?{kind:'days',days:fits[0].days}:null;
 const monthlyGaps=dates.slice(1).map((d,i)=>{
  const [ay,am]=dates[i].split('-').map(Number),[by,bm]=d.split('-').map(Number);
  return (by-ay)*12+(bm-am);
 });
 const anchor=Number(dates.at(-1).slice(8));
 const monthly=monthlyGaps.length>=2&&monthlyGaps.every(x=>x===1)&&
  dates.every(d=>Math.abs(Number(d.slice(8))-anchor)<=4||
   Number(d.slice(8))===new Date(Date.UTC(Number(d.slice(0,4)),Number(d.slice(5,7)),0)).getUTCDate());
 if(monthly&&(!cadence||cadence.days===28))cadence={kind:'monthly',days:30};
 if(!cadence)return null;
 const previous=recent.at(-1).date;
 const freshness=(ms(previous)-ms(recent.at(-2).date))/86400000;
 return {...cadence,observations:recent,anchor,medianGap:median,latest:previous,
  typicalGap:freshness};
}
function patternAmounts(rows,cadence){
 const v=rows.map(x=>abs(x.amount));
 const median=rangeMedian(v),close=(a,b)=>Math.abs(a-b)<=Math.max(15,b*.18);
 if(v.every(x=>close(x,median)))return {amounts:[cents(rangeMedian(v.slice(-4)))],alternating:false};
 // Alternating biweekly deposits: two FOUR-week streams (same payer, 14d apart).
 if(cadence.kind==='days'&&cadence.days===14&&v.length>=4){
  const evens=v.filter((_,i)=>i%2===0),odds=v.filter((_,i)=>i%2===1);
  if(evens.length>=2&&odds.length>=2&&
   evens.every(x=>close(x,rangeMedian(evens)))&&
   odds.every(x=>close(x,rangeMedian(odds))))
   return {amounts:[cents(rangeMedian(evens)),cents(rangeMedian(odds))],alternating:true,
    phase:rows.length%2};
 }
 return null;
}
function historicalStreams(context,{horizon=90}={}){
 const asOf=context.asOf;
 const primary=context.primary?.id;
 const sourceAccount=[...context.privateIds].find(([,alias])=>alias===primary)?.[0];
 if(!primary||sourceAccount==null)return {streams:[],scope:'no primary checking account'};
 const groups=new Map();
 const posted=(context.source.history||[]).filter(t=>t&&t.accountId!=null&&
  String(t.accountId)===sourceAccount&&valid(t.date)&&t.date<=asOf&&
  typeof t.amount==='number'&&Number.isFinite(t.amount)&&abs(t.amount)>0&&
  !t.pending&&(['income','expense'].includes(String(t.type||'').toLowerCase())||
   (String(t.type||'').toLowerCase()==='transfer'&&
    String(t.cashDirection||'').toLowerCase()==='in'&&!t.pairedTransactionId)));
 for(const row of posted){
  const unpairedIncoming=String(row.type).toLowerCase()==='transfer';
  const kind=unpairedIncoming?'income':String(row.type).toLowerCase(),
   merchant=label(row.merchant||row.description);
  const group=kind+'|'+merchant.toLowerCase();
  const rows=groups.get(group)||{kind,merchant,unpairedIncoming,rows:[]};
  rows.unpairedIncoming=Boolean(rows.unpairedIncoming||unpairedIncoming);
  rows.rows.push(row);groups.set(group,rows);
 }
 const streams=[];
 for(const g of groups.values()){
  const rows=g.rows.sort((a,b)=>a.date.localeCompare(b.date));
  // Do not infer recurring discretionary transactions from retail/grocery frequency.
  if(g.kind==='expense'&&/(grocer|restaurant|food|cafe|shopping|retail|fuel|gas station|amazon|target|walmart|costco)/i.test(
   g.merchant+' '+rows.at(-1).category))continue;
  if(rows.length<(g.kind==='income'?3:4))continue;
  const recent=rows.slice(-8),cadence=inferCadence(recent);
  if(!cadence)continue;
  const amounts=patternAmounts(cadence.observations,cadence);
  if(!amounts)continue;
  const maxAge=cadence.kind==='monthly'?65:cadence.days*2+6;
  if((ms(asOf)-ms(cadence.latest))/86400000>maxAge)continue;
  const predicted=[];
  let next=cadence.latest,i=0;
  const horizonDate=day(asOf,horizon);
  while(i++<Math.ceil(horizon/5)+4){
   next=cadence.kind==='monthly'?monthAdvance(cadence.latest,i,cadence.anchor):
    day(cadence.latest,i*cadence.days);
   if(next>horizonDate)break;
   if(next<=asOf)continue;
   const amount=amounts.alternating?
    amounts.amounts[(cadence.observations.length-1+i)%2]:amounts.amounts[0];
   predicted.push({date:next,amount,kind:g.kind,merchant:g.merchant,sourceCount:recent.length});
  }
  if(!predicted.length)continue;
  streams.push({kind:g.kind,merchant:g.merchant,
   classification:g.unpairedIncoming?'unconfirmed-unpaired-incoming-transfer':'classified-income-or-expense',
   cadence:cadence.kind==='monthly'?'monthly':'every-'+cadence.days+'-days',
   observations:recent.length,lastPosted:cadence.latest,alternating:amounts.alternating,
   amountPattern:amounts.amounts,predicted,firstDate:recent[0].date});
 }
 return {streams:streams.sort((a,b)=>a.kind.localeCompare(b.kind)||a.merchant.localeCompare(b.merchant)),
  postedExamined:posted.length,sourceAccount,asOf,horizon,scope:'Primary checking posted history only; excludes transfers, credit cards, ambiguous credits, pending and nonrecurring costs'};
}
function createComparison(context,{horizon=90}={}){
 horizon=Math.min(90,Math.max(30,horizon));
 const asOf=context.asOf,end=day(asOf,horizon),inferred=historicalStreams(context,{horizon});
 const projection=context.source.projection,account=projection.accounts.find(
  a=>context.privateIds.get(String(a.id))===context.primary?.id);
 const anchor=context.primary?.available??context.primary?.opening;
 const ledgerSeries=(account?.series||[]).filter(x=>valid(x.date)&&x.date>=asOf&&x.date<=end&&Number.isFinite(x.balance));
 const byLedgerDay=new Map(ledgerSeries.map(x=>[x.date,cents(x.balance)]));
 const events=(projection.events||[]).filter(e=>
  e&&String(e.accountId)===String(inferred.sourceAccount)&&valid(e.date)&&
  e.date>asOf&&e.date<=day(end,3)&&Number.isFinite(e.amount));
 const expectedIncome=events.filter(e=>String(e.kind).toLowerCase()==='income');
 const estimatedIncome=inferred.streams.filter(s=>s.kind==='income').flatMap(s=>s.predicted);
 const matchedEvents=new Set(),matches=[],uncovered=[],amountDiff=[];
 for(const p of estimatedIncome){
  const possible=expectedIncome.map((event,i)=>({event,i,diff:Math.abs(ms(event.date)-ms(p.date))/86400000}))
   .filter(x=>x.diff<=3&&!matchedEvents.has(x.i)).sort((a,b)=>a.diff-b.diff||
    abs(a.event.amount-p.amount)-abs(b.event.amount-p.amount));
  const match=possible[0];
  if(!match){
   uncovered.push({date:p.date,amount:p.amount,merchant:p.merchant,
    reason:'Historical incoming pattern has no matching Ledger income event within three days'});
   continue;
  }
  matchedEvents.add(match.i);
  const discrepancy=abs(match.event.amount-p.amount)>Math.max(20,p.amount*.15);
  const detail={date:p.date,independentAmount:p.amount,
   ledgerDate:match.event.date,ledgerAmount:cents(abs(match.event.amount)),
   merchant:p.merchant,shiftDays:match.diff,
   interpretation:match.diff?'Ledger may shift deposit dates for business-day scheduling':'Dates align'};
  matches.push(detail);
  if(discrepancy)amountDiff.push({...detail,
   reason:'Same-date income has a materially different amount; a saved override or pay variability may explain it'});
 }
 const ledgerOnly=expectedIncome.map((e,i)=>({e,i})).filter(x=>!matchedEvents.has(x.i)&&x.e.date<=end)
  .map(({e})=>({date:e.date,amount:cents(abs(e.amount)),
   merchant:label(e.merchant),reason:'Ledger forecasts income without enough matching repeated posted-history evidence; planned or manually confirmed income may be correct'}));
 const ledgerIncome90=cents(expectedIncome.filter(x=>x.date<=end).reduce((s,x)=>s+abs(x.amount),0));
 const histIncome90=cents(estimatedIncome.reduce((s,x)=>s+x.amount,0));
 const increments=new Map();
 for(const stream of inferred.streams)for(const p of stream.predicted)
  increments.set(p.date,cents((increments.get(p.date)||0)+(p.kind==='income'?p.amount:-p.amount)));
 const data=[];
 let balance=Number.isFinite(anchor)?cents(anchor):null;
 for(let i=0;i<=horizon;i++){
  const d=day(asOf,i);
  if(i>0&&balance!==null)balance=cents(balance+(increments.get(d)||0));
  const ledger=byLedgerDay.get(d);
  if(balance!==null&&Number.isFinite(ledger))data.push({date:d,independent:balance,ledger});
 }
 const initial=Number.isFinite(anchor)?cents(anchor):null;
 const indieLow=data.length?data.reduce((a,b)=>a.independent<=b.independent?a:b):null;
 const ledgerLow=data.length?data.reduce((a,b)=>a.ledger<=b.ledger?a:b):null;
 const meaningfulHistory=inferred.streams.length>0;
 const sampleCount=inferred.streams.filter(s=>s.kind==='income').length;
 const reliability=sampleCount>0?'limited-historical-recurrence':'insufficient-independent-income-evidence';
 const flags=[
  ...uncovered.map(x=>({...x,kind:'potential-uncovered-income'})),
  ...amountDiff.map(x=>({...x,kind:'amount-difference'})),
  ...ledgerOnly.map(x=>({...x,kind:'ledger-only-income'}))
 ];
 // These facts are safe: no raw account IDs, bank record IDs, hidden credentials,
 // or client-submitted forecast events appear in the independent presentation.
 const facts=[];
 const add=t=>facts.push({id:'independent-'+(facts.length+1),kind:'independent-validation',text:t.slice(0,500)});
 add('Independent posted-history model as of '+asOf+' for '+context.primary?.id+
  ': uses '+inferred.postedExamined+' settled checking historical income/expense and unpaired incoming credit rows; inferred '+
  inferred.streams.length+' regular streams ('+sampleCount+' possible incoming streams). Credit card purchases and PAIRED internal transfers are excluded; unpaired incoming credits can be modeled provisionally but are NOT verified earned income.');
 add('Next '+horizon+' days: history-derived recurring income '+dollars(histIncome90)+
  ' vs Ledger already scheduled income '+dollars(ledgerIncome90)+'. Income matched '+
  matches.length+', history-pattern income with no Ledger match '+uncovered.length+
  ', significantly different amounts '+amountDiff.length+
  ', Ledger-only forecast incomes '+ledgerOnly.length+'.');
 if(indieLow&&ledgerLow)add('Independent recurrence-only primary checking low '+dollars(indieLow.independent)+
  ' on '+indieLow.date+' versus Ledger projected low '+dollars(ledgerLow.ledger)+
  ' on '+ledgerLow.date+'. DIFFERENT COVERAGE: history model omits all unlearned one-time, card settlement, transfers and variable expenses; neither low validates the other.');
 for(const s of inferred.streams.slice(0,24)){
  add('Historical '+s.kind+' stream '+s.merchant+' '+s.cadence+
   '; classification '+s.classification+
   '; observed '+s.observations+' posted examples from '+s.firstDate+' through '+s.lastPosted+
   '; predicted amounts '+s.amountPattern.map(dollars).join(' alternating ')+
   '; future occurrences '+s.predicted.length+' from '+s.predicted[0].date+
   ' through '+s.predicted.at(-1).date+'; evidence from posted bank history, NOT Ledger future rules.');
 }
 for(const item of uncovered.slice(0,30))add('Potential income coverage gap '+item.date+
  ' '+dollars(item.amount)+' '+item.merchant+
  '. This is a historical recurrence inference, not a confirmed missing deposit; inspect Ledger rules and bank classifications.');
 for(const item of amountDiff.slice(0,20))add('Income amount difference historical '+item.date+
  ' '+dollars(item.independentAmount)+' versus Ledger '+item.ledgerDate+' '+dollars(item.ledgerAmount)+
  '; a manual forecast or changed payroll may make Ledger correct.');
 for(const item of ledgerOnly.slice(0,20))add('Ledger-only income '+item.date+' '+dollars(item.amount)+
  ' '+item.merchant+'; independent history has insufficient repeating evidence. This is NOT proof of an erroneous Ledger forecast.');
 const sampled=data.filter((p,i)=>i%Math.max(1,Math.floor(horizon/70))===0||i===data.length-1||
  p.date===indieLow?.date||p.date===ledgerLow?.date);
 return {asOf,horizon,primary:context.primary?.id||null,modelStatus:reliability,
  independentModel:'Posted-history recurring checking deposits and stable checking expenses. Unpaired ACH/transfer credits are provisional, not confirmed payroll. No Ledger future payments or recurring rules are inputs.',
  coverageNotice:'The independent line is a recurrence-only stress check, NOT a complete alternative balance forecast. Unpaired incoming transfer patterns are provisional, not verified earnings. Ledger includes confirmed scheduled events, card settlements and transfers; differences do not establish which is correct.',
  ledgerIncome:ledgerIncome90,independentIncome:histIncome90,
  ledgerLow:ledgerLow?{amount:ledgerLow.ledger,date:ledgerLow.date}:null,
  independentLow:indieLow?{amount:indieLow.independent,date:indieLow.date}:null,
  anchor:initial,streams:inferred.streams.map(s=>({
   kind:s.kind,cadence:s.cadence,merchant:s.merchant,
   classification:s.classification,observations:s.observations,
   alternating:s.alternating,amountPattern:s.amountPattern,lastPosted:s.lastPosted,
   projectedCount:s.predicted.length})),
  totals:{historicalStreams:inferred.streams.length,incomeStreams:sampleCount,
   unconfirmedIncomeStreams:inferred.streams.filter(s=>s.kind==='income'&&
    s.classification==='unconfirmed-unpaired-incoming-transfer').length,
   matchedIncome:matches.length,uncoveredIncome:uncovered.length,
   differingAmounts:amountDiff.length,ledgerOnlyIncome:ledgerOnly.length,
   incomeInferredOccurrences:estimatedIncome.length,postedExamined:inferred.postedExamined},
  matched:matches.slice(0,60),differences:flags.slice(0,65),
  dataPoints:sampled.map(p=>({label:p.date,value:p.ledger,alternateValue:p.independent})),
  facts};
}
module.exports={createComparison,historicalStreams,inferCadence,patternAmounts};
