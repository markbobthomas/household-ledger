/* Phase 4.2: deterministic adversarial, fictional stress validation.
 * No source ledger imports, localStorage, Plaid, persistence, or future-data
 * leakage. These are test challenges, not calibration on real bank records.
 */
(function(root){
'use strict';
const iso=n=>new Date(n+'T12:00:00Z');
const shift=(s,n)=>{const d=iso(s);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const snapshots=['2025-08-01','2026-02-01','2026-07-01'];
const SCENARIOS=[
 {id:'missing-rows',name:'Incomplete statement',description:'Omit approximately one-quarter of the known transaction history'},
 {id:'sync-gap',name:'One-month sync gap',description:'Hide the 30 most recent days of bank history'},
 {id:'late-history',name:'Late posted charges',description:'Shift known historical bill/pay dates by up to three days'},
 {id:'delayed-future',name:'Delayed future posting',description:'Post selected real recurring charges up to four days late'},
 {id:'paused-payroll',name:'Interrupted paychecks',description:'Pause one anticipated payroll stream without advance notice'},
 {id:'renamed-merchant',name:'New statement description',description:'A repeating merchant changes its bank statement description'},
 {id:'surprise-refund',name:'Unexpected refunds',description:'Refunds appear as cash credits, not scheduled income'},
 {id:'transfer-mirror',name:'Two-sided transfer',description:'Internal savings-side deposit must not count twice in Checking'}
];
function perturb(rows,asOf,id){
 const futureEnd=shift(asOf,90);
 const copy=rows.map(t=>({...t,scenarioTruth:t.scenarioTruth?{...t.scenarioTruth}:undefined}));
 const matching=t=>t.date>asOf&&t.date<=futureEnd;
 const past=t=>t.date<=asOf;
 if(id==='missing-rows')return copy.filter((t,i)=>!past(t)||i%4!==0);
 if(id==='sync-gap')return copy.filter(t=>!past(t)||t.date<=shift(asOf,-30));
 if(id==='late-history'){
  return copy.map((t,i)=>{
   if(!past(t)||i%3!==0)return t;
   const d=shift(t.date,i%4+1);
   return d<=asOf?{...t,date:d}:t;
  }).sort((a,b)=>a.date.localeCompare(b.date));
 }
 if(id==='delayed-future'){
  return copy.map((t,i)=>matching(t)&&t.scenarioTruth?.recurring&&i%4===0&&shift(t.date,4)<=futureEnd?
   {...t,date:shift(t.date,4)}:t);
 }
 if(id==='paused-payroll')return copy.filter(t=>
  !(matching(t)&&t.type==='income'&&/paycheck|payroll|salary/i.test(t.merchant)&&
    /primary|public sector|second/i.test(t.merchant)));
 if(id==='renamed-merchant'){
  const merchants=['Home Mortgage','Harbor Apartments','Northwest Electric','North County Power'];
  return copy.map(t=>matching(t)&&merchants.includes(t.merchant)?{...t,merchant:'NEW STATEMENT '+t.merchant}:t);
 }
 if(id==='surprise-refund'){
  const extras=[{id:'stress-refund-'+asOf,date:shift(asOf,19),
   merchant:'Refund Online Purchase',description:'Refund to card',amount:149.99,
   category:'Shopping',type:'income',account:'Checking',scenarioTruth:{recurring:false}}];
  return [...copy,...extras];
 }
 if(id==='transfer-mirror'){
  const mirrors=copy.filter(t=>matching(t)&&t.type==='transfer'&&t.account==='Checking'&&t.cashDirection==='out').map((t,i)=>({
   ...t,id:'stress-savings-mirror-'+asOf+'-'+i,account:'Savings',cashDirection:'in',
   scenarioTruth:{recurring:false,cadence:null}
  }));
  return [...copy,...mirrors];
 }
 throw Error('Unknown stress scenario: '+id);
}
function evaluateScenario(rows,asOf,id,deps){
 const observed=perturb(rows,asOf,id);
 const base=deps.lab.evaluateFold({transactions:rows,asOf,forecast:deps.forecast,ledger:deps.ledger,dataModel:deps.dataModel});
 const test=deps.lab.evaluateFold({transactions:observed,asOf,forecast:deps.forecast,ledger:deps.ledger,dataModel:deps.dataModel});
 const p=fold=>fold.forecastCount?round(fold.match.matched.length/fold.forecastCount*100):null;
 const r=fold=>fold.recurringTruthCount?round(fold.match.matched.length/fold.recurringTruthCount*100):null;
 const cash=fold=>fold.cash.find(x=>x.days===90).absoluteError;
 return {id,asOf,baseRecall:r(base),recall:r(test),basePrecision:p(base),precision:p(test),
   baseBalanceError:cash(base),balanceError:cash(test),missed:test.match.missedActuals.length,
   falsePredictions:test.match.unmatchedPredictions.length,
   sourceCount:observed.filter(t=>t.date<=asOf).length,
   // Derived only from actual assessment; no model lookahead is allowed.
   actualFutureCount:test.actualFutureCount};
}
function group(rows,asOfDates,scenario,deps){
 const trials=asOfDates.map(asOf=>evaluateScenario(rows,asOf,scenario.id,deps));
 const mean=(items,key)=>round(items.reduce((n,t)=>n+(t[key]??0),0)/items.length);
 const matched=trials.filter(t=>t.recall!==null);
 return {...scenario,windows:trials.length,
  baseRecall:mean(matched,'baseRecall'),recall:mean(matched,'recall'),
  deltaRecall:round(mean(matched,'recall')-mean(matched,'baseRecall')),
  baseBalanceError:mean(trials,'baseBalanceError'),balanceError:mean(trials,'balanceError'),
  deltaBalanceError:round(mean(trials,'balanceError')-mean(trials,'baseBalanceError')),
  meanFalse:mean(trials,'falsePredictions'),meanMissed:mean(trials,'missed'),trials};
}
function run(primary,holdout,lab,forecast,ledger,dataModel){
 if(!primary?.buildScenario||!holdout?.buildScenario||!lab?.evaluateFold)throw Error('Missing stress test dependencies');
 const deps={lab,forecast,ledger,dataModel},all=[primary.buildScenario(),holdout.buildScenario()];
 const raw=all.map(x=>JSON.stringify(x));
 const results=SCENARIOS.map(s=>{
  const a=all.map((rows,i)=>group(rows,snapshots,s,deps));
  const avg=k=>round(a.reduce((n,r)=>n+r[k],0)/a.length);
  return {id:s.id,name:s.name,description:s.description,windows:6,
    baseRecall:avg('baseRecall'),recall:avg('recall'),deltaRecall:avg('deltaRecall'),
    baseBalanceError:avg('baseBalanceError'),balanceError:avg('balanceError'),
    deltaBalanceError:avg('deltaBalanceError'),meanFalse:avg('meanFalse'),
    byHousehold:a.map((v,i)=>({name:i?'Independent holdout':'Original fixture',...v}))};
 });
 if(all.some((a,i)=>JSON.stringify(a)!==raw[i]))throw Error('Stress lab changed source fixture');
 const auditConfidence=()=>{
  // Observed hit-rates on deliberately disrupted scenarios are not
  // probabilistically calibrated confidence or evidence of user accuracy.
  const aggregate={};
  for(const rows of all)for(const asOf of snapshots){
   for(const variation of ['missing-rows','paused-payroll','renamed-merchant']){
    const data=perturb(rows,asOf,variation);
    const fold=deps.lab.evaluateFold({transactions:data,asOf,forecast,ledger,dataModel});
    const hits=new Set(fold.match.matched.map(p=>p.predicted.id));
    for(const event of fold.events){
     const key=event.confidence||'Unknown';
     if(!aggregate[key])aggregate[key]={label:key,predictions:0,hits:0};
     aggregate[key].predictions++;if(hits.has(event.id))aggregate[key].hits++;
    }
   }
  }
  return Object.values(aggregate).map(c=>({...c,observedHitRate:c.predictions?
   round(c.hits/c.predictions*100):null,calibrated:false})).sort((a,b)=>b.predictions-a.predictions);
 };
 return {kind:'fictional-stress-suite',asOfDates:snapshots.slice(),
  datasetCount:2,scenarioCount:SCENARIOS.length,trialCount:SCENARIOS.length*6,
  results,confidenceAudit:auditConfidence(),
  disclaimer:'Adversarial synthetic test scores are not reliable probabilities of future bank charges.',
  recommendations:results.filter(s=>s.deltaRecall< -5||s.deltaBalanceError>100).map(s=>s.id),
  methodology:'Each challenge tests three historical dates against two fictional households. Future actuals stay hidden from prediction; changed historical evidence or changed future outcomes are applied only as the scenario describes.'};
}
const api={SCENARIOS,snapshots,perturb,evaluateScenario,run};
root.HouseholdStressLab=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
