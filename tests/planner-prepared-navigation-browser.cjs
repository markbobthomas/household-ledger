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
   // Selected-day rows omit a redundant date track. Regression-test a long
   // fictional payee against the same CSS as the real selected-day panel,
   // including narrow 320px and 390px iPhone layouts.
   for(const width of [320,390,...(device.startsWith('iPhone')?[]:[1280])]){
    await page.setViewportSize({width,height:844});
    const geometry=await page.evaluate(()=>{
     const host=document.querySelector('.summary-page');
     const fixture=document.createElement('section');
     fixture.className='calendar-day-detail';
     fixture.innerHTML='<div class="calendar-day-reconciliation"><div class="calendar-day-transactions">'+
      '<div class="calendar-monthly-entry calendar-detail-entry"><button class="calendar-monthly-row calendar-detail-item ledger-transaction-row" type="button">'+
      '<span class="calendar-monthly-date ledger-transaction-date">Nov 13</span>'+
      '<span class="calendar-monthly-name ledger-transaction-identity"><strong>Fictional Long Utility Merchant Description for a Test</strong></span>'+
      '<strong class="ledger-transaction-amount out">−$1,234.56</strong>'+
      '<span class="calendar-monthly-view ledger-transaction-action" aria-hidden="true">›</span>'+
      '</button></div></div></div>';
     host.appendChild(fixture);
     const row=fixture.querySelector('.ledger-transaction-row');
     const name=row.querySelector('.ledger-transaction-identity').getBoundingClientRect();
     const amount=row.querySelector('.ledger-transaction-amount').getBoundingClientRect();
     const action=row.querySelector('.ledger-transaction-action').getBoundingClientRect();
     const bounds=row.getBoundingClientRect();
     const result={columns:getComputedStyle(row).gridTemplateColumns.split(/\\s+/).length,
      dateHidden:getComputedStyle(row.querySelector('.ledger-transaction-date')).display==='none',
      nameRight:name.right,amountLeft:amount.left,amountRight:amount.right,
      actionLeft:action.left,actionRight:action.right,rowRight:bounds.right,
      overflow:row.scrollWidth-row.clientWidth};
     fixture.remove();
     return result;
    });
    assert.equal(geometry.columns,3,device+' '+width+'px selected-day uses three tracks');
    assert.ok(geometry.dateHidden,device+' '+width+'px has no redundant date');
    assert.ok(geometry.nameRight<=geometry.amountLeft+1&&
     geometry.amountRight<=geometry.actionLeft+1&&
     geometry.actionRight<=geometry.rowRight+1&&geometry.overflow<=1,
     device+' '+width+'px must not overlap or clip amounts: '+JSON.stringify(geometry));
   }
   await page.setViewportSize({width:device.startsWith('iPhone')?390:1280,
    height:device.startsWith('iPhone')?844:900});
   // Every destination is already prepared. Rapid repeated taps should
   // swap cached DOM without a page loader; the latest selection wins.
   const rapid=await page.evaluate(()=>{
    document.querySelector('.planner-nav-primary [data-view="activity"]').click();
    const loader=Boolean(document.querySelector('#planner-main .ledger-page-wait'));
    document.querySelector('.planner-nav-primary [data-view="summary"]').click();
    return {loader,summarySelected:document.querySelector('.planner-nav-primary [data-view="summary"]').classList.contains('active')};
   });
   assert.equal(rapid.loader,false,'Prepared Activity must switch without a loading indicator');
   assert.equal(rapid.summarySelected,true,'Second Home tap is acknowledged immediately');
   await page.waitForTimeout(100);
   assert.equal(await page.locator('.summary-page').count(),1,
    'Rapid cached Activity/Home switches must leave the latest selected page visible');
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
   // Sort/category filters touch only the visible report, not the canonical
   // three-year forecast or cached Home/Bills/Review pages.
   const preFilter=await page.evaluate(()=>({
    generation:window.HouseholdPreparedViewGeneration(),
    work:window.HouseholdPlannerWorkStats()
   }));
   await page.locator('.history-activity-filters [data-history-sort]').selectOption('oldest');
   const postFilter=await page.evaluate(()=>({
    generation:window.HouseholdPreparedViewGeneration(),
    work:window.HouseholdPlannerWorkStats(),
    cached:window.HouseholdPreparedViewStatus()
   }));
   assert.equal(postFilter.generation,preFilter.generation);
   assert.equal(postFilter.work.forecastBuilds,preFilter.work.forecastBuilds,
    'Sorting Activity never recalculates the forecast');
   assert.equal(postFilter.work.historyNormalizations,preFilter.work.historyNormalizations,
    'Sorting reuses the source-history cache');
   assert.ok(postFilter.work.filterRefreshes>preFilter.work.filterRefreshes,
    'Sorting uses the local report update');
   assert.ok(postFilter.cached.includes('summary')&&postFilter.cached.includes('schedules'),
    'Home and Bills remain prepared while filters update');
   await page.locator('.history-activity-filters [data-history-sort]').selectOption('newest');
   // Every read-only filter must preserve the prepared forecast and unrelated
   // page cache; these are work-count invariants, not machine-speed guesses.
   const assertCheapFilter=async label=>{
    const result=await page.evaluate(()=>({
     generation:window.HouseholdPreparedViewGeneration(),
     work:window.HouseholdPlannerWorkStats(),
     cached:window.HouseholdPreparedViewStatus()
    }));
    assert.equal(result.generation,preFilter.generation,label+' must retain prepared generation');
    assert.equal(result.work.forecastBuilds,preFilter.work.forecastBuilds,
     label+' must not build a financial forecast');
    assert.equal(result.work.historyNormalizations,preFilter.work.historyNormalizations,
     label+' must reuse normalized bank history');
    assert.ok(result.cached.includes('summary')&&result.cached.includes('schedules'),
     label+' must keep Home and Bills prepared');
   };
   const categories=await page.locator('.history-activity-filters [data-history-category-filter] option')
    .evaluateAll(options=>options.map(option=>option.value).filter(Boolean));
   if(categories.length){
    await page.locator('.history-activity-filters [data-history-category-filter]').selectOption(categories[0]);
    assert.equal(await page.locator('.history-activity-filters [data-history-category-filter]').inputValue(),categories[0]);
    const visibleCats=await page.locator('.history-entry [data-history-category]')
     .evaluateAll(selects=>selects.map(select=>select.value));
    assert.ok(visibleCats.every(value=>value===categories[0]),
     'Category filter must not display a different category');
    await assertCheapFilter('Category selection');
    await page.locator('.history-activity-filters [data-history-category-filter]').selectOption('');
   }
   const accounts=await page.locator('.history-activity-filters [name="historyAccount"] option')
    .evaluateAll(options=>options.map(option=>option.value).filter(value=>value!=='all'));
   if(accounts.length){
    await page.locator('.history-activity-filters [name="historyAccount"]').selectOption(accounts[0]);
    assert.equal(await page.locator('.history-activity-filters [name="historyAccount"]').inputValue(),accounts[0]);
    await assertCheapFilter('Account selection');
    await page.locator('.history-activity-filters [name="historyAccount"]').selectOption('all');
   }
   await page.locator('.history-activity-filters [data-history-month-toggle]').click();
   await page.locator('.history-activity-filters [data-history-month-all]').click();
   await assertCheapFilter('All-month selection');
   await page.locator('.history-activity-filters [data-history-month-current]').click();
   await assertCheapFilter('This-month selection');
   await page.locator('.history-activity-filters input[name="search"]').fill('fictional-never-match-987654');
   await page.locator('.history-activity-filters input[name="search"]').press('Enter');
   assert.equal(await page.locator('.history-activity-filters [data-history-month-menu]').isHidden(),true,
    'Submitting Activity search closes the month overlay so Clear is clickable');
   assert.equal(await page.locator('.history-entry').count(),0,'Search must filter visible records');
   await assertCheapFilter('Search submit');
   await page.locator('[data-clear-history-search]').click();
   assert.equal(await page.locator('.history-activity-filters input[name="search"]').inputValue(),'');
   await assertCheapFilter('Clear search');
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
      selected:document.querySelector('[data-history-view="'+pane+'"]')?.getAttribute('aria-pressed'),
      active:document.querySelector('.history-page')?.className,
      prepared:window.HouseholdPreparedSpendingStatus()};
    },pane);
    assert.ok(result.elapsed<180,device+' Spending switch should reuse cached DOM: '+JSON.stringify(result));
    assert.equal(result.selected,'true','The selected Spending pane is acknowledged: '+pane);
    assert.equal(await page.evaluate(()=>window.HouseholdPreparedViewGeneration()),spendingEpoch);
   }
   // Merchants and Purchase Sizes use the same lightweight filter path as
   // Activity. A regression in either report must fail on both device engines.
   for(const pane of ['merchants','sizes']){
    await page.locator('[data-history-view="'+pane+'"]').click();
    const baseline=await page.evaluate(()=>({
     epoch:window.HouseholdPreparedViewGeneration(),
     work:window.HouseholdPlannerWorkStats()
    }));
    const assertReportOnly=async (operation,prior,expectOneReport=true)=>{
     const next=await page.evaluate(()=>({
      epoch:window.HouseholdPreparedViewGeneration(),
      work:window.HouseholdPlannerWorkStats(),
      cached:window.HouseholdPreparedViewStatus()
     }));
     assert.equal(next.epoch,baseline.epoch,pane+' '+operation+' preserves prepared pages');
     assert.equal(next.work.forecastBuilds,baseline.work.forecastBuilds,
      pane+' '+operation+' never recalculates balance projections');
     assert.equal(next.work.historyNormalizations,baseline.work.historyNormalizations,
      pane+' '+operation+' reuses historical transaction data');
     assert.ok(next.cached.includes('summary')&&next.cached.includes('schedules'),
      pane+' '+operation+' keeps Home and Bills prepared');
     if(expectOneReport)assert.equal(next.work.historyPageBuilds,prior.work.historyPageBuilds+1,
      pane+' '+operation+' renders only one report');
     return next;
    };
    await page.locator('.history-page [data-history-month-toggle]').click();
    await page.locator('.history-page [data-history-month-all]').click();
    let after=await assertReportOnly('all months',baseline);
    assert.equal(await page.locator('[data-history-view="'+pane+'"][aria-pressed="true"]').count(),1,
     'Month filter keeps the selected Spending view');
    const accountSelect=page.locator('.history-page select[name="historyAccount"]');
    const accountValues=await accountSelect.locator('option').evaluateAll(options=>
     options.map(option=>option.value).filter(value=>value&&value!=='all'));
    if(accountValues.length){
     await accountSelect.selectOption(accountValues[0]);
     after=await assertReportOnly('account',after);
     assert.equal(await page.locator('.history-page select[name="historyAccount"]').inputValue(),accountValues[0],
      'Filtered account remains visibly selected');
     await page.locator('.history-page select[name="historyAccount"]').selectOption('all');
     after=await assertReportOnly('all accounts',after);
    }
    const monthTrigger=page.locator('.history-page [data-history-month-toggle]');
    if(await monthTrigger.getAttribute('aria-expanded')==='true')await monthTrigger.click();
    await monthTrigger.click();
    await page.locator('.history-page [data-history-month-current]').click();
    await assertReportOnly('this month',after);
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
   // Regression: saving a category in Spending expires prepared Activity.
   // Hold idle warming in this fictional browser so we exercise a genuinely
   // cold Activity tap, instead of a prepared-cache hit.
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.locator('[data-history-category-manager]').evaluate(manager=>{manager.open=true});
   await page.evaluate(()=>{
    window.__queuedNavigationRebuilds=[];
    window.requestIdleCallback=callback=>{
     window.__queuedNavigationRebuilds.push(callback);
     return window.__queuedNavigationRebuilds.length;
    };
   });
   const categoryName='Fictional Navigation Test Category';
   const editGeneration=await page.evaluate(()=>window.HouseholdPreparedViewGeneration());
   await page.locator('[data-history-category-add] input[name="categoryName"]').fill(categoryName);
   await page.locator('[data-history-category-add] button[type="submit"]').click();
   await page.waitForFunction(previous=>
    window.HouseholdPreparedViewGeneration()>=previous+2,editGeneration,{timeout:10000});
   assert.equal(await page.locator('[data-history-category-item="'+categoryName+'"]').count(),1,
    'The category edit is saved before navigating away');
   const coldJump=async view=>{
    const immediate=await page.evaluate(async view=>{
     const button=document.querySelector('.planner-nav-primary [data-view="'+view+'"]');
     const start=performance.now();button.click();
     const instant={duration:performance.now()-start,
      selected:button.classList.contains('active'),
      busy:document.querySelector('#planner-main')?.getAttribute('aria-busy'),
      loading:!!document.querySelector('#planner-main .ledger-page-wait')};
     // Observe the first frame in the same click task, so the driver cannot
     // check a later frame after the destination has already finished.
     instant.frameLoading=await new Promise(resolve=>
      requestAnimationFrame(()=>resolve(!!document.querySelector('#planner-main .ledger-page-wait'))));
     return instant;
    },view);
    assert.ok(immediate.duration<180&&immediate.selected&&immediate.loading&&
     immediate.busy==='true'&&immediate.frameLoading,
     device+' uncached '+view+' selects and paints a local loader: '+JSON.stringify(immediate));
    await page.waitForFunction(view=>Boolean(document.querySelector('#planner-main>.planner-page'))&&
     !document.querySelector('#planner-main .ledger-page-wait')&&
     (view==='activity'?!!document.querySelector('.history-activity-filters'):
      !!document.querySelector('.history-spending-overview')),view,{timeout:30000});
    assert.notEqual(await page.locator('#planner-main').getAttribute('aria-busy'),'true',
     'The page returns to idle once rebuilt');
   };
   await coldJump('activity');
   assert.ok(await page.locator('.history-activity-filters [data-history-category-filter] option').evaluateAll(
    (options,category)=>options.some(option=>option.value===category),categoryName),
    'The edited category is present in Activity after a cold navigation');
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('[data-history-category-item="'+categoryName+'"]').count(),1,
    'Returning to Spending keeps the saved category');
   await context.close();
   assert.deepEqual(errors,[],device+' console errors');
  }
  console.log('PASS prepared page switching, revalidation, financial totals and calendar navigation in Chromium/iPhone WebKit');
 }finally{
  await chrome?.close();await iphone?.close();server.kill();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
