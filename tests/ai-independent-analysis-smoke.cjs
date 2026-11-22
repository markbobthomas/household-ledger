'use strict';
// Fictional autonomous analysis: a broad, source-grounded data dump rather than
// scripted check counts, problem categories, or compulsory investigations.
const assert=require('node:assert/strict');
const {financialContext}=require('../pilot/ai-financial-report.cjs');
const {computeFinancialView,researchPublic}=require('../pilot/ai-independent-tools.cjs');
const {createDataset}=require('../pilot/ai-open-data.cjs');
const {analyzeOneClick,verifyAnswer}=require('../pilot/ai-chat.cjs');
const asOf='2026-11-19',date=n=>{
 const d=new Date(asOf+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);
 return d.toISOString().slice(0,10);
};
const account='fictional-raw-bank-account-1234';
const rows=Array.from({length:1600},(_,i)=>({
 id:'private-tx-'+i,accountId:account,date:date(-(i%180)),amount:50+i,
 type:'expense',merchant:i%3?'Fictional Grocer':'Fictional Streaming Subscription',
 category:'Groceries',pending:i===0,token:'not-for-model'
}));
rows[0].merchant='Fictional Service 12345678901234';
const prepared={bundle:{projection:{asOf,days:1095,
 accounts:[{id:account,valid:true,type:'cash',openingCurrent:9000,openingAvailable:9000,
  source:{accountType:'checking'},balanceStatus:'fresh',
  series:Array.from({length:120},(_,i)=>({date:date(i),
   balance:i===30?4500:9000-i*10,income:0,outflow:0}))}],
 series:[],events:[{id:'private-future-id',accountId:account,date:date(9),
  kind:'expense',amount:400,merchant:'Fictional Housing',
  recurringRuleId:'private-rule-123456'}],
 household:{conservationDifference:0},diagnostics:{balanceMismatches:[]}},
 ledger:[],rows,payments:{statements:[{cardId:account,fromAccountId:account,
  periodStart:date(-28),periodEnd:date(1),dueDate:date(14),amount:700,
  autopayEnabled:true,alreadyPaid:false,estimated:true}]},
 paymentReconciliations:[],overduePayments:[],duplicateChecks:[],postedMatchReview:[]}};
const context=financialContext(prepared,{lastSync:asOf});
const dataset=createDataset(context);
assert.equal(dataset.manifest.history,1600,'complete posted history is available without source sampling');
assert.equal(dataset.manifest.future,1);
assert.equal(dataset.manifest.balances,120);
assert.equal(dataset.manifest.cards,1);
assert(dataset.manifest.indices>30,'neutral pivots are calculated from the full source record');
assert(dataset.initial.records.indices.length>0);
assert(dataset.page('indices',0,200).rows.every(x=>x.id&&Number.isFinite(x.total)));

assert.equal(dataset.page('history',0,200).rows.length,200);
assert.equal(dataset.page('history',1500,200).rows.length,100);
assert.deepEqual(dataset.page('history',1600,200).rows,[]);
assert.equal(dataset.page('history',-1,50).error,'Invalid dataset page request');
assert.equal(dataset.page('raw-private-file',0,10).error,'Invalid dataset page request');
assert(dataset.initial.manifest.counts.history===1600);
const visible=JSON.stringify(dataset.initial)+JSON.stringify(dataset.page('history',0,200));
for(const secret of [account,'private-tx-','private-future-id','private-rule-','not-for-model','12345678901234'])
 assert(!visible.includes(secret),'Unredacted private ID was in the AI source data: '+secret);
assert(visible.includes('dataset-history-1'),'each raw-derived row is traceable via an alias evidence ID');
const facts=dataset.facts.filter(f=>f.kind==='dataset-history');
assert.equal(facts.length,1600,'each history record supports an evidence citation');
assert(facts[0].text.includes('$50.00'),'model evidence includes exact amounts');
const low=context.facts.find(f=>f.text.includes('lowest projected 90 day balance'));
assert(low);
const micro={kind:'paragraph',title:'Four cents of interest',text:'An account earned $0.04.',
 evidenceIds:['micro'],chartId:null};
const material={kind:'hero',title:'Checking may reach $4500.00',
 text:'The cash low is concentrated near scheduled bills.',
 detail:'Ledger projects a low balance of $4500.00 on '+date(30)+
  '; this excludes unscheduled spending.',
 visualStyle:'auto',evidenceIds:[low.id],chartId:null};
const checked=verifyAnswer({blocks:[micro,material],followUps:[],limitations:[]},
 [{id:'micro',kind:'actual',text:'Fictional account earned $0.04 ordinary interest.'},low],[],
 context,{materialityGate:true});
assert.equal(checked.blocks.length,2,
 'Ledger must not silently censor a verified observation using a fixed dollar threshold');
const scope={source:'actual',direction:'expense',startDate:date(-179),endDate:asOf,
 accountId:null,groupBy:'merchant',measure:'sum',filter:'',comparePrevious:false,visualize:true};
const computed=computeFinancialView(context,scope,2);
assert(computed.facts.length>0);
assert(computed.chart?.type==='bar','source aggregation produces categorical bars');
const styled=verifyAnswer({blocks:[
 {kind:'chart',title:'',text:'',detail:'',visualStyle:'donut',
  evidenceIds:[],chartId:computed.chart.id},
 {kind:'chart',title:'',text:'',detail:'',visualStyle:'ranked',
  evidenceIds:[],chartId:computed.chart.id}
],followUps:[],limitations:[]},[],[computed.chart],context);
assert.deepEqual(styled.blocks.map(b=>b.chart.type),['donut','ranked'],
 'the model, not fixed data categories, chooses meaningful visual forms');
const timeChart=context.visuals.find(x=>x.type==='line');
assert(timeChart,'fictional daily balance series is available');
const notMisleading=verifyAnswer({blocks:[{kind:'chart',title:'',text:'',
 detail:'',visualStyle:'donut',evidenceIds:[],chartId:timeChart.id}],
 followUps:[],limitations:[]},[],[timeChart],context);
assert.equal(notMisleading.blocks[0].chart.type,'line',
 'part-to-whole display cannot misrepresent temporal balance values');
const badDetail=verifyAnswer({blocks:[
 {...material,detail:'This definitely saves $987654321.00 every month.'},material
],followUps:[],limitations:[]},[low],[],context);
assert.equal(badDetail.blocks.length,1,
 'expanded reasoning is subject to the same exact-dollar evidence validation');
(async()=>{
 assert.deepEqual(await researchPublic('private-address',{apiKey:'fictional'}),
  {error:'Unsupported public topic'},'external web research remains privacy-restricted');
 let calls=0,readToolResults=0,reviewed=false;
 const mock=async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  const body=JSON.parse(options.body);calls++;
  assert.equal(body.store,false);
  assert(!JSON.stringify(body).includes(account));
  assert(!JSON.stringify(body).includes('private-tx-'));
  if(calls===4){
   assert(!body.tools,'reviewer cannot make private data requests');
   const review=JSON.parse(body.messages[1].content);
   assert(review.blocks.some(b=>b.detail&&b.detail.includes('unscheduled')),
    'the second independent auditor inspects expanded analysis, not just headlines');
   assert.equal(body.response_format.json_schema.name,'ledger_analysis_review_v1');
   reviewed=true;
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({
    rejectedIndices:[2],concerns:[]})}}]})};
  }
  assert.equal(body.tool_choice,'auto','AI chooses whether to investigate, not a quota');
  assert.equal(body.response_format.json_schema.name,'ledger_visual_insights_v1',
   'automatic reviews request a separate glance/deep-detail report contract');
  const blockSchema=body.response_format.json_schema.schema.properties.blocks.items;
  assert(blockSchema.required.includes('detail')&&blockSchema.required.includes('visualStyle'),
   'AI chooses its own visual form and supplies detailed source-backed reasoning');
  assert.equal(body.tools.length,6,'model can browse all source data and use calculations');
  const start=JSON.parse(body.messages[1].content);
  assert.equal(start.manifest.counts.history,1600,'AI receives the full source manifest');
  assert(start.records.history.length>100,'large initial dump has actual records, not only a short summary');
  assert(start.manifest.initialIncluded.history<1600,'remaining rows are available through paging');
  let m;
  if(calls===1)m={tool_calls:[{id:'read',function:{name:'read_financial_dataset',
   arguments:JSON.stringify({section:'history',offset:1400,limit:200})}}]};
  else if(calls===2){
   assert(body.messages.some(x=>x.role==='tool'&&x.content.includes('dataset-history-1600')),
    'AI can access source records beyond the initial selection');
   readToolResults++;
   m={tool_calls:[{id:'calc',function:{name:'compute_financial_view',arguments:JSON.stringify(scope)}}]};
  }else m={content:JSON.stringify({blocks:[
   {kind:'hero',title:'Checking could fall to $4500.00 on '+date(30),
    text:'A conditional forecast low, not a guaranteed future balance.',
    detail:'Ledger projects $4500.00 on '+date(30)+
      '; actual unscheduled purchases may change the outcome.',
    visualStyle:'auto',evidenceIds:[low.id],chartId:null},
   {kind:'chart',title:'',text:'',detail:'',visualStyle:'ranked',
    evidenceIds:[],chartId:'analysis-chart-2'},
   {kind:'paragraph',title:'False causal explanation',
    text:'The projected low is caused by a confirmed change in pay.',
    detail:'No pay history actually establishes this.',
    visualStyle:'auto',evidenceIds:[low.id],chartId:null},
   {kind:'paragraph',title:'Unsupported exact amount',
    text:'Expenses total $987654321.00',detail:'',visualStyle:'auto',
    evidenceIds:[low.id],chartId:null}
  ],followUps:[],limitations:[]})};
  return {ok:true,json:async()=>({choices:[{message:m}]})};
 };
 await assert.rejects(()=>analyzeOneClick({context,apiKey:'fictional',
  consent:'financial-chat-v1',fetchImpl:mock}),/consent/);
 const result=await analyzeOneClick({context,apiKey:'fictional',
  consent:'financial-analysis-v3',fetchImpl:mock});
 assert(reviewed);
 assert.equal(calls,4,'AI chose two investigations, not twelve mandatory calls');
 assert.equal(readToolResults,1);
 assert.equal(result.sourceChecks,2,'actual number of voluntary source reads is reported');
 assert.equal(result.blocks.length,2,'unsupported amount and overconfident cause are withheld');
 assert(result.blocks.some(b=>b.chart?.id==='analysis-chart-2'),'AI-requested calculation chart renders');
 assert(result.blocks.some(b=>b.chart?.type==='ranked'),
  'requested categorical chart is rendered as an AI-selected ranked comparison');
 assert(result.blocks[0].detail.includes('unscheduled'),
  'full evidence-backed reasoning is preserved separately from the brief takeaway');
 assert(result.auditTrail.some(x=>x.action.includes('Independently re-reviewed')));
 assert.equal(result.datasetCoverage.total.history,1600);
 assert(result.disclosure.includes('sanitized'));
 // A strong analyst may conclude without extra tool calls when the supplied
 // data is already sufficient; it should not be forced through irrelevant checks.
 let second=0;
 const direct=await analyzeOneClick({context,apiKey:'fictional',
  consent:'financial-analysis-v3',fetchImpl:async(_url,options)=>{
   const body=JSON.parse(options.body);second++;
   if(second===1){
    assert.equal(body.tool_choice,'auto');
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({
     blocks:[material],followUps:[],limitations:[]})}}]})};
   }
   assert.equal(body.tools,undefined);
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({
    rejectedIndices:[],concerns:[]})}}]})};
  }});
 assert.equal(direct.blocks.length,1);
 assert.equal(direct.sourceChecks,0,'no minimum investigative tool count');
 assert.equal(second,2);
 console.log('Autonomous freeform AI: full sanitized dataset/pagination, independent tools, zero quotas, evidence checks, reviewer, privacy and optional direct conclusion passed');
})().catch(e=>{console.error(e);process.exitCode=1});
