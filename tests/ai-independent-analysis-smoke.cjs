'use strict';
// Fictional tests of independent one-click analysis; never use personal account data.
const assert=require('node:assert/strict');
const {financialContext}=require('../pilot/ai-financial-report.cjs');
const {computeFinancialView,researchPublic}=require('../pilot/ai-independent-tools.cjs');
const {analyzeOneClick}=require('../pilot/ai-chat.cjs');
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
assert.equal(computeFinancialView(context,{...scope,startDate:date(-1500)},1).error,
 'Calculation outside available source dates');
assert(!JSON.stringify(calc).includes(account),'no original account id exposed');
assert(!JSON.stringify(calc).includes('private-tx-'),'no raw transaction key exposed');
const low=context.facts.find(f=>f.text.includes('lowest projected 90 day balance'));
assert(low);
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
  assert.equal(body.tools.length,4,'deep analyst can calculate and research');
  assert(!JSON.stringify(body).includes(account),'full account IDs must stay private');
  assert(!JSON.stringify(body).includes('not-for-model'),'bank secrets must stay private');
  assert(!JSON.stringify(body).includes('private-tx-'),'raw transaction keys stay private');
  assert(!JSON.stringify(body).includes('private-future-id'),'raw forecast keys stay private');
  assert(body.messages[0].content.includes('NOT a chatbot'));
  const m=calls===1?{tool_calls:[{id:'t1',function:{
   name:'investigate_financial_data',arguments:JSON.stringify({requests:[{
    kind:'historical-transactions',accountId:null,startDate:date(-64),
    endDate:asOf,query:'',reason:'Crosscheck expenditure history'}]})}}]}:
   calls===2?{tool_calls:[{id:'t2',function:{
    name:'compute_financial_view',arguments:JSON.stringify(scope)}}]}:
   calls===3?{tool_calls:[{id:'t3',function:{
    name:'research_public_context',arguments:JSON.stringify({topic:'inflation'})}}]}:
   {content:JSON.stringify({blocks:[
    {kind:'hero',title:'Forecast downside',text:'Checking may reach $4500.00 on '+date(30),
     evidenceIds:[low.id],chartId:null},
    {kind:'chart',title:'',text:'',evidenceIds:[],chartId:'analysis-chart-2'},
    {kind:'paragraph',title:'Made-up finding',text:'Expenses total $987654321.00',
     evidenceIds:[low.id],chartId:null},
    {kind:'callout',title:'Variable spending',text:'Everyday spending is not forecast individually.',
     evidenceIds:[],chartId:null}
   ],followUps:[],limitations:['Forecast omits some variable spending.']})};
  return {ok:true,json:async()=>({choices:[{message:m}]})};
 };
 await assert.rejects(()=>analyzeOneClick({context,apiKey:'fictional',consent:'financial-chat-v1',
  fetchImpl}),/consent/);
 const result=await analyzeOneClick({context,apiKey:'fictional',consent:'financial-analysis-v3',
  fetchImpl});
 assert.equal(result.mode,'autonomous-adaptive');
 assert.equal(result.followUps.length,0,'no conversational experience');
 assert.equal(result.blocks.length,3,'false monetary claim must be removed');
 assert.equal(result.blocks[1].chart.id,'analysis-chart-2');
 assert.equal(result.auditTrail[1].count,1,'derived misinformation corrected and logged');
 assert.equal(result.publicResearch.length,1);
 assert.equal(result.publicResearch[0].sources[0],'https://www.bls.gov/cpi/');
 assert.equal(calls,4);assert.equal(external,1);
 console.log('One-click autonomous AI: deep calculations, public research privacy, consent, audit and numeric verification passed');
})().catch(e=>{console.error(e);process.exitCode=1});
