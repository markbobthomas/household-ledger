'use strict';
// Fictional report rendering on desktop Chromium and narrow iPhone WebKit.
const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium,webkit}=require('./browser-harness.cjs');
module.exports=(async()=>{
 const port=19096,url='http://127.0.0.1:'+port+'/pilot/ai-review.html';
 const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{
  cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
 const data={asOf:'2026-11-19',
  summary:'A future low balance is expected. <img src=x onerror=alert(1)>',
  primary:{opening:9000,low30:{balance:4800,date:'2026-12-02'},
   low90:{balance:4500,date:'2026-12-19'}},
  summaryEvidence:[{text:'Canonical low balance $4500.00'}],
  visuals:[{id:'balance-90',type:'line',title:'Expected checking balance',unit:'USD',
   subtitle:'Ledger-calculated 90-day forecast; excludes unscheduled variable spending',
   points:[{label:'2026-11-19',value:9000},{label:'2026-12-02',value:4800},
    {label:'2026-12-19',value:4500}]},
   {id:'monthly-spending',type:'bar',title:'Spending by month',unit:'USD',
    subtitle:'Actual classified expenses',points:[{label:'2026-09',value:2400},
     {label:'2026-10',value:2700},{label:'2026-11',value:2050}]}],
  sections:[{title:'Payment timing matters',body:'The projected low is $4500.00.',
   importance:'primary',visuals:[{id:'monthly-spending',type:'bar',title:'Spending by month',
    subtitle:'Actual spending',points:[{label:'Sep',value:2400},{label:'Oct',value:2700}]}],
   evidence:[{text:'Payment forecast evidence $4500.00'}]}],
  findings:[{kind:'risk',confidence:'medium',title:'Review variable spending',
   assessment:'The forecast excludes unplanned purchases.',
   recommendation:'Check upcoming card obligations.',evidence:[{text:'Card forecast record'}]}],
  coverage:{historicalTransactionsScanned:372,historicalMonthsScanned:12,
   futureEventsScanned:115,accountCount:2,forecastHorizonDays:1095,
   detailedHistoricalTransactions:140,futureEventsDetailed:80,lastSync:'2026-11-19'},
  investigation:[{kind:'historical-transactions',reason:'Compare merchants',evidenceCount:28}],
  limitations:['Unscheduled variable spending is not independently projected.']};
 const ready=async()=>{for(let i=0;i<70;i++){try{if((await fetch(url)).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}
  throw Error('Fictional report server did not start')};
 try{
  await ready();
  for(const [engine,name,width] of [[chromium,'Chromium',1280],[webkit,'iPhone WebKit',390]]){
   const browser=await engine.launch({headless:true}),context=await browser.newContext({
    viewport:{width,height:800}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/ai/report',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify(data)}));
   await page.goto(url);
   assert.equal(await page.locator('#results').isHidden(),true);
   assert.equal(await page.locator('#run').isDisabled(),true);
   await page.locator('#consent').check();
   await page.locator('#run').click();
   await page.locator('#overview').waitFor({state:'visible'});
   assert.equal(await page.locator('#overview img').count(),0,'AI prose must remain text');
   assert.equal(await page.locator('#lead-graph svg').count(),1,'canonical balance graphic shown');
   assert.equal(await page.locator('#sections .graph svg rect').count()>0,true,
    'AI chooses a historical spending bar chart');
   assert.equal(await page.locator('#details-panel').getAttribute('open'),null,
    'technical method text is collapsed by default');
   assert.equal(await page.locator('#overview-evidence').isVisible(),false,
    'supporting rows remain expandable');
   await page.locator('#details-panel summary').click();
   assert.equal(await page.locator('#coverage').isVisible(),true);
   assert.equal(await page.locator('#overview').evaluate(el=>el.scrollWidth<=el.clientWidth+2),true);
   assert.deepEqual(errors,[],name+' report should have no JS exceptions');
   await context.close();
  }
  console.log('AI financial report browser: desktop/iPhone charts, expandable evidence and safe text passed');
 }finally{server.kill();}
})();