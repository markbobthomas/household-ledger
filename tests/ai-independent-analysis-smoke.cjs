'use strict';
// Fictional tests of independent one-click analysis; never use personal account data.
const assert=require('node:assert/strict');
const {financialContext}=require('../pilot/ai-financial-report.cjs');
const {computeFinancialView,researchPublic}=require('../pilot/ai-independent-tools.cjs');
const {analyzeOneClick,verifyAnswer}=require('../pilot/ai-chat.cjs');
const asOf='2026-11-19',date=n=>{
 const d=new Date(asOf+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);
 return d.toISOString().slice(0,10);
};
const account='fictional-private-account-1234';
const history=Array.from({length:9},(_,i)=>({
 accountId:account,date:date(-i*8),amount:100+i*10,type:'expense',
 merchant:'Fictional Grocer',category:'Groceries',token:'not-for-model',
 id:'private-tx-'+i
}));
const prepared={bundle:{projection:{asOf,days:1095,
 accounts:[{id:account,valid:true,type:'cash',openingCurrent:9000,openingAvailable:9000,
  source:{accountType:'checking'},balanceStatus:'fresh',
  series:Array.from({length:100},(_,i)=>({date:date(i),
   balance:i===30?4500:9000-i*10,income:0,outflow:0}))}],
 series:[],events:[{id:'private-future-id',accountId:account,date:date(9),
  kind:'expense',amount:400,merchant:'Fictional Housing'}],
 household:{conservationDifference:0},diagnostics:{balanceMismatches:[]}},
 ledger:[],rows:history,payments:{statements:[]},paymentReconciliations:[],
 overduePayments:[],duplicateChecks:[],postedMatchReview:[]}};
const context=financialContext(prepared,{lastSync:asOf});
const scope={source:'actual',direction:'expense',startDate:date(-64),endDate:asOf,
 accountId:null,groupBy:'month',measure:'sum',filter:'',comparePrevious:true,visualize:true};
const calc=computeFinancialView(context,scope,5);
assert(calc.chart&&calc.chart.points.length>=2,'source-calculated time series');
assert(calc.facts.some(f=>f.text.includes('matched 9')),'all source records counted');
assert(calc.summary.previousCompared===false,'no out-of-range prior data is fabricated');
assert.equal(computeFinancialView(context,{...scope,accountId:account},1).error,
 'Invalid calculation specification','raw bank account ids cannot query source');
assert.equal(computeFinancialView(context,{...scope,startDate:date(-100)},1).error,
 'Calculation outside available source dates');
assert(!JSON.stringify(calc).includes(account),'no original account id exposed');
assert(!JSON.stringify(calc).includes('private-tx-'),'no raw transaction key exposed');
const low=context.facts.find(f=>f.text.includes('lowest projected 90 day balance'));
assert(low);
const centFact={id:'fictional-micro-interest',kind:'actual',text:
 'Fictional account earned $0.04 ordinary interest.'};
const penny={kind:'paragraph',title:'Four cents of interest',
 text:'This account earned $0.04 interest.',evidenceIds:[centFact.id],chartId:null};
const material={kind:'hero',title:'Projected low',
 text:'Checking could reach $4500.00.',evidenceIds:[low.id],chartId:null};
const checked=verifyAnswer({blocks:[penny,material],followUps:[],limitations:[]},
 [centFact,low],[],context,{materialityGate:true});
assert.equal(checked.blocks.length,1,'penny-only finding should not reach the main report');
assert.equal(checked.evidenceAudit.immaterialBlocksWithheld,1);
assert.equal(checked.evidenceAudit.unsupportedBlocksWithheld,0);
assert.equal(verifyAnswer({blocks:[penny,material],followUps:[],limitations:[]},
 [centFact,low],[],context).blocks.length,2,
 'legacy chat response verification remains unchanged');
assert(!/interest/i.test(checked.blocks[0].title));
(async()=>{
 assert.deepEqual(await researchPublic('private-address',{apiKey:'fictional'}),
  {error:'Unsupported public topic'},'outside research does not accept arbitrary queries');
 let calls=0,external=0;
 const fetchImpl=async(url,options)=>{
  const body=JSON.parse(options.body);
  if(url.endsWith('/responses')){
   external++;
   assert.equal(body.store,false);
   assert.deepEqual(body.tools,[{type:'web_search'}]);
   assert(!JSON.stringify(body).includes(account));
   assert(!JSON.stringify(body).includes('4500'));
   return {ok:true,json:async()=>({output:[{type:'message',content:[{
    text:'Official CPI trends were published by BLS.',
    annotations:[{url:'https://www.bls.gov/cpi/'}]
   }]}]})};
  }
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  calls++;
  assert.equal(body.store,false);
  if(calls===15){
   assert.equal(body.response_format.json_schema.name,'ledger_analysis_review_v1');
   assert.equal(body.tools,undefined,'independent reviewer cannot perform tool calls');
   assert(body.messages[0].content.includes('independent second-pass auditor'));
   const audit=JSON.parse(body.messages[1].content);
   assert(audit.otherSourceEvidence.length>0,'reviewer sees counterevidence beyond chosen citations');
   assert(audit.sourceCoverage,'reviewer sees scanned source scope');
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({
    rejectedIndices:[3],concerns:[]})}}]})};
  }
  assert.equal(body.tools.length,5,'analyst chooses from calculations, cross-check and research');
  assert(!JSON.stringify(body).includes(account),'full account IDs must stay private');
  assert(!JSON.stringify(body).includes('not-for-model'),'bank secrets must stay private');
  assert(!JSON.stringify(body).includes('private-tx-'),'raw transaction keys stay private');
  assert(!JSON.stringify(body).includes('private-future-id'),'raw forecast keys stay private');
  assert(body.messages[0].content.includes('no prescribed finding'),
   'unbiased investigation instructions are not a fixed forecast recipe');
  const initial=JSON.parse(body.messages[1].content);
  assert.equal(initial.independentHistoryForecast,undefined,
   'independent forecast is not forced into every investigation');
  if(calls<=12)assert.equal(body.tool_choice,'required','must deeply investigate before concluding');
  const m=calls===1?{tool_calls:[{id:'t1',function:{
   name:'investigate_financial_data',arguments:JSON.stringify({requests:[{
    kind:'historical-transactions',accountId:null,startDate:date(-64),
    endDate:asOf,query:'',reason:'Crosscheck expenditure history'}]})}}]}:
   calls===2?{tool_calls:[{id:'t2',function:{
    name:'compute_financial_view',arguments:JSON.stringify(scope)}}]}:
   calls===3?{tool_calls:[{id:'t3',function:{
    name:'investigate_financial_data',arguments:JSON.stringify({requests:[{
     kind:'future-payments',accountId:null,startDate:asOf,endDate:date(90),
     query:'',reason:'Reconcile forecast obligations'}]})}}]}:
   calls===4?{tool_calls:[{id:'t4',function:{
    name:'compute_financial_view',arguments:JSON.stringify({...scope,groupBy:'merchant'})}}]}:
   calls===5?{tool_calls:[{id:'t5',function:{
    name:'investigate_financial_data',arguments:JSON.stringify({requests:[{
     kind:'daily-balances',accountId:null,startDate:asOf,endDate:date(70),
     query:'',reason:'Test whether the account low is explained'}]})}}]}:
   calls===6?{tool_calls:[{id:'t6',function:{
    name:'compute_financial_view',arguments:JSON.stringify({...scope,groupBy:'category'})}}]}:
   calls>=7&&calls<=12?{tool_calls:[{id:'t'+calls,function:{
    name:'compute_financial_view',arguments:JSON.stringify({...scope,
     groupBy:['day','week','month','account','direction','merchant'][calls-7],
     measure:calls===12?'maximum':calls%2?'count':'sum'})}}]}:
   calls===13?{tool_calls:[{id:'t13',function:{
    name:'research_public_context',arguments:JSON.stringify({topic:'inflation'})}}]}:
   calls===14?{content:JSON.stringify({blocks:[
    {kind:'hero',title:'Forecast downside',text:'Checking may reach $4500.00 on '+date(30),
     evidenceIds:[low.id],chartId:null},
    {kind:'chart',title:'',text:'',evidenceIds:[],chartId:'analysis-chart-2'},
    {kind:'paragraph',title:'Made-up finding',text:'Expenses total $987654321.00',
     evidenceIds:[low.id],chartId:null},
    {kind:'callout',title:'Variable spending',text:'The projected low is $4500.00.',
     evidenceIds:[low.id],chartId:null},
    {kind:'paragraph',title:'Unconfirmed explanation',
     text:'The balance difference was caused by a verified salary change.',
     evidenceIds:[low.id],chartId:null}
   ],followUps:[],limitations:['Unsupported assertion that all future cash is covered.']})}:
   {content:JSON.stringify({rejectedIndices:[],concerns:[]})};
  return {ok:true,json:async()=>({choices:[{message:m}]})};
 };
 await assert.rejects(()=>analyzeOneClick({context,apiKey:'fictional',consent:'financial-chat-v1',
  fetchImpl}),/consent/);
 const result=await analyzeOneClick({context,apiKey:'fictional',consent:'financial-analysis-v3',
  fetchImpl});
 assert.equal(result.mode,'autonomous-adaptive');
 assert.equal(result.followUps.length,0,'no conversational experience');
 assert.equal(result.blocks.length,3,
  'unsupported numeric claim and independent reviewer rejection are both removed');
 assert(!result.blocks.some(b=>/verified salary change/.test(b.text)),
  'unconfirmed causal explanation cannot survive independent review');
 assert(!result.limitations.some(x=>/all future cash is covered/.test(x)),
  'uncited model-authored limitations cannot become verified report content');
 assert.equal(result.blocks[1].chart.id,'analysis-chart-2');
 assert.equal(result.auditTrail.find(x=>x.action.includes('unsupported AI presentation')).count,1,
  'derived misinformation corrected and logged');
 assert(result.auditTrail.some(x=>x.action.includes('Independently re-reviewed')),
  'second analytical review must run');
 assert(result.auditTrail.some(x=>x.action.includes('Independently re-reviewed')&&x.claimsRejected===1),
  'independent reviewer withheld an unconfirmed explanation');
 assert.equal(result.publicResearch.length,1);
 assert.equal(result.publicResearch[0].sources[0],'https://www.bls.gov/cpi/');
 assert.equal(result.sourceChecks,12,'twelve distinct evidence checks before synthesis');
 assert.equal(result.comparison,undefined,'analysis can omit irrelevant forecast comparison');
 assert.equal(calls,15);assert.equal(external,1);
 // Second fictional scenario: the AI elects an independent comparison when useful.
 // This is not an always-on report section or required first-screen chart.
 let n=0;
 const optional=await analyzeOneClick({context,apiKey:'fictional',
  consent:'financial-analysis-v3',fetchImpl:async(url,options)=>{
   assert.equal(url,'https://api.openai.com/v1/chat/completions');
   const body=JSON.parse(options.body);n++;
   if(n===14)return {ok:true,json:async()=>({choices:[{message:{content:
    JSON.stringify({rejectedIndices:[],concerns:[]})}}]})};
   let message;
   if(n===1)message={tool_calls:[{id:'compare',function:{
    name:'compare_historical_forecast',arguments:'{}'}}]};
   else if(n<=12)message={tool_calls:[{id:'compute-'+n,function:{
    name:'compute_financial_view',arguments:JSON.stringify({
     ...scope,groupBy:['day','week','category','merchant','direction','account','month'][(n-2)%7],
     measure:n>8?'count':'sum'})}}]};
   else message={content:JSON.stringify({blocks:[
    {kind:'hero',title:'Forecast downside',
     text:'Checking may reach $4500.00 on '+date(30),
     evidenceIds:[low.id],chartId:null},
    {kind:'chart',title:'',text:'',evidenceIds:[],
     chartId:'analysis-independent-comparison'}
   ],followUps:[],limitations:[]})};
   return {ok:true,json:async()=>({choices:[{message}]})};
  }});
 assert(optional.comparison,'optional history model only appears when requested');
 assert(optional.blocks.some(b=>b.chart?.type==='comparison'),
  'requested independent comparison is available as an AI-selected chart');
 assert.equal(optional.sourceChecks,12);
 assert.equal(n,14);
 console.log('Autonomous analysis: unbiased source selection, minimum independent checks, optional comparison, reviewer context and privacy passed');
})().catch(e=>{console.error(e);process.exitCode=1});
