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
 // The same month checklist controls all reports. Choose actual calendar months.
 async function chooseMonths(page,months){
  await page.locator('[data-history-month-toggle]').click();
  const offered=await page.locator('[data-history-month-option]').evaluateAll(xs=>xs.map(x=>x.value));
  assert.ok(months.every(m=>offered.includes(m)),
   'Expected complete calendar months '+JSON.stringify(months)+'; offered '+JSON.stringify(offered));
  // Keep the popup open: checking and unchecking updates the report immediately.
  for(const month of months){
   try{await page.locator('[data-history-month-option][value="'+month+'"]').check({timeout:4500})}
   catch(error){
    const diag=await page.evaluate(()=>({
     active:document.querySelector('.planner-page')?.className,
     picker:document.querySelector('[data-history-month-picker]')?.outerHTML.slice(0,500),
     menuVisible:Boolean(document.querySelector('[data-history-month-menu]')?.getClientRects().length),
     menuHidden:document.querySelector('[data-history-month-menu]')?.hidden,
     expanded:document.querySelector('[data-history-month-toggle]')?.getAttribute('aria-expanded'),
     options:[...document.querySelectorAll('[data-history-month-option]')].map(x=>({v:x.value,visible:Boolean(x.getClientRects().length)})),
     notice:document.querySelector('#planner-notice')?.textContent.slice(0,200)
    }));
    throw new Error('Could not check '+month+'; '+JSON.stringify(diag)+'; '+error.message);
   }
  }
  for(const month of offered.filter(m=>!months.includes(m)))
   await page.locator('[data-history-month-option][value="'+month+'"]').uncheck();
  await page.locator('[data-history-month-toggle]').click();
 }
 async function chooseAllMonths(page){
  await page.locator('[data-history-month-toggle]').click();
  await page.locator('[data-history-month-all]').click();
  await page.locator('[data-history-month-toggle]').click();
 }
 const selectedMonths=page=>page.locator('[data-history-month-option]:checked')
  .evaluateAll(inputs=>inputs.map(input=>input.value).sort());
 // Every real or predicted transaction uses DATE / NAME / AMOUNT / ACTION.
 async function verifyTransactionAnatomy(page,selector,location){
  assert.ok(await page.locator(selector).count()>0,
   'Missing transaction row in '+location);
  const p=await page.locator(selector).first().evaluate(row=>{
   const box=sel=>row.querySelector(sel)?.getBoundingClientRect();
   const date=box('.ledger-transaction-date'),name=box('.ledger-transaction-identity'),
    amount=box('.ledger-transaction-amount'),action=box('.ledger-transaction-action');
   return {display:getComputedStyle(row).display,
    date:date?.left,name:name?.left,amount:amount?.left,action:action?.left,
    width:row.getBoundingClientRect().width,
    scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  assert.ok(p.display==='grid'&&[p.date,p.name,p.amount,p.action].every(Number.isFinite)&&
   p.date<p.name&&p.name<p.amount&&p.amount<p.action&&p.width>180,
   'Shared four-column transaction order in '+location+': '+JSON.stringify(p));
  assert.ok(p.scrollWidth<=p.viewport+3,
   'Transaction row must not overflow the viewport in '+location+': '+JSON.stringify(p));
 }

 // Verify the OPEN menu, not only the closed Account/Months triggers.
 async function verifyMonthOptionsDoNotOverlap(page,label){
  await page.locator('.history-budget-month-field [data-history-month-toggle]').click();
  const b=await page.evaluate(()=>{
   const menu=document.querySelector('.history-budget-filters [data-history-month-menu]'),
    option=menu.querySelector('.history-month-option'),
    input=option.querySelector('input[type="checkbox"]'),
    text=option.querySelector('span'),next=option.nextElementSibling,
    rect=el=>el?.getBoundingClientRect();
   const [m,o,c,t,n]=[menu,option,input,text,next].map(rect);
   return {open:!menu.hidden,display:getComputedStyle(option).display,
    checkboxWidth:c.width,checkboxHeight:c.height,
    checkboxRight:c.right,textLeft:t.left,
    centerDelta:Math.abs((c.top+c.bottom-t.top-t.bottom)/2),
    gapToNext:n?.top-o.bottom??null,
    menuLeft:m.left,menuRight:m.right,viewport:innerWidth,
    scrollWidth:document.documentElement.scrollWidth};
  });
  assert.ok(b.open&&b.display==='grid'&&b.checkboxWidth>=14&&b.checkboxWidth<=20&&
   b.checkboxHeight>=14&&b.checkboxHeight<=20,
   'Checkbox rows must not inherit full-size form controls at '+label+': '+JSON.stringify(b));
  assert.ok(b.checkboxRight+6<=b.textLeft&&b.centerDelta<=5&&
   (b.gapToNext===null||b.gapToNext>=-1),
   'Checkboxes must not overlap month names or adjacent rows at '+label+': '+JSON.stringify(b));
  assert.ok(b.menuLeft>=-1&&b.menuRight<=b.viewport+1&&b.scrollWidth<=b.viewport+3,
   'Opened menu stays within the viewport at '+label+': '+JSON.stringify(b));
  await page.locator('.history-budget-month-field [data-history-month-toggle]').click();
 }


 // Filter controls should not resize or shift horizontally as Spending tabs change.
 async function verifySpendingFilterWidthParity(page,mobile){
  const widths=mobile?[320,390]:[768,1280];
  for(const width of widths){
   await page.setViewportSize({width,height:mobile?844:900});
   let budget=null;
   for(const view of ['categories','merchants','sizes']){
    await page.locator('[data-history-view="'+view+'"]').click();
    const layout=await page.evaluate(()=>{
     const form=document.querySelector('.history-page .history-budget-filters');
     if(!form)return null;
     const rect=selector=>{
      const box=form.querySelector(selector)?.getBoundingClientRect();
      return box?{left:box.left,width:box.width,height:box.height}:null;
     };
     return {month:rect('.history-month-trigger'),
      account:rect('[name="historyAccount"]'),
      surface:form.getBoundingClientRect().toJSON(),
      pageWidth:document.documentElement.scrollWidth};
    });
    assert.ok(layout&&layout.month&&layout.account,
     view+' reports Months/Account selectors at '+width+'px');
    assert.ok(layout.pageWidth<=width+3,
     view+' toolbar must not cause horizontal scrolling at '+width+'px: '+JSON.stringify(layout));
    if(!budget){budget=layout;continue;}
    for(const key of ['month','account']){
     for(const measure of ['left','width','height']){
      assert.ok(Math.abs(layout[key][measure]-budget[key][measure])<=1.5,
       view+' '+key+' '+measure+' must match Budget at '+width+'px: '+
        JSON.stringify({budget,report:layout}));
     }
    }
    assert.ok(Math.abs(layout.surface.left-budget.surface.left)<=1.5&&
     Math.abs(layout.surface.width-budget.surface.width)<=1.5,
     view+' toolbar surface must match Budget at '+width+'px');
   }
  }
  await page.setViewportSize({width:mobile?390:1280,height:mobile?844:900});
  await page.locator('[data-history-view="categories"]').click();
 }

 // Merchants and Purchase Sizes: month first, then account, then category.
 async function verifyReportFilters(page,view,mobile){
  assert.equal(await page.locator('.history-view-toolbar [data-history-month-toggle]').count(),0,
   view+' has no detached Months control');
  assert.equal(await page.locator('.history-report-filters [name="historyAccount"]').count(),1);
  assert.equal(await page.locator('.history-report-filters [name="historyCategory"]').count(),1);
  assert.equal(await page.locator('.history-report-filters [data-history-month-toggle]').count(),1);
  const domOrder=await page.locator('.history-report-filters').evaluate(form=>
   [...form.children].filter(el=>el.matches('.history-report-month-field')||
    el.querySelector('[name="historyAccount"]')||
    el.querySelector('[name="historyCategory"]'))
    .map(el=>el.matches('.history-report-month-field')?'Months':
     el.querySelector('[name="historyAccount"]')?'Account':'Category'));
  assert.deepEqual(domOrder,['Months','Account','Category'],
   view+' keyboard and document order follows the visible controls');
  for(const width of (mobile?[320,390]:[768,1280])){
   await page.setViewportSize({width,height:mobile?844:900});
   const g=await page.evaluate(()=>{
    const toolbar=document.querySelector('.history-report-filters');
    const rect=q=>toolbar.querySelector(q).getBoundingClientRect().toJSON();
    return {m:rect('.history-month-trigger'),a:rect('[name="historyAccount"]'),
     c:rect('[name="historyCategory"]'),f:toolbar.getBoundingClientRect().toJSON(),
     scroll:document.documentElement.scrollWidth};
   });
   const {m,a,c,f,scroll}=g;
   assert.ok(Math.abs(a.top-m.top)<=3&&m.right<=a.left+1&&
    Math.abs(a.height-m.height)<=3&&a.width>75&&m.width>75,
    view+' Months/Account order and alignment '+width+': '+JSON.stringify(g));
   assert.ok(m.left>=f.left-1&&a.right<=f.right+1&&scroll<=width+3,
    view+' filter controls inside surface '+width+': '+JSON.stringify(g));
   if(width>650)assert.ok(Math.abs(a.top-c.top)<=3&&a.right<=c.left+1&&
    Math.abs(a.height-c.height)<=3&&c.width>75,
    view+' has three aligned desktop columns '+width+': '+JSON.stringify(g));
   else assert.ok(c.top>=a.bottom+3&&c.left>=f.left-1&&
    c.right<=f.right+1&&c.width>=m.width+a.width,
    view+' Category wraps below Months and Account '+width+': '+JSON.stringify(g));
   await verifyMonthOptionsDoNotOverlap(page,view+' '+width+'px');
  }
  await page.setViewportSize({width:mobile?390:1280,height:mobile?844:900});
 }

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
   // The refresh is presentation-only, with the same routes and inputs.
   // Verify that the new visual theme actually loads instead of silently
   // falling back to the industrial stylesheet after a cached deployment.
   const newTheme=await page.evaluate(()=>{
    const css=selector=>getComputedStyle(document.querySelector(selector));
    const nav=css('.main-navigation'),header=css('.topbar'),
     selected=css('.main-navigation .tab-link.active'),
     logo=getComputedStyle(document.querySelector('.topbar h1'),'::before');
    return {background:css('body').backgroundColor,
     nav:nav.backgroundColor,rounding:parseFloat(nav.borderTopLeftRadius),
     header:header.backgroundColor,active:selected.backgroundColor,
     mark:logo.content,accent:css('.btn.primary').borderTopLeftRadius};
   });
   assert.equal(newTheme.background,'rgb(247, 249, 246)',
    'The warm Ledger theme must be loaded, not the retired dark one');
   assert.equal(newTheme.nav,'rgb(255, 255, 255)');
   assert.ok(newTheme.rounding>=18,'Navigation uses soft rounded surfaces');
   assert.equal(newTheme.header,'rgba(0, 0, 0, 0)',
    'Dark industrial top bar is removed');
   assert.equal(newTheme.active,'rgb(230, 244, 237)',
    'Current destination is the calm mint-tinted pill');
   assert.notEqual(newTheme.mark,'none','Ledger has the new soft brand mark');
   assert.deepEqual(await page.locator('.planner-nav-primary .tab-link').allTextContents(),
    ['Home','Spending','Bills','Activity']);
   assert.equal(await page.locator('.topbar [data-view="reviews"]').count(),1,
    'Things to check is a visible action outside three main destinations');
   assert.equal(await page.locator('.main-navigation [data-view="reviews"]').count(),0,
     'Things to check no longer consumes a second navigation row');
    assert.equal(await page.locator('.planner-nav-primary svg').count(),4,
    'Each primary destination has its own navigation icon');
   assert.equal(await page.locator('.planner-nav-primary [data-view="transactions"]').count(),0);
   // Home is a balance-and-calendar surface, not an explanatory landing page.
   assert.equal(await page.locator(
    '.home-intro,.home-next-step,.home-all-set,.home-next-bill,.home-long-range,.calendar-first-tip').count(),0,
    'No instructional cards, setup text, or long-range disclosure above the Calendar');
   assert.equal(await page.locator('.summary-page > .summary-stage').count(),1,
    'The Calendar surface is the direct Home landing view');
   // Keep Home calendar days close to the account/month controls in desktop
   // Chromium and iPhone WebKit without hiding either financial metric.
   const homeGeometry=await page.evaluate(()=>{
    const box=selector=>{
     const r=document.querySelector(selector)?.getBoundingClientRect();
     return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}:null;
    };
    const stage=box('.summary-page > .summary-stage');
    const toolbar=box('.summary-page .calendar-toolbar');
    const metrics=box('.summary-page .summary-numbers');
    const day=box('.summary-page .calendar-day');
    const cards=[...document.querySelectorAll('.summary-page .summary-numbers>div')]
     .map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height}});
    return {stage,toolbar,metrics,day,cards,viewport:innerWidth,
     scrollWidth:document.documentElement.scrollWidth};
   });
   assert.equal(homeGeometry.cards.length,2,'Home keeps both financial metrics');
   assert.ok(homeGeometry.cards[0].right<=homeGeometry.cards[1].left+1,
    'Home metrics should not overlap: '+JSON.stringify(homeGeometry));
   assert.ok(homeGeometry.day.top-homeGeometry.stage.top<=(mobile?240:205),
    'Show the first calendar day higher on Home: '+JSON.stringify(homeGeometry));
   assert.ok(homeGeometry.day.top-homeGeometry.toolbar.bottom<=(mobile?140:130),
    'No unnecessary blank gap before calendar days: '+JSON.stringify(homeGeometry));
   assert.ok(homeGeometry.scrollWidth<=homeGeometry.viewport+3,
    'Compact Home must not introduce horizontal overflow: '+JSON.stringify(homeGeometry));
   assert.equal(await page.locator('[data-summary-next-90-low] .summary-overline').innerText(),
    'Lowest in next 90 days','The balance card explicitly says 90 calendar days');
   const rollingValue=await page.locator('[data-summary-next-90-value]').innerText(),
    rollingDate=await page.locator('[data-calendar-next-90-low]').getAttribute('data-calendar-next-90-low');
   assert.ok(rollingDate,'The 90-day card names a navigable forecast date');
   const initialMonth=await page.locator('.calendar-month-title').innerText();
   await page.locator('[data-calendar-nav="1"]').click();
   assert.notEqual(await page.locator('.calendar-month-title').innerText(),initialMonth,
    'Month navigation changes the calendar grid');
   assert.equal(await page.locator('[data-summary-next-90-value]').innerText(),rollingValue,
    'The rolling 90-day low remains anchored to the as-of date while browsing other months');
   assert.equal(await page.locator('[data-calendar-next-90-low]').getAttribute('data-calendar-next-90-low'),
    rollingDate,'Changing calendar months must not change the 90-day low date');
   await page.locator('[data-calendar-next-90-low]').click();
   assert.equal(await page.locator('[data-calendar-day="'+rollingDate+'"][aria-pressed="true"]').count(),1,
    'Selecting the lowest date jumps to its correct month and opens the day');
   await page.locator('[data-calendar-today]').click();
   assert.equal(await page.locator('#planner-menu [data-view="recap"]').count(),0,
    'Summary is no longer hidden inside More');
   // Bigger, readable type on desktop, with proportionate mobile type.
   // Compare actual spending at the progress-track endpoint and read-only target.
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   const budgetType=await page.evaluate(()=>{
    const root=document.querySelector('[data-history-category-insights]'),
     row=root?.querySelector('.history-category-item'),
     size=el=>el?parseFloat(getComputedStyle(el).fontSize):null,
     box=el=>el?.getBoundingClientRect(),
     name=row?.querySelector('.history-category-name'),
     count=name?.querySelector('small'),
     actual=row?.querySelector('.history-category-actual'),
     input=row?.querySelector('.history-budget-target'),
     cols=root?.querySelector('.history-category-columns'),
     target=row?.querySelector('.history-budget-target');
    return {body:size(document.body),name:size(name),count:size(count),
     amount:size(actual),input:size(input),heading:size(cols),
     nav:size(document.querySelector('.main-navigation .tab-link')),
     targetLeft:box(target)?.left,amountRight:box(actual)?.right,
     rowWidth:box(row)?.width,scrollWidth:document.documentElement.scrollWidth,
     viewport:innerWidth};
   });
   assert.ok(budgetType.name>=(mobile?13:18),
    'Budget category titles must be significantly more readable: '+JSON.stringify(budgetType));
   assert.ok(budgetType.amount>=(mobile?12:16)&&
    budgetType.input>=(mobile?12:15),
    'Budget actual and read-only monthly target remain readable');
   if(!mobile){
    assert.ok(budgetType.body>=15&&budgetType.nav>=15&&budgetType.heading>=12,
     'Desktop text and Budget table headings are enlarged');
    assert.ok(budgetType.count>=12,'Desktop category transaction counts are readable');
   }
   assert.ok(budgetType.rowWidth>0,
    'The simplified Budget rows remain visible with readable actual and target values');
   assert.ok(budgetType.scrollWidth<=budgetType.viewport+1,
    'Larger Budget type must not create horizontal page overflow');
   await page.locator('[data-history-view="summary"]').click();
   assert.equal(await page.locator('[data-history-view="summary"][aria-pressed="true"]').count(),1);
   assert.equal(await page.locator('[data-financial-recap]').count(),1);
   for(const key of ['bills','spent','income','budget']){
    assert.equal(await page.locator('[data-recap-'+key+']').count(),1,
     'Summary includes '+key+' metric in '+(mobile?'iPhone':'desktop')+' mode');
   }
   assert.equal(await page.locator('.financial-recap-card').count(),3);
   assert.equal(await page.locator('.financial-recap-page [data-history-month-picker]').count(),1,
    'Summary reuses the Spending calendar-month checklist');
   assert.equal(await page.locator('.financial-recap-page input:not([data-history-month-option]),.financial-recap-page select').count(),0,
    'Summary contains no editable financial fields');
   assert.ok(await page.locator('[data-recap-bills]').innerText().then(v=>v.includes('Total monthly bills')),
    'Single-month bills are a selected-month sum, not a 12-month average');
   assert.doesNotMatch(await page.locator('[data-recap-bills]').innerText(),/12-month average/);
   // Summary totals count only saved recurring or explicitly scheduled
   // expenses across accounts, not category-based guesses from Demo history.
   const recapMoney=async key=>{
    const amount=await page.locator('[data-recap-'+key+'] strong').innerText();
    return amount==='Not set'?null:Math.round(Number(amount.replace(/[^0-9.-]/g,''))*100);
   };
   const october={spent:await recapMoney('spent'),income:await recapMoney('income'),
    budget:await recapMoney('budget'),bills:await recapMoney('bills')};
   assert.equal(october.bills,0,
    'Demo has no confirmed scheduled bills, so posted mortgage-like labels alone do not count');
   assert.match(await page.locator('[data-recap-bills] small').innerText(),/Paid .*Upcoming/,
    'Summary distinguishes paid bills from future estimates without extra controls');
   assert.deepEqual(await selectedMonths(page),['2026-10'],
    'Summary initially shows the current calendar month');
   await chooseMonths(page,['2026-09']);
   const september={spent:await recapMoney('spent'),income:await recapMoney('income'),
    budget:await recapMoney('budget'),bills:await recapMoney('bills')};
   assert.equal(september.bills,0,
    'A completed month with posted activity but no confirmed schedules shows zero bills');
   assert.ok(september.bills<september.spent,
    'Regular bills exclude unrelated posted groceries, shopping and restaurant purchases');
   await chooseMonths(page,['2026-11']);
   const novemberBills=await recapMoney('bills');
   assert.ok(Number.isInteger(novemberBills)&&novemberBills>=0,
    'Next calendar month is selectable and shows its actual predicted bill total');
   assert.match(await page.locator('[data-recap-bills]').innerText(),/November 2026/);
   const categoryBillCents=async()=>page.locator('.financial-recap-card').first()
    .locator('.financial-recap-row strong').evaluateAll(xs=>xs.reduce((sum,x)=>
     sum+Math.round(Number(x.textContent.replace(/[^0-9.-]/g,''))*100),0));
   assert.equal(await categoryBillCents(),novemberBills,
    'Selected-month bill category amounts add up to the same total');
   await chooseMonths(page,['2026-10','2026-11']);
   assert.equal(await recapMoney('bills'),october.bills+novemberBills,
    'Two selected months sum posted bills plus actual dated bill predictions, not yearly averages');
   assert.equal(await categoryBillCents(),october.bills+novemberBills);
   await chooseMonths(page,['2026-09','2026-10']);
   assert.deepEqual(await selectedMonths(page),['2026-09','2026-10']);
   for(const key of ['spent','income','budget']){
    const combined=await recapMoney(key);
    if(october[key]!==null&&september[key]!==null)
     assert.equal(combined,october[key]+september[key],
      'Summary '+key+' totals exactly sum selected whole calendar months');
   }
   assert.equal(await recapMoney('bills'),october.bills+september.bills,
    'Past plus current sums posted bills with current-month upcoming bills');
   assert.equal(await categoryBillCents(),october.bills+september.bills,
    'Past and upcoming bill category amounts reconcile to the full-month total');
   assert.match(await page.locator('[data-recap-spent]').innerText(),/2 months selected/);
   await page.setViewportSize({width:320,height:844});
   const summaryWidth=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));
   assert.ok(summaryWidth.content<=summaryWidth.viewport+1,
    'Summary selector never causes phone-width overflow: '+JSON.stringify(summaryWidth));
   await page.setViewportSize({width:mobile?390:1280,height:mobile?844:900});
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.deepEqual(await selectedMonths(page),['2026-09','2026-10'],
    'Selection persists when returning from Summary to Budget');
   // Restore the default period for the independent existing view regressions.
   await page.locator('[data-history-month-toggle]').click();
   await page.locator('[data-history-month-current]').click();
   await page.locator('[data-history-month-toggle]').click();
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('[data-history-view="categories"][aria-pressed="true"]').count(),1);


   // Responsive navigation and calendar must never push the entire page sideways.
   for(const width of (mobile?[320,390,744]:[768,1024,1280])){
    await page.setViewportSize({width,height:mobile?844:900});
    for(const tab of ['summary','schedules','history','activity']){
     await page.locator('.planner-nav-primary [data-view="'+tab+'"]').click();
     assert.equal(await page.locator('.planner-nav-primary .tab-link.active').count(),1);
     if(tab==='history'){
       assert.equal(await page.locator('[data-history-view="categories"][aria-pressed="true"]').count(),1,
        'Spending opens Budget by default');
      }
      if(tab==='activity'){
       // Standalone Activity opens posted transactions directly.
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
       assert.equal(await page.locator('.history-search-wrap .visually-hidden').count(),1);
       assert.equal(await page.locator('[data-history-category-filter]').getAttribute('aria-label'),
        'Filter transactions by category');
     }
     if(tab==='schedules'){
       const layout=await page.evaluate(()=>{
        const label=document.querySelector('.schedule-page .schedule-category-controls>label'),
         control=label?.querySelector('[data-schedule-category-filter]');
        if(!label||!control)return null;
        const caption=label.querySelector('.visually-hidden'),labelBox=label.getBoundingClientRect(),
         select=control.getBoundingClientRect(),captionBox=caption?.getBoundingClientRect();
        return {captionWidth:captionBox?.width,captionHeight:captionBox?.height,
         selectTop:select.top,selectBottom:select.bottom,labelTop:labelBox.top,
         accessible:control.getAttribute('aria-label'),
         overflow:document.documentElement.scrollWidth-innerWidth,
         options:[...control.options].map(o=>o.value)};
       });
       assert.ok(layout&&layout.captionWidth<=1&&layout.captionHeight<=1&&
        layout.selectTop>=layout.labelTop&&layout.selectBottom>layout.selectTop&&
        layout.accessible==='Filter repeating payments by category'&&layout.overflow<=3,
        'Bills Category control must be self-explanatory, accessible and aligned at '+width+': '+JSON.stringify(layout));
       assert.equal(layout.options[1],'Other','Other is the first named category in Bills');
       assert.equal(await page.locator('.schedule-search-wrap .visually-hidden').count(),1);
       assert.equal(await page.locator('[data-schedule-search]').getAttribute('placeholder'),'Search payments');
       assert.equal(await page.locator('.schedule-page [data-schedule-category-add],.schedule-page .schedule-category-manager').count(),0,
        'Category creation is no longer part of the Bills toolbar');
      }
      if(tab==='summary'){
       const metricLayout=await page.evaluate(()=>{
        const root=document.querySelector('.summary-page .summary-numbers');
        const cards=[root?.querySelector('.summary-bank'),root?.querySelector('.summary-monthly')];
        if(cards.some(card=>!card))return null;
        const box=el=>el.getBoundingClientRect();
        const labels=cards.map((card,i)=>box(i?card.querySelector('.summary-overline'):card.querySelector('small:first-child')));
        const values=cards.map(card=>box(card.querySelector('strong')));
        const bankValue=cards[0].querySelector('[data-bank-available-value]');
        return {labelBottoms:labels.map(b=>b.bottom),valueBottoms:values.map(b=>b.bottom),
         bankColor:bankValue?getComputedStyle(bankValue).color:null,
         bankText:bankValue?.textContent||''};
       });
       if(metricLayout){
        const spread=xs=>Math.max(...xs)-Math.min(...xs);
        assert.ok(spread(metricLayout.labelBottoms)<=2,
         'Calendar metric labels must align at '+width+': '+JSON.stringify(metricLayout));
        assert.ok(spread(metricLayout.valueBottoms)<=2,
         'Calendar metric values must align at '+width+': '+JSON.stringify(metricLayout));
        if(metricLayout.bankColor&&!/^-|Not reported/.test(metricLayout.bankText.trim()))
         assert.equal(metricLayout.bankColor,'rgb(9, 159, 83)',
          'Available Balance should use the brighter green accent');
       }
      }
      const headerGeometry=await page.evaluate(()=>{
       const title=document.querySelector('.topbar h1').getBoundingClientRect(),
        review=document.querySelector('.topbar .attention-link').getBoundingClientRect(),
        menu=document.querySelector('.topbar .planner-menu>summary').getBoundingClientRect();
       return {titleRight:title.right,reviewLeft:review.left,reviewRight:review.right,
        menuLeft:menu.left,reviewTop:review.top,menuTop:menu.top};
      });
      assert.ok(headerGeometry.titleRight<=headerGeometry.reviewLeft+1,
       'Review must not cover the brand at '+width+': '+JSON.stringify(headerGeometry));
      assert.ok(headerGeometry.reviewRight<=headerGeometry.menuLeft+1,
       'Review and More must not overlap at '+width+': '+JSON.stringify(headerGeometry));
      assert.ok(Math.abs(headerGeometry.reviewTop-headerGeometry.menuTop)<12,
       'Review and More must share the header row at '+width+': '+JSON.stringify(headerGeometry));
      const size=await page.evaluate(()=>({body:document.body.scrollWidth,
      root:document.documentElement.scrollWidth,window:innerWidth}));
     assert.ok(size.root<=width+3&&size.body<=width+3,
      'No horizontal page overflow at '+width+'px on '+tab+': '+JSON.stringify(size));
    }
   }
   await page.setViewportSize({width:mobile?390:1280,height:mobile?844:900});

   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('.history-subtab').count(),4);
   assert.deepEqual((await page.locator('.history-subtab').allTextContents()).map(s=>s.trim()),
    ['Budget','Merchants','Purchase sizes','Summary'],
    'Budget is the first named Bank History view');
   const tabGeometry=await page.locator('.spending-tabs .history-subtab').evaluateAll(tabs=>{
    const boxes=tabs.map(tab=>tab.getBoundingClientRect());
    return {widths:boxes.map(b=>b.width),rows:[...new Set(boxes.map(b=>Math.round(b.top)))],
     scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
   });
   assert.ok(Math.max(...tabGeometry.widths)-Math.min(...tabGeometry.widths)<=2&&
    tabGeometry.rows.length===(mobile?2:1)&&
    tabGeometry.scrollWidth<=tabGeometry.viewport+3,
    'Spending tabs remain equal-width and symmetric: '+JSON.stringify(tabGeometry));
   await verifySpendingFilterWidthParity(page,mobile);
   assert.equal(await page.locator('.spending-tabs .history-subtab>span').count(),0,
    'No decorative glyphs repeat the Spending tab names');
   assert.equal(await page.locator('[data-history-view="categories"][aria-pressed="true"]').count(),1,
    'Budget opens by default rather than Transactions');
   assert.equal(await page.locator('[data-history-sort]').count(),0,
    'Transaction sort selector does not misleadingly control Budget order');
    for(const report of ['merchants','sizes']){
     await page.locator('[data-history-view="'+report+'"]').click();
     const field=await page.evaluate(()=>{
      const label=document.querySelector('.history-page .history-category-controls>label'),
       select=label?.querySelector('select'),
       account=document.querySelector('.history-page select[name="historyAccount"]');
      if(!label||!select||!account)return null;
      const caption=label.querySelector('.visually-hidden'),
        selectRect=select.getBoundingClientRect(),labelRect=label.getBoundingClientRect(),
        accountRect=account.getBoundingClientRect(),
        captionRect=caption?.getBoundingClientRect();
       return {labelTop:labelRect.top,selectTop:selectRect.top,
        height:selectRect.height,captionWidth:captionRect?.width,
        accessible:select.getAttribute('aria-label'),
        categoryLeft:selectRect.left,categoryTop:selectRect.top,categoryRight:selectRect.right,
        accountLeft:accountRect.left,accountRight:accountRect.right,accountBottom:accountRect.bottom};
      });
      assert.ok(field&&field.captionWidth<=1&&field.height>=30&&
       field.selectTop>=field.labelTop&&field.accessible==='Filter transactions by category',
       'Category dropdown has no redundant visible label and stays aligned on '+report+': '+JSON.stringify(field));
     if(report!=='list'&&mobile)
      assert.ok(field.categoryTop>=field.accountBottom+3&&
       field.categoryLeft<=field.accountLeft+1&&field.categoryRight>=field.accountRight-1,
       'Category wraps below Months and Account on phone: '+JSON.stringify(field));
    }
    await page.locator('.planner-nav-primary [data-view="activity"]').click();
   await verifyTransactionAnatomy(page,'.history-actual-row .ledger-transaction-row','Posted Activity');
   assert.equal(await page.locator('.history-period-controls [data-history-month-picker]').count(),1);
   assert.equal(await page.locator('[data-history-month-toggle]').count(),1);
   assert.equal(await page.locator('[data-history-months],[data-history-month]').count(),0);
   assert.equal(await page.locator('.planner-nav-primary [data-view="activity"][aria-current="page"]').count(),1);
   assert.deepEqual(await selectedMonths(page),['2026-10'],
    'All Bank History subtabs default to the current calendar month');
   assert.match(await page.locator('[data-history-month-toggle]').innerText(),/October 2026/);
   await page.locator('[data-history-month-toggle]').click();
   assert.equal(await page.locator('[data-history-month-option]').count(),4,
    'Each available calendar month appears as an independent checkbox');
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('[data-history-month-menu]').isVisible(),false,
    'Escape closes the month picker');
   const historySoftStyle=await page.locator('.history-page .history-list-surface').evaluate(el=>{
    const s=getComputedStyle(el);
    return {radius:parseFloat(s.borderTopLeftRadius),background:s.backgroundColor};
   });
   assert.ok(historySoftStyle.radius>=16,'History lines live in soft shared cards');
   assert.equal(historySoftStyle.background,'rgb(255, 255, 255)');
   const currentDates=await page.locator('.history-actual-row').evaluateAll(rows=>
    rows.map(row=>row.dataset.historySortDate));
   assert.ok(currentDates.every(date=>date.startsWith('2026-10')),
    'Current-month view does not include the previous month as a rolling 30-day window');

   // Bank History multi-select is a read-only, immediate sum of displayed rows.
   const boxes=page.locator('.history-page [data-history-select]'),
    total=page.locator('[data-history-selected-total]'),
    count=page.locator('[data-history-selected-count]');
   assert.ok(await boxes.count()>=2,'Two fictional bank rows exist for multi-selection');
   // A personal note is a subtitle tied to one actual bank record, NOT a
   // source-bank mutation. It survives page refresh, editing and clearing.
   const noteRow=page.locator('.history-entry:has([data-history-select])').first();
   const noteEdit=noteRow.locator('[data-edit-transaction-note]');
   assert.equal(await noteEdit.count(),1,'Every actual transaction offers an edit-note cue');
   await noteEdit.click();
   const noteForm=page.locator('.transaction-detail [data-transaction-note-form]');
   assert.equal(await noteForm.count(),1);
   const noteKey=await noteForm.getAttribute('data-transaction-note-form');
   const noteText='Fictional family supply purchase';
   await noteForm.locator('[name=note]').fill(noteText);
   await noteForm.locator('[type=submit]').click();
   assert.equal(await noteForm.locator('[data-note-status]').innerText(),'Saved',
    'Note saves to planning preferences without a bank edit');
   const notePrefs=await page.evaluate(()=>JSON.parse(localStorage.getItem(
    'household-planner-sample-settings-v1')||'{}'));
   assert.equal(notePrefs.transactionNotes?.[noteKey],noteText);
   await page.locator('.transaction-detail-close').click();
   assert.equal(await noteRow.locator('.transaction-note-subtitle').innerText(),noteText,
    'Saved note becomes a visible subtitle directly beneath the transaction name');
   await page.reload({waitUntil:'load'});
   await page.locator('.planner-nav-primary [data-view="activity"]').click();
   const persistedRow=page.locator('[data-edit-transaction-note]').first();
   assert.equal(await persistedRow.getAttribute('data-edit-transaction-note'),noteKey,
    'Account and transaction ID survive reload');
   assert.equal(await persistedRow.locator('xpath=..').locator('.transaction-note-subtitle').innerText(),noteText,
    'Note subtitle survives reloading the transaction list');
   await persistedRow.click();
   await page.locator('.transaction-detail [name=note]').fill('');
   await page.locator('.transaction-detail [data-transaction-note-form] [type=submit]').click();
   assert.equal(await page.locator('.transaction-detail [data-note-status]').innerText(),'Saved');
   await page.locator('.transaction-detail-close').click();
   const clearedPrefs=await page.evaluate(()=>JSON.parse(localStorage.getItem(
    'household-planner-sample-settings-v1')||'{}'));
   assert.ok(!Object.hasOwn(clearedPrefs.transactionNotes||{},noteKey),
    'Clearing a note preserves bank records and removes the private overlay');

   assert.equal(await boxes.count(),await page.locator('.history-actual-row').count(),
    'Each transaction has exactly one selection checkbox');
   assert.equal(await total.innerText(),'Net total: $0.00');
   await boxes.nth(0).check();
   await boxes.nth(1).check();
   assert.equal(await count.innerText(),'2 selected');
   assert.equal(await page.locator('[data-transaction-overlay]').count(),0,
    'Checking transactions must not open the payment detail editor');
   const expectedCents=await boxes.evaluateAll(inputs=>inputs.filter(input=>input.checked)
    .reduce((sum,input)=>{
     const row=input.closest('.history-actual-row'),
      sign=row.querySelector('.ledger-money-sign')?.textContent?.trim();
     return sum+Math.round(Number(row.dataset.historySortAmount)*100)*(sign==='+'?1:-1);
    },0));
   const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'})
    .format(Math.abs(expectedCents)/100);
   assert.equal(await total.innerText(),'Net total: '+
    (expectedCents<0?'−':expectedCents>0?'+':'')+money,
    'Two selected rows have a cent-accurate signed net sum');
   assert.equal(await page.locator('.history-actual-row.selected').count(),2);
   await boxes.nth(0).uncheck();
   assert.equal(await count.innerText(),'1 selected');
   assert.equal(await page.locator('[data-history-select-all]').evaluate(el=>el.indeterminate),true,
    'Select-all shows a partial selection');
   await page.locator('[data-history-select-all]').check();
   assert.equal(await count.innerText(),(await boxes.count())+' selected');
   await page.locator('[data-history-clear-selection]').click();
   assert.equal(await count.innerText(),'0 selected');
   assert.equal(await total.innerText(),'Net total: $0.00');
   assert.equal(await page.locator('.history-actual-row.selected').count(),0);
   await boxes.nth(0).check();
   await chooseAllMonths(page);
   assert.equal(await count.innerText(),'1 selected',
    'Increasing the visible transaction range retains checked displayed rows');
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('[data-history-selection-summary]').count(),0,
    'The multi-selection UI belongs only to Transactions view');
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('[data-history-category-insights]').count(),1);
   // Create and delete categories in Bank History → Categories only.
   assert.equal(await page.locator('[data-history-category-manager]').count(),1);
   assert.equal(await page.locator('[data-history-category-delete="Other"]').count(),1,
    'Built-in Other is deletable like every other named category');
   await page.locator('.history-category-manager>summary').click();
   await page.locator('[data-history-category-add] [name=categoryName]').fill('Fictional Pet Care');
   await page.locator('[data-history-category-add] button[type=submit]').click();
   assert.equal(await page.locator('.history-category-manage-status').innerText(),
    'Added Fictional Pet Care. Select it on any transaction or bill.');
   assert.equal(await page.locator('[data-history-category-row="Fictional Pet Care"]').count(),1,
    'Newly added categories appear immediately with no purchases or budget');
   assert.equal(await page.locator('[data-history-category-row="Fictional Pet Care"] .history-category-actual').innerText(),
    '$0.00','Unused category displays zero spending');
   assert.equal(await page.locator('.history-category-glyph').count(),0,
    'Categories have no decorative logos or symbols');
   assert.equal(await page.locator('[data-history-category-row="Income"],[data-history-category-row="Transfer"]').count(),0,
    'Income and Transfer are not spending-budget rows');
   assert.equal(await page.locator('[data-history-budget="Income"],[data-history-budget="Transfer"]').count(),0,
    'Non-spending categories have no monthly budget inputs');
   assert.equal(await page.locator('[data-history-category-delete="Income"],[data-history-category-delete="Transfer"]').count(),2,
    'Income and Transfer remain in the category manager, not deleted from the catalog');

   // Edit the amount in Manage, then rename without losing the saved target.
   assert.equal(await page.locator('.history-category-item [data-history-budget]').count(),0,
    'Budget report rows must contain no editable amounts');
   await page.locator('.history-category-manager>summary').click();
   await page.locator('[data-history-budget="Fictional Pet Care"]').fill('45.50');
   await page.locator('[data-history-budget="Fictional Pet Care"]').press('Tab');
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem(
    'household-planner-sample-settings-v1')||'{}').categoryMonthlyBudgets?.['Fictional Pet Care']===45.5);
   assert.equal(await page.locator('.history-category-manager').evaluate(el=>el.open),true,
    'Manage stays open after an amount is saved');
   await page.locator('[data-history-category-rename-open="Fictional Pet Care"]').click();
   const renameEditor=page.locator('[data-history-category-rename="Fictional Pet Care"]');
   assert.equal(await renameEditor.isVisible(),true,'Rename editor opens inline');
   await renameEditor.locator('[name=newCategoryName]').fill('Groceries');
   await renameEditor.locator('[type=submit]').click();
   assert.match(await page.locator('[data-history-category-manage-message]').innerText(),
    /already exists/,'Duplicate category names are rejected without altering data');
   await renameEditor.locator('[name=newCategoryName]').fill('Fictional Animal Care');
   await renameEditor.locator('[type=submit]').click();
   assert.equal(await page.locator('.history-category-manage-status').innerText(),
    'Renamed Fictional Pet Care to Fictional Animal Care. Assignments and budgets kept.');
   assert.equal(await page.locator('[data-history-category-row="Fictional Pet Care"]').count(),0);
   assert.equal(await page.locator('[data-history-budget-display="Fictional Animal Care"]')
    .getAttribute('data-budget-monthly'),'45.50');
   await page.reload();
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('[data-history-budget="Fictional Animal Care"]').inputValue(),'45.50',
    'Renamed category budget remains editable in Manage after reload');
   await page.locator('.history-category-manager>summary').click();
   assert.equal(await page.locator('[data-history-category-delete="Fictional Animal Care"]').count(),1);
   page.once('dialog',dialog=>dialog.accept());
   await page.locator('[data-history-category-delete="Fictional Animal Care"]').click();
   assert.equal(await page.locator('.history-category-manage-status').innerText(),
    'Deleted Fictional Animal Care. Affected items are Unassigned in Things to check.');
   assert.equal(await page.locator('[data-history-category-delete="Fictional Animal Care"]').count(),0);
   assert.equal(await page.locator('[data-history-category-row="Fictional Animal Care"]').count(),0,
    'Deleted renamed categories are removed from the spending list too');
   const catalog=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}'));
   assert.ok(!(catalog.scheduleCategories||[]).includes('Fictional Pet Care'),
    'Deleted category stays absent from saved preferences');
   
   await chooseMonths(page,['2026-10']);
   assert.equal(await page.locator('.history-donut,.history-legend-dot').count(),0,
    'Budget uses the full-width list without the redundant pie or legend colors');
   assert.ok(await page.locator('.history-category-item').count()>0,
    'Category legend is populated from fictional posted purchase records');
   assert.equal(await page.locator('[data-history-budget-bar]').count(),
    await page.locator('.history-category-item').count(),
    'Each category shows a budget usage bar');
   const unsetBar=page.locator('[data-history-budget-bar][data-budget-status="unset"]').first();
   if(await unsetBar.count())assert.equal(
    Number.parseFloat(await unsetBar.locator('.history-budget-fill').evaluate(el=>el.style.width)),0,
    'Without a target, the usage bar is empty');
   assert.equal(await page.locator('[data-history-total-budget]').count(),1,
    'Categories view includes one overall budget summary');
   // Existing non-spending budget preferences must not inflate the denominator,
   // even though classification labels are still available elsewhere.
   const oldIncomeTarget=await page.evaluate(()=>{
    const raw=JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}');
    raw.categoryMonthlyBudgets={...(raw.categoryMonthlyBudgets||{}),
     Income:9750,Transfer:8200};
    localStorage.setItem('household-planner-sample-settings-v1',JSON.stringify(raw));
    return raw.categoryMonthlyBudgets;
   });
   assert.equal(oldIncomeTarget.Income,9750);
   await page.reload();
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('[data-history-category-row="Income"],[data-history-category-row="Transfer"]').count(),0);
   const budgetTotal=await page.locator('[data-history-total-budget] small').allTextContents();
   assert.ok(budgetTotal.every(text=>!text.includes('$17,950')),
    'Pre-existing Income and Transfer monthly targets are excluded from the spending-budget denominator');
   await page.locator('[data-history-view="summary"]').click();
   const summaryBudget=await page.locator('[data-recap-budget] strong').innerText();
   assert.notEqual(summaryBudget,'$17,950.00',
    'Summary budget also excludes previously saved Income and Transfer targets');
   assert.equal(await page.locator('[data-recap-income]').count(),1,
    'Income remains a separate Summary metric');
   await page.locator('[data-history-view="categories"]').click();

   assert.equal(await page.locator('.history-spending-overview').count(),1,
    'Compact category view shows one spending total and purchase count');
   assert.equal(await page.locator('.history-category-panel-heading h2').count(),0,
    'Spending is already identified by the selected tab; the budget toolbar has no repeat title');
   assert.equal(await page.locator('.history-insight-note,.history-budget-explanation').count(),0,
    'Redundant explanatory paragraphs are removed');
   assert.equal(await page.locator('.history-spending-overview').innerText().then(x=>/average/i.test(x)),false,
    'The average is not displayed in the budget overview');
   assert.equal(await page.locator('.history-category-layout').count(),0,
    'Budget category columns are no longer constrained by a chart layout');
   assert.equal(await page.locator('.history-view-toolbar [data-history-month-toggle]').count(),0,
    'Budget month picker no longer occupies the navigation row');
   assert.equal(await page.locator('.history-budget-month-field [data-history-month-toggle]').count(),1,
    'Budget month picker shares the account filter row');
   const budgetFilterOrder=await page.locator('.history-budget-filters').evaluate(form=>
    [...form.children].filter(el=>el.matches('.history-budget-month-field')||
     el.querySelector('[name="historyAccount"]'))
     .map(el=>el.matches('.history-budget-month-field')?'Months':'Account'));
   assert.deepEqual(budgetFilterOrder,['Months','Account'],
    'Budget month selection precedes Account in document and keyboard order');
   const accountAndMonths=await page.evaluate(()=>{
    const account=document.querySelector('.history-budget-filters [name="historyAccount"]').getBoundingClientRect(),
     month=document.querySelector('.history-budget-filters .history-month-trigger').getBoundingClientRect(),
     form=document.querySelector('.history-budget-filters').getBoundingClientRect();
    const accountLabel=document.querySelector('.history-budget-filters>label:has([name="historyAccount"])').getBoundingClientRect(),
     monthLabel=document.querySelector('.history-budget-month-field>span').getBoundingClientRect();
    return {accountTop:account.top,monthTop:month.top,accountBottom:account.bottom,
     monthBottom:month.bottom,accountHeight:account.height,monthHeight:month.height,
     accountLabelTop:accountLabel.top,monthLabelTop:monthLabel.top,
     accountLeft:account.left,accountRight:account.right,monthLeft:month.left,monthRight:month.right,formRight:form.right};
   });
   assert.ok(Math.abs(accountAndMonths.accountTop-accountAndMonths.monthTop)<=2&&
    Math.abs(accountAndMonths.accountBottom-accountAndMonths.monthBottom)<=2&&
    Math.abs(accountAndMonths.accountLabelTop-accountAndMonths.monthLabelTop)<=2&&
    Math.abs(accountAndMonths.accountHeight-accountAndMonths.monthHeight)<=1&&
    accountAndMonths.monthRight<=accountAndMonths.accountLeft+1&&
    accountAndMonths.accountRight<=accountAndMonths.formRight,
    'Account and Months labels/dropdowns must align precisely in one row: '+JSON.stringify(accountAndMonths));
   await page.locator('.history-budget-month-field [data-history-month-toggle]').click();
   assert.ok(await page.locator('[data-history-month-option][value="2026-09"]').count()>0,
    'Earlier complete calendar months are available for historical Budget review');
   await page.locator('.history-budget-month-field [data-history-month-toggle]').click();
   await verifyMonthOptionsDoNotOverlap(page,mobile?'390px iPhone WebKit':'1280px desktop Chromium');
   let expectedBudgetOrder=await page.locator('.history-category-item')
    .evaluateAll(items=>items.map(item=>item.dataset.historyCategoryRow));
   assert.deepEqual(expectedBudgetOrder,[...expectedBudgetOrder].sort((a,b)=>a.localeCompare(b)),
    'Before manual placement, Budget categories use stable alphabetical order, not target amounts');
   const assertBudgetSorted=async()=>{
    const actual=await page.locator('.history-category-item').evaluateAll(items=>items.map(item=>({
     name:item.dataset.historyCategoryRow,budget:item.querySelector('[data-history-budget-display]').dataset.budgetMonthly
    })));
    assert.deepEqual(actual.map(row=>row.name),expectedBudgetOrder,
     'Changing monthly targets or months does not reorder Budget categories');
    assert.ok(actual.some(row=>row.budget===''),'Unbudgeted categories stay visible');
   };
   await assertBudgetSorted();
   const budgetGrid=await page.locator('.history-category-item').first().evaluate(row=>{
    const bounds=el=>el.getBoundingClientRect(),
     track=bounds(row.querySelector('.history-budget-track')),
     amount=bounds(row.querySelector('.history-category-actual')),
     label=bounds(row.querySelector('.history-category-label-cell'));
    return {trackWidth:track.width,trackLeft:track.left,trackRight:track.right,
     amountLeft:amount.left,amountRight:amount.right,labelRight:label.right,
     trackTop:track.top,labelBottom:label.bottom};
   });
   assert.ok(budgetGrid.trackWidth>(mobile?100:200),
    'The combined progress-and-actual column leaves room for a wide bar');
   assert.ok(budgetGrid.amountLeft>=budgetGrid.trackLeft-1&&
    budgetGrid.amountRight<=budgetGrid.trackRight+1,
    'Actual dollars sit inside the progress-track bounds instead of crowding the target');
   assert.ok(mobile?budgetGrid.trackTop>=budgetGrid.labelBottom:
    budgetGrid.labelRight<=budgetGrid.trackLeft+2,
    'The phone layout places the bar below the category; desktop keeps it beside it');
   const checkOverall=async months=>{
    const rows=await page.locator('.history-category-item').evaluateAll(items=>
     items.map(item=>({
      spent:Number(item.querySelector('.history-category-actual').textContent.replace(/[^0-9.-]/g,'')),
      budget:item.querySelector('[data-history-budget-display]').dataset.budgetMonthly
     })));
    const totals=rows.reduce((sum,row)=>{
     sum.spentCents+=Math.round(row.spent*100);
     if(row.budget!=='')sum.limitCents+=Math.round(Number(row.budget)*100)*months;
     return sum;
    },{spentCents:0,limitCents:0});
    const summary=page.locator('[data-history-total-budget]');
    assert.equal(await summary.locator('p,small').count(),1,
     'Budget summary contains just one short budget amount label');
    if(totals.limitCents<=0){
     assert.equal(await summary.locator('[data-history-total-budget-percent]').count(),0,
      'No misleading percentage is shown without a positive overall budget');
    }else{
     const percent=Number((await summary.locator('[data-history-total-budget-percent]').innerText()).replace('%',''));
     assert.equal(percent,Math.round(totals.spentCents/totals.limitCents*100),
      'Overall percentage includes unbudgeted category spending in its numerator');
     const bar=await summary.locator('.history-budget-summary-track>span').evaluate(el=>parseFloat(el.style.width));
     assert.ok(Math.abs(bar-Math.max(0,Math.min(100,totals.spentCents/totals.limitCents*100)))<.02,
      'Summary bar caps at 100% without capping the stated percentage');
     assert.match(await summary.locator('.history-budget-summary-track').getAttribute('aria-label'),
      /including unbudgeted category spending/,
      'Inclusive spending is conveyed without another visible explanatory paragraph');
    }
   };
   const categoryName=await page.locator('.history-category-item').filter({hasText:/[1-9][0-9]* transactions/}).first().getAttribute('data-history-category-row'),
    budgetCategory=page.locator('.history-category-item[data-history-category-row="'+categoryName+'"]');
   assert.equal(await budgetCategory.locator('[data-history-budget]').count(),0,
    'Budget report rows are read-only; amount editing belongs exclusively in Manage');
   assert.equal(await budgetCategory.locator('[data-history-budget-display]').count(),1,
    'Saved monthly target stays visible beside the progress bar');
   const editBudget=async(category,value)=>{
    const manager=page.locator('.history-category-manager');
    if(!await manager.evaluate(el=>el.open))await manager.locator('summary').click();
    const input=manager.locator('[data-history-budget="'+category+'"]');
    assert.equal(await input.count(),1,'Category amount can be edited in Manage');
    await input.fill(value);
    await input.press('Tab');
    await page.waitForFunction(({category,value})=>{
     const saved=JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}');
     return saved.categoryMonthlyBudgets?.[category]===(value===''?undefined:Number(value));
    },{category,value});
    assert.equal(await page.locator('[data-history-budget-display="'+category+'"]')
     .getAttribute('data-budget-monthly'),value===''?'':Number(value).toFixed(2));
   };
   assert.equal(await page.locator('.history-category-columns').innerText().then(x=>x.includes('Budget / month')),true);
   assert.equal(await page.locator('.history-category-columns span').count(),3,
    'Budget has three column headings, not separate spent and bar columns');
   assert.equal(await budgetCategory.locator('[data-budget-marker]').count(),1,
    'Actual spending is represented once, attached to the bar endpoint');
   assert.equal(await budgetCategory.locator('.history-budget-difference.over').count(),0,
    'Within-budget rows do not add an overage caption');
   await editBudget(categoryName,'275.50');
   await editBudget(categoryName,'');
   assert.equal(await budgetCategory.locator('[data-history-budget-bar]').getAttribute('data-budget-status'),'unset',
    'Clearing a manager target unsets its budget without changing spending');
   await editBudget(categoryName,'275.50');
   await assertBudgetSorted();
   await checkOverall(1);
   // Reorder by pointer on desktop and keyboard on WebKit (also works on touch).
   // The saved custom order must survive a reload and later target changes.
   assert.ok(expectedBudgetOrder.length>2,'Fixture has enough categories for manual ordering');
   const movingName=expectedBudgetOrder[0],secondName=expectedBudgetOrder[1],
    movingHandle=page.locator('.history-category-item').first()
     .locator('[data-history-category-handle]');
   if(mobile){
    await movingHandle.focus();
    await movingHandle.press('ArrowDown');
   }else{
    await movingHandle.scrollIntoViewIfNeeded();
    const from=await movingHandle.boundingBox(),
     to=await page.locator('.history-category-item').nth(1).boundingBox();
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2);
    await page.mouse.down();
    await page.mouse.move(to.x+to.width/2,to.y+to.height*.8,{steps:8});
    await page.mouse.up();
   }
   expectedBudgetOrder=[secondName,movingName,...expectedBudgetOrder.slice(2)];
   await page.waitForFunction(order=>{
    const saved=JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}');
    return JSON.stringify(saved.categoryDisplayOrder)===JSON.stringify(order);
   },expectedBudgetOrder);
   await assertBudgetSorted();
   await page.reload();
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await assertBudgetSorted();
   assert.match(await page.locator('[data-history-category-row="'+categoryName+'"] [data-history-budget-bar]')
    .getAttribute('aria-label'),/spent of .* budget/,
    'The saved budget appears in the accessible progress description');
   assert.equal(await page.locator('.history-list-surface').count(),0,
    'Category view shows its tailored chart rather than duplicating line-item history');
   await chooseMonths(page,['2026-10','2026-09','2026-08']);
   assert.match(await page.locator('.history-budget-summary-track').getAttribute('aria-label'),/including unbudgeted category spending/,
    'Multi-month budget comparison retains all purchase spending');
   assert.equal(await page.locator('[data-history-budget-display="'+categoryName+'"]')
    .getAttribute('data-budget-monthly'),'275.50',
    'Read-only target carries across report periods');
   await checkOverall(3);
   const budgetRow=page.locator('[data-history-category-row="'+categoryName+'"]');
   const threeActual=Number((await budgetRow.locator('.history-category-actual').innerText()).replace(/[^0-9.]/g,''));
   const threeBar=Number.parseFloat(await budgetRow.locator('.history-budget-fill').evaluate(el=>el.style.width));
   assert.ok(Math.abs(threeBar-Math.min(100,threeActual/(275.5*3)*100))<.02,
    'Three months of purchases use three times the monthly budget');
   if(threeActual>.01){
    await editBudget(categoryName,'0.01');
    await assertBudgetSorted();
    assert.equal(await budgetRow.locator('[data-history-budget-bar]').getAttribute('data-budget-status'),'over');
    const overage=budgetRow.locator('.history-budget-difference.over');
    assert.equal(await overage.count(),1,'Over-budget rows show an explicit dollar overage beside the cap');
    assert.equal(Number(await overage.getAttribute('data-budget-overage-cents')),
     Math.round(threeActual*100)-3,'Overage compares spent + expected against three monthly targets');
    assert.match(await overage.innerText(),/Over \$.*3 mo/,
     'Multi-month overspending is labeled as an overage for the selected period');
    const overageBounds=await overage.evaluate(el=>{
     const r=el.getBoundingClientRect(),budget=el.closest('.history-category-budget').getBoundingClientRect();
     return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,
      budgetRight:budget.right,screen:document.documentElement.scrollWidth,viewport:innerWidth,
      color:getComputedStyle(el).color};
    });
    assert.ok(overageBounds.left>=-1&&overageBounds.right<=overageBounds.budgetRight+1&&
     overageBounds.screen<=overageBounds.viewport+3,
     'The overage fits under the target with no horizontal spill: '+JSON.stringify(overageBounds));
    assert.equal(overageBounds.color,'rgb(196, 123, 49)',
     'The overage dollar figure uses the same orange emphasis as overspending');
    const overageColor=await budgetRow.locator('.history-category-actual').evaluate(el=>({
     over:el.classList.contains('over'),color:getComputedStyle(el).color
    }));
    assert.equal(overageColor.over,true,'Over-budget spent amount receives its own overage state');
    assert.equal(overageColor.color,'rgb(196, 123, 49)',
     'The over-budget dollar amount itself turns orange');
    assert.equal(Number.parseFloat(await budgetRow.locator('.history-budget-fill').evaluate(el=>el.style.width)),100,
     'The over-budget fill caps at its full track width');
    await checkOverall(3);
    await editBudget(categoryName,'275.50');
    await assertBudgetSorted();
    await checkOverall(3);
   }
   // Budget: future months must use the same dated expense predictions as
   // current months, across checking and credit, without counting transfers.
   await chooseMonths(page,['2026-10']);
   const budgetCategoryCents=async name=>Math.round(Number((await page.locator(
    '[data-history-category-row="'+name+'"] .history-category-actual').innerText())
    .replace(/[^0-9.-]/g,''))*100);
   const beforeOctober=await budgetCategoryCents(categoryName);
   await chooseMonths(page,['2026-11']);
   const beforeNovember=await budgetCategoryCents(categoryName);
   await page.evaluate(category=>{
    const key='household-planner-sample-settings-v1',
     raw=JSON.parse(localStorage.getItem(key)||'{}');
    raw.futureTransactionAdds=[...(raw.futureTransactionAdds||[]),
     {id:'future-add|budget-fixture-checking',date:'2026-10-28',accountId:'demo-checking',
      merchant:'Fictional Utility Charge',amount:91.25,type:'expense',category},
     {id:'future-add|budget-fixture-card',date:'2026-11-12',accountId:'demo-visa',
      merchant:'Fictional Card Utility',amount:123.45,type:'expense',category},
     {id:'future-add|budget-fixture-transfer',date:'2026-11-13',
      fromAccountId:'demo-checking',toAccountId:'demo-visa',
      merchant:'Fictional Card Settlement',amount:123.45,type:'transfer'}];
    localStorage.setItem(key,JSON.stringify(raw));
   },categoryName);
   await page.reload();
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await chooseMonths(page,['2026-10']);
   assert.equal(await budgetCategoryCents(categoryName)-beforeOctober,9125,
    'Current-month Budget combines existing posted spending with future bill estimates');
   assert.match(await page.locator('[data-history-category-row="'+categoryName+'"] .history-category-name').innerText(),
    /expected/, 'Budget identifies predicted purchases on their category rows');
   await chooseMonths(page,['2026-11']);
   assert.equal(await budgetCategoryCents(categoryName)-beforeNovember,12345,
    'Future Budget counts credit card expected charges, not the settlement');
   await chooseMonths(page,['2026-10','2026-11']);
   assert.equal(await budgetCategoryCents(categoryName),beforeOctober+beforeNovember+9125+12345,
    'Multi-month Budget adds posted and projected expenses from every selected month');
   await page.locator('[data-history-view="summary"]').click();
   assert.match(await page.locator('[data-recap-budget] small').innerText(),
    /including expected/, 'Summary Budget percentage includes expected charges');
   await page.evaluate(()=>{
    const key='household-planner-sample-settings-v1',
     raw=JSON.parse(localStorage.getItem(key)||'{}');
    raw.futureTransactionAdds=(raw.futureTransactionAdds||[]).filter(row=>
     !String(row.id).startsWith('future-add|budget-fixture-'));
    localStorage.setItem(key,JSON.stringify(raw));
   });
   await page.reload();
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await chooseMonths(page,['2026-10','2026-09','2026-08']);
   for(const width of (mobile?[320,390]:[768,1280])){
    await page.setViewportSize({width,height:mobile?844:900});
    await verifyMonthOptionsDoNotOverlap(page,width+'px '+(mobile?'iPhone WebKit':'desktop Chromium'));
    const selectorAlignment=await page.evaluate(()=>{
     const account=document.querySelector('.history-budget-filters [name="historyAccount"]')?.getBoundingClientRect(),
      month=document.querySelector('.history-budget-filters .history-month-trigger')?.getBoundingClientRect(),
      scrollWidth=document.documentElement.scrollWidth;
     return {accountTop:account.top,monthTop:month.top,accountLeft:account.left,
      monthRight:month.right,accountHeight:account.height,monthHeight:month.height,scrollWidth};
    });
    assert.ok(Math.abs(selectorAlignment.accountTop-selectorAlignment.monthTop)<=2&&
     Math.abs(selectorAlignment.accountHeight-selectorAlignment.monthHeight)<=1&&
     selectorAlignment.monthRight<=selectorAlignment.accountLeft+1&&
     selectorAlignment.scrollWidth<=width+3,
     'Account and Months dropdowns stay precisely aligned at '+width+': '+JSON.stringify(selectorAlignment));
    const compact=await page.evaluate(()=>{
     const manage=document.querySelector('.history-category-manager>summary').getBoundingClientRect(),
      table=document.querySelector('.history-category-table').getBoundingClientRect(),
      panel=document.querySelector('[data-history-category-insights]').getBoundingClientRect();
     return {manageRight:manage.right,panelRight:panel.right,tableWidth:table.width,
      panelWidth:panel.width,manageWidth:manage.width};
    });
    assert.ok(compact.manageWidth>=40&&compact.panelRight-compact.manageRight<52,
     'Category management stays visible and right aligned at '+width+': '+JSON.stringify(compact));
    assert.ok(compact.tableWidth>compact.panelWidth*.8,
     'Budget categories use the panel width rather than a half-width chart legend at '+width);
    const dimensions=await budgetRow.evaluate(row=>{
     const rect=sel=>row.querySelector(sel).getBoundingClientRect(),
      name=rect('.history-category-drill'),bar=rect('[data-history-budget-bar]'),
      actual=rect('.history-category-actual'),budget=rect('.history-category-budget'),
      input=rect('.history-budget-target'),
      headings=[...document.querySelectorAll('.history-category-columns span')]
       .map(x=>x.getBoundingClientRect()),
      percent=Number.parseFloat(getComputedStyle(row.querySelector('[data-history-budget-bar]'))
       .getPropertyValue('--budget-used'))/100,
      markerCenter=(actual.left+actual.right)/2,
      expectedCenter=bar.left+Math.min(Math.max(percent*bar.width,
       innerWidth<=650?41:43),bar.width-(innerWidth<=650?41:43));
     return {nameRight:name.right,nameBottom:name.bottom,
      barLeft:bar.left,barTop:bar.top,barRight:bar.right,barWidth:bar.width,
      actualLeft:actual.left,actualRight:actual.right,
      actualTop:actual.top,barBottom:bar.bottom,
      budgetLeft:budget.left,budgetRight:budget.right,
      inputRight:input.right,inputCenterY:(input.top+input.bottom)/2,
      barCenterY:(bar.top+bar.bottom)/2,targetHeaderRight:headings[2].right,
      inputTextAlign:getComputedStyle(row.querySelector('.history-budget-target')).textAlign,
      barHeight:bar.height,markerCenter,expectedCenter,
      viewport:document.documentElement.scrollWidth};
    });
    assert.ok(dimensions.barWidth>=(width<=650?100:200)&&dimensions.viewport<=width+3,
     'Responsive Budget progress bar remains wide and does not overflow at '+
      width+'px: '+JSON.stringify(dimensions));
    assert.ok(dimensions.barHeight>=(width<=650?15:18)&&
     dimensions.actualTop>=dimensions.barBottom&&
     Math.abs(dimensions.markerCenter-dimensions.expectedCenter)<=2,
     'Spent dollars follow the actual fill endpoint at '+width+': '+JSON.stringify(dimensions));
    assert.ok(dimensions.actualLeft>=dimensions.barLeft-1&&
     dimensions.actualRight<=dimensions.barRight+1,
     'Endpoint dollars do not overflow the bar column at '+width+': '+JSON.stringify(dimensions));
    assert.ok(width<=650?dimensions.barTop>=dimensions.nameBottom:
     dimensions.nameRight<=dimensions.barLeft+2,
     'Responsive Budget structure has uncluttered rows at '+width+': '+JSON.stringify(dimensions));
    assert.ok(Math.abs(dimensions.budgetRight-dimensions.inputRight)<=2&&
     Math.abs(dimensions.budgetRight-dimensions.targetHeaderRight)<=2,
     'Read-only target and heading align at '+width+': '+JSON.stringify(dimensions));
    assert.ok(Math.abs(dimensions.inputCenterY-dimensions.barCenterY)<=3,
     'Read-only target stays vertically centered on the progress bar at '+width+': '+
      JSON.stringify(dimensions));
    assert.equal(dimensions.inputTextAlign,'right',
     'Budget targets remain right-aligned and easy to scan');

   }
   await page.setViewportSize({width:mobile?390:1280,height:mobile?844:900});
   await chooseAllMonths(page);
   const firstCategory=page.locator('.history-category-item').filter({hasText:/[1-9][0-9]* transactions/}).first();
   await firstCategory.locator('[data-history-drill-category]').click();
   assert.equal(await page.locator('.planner-nav-primary [data-view="activity"][aria-current="page"]').count(),1,
    'Category drill-down opens the detailed transaction list');
   assert.ok(await page.locator('.history-actual-row').count()>0);

   await page.locator('.planner-nav-primary [data-view="history"]').click();
    await page.locator('[data-history-view="sizes"]').click();
   await verifyReportFilters(page,'Purchase sizes',mobile);
   assert.equal(await page.locator('[data-history-size-insights]').count(),1);
   assert.equal(await page.locator('[data-history-size-insights] > h2,[data-history-size-insights] > p').count(),0,
    'Purchase size report has visual bands and totals without a duplicate title or explanatory paragraph');
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

   // Merchant view: one intuitive calendar-month spend total per merchant,
   // independent of the existing Category and Purchase Sizes analysis.
   await page.locator('.planner-nav-primary [data-view="history"]').click();
    await page.locator('[data-history-view="merchants"]').click();
   await verifyReportFilters(page,'Merchants',mobile);
   assert.equal(await page.locator('[data-history-merchant-insights]').count(),1);
   assert.equal(await page.locator('[data-history-merchant-insights] > h2,'+
    '[data-history-merchant-insights] > .history-insight-note').count(),0,
    'Merchant report is readable from amounts, names and bars without instructional copy');
   assert.equal(await page.locator('.history-list-surface').count(),0,
    'Merchant analysis does not duplicate individual bank rows');
   await chooseMonths(page,['2026-10']);
   assert.deepEqual(await selectedMonths(page),['2026-10']);
   const amazon=page.locator('[data-history-drill-merchant="amazon"]'),
    costcoWarehouse=page.locator('[data-history-drill-merchant="costco warehouse"]'),
    costcoGas=page.locator('[data-history-drill-merchant="costco gas"]');
   assert.equal(await amazon.count(),1,'Amazon purchases are grouped into one merchant');
   assert.equal(await amazon.locator('.history-merchant-amount').innerText(),'$77.91',
    'Amazon is summed only for the current calendar month');
   assert.match(await amazon.innerText(),/1 purchase/);
   assert.equal(await costcoWarehouse.count(),1);
   assert.equal(await costcoGas.count(),1,
    'Costco warehouse and gas are distinct merchants');
   const allCents=await page.locator('[data-history-drill-merchant]').evaluateAll(rows=>
    rows.reduce((sum,row)=>sum+Number(row.dataset.historyMerchantCents||0),0));
   const currency=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'})
    .format(Math.abs(n)/100);
   assert.equal(await page.locator('[data-history-merchant-total]').innerText(),
    (allCents<0?'−':'')+currency(allCents),
    'Period total equals sum of the individually grouped merchant net spends');

   assert.equal(await page.locator('.history-merchant-search-label .visually-hidden').count(),1);
   assert.equal(await page.locator('[data-history-merchant-search]').getAttribute('placeholder'),'Search merchants');
   await page.locator('[data-history-merchant-search]').fill('Ama');
   assert.equal(await page.locator('[data-history-drill-merchant]:visible').count(),1,
    'Merchant search narrows visible rows');
   assert.equal(await page.locator('[data-history-merchant-count]').innerText(),'1');
   assert.equal(await page.locator('[data-history-merchant-total]').innerText(),'$77.91');
   await page.locator('[data-history-merchant-search]').fill('nonesuchfictional');
   assert.equal(await page.locator('[data-history-drill-merchant]:visible').count(),0);
   assert.equal(await page.locator('[data-history-merchant-total]').innerText(),'$0.00');
   await page.locator('[data-history-merchant-search]').fill('');
   await chooseMonths(page,['2026-10','2026-09','2026-08']);
   assert.ok((await amazon.innerText()).includes('purchases'),
    'Expanding the calendar-month period aggregates more Amazon purchases');
   await amazon.click();
   assert.equal(await page.locator('.planner-nav-primary [data-view="activity"][aria-current="page"]').count(),1,
    'Choosing a merchant drills into the existing Transactions page');
   assert.ok(await page.locator('.history-actual-row').count()>1);
   assert.ok(await page.locator('.history-actual-row').evaluateAll(rows=>rows.every(row=>
    /Amazon/i.test(row.querySelector('.history-actual-description strong')?.textContent||''))),
    'Merchant drilldown contains no unrelated transactions');
   assert.deepEqual(await selectedMonths(page),['2026-08','2026-09','2026-10'],
    'Merchant drilldown preserves the month selection');
   assert.match(await page.locator('.history-active-filter').innerText(),/Merchant: Amazon/);
   await page.locator('[data-history-clear-merchant]').click();
   assert.equal(await page.locator('[data-history-view="merchants"][aria-pressed="true"]').count(),1,
    'Back to Merchants returns to its grouped spend view');
   for(const width of (mobile?[320,390]:[768,1280])){
    await page.setViewportSize({width,height:mobile?844:900});
    const size=await page.evaluate(()=>document.documentElement.scrollWidth);
    assert.ok(size<=width+3,'Merchants layout fits '+width+'px viewport: '+size);
    assert.equal(await page.locator('[data-history-view="merchants"]').isVisible(),true);
   }
   await page.setViewportSize({width:mobile?390:1280,height:mobile?844:900});
   await page.locator('.planner-nav-primary [data-view="activity"]').click();

   await chooseMonths(page,['2026-09']);
   assert.deepEqual(await selectedMonths(page),['2026-09']);
   const recordDates=await page.locator('.history-actual-row').evaluateAll(rows=>
    rows.map(row=>row.dataset.historySortDate));
   assert.ok(recordDates.every(date=>date.startsWith('2026-09')),
    'A selected month restricts every line-item bank record');
   await chooseAllMonths(page);
   // Nonadjacent months must omit September instead of taking a continuous range.
   await chooseMonths(page,['2026-10','2026-08']);
   assert.deepEqual(await selectedMonths(page),['2026-08','2026-10']);
   const nonadjacent=await page.locator('.history-actual-row').evaluateAll(rows=>
    rows.map(row=>row.dataset.historySortDate.slice(0,7)));
   assert.ok(nonadjacent.includes('2026-08')&&nonadjacent.includes('2026-10')&&
    nonadjacent.every(month=>month==='2026-08'||month==='2026-10'),
    'August and October selected, but September excluded');
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.deepEqual(await selectedMonths(page),['2026-08','2026-10'],
    'Checked months remain selected across all four reports');
   await checkOverall(2);
   const twoMonthRow=page.locator('[data-history-category-row="'+categoryName+'"]');
   const twoMonthSpent=Number((await twoMonthRow.locator('.history-category-actual').innerText()).replace(/[^0-9.]/g,''));
   const twoMonthWidth=Number.parseFloat(await twoMonthRow.locator('.history-budget-fill').evaluate(el=>el.style.width));
   assert.ok(Math.abs(twoMonthWidth-Math.min(100,twoMonthSpent/(275.5*2)*100))<.02,
    'Nonadjacent calendar months compare against exactly two monthly budgets');
   await page.locator('.planner-nav-primary [data-view="activity"]').click();
   await chooseAllMonths(page);
   await page.reload({waitUntil:'load'});
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('[data-history-budget-display="'+categoryName+'"]')
    .getAttribute('data-budget-monthly'),'275.50',
    'A monthly target remains visible after reload');
   assert.deepEqual(await selectedMonths(page),['2026-10'],
    'Reload resets the view to the current calendar month');
   const categoryAmount=async name=>Number((await page.locator(
    '[data-history-category-row="'+name+'"] .history-category-actual').innerText())
    .replace(/[^0-9.-]/g,''));
   const utilitiesBefore=await categoryAmount('Utility'),
    subscriptionsBefore=await categoryAmount('Subscriptions');

   // A category edit teaches a merchant lesson, which Settings can forget
    // without reverting the transaction's individual saved correction.
    await page.locator('.planner-nav-primary [data-view="activity"]').click();
    const lessonRow=page.locator('.history-entry').filter({hasText:'Xfinity Internet'}).first();
    assert.equal(await lessonRow.count(),1,'Fictional merchant exists for category learning');
    await lessonRow.locator('[data-history-category]').selectOption('Subscriptions');
    await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem(
     'household-planner-sample-settings-v1')||'{}').learning?.categoryRules||{}).length>0);
    const categoryLesson=await page.evaluate(()=>JSON.parse(localStorage.getItem(
     'household-planner-sample-settings-v1')||'{}'));
    assert.ok(Object.values(categoryLesson.learning.categoryRules).some(rule=>
     rule.merchant==='Xfinity Internet'&&rule.category==='Subscriptions'),
     'A category correction stores its merchant lesson');
    await page.locator('.planner-nav-primary [data-view="history"]').click();
    assert.equal(Math.round(await categoryAmount('Subscriptions')*100),
     Math.round(subscriptionsBefore*100)+7999,
     'A saved posted purchase immediately moves into the selected budget category');
    assert.equal(Math.round(await categoryAmount('Utility')*100),
     Math.round(utilitiesBefore*100)-7999,
     'The old budget category no longer counts that same purchase');
    await page.locator('.planner-nav-primary [data-view="activity"]').click();
    await page.locator('#planner-menu summary').click();
    await page.locator('#planner-menu [data-view="settings"]').click();
    assert.equal(await page.locator('[data-forget-category-rule]').count(),1,
     'Learned merchant rules are reviewable in Settings');
    await page.locator('[data-forget-category-rule]').click();
    await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem(
     'household-planner-sample-settings-v1')||'{}').learning?.categoryRules||{}).length===0);
    const afterForget=await page.evaluate(()=>JSON.parse(localStorage.getItem(
     'household-planner-sample-settings-v1')||'{}'));
    assert.ok(Object.values(afterForget.categoryOverrides||{}).includes('Subscriptions'),
     'Forgetting a merchant rule leaves the individual correction intact');
    await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('[data-history-view="categories"][aria-pressed="true"]').count(),1,
    'Reopening Bank History from Settings also defaults to Budget');
   await page.locator('.planner-nav-primary [data-view="activity"]').click();

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
   if(await page.locator('.schedule-row-main.ledger-transaction-row').count())
    await verifyTransactionAnatomy(page,'.schedule-row-main.ledger-transaction-row','Upcoming Bills');
   else assert.equal(await page.locator('.schedule-row-main').count(),0,
    'Empty Bills test fixtures have no saved schedule rows to compare');
   assert.equal(await page.locator('.bills-heading p,.bills-manage-heading p').count(),0,
    'Bills presents dated predicted withdrawals and schedule controls without instructional paragraphs');
   assert.equal(await page.locator('.bills-manage-heading h2').innerText(),'Repeating payments',
    'Bills names the recurring section without repeating an action');
   const billHeader=await page.locator('.bills-heading').evaluate(el=>{
    const heading=el.querySelector('h2').getBoundingClientRect(),
     count=el.querySelector('.bills-upcoming-total').getBoundingClientRect();
    return {headingRight:heading.right,countLeft:count.left,
     value:el.querySelector('.bills-upcoming-total').textContent.trim()};
   });
   assert.ok(billHeader.headingRight<=billHeader.countLeft+2&&/^\d+$/.test(billHeader.value),
    'Upcoming Bills count is small, numeric and aligned with the header');
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

   await page.locator('#planner-menu>summary').click();
   await page.locator('#planner-menu [data-view="transactions"]').click();
   if(await page.locator('.unified-payment-trigger.ledger-transaction-row').count())
    await verifyTransactionAnatomy(page,'.unified-payment-trigger.ledger-transaction-row','Predictions');
   else assert.equal(await page.locator('.unified-payment-trigger').count(),0,
    'No dated predictions are available in this fictional fixture');
   await page.locator('.planner-nav-primary [data-view="summary"]').click();
   const next=page.locator('[data-calendar-day="2026-10-20"]');
   if(await next.count()){
    await next.click();
    if(await page.locator('.calendar-day-detail .ledger-transaction-row').count())
     await verifyTransactionAnatomy(page,'.calendar-day-detail .ledger-transaction-row','Calendar');
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
   assert.equal(await page.locator('.reviews-page .review-priority,.review-intro p,'+
    '.category-review-panel > .lead').count(),0,
    'Review relies on section labels and actionable status rather than repeated instructional prose');
   assert.equal(await page.locator('[data-category-review]').count(),1,
    'Missing or uncertain transaction and bill categories have a persistent review section');
   assert.equal(await page.locator('.review-intro-icon').count(),0,
    'Review has one clear heading without a second alert symbol');
   const reviewBadges=await page.locator('.reviews-page .section-title .status-tag').allTextContents();
   assert.ok(reviewBadges.every(text=>/^\d+$/.test(text.trim())),
    'Section labels and counts replace repeated TO REVIEW words');
   const reviewTitleLayout=await page.evaluate(()=>{
    const title=document.querySelector('.review-intro h2').getBoundingClientRect(),
     sort=document.querySelector('.review-intro [data-review-sort]').getBoundingClientRect();
    return {titleRight:title.right,sortLeft:sort.left,
     titleTop:title.top,sortTop:sort.top,scroll:document.documentElement.scrollWidth,viewport:innerWidth};
   });
   assert.ok(reviewTitleLayout.scroll<=reviewTitleLayout.viewport+3&&
    (reviewTitleLayout.titleRight<=reviewTitleLayout.sortLeft+2||
     reviewTitleLayout.sortTop>reviewTitleLayout.titleTop),
    'Review header keeps its title and sort from overlapping: '+JSON.stringify(reviewTitleLayout));
   assert.equal(await page.locator('.reviews-page .review-sort-label .visually-hidden').count(),1,
    'Review sorter selected value needs no second visible caption');
   const categoryPickers=page.locator('[data-category-review-form] > label');
   if(await categoryPickers.count()){
    assert.ok(await categoryPickers.evaluateAll(labels=>labels.every(label=>{
     const caption=label.querySelector('.visually-hidden'),
      picker=label.querySelector('select[name="category"]');
     return caption&&caption.getBoundingClientRect().width<=1&&
      picker?.getAttribute('aria-label')?.startsWith('Category for ')&&
      picker?.options[0]?.textContent==='Choose a category';
    })), 'Review rows display only the category choice but retain accessible names');
    assert.ok(await page.locator('[data-category-review-form] .ledger-transaction-identity small')
     .evaluateAll(notes=>notes.every(note=>!/Missing category|Unassigned category/i.test(note.textContent))),
     'Review category context must not repeat in every transaction subtitle');
   }
   // One selector sorts each review group without altering approvals, review
   // counts, bank records, or the three distinct review sections.
   const reviewSort=page.locator('.reviews-page [data-review-sort]');
   assert.equal(await reviewSort.count(),1,'Things to check has one Sort by control');
   assert.deepEqual(await reviewSort.locator('option').evaluateAll(options=>
    options.map(option=>option.value)),
    ['newest','oldest','amount-desc','amount-asc','merchant']);
   assert.equal(await reviewSort.inputValue(),'newest');
   const reviewGroupData=async selector=>page.locator(selector).evaluateAll(rows=>rows.map(row=>({
    id:row.getAttribute('data-category-id')||
     row.getAttribute('data-overdue-item')||row.getAttribute('data-recommended-repeat'),
    date:row.getAttribute('data-review-order-date')||'',
    amount:Math.abs(Number(row.getAttribute('data-review-order-amount'))||0),
    name:row.querySelector('.category-review-info strong,.review-candidate-main strong,.overdue-review-heading strong')?.textContent||''
   })));
   const visibleGroups=[
    '[data-category-review] [data-category-review-form]',
    '[data-overdue-review] [data-overdue-item]',
    '[data-recommended-repeating] [data-recommended-repeat]'
   ];
   const beforeSort=await Promise.all(visibleGroups.map(reviewGroupData));
   const rowIds=groups=>groups.map(rows=>rows.map(row=>row.id).sort());
   const assertDateOrder=(groups,ascending)=>{
    for(const rows of groups){
     const dates=rows.map(r=>r.date).filter(Boolean);
     assert.deepEqual(dates,[...dates].sort((a,b)=>
      ascending?a.localeCompare(b):b.localeCompare(a)),
      'Review dates must follow the selected direction');
    }
   };
   assertDateOrder(beforeSort,false);
   await reviewSort.selectOption('oldest');
   const oldestGroups=await Promise.all(visibleGroups.map(reviewGroupData));
   assertDateOrder(oldestGroups,true);
   assert.deepEqual(rowIds(oldestGroups),rowIds(beforeSort),
    'Sorting must not add, drop or alter review items');
   await page.locator('[data-review-sort]').selectOption('amount-desc');
   const amountGroups=await Promise.all(visibleGroups.map(reviewGroupData));
   for(const rows of amountGroups)assert.deepEqual(rows.map(r=>r.amount),
    [...rows.map(r=>r.amount)].sort((a,b)=>b-a),
    'Amount high-to-low sorts values within each review group');
   await page.locator('[data-review-sort]').selectOption('merchant');
   const alphabeticalGroups=await Promise.all(visibleGroups.map(reviewGroupData));
   for(const rows of alphabeticalGroups)assert.deepEqual(rows.map(r=>r.name.toLowerCase()),
    [...rows.map(r=>r.name.toLowerCase())].sort((a,b)=>a.localeCompare(b)),
    'Merchant name sorting works within each review group');
   await page.locator('[data-review-sort]').selectOption('newest');
   const restoredGroups=await Promise.all(visibleGroups.map(reviewGroupData));
   assert.deepEqual(rowIds(restoredGroups),rowIds(beforeSort),
    'Returning to newest retains the same review records');
   const countAfterSort=await page.locator('.topbar [data-review-tab-count]').innerText().catch(()=>null);
   assert.ok(countAfterSort===null||Number(countAfterSort)>=0,
    'Sort changes do not break the review count action');

   // Clicking a category review transaction opens the exact bank transaction
   // editor used by Transactions; selecting its Category remains independent.
   const bankReviewRows=page.locator('[data-category-review-form] [data-review-bank-id]');
   if(await bankReviewRows.count()){
    const open=bankReviewRows.first(),owner=open.locator('xpath=..'),
     reviewId=await owner.getAttribute('data-category-id'),
     reviewAccount=await open.getAttribute('data-review-bank-account'),
     beforeReviewCount=await page.locator('[data-category-review-form]').count();
    const bankName=await open.locator('strong').innerText(),
     categoryPicker=owner.locator('[name=category]');
    await open.click();
    assert.equal(await page.locator('[data-transaction-overlay]').count(),1,
     'Review opens the same shared transaction detail surface');
    assert.equal(await page.locator('.transaction-detail h2').innerText(),bankName);
    assert.equal(await page.locator('.transaction-detail [data-actual-transaction-category]').count(),1,
     'Shared bank editor exposes the editable transaction category');
    assert.equal(await page.locator('.transaction-detail [data-transaction-note-form]').count(),1,
     'The personal note editor is available when opened from Things to check');
    const noteKey=await page.locator('.transaction-detail [data-transaction-note-form]')
     .getAttribute('data-transaction-note-form');
    assert.equal(noteKey,'bank:'+JSON.stringify([reviewAccount,reviewId]),
     'Review opens the same account-specific bank record, not another account or a prediction');
    await page.locator('.transaction-detail-close').click();
    assert.equal(await page.locator('[data-transaction-overlay]').count(),0);
    assert.equal(await page.locator('[data-category-review-form]').count(),beforeReviewCount,
     'Opening and closing a review item must not silently resolve it');
    assert.equal(await categoryPicker.inputValue(),'',
     'The one-click Category control still works independently of opening details');
   }
   const planReviewRows=page.locator('[data-category-review-form] [data-review-plan-kind]');
   if(await planReviewRows.count()){
    const plan=planReviewRows.first(),kind=await plan.getAttribute('data-review-plan-kind');
    if(kind==='schedule'){
     await plan.click();
     assert.equal(await page.locator('.transaction-detail [data-schedule-edit-form]').count(),1,
      'A recurring bill category review opens the canonical schedule editor');
     await page.locator('.transaction-detail-close').click();
    }
   }

   const categoryForms=page.locator('[data-category-review-form]');
   const categoryFormsBefore=await categoryForms.count();
   if(categoryFormsBefore)
    await verifyTransactionAnatomy(page,'.category-review-open.ledger-transaction-row','Category Review');
   if(categoryFormsBefore){
    const first=categoryForms.first(),categoryId=await first.getAttribute('data-category-id');
    const reviewPicker=first.locator('[name=category]');
    assert.equal(await first.locator('[type=submit]').count(),0,
     'Category Review no longer requires a separate Confirm button');
    assert.equal(await reviewPicker.inputValue(),'',
     'Every review dropdown starts with Choose a category, including low-confidence existing values');
    assert.ok((await reviewPicker.locator('option').allTextContents()).includes('Other'),
     'Other remains a deliberate catch-all option');
    // Simulate one failed private-preference save in fictional Demo mode.
    // Failure must not dismiss the item or prevent choosing the same value again.
    await page.evaluate(()=>{
     const original=Storage.prototype.setItem;
     window.__ledgerReviewOriginalSet=original;
     Storage.prototype.setItem=function(key,value){
      if(key==='household-planner-sample-settings-v1')
       throw new Error('Fictional save rejected');
      return original.call(this,key,value);
     };
    });
    await reviewPicker.selectOption('Other');
    const reviewError=first.locator('[data-category-review-error]');
    await reviewError.waitFor({state:'visible'});
    assert.match(await reviewError.innerText(),/Fictional save rejected/,
     'On a failed save the category review remains visible with an error');
    assert.equal(await reviewPicker.isEnabled(),true);
    assert.equal(await reviewPicker.inputValue(),'',
     'Failure resets the placeholder to allow retrying the same selection');
    await page.evaluate(()=>{
     Storage.prototype.setItem=window.__ledgerReviewOriginalSet;
     delete window.__ledgerReviewOriginalSet;
    });
    await reviewPicker.selectOption('Other');
    await page.locator('[data-category-review-form][data-category-id="'+categoryId+'"]').waitFor({state:'detached'});
    assert.equal(await page.locator('[data-category-review-form]').count(),categoryFormsBefore-1,
     'One category selection auto-saves and clears the corresponding review issue');
    const afterOther=page.locator('[data-category-review-form]');
    if(await afterOther.count()){
     const second=afterOther.first(),id=await second.getAttribute('data-category-id');
     assert.equal(await second.locator('[name=category]').inputValue(),'');
     await second.locator('[name=category]').selectOption('Shopping');
     await page.locator('[data-category-review-form][data-category-id="'+id+'"]').waitFor({state:'detached'});
     assert.equal(await page.locator('[data-category-review-form][data-category-id="'+id+'"]').count(),0,
      'A specific category also saves on selection with no extra tap');
    }
   }

   const suggestion=page.locator('[data-review-recommendation]').first();
   if(await suggestion.count()){
    await suggestion.click();
    assert.equal(await page.locator('.transaction-detail [data-history-recurring-form]').count(),1,
     'Review suggestions open the same shared editor');
    await page.locator('.transaction-detail-close').click();
   }
   // Deleting an assigned built-in category should not require reassignment.
   // An existing fictional merchant correction is already Subscriptions.
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.locator('.history-category-manager>summary').click();
   assert.equal(await page.locator('[data-history-category-delete="Subscriptions"]').count(),1);
   page.once('dialog',dialog=>dialog.accept());
   await page.locator('[data-history-category-delete="Subscriptions"]').click();
   assert.equal(await page.locator('.history-category-manage-status').innerText(),
    'Deleted Subscriptions. Affected items are Unassigned in Things to check.');
   const deletedPrefs=await page.evaluate(()=>JSON.parse(localStorage.getItem(
    'household-planner-sample-settings-v1')||'{}'));
   assert.ok((deletedPrefs.deletedCategories||[]).includes('Subscriptions'),
    'Built-in category deletion survives reload');
   assert.equal(deletedPrefs.categoryOverrides[
    Object.keys(deletedPrefs.categoryOverrides||{}).find(k=>
     deletedPrefs.categoryOverrides[k]==='Uncategorized')]||'','Uncategorized',
    'Historical corrections are reset to Unassigned without bank source edits');
   await page.locator('.attention-link[data-view="reviews"]').click();
   assert.ok(await page.locator('[data-category-review-form]').count()>0,
    'Deleted categories push affected transactions back into Things to check');
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.locator('.planner-nav-primary [data-view="activity"]').click();
   assert.equal(await page.locator('[data-history-category-filter] option[value="Subscriptions"]').count(),0,
    'Deleted categories must not reappear in History filters');

   // Recategorizing a posted purchase must immediately update Budget from the
   // saved overlay without a browser reload. Budget also explains when its
   // current month/account filter hides the changed historical transaction.
   await chooseMonths(page,['2026-09']);
   const spendRow=page.locator('.history-entry')
    .filter({has:page.locator('.history-actual-row[data-history-kind="expense"]')}).first();
   assert.equal(await spendRow.count(),1,'September contains a posted fictional expense');
   const oldCategory=await spendRow.locator('[data-history-category]').inputValue(),
    targetCategory=oldCategory==='Health'?'Dining':'Health',
    movedCents=Math.round(Number(await spendRow.locator('[data-history-sort-amount]')
     .getAttribute('data-history-sort-amount'))*100);
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   const oldTargetCents=Math.round(Number((await page.locator(
    '[data-history-category-row="'+targetCategory+'"] .history-category-actual').innerText())
    .replace(/[^0-9.-]/g,''))*100);
   await page.locator('.planner-nav-primary [data-view="activity"]').click();
   const rowAgain=page.locator('.history-entry')
    .filter({has:page.locator('.history-actual-row[data-history-kind="expense"]')}).first();
   const chosenId=await rowAgain.getAttribute('data-history-entry');
   await rowAgain.locator('[data-history-category]').selectOption(targetCategory);
   await page.waitForFunction(([id,category])=>{
    const saved=JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}');
    return saved.categoryOverrides?.[id]===category;
   },[chosenId,targetCategory]);
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(Math.round(Number((await page.locator(
    '[data-history-category-row="'+targetCategory+'"] .history-category-actual').innerText())
    .replace(/[^0-9.-]/g,''))*100),oldTargetCents+movedCents,
    'A just-saved correction updates Budget in place, without refresh');
   assert.match(await page.locator('.history-budget-feedback').last().innerText(),
    /Updated .* Budget for September 2026/,
    'Budget explicitly acknowledges a saved category change');
   await chooseMonths(page,['2026-10']);
   assert.match(await page.locator('.history-budget-feedback').last().innerText(),
    /outside the selected Budget months/,
    'A correct category save explains why an older purchase is not in this month');
   await page.locator('[data-show-saved-budget]').click();
   assert.deepEqual(await selectedMonths(page),['2026-09'],
    'Show that month opens the changed category’s transaction month');
   assert.equal(Math.round(Number((await page.locator(
    '[data-history-category-row="'+targetCategory+'"] .history-category-actual').innerText())
    .replace(/[^0-9.-]/g,''))*100),oldTargetCents+movedCents,
    'Budget reflects the saved correction without forcing a bank refresh');


   // Compare with an actual Upcoming Bills item generated from a completely
   // fictional repeating rule. Keep it isolated to this disposable demo test.
   const visualAccount=await page.locator('.history-budget-filters [name="historyAccount"] option')
    .evaluateAll(nodes=>nodes.find(n=>n.value&&n.value!=='all')?.value||'');
   assert.ok(visualAccount,'A fictional account is available for the visual fixture');
   await page.evaluate(accountId=>{
    const key='household-planner-sample-settings-v1';
    const p=JSON.parse(localStorage.getItem(key)||'{}');
    const r={id:'fictional-bill-row-layout',kind:'event',
     accountId,originalAccountId:accountId,
     merchant:'Fictional Internet Bill',originalMerchant:'Fictional Internet Bill',
     scheduleLabel:'Fictional Internet Bill',type:'expense',originalType:'expense',
     amount:85,matchAmount:85,frequency:'monthly',sourceFrequency:'monthly',
     anchorDate:'2026-10-23',sourceAnchorDate:'2026-10-23',
     amountBasis:'fixed',category:'Utility',categoryReviewed:true,
     matchNames:['fictional internet bill'],enabled:true};
    p.futureRecurringRules=[...(p.futureRecurringRules||[])
     .filter(x=>x.id!==r.id),r];
    p.recurringForecastMode='approved-only';
    localStorage.setItem(key,JSON.stringify(p));
   },visualAccount);
   await page.reload();
   await page.locator('.planner-nav-primary [data-view="schedules"]').click();
   const upcoming=page.locator('.bills-upcoming-row')
    .filter({hasText:'Fictional Internet Bill'}).first();
   const repeating=page.locator('[data-schedule-card="fictional-bill-row-layout"]');
   assert.equal(await upcoming.count(),1,
    'Fixture appears in Upcoming Bills as a canonical forecast');
   assert.equal(await repeating.count(),1,
    'Fixture appears in Repeating Payments');
   const design=(row,container,merchant,amount)=>row.evaluate(
    (node,{container,merchant,amount})=>{
     const outer=node.closest(container),css=getComputedStyle(outer),r=node.getBoundingClientRect();
     return {height:r.height,merchant:parseFloat(getComputedStyle(node.querySelector(merchant)).fontSize),
      amount:parseFloat(getComputedStyle(node.querySelector(amount)).fontSize),
      cardBorder:css.borderTopStyle,cardShadow:css.boxShadow,
      overflow:document.documentElement.scrollWidth-innerWidth};
    },{container,merchant,amount});
   const ref=await design(upcoming,'.bills-upcoming',
    '.bills-upcoming-description strong','.bills-upcoming-row>strong');
   const scheduled=await design(repeating.locator('.schedule-compact-row'),
    '.schedule-card','.schedule-row-title strong','.schedule-row-amount strong');
   assert.ok(ref.height>=60&&scheduled.height>=60&&
    Math.abs(ref.height-scheduled.height)<=30,
    'Repeating matches Upcoming Bills row spacing: '+JSON.stringify({ref,scheduled}));
   assert.ok(Math.abs(ref.merchant-scheduled.merchant)<=1&&
    Math.abs(ref.amount-scheduled.amount)<=1,
    'Repeating text matches Upcoming Bills: '+JSON.stringify({ref,scheduled}));
   assert.equal(scheduled.cardBorder,'none','Repeating has no individual enclosing card');
   assert.equal(scheduled.cardShadow,'none','Repeating has no per-item shadow');
   assert.ok(ref.overflow<=3&&scheduled.overflow<=3,'No horizontal overflow in Bills');
   await page.locator('.planner-nav-primary [data-view="activity"]').click();
   const posted=await design(page.locator('.history-entry .history-actual-row').first(),
    '.history-entry','.history-actual-description strong','.history-actual-amount');
   assert.ok(posted.height>=60&&Math.abs(posted.height-ref.height)<=30,
    'Activity matches Upcoming Bills vertical rhythm: '+JSON.stringify({ref,posted}));
   assert.ok(Math.abs(ref.merchant-posted.merchant)<=1&&
    Math.abs(ref.amount-posted.amount)<=1,
    'Activity text matches Upcoming Bills: '+JSON.stringify({ref,posted}));
   assert.equal(posted.cardBorder,'none','Activity is a flat, continuous list');
   assert.ok(posted.overflow<=3,'No horizontal overflow in Activity');
   await page.locator('.planner-nav-primary [data-view="schedules"]').click();
   await repeating.locator('[data-schedule-edit]').click();
   assert.equal(await page.locator('.transaction-detail [data-schedule-edit-form]').count(),1,
    'Spacious Repeating row keeps existing editor');
   await page.locator('.transaction-detail-close').click();

   // All transaction name and dollar typography must EXACTLY match
   // Upcoming Bills at every responsive width, not merely use similar sizes.
   const transactionFonts=async (rowSelector,nameSelector,valueSelector)=>{
    const row=page.locator(rowSelector).first();
    assert.ok(await row.count()>0,'Expected transaction for font comparison: '+rowSelector);
    return row.evaluate((node,{nameSelector,valueSelector})=>{
     const name=node.querySelector(nameSelector),value=node.querySelector(valueSelector);
     return {name:name?parseFloat(getComputedStyle(name).fontSize):null,
      value:value?parseFloat(getComputedStyle(value).fontSize):null,
      // The visible dollar is rendered in nested glyph spans. A matching
      // outer amount font-size alone does not guarantee visually equal text.
      glyphSizes:value?[...value.querySelectorAll('.ledger-money-sign,.ledger-money-dollar,.ledger-money-digits')]
       .map(el=>parseFloat(getComputedStyle(el).fontSize)):[],
      width:document.documentElement.scrollWidth,viewport:innerWidth};
    },{nameSelector,valueSelector});
   };
   const assertFontsMatch=(label,actual,expected)=>{
    assert.deepEqual([actual.name,actual.value],[expected.name,expected.value],
     label+' must match Upcoming Bills exact computed name/amount font sizes: '+
     JSON.stringify({actual,expected}));
    if(label.startsWith('Repeating ')||label.startsWith('Posted Activity ')){
     assert.equal(actual.glyphSizes.length,3,
      label+' should render sign, dollar and digits as separate real glyphs');
    }
    assert.ok(actual.glyphSizes.every(size=>size===expected.value),
     label+' nested visible amount glyphs must have Upcoming Bills font size: '+
     JSON.stringify({actual,expected}));
    assert.ok(actual.width<=actual.viewport+3,
     label+' must not introduce horizontal overflow: '+JSON.stringify(actual));
   };
   for(const width of (mobile?[320,390]:[768,1280])){
    await page.setViewportSize({width,height:mobile?844:900});
    await page.locator('.planner-nav-primary [data-view="schedules"]').click();
    const baseline=await transactionFonts(
     '.bills-upcoming-row','.bills-upcoming-description strong','.bills-upcoming-row>strong');
    assert.deepEqual([baseline.name,baseline.value],width<=390?[13,13]:width<=850?[14,14]:[15,16],
     'Upcoming Bills is the reference for desktop and phone font sizes at '+width);
    assertFontsMatch('Repeating '+width,await transactionFonts(
     '.schedule-row-main.ledger-transaction-row',
     '.schedule-row-title strong','.schedule-row-amount strong'),baseline);
    await page.locator('.planner-nav-primary [data-view="activity"]').click();
    assertFontsMatch('Posted Activity '+width,await transactionFonts(
     '.history-row-open.ledger-transaction-row',
     '.history-actual-description strong','.history-actual-amount'),baseline);
    await page.locator('#planner-menu>summary').click();
    await page.locator('#planner-menu [data-view="transactions"]').click();
    assertFontsMatch('Dated Predictions '+width,await transactionFonts(
     '.unified-payment-trigger.ledger-transaction-row',
     '.unified-payment-name strong','.unified-payment-value'),baseline);
    await page.locator('.planner-nav-primary [data-view="summary"]').click();
    await page.locator('[data-calendar-day="2026-10-23"]').click();
    assertFontsMatch('Calendar prediction '+width,await transactionFonts(
     '.calendar-day-detail .calendar-monthly-row.ledger-transaction-row',
     '.calendar-monthly-name strong','.ledger-transaction-amount'),baseline);
    await page.locator('.attention-link[data-view="reviews"]').click();
    if(await page.locator('.category-review-open.ledger-transaction-row').count()){
     assertFontsMatch('Review categorization '+width,await transactionFonts(
      '.category-review-open.ledger-transaction-row',
      '.ledger-transaction-identity strong','.ledger-transaction-amount'),baseline);
    }
    if(await page.locator('.review-row-open.ledger-transaction-row').count()){
     assertFontsMatch('Review recurring '+width,await transactionFonts(
      '.review-row-open.ledger-transaction-row',
      '.review-candidate-main strong','.review-candidate-amount'),baseline);
    }
   }

   assert.deepEqual(errors,[],'No uncaught client errors on '+(mobile?'iPhone WebKit':'desktop Chromium'));
   await context.close();
  }
  console.log('PASS novice Ledger browser interactions in desktop Chromium and iPhone WebKit');
 }finally{
  await chrome?.close();await iphone?.close();server.kill();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
