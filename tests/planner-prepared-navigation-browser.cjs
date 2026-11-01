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
   await page.locator('.summary-page').waitFor({state:'attached'});
   assert.equal(await page.locator('#planner-loading').count(),1,
    'Initial load has a full-screen preparation gate');
   const initialMonth=await page.locator('.calendar-month-title').innerText();
   await page.waitForFunction(()=>window.HouseholdAllViewsReady?.()&&
    ['summary','history','schedules','activity','reviews','settings','transactions','trend']
    .every(name=>window.HouseholdPreparedViewStatus().includes(name)),null,{timeout:35000});
   assert.equal(await page.locator('#planner-loading').isHidden(),true,
    'Navigation is enabled only after all eight main pages have been prepared');
   assert.equal(await page.locator('.summary-page').count(),1,
    'Preparation never replaces the visible Home calendar');
   assert.equal(await page.locator('.calendar-month-title').innerText(),initialMonth,
    'Background preparation never changes the selected calendar month');
   const jump=async (view,expected)=>{
    const result=await page.evaluate(view=>{
     const button=document.querySelector('[data-view="'+view+'"]');
     const begin=performance.now();
     button.click();
     return {elapsed:performance.now()-begin,
      visible:document.querySelector('#planner-main>.planner-page')?.className,
      ready:window.HouseholdAllViewsReady(),
      generation:window.HouseholdPreparedViewGeneration()};
    },view);
    assert.ok(result.visible?.includes(expected),
     'Prepared '+view+' is displayed synchronously: '+JSON.stringify(result));
    assert.equal(result.ready,true,'Ready gate stays released during pure navigation');
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
   await jump('summary','summary-page');
   await jump('history','history-page');
   await jump('schedules','schedule-page');
   await jump('activity','history-page');
   assert.equal(await page.locator('.history-activity-filters').count(),1,
    'Returning to Activity reuses the correctly scoped page');
   const beforeRepeatedNav=await page.evaluate(()=>window.HouseholdPreparedViewGeneration());
   await jump('history','history-page');
   await jump('summary','summary-page');
   assert.equal(await page.evaluate(()=>window.HouseholdPreparedViewGeneration()),beforeRepeatedNav,
    'Repeated navigation reuses prepared nodes without invalidating or regenerating them');

   // A real re-render rebuilds every prepared page behind the loading gate.
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   const priorGeneration=await page.evaluate(()=>window.HouseholdPreparedViewGeneration());
   await page.locator('[data-history-view="merchants"]').click();
   const currentGeneration=await page.evaluate(()=>window.HouseholdPreparedViewGeneration());
   assert.ok(currentGeneration>priorGeneration,
    'Non-navigation edits increment cache generation and discard previous prepared views');
   await page.waitForFunction(()=>window.HouseholdAllViewsReady?.()&&
    window.HouseholdPreparedViewStatus()?.includes('schedules'),null,{timeout:35000});
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.waitForFunction(()=>window.HouseholdAllViewsReady?.(),null,{timeout:35000});
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
   await page.locator('[data-calendar-nav="1"]').click();
   await page.locator('[data-calendar-today]').click();
   assert.equal(await page.locator('.calendar-month-title').innerText(),before,
    'Today returns from a future month');
   await context.close();
   assert.deepEqual(errors,[],device+' console errors');
  }
  console.log('PASS prepared page switching, revalidation, financial totals and calendar navigation in Chromium/iPhone WebKit');
 }finally{
  await chrome?.close();await iphone?.close();server.kill();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
