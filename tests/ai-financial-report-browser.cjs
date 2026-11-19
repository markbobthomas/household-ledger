'use strict';
// Fictional conversational financial analysis in desktop Chromium and iPhone WebKit.
const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium,webkit}=require('./browser-harness.cjs');
module.exports=(async()=>{
 const port=19096,url='http://127.0.0.1:'+port+'/pilot/ai-review.html';
 const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{
  cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
 const data={asOf:'2026-11-19',blocks:[
  {kind:'paragraph',title:'Important projected low',
   text:'Projected checking may fall to $4500.00 on 2026-12-19. <img src=x onerror=alert(1)>',
   evidence:[{text:'Ledger-calculated projected low $4500.00'}]},
  {kind:'metric',title:'Lowest predicted balance',text:'$4500.00',
   evidence:[{text:'Verified $4500.00 low'}]},
  {kind:'chart',title:'',text:'',chart:{id:'chat-chart-2',type:'line',
   title:'Expected checking balance',subtitle:'Ledger-calculated forecast',
   points:[{label:'2026-11-19',value:9000},{label:'2026-12-02',value:4800},
    {label:'2026-12-19',value:4500}]},evidence:[]},
  {kind:'chart',title:'',text:'',chart:{id:'chat-chart-3',type:'bar',
   title:'Spending by month',subtitle:'Actual expense classifications',
   points:[{label:'2026-09',value:2400},{label:'2026-10',value:2700},
    {label:'2026-11',value:2050}]},evidence:[]}],
  followUps:['Which bills explain that low?'],
  coverage:{historicalTransactionsScanned:372,historicalMonthsScanned:12,
   futureEventsScanned:115,accountCount:2,forecastHorizonDays:1095,
   lastSync:'2026-11-19'},
  investigations:3,
  limitations:['Unknown everyday variable spending remains outside the model.']};
 const ready=async()=>{for(let i=0;i<70;i++){try{if((await fetch(url)).ok)return}
  catch{}await new Promise(r=>setTimeout(r,100))}
  throw Error('Fictional financial chat server did not start')};
 try{
  await ready();
  for(const [engine,name,width] of [[chromium,'Chromium',1280],[webkit,'iPhone WebKit',390]]){
   const browser=await engine.launch({headless:true}),context=await browser.newContext({
    viewport:{width,height:800}}),page=await context.newPage(),errors=[],requests=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/ai/chat',async route=>{
    requests.push(route.request().postDataJSON());
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   });
   await page.goto(url);
   assert.equal(await page.locator('#run').isDisabled(),true);
   assert.equal(await page.locator('.message.assistant').count(),0);
   await page.locator('#consent').check();
   await page.locator('#run').click();
   await page.locator('.message.assistant').waitFor({state:'visible'});
   assert.equal(await page.locator('.message.assistant img').count(),0,
    'AI text must be displayed as safe literal text');
   assert.equal(await page.locator('.graph svg').count(),2,
    'the model selects two independently calculated chart types');
   assert.equal(await page.locator('.metric').count(),1);
   assert.equal(await page.locator('.graph svg path').count()>0,true);
   assert.equal(await page.locator('.graph svg rect').count()>0,true);
   assert.equal(await page.locator('.evidence').first().getAttribute('open'),null,
    'supporting financial evidence remains collapsed');
   assert.equal(await page.locator('.limits').getAttribute('open'),null,
    'financial scope remains expandable');
   assert.equal(requests[0].scope,'financial-chat-v1');
   assert.equal(requests[0].consent,true);
   await page.locator('.graph svg').first().click({position:{x:115,y:90}});
   assert.equal(await page.locator('.graph .selected').first().textContent().then(s=>s.includes('$')),true,
    'chart is directly interactive on both devices');
   await page.locator('#suggestions button').click();
   assert.equal(await page.locator('#question').inputValue(),'Which bills explain that low?');
   await page.locator('#run').click();
   await page.locator('.message.assistant').nth(1).waitFor({state:'visible'});
   assert.equal(requests.length,2);
   assert.equal(requests[1].history.length,2,'follow-up includes preceding chat turn');
   assert.equal(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+2),true,
    'financial conversation must fit available device width');
   assert.deepEqual(errors,[],name+' financial chat should not throw');
   await context.close();
  }
  console.log('Financial chat browser: desktop/iPhone conversation, interactive charts and evidence passed');
 }finally{server.kill()}
})();
