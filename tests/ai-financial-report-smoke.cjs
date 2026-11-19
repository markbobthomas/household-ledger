'use strict';
// Fictional, privacy-safe demonstration of the read-only AI report boundary.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const reportHtml=fs.readFileSync(require('node:path').join(__dirname,'../pilot/ai-review.html'),'utf8');
const inlineScript=reportHtml.match(/<script>([\s\S]*?)<\/script>/);
assert(inlineScript,'AI report page includes client logic');
new vm.Script(inlineScript[1],{filename:'pilot/ai-review.html'});
assert(reportHtml.includes('financial-analysis-v3'),'autonomous analysis requires separate consent');
assert(reportHtml.includes('/api/ai/analyze'),'the page uses a one-click analysis endpoint');
assert(!reportHtml.includes('<textarea'),'the analysis interface must not be a chatbot');
assert(!reportHtml.includes('innerHTML'),'untrusted model prose must not be interpreted as HTML');

const {financialContext,analyzeFinancialOutlook,verifyClaim}=require('../pilot/ai-financial-report.cjs');
const {planInvestigations,investigate,checkRequest}=require('../pilot/ai-report-investigator.cjs');
const asOf='2026-11-19',date=n=>{const d=new Date(asOf+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const accountId='fictional-sensitive-account-id-12345678';
const series=Array.from({length:96},(_,i)=>({
 date:date(i),balance:i===30?4500:9000-i*10,
 income:i%14===0?2000:0,outflow:i%14===1?200:0}));
const history=Array.from({length:300},(_,i)=>({
 id:'secret-tx-'+i,accountId,date:date(-i),amount:30+i,
 type:i%10===0?'income':i%17===0?'transfer':'expense',
 merchant:'Fictional grocery 9821',category:'Groceries',pending:false,
 token:'never-share-token'}));
const prepared={bundle:{projection:{
 asOf,days:1095,accounts:[{id:accountId,name:'Checking 12345678',
  valid:true,type:'cash',balanceStatus:'fresh',openingCurrent:10000,
  openingAvailable:9900,source:{accountType:'checking',token:'secret'},series}],
 series:series.map(x=>({date:x.date,cash:x.balance})),
 events:[{id:'internal-future-payment-raw-id',accountId,date:date(7),
  amount:1200,kind:'expense',merchant:'Fictional rent',recurringRuleId:'rule-private'},
 {id:'internal-card-payment-raw-id',accountId,date:date(12),
  amount:850,kind:'transfer_out',merchant:'Card autopay',transferGroupId:'movement-private'}],
 household:{conservationDifference:0},diagnostics:{balanceMismatches:[]}},
 ledger:[{id:'raw-future-id',accountId,date:date(7),amount:1200,kind:'event'}],
 rows:history,
 payments:{statements:[{cardId:accountId,fromAccountId:accountId,dueDate:date(10),
  amount:840,autopayEnabled:true,alreadyPaid:false,estimated:true}]},
 paymentReconciliations:[{status:'posted'},{status:'pending'}],
 overduePayments:[],duplicateChecks:[],postedMatchReview:[]}};
const context=financialContext(prepared,{lastSync:'2026-11-19T17:00:00Z',
 adjustments:{predictions:{categoryMonthlyBudgets:{Groceries:500},lowAlertThreshold:6000,
 futureRecurringRules:[{id:'never-share-rule-key'}],futureRecurrenceExclusions:{'never-share-identity':true}}}});
assert.equal(context.scope.historicalTransactionsScanned,300);
assert.equal(context.scope.futureEventsScanned,2);
assert(context.facts.some(f=>f.kind==='budget'&&f.text.includes('$500.00')));
assert(context.facts.some(f=>f.kind==='owner-preference'&&f.text.includes('$6000.00')));
assert.equal(context.primary.low90.balance,4500);
assert.equal(context.primary.low90.date,date(30));
assert.equal(context.scope.forecastHorizonDays,1095);
assert(context.visuals.some(v=>v.id==='balance-90'&&v.points.some(p=>p.value===4500)));
assert(context.visuals.some(v=>v.id==='monthly-spending'));
assert(context.facts.some(f=>f.kind==='card-statement'&&f.text.includes('$840.00')));
const baseRequest={kind:'historical-transactions',accountId:'account-1',
 startDate:date(-50),endDate:asOf,query:'Fictional grocery',reason:'Check repeated expenses'};
assert(checkRequest(baseRequest,context));
assert(!checkRequest({...baseRequest,accountId:'raw-account-id'},context));
assert(!checkRequest({...baseRequest,startDate:date(-1200)},context));
const drilled=investigate(context,[baseRequest,{kind:'future-payments',
 accountId:null,startDate:asOf,endDate:date(90),query:'',reason:'Verify future obligations'},
 {kind:'daily-balances',accountId:'account-1',startDate:asOf,endDate:date(35),
 query:'',reason:'Explain the low date'},
 {kind:'card-statements',accountId:'account-1',startDate:asOf,endDate:date(35),
 query:'',reason:'Check statement funding'}]);
assert.equal(drilled.requestsExecuted,4);
assert(drilled.facts.some(f=>f.text.includes('matched')));
assert(drilled.facts.some(f=>f.text.includes('minimum $4500.00')));
assert(drilled.facts.some(f=>f.text.includes('statement due')));
assert(!JSON.stringify(drilled.facts).includes(accountId));
assert(!JSON.stringify(drilled.facts).includes('secret-tx-'));
assert(!JSON.stringify(drilled.facts).includes('never-share-token'));
const lowFact=context.facts.find(f=>f.text.includes('lowest projected 90 day balance'));
assert(lowFact);
assert(!verifyClaim('Balance on 2026-12-31 was $4500.00',[lowFact.id],context.factIndex));
assert(verifyClaim('Projected low $4500.00',[lowFact.id],context.factIndex));
assert(!verifyClaim('Projected low $1500.00',[lowFact.id],context.factIndex));
assert(!verifyClaim('Something happened',['fake-fact'],context.factIndex));
(async()=>{
 await assert.rejects(()=>analyzeFinancialOutlook({context,consent:false,apiKey:'test'}),/consent/);
 let request;
 const run=async(payload)=>analyzeFinancialOutlook({context,consent:'financial-outlook-v2',
  apiKey:'fake-api-key',fetchImpl:async(url,options)=>{
   assert.equal(url,'https://api.openai.com/v1/chat/completions');
   request=JSON.parse(options.body);
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(payload)}}]})};
  }});
 const valid={
  summary:'Checking may fall to $4500.00 in the next 90 days.',
  summaryEvidenceIds:[lowFact.id],
  findings:[{kind:'risk',title:'Watch the low balance',
   assessment:'Projected low is $4500.00.',recommendation:'Confirm all variable expenses.',
   confidence:'medium',evidenceIds:[lowFact.id]},
   {kind:'risk',title:'Invented evidence',assessment:'Unsupported.',
   recommendation:'Investigate.',confidence:'high',evidenceIds:['f9999']}],
  sections:[{title:'Expected low balance',body:'The projected low is $4500.00.',
   importance:'primary',evidenceIds:[lowFact.id],visualIds:['balance-90']}],
  limitations:[]};
 const report=await run(valid);
 assert.equal(report.primary.low90.balance,4500);
 assert.equal(report.findings.length,1,'invalid finding discarded without rejecting valid report');
 assert.equal(report.sections.length,1);
 assert.equal(report.sections[0].visuals[0].id,'balance-90');
 assert(report.visuals[0].points.every(p=>typeof p.value==='number'));
 assert(report.limitations.some(x=>/variable/i.test(x)));
 assert(report.limitations.some(x=>/detailed/i.test(x)));
 assert.equal(report.reportStatus,'advisory-only');
 const transmitted=JSON.stringify(request);
 assert(!transmitted.includes(accountId),'raw account identifier must not cross model boundary');
 assert(!transmitted.includes('secret-tx-'),'raw transaction ids must not cross model boundary');
 assert(!transmitted.includes('never-share-token'),'secrets must not cross model boundary');
 assert(!transmitted.includes('movement-private'),'internal linked transfer keys stay private');
 assert(!transmitted.includes('never-share-rule-key'),'saved recurrence identities stay private');
 assert(transmitted.includes('"store":false'),'disable API storage per request');
 assert.equal(request.response_format.type,'json_schema');
 assert(request.messages[0].content.includes('open-ended investigation'));
 const modelContext=JSON.parse(request.messages[1].content);
 assert.equal(modelContext.coverage.historicalTransactionsScanned,300);
 assert.equal(modelContext.coverage.futureEventsScanned,2);
 assert(!JSON.stringify(modelContext).includes('Checking 12345678'));
 assert.deepEqual(Object.keys(modelContext).sort(),['accounts','asOf','availableVisuals','coverage','facts','investigation','primary']);
 await assert.rejects(()=>run({...valid,summary:'The low is $1000000.00'}),
  e=>e.safeCode==='invalid_ai_evidence','model-invented dollar claim rejected');
 const planning=await planInvestigations({context,apiKey:'fake-api-key',fetchImpl:async(_url,options)=>{
  const sent=JSON.stringify(options.body);
  assert(!sent.includes(accountId));assert(!sent.includes('secret-tx-'));
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({requests:[baseRequest]})}}]})};
 }});
 assert.equal(planning.length,1);
 assert.equal(planning[0].kind,'historical-transactions');
 const filtered=await run({...valid,sections:[{...valid.sections[0],visualIds:['nonexistent-graph']}]});
 assert.equal(filtered.sections.length,0,'the model cannot invent graph data');
 await assert.rejects(()=>run({...valid,summaryEvidenceIds:['made-up-evidence']}),
  e=>e.safeCode==='invalid_ai_evidence','unsupported summary evidence rejected');
 console.log('AI financial report: fictional proof, privacy, context and claim checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
