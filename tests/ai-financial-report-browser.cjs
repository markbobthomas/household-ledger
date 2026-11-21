'use strict';
// One-click autonomous adaptive analysis, tested with fictional data in both engines.
const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium,webkit}=require('./browser-harness.cjs');
module.exports=(async()=>{
 const port=19096,url='http://127.0.0.1:'+port+'/pilot/ai-review.html';
 const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{
  cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
 const data={mode:'autonomous-adaptive',asOf:'2026-11-19',
  comparison:{
   asOf:'2026-11-19',horizon:90,modelStatus:'limited-historical-recurrence',
   coverageNotice:'Independent recurrence-only checking forecast. Ledger includes card settlement and one-off payments.',
   independentModel:'Independent from posted bank history, without using Ledger forecasts.',
   ledgerIncome:10500,independentIncome:9000,
   ledgerLow:{amount:4500,date:'2026-12-19'},
   independentLow:{amount:6800,date:'2026-12-22'},
   totals:{matchedIncome:4,uncoveredIncome:1,differingAmounts:1,
    ledgerOnlyIncome:1,incomeStreams:2},
   differences:[
    {kind:'potential-uncovered-income',date:'2026-12-19',amount:2500,
     merchant:'Fictional Employer',reason:'No matching Ledger deposit'},
    {kind:'ledger-only-income',date:'2026-12-26',amount:1500,
     merchant:'Confirmed new income',reason:'Could be manually scheduled and correct'}],
   streams:[{kind:'income',merchant:'Fictional Employer',cadence:'every-14-days',
    observations:6,lastPosted:'2026-11-18'}],
   dataPoints:[{label:'2026-11-19',value:9000,alternateValue:9000},
    {label:'2026-12-02',value:4800,alternateValue:7800},
    {label:'2026-12-19',value:4500,alternateValue:6800}]
  },blocks:[
  {kind:'hero',title:'Forecast outlook',text:'Checking may reach $4500.00 on 2026-12-19',
   evidence:[{text:'Canonical low on 2026-12-19: $4500.00'}]},
  {kind:'paragraph',title:'What causes the low?',
   text:'Expected expense clusters create the low. <img src=x onerror=alert(1)>',
   evidence:[{text:'Source-calculated expected payments'}]},
  {kind:'metric',title:'Projected lowest balance',text:'$4500.00',
   evidence:[{text:'Verified $4500.00 balance'}]},
  {kind:'chart',title:'',text:'',chart:{id:'analysis-chart-1',type:'line',unit:'USD',
   title:'Expected checking balance',subtitle:'Canonical daily projections',
   points:[{label:'2026-11-19',value:9000},{label:'2026-12-02',value:4800},
    {label:'2026-12-19',value:4500}]},evidence:[]},
  {kind:'chart',title:'',text:'',chart:{id:'analysis-chart-2',type:'bar',unit:'count',
   title:'Recorded transaction count',subtitle:'Actual source records',
   points:[{label:'September',value:28},{label:'October',value:35},
    {label:'November',value:17}]},evidence:[]},
  {kind:'callout',title:'Known forecast limitation',
   text:'Variable discretionary spending is not individually projected.',
   evidence:[{text:'Forecast scope metadata'}]}],
  coverage:{historicalTransactionsScanned:372,historicalMonthsScanned:12,
   futureEventsScanned:115,accountCount:2,forecastHorizonDays:1095,lastSync:'2026-11-19'},
  investigations:7,auditTrail:[{action:'Verified numerical findings against source evidence'},
   {action:'Automatically withheld unsupported AI presentation blocks',count:1}],
  publicResearch:[{topic:'inflation',sources:['https://www.bls.gov/cpi/']}],
  limitations:['Unknown everyday variable spending is outside the forecast.']};
 // Two very different source-supported report shapes: nothing forces a
 // forecast comparison, but an analyst can request it when warranted.
 const withoutComparison={...data,comparison:undefined};
 const withComparison={...data,blocks:[{
  kind:'chart',title:'',text:'',chart:{
   id:'analysis-independent-comparison',type:'comparison',unit:'USD',
   title:'Independent balance sensitivity',subtitle:data.comparison.coverageNotice,
   points:data.comparison.dataPoints},evidence:[]
 },{kind:'callout',title:'Coverage caveat',
   text:'The historical projection is incomplete.',evidence:[]}]};
 const ready=async()=>{for(let i=0;i<70;i++){try{if((await fetch(url)).ok)return}
  catch{}await new Promise(r=>setTimeout(r,100))}
  throw Error('Fictional analysis server did not start')};
 try{
  await ready();
  for(const [engine,name,width] of [[chromium,'Chromium',1280],[webkit,'iPhone WebKit',390]]){
   const browser=await engine.launch({headless:true}),context=await browser.newContext({
    viewport:{width,height:800}}),page=await context.newPage(),errors=[],requests=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/ai/analyze',async route=>{
    requests.push(route.request().postDataJSON());
    await route.fulfill({status:200,contentType:'application/json',
     body:JSON.stringify(requests.length===1?withoutComparison:withComparison)});
   });
   await page.goto(url);
   assert.equal(await page.locator('textarea').count(),0,'no chatbot composer');
   assert.equal(await page.locator('#run').isDisabled(),true);
   await page.locator('#consent').check();
   await page.locator('#run').click();
   await page.locator('.analysis-report').waitFor({state:'visible'});
   assert.equal(await page.locator('.analysis-report img').count(),0,'model text must be literal text');
   assert.equal(await page.locator('.hero').count(),1);
   assert.equal(await page.locator('.callout').count(),1);
   assert.equal(await page.locator('.glance-card').count(),0,
    'no predetermined forecast cards are rendered');
   assert.equal(await page.locator('.graph svg').count(),2,
    'only AI-requested graphics are visible');
   assert.equal(await page.locator('.legend').count(),0,
    'no independent comparison without an explicit AI request');
   assert.equal(await page.locator('.analysis-detail').count()>0,true,
    'longer model explanations remain expandable');
   assert.equal(await page.locator('.metric').count(),1);
   assert.equal(await page.locator('.graph svg path').count()>=1,true,
    'source-calculated AI-selected charts render');
   assert.equal(await page.locator('.graph svg rect').count()>0,true);
   assert.equal(await page.locator('.evidence').first().getAttribute('open'),null);
   assert.equal(await page.locator('.limits').getAttribute('open'),null);
   assert.equal(requests.length,1);
   assert.deepEqual(requests[0],{scope:'financial-analysis-v3',consent:true});
   await page.locator('.graph svg').first().click({position:{x:115,y:90}});
   assert.equal(await page.locator('.graph .selected').first().textContent().then(x=>x.includes('$')),true,
    'charts support touch and click');
   await page.locator('.limits').evaluate(el=>el.open=true);
   assert.equal(await page.locator('.audit li').count(),2);
   await page.locator('#run').click();
   assert.equal(requests.length,2,'rerunning starts a new independent one-click analysis');
   assert.equal(await page.locator('.analysis-report').count(),1,'no chat conversation stack');
   assert.equal(await page.locator('.hero').count(),0,
    'the second, different analysis has no prescribed hero metric');
   assert.equal(await page.locator('.graph svg').count(),1,
    'second analysis displays only its elected independent forecast chart');
   assert.equal(await page.locator('.legend').count(),1,
    'explicitly requested comparison shows both balance paths');
   await page.locator('.limits').evaluate(el=>el.open=true);
   assert.equal(await page.locator('.analysis-detail summary')
    .filter({hasText:'Independent history cross-check'}).count(),1,
    'optional cross-check details are expandable only when selected');
   assert.equal(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+2),true,
    'analysis fits narrow mobile width');
   assert.deepEqual(errors,[],name+' analysis should not throw');
   await context.close();await browser.close();
  }
  console.log('One-click autonomous AI browser: desktop/iPhone adaptive visuals, audits and privacy passed');
 }finally{server.kill()}
})();
