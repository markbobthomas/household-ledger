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
   const settings=[],state={enabled:false,status:'ready',isCurrent:true,
    report:withoutComparison,completedAt:'2026-11-21T10:00:00Z'};
   await page.route('**/api/ai/report',async route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify(state)
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
    state.status='ready';state.isCurrent=true;delete state.errorCode;
    await route.fulfill({status:202,contentType:'application/json',
     body:JSON.stringify({enabled:state.enabled,status:'queued'})});
   });
   const qaCalls=[],qaState={status:'not_ready',report:null,completedAt:null};
   await page.route('**/api/ai/qaqc',async route=>{
    const request=route.request();
    if(request.method()==='POST'){
     qaCalls.push({body:request.postDataJSON(),header:request.headers()['x-pilot-action']});
     qaState.report={mode:'ledger-qaqc',asOf:'2026-11-19',
      qaAudit:{checks:{accounts:1,daysRecomputed:1096,expectedEventLegs:20,
       confirmed:1,investigate:1,daysUnverifiable:0},
       issues:[{id:'qaqc-1',severity:'confirmed',title:'Daily balance does not reconcile',
        detail:'account-1 on 2026-12-19: expected $4500.00, Ledger recorded $4700.00'},
        {id:'qaqc-2',severity:'investigate',title:'Review unmatched payment',
         detail:'A source payment may not yet be represented in the forecast.'}],
       limitations:['No access to an external bank statement.']},
      blocks:[{kind:'paragraph',title:'Forecast math needs investigation',
       text:'An independently recomputed balance differs from Ledger.',
       detail:'Check 2026-12-19. <img src=x onerror=alert(1)> The transfer leg should be reviewed.',
       evidence:[{text:'Account-1 daily balance independent audit'}]}],
      coverage:{historicalTransactionsScanned:300,futureEventsScanned:20,
       forecastHorizonDays:1095,lastSync:'2026-11-19'},auditTrail:[],limitations:[]};
     qaState.status='ready';qaState.completedAt='2026-11-23T10:00:00Z';
     return route.fulfill({status:202,contentType:'application/json',
      body:JSON.stringify({...qaState,report:null,status:'queued'})});
    }
    return route.fulfill({status:200,contentType:'application/json',
     body:JSON.stringify({...qaState,enabled:false})});
   });
   const exports=[];
   await page.route('**/api/analysis/export',async route=>{
    const request=route.request();
    exports.push({method:request.method(),body:request.postDataJSON(),
     header:request.headers()['x-pilot-action']});
    await route.fulfill({status:200,contentType:'application/json',
     headers:{'Content-Disposition':'attachment; filename="ledger-analysis-2026-11-23.json"'},
     body:JSON.stringify({format:'ledger-manual-analysis-export',
      actualTransactions:[{date:'2026-11-20',amount:250,merchant:'Fictional Merchant'}]})});
   });
   await page.goto(url);
   assert.equal(await page.locator('textarea').count(),0,'no chatbot composer');
   await page.locator('.analysis-report').waitFor({state:'visible'});
   assert.equal(requests.length,0,
    'opening AI Analysis immediately displays the encrypted saved result, no model rerun');
   assert.equal(await page.locator('#run').isDisabled(),true,
    'manual analysis requires one-time consent');
   assert.equal(await page.locator('#automatic').count(),0,'automatic option was removed');
   const fileDownload=page.waitForEvent('download');
   await page.locator('#export-data').click();
   const exported=await fileDownload;
   assert.equal(exported.suggestedFilename().endsWith('.json'),true,
    'Safari and Chromium download a standalone JSON file');
   assert.deepEqual(exports,[{method:'POST',body:{},header:'1'}],
    'Manual export is an authenticated first-party action with no OpenAI consent or model request');
   assert.match(await page.locator('#export-status').innerText(),/Download initiated/);
   assert.equal(requests.length,0,'Export does not trigger OpenAI analysis');
   assert.equal(await page.locator('.analysis-report img').count(),0,
    'bank-sourced model text must be literal and never execute HTML');
   assert.equal(await page.locator('.quality-note').count(),0,
    'a source-reviewed substantive report has no false quality warning');
   assert.equal(await page.locator('.glance-heading').innerText(),'At a glance');
   assert.equal(await page.locator('.metric-grid .metric').count(),1);
   assert.equal(await page.locator('.analysis-lead').count(),1,
    'source-cited executive judgment is prominent');
   assert.match(await page.locator('.analysis-lead h2').innerText(),/could fall to/);
   assert.equal(await page.locator('.insight-card').count(),2,
    'narrative findings remain expandable');
   assert.equal(await page.locator('.insight-graphic').count(),4,
    'model-selected graphics remain visible');
   assert.equal(await page.locator('.insight-card[open]').count(),0,
    'analysis starts as a compact at-a-glance view');
   assert.match(await page.locator('.insight-card').first().locator('.insight-head').innerText(),/Bills are concentrated/);
   assert((await page.locator('.insight-card').first().locator('.insight-preview').innerText()).length<160);
   assert.equal(await page.locator('.graph svg').count(),3,
    'source-calculated line/bar/donut charts are visible without clicks');
   await page.locator('.metric > summary.metric-summary').click();
   assert.match(await page.locator('.metric-detail').innerText(),/source-calculated/);
   await page.locator('.insight-card').first().locator('summary.insight-summary').click();
   assert.match(await page.locator('.analysis-lead .insight-depth').innerText(),/How this was assessed/);
   assert.match(await page.locator('.insight-card').first().locator('.insight-body').innerText(),/conditional/,
    'single expansion reveals underlying rationale');
   assert.equal(await page.locator('.analysis-report img').count(),0,
    'expanded bank descriptions remain literal text, not HTML');
   assert.equal(await page.locator('.graph svg').count(),3,
    'expanding evidence does not hide the graphics');
   assert.equal(await page.locator('.donut-legend-item').count(),3);
   await page.locator('.ranked-row').first().waitFor({state:'visible'});
   await page.locator('.ranked-row').first().waitFor({state:'visible'});
   assert.equal(await page.locator('.ranked-row').count(),3);
   assert.equal(await page.locator('.graph svg path').count()>=1,true);
   assert.equal(await page.locator('.graph svg rect').count()>0,true);
   assert.equal(await page.locator('.graph svg path').count()>2,true);
   assert.equal(await page.locator('.evidence').first().getAttribute('open'),null);
   assert.equal(await page.locator('.limits').getAttribute('open'),null);
   await page.locator('.graph svg').first().click({position:{x:115,y:90}});
   assert.equal(await page.locator('.graph .selected').first().textContent().then(x=>x.includes('$')),true);
   await page.locator('.limits').evaluate(el=>el.open=true);
   assert.equal(await page.locator('.audit li').count(),2);
   assert.equal(settings.length,0,'no automatic settings calls');
   // Persisted results remain visible across refresh, source changes and
   // failed AI reruns; GET never makes a paid provider request.
   state.status='outdated';state.isCurrent=false;
   await page.reload();
   await page.locator('.analysis-report').waitFor({state:'visible'});
   assert.match(await page.locator('#status').innerText(),/remains viewable/);
   assert.equal(await page.locator('.insight-graphic').count(),4);
   assert.equal(requests.length,0);
   state.status='failed';state.errorCode='invalid_ai_evidence';
   await page.reload();
   await page.locator('.analysis-report').waitFor({state:'visible'});
   assert.match(await page.locator('#status').innerText(),/last successful analysis is preserved/i);
   assert.match(await page.locator('#status').innerText(),/invalid_ai_evidence/);
   assert.equal(requests.length,0);
   state.status='ready';state.isCurrent=true;delete state.errorCode;
   await page.reload();
   await page.locator('.analysis-report').waitFor({state:'visible'});
   await page.locator('#consent').check();
   await page.locator('#run').click();
   await page.locator('.quality-note').waitFor({state:'visible'});
   assert.equal(requests.length,1,'manual rerun enqueues background analysis');
   assert.deepEqual(requests[0],{scope:'financial-analysis-v3',consent:true});
   assert.equal(await page.locator('#consent').isChecked(),false,'consent resets after every paid run');
   assert.equal(await page.locator('.analysis-report').count(),1,
    'a new cached report replaces the old; no transcript or stacked duplicate results');
   assert.equal(await page.locator('.insight-card').count(),1);
   assert.equal(await page.locator('.insight-graphic').count(),1);
   assert.match(await page.locator('.quality-note').innerText(),/Limited analysis/,
    'a shallow but verified report is visibly labelled incomplete');
   assert.equal(await page.locator('.graph svg').count(),1,
    'independent comparison is visible before expanding details');
   await page.locator('.insight-card').first().locator('summary.insight-summary').click();
   assert.equal(await page.locator('.legend').count(),1);
   await page.locator('.limits').evaluate(el=>el.open=true);
   assert.equal(await page.locator('.analysis-detail summary')
    .filter({hasText:'Independent history cross-check'}).count(),1);
   assert.equal(settings.length,0,'manual Analysis never activates standing consent');
   assert.equal(await page.locator('#run').isDisabled(),true,'another run needs a new click and consent');
   assert.equal(await page.locator('#run-qaqc').isDisabled(),true,
    'a separate QA/QC run needs its own one-time authorization');
   assert.equal(qaCalls.length,0,'QA/QC does not auto-run with ordinary financial analysis');
   await page.locator('#qaqc-consent').check();
   assert.equal(await page.locator('#run-qaqc').isDisabled(),false);
   await page.locator('#run-qaqc').click();
   await page.locator('#qaqc-analysis .quality-audit').waitFor({state:'visible'});
   assert.deepEqual(qaCalls,[{body:{scope:'ledger-qaqc-v1',consent:true},header:'1'}],
    'QA/QC has separate explicit consent and uses an authenticated action');
   assert.equal(requests.length,1,'QA/QC does not trigger ordinary AI Analysis');
   assert.equal(await page.locator('#qaqc-consent').isChecked(),false,'QA/QC consent resets after each run');
   assert.equal(await page.locator('#qaqc-analysis .qaqc-issues details').count(),2);
   assert.match(await page.locator('#qaqc-analysis .qaqc-metrics').innerText(),/1096 days recalculated/);
   await page.locator('#qaqc-analysis .qaqc-issues details').first().locator('summary').click();
   assert.match(await page.locator('#qaqc-analysis .qaqc-issues details').first().innerText(),/2026-12-19/);
   await page.locator('#qaqc-analysis .insight-card').first().locator('summary.insight-summary').click();
   assert.equal(await page.locator('#qaqc-analysis img').count(),0,
    'expanded QA findings do not execute untrusted HTML');
   assert.equal(await page.locator('#analysis .analysis-report').count(),1,
    'ordinary analysis remains separate from QA/QC');
   assert.equal(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+2),true,
    'analysis fits narrow mobile width');
   assert.deepEqual(errors,[],name+' AI analysis should not throw');
   await context.close();await browser.close();
  }
  console.log('One-click autonomous AI browser: desktop/iPhone adaptive visuals, audits and privacy passed');
 }finally{server.kill()}
})();
