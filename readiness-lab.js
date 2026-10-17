/* Phase 4.3: independent read-only stress tests; artificial, not bank validation. */
(function(root){'use strict';
const shift=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const snapshots=['2025-08-01','2026-02-01','2026-07-01'];
const SCENARIOS=[
 {id:'new-account',name:'New, unseen account',description:'New account spending appears without any account history.'},
 {id:'returned-payment',name:'Returned payment and retry',description:'A booked charge reverses and is retried after its expected date.'},
 {id:'employer-change',name:'Employer or payer changes',description:'Expected pay switches to a different depositor without advance notice.'},
 {id:'ambiguous-transfer',name:'Transfer direction unknown',description:'Ambiguous transfers are not converted into dated checking cash movements.'}
];
function perturb(source,asOf,scenario){
 const end=shift(asOf,90),rows=source.map(t=>({...t,scenarioTruth:t.scenarioTruth?{...t.scenarioTruth}:undefined}));
 const future=t=>t.date>asOf&&t.date<=end;
 if(scenario==='new-account'){
  for(const n of [12,42,72])rows.push({id:'new-account-'+asOf+'-'+n,date:shift(asOf,n),
   merchant:'Second Account Lease',amount:445,type:'expense',category:'Housing',
   account:'New Checking',scenarioTruth:{recurring:true,cadence:'monthly'},
   source:{provider:'scenario',verified:false}});
 }else if(scenario==='returned-payment'){
  const bill=rows.find(t=>future(t)&&t.type==='expense'&&t.scenarioTruth?.recurring===true&&shift(t.date,8)<=end);
  if(!bill)throw Error('Returned-payment test needs a recurring future bill');
  const originalTruth={...bill.scenarioTruth};
  bill.scenarioTruth={recurring:false,cadence:null};
  rows.push({...bill,id:'returned-credit-'+asOf,merchant:'Returned Debit Reversal',
   type:'income',date:shift(bill.date,1),scenarioTruth:{recurring:false,cadence:null}});
  rows.push({...bill,id:'returned-retry-'+asOf,date:shift(bill.date,8),scenarioTruth:originalTruth});
 }else if(scenario==='employer-change'){
  let count=0;
  for(const t of rows)if(future(t)&&t.type==='income'&&t.scenarioTruth?.recurring&&
   /salary|paycheck|payroll|wages/i.test(t.merchant)){t.merchant='New Payer Statement';count++}
  if(!count)throw Error('Employer change needs a future salary stream');
 }else if(scenario==='ambiguous-transfer'){
  for(const n of [-61,-31,-11,17,47,77]){
   rows.push({id:'unknown-sweep-'+asOf+'-'+n,date:shift(asOf,n),merchant:'Unidentified internal sweep',
    amount:375,category:'Other',type:'transfer',account:'Checking',cashDirection:null,
    source:{provider:'scenario',verified:false},scenarioTruth:{recurring:false,cadence:null}});
  }
 }else throw Error('Unknown Phase 4.3 scenario '+scenario);
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
}
function run(fixtures,lab,forecast,ledger,dataModel){
 if(!Array.isArray(fixtures)||fixtures.length<3)throw Error('Three distinct fictional households required');
 const initial=fixtures.map(f=>f.buildScenario()),frozen=initial.map(x=>JSON.stringify(x));
 const results=SCENARIOS.map(s=>{
  const trials=[];
  initial.forEach((rows,household)=>{
   for(const asOf of snapshots){
    const clean=lab.evaluateFold({transactions:rows,asOf,forecast,ledger,dataModel});
    const disrupted=lab.evaluateFold({transactions:perturb(rows,asOf,s.id),asOf,forecast,ledger,dataModel});
    const pct=f=>f.recurringTruthCount?round(f.match.matched.length/f.recurringTruthCount*100):null;
    const error=f=>f.cash.find(c=>c.days===90).absoluteError;
    trials.push({household,asOf,cleanRecall:pct(clean),recall:pct(disrupted),
     missed:disrupted.match.missedActuals.length,falsePredictions:disrupted.match.unmatchedPredictions.length,
     delta90DayError:round(error(disrupted)-error(clean)),futureCount:disrupted.actualFutureCount});
   }
  });
  const mean=k=>round(trials.reduce((a,t)=>a+(t[k]||0),0)/trials.length);
  return {...s,trials:trials.length,recall:mean('recall'),
   deltaRecall:round(mean('recall')-mean('cleanRecall')),
   delta90DayError:mean('delta90DayError'),
   missed:mean('missed'),falsePredictions:mean('falsePredictions'),details:trials};
 });
 if(initial.some((x,i)=>JSON.stringify(x)!==frozen[i]))throw Error('Readiness lab mutated the source scenario');
 return {kind:'fictional-readiness-stress',householdCount:initial.length,
  asOfDates:snapshots.slice(),scenarioCount:SCENARIOS.length,
  trialCount:SCENARIOS.length*snapshots.length*initial.length,results,
  disclaimer:'Invented datasets and artificial disruptions only; not evidence of live-account prediction accuracy.',
  methodology:'Three separately constructed households and three as-of dates; each forecast sees only prior history and no recurring-truth labels.'};
}
const api={SCENARIOS,snapshots,perturb,run};root.HouseholdReadinessLab=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
