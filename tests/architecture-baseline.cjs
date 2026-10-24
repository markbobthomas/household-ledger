'use strict';
// Behavior contract for future internal refactors. Fictional records only.
// Run normally to verify pinned baseline; --capture prints candidate baselines;
// --profile measures current pipeline stages without asserting wall-clock speed.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const Model=require('../ledger-data.js');
const Core=require('../planner-core.js');
const Tx=require('../planner-transactions.js');
const Payments=require('../payment-obligations.js');
const History=require('../planner-history.js');
global.document={addEventListener(){}};
require('../planner-summary.js');
const Summary=global.HouseholdPlannerSummary;
const AS_OF='2026-10-20',DAYS=1095;
const goldenPath=path.join(__dirname,'fixtures','architecture-golden.json');
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plus=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const tx=(id,date,merchant,amount,type='expense',accountId='checking',extra={})=>({
 id,date,merchant,amount,type,accountId,pending:false,category:'Other',
 source:{provider:'demo',verified:false,providerTransactionId:id,accountId},...extra
});
const acc=[
 {id:'checking',name:'Fictional Checking',type:'depository',subtype:'checking',accountType:'checking',current:12500,available:12400,simulated:true},
 {id:'savings',name:'Fictional Savings',type:'depository',subtype:'savings',accountType:'savings',current:3000,available:3000,simulated:true},
 {id:'visa',name:'Fictional Visa',type:'credit',accountType:'credit',current:850,simulated:true},
 {id:'other-card',name:'Unconfigured Card',type:'credit',accountType:'credit',current:300,simulated:true}
];
function fixtures(){
 const raw=[
 tx('mort-aug','2026-08-05','Mountain Mortgage',2300),
 tx('mort-sep','2026-09-05','Mountain Mortgage',2300),
 tx('mort-oct','2026-10-05','Mountain Mortgage',2300),
 tx('utility-aug','2026-08-11','Lake Electric Utility',127.40),
 tx('utility-sep','2026-09-11','Lake Electric Utility',176.20),
 tx('utility-oct','2026-10-11','Lake Electric Utility',133.60),
 tx('income-a1','2026-08-07','Coast Payroll',3100,'income'),
 tx('income-b1','2026-08-21','Coast Payroll',2850,'income'),
 tx('income-a2','2026-09-04','Coast Payroll',3100,'income'),
 tx('income-b2','2026-09-18','Coast Payroll',2850,'income'),
 tx('income-a3','2026-10-02','Coast Payroll',3100,'income'),
 tx('income-b3','2026-10-16','Coast Payroll',2850,'income'),
 tx('shopping-1','2026-09-09','Market Shop',92),
 tx('shopping-2','2026-10-09','Market Shop',92),
 tx('pending','2026-10-18','Future Pending',50,'expense','checking',{pending:true}),
 tx('transfer-out','2026-10-12','Transfer to Savings',220,'transfer','checking',{cashDirection:'out'}),
 tx('transfer-in','2026-10-13','Transfer from Checking',220,'transfer','savings',{cashDirection:'in'}),
 tx('visa-grocery','2026-09-23','Card Grocery',105,'expense','visa'),
 tx('visa-purchase','2026-10-10','Card Fuel',65,'expense','visa'),
 tx('visa-refund','2026-10-12','Card Fuel Refund',10,'refund','visa')
 ];
 const state=Model.migrate({transactions:raw,accounts:acc});
 const schedule=(id,merchant,type,amount,frequency,anchorDate,accountId='checking',exampleIds=[])=>({
  id,kind:'event',accountId,originalAccountId:accountId,merchant,originalMerchant:merchant,
  type,originalType:type,amount,matchAmount:amount,category:type==='income'?'Income':'Utility',
  frequency,anchorDate,sourceAnchorDate:anchorDate,sourceFrequency:frequency,amountBasis:'fixed',
  matchNames:[merchant.toLowerCase()],exampleIds
 });
 const base={
  recurringForecastMode:'approved-only',
  repeatingRecommendationDecisions:{'ignored-fictional-key':'ignored'},
  repeatingRecommendations:{'ignored-fictional-key':{key:'ignored-fictional-key',merchant:'Old ignored suggestion',status:'ignored'}},
  futureRecurringRules:[
   schedule('mortgage','Mountain Mortgage','expense',2300,'monthly','2026-11-05','checking',['mort-sep','mort-oct']),
   schedule('utility','Lake Electric Utility','expense',150,'monthly','2026-11-11','checking',['utility-sep','utility-oct']),
   schedule('pay-a','Coast Payroll','income',3100,'every-4-weeks','2026-10-30','checking',['income-a1','income-a2','income-a3']),
   schedule('pay-b','Coast Payroll','income',2850,'every-4-weeks','2026-11-13','checking',['income-b1','income-b2','income-b3'])
  ],
  futureTransactionAdds:[
   {id:'manual-expense',date:'2026-11-22',merchant:'Plumbing Repair',type:'expense',amount:175,accountId:'checking'},
   {id:'manual-transfer',date:'2026-11-17',merchant:'Move to Savings',type:'transfer',amount:300,fromAccountId:'checking',toAccountId:'savings'},
   {id:'card-subscription',date:'2026-11-08',merchant:'Card Subscription',type:'expense',amount:22,accountId:'visa'}
  ],
  futureTransactionEdits:{
   [Tx.keyEvent('user|utility|2026-12-11','checking')]:{
    date:'2026-12-11',merchant:'Lake Electric Utility',type:'expense',amount:165,accountId:'checking'
   },
   [Tx.keyEvent('user|mortgage|2027-02-05','checking')]:{skipped:true,date:'2027-02-05',accountId:'checking'}
  }
 };
 const estimate=structuredClone(base);
 Model.setCardPaymentRule({predictions:estimate},'visa',{
  billingStartDate:'2026-10-01',billingEndDate:'2026-10-31',
  nextPaymentDate:'2026-11-20',nextDueDate:'2026-11-21',
  fromAccountId:'checking',autopayEnabled:true,method:'statement',lastStatementBalance:''
 });
 const issued=structuredClone(base);
 Model.setCardPaymentRule({predictions:issued},'visa',{
  billingStartDate:'2026-09-01',billingEndDate:'2026-09-30',
  nextPaymentDate:'2026-11-12',nextDueDate:'2026-11-13',
  fromAccountId:'checking',autopayEnabled:true,method:'statement',lastStatementBalance:740
 });
 const legacy=structuredClone(estimate);
 delete legacy.recurringForecastMode;
 const snapshot={asOf:AS_OF,mode:'demo',accounts:acc};
 return {raw,state,snapshot,base,estimate,issued,legacy};
}
const clean=x=>x===undefined?null:x;
const money=x=>x===null||x===undefined?null:Number(Number(x).toFixed(2));
function summary(bundle,scenario,context){
 const snap=context.snapshot,projection=bundle.projection,sourceJSON=JSON.stringify(context.state.transactions);
 assert.equal(JSON.stringify(context.state.transactions),sourceJSON,'Actual bank facts must stay immutable');
 assert.equal(Core.auditProjection(projection).ok,true,'Projection must reconcile');
 assert.equal(projection.household.conservationDifference,0,'Cash/card movements must conserve value');
 const current=projection.accounts.find(a=>a.id==='checking');
 const card=projection.accounts.find(a=>a.id==='visa');
 const options={snapshot:snap,bundle,days:DAYS,accounts:snap.accounts,prefs:scenario,
  fresh:true,ready:Payments.ready};
 const checkingHTML=Summary.render({...options,chosen:snap.accounts[0],derived:current});
 const cardHTML=Summary.render({...options,chosen:snap.accounts[2],derived:card});
 const noneHTML=Summary.render({...options,chosen:snap.accounts[3],
  derived:projection.accounts.find(a=>a.id==='other-card')});
 assert.match(checkingHTML,/Monthly low/);
 assert.match(checkingHTML,/3-year low/);
 assert.match(cardHTML,/Next statement estimate/);
 assert.doesNotMatch(cardHTML,/3-month estimated low/);
 assert.doesNotMatch(cardHTML,/Monthly low/);
 const threeYear=(checkingHTML.match(/3-year low<\/div><strong[^>]*>([^<]+)/)||[])[1]||null;
 assert.ok(threeYear,'Checking Calendar must retain its visible three-year low value');
 assert.match(noneHTML,/Not available/,'Unconfigured credit cards must not show a fictional statement');
 const metric=(html,name)=>{
  const match=html.match(new RegExp('data-'+name+'[^>]*>([^<]+)'));
  return match?match[1]:null;
 };
 const cardPeriods=bundle.payments.statements.filter(x=>x.cardId==='visa')
  .sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
 const cardDue=cardPeriods[0]||null,following=cardPeriods[1]||null;
 const formatCard=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
 assert.equal(metric(cardHTML,'summary-next-statement-value'),
  following?formatCard(following.statementBalance):'Not available',
  'Calendar following statement estimate must exactly reuse the canonical card obligation engine');
 // The Phase 1 golden preserves a historical 90-day CARD DEBT BASELINE
 // independently of the new UI metric. Never regenerate this frozen
 // financial reference just to accommodate a requested presentation change.
 const through90=plus(AS_OF,90),prior90=card.series.filter(p=>
  p.date>=AS_OF&&p.date<=through90&&Number.isFinite(p.balance));
 const originalLow=prior90.length?formatCard(Math.min(...prior90.map(p=>p.balance))):'Unverified';
 const byAccount=projection.accounts.map(a=>({
  id:a.id,valid:a.valid,status:a.balanceStatus,opening:money(a.openingCurrent),
  close:money(a.closing),available:money(a.closingAvailable),
  points:a.series.length,min:money(a.minimum),lowestDate:a.lowestDate,
  dailyHash:sha(a.series.map(p=>[p.date,money(p.balance),money(p.currentBalance),
   (p.events||[]).map(e=>[e.id,e.kind,money(e.amount)])]))
 }));
 const normalLedger=bundle.ledger.map(e=>({
  id:e.id,date:e.date,kind:e.kind,merchant:e.merchant,amount:money(e.amount),
  type:e.type,accountId:e.accountId,fromAccountId:e.fromAccountId,toAccountId:e.toAccountId,
  source:e.source,ruleId:e.ruleId,recurringRuleId:e.recurringRuleId
 }));
 return {
  asOf:snap.asOf,days:DAYS,approvedOnly:bundle.recurrenceMigration.approvedOnly,
  ledgerCount:normalLedger.length,ledgerHash:sha(normalLedger),
  accountDigest:byAccount,
  sourceRecords:context.raw.length,
  recurrence:{legacy:bundle.recurrenceMigration.legacySeries.length,
   suggestions:bundle.automaticRecurrence.events.length,
   review:bundle.historyCandidates.length,conflicts:bundle.duplicateConflicts.length,
   postedReview:bundle.postedMatchReview.length},
  card:{statement:cardDue?{dueDate:cardDue.dueDate,amount:money(cardDue.statementBalance),
   confirmed:cardDue.confirmed,autopay:cardDue.autopayEnabled}:null,
   configuredMetric:metric(cardHTML,'summary-statement-value'),
   cardLowMetric:originalLow, // frozen old 90-day numeric checksum, no longer shown
   unconfiguredMetric:metric(noneHTML,'summary-statement-value')},
  checking:{monthLow:metric(checkingHTML,'summary-month-value'),
   threeYearLow:threeYear},
  warningsHash:sha(bundle.payments.warnings||[]),
  diagnosticsHash:sha(projection.diagnostics)
 };
}
function capture(){
 const context=fixtures(),original=JSON.stringify(context.state.transactions),
  originalRaw=JSON.stringify(context.raw);
 const rows=Model.records(context.state);
 const transferA=rows.find(t=>t.id==='transfer-out'),
  transferB=rows.find(t=>t.id==='transfer-in');
 assert.equal(transferA.pairedTransactionId,transferB.id,'Account transfers must pair');
 assert.equal(transferB.pairedTransactionId,transferA.id,'Transfer pairing must be two-sided');
 assert.equal(rows.find(t=>t.id==='pending').pending,true,'Pending actuals remain source facts');
 const result={schema:1,fixtures:'fictional-v1',reconciliation:{
  actualsCount:rows.length,sourceHash:sha(context.raw),
  derivedHash:sha(rows.map(t=>[t.id,t.type,t.accountingKind,t.category,
   t.cashDirection,t.pairedTransactionId,t.transferGroupId,t.reconciliationStatus])),
  immutable:true
 }};
 for(const mode of ['base','estimate','issued','legacy']){
  const prefs=context[mode],model=Core.materialize(context.snapshot,rows,prefs,Tx,Payments,DAYS);
  result[mode]=summary(model,prefs,context);
  assert.equal(JSON.stringify(context.state.transactions),original);
  assert.equal(JSON.stringify(context.raw),originalRaw);
  if(mode==='base'){
   assert.equal(model.ledger.filter(e=>e.source==='historical').length,0);
   assert.ok(model.ledger.some(e=>e.id==='user|pay-a|2026-10-30'));
   assert.ok(model.ledger.some(e=>e.id==='user|pay-b|2026-11-13'));
   assert.ok(!model.ledger.some(e=>e.id==='user|mortgage|2027-02-05'));
  }
  if(mode==='issued')assert.ok(model.payments.statements.some(e=>e.cardId==='visa'&&e.confirmed),
   'Issued statement remains a distinct sourced amount');
  if(mode==='estimate')assert.ok(model.payments.statements.some(e=>e.cardId==='visa'&&!e.confirmed),
   'Calculated estimate must not be represented as an issued statement');
 }
 const recommendations=History.recommendedRepeating(rows,context.snapshot.accounts,AS_OF);
 result.review={count:recommendations.length,
  signature:sha(recommendations.map(r=>[r.key,r.type,r.merchant,r.frequency,r.nextDate]))};
 return result;
}
function profile(){
 const items=[];
 for(const size of [100,350,900]){
  const context=fixtures(),extra=Array.from({length:size},(_,i)=>tx('extra-'+i,
   plus('2023-01-01',i%1000),'Unrelated Merchant '+i,10+i%90));
  const state=Model.migrate({transactions:context.raw.concat(extra),accounts:acc});
  const timing=(label,callback)=>{
   const start=performance.now(),value=callback();
   return {name:label,ms:Math.round((performance.now()-start)*10)/10,value};
  };
  const a=timing('normalize+reconcile',()=>Model.records(state));
  const b=timing('recurrence scan',()=>Core.analyze(a.value,acc,AS_OF,context.estimate,DAYS));
  const c=timing('card obligations',()=>Payments.build(context.snapshot,a.value,[],
   context.estimate,{days:DAYS}));
  const d=timing('materialize+project+audit',()=>Core.materialize(context.snapshot,a.value,
   context.estimate,Tx,Payments,DAYS));
  const e=timing('project only',()=>Core.project(context.snapshot,d.value.ledger,DAYS));
  const f=timing('integrity audit',()=>Core.auditProjection(e.value));
  assert.ok(f.value.ok);
  items.push({fictionalRecords:state.transactions.length,days:DAYS,
   computedEvents:d.value.ledger.length,
   timingsMs:Object.fromEntries([a,b,c,d,e,f].map(x=>[x.name,x.ms]))});
 }
 console.log('ARCHITECTURE_PROFILE_JSON='+JSON.stringify({
  node:process.version,measurements:items,
  caveat:'Single-run exploratory figures from fictional inputs; no absolute speed pass/fail threshold.'}));
}
if(process.argv.includes('--profile'))profile();
else{
 const captured=capture();
 if(process.argv.includes('--capture'))console.log('ARCHITECTURE_GOLDEN_JSON='+JSON.stringify(captured));
 else {
  assert.ok(fs.existsSync(goldenPath),'Golden reference is missing; run --capture on unmodified code');
  const expected=JSON.parse(fs.readFileSync(goldenPath,'utf8'));
  assert.deepEqual(captured,expected,
   'Canonical transactions, dates, balances, card statement metrics, review or warnings changed');
  console.log('PASS Phase 1 frozen architecture contract: immutable actuals, exact 3-year event/balance signatures, recurring schedules, card statements, review and Calendar metrics');
 }
}
