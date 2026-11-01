'use strict';
// All fixtures are fictional. Prepared DOM never persists outside this browser tab.
const assert=require('node:assert/strict'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium,webkit}=require('playwright');
(async()=>{
 const port=19026,url='http://127.0.0.1:'+port+'/index.html';
 const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{
  cwd:path.resolve(__dirname,'..'),stdio:'ignore'
 });
 let chrome,iphone;
 const ready=async()=>{
  for(let i=0;i<90;i++){
   try{if((await fetch(url)).ok)return}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  throw Error('Fictional web server not ready');
 };
 try{
  await ready();
  chrome=await chromium.launch({headless:true});
  iphone=await webkit.launch({headless:true});
  for(const [browser,device] of [[chrome,'desktop Chromium'],[iphone,'iPhone WebKit']]){
   const context=await browser.newContext({viewport:device.startsWith('iPhone')?
    {width:390,height:844}:{width:1280,height:900}});
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url,{waitUntil:'load'});
   await page.locator('.summary-page').waitFor();
   const initialMonth=await page.locator('.calendar-month-title').innerText();
   // Home is immediately ready; inactive pages are prepared one per idle period.
   await page.waitForFunction(()=>window.HouseholdPreparedViewStatus&&
    ['history','schedules','activity','reviews','settings','transactions']
    .every(name=>window.HouseholdPreparedViewStatus().includes(name)),null,{timeout:25000});
   assert.equal(await page.locator('.summary-page').count(),1,
    'Background preparation never replaces the visible Home calendar');
   assert.equal(await page.locator('.calendar-month-title').innerText(),initialMonth,
    'Background preparation never changes the selected calendar month');
   const jump=async (view,expected)=>{
    const result=await page.evaluate(view=>{
     const button=document.querySelector('[data-view="'+view+'"]');
     const begin=performance.now();
     button.click();
     return {elapsed:performance.now()-begin,
      visible:document.querySelector('#planner-main>.planner-page')?.className,
      stillPrepared:window.HouseholdPreparedViewStatus().includes(view)};
    },view);
    assert.ok(result.visible?.includes(expected),
     'Prepared '+view+' is displayed synchronously: '+JSON.stringify(result));
    assert.equal(result.stillPrepared,false,'Activated destination is consumed');
    assert.ok(result.elapsed<180,
     device+' prepared '+view+' should switch without full data processing: '+JSON.stringify(result));
   };
   await jump('history','history-page');
   const budget=await page.locator('.history-spending-overview strong').innerText();
   const reviewBadge=await page.locator('[data-review-tab-count]').textContent();
   await jump('schedules','schedule-page');
   await jump('activity','history-page');
   assert.equal(await page.locator('.history-activity-filters').count(),1,
    'Preloaded Activity must use transactions rather than Budget categories');
   await jump('reviews','reviews-page');
   await jump('settings','settings-page');
   await jump('transactions','transactions-page');

   // Any real re-render invalidates ALL prepared old pages, not just the
   // visible destination, so edits and bank refreshes cannot show stale HTML.
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.locator('[data-history-view="merchants"]').click();
   const cleared=await page.evaluate(()=>window.HouseholdPreparedViewStatus());
   assert.deepEqual(cleared,[],'Non-navigation UI edits invalidate prepared views');
   await page.waitForFunction(()=>window.HouseholdPreparedViewStatus()?.includes('schedules'),null,{timeout:25000});
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('[data-history-view="categories"][aria-pressed="true"]').count(),1,
    'Opening Spending always returns to Budget');
   assert.equal(await page.locator('.history-spending-overview strong').innerText(),budget,
    'Background preparation and invalidation preserve financial totals');
   assert.equal(await page.locator('[data-review-tab-count]').textContent(),reviewBadge,
    'Background preparation and invalidation preserve Review count');

   // The calendar module has independent month state. Neither warming nor
   // showing cached pages may reset it or break next/previous/Today.
   await page.locator('.planner-nav-primary [data-view="summary"]').click();
   const before=await page.locator('.calendar-month-title').innerText();
   await page.locator('[data-calendar-nav="1"]').click();
   const future=await page.locator('.calendar-month-title').innerText();
   assert.notEqual(future,before,'Next month still advances');
   await page.locator('[data-calendar-nav="-1"]').click();
   assert.equal(await page.locator('.calendar-month-title').innerText(),before);
   await page.locator('[data-calendar-today]').click();
   await context.close();
   assert.deepEqual(errors,[],device+' console errors');
  }
  console.log('PASS prepared page switching, revalidation, financial totals and calendar navigation in Chromium/iPhone WebKit');
 }finally{
  await chrome?.close();await iphone?.close();server.kill();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
