'use strict';
// All fixtures are fictional. Visited DOM never persists outside this browser tab.
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
   await page.waitForFunction(()=>window.HouseholdAllViewsReady?.(),null,{timeout:35000});
   assert.equal(await page.locator('#planner-loading').isHidden(),true,
    'The opening curtain is removed after all financial pages are prepared');
   assert.deepEqual(await page.evaluate(()=>window.HouseholdPreparedViewStatus().sort()),
    ['activity','history','reviews','schedules','settings','summary','transactions','trend'],
    'All eight destinations must be ready before the opening curtain closes');
   assert.deepEqual(await page.evaluate(()=>window.HouseholdPreparedSpendingStatus().sort()),
    ['merchants','sizes','summary'],
    'Merchants, Purchase Sizes and Spending Summary must also be prepared at startup');
   assert.equal(await page.locator('.summary-page').count(),1,
    'Preparation never replaces the visible Home calendar');
   assert.equal(await page.locator('.calendar-month-title').innerText(),initialMonth,
    'Background preparation never changes the selected calendar month');
   // A second tap during the first page's loading state must cancel the
   // older destination. The latest user choice always wins.
   const rapid=await page.evaluate(()=>{
    document.querySelector('.planner-nav-primary [data-view="activity"]').click();
    const loader=Boolean(document.querySelector('#planner-main .ledger-page-wait'));
    document.querySelector('.planner-nav-primary [data-view="summary"]').click();
    return {loader,summarySelected:document.querySelector('.planner-nav-primary [data-view="summary"]').classList.contains('active')};
   });
   assert.equal(rapid.loader,true,'Uncached Activity shows loading immediately');
   assert.equal(rapid.summarySelected,true,'Second Home tap is acknowledged immediately');
   await page.waitForTimeout(100);
   assert.equal(await page.locator('.summary-page').count(),1,
    'A canceled earlier Activity load must not replace the last selected Home page');
   assert.equal(await page.locator('.ledger-page-wait').count(),0);
   const jump=async (view,expected)=>{
    const result=await page.evaluate(view=>{
     const button=document.querySelector('[data-view="'+view+'"]');
     const begin=performance.now();
     button.click();
     return {elapsed:performance.now()-begin,
      selected:button.classList.contains('active'),
      waiting:Boolean(document.querySelector('#planner-main .ledger-page-wait')),
      visible:document.querySelector('#planner-main>.planner-page')?.className,
      ready:window.HouseholdAllViewsReady(),
      generation:window.HouseholdPreparedViewGeneration()};
    },view);
    assert.ok(result.selected,'A tab must acknowledge its click synchronously: '+view);
    assert.ok(result.elapsed<180,
     device+' acknowledgment must not run forecast or heavy view rendering: '+JSON.stringify(result));
    if(!result.visible?.includes(expected))
     assert.equal(result.waiting,true,'Uncached '+view+' shows a loading state on the selected page');
    await page.waitForFunction(expected=>
     Boolean(document.querySelector('#planner-main>.planner-page')?.className.includes(expected))&&
     !document.querySelector('#planner-main .ledger-page-wait'),expected,{timeout:30000});
    assert.equal(await page.locator('.ledger-page-wait').count(),0,
     'The page-local loader is removed once destination appears');
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

   // Pure internal pane changes must be instant after the opening warmup.
   // All three are rendered before the first tap, not rebuilt on selection.
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   const spendingEpoch=await page.evaluate(()=>window.HouseholdPreparedViewGeneration());
   for(const pane of ['merchants','sizes','summary','categories']){
    const result=await page.evaluate(pane=>{
     const button=document.querySelector('[data-history-view="'+pane+'"]');
     const begin=performance.now();
     button.click();
     return {elapsed:performance.now()-begin,
      selected:button.getAttribute('aria-pressed'),
      active:document.querySelector('.history-page')?.className,
      prepared:window.HouseholdPreparedSpendingStatus()};
    },pane);
    assert.ok(result.elapsed<180,device+' Spending switch should reuse cached DOM: '+JSON.stringify(result));
    assert.equal(result.selected,'true','The selected Spending pane is acknowledged: '+pane);
    assert.equal(await page.evaluate(()=>window.HouseholdPreparedViewGeneration()),spendingEpoch);
   }
   // Pure internal pane changes must not restart the expensive preparation
   // cycle or stall an unrelated main tab.
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   const priorGeneration=await page.evaluate(()=>window.HouseholdPreparedViewGeneration());
   await page.locator('[data-history-view="merchants"]').click();
   assert.equal(await page.evaluate(()=>window.HouseholdPreparedViewGeneration()),priorGeneration,
    'Spending subtabs only redraw the active pane');
   assert.equal(await page.evaluate(()=>window.HouseholdAllViewsReady()),true);
   await page.locator('.planner-nav-primary [data-view="schedules"]').click();
   await page.locator('[data-bills-tab="repeating"]').click();
   assert.equal(await page.locator('[data-bills-pane="repeating"]').isVisible(),true);
   assert.equal(await page.evaluate(()=>window.HouseholdPreparedViewGeneration()),priorGeneration,
    'Bills panes reuse the existing page');
   await page.locator('.top-actions [data-view="reviews"]').click();
   await page.locator('[data-review-tab="payments"]').click();
   assert.equal(await page.locator('[data-review-pane="payments"]').isVisible(),true);
   assert.equal(await page.evaluate(()=>window.HouseholdPreparedViewGeneration()),priorGeneration,
    'Review panes reuse the existing page');
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.evaluate(()=>window.HouseholdAllViewsReady()),true);
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
