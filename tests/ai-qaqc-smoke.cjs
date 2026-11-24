'use strict';
// Only fictional sources: independent QA can report a broken Ledger result,
// while ordinary financial advice remains fail-closed on the same result.
const assert=require('node:assert/strict');
const {financialContext}=require('../pilot/ai-financial-report.cjs');
const {buildContext,inspect}=require('../pilot/ai-qaqc.cjs');
const {analyzeQualityCheck,analyzeOneClick}=require('../pilot/ai-chat.cjs');
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
 let calls=0;
 const block=(kind,title,evidenceId)=>({kind,title,
  text:'Check this Ledger output against the source event legs.',
  detail:'This is a software-quality discrepancy to verify, not a household spending recommendation.',
  chartId:null,visualStyle:'auto',evidenceIds:[evidenceId]});
 const candidate={blocks:[block('paragraph','Independent source checks require review',sourceFact.id)],
  followUps:[],limitations:[]};
 const final={blocks:[
  block('hero','Review internal balance consistency',sourceFact.id),
  block('paragraph','Reconciliation exceptions need investigation',sourceFact.id)
 ],followUps:[],limitations:[]};
 const fake=async(url,{body})=>{
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  const payload=JSON.parse(body);calls++;
  assert.equal(payload.store,false);
  assert(!JSON.stringify(payload).includes(bank),'Provider never receives raw bank identifiers');
  if(calls<=3){
   assert(payload.messages[0].content.includes('quality-assurance auditor'));
   assert.equal(payload.tools.length,6,'QA includes the independent internal audit, but no external public research');
   assert(payload.tools.some(t=>t.function?.name==='audit_financial_evidence'));
   const first=JSON.parse(payload.messages[1].content);
   assert.equal(first.independentQualityChecks.checks.daysRecomputed,2);
  }
  if(calls===4){
   assert.equal(payload.tools,undefined,'Independent QA reviewer has no mutation or query tools');
   assert(payload.messages[0].content.includes('Ledger QA/QC'));
  }
  const content=calls<=2?candidate:calls===3?final:
   {rejectedIndices:[],concerns:[],quality:'substantive',
    reason:'Independent source checks and audit limitations are reflected.'};
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(content)}}]})};
 };
 await assert.rejects(()=>analyzeQualityCheck({context,apiKey:'fictional',
  consent:'financial-analysis-v3',fetchImpl:fake}),/consent/,
  'Ordinary AI consent cannot silently authorize a QA run');
 const result=await analyzeQualityCheck({context,apiKey:'fictional',
  consent:'ledger-qaqc-v1',fetchImpl:fake});
 assert.equal(calls,4,'Two independent QA investigations, synthesis and evidence audit');
 assert.equal(result.mode,'ledger-qaqc');
 assert.equal(result.qaAudit.checks.daysRecomputed,2);
 assert.equal(result.qaAudit.checks.confirmed,audit.checks.confirmed);
 assert.equal(result.blocks.length,2);
 assert(result.disclosure.includes('not a full source-code review'));
 console.log('PASS independent AI QA/QC: source arithmetic, integrity failures, transfers, privacy, separate consent and audit');
})().catch(e=>{console.error(e);process.exitCode=1});
