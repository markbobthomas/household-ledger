'use strict';
// Fictional-data interaction regression for the current novice-first UI.
// Covers desktop Chromium and iPhone WebKit. Forecast/bank safety remains in
// tests/ci-suite.cjs banking; these checks never connect to real Plaid data.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {chromium,webkit}=require('playwright');

(async()=>{
 const port=18765;
 const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],
  {cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
 let chrome,iphone;
 const url='http://127.0.0.1:'+port+'/index.html';
 const ready=async()=>{for(let n=0;n<100;n++){
  try{const r=await fetch(url);if(r.ok)return}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }throw Error('Fictional fixture web server failed to start')};
 const fixedDate=()=>{const Base=Date;class Fixed extends Base{
  constructor(...xs){if(xs.length)super(...xs);else super('2026-10-19T12:00:00Z')}
  static now(){return new Base('2026-10-19T12:00:00Z').getTime()}
 }window.Date=Fixed};
 try{
  await ready();
  chrome=await chromium.launch({headless:true});
  iphone=await webkit.launch({headless:true});
  for(const [browser,mobile] of [[chrome,false],[iphone,true]]){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900}});
   await context.addInitScript(fixedDate);
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url,{waitUntil:'load'});
   await page.locator('#planner-main .planner-page').first().waitFor();
   assert.equal(await page.locator('h1').innerText(),'Household Ledger');
   assert.deepEqual(await page.locator('.planner-nav-primary .tab-link').allTextContents(),
    ['Calendar','Bills','Bank History']);
   assert.equal(await page.locator('.main-navigation [data-view="reviews"]').count(),1,
    'Things to check is a visible action outside three main destinations');
   assert.equal(await page.locator('.planner-nav-primary svg').count(),3,
    'Each primary destination has its own navigation icon');
   assert.equal(await page.locator('.planner-nav-primary [data-view="transactions"]').count(),0);

   // Responsive navigation and calendar must never push the entire page sideways.
   for(const width of (mobile?[320,390,744]:[768,1024,1280])){
    await page.setViewportSize({width,height:mobile?844:900});
    for(const tab of ['summary','schedules','history']){
     await page.locator('.planner-nav-primary [data-view="'+tab+'"]').click();
     assert.equal(await page.locator('.planner-nav-primary .tab-link.active').count(),1);
     if(tab==='history'){
      // A malformed category control once closed the History page early,
      // shrinking ledger rows to a narrow vertical strip. Measure geometry
      // and check the DOM hierarchy, not merely document horizontal overflow.
      const geometry=await page.evaluate(()=>{
       const pageEl=document.querySelector('.history-page'),
        list=pageEl?.querySelector('.history-list-surface'),
        row=list?.querySelector('.history-actual-row'),
        entry=list?.querySelector('.history-entry'),
        trigger=row?.querySelector('.history-row-open'),
        category=pageEl?.querySelector('.history-category-controls');
       if(!pageEl||!list||!entry||!row||!trigger||!category)return null;
       const outer=pageEl.getBoundingClientRect(),
        frame=list.getBoundingClientRect(),item=row.getBoundingClientRect(),
        action=trigger.getBoundingClientRect();
       return {pageWidth:outer.width,frameWidth:frame.width,
        rowWidth:item.width,buttonWidth:action.width,
        rowLeft:item.left,frameLeft:frame.left,
        categoryTag:category.tagName,
        descriptionWidth:row.querySelector('.history-actual-description')?.getBoundingClientRect().width};
      });
      assert.ok(geometry,'History controls, list and rows must all remain inside the History page');
      assert.equal(geometry.categoryTag,'DIV','Category control must be a valid div element');
      assert.ok(geometry.rowWidth>=geometry.frameWidth-35,
       'History row should fill its ledger frame: '+JSON.stringify(geometry));
      assert.ok(geometry.buttonWidth>=geometry.frameWidth*.5,
       'History button must not collapse into a narrow vertical strip: '+JSON.stringify(geometry));
      assert.ok(geometry.descriptionWidth>=40,
       'Merchant description must have usable horizontal space: '+JSON.stringify(geometry));
      assert.ok(Math.abs(geometry.rowLeft-geometry.frameLeft)<26,
       'History row must stay aligned with its list container: '+JSON.stringify(geometry));
     }
     const size=await page.evaluate(()=>({body:document.body.scrollWidth,
      root:document.documentElement.scrollWidth,window:innerWidth}));
     assert.ok(size.root<=width+3&&size.body<=width+3,
      'No horizontal page overflow at '+width+'px on '+tab+': '+JSON.stringify(size));
    }
   }
   await page.setViewportSize({width:mobile?390:1280,height:mobile?844:900});

   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('.history-subtab').count(),3);
   assert.equal(await page.locator('.history-period-controls [data-history-month]').count(),1);
   assert.equal(await page.locator('[data-history-months]').count(),1);
   assert.equal(await page.locator('.history-page [data-history-view="list"][aria-pressed="true"]').count(),1);
   assert.equal(await page.locator('[data-history-months]').inputValue(),'1',
    'All Bank History subtabs default to one whole calendar month');
   assert.equal(await page.locator('[data-history-month]').inputValue(),'2026-10',
    'Default reporting month is the current calendar month');
   const currentDates=await page.locator('.history-actual-row').evaluateAll(rows=>
    rows.map(row=>row.dataset.historySortDate));
   assert.ok(currentDates.every(date=>date.startsWith('2026-10')),
    'Current-month view does not include the previous month as a rolling 30-day window');
   await page.locator('[data-history-months]').selectOption('all');
   await page.locator('[data-history-view="categories"]').click();
   assert.equal(await page.locator('[data-history-category-insights]').count(),1);
   assert.equal(await page.locator('.history-donut').count(),1);
   assert.ok(await page.locator('.history-category-item').count()>0,
    'Category legend is populated from fictional posted purchase records');
   const budgetCategory=page.locator('.history-category-item').first(),
    categoryName=await budgetCategory.getAttribute('data-history-category-row');
   assert.equal(await budgetCategory.locator('[data-history-budget]').count(),1,
    'Actual spending has an immediately adjacent editable monthly budget');
   assert.equal(await page.locator('.history-category-columns').innerText().then(x=>x.includes('Budget / month')),true);
   await budgetCategory.locator('[data-history-budget]').fill('275.50');
   await budgetCategory.locator('[data-history-budget]').press('Tab');
   await page.waitForFunction(category=>{
    const saved=JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}');
    return saved.categoryMonthlyBudgets?.[category]===275.5;
   },categoryName);
   assert.equal(await page.locator('.history-category-item').first().locator('[data-history-budget]').inputValue(),'275.50');
   assert.equal(await page.locator('.history-list-surface').count(),0,
    'Category view shows its tailored chart rather than duplicating line-item history');
   await page.locator('[data-history-months]').selectOption('3');
   assert.match(await page.locator('.history-budget-explanation').innerText(),/3 monthly budgets/,
    'Three-month actual spending is compared against three full calendar monthly targets');
   assert.equal(await page.locator('[data-history-budget="'+categoryName+'"]').inputValue(),'275.50',
    'A monthly budget carries across report periods');
   await page.locator('[data-history-months]').selectOption('all');
   const firstCategory=page.locator('.history-category-item').first();
   await firstCategory.locator('[data-history-drill-category]').click();
   assert.equal(await page.locator('[data-history-view="list"][aria-pressed="true"]').count(),1,
    'Category drill-down opens the detailed transaction list');
   assert.ok(await page.locator('.history-actual-row').count()>0);

   await page.locator('[data-history-view="sizes"]').click();
   assert.equal(await page.locator('[data-history-size-insights]').count(),1);
   assert.equal(await page.locator('[data-history-size-band]').count(),6);
   const band=page.locator('[data-history-size-band]').filter({hasText:/[1-9][0-9]* purchases/}).first();
   if(await band.count()){
    const index=Number(await band.getAttribute('data-history-size-band'));
    const ranges=[[0,25],[25,50],[50,100],[100,250],[250,500],[500,Infinity]];
    await band.click();
    const values=await page.locator('.history-actual-row').evaluateAll(rows=>rows.map(r=>({
     n:Number(r.dataset.historySortAmount),kind:r.dataset.historyKind,caption:r.innerText
    })));
    assert.ok(values.length>0,'A nonempty purchase bucket opens matching bank records');
    for(const value of values){
     assert.ok(value.n>=ranges[index][0]&&value.n<ranges[index][1],
      'The purchase drilldown must not include unrelated dollar amounts');
     assert.doesNotMatch(value.caption,/· Pending ·/,'Pending items excluded from purchase drilldown');
    }
    await page.locator('[data-history-clear-size]').click();
   }

   await page.locator('[data-history-months]').selectOption('1');
   await page.locator('[data-history-month]').fill('2026-09');
   assert.equal(await page.locator('[data-history-month]').inputValue(),'2026-09');
   const recordDates=await page.locator('.history-actual-row').evaluateAll(rows=>
    rows.map(row=>row.dataset.historySortDate));
   assert.ok(recordDates.every(date=>date.startsWith('2026-09')),
    'A selected month restricts every line-item bank record');
   await page.locator('[data-history-months]').selectOption('all');
   await page.locator('[data-history-month]').fill('2026-10');
   await page.reload({waitUntil:'load'});
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.locator('[data-history-view="categories"]').click();
   assert.equal(await page.locator('[data-history-budget="'+categoryName+'"]').inputValue(),'275.50',
    'A monthly category budget is saved across page reloads');
   assert.equal(await page.locator('[data-history-months]').inputValue(),'1',
    'Returning to Bank History starts with the current calendar month');

   // Actual bank records are inspectable through the shared panel, never editable.
   const bankRow=page.locator('.history-row-open').first();
   if(await bankRow.count()){
    await bankRow.click();
    assert.equal(await page.locator('[data-transaction-overlay]').count(),1,
     'Bank History opens the universal detail surface');
    assert.equal(await page.locator('.transaction-detail [data-close-transaction-detail]').count(),1);
    await page.locator('.transaction-detail-close').click();
   }

   await page.locator('.planner-nav-primary [data-view="schedules"]').click();
   const newRepeat=page.locator('[data-schedule-new]').first();
   await newRepeat.click();
   assert.equal(await page.locator('.transaction-detail [data-schedule-new-form]').count(),1,
    'Create repeating payment in the shared editor');
   await page.locator('.transaction-detail-close').click();
   const editRepeat=page.locator('[data-schedule-edit]').first();
   if(await editRepeat.count()){
    await editRepeat.click();
    assert.equal(await page.locator('.transaction-detail [data-schedule-edit-form]').count(),1,
     'Edit saved schedule without a second inline form');
    await page.locator('.transaction-detail-close').click();
   }

   await page.locator('.planner-nav-primary [data-view="summary"]').click();
   const next=page.locator('[data-calendar-day="2026-10-20"]');
   if(await next.count()){
    await next.click();
    await page.locator('[data-calendar-add]').first().click();
    assert.equal(await page.locator('.transaction-detail [data-calendar-quick-form="add"]').count(),1,
     'Calendar uses the shared creation panel');
    const create=page.locator('.transaction-detail [data-calendar-quick-form="add"]');
    await create.locator('[name=merchant]').fill('Fictional interface test expense');
    await create.locator('[name=amount]').fill('15.50');
    await create.locator('[name=frequency]').selectOption('once');
    await create.locator('button[type=submit]').click();
    await page.locator('[data-transaction-overlay]').waitFor({state:'detached'});
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(
     'household-planner-sample-settings-v1')||'{}'));
    assert.ok(Object.keys(saved.futureTransactionAdds||{}).length>0,
     'A planned payment persists only in fictional forecast preferences');
   }

   await page.locator('.attention-link[data-view="reviews"]').click();
   assert.equal(await page.locator('.review-intro h2').innerText(),'Things to check');
   assert.equal(await page.locator('.reviews-page .review-priority').count(),1);
   const suggestion=page.locator('[data-review-recommendation]').first();
   if(await suggestion.count()){
    await suggestion.click();
    assert.equal(await page.locator('.transaction-detail [data-history-recurring-form]').count(),1,
     'Review suggestions open the same shared editor');
    await page.locator('.transaction-detail-close').click();
   }
   assert.deepEqual(errors,[],'No uncaught client errors on '+(mobile?'iPhone WebKit':'desktop Chromium'));
   await context.close();
  }
  console.log('PASS novice Ledger browser interactions in desktop Chromium and iPhone WebKit');
 }finally{
  await chrome?.close();await iphone?.close();server.kill();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
