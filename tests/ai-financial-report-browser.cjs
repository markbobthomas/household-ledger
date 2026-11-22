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
  {kind:'hero',title:'Checking could fall to $4,500 on December 19',
   text:'The lowest scheduled balance is concentrated around upcoming bills.',
   detail:'Ledger calculates a projected low of $4500.00 on 2026-12-19. This is not a guarantee because unscheduled spending is not forecast.',
   evidence:[{text:'Canonical low on 2026-12-19: $4500.00'}]},
  {kind:'paragraph',title:'Bills are concentrated around the low-balance date',
   text:'The forecast shows a tighter cash window than at the start of the month.',
   detail:'Check the underlying scheduled transactions. <img src=x onerror=alert(1)> The timing is conditional on payments posting as expected.',
   evidence:[{text:'Source-calculated expected payments'}]},
  {kind:'metric',title:'Projected cash low',text:'$4500.00',
   detail:'A source-calculated daily balance, excluding unscheduled transactions.',
   evidence:[{text:'Verified $4500.00 balance'}]},
  {kind:'chart',title:'The scheduled checking balance slopes down through December',
   text:'A daily view shows the risk window.',
   detail:'The chart uses the canonical projected end-of-day cash balance.',
   chart:{id:'analysis-chart-1',type:'line',unit:'USD',
    title:'Expected checking balance',subtitle:'Canonical daily projections',
    points:[{label:'2026-11-19',value:9000},{label:'2026-12-02',value:4800},
     {label:'2026-12-19',value:4500}]},evidence:[]},
  {kind:'chart',title:'Recorded activity peaked in October',
   text:'Transaction count by month.',
   chart:{id:'analysis-chart-2',type:'bar',unit:'count',
    title:'Recorded transaction count',subtitle:'Actual source records',
    points:[{label:'September',value:28},{label:'October',value:35},
     {label:'November',value:17}]},evidence:[]},
  {kind:'chart',title:'Groceries are the largest share of these expenses',
   text:'Compare categories by proportion.',
   detail:'The portions come from the same source-calculated breakdown.',
   chart:{id:'analysis-chart-3',type:'donut',unit:'USD',
    title:'Fictional category split',subtitle:'Only expenses in this analysis scope',
    points:[{label:'Groceries',value:900},{label:'Housing',value:600},
     {label:'Transport',value:300}]},evidence:[]},
  {kind:'chart',title:'A few merchants account for the biggest individual totals',
   text:'Ranked merchant totals.',
   chart:{id:'analysis-chart-4',type:'ranked',unit:'USD',
    title:'Fictional merchant totals',subtitle:'Source-calculated grouping',
    points:[{label:'Merchant A',value:800},{label:'Merchant B',value:460},
     {label:'Merchant C',value:200}]},evidence:[]},
  {kind:'callout',title:'Unscheduled spending could lower the forecast',
   text:'Ordinary future purchases are not individually projected.',
   detail:'This is a limitation on the conditional balance projection, not a verified future expense.',
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
 const withComparison={...data,analysisQuality:{status:'limited'},blocks:[{
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
   const settings=[],state={enabled:false,report:withoutComparison,completedAt:'2026-11-21T10:00:00Z'};
   await page.route('**/api/ai/report',async route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({
     enabled:state.enabled,status:'ready',report:state.report,completedAt:state.completedAt})
   }));
   await page.route('**/api/ai/settings',async route=>{
    const request=route.request().postDataJSON();settings.push(request);
    state.enabled=request.enabled;
    await route.fulfill({status:200,contentType:'application/json',
     body:JSON.stringify({enabled:state.enabled,status:'ready'})});
   });
   await page.route('**/api/ai/analyze',async route=>{
    requests.push(route.request().postDataJSON());
    state.report=withComparison;
    state.completedAt='2026-11-21T11:00:0'+requests.length+'Z';
    await route.fulfill({status:202,contentType:'application/json',
     body:JSON.stringify({enabled:state.enabled,status:'queued'})});
   });
   await page.goto(url);
   assert.equal(await page.locator('textarea').count(),0,'no chatbot composer');
   await page.locator('.analysis-report').waitFor({state:'visible'});
   assert.equal(requests.length,0,
    'opening AI Analysis immediately displays the encrypted saved result, no model rerun');
   assert.equal(await page.locator('#run').isDisabled(),true,
    'manual analysis needs consent or saved ongoing sharing authorization');
   assert.equal(await page.locator('#automatic').isChecked(),false);
   assert.equal(await page.locator('.analysis-report img').count(),0,
    'bank-sourced model text must be literal and never execute HTML');
   assert.equal(await page.locator('.quality-note').count(),0,
    'a source-reviewed substantive report has no false quality warning');
   assert.equal(await page.locator('.hero').count(),1);
   assert.equal(await page.locator('.callout').count(),1);
   assert.equal(await page.locator('.finding').count(),1,
    'the AI chooses how to present an individual finding');
   assert.match(await page.locator('.hero .headline').innerText(),/could fall to/);
   assert((await page.locator('.hero .keyline').innerText()).length<160,
    'the glance summary is short, not the entire analyst narrative');
   assert.equal(await page.locator('.insight-depth').first().getAttribute('open'),null,
    'full explanation stays collapsed by default');
   await page.locator('.insight-depth').first().evaluate(el=>el.open=true);
   assert.match(await page.locator('.insight-depth .inside').first().innerText(),/2026-12-19/,
    'expandable detail retains the exact sourced reasoning');
   assert.equal(await page.locator('.glance-card').count(),0,
    'no predetermined forecast cards are rendered');
   assert.equal(await page.locator('.graph svg').count(),3,
    'source-derived line, bar, and AI-selected donut graphics render');
   assert.equal(await page.locator('.donut-legend-item').count(),3,
    'the donut explains its source categories and amounts');
   assert.equal(await page.locator('.ranked-row').count(),3,
    'the AI can request a ranked comparison rather than a generic bar chart');
   assert.equal(await page.locator('.legend').count(),0);
   assert.equal(await page.locator('.metric').count(),1);
   assert.equal(await page.locator('.graph svg path').count()>=1,true);
   assert.equal(await page.locator('.graph svg rect').count()>0,true);
   assert.equal(await page.locator('.graph svg path').count()>2,true,
    'chart selection includes multiple sourced donut wedges');
   assert.equal(await page.locator('.evidence').first().getAttribute('open'),null);
   assert.equal(await page.locator('.limits').getAttribute('open'),null);
   await page.locator('.graph svg').first().click({position:{x:115,y:90}});
   assert.equal(await page.locator('.graph .selected').first().textContent().then(x=>x.includes('$')),true);
   await page.locator('.limits').evaluate(el=>el.open=true);
   assert.equal(await page.locator('.audit li').count(),2);
   await page.locator('#automatic').click();
   assert.equal(await page.locator('#automatic').isChecked(),false,
    'standing sharing cannot be enabled without explicit consent');
   assert.equal(settings.length,0);
   await page.locator('#consent').check();
   await page.locator('#automatic').check();
   await page.waitForFunction(()=>document.querySelector('#automatic')?.disabled===false);
   assert.equal(settings.length,1);
   assert.deepEqual(settings[0],{
    enabled:true,scope:'financial-analysis-auto-v1',consent:true});
   assert.equal(await page.locator('#automatic').isChecked(),true);
   await page.locator('#run').click();
   await page.locator('.legend').waitFor({state:'visible'});
   assert.equal(requests.length,1,'manual rerun enqueues background analysis');
   assert.deepEqual(requests[0],{scope:'financial-analysis-v3',consent:true});
   assert.equal(await page.locator('.analysis-report').count(),1,
    'a new cached report replaces the old; no transcript or stacked duplicate results');
   assert.equal(await page.locator('.hero').count(),0);
   assert.match(await page.locator('.quality-note').innerText(),/Limited analysis/,
    'a shallow but verified report is visibly labelled incomplete');
   assert.equal(await page.locator('.graph svg').count(),1,
    'the new report chooses entirely different graphs and topics');
   assert.equal(await page.locator('.legend').count(),1);
   await page.locator('.limits').evaluate(el=>el.open=true);
   assert.equal(await page.locator('.analysis-detail summary')
    .filter({hasText:'Independent history cross-check'}).count(),1);
   await page.locator('#automatic').uncheck();
   await page.waitForFunction(()=>document.querySelector('#automatic')?.disabled===false);
   assert.equal(settings.length,2);
   assert.equal(settings[1].enabled,false,'automatic data sharing can be withdrawn');
   assert.equal(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+2),true,
    'analysis fits narrow mobile width');
   assert.deepEqual(errors,[],name+' AI analysis should not throw');
   await context.close();await browser.close();
  }
  console.log('One-click autonomous AI browser: desktop/iPhone adaptive visuals, audits and privacy passed');
 }finally{server.kill()}
})();
