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
 rows[0].name='FICTIONAL FUEL STATION';
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
 const bankDescription=dataset.page('history',0,200).rows.find(x=>x.description==='FICTIONAL FUEL STATION');
 assert(bankDescription,'Original bank descriptions remain separately visible to AI in sanitized data');
 assert(bankDescription.merchant,'Original evidence does not replace the normalized merchant');
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
const autoCited=verifyAnswer({blocks:[{
 kind:'chart',title:'Merchants differ in their source-calculated totals',
 text:'',detail:'Source-based comparison of posted transactions.',
 visualStyle:'ranked',evidenceIds:[],chartId:computed.chart.id
}],followUps:[],limitations:[]},[],[computed.chart],context);
assert.equal(autoCited.blocks[0].chart.type,'ranked');
assert(autoCited.blocks[0].evidence.some(x=>x.id.startsWith('chart-source-')),
 'verified chart calculations supply their own evidence rather than being silently discarded');
assert.throws(()=>verifyAnswer({blocks:[{
 kind:'chart',title:'Huge imaginary savings of $987654321.00',
 text:'',detail:'',visualStyle:'ranked',evidenceIds:[],chartId:computed.chart.id
}],followUps:[],limitations:[]},[],[computed.chart],context),/supported/,
 'chart proof never permits a fabricated monetary headline');

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
assert.equal(badDetail.blocks.length,2,
 'source-supported headlines survive when only expanded prose has unsupported figures');
assert.equal(badDetail.blocks[0].detail,'','unverified expanded prose must be withheld');
assert.equal(badDetail.evidenceAudit.unsupportedDetailsWithheld,1);
const substantialDetail=('This is a conditional interpretation supported by the cited source. ').repeat(42);
assert(substantialDetail.length>1800&&substantialDetail.length<4200);
const supportedDepth=verifyAnswer({blocks:[{...material,detail:substantialDetail}],
 followUps:[],limitations:[]},[low],[],context);
assert.equal(supportedDepth.blocks[0].detail,substantialDetail,
 'long, cited expandable analysis must not be silently discarded');
const rejectedLong=verifyAnswer({blocks:[{...material,
 detail:substantialDetail+' Saving $987654321.00 is certain.'}],
 followUps:[],limitations:[]},[low],[],context);
assert.equal(rejectedLong.blocks.length,1);
assert.equal(rejectedLong.blocks[0].detail,'',
 'long unsupported details must never appear even when headline is valid');
(async()=>{
 assert.deepEqual(await researchPublic('private-address',{apiKey:'fictional'}),
  {error:'Unsupported public topic'},'external web research remains privacy-restricted');
 let calls=0,reviewed=false,repair=false;
 const indexFact=dataset.facts.find(f=>f.kind==='dataset-indices'&&f.text.includes('merchant'));
 assert(indexFact,'aggregated history facts are citeable');
 const firstDraft={blocks:[material],followUps:[],limitations:[]};
 const secondDraft={blocks:[{kind:'paragraph',title:'Merchant totals differ',
  text:'Recorded merchant totals are uneven.',
  detail:'Compare these historical charges before deciding what to change.',
  visualStyle:'auto',evidenceIds:[indexFact.id],chartId:null}],
  followUps:[],limitations:[]};
 const sourceReport=[
  {kind:'hero',title:'Checking may reach $4500.00 on '+date(30),
   text:'A conditional cash projection, not a guaranteed balance.',
   detail:'Ledger projects a balance of $4500.00 on '+date(30)+
    ', excluding unplanned purchases.',
   visualStyle:'auto',evidenceIds:[low.id],chartId:null},
  {kind:'chart',title:'Merchant totals differ significantly',text:'',
   detail:'A source-calculated, historical comparison.',
   visualStyle:'ranked',evidenceIds:[],chartId:'analysis-chart-2'},
  {kind:'paragraph',title:'Posted spending concentrates at some merchants',
   text:'The record suggests several useful comparisons.',
   detail:'This is not proof that those charges are unnecessary.',
   visualStyle:'auto',evidenceIds:[indexFact.id],chartId:null},
  {kind:'callout',title:'Consider reviewing merchant concentration',
   text:'A review may find meaningful choices.',
   detail:'Amounts are source-derived but their necessity is unknown.',
   visualStyle:'auto',evidenceIds:[indexFact.id],chartId:null}
 ];
 const badReport=[...sourceReport,
  {kind:'paragraph',title:'Fake savings',text:'Save $987654321.00 now.',
   detail:'',visualStyle:'auto',evidenceIds:[low.id],chartId:null},
  {kind:'paragraph',title:'Imaginary income',
   text:'Income rises $999999999.00 tomorrow.',
   detail:'',visualStyle:'auto',evidenceIds:[low.id],chartId:null}];
 const mock=async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  const body=JSON.parse(options.body);calls++;
  assert.equal(body.store,false);
  assert(!JSON.stringify(body).includes(account));
  assert(!JSON.stringify(body).includes('private-tx-'));
  if(calls===8){
   assert.equal(body.tools,undefined,'auditor has no tool access');
   assert.equal(body.response_format.json_schema.name,'ledger_analysis_review_v1');
   const audit=JSON.parse(body.messages[1].content);
   assert(audit.blocks.some(x=>x.detail?.includes('unplanned')),
    'auditor examines the full explanation, not just headline');
   reviewed=true;
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({
    rejectedIndices:[3],concerns:[],quality:'substantive',reason:'Distinct evidence-led findings and useful comparisons.'})}}]})};
  }
  assert.equal(body.tool_choice,'auto','no arbitrary minimum tool count');
  assert.equal(body.tools.length,7);
  assert(body.tools.some(x=>x.function?.name==='audit_financial_evidence'),
   'the model can invoke the new independent source-audit tool');
  assert.equal(body.response_format.json_schema.name,'ledger_glance_expand_v2');
  assert.equal(JSON.parse(body.messages[1].content).manifest.counts.history,1600);
  let m;
  if(calls===1)m={tool_calls:[{id:'read',function:{
    name:'read_financial_dataset',arguments:JSON.stringify({
     section:'history',offset:1400,limit:200})}}]};
  else if(calls===2){
   assert(body.messages.some(x=>x.role==='tool'&&x.content.includes('dataset-history-1600')));
   m={tool_calls:[{id:'calc',function:{name:'compute_financial_view',
    arguments:JSON.stringify(scope)}}]};
  }else if(calls===3)m={content:JSON.stringify(firstDraft)};
  else if(calls===4){
   assert(body.messages[0].content.includes('independent second investigator'));
   assert(!body.messages.some(x=>x.content?.includes('Merchant totals differ')),
    'independent inquiry is not primed with the first report');
   m={tool_calls:[{id:'second',function:{name:'compute_financial_view',
    arguments:JSON.stringify({...scope,groupBy:'category'})}}]};
  }else if(calls===5)m={content:JSON.stringify(secondDraft)};
  else if(calls===6){
   assert(body.messages[0].content.includes('final independent editor'));
   const synthesis=JSON.parse(body.messages.at(-1).content);
   assert.equal(synthesis.candidates.length,2,'two exploratory source readings feed synthesis');
   assert(synthesis.citedEvidence.some(f=>f.id===indexFact.id));
   m={content:JSON.stringify({blocks:badReport,followUps:[],limitations:[]})};
  }else if(calls===7){
   assert(body.messages.at(-1).content.includes('discardedForInsufficientSourceEvidence'));
   repair=true;
   m={content:JSON.stringify({blocks:sourceReport,followUps:[],limitations:[]})};
  }else throw Error('Unexpected model response '+calls);
  return {ok:true,json:async()=>({choices:[{message:m}]})};
 };
 await assert.rejects(()=>analyzeOneClick({context,apiKey:'fictional',
  consent:'financial-chat-v1',fetchImpl:mock}),/consent/);
 const result=await analyzeOneClick({context,apiKey:'fictional',
  consent:'financial-analysis-v3',fetchImpl:mock});
 assert(reviewed&&repair);
 assert.equal(calls,8,'two explorations and an editorial correction precede final audit');
 assert.equal(result.sourceChecks,3);
 assert.equal(result.independentExplorations,2);
 assert.equal(result.editorialRevisions,1);
 assert.equal(result.blocks.length,3,'rejected and invented conclusions are not shown');
 assert(result.blocks.some(b=>b.chart?.type==='ranked'),'AI chooses source-backed visuals');
 assert(result.blocks.some(b=>b.title.includes('Posted spending')),
  'an independent non-overdraft insight is retained');
 assert(result.disclosure.includes('sanitized'));
 assert.equal(result.datasetCoverage.total.history,1600);
 // Even an insistently sparse AI must reconsider the whole record before a
 // one-line answer is published. It must not fabricate five findings.
 let n=0;
 const direct=await analyzeOneClick({context,apiKey:'fictional',
  consent:'financial-analysis-v3',fetchImpl:async(_url,options)=>{
   const body=JSON.parse(options.body);n++;
   if(n<=5){
    assert.equal(body.tool_choice,'auto');
    return {ok:true,json:async()=>({choices:[{message:{
     content:JSON.stringify(firstDraft)}}]})};
   }
   assert.equal(body.tools,undefined);
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({
    rejectedIndices:[],concerns:[],quality:'substantive',reason:'No further verifiable finding identified.'})}}]})};
  }});
 assert.equal(n,6,'two independent readings, synthesis and two editorial rechecks');
 assert.equal(direct.blocks.length,1,'absence of evidence cannot force fabricated claims');
 assert.equal(direct.independentExplorations,2);
 assert.equal(direct.editorialRevisions,2);
 assert.equal(direct.sourceChecks,0,'zero tool calls remains allowed');
 // No forced topical checklist: an independent quality auditor can require
 // further investigation even when two supported observations pass accuracy checks.
 let qaCalls=0,qaWasRevised=false;
 const tooShallow={blocks:[material,secondDraft.blocks[0]],followUps:[],limitations:[]};
 const improved={blocks:[...tooShallow.blocks,{
  kind:'callout',title:'Explore concentration before changing spending',
  text:'Source totals suggest useful comparisons, not a proven unnecessary charge.',
  detail:'Merchant records reveal where further investigation may help.',
  visualStyle:'auto',evidenceIds:[indexFact.id],chartId:null
 }],followUps:[],limitations:[]};
 const quality=await analyzeOneClick({context,apiKey:'fictional',
  consent:'financial-analysis-v3',fetchImpl:async(_url,opts)=>{
   const body=JSON.parse(opts.body);qaCalls++;
   if(qaCalls===1)return {ok:true,json:async()=>({choices:[{message:{
    content:JSON.stringify(firstDraft)}}]})};
   if(qaCalls===2)return {ok:true,json:async()=>({choices:[{message:{
    content:JSON.stringify(secondDraft)}}]})};
   if(qaCalls===3)return {ok:true,json:async()=>({choices:[{message:{
    content:JSON.stringify(tooShallow)}}]})};
   if(qaCalls===4){
    assert.equal(body.tools,undefined);
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({
     rejectedIndices:[],concerns:[],quality:'reconsider',
     reason:'The two observations omit decision-useful questions raised by merchant patterns.'})}}]})};
   }
   if(qaCalls===5){
    const request=JSON.parse(body.messages.at(-1).content);
    assert.match(request.independentReview,/merchant patterns/);
    assert.match(request.request,/source evidence/);
    qaWasRevised=true;
    return {ok:true,json:async()=>({choices:[{message:{
     content:JSON.stringify(improved)}}]})};
   }
   if(qaCalls===6)return {ok:true,json:async()=>({choices:[{message:{
    content:JSON.stringify({rejectedIndices:[],concerns:[],
     quality:'substantive',reason:'Source-supported distinct findings retained.'})}}]})};
   throw Error('Unexpected independent quality review '+qaCalls);
  }});
 assert(qaWasRevised,'an independent usefulness verdict triggers research and editorial revision');
 assert.equal(qaCalls,6);
 assert.equal(quality.blocks.length,3);
 assert.equal(quality.analysisQuality.status,'substantive');
 assert.equal(quality.editorialRevisions,1);
 // A model that repeatedly invents citations must not return an opaque
 // invalid_ai_evidence error or claim to have produced a comprehensive report.
 let invalidCalls=0;
 const unproven={blocks:[{kind:'paragraph',title:'Imaginary $987654321.00 windfall',
  text:'An unsupported amount of $987654321.00 is due.',
  detail:'',visualStyle:'auto',evidenceIds:['nonexistent-proof'],chartId:null}],
  followUps:[],limitations:[]};
 const limited=await analyzeOneClick({context,apiKey:'fictional',
  consent:'financial-analysis-v3',fetchImpl:async()=>{invalidCalls++;
   const output=invalidCalls<=2?firstDraft:unproven;
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(output)}}]})};
  }});
 assert.equal(invalidCalls,5,'two independent passes and two citation repairs, no automatic paid fallback call');
 assert.equal(limited.analysisQuality.status,'limited');
 assert(limited.blocks.length>=1);
 assert(limited.limitations.some(x=>x.includes('failed its evidence review')));
 assert(!JSON.stringify(limited).includes('987654321'),
  'unsupported invented figures are never included in the saved limited result');
 console.log('AI deep discovery: independent research, citation repair, safe partial fallback, factual verification and report depth passed');
})().catch(e=>{console.error(e);process.exitCode=1});

// GPT-6 Responses API contract: private stateless sessions, encrypted reasoning
// replay, source tools, structured report, and independent audit. Fictional only.
(async()=>{
 let calls=0,rawReasoningReplay=false;
 const low=context.facts.find(x=>x.text.includes('lowest projected 90 day balance'));
 assert(low,'fictional source low fact is available');
 const f=createDataset(context).facts.find(x=>x.kind==='dataset-indices'&&x.text.includes('merchant'));
 assert(f,'fictional merchant evidence');
 const block=(kind,title,text,evidenceIds,detail='')=>({
  kind,title,text,detail,visualStyle:'auto',evidenceIds,chartId:null});
 const proposed={blocks:[
  block('hero','Projected cash is conditional',
   'A dated low deserves attention but not panic.',[low.id],
   'Ledger reaches $4500.00 on '+date(30)+
    '; ordinary purchases are not automatically forecast.'),
  block('paragraph','Purchases need source context',
   'Inspect merchant purchasing patterns without labeling them waste.',[f.id],
   'Merchant grouping includes necessary purchases and may contain mixed retailers.'),
  block('paragraph','Do not double-count card payments',
   'Credit-card settlement is not an additional purchase.',[f.id],
   'Compare source card purchases and settlement separately when assessing cash flow.')
 ],followUps:[],limitations:[]};
 const fake=async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');
  const body=JSON.parse(options.body);calls++;
  assert.equal(body.model,'gpt-6.2-astra');
  assert.equal(body.store,false);
  assert.equal(body.reasoning.effort,'high');
  assert.deepEqual(body.include,['reasoning.encrypted_content']);
  assert.equal(body.text.format.type,'json_schema');
  assert(!JSON.stringify(body).includes(account),'raw owner bank ID excluded');
  const send=items=>({ok:true,json:async()=>({status:'completed',output:items})});
  const answer=value=>send([{type:'message',content:[{
   type:'output_text',text:JSON.stringify(value)}]}]);
  if(calls===1){
   assert(body.tools.some(t=>t.name==='read_financial_dataset'));
   return send([{type:'reasoning',id:'reason-1',summary:[],
     encrypted_content:'private-opaque-reasoning'},
    {type:'function_call',call_id:'read-1',name:'read_financial_dataset',
     arguments:JSON.stringify({section:'history',offset:1500,limit:200})}]);
  }
  if(calls===2){
   assert(body.input.some(x=>x.type==='function_call_output'&&x.call_id==='read-1'));
   assert(body.input.some(x=>x.type==='reasoning'&&
    x.encrypted_content==='private-opaque-reasoning'));
   rawReasoningReplay=true;
   return answer(proposed);
  }
  if(calls===3){
   assert(body.input.some(x=>x.role==='system'&&
    String(x.content).includes('independent second investigator')));
   return answer(proposed);
  }
  if(calls===4){
   assert(body.input.some(x=>x.role==='system'&&
    String(x.content).includes('final independent editor')));
   return answer(proposed);
  }
  if(calls===5){
   assert.equal(body.tools,undefined,
    'independent evidence reviewer does not receive tools');
   return answer({rejectedIndices:[],concerns:[],quality:'substantive',
    reason:'Multiple distinct qualified findings with valid source references.'});
  }
  throw Error('Unexpected GPT-6 mock API call '+calls);
 };
 const report=await analyzeOneClick({context,apiKey:'synthetic',
  consent:'financial-analysis-v3',model:'gpt-6.2-astra',fetchImpl:fake});
 assert.equal(calls,5);
 assert(rawReasoningReplay,'GPT-6 reasoning is preserved on stateless tool calls');
 assert.equal(report.presentation,'independent-financial-outlook');
 assert.equal(report.blocks.length,3);
 assert.equal(report.analysisQuality.status,'substantive');
 console.log('GPT-6 financial outlook: private Responses function calls and report rendering schema passed');
})().catch(e=>{console.error(e);process.exitCode=1});
