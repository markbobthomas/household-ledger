'use strict';
// Only fictional sources: independent QA can report a broken Ledger result,
// while ordinary financial advice remains fail-closed on the same result.
const assert=require('node:assert/strict');
const {financialContext}=require('../pilot/ai-financial-report.cjs');
const {buildContext,inspect}=require('../pilot/ai-qaqc.cjs');
const {analyzeQualityCheck,evidencePacket,budgetedRequest,estimatedMaxCost,MODEL,COST_LIMIT_USD}=require('../pilot/ai-quick-qaqc.cjs');
const asOf='2026-11-23',bank='private-fictional-account-12345678';
const date=i=>{const d=new Date(asOf+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10)};
const deposit={id:'private-deposit-identifier',date:asOf,accountId:bank,
 amount:100,kind:'income',merchant:'Fictional Employer'};
const debit={id:'private-linked-movement',date:date(1),accountId:bank,
 amount:20,kind:'transfer_out',transferGroupId:'private-transfer-group'};
const prepared={bundle:{
 projection:{asOf,days:1,
  accounts:[{id:bank,valid:true,type:'cash',balanceStatus:'fresh',
   openingCurrent:1000,openingAvailable:1000,source:{accountType:'checking'},
   series:[{date:asOf,balance:1100,currentBalance:1100,income:100,outflow:0,events:[deposit]},
    {date:date(1),balance:1120,currentBalance:1080,income:0,outflow:20,events:[debit]}]}],
  series:[],events:[deposit,debit],
  diagnostics:{balanceMismatches:[{reason:'synthetic diagnostic'}]},
  household:{conservationDifference:0}},
 ledger:[],
 rows:[{id:'private-bank-tx-1',accountId:bank,date:date(-1),type:'expense',
  amount:75,category:'Groceries',merchant:'Fictional Store',name:'FICTIONAL FUEL PUMP'},
  {id:'private-bank-tx-1',accountId:bank,date:date(-1),type:'expense',
   amount:75,category:'Unassigned',merchant:'Fictional Store'}],
 payments:{statements:[]},overduePayments:[],duplicateChecks:[],postedMatchReview:[]}};
assert.throws(()=>financialContext(prepared),/integrity audit/,
 'Ordinary financial analysis must still refuse known inconsistent projections');
const context=buildContext(prepared,{lastSync:asOf,adjustments:{predictions:{
 futureRecurringRules:[{id:'private-recurring-rule',accountId:bank,
  merchant:'Fictional Housing',amount:500,type:'expense',category:'Housing',
  frequency:'monthly',anchorDate:date(1)}]}}});
const audit=inspect(context);
assert.equal(audit.checks.accounts,1);
assert.equal(audit.checks.daysRecomputed,2);
assert.equal(audit.checks.daysUnverifiable,0);
assert.equal(audit.checks.expectedEventLegs,2);
assert.equal(context.qaAudit.checks.savedDecisionsReviewed,1,
 'User-confirmed rules are available for QA omission checks');
assert(context.facts.some(f=>f.kind==='qaqc-saved-decision'&&f.text.includes('Fictional Housing')));
assert(audit.checks.confirmed>=2,'Mismatch and unpaired transfer are independently detected');
assert(audit.issues.some(x=>x.title==='Daily balance does not reconcile'));
assert(audit.issues.some(x=>x.title==='Unbalanced transfer legs'));
assert(audit.issues.some(x=>x.title==='Ledger detected forecast calculation errors'));
assert(audit.issues.some(x=>x.title==='Repeated posted transaction identities'));
assert(audit.issues.some(x=>x.title==='Unclassified actual transactions'));
 assert.equal(audit.checks.explicitFuelTransactions,1);
 assert.equal(audit.checks.fuelCategoryConflicts,1,
  'An explicit Fuel bank description cannot silently be counted as Groceries');
 assert(audit.issues.some(x=>x.title==='Fuel description/category mismatch'));
const visible=JSON.stringify(audit)+JSON.stringify(context.facts.map(f=>f.text));
for(const id of [bank,'private-deposit-identifier','private-transfer-group','private-bank-tx-1','private-recurring-rule'])
 assert(!visible.includes(id),'Private source IDs must not leak into QA facts: '+id);
const sourceFact=context.facts.find(x=>x.id==='qaqc-coverage');
assert(sourceFact);
(async()=>{
 const packet=evidencePacket(context);
 assert.equal(packet.coverage.postedRecords,2);
 assert(packet.evidence.some(x=>x.kind==='posted'));
 assert(packet.evidence.some(x=>x.kind==='scheduled'));
 assert(packet.evidence.some(x=>x.kind==='saved-decision'));
 assert(!JSON.stringify(packet.evidence).includes(bank),'Actual account IDs stay local');
 const bounded=budgetedRequest(packet);
 assert(estimatedMaxCost(bounded)<=COST_LIMIT_USD);
 assert.equal(bounded.model,MODEL);
 assert.equal(bounded.max_output_tokens,2400);
 assert(!bounded.tools,'AI review is strictly one-pass and tool-free');
 const firstPosted=packet.evidence.find(x=>x.kind==='posted');
 assert(firstPosted);
 let calls=0;
 const fake=async(url,{body})=>{
  calls++;
  assert.equal(url,'https://api.openai.com/v1/responses');
  const request=JSON.parse(body);
  assert.equal(request.store,false);
  assert.equal(request.reasoning.effort,'low');
  assert.equal(request.model,'gpt-6.1-terra');
  assert(!request.tools);
  assert(estimatedMaxCost(request)<=0.10);
  assert(!body.includes(bank),'No raw bank account identifier in model request');
  assert(!body.includes('private-bank-tx-1'),'No raw bank transaction identifiers');
  const supplied=JSON.parse(request.input[1].content);
  assert.equal(supplied.coverage.postedRecords,2);
  assert(supplied.evidence.some(x=>x.kind==='posted'));
  assert(supplied.evidence.some(x=>x.kind==='scheduled'));
  assert(supplied.evidence.some(x=>x.kind==='saved-decision'));
  const answer={findings:[{
   title:'Review a category discrepancy',
   observation:'A transaction description may conflict with its recorded category.',
   action:'Compare the source bank description against the saved category override.',
   severity:'medium',evidenceIds:[firstPosted.id]
  },{
   title:'Invented financial number',
   observation:'The discrepancy is $777.77.',
   action:'Check this unsupported amount.',severity:'high',evidenceIds:[firstPosted.id]
  }]};
  return {ok:true,json:async()=>({status:'completed',usage:{
    input_tokens:3200,output_tokens:500},output:[{type:'message',content:[
     {type:'output_text',text:JSON.stringify(answer)}]}]})};
 };
 await assert.rejects(()=>analyzeQualityCheck({context,apiKey:'fictional',
  consent:'financial-analysis-v3',fetchImpl:fake}),/consent/,
  'The expensive analysis consent does not authorize QAQC');
 const result=await analyzeQualityCheck({context,apiKey:'fictional',
  consent:'ledger-qaqc-v1',fetchImpl:fake});
 assert.equal(calls,1,'Only one AI request, including source verification');
 assert.equal(result.mode,'ledger-qaqc');
 assert.equal(result.qaAudit.checks.daysRecomputed,2);
 assert.equal(result.qaAudit.checks.confirmed,audit.checks.confirmed);
 assert.equal(result.blocks.length,1,'Unsupported dollar claim rejected');
 assert.equal(result.tokenUsage.requests,1);
 assert.equal(result.tokenUsage.costUsd,0.0057);
 assert.equal(result.tokenUsage.costCeilingUsd,0.10);
 assert(result.disclosure.includes('not a full source-code review'));
 // Invalid/incomplete provider output keeps original deterministic findings,
 // but must not disguise the failed model investigation as a clean QA pass.
 const partial=await analyzeQualityCheck({context,apiKey:'fictional',
  consent:'ledger-qaqc-v1',fetchImpl:async()=>({ok:true,json:async()=>({
    status:'incomplete',usage:{input_tokens:1100,output_tokens:2400},output:[]})})});
 assert.equal(partial.analysisQuality.status,'limited');
 assert(partial.qaAudit.issues.length>0);
 assert.equal(partial.tokenUsage.requests,1);
 // Thousands of source rows must not inflate the model evidence beyond cap.
 const large={...context,source:{...context.source,history:Array.from({length:1800},(_,i)=>({
  id:'id-'+i,accountId:bank,date:date(-(i%400)),type:'expense',
  amount:20+(i%30),merchant:'Test Merchant '+i,name:'Sample Purchase '+i,
  category:i%3?'Groceries':'Shopping'
 }))}};
 const lots=evidencePacket(large),limited=budgetedRequest(lots);
 assert.equal(lots.coverage.postedRecords,1800,'Local scan covers full source history');
 assert(estimatedMaxCost(limited)<=COST_LIMIT_USD,
  'Even high-cardinality input cannot exceed the preflight budget');
 assert(limited.max_output_tokens<=2400);
 assert(!JSON.stringify(limited).includes('private-bank-tx-1'));
 console.log('PASS one-call low-cost AI QA/QC: full local audit, stratified evidence, $0.10 cost bound, private IDs, no extra calls, citation checks and graceful partial output');
})().catch(e=>{console.error(e);process.exitCode=1});
