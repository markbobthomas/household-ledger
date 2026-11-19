'use strict';
// Fictional, privacy-safe demonstration of the read-only AI report boundary.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const reportHtml=fs.readFileSync(require('node:path').join(__dirname,'../pilot/ai-review.html'),'utf8');
const inlineScript=reportHtml.match(/<script>([\s\S]*?)<\/script>/);
assert(inlineScript,'AI report page includes client logic');
new vm.Script(inlineScript[1],{filename:'pilot/ai-review.html'});
assert(reportHtml.includes('financial-outlook-v1'),'full financial context requires separate consent');
assert(reportHtml.includes('/api/ai/report'),'the page uses the new report endpoint');
assert(!reportHtml.includes('innerHTML'),'untrusted model prose must not be interpreted as HTML');

const {financialContext,analyzeFinancialOutlook,verifyClaim}=require('../pilot/ai-financial-report.cjs');
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
 paymentReconciliations:[{status:'posted'},{status:'pending'}],
 overduePayments:[],duplicateChecks:[],postedMatchReview:[]}};
const context=financialContext(prepared,{lastSync:'2026-11-19T17:00:00Z'});
assert.equal(context.scope.historicalTransactionsScanned,300);
assert.equal(context.scope.futureEventsScanned,2);
assert.equal(context.primary.low90.balance,4500);
assert.equal(context.primary.low90.date,date(30));
assert.equal(context.scope.forecastHorizonDays,1095);
const lowFact=context.facts.find(f=>f.text.includes('lowest projected 90 day balance'));
assert(lowFact);
assert(verifyClaim('Projected low $4500.00',[lowFact.id],context.factIndex));
assert(!verifyClaim('Projected low $1500.00',[lowFact.id],context.factIndex));
assert(!verifyClaim('Something happened',['fake-fact'],context.factIndex));
(async()=>{
 await assert.rejects(()=>analyzeFinancialOutlook({context,consent:false,apiKey:'test'}),/consent/);
 let request;
 const run=async(payload)=>analyzeFinancialOutlook({context,consent:'financial-outlook-v1',
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
  limitations:[]};
 const report=await run(valid);
 assert.equal(report.primary.low90.balance,4500);
 assert.equal(report.findings.length,1,'invalid finding discarded without rejecting valid report');
 assert(report.limitations.some(x=>/variable/i.test(x)));
 assert(report.limitations.some(x=>/detailed/i.test(x)));
 assert.equal(report.reportStatus,'advisory-only');
 const transmitted=JSON.stringify(request);
 assert(!transmitted.includes(accountId),'raw account identifier must not cross model boundary');
 assert(!transmitted.includes('secret-tx-'),'raw transaction ids must not cross model boundary');
 assert(!transmitted.includes('never-share-token'),'secrets must not cross model boundary');
 assert(!transmitted.includes('movement-private'),'internal linked transfer keys stay private');
 assert(transmitted.includes('"store":false'),'disable API storage per request');
 assert.equal(request.response_format.type,'json_schema');
 assert(request.messages[0].content.includes('open-ended investigation'));
 const modelContext=JSON.parse(request.messages[1].content);
 assert.equal(modelContext.coverage.historicalTransactionsScanned,300);
 assert.equal(modelContext.coverage.futureEventsScanned,2);
 assert(!JSON.stringify(modelContext).includes('Checking 12345678'));
 assert.deepEqual(Object.keys(modelContext).sort(),['accounts','asOf','coverage','facts','primary']);
 await assert.rejects(()=>run({...valid,summary:'The low is $1000000.00'}),
  e=>e.safeCode==='invalid_ai_evidence','model-invented dollar claim rejected');
 await assert.rejects(()=>run({...valid,summaryEvidenceIds:['made-up-evidence']}),
  e=>e.safeCode==='invalid_ai_evidence','unsupported summary evidence rejected');
 console.log('AI financial report: fictional proof, privacy, context and claim checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
