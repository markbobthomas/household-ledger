/* Phase 4 · Read-only historical prediction laboratory.
 * Walk-forward evaluation on fictional, ground-truth-labeled transactions.
 * Training data is strictly <= each as-of date and strips evaluation labels.
 * No interaction with localStorage, bank data, Plaid, or writable ledger APIs.
 */
(function(root){
'use strict';
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const isoDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const shiftDays=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const daysApart=(a,b)=>Math.abs((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
const normal=s=>String(s||'').toLowerCase().trim().replace(/\s+/g,' ');
const account=t=>String(t.account||t.accountId||'Unknown');
const mean=(sum,n)=>n?round(sum/n):null;
const pct=(a,b)=>b?round(a/b*100):null;
const CASH_DAYS=[30,60,90];
// A month-start walk-forward test is easy to reproduce and deliberately
// provides less information than a model run midway through the month.
const DEFAULT_SNAPSHOTS=Array.from({length:12},(_,i)=>{
 const d=new Date(Date.UTC(2025,7+i,1,12));
 return d.toISOString().slice(0,10);
});
function createBin(label){return {label,forecast:0,actual:0,matched:0,missed:0,false:0,dateError:0,amountError:0,
 matchedExpenseAmount:0,matchedAmountErrors:[],matchedDateErrors:[]}}
function recordMatched(bin,p,a){
 const dateDiff=daysApart(p.date,a.date),amountDiff=Math.abs(Number(p.amount)-Number(a.amount));
 bin.matched++;bin.dateError+=dateDiff;bin.amountError+=amountDiff;
 bin.matchedDateErrors.push(dateDiff);bin.matchedAmountErrors.push(amountDiff);
 if(a.type==='expense')bin.matchedExpenseAmount+=Number(a.amount);
}
function binSummary(b){
 return {name:b.label,predicted:b.forecast,actualRecurring:b.actual,matched:b.matched,
  falsePredictions:b.false,missedRecurring:b.missed,precision:pct(b.matched,b.forecast),recall:pct(b.matched,b.actual),
  averageDateErrorDays:mean(b.dateError,b.matched),averageAmountError:mean(b.amountError,b.matched),
  matchedExpenseAmount:round(b.matchedExpenseAmount)};
}
function eventTolerance(p){
 return p.cadence==='weekly'?2:p.cadence==='every 2 weeks'?3:5;
}
function matchEvents(predicted,actuals){
 // Exact merchant/account/type, then smallest posting-date difference,
 // with each source charge matched at most once. Never match to a
 // nonrecurring purchase simply to make the statistics appear better.
 const pairs=[];
 for(let i=0;i<predicted.length;i++)for(let j=0;j<actuals.length;j++){
  const p=predicted[i],a=actuals[j];
  if(p.type!==a.type||normal(p.merchant)!==normal(a.merchant)||account(p)!==account(a))continue;
  const gap=daysApart(p.date,a.date);
  if(gap<=eventTolerance(p))pairs.push({i,j,gap,amountGap:Math.abs(p.amount-a.amount)});
 }
 pairs.sort((a,b)=>a.gap-b.gap||a.amountGap-b.amountGap||a.i-b.i||a.j-b.j);
 const usedP=new Set(),usedA=new Set(),matched=[];
 for(const p of pairs){
  if(usedP.has(p.i)||usedA.has(p.j))continue;
  usedP.add(p.i);usedA.add(p.j);matched.push({predicted:predicted[p.i],actual:actuals[p.j],dateError:p.gap,amountError:p.amountGap});
 }
 return {matched,unmatchedPredictions:predicted.filter((p,i)=>!usedP.has(i)),
   missedActuals:actuals.filter((a,i)=>!usedA.has(i))};
}
function cleanForPrediction(t){
 // Explicit allowlist: no ground-truth recurring flag, future settlement,
 // evaluation metadata, synthetic opening-balance hints, or hidden labels.
 return {id:t.id,date:t.date,merchant:t.merchant,description:t.description,amount:t.amount,
   category:t.category,type:t.type,account:t.account,accountId:t.accountId,pending:Boolean(t.pending),
   cashDirection:t.cashDirection,
   source:{provider:'scenario',verified:false}};
}
function cashImpact(t){
 const amount=Number(t.amount)||0;
 // Fixture transfer is a Checking cash withdrawal, not spending. It still
 // affects realized cash balance, exposing a model's transfer omission.
 return t.type==='income'||(t.type==='transfer'&&t.cashDirection==='in')?amount:
   t.type==='expense'||(t.type==='transfer'&&t.cashDirection==='out')?-amount:0;
}
function addMetrics(bin,match,forecastCount,actualCount){
 bin.forecast+=forecastCount;bin.actual+=actualCount;
 bin.false+=match.unmatchedPredictions.length;bin.missed+=match.missedActuals.length;
 for(const pair of match.matched)recordMatched(bin,pair.predicted,pair.actual);
}
function evaluateFold(opts){
 const {transactions,asOf,forecast,ledger,dataModel,horizon=90,initialBalance=18000,baselineDate='2024-09-30',cashAccount='Checking'}=opts;
 if(!isoDate(asOf)||!Number.isInteger(horizon)||horizon<30||horizon>90)throw Error('Invalid evaluation window');
 if(!Array.isArray(transactions)||!forecast||!ledger||!dataModel)throw Error('Missing fixture and prediction modules');
 const until=shiftDays(asOf,horizon);
 if(transactions.some(t=>!isoDate(t.date)))throw Error('Fixture contains invalid dates');
 if(!transactions.some(t=>t.date>asOf&&t.date<=until))throw Error('No future actuals to score');
 const past=transactions.filter(t=>t.date<=asOf).map(cleanForPrediction);
 const futureActual=transactions.filter(t=>t.date>asOf&&t.date<=until);
 // The genuine forecast receives ONLY transactions known on the historical
 // date and has no access to scenarioTruth, future records or future balance.
 const temporary=dataModel.migrate({transactions:past,items:[],budgets:{}});
 const predicted=ledger.build(temporary,dataModel.records(temporary),asOf,horizon,forecast,dataModel);
 const cashEvents=predicted.events.filter(e=>e.date>asOf&&e.date<=until&&['expense','income','transfer'].includes(e.type));
 const events=cashEvents.filter(e=>['expense','income'].includes(e.type));
 const recurring=futureActual.filter(t=>t.scenarioTruth?.recurring===true&&['expense','income'].includes(t.type));
 const match=matchEvents(events,recurring);
 const allActualExpense=futureActual.filter(t=>t.type==='expense').reduce((n,t)=>n+Number(t.amount),0);
 const matchedExpense=match.matched.filter(x=>x.actual.type==='expense').reduce((n,x)=>n+Number(x.actual.amount),0);
 const bins={categories:{},cadences:{},confidence:{}};
 const bucket=(group,key)=>{
  if(!bins[group][key])bins[group][key]=createBin(key);
  return bins[group][key];
 };
 // Build category/cadence/confidence precision/recall without conflating
 // a prediction's guessed label with the independently-labeled truth.
 const grouped=(keyOfPrediction,keyOfActual,group)=>{
  const keys=new Set([...events.map(keyOfPrediction),...recurring.map(keyOfActual)]);
  for(const key of keys){
   const p=events.filter(e=>keyOfPrediction(e)===key),a=recurring.filter(e=>keyOfActual(e)===key);
   const m=matchEvents(p,a);
   addMetrics(bucket(group,key),m,p.length,a.length);
  }
 };
 grouped(e=>e.type==='income'?'Income':e.category||'Other',e=>e.type==='income'?'Income':e.category||'Other','categories');
 grouped(e=>e.cadence||'Unknown',e=>e.scenarioTruth?.cadence||'Unknown','cadences');
 // Confidence is a prediction-only property; hit-rate by confidence rather
 // than the unfounded assumption a truth record has a confidence label.
 const matchedIDs=new Set(match.matched.map(p=>p.predicted.id));
 for(const p of events){
  const k=p.confidence||'Unknown',bin=bucket('confidence',k);
  bin.forecast++;
  if(matchedIDs.has(p.id)){
   const pair=match.matched.find(m=>m.predicted===p);
   if(pair)recordMatched(bin,pair.predicted,pair.actual);
  }else bin.false++;
 }
 const cashFor=t=>account(t)===cashAccount;
 const opening=round(initialBalance+transactions.filter(t=>t.date>baselineDate&&t.date<=asOf&&cashFor(t)).reduce((n,t)=>n+cashImpact(t),0));
 const cash=CASH_DAYS.filter(n=>n<=horizon).map(days=>{
  const checkpoint=shiftDays(asOf,days);
  const predictedChange=cashEvents.filter(e=>e.date<=checkpoint&&cashFor(e)).reduce((n,e)=>n+cashImpact(e),0);
  const actualChange=futureActual.filter(t=>t.date<=checkpoint&&cashFor(t)).reduce((n,t)=>n+cashImpact(t),0);
  const expectedBalance=round(opening+predictedChange),realizedBalance=round(opening+actualChange);
  const accountRisk=predicted.uncertaintyByAccount?.[cashAccount];
  const unc=accountRisk?.available?accountRisk:null;
  const adjustedBalance=unc?round(expectedBalance-unc.dailyEstimated*days):null;
  return {days,forecastBalance:expectedBalance,actualBalance:realizedBalance,
    signedError:round(expectedBalance-realizedBalance),
    absoluteError:round(Math.abs(expectedBalance-realizedBalance)),
    adjustedBalance,adjustedAbsoluteError:adjustedBalance===null?null:round(Math.abs(adjustedBalance-realizedBalance)),
    illustrativeLow:unc?round(expectedBalance-unc.dailyHigh*days):null,
    illustrativeHigh:unc?round(expectedBalance-unc.dailyLow*days):null};
 });
 const examples={
  falsePredictions:match.unmatchedPredictions.slice(0,5).map(t=>({date:t.date,merchant:t.merchant,amount:t.amount,category:t.category})),
  missedRecurring:match.missedActuals.slice(0,5).map(t=>({date:t.date,merchant:t.merchant,amount:t.amount,category:t.category,cadence:t.scenarioTruth.cadence}))
 };
 return {asOf,through:until,days:horizon,historyCount:past.length,actualFutureCount:futureActual.length,
  forecastCount:events.length,recurringTruthCount:recurring.length,match,events,
  bins,cash,allActualExpense:round(allActualExpense),matchedExpense:round(matchedExpense),examples,
  snapshotProvenance:'Fictional anchored opening balance; not a bank snapshot'};
}
function summarize(folds){
 const overall=createBin('All recurring events'),categories={},cadences={},confidence={};
 const cash=CASH_DAYS.map(days=>({days,samples:0,absoluteErrorSum:0,signedErrorSum:0,maxError:0,adjustedSamples:0,adjustedErrorSum:0}));
 const misses=[],falseAlarms=[];
 let actualSpend=0,coveredSpend=0,opportunities=0;
 for(const f of folds){
  opportunities+=f.actualFutureCount;
  actualSpend+=f.allActualExpense;coveredSpend+=f.matchedExpense;
  addMetrics(overall,f.match,f.forecastCount,f.recurringTruthCount);
  for(const name of ['categories','cadences','confidence'])for(const [key,src] of Object.entries(f.bins[name])){
   const container=name==='categories'?categories:name==='cadences'?cadences:confidence;
   if(!container[key])container[key]=createBin(key);
   const dest=container[key];
   for(const field of ['forecast','actual','matched','missed','false','dateError','amountError','matchedExpenseAmount'])dest[field]+=src[field];
  }
  for(const c of f.cash){
   const target=cash.find(d=>d.days===c.days);
   target.samples++;target.absoluteErrorSum+=c.absoluteError;target.signedErrorSum+=c.signedError;
   target.maxError=Math.max(target.maxError,c.absoluteError);
   if(c.adjustedAbsoluteError!==null){target.adjustedSamples++;target.adjustedErrorSum+=c.adjustedAbsoluteError;}
  }
  misses.push(...f.examples.missedRecurring.map(t=>({...t,asOf:f.asOf})));
  falseAlarms.push(...f.examples.falsePredictions.map(t=>({...t,asOf:f.asOf})));
 }
 return {snapshots:folds.length,forecastOpportunities:overall.forecast,recurringActualOpportunities:overall.actual,
  evaluatedActualTransactions:opportunities,recurring:binSummary(overall),
  scheduledExpenseCoverage:pct(coveredSpend,actualSpend),matchedExpense:round(coveredSpend),
  actualExpense:round(actualSpend),
  byCategory:Object.values(categories).map(binSummary).sort((a,b)=>b.actualRecurring-a.actualRecurring||a.name.localeCompare(b.name)),
  byCadence:Object.values(cadences).map(binSummary).sort((a,b)=>b.actualRecurring-a.actualRecurring||a.name.localeCompare(b.name)),
  byConfidence:Object.values(confidence).map(binSummary).sort((a,b)=>b.predicted-a.predicted),
  cash:cash.map(x=>({days:x.days,observations:x.samples,mae:mean(x.absoluteErrorSum,x.samples),
   bias:mean(x.signedErrorSum,x.samples),worstAbsoluteError:round(x.maxError),
   scenarioMAE:mean(x.adjustedErrorSum,x.adjustedSamples),scenarioSamples:x.adjustedSamples})),
  examples:{missedRecurring:misses.slice(0,10),falsePredictions:falseAlarms.slice(0,10)}};
}
function run(options){
 const {transactions,forecast,ledger,dataModel}=options||{};
 const dates=options?.asOfDates||DEFAULT_SNAPSHOTS;
 if(!Array.isArray(dates)||dates.length<1)throw Error('Select at least one historical snapshot');
 const rows=transactions||[];
 if(rows.length<1||!rows.every(x=>isoDate(x.date)))throw Error('Valid fictional historical transactions are required');
 const immutable=JSON.stringify(rows);
 const folds=dates.map(asOf=>evaluateFold({transactions:rows,forecast,ledger,dataModel,asOf,
  horizon:90,initialBalance:options.initialBalance??18000,baselineDate:options.baselineDate||'2024-09-30',cashAccount:options.cashAccount||'Checking'}));
 if(JSON.stringify(rows)!==immutable)throw Error('Accuracy lab must never mutate source fixture');
 const score=summarize(folds);
 return {kind:'fictional-walk-forward',label:'Fictional 25-month household',method:'Month-start 90-day walk-forward; 12 overlapping holdout windows',
   asOfDates:dates.slice(),firstAsOf:dates[0],lastAsOf:dates[dates.length-1],lastTruthDate:folds[folds.length-1].through,
   historyRecords:rows.length,score,
   folds:folds.map(f=>({asOf:f.asOf,through:f.through,forecast:f.forecastCount,
     recurringActual:f.recurringTruthCount,matched:f.match.matched.length,
     precision:pct(f.match.matched.length,f.forecastCount),
     recall:pct(f.match.matched.length,f.recurringTruthCount),
     amountMAE:mean(f.match.matched.reduce((n,x)=>n+x.amountError,0),f.match.matched.length),
     cash:f.cash})),
   assumptions:[
    'Predictions only see transactions on or before each historical date; recurring truth tags are stripped from training.',
    'A hit requires the same merchant, account, direction and a posting date within 2–5 days; each actual matches at most one prediction.',
    'Precision and recall score recurring opportunities, not every irregular purchase. Shopping without reliable dates is not counted as a recurring miss.',
    'Monthly tests overlap: a charge may be scored in several independently generated forecasts.',
    'Cash-flow error uses an explicitly fictional anchored Checking account; checking transfers affect cash but are not spending.',
    'No metric is a measured real-bank accuracy rate. Missing or unverified source history would reduce reliability.'
   ]};
}
function runFixture(fixture,forecast,ledger,dataModel){
 if(!fixture?.buildScenario)throw Error('Fictional fixture unavailable');
 return run({transactions:fixture.buildScenario(),forecast,ledger,dataModel});
}
const api={run,runFixture,evaluateFold,matchEvents,DEFAULT_SNAPSHOTS};
root.HouseholdAccuracyLab=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
