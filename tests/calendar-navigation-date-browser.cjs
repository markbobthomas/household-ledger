'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{
 const port=18891,server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],
  {cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
 let desktop,iphone;
 const url='http://127.0.0.1:'+port+'/index.html';
 try{
  for(let n=0;n<100;n++){
   try{const resp=await fetch(url);if(resp.ok)break}catch{}
   if(n===99)throw Error('Fixture web server did not start');
   await new Promise(r=>setTimeout(r,100));
  }
  desktop=await chromium.launch({headless:true});
  iphone=await webkit.launch({headless:true});
  const cases=[
   ['2026-10-31T15:44:00Z','October 2026','2026-10-31'],
   ['2027-01-01T07:30:00Z','December 2026','2026-12-31'],
   ['2027-01-01T08:30:00Z','January 2027','2027-01-01']
  ];
  for(const [browser,device] of [[desktop,'desktop Chromium'],[iphone,'iPhone WebKit']]){
   for(const [instant,expectedMonth,localToday] of cases){
    const context=await browser.newContext({timezoneId:'America/Los_Angeles',
     viewport:device==='iPhone WebKit'?{width:390,height:844}:{width:1280,height:900}});
    await context.addInitScript(iso=>{
     const OriginalDate=Date;
     class FixedDate extends OriginalDate {
      constructor(...args){if(args.length)super(...args);else super(iso)}
      static now(){return new OriginalDate(iso).getTime()}
     }
     window.Date=FixedDate;
    },instant);
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url,{waitUntil:'load'});
    await page.locator('.calendar-month-title').waitFor();
    const month=()=>page.locator('.calendar-month-title').innerText();
    const selectedDay=()=>page.evaluate(()=>window.HouseholdPlannerSummary.currentDay());
    assert.equal(await month(),expectedMonth,
     device+' should show the Pacific-local month at '+instant);
    assert.equal(await selectedDay(),localToday,
     device+' should select actual local today, including Saturday');
    await page.locator('[data-calendar-nav="1"]').click();
    assert.notEqual(await month(),expectedMonth,
     'Next month must change after '+localToday+' on '+device);
    await page.locator('[data-calendar-nav="-1"]').click();
    assert.equal(await month(),expectedMonth,
     'Previous month must return even when the first day was a weekend');
    assert.equal((await selectedDay()).slice(0,7),localToday.slice(0,7),
     'Returning to current month must not bounce forward into the next month');
    await page.locator('[data-calendar-nav="1"]').click();
    await page.locator('[data-calendar-today]').click();
    assert.equal(await month(),expectedMonth,'Today must restore the actual current month');
    assert.equal(await selectedDay(),localToday,'Today must restore the actual local day');
    assert.equal(await page.locator('[data-calendar-today]').isDisabled(),true,
     'Today is inactive only when the actual as-of date is selected');
    await page.locator('.planner-nav-primary [data-view="activity"]').click();
    await page.locator('.planner-nav-primary [data-view="summary"]').click();
    assert.equal(await month(),expectedMonth,'Switching pages must preserve current calendar month');
    assert.equal(await selectedDay(),localToday,'Switching pages must not replace today');
    assert.deepEqual(errors,[],device+' must have no runtime errors at '+instant);
    await context.close();
   }
  }
  console.log('PASS local calendar day and next/previous/Today across weekend, year and Pacific midnight on Chromium+iPhone WebKit');
 }finally{await desktop?.close();await iphone?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
