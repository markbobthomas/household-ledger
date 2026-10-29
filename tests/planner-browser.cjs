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
    ['Calendar','Bills','Bank History']);
   assert.equal(await page.locator('.topbar [data-view="reviews"]').count(),1,
    'Things to check is a visible action outside three main destinations');
   assert.equal(await page.locator('.main-navigation [data-view="reviews"]').count(),0,
     'Things to check no longer consumes a second navigation row');
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
     if(tab==='schedules'){
       const layout=await page.evaluate(()=>{
        const label=document.querySelector('.schedule-page .schedule-category-controls>label'),
         control=label?.querySelector('[data-schedule-category-filter]');
        if(!label||!control)return null;
        const range=document.createRange();
        range.selectNodeContents(label.firstChild);
        const caption=range.getBoundingClientRect(),select=control.getBoundingClientRect(),
         computed=getComputedStyle(label);
        return {captionBottom:caption.bottom,selectTop:select.top,
         lineHeight:parseFloat(computed.lineHeight),fontSize:parseFloat(computed.fontSize),
         options:[...control.options].map(o=>o.value)};
       });
       assert.ok(layout&&layout.fontSize>=10&&layout.lineHeight>=12&&
        layout.selectTop>=layout.captionBottom+3,
        'Bills Category caption must not overlap its dropdown at '+width+': '+JSON.stringify(layout));
       assert.equal(layout.options[1],'Other','Other is the first named category in Bills');
       assert.equal(await page.locator('.schedule-page [data-schedule-category-add],.schedule-page .schedule-category-manager').count(),0,
        'Category creation is no longer part of the Bills toolbar');
      }
      if(tab==='summary'){
       const metricLayout=await page.evaluate(()=>{
        const root=document.querySelector('.summary-page .summary-numbers');
        const cards=[root?.querySelector('.summary-bank'),root?.querySelector('.summary-monthly'),
         root?.querySelector('.summary-minimum')];
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
    for(const report of ['list','merchants','sizes']){
     await page.locator('[data-history-view="'+report+'"]').click();
     const field=await page.evaluate(()=>{
      const label=document.querySelector('.history-page .history-category-controls>label'),
       select=label?.querySelector('select'),
       account=document.querySelector('.history-page select[name="historyAccount"]');
      if(!label||!select||!account)return null;
      const lineHeight=parseFloat(getComputedStyle(label).lineHeight),
       selectRect=select.getBoundingClientRect(),labelRect=label.getBoundingClientRect(),
       accountRect=account.getBoundingClientRect();
      return {lineHeight,labelTop:labelRect.top,selectTop:selectRect.top,
       categoryLeft:selectRect.left,accountRight:accountRect.right};
     });
     assert.ok(field&&field.lineHeight>=12&&field.selectTop>=field.labelTop+12,
      'Category label must clear dropdown on '+report+': '+JSON.stringify(field));
     if(report!=='list'&&mobile)
      assert.ok(field.categoryLeft>=field.accountRight-2,
       'Analysis filters sit in aligned columns: '+JSON.stringify(field));
    }
    await page.locator('[data-history-view="list"]').click();
   assert.equal(await page.locator('.history-period-controls [data-history-month-picker]').count(),1);
   assert.equal(await page.locator('[data-history-month-toggle]').count(),1);
   assert.equal(await page.locator('[data-history-months],[data-history-month]').count(),0);
   assert.equal(await page.locator('.history-page [data-history-view="list"][aria-pressed="true"]').count(),1);
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
   await page.locator('[data-history-view="categories"]').click();
   assert.equal(await page.locator('[data-history-selection-summary]').count(),0,
    'The multi-selection UI belongs only to Transactions view');
   await page.locator('[data-history-view="categories"]').click();
   assert.equal(await page.locator('[data-history-category-insights]').count(),1);
   // Create and delete categories in Bank History → Categories only.
   assert.equal(await page.locator('[data-history-category-manager]').count(),1);
   assert.equal(await page.locator('[data-history-category-delete="Other"]').count(),0);
   await page.locator('.history-category-manager>summary').click();
   await page.locator('[data-history-category-add] [name=categoryName]').fill('Fictional Pet Care');
   await page.locator('[data-history-category-add] button[type=submit]').click();
   assert.equal(await page.locator('.history-category-manage-status').innerText(),
    'Added Fictional Pet Care. Select it on any transaction or bill.');
   await page.locator('.history-category-manager>summary').click();
   assert.equal(await page.locator('[data-history-category-delete="Fictional Pet Care"]').count(),1);
   page.once('dialog',dialog=>dialog.accept());
   await page.locator('[data-history-category-delete="Fictional Pet Care"]').click();
   assert.equal(await page.locator('.history-category-manage-status').innerText(),
    'Deleted Fictional Pet Care. Existing bank history was not changed.');
   assert.equal(await page.locator('[data-history-category-delete="Fictional Pet Care"]').count(),0);
   const catalog=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}'));
   assert.ok(!(catalog.scheduleCategories||[]).includes('Fictional Pet Care'),
    'Deleted category stays absent from saved preferences');
   
   assert.equal(await page.locator('.history-donut').count(),1);
   assert.ok(await page.locator('.history-category-item').count()>0,
    'Category legend is populated from fictional posted purchase records');
   assert.equal(await page.locator('[data-history-budget-bar]').count(),
    await page.locator('.history-category-item').count(),
    'Each category shows a budget usage bar');
   const unsetBar=page.locator('[data-history-budget-bar][data-budget-status="unset"]').first();
   if(await unsetBar.count())assert.equal(
    Number.parseFloat(await unsetBar.locator('.history-budget-fill').evaluate(el=>el.style.width)),0,
    'Without a target, the usage bar is empty');
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
   assert.match(await page.locator('.history-category-item').first()
    .locator('[data-history-budget-bar]').getAttribute('aria-label'),/spent of .* budget/,
    'The saved budget appears in the accessible progress description');
   assert.equal(await page.locator('.history-list-surface').count(),0,
    'Category view shows its tailored chart rather than duplicating line-item history');
   await chooseMonths(page,['2026-10','2026-09','2026-08']);
   assert.match(await page.locator('.history-budget-explanation').innerText(),/3 monthly budgets/,
    'Three-month actual spending is compared against three full calendar monthly targets');
   assert.equal(await page.locator('[data-history-budget="'+categoryName+'"]').inputValue(),'275.50',
    'A monthly budget carries across report periods');
   const budgetRow=page.locator('.history-category-item').filter({
    has:page.locator('[data-history-budget="'+categoryName+'"]')
   });
   const threeActual=Number((await budgetRow.locator('.history-category-actual').innerText()).replace(/[^0-9.]/g,''));
   const threeBar=Number.parseFloat(await budgetRow.locator('.history-budget-fill').evaluate(el=>el.style.width));
   assert.ok(Math.abs(threeBar-Math.min(100,threeActual/(275.5*3)*100))<.02,
    'Three months of purchases use three times the monthly budget');
   if(threeActual>.01){
    await budgetRow.locator('[data-history-budget]').fill('0.01');
    await budgetRow.locator('[data-history-budget]').press('Tab');
    await page.waitForFunction(category=>JSON.parse(localStorage.getItem(
     'household-planner-sample-settings-v1')||'{}').categoryMonthlyBudgets?.[category]===.01,categoryName);
    assert.equal(await budgetRow.locator('[data-history-budget-bar]').getAttribute('data-budget-status'),'over');
    assert.equal(Number.parseFloat(await budgetRow.locator('.history-budget-fill').evaluate(el=>el.style.width)),100,
     'The over-budget fill caps at its full track width');
    await budgetRow.locator('[data-history-budget]').fill('275.50');
    await budgetRow.locator('[data-history-budget]').press('Tab');
    await page.waitForFunction(category=>JSON.parse(localStorage.getItem(
     'household-planner-sample-settings-v1')||'{}').categoryMonthlyBudgets?.[category]===275.5,categoryName);
   }
   for(const width of (mobile?[320,390]:[768,1280])){
    await page.setViewportSize({width,height:mobile?844:900});
    const dimensions=await budgetRow.evaluate(row=>{
     const rect=sel=>row.querySelector(sel).getBoundingClientRect(),
      name=rect('.history-category-drill'),bar=rect('[data-history-budget-bar]'),
      actual=rect('.history-category-actual'),budget=rect('.history-category-budget');
     return {nameRight:name.right,barLeft:bar.left,barRight:bar.right,barWidth:bar.width,
      actualLeft:actual.left,actualRight:actual.right,budgetLeft:budget.left,
      viewport:document.documentElement.scrollWidth};
    });
    assert.ok(dimensions.nameRight<=dimensions.barLeft+2&&
     dimensions.barRight<=dimensions.actualLeft+2&&
     dimensions.actualRight<=dimensions.budgetLeft+2,
     'The category progress bar stays between the name and amounts: '+JSON.stringify(dimensions));
    assert.ok(dimensions.barWidth>=20&&dimensions.viewport<=width+3,
     'Category bar does not overflow at '+width+'px: '+JSON.stringify(dimensions));
   }
   await page.setViewportSize({width:mobile?390:1280,height:mobile?844:900});
   await chooseAllMonths(page);
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

   // Merchant view: one intuitive calendar-month spend total per merchant,
   // independent of the existing Category and Purchase Sizes analysis.
   await page.locator('[data-history-view="merchants"]').click();
   assert.equal(await page.locator('[data-history-merchant-insights]').count(),1);
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
   assert.equal(await page.locator('[data-history-view="list"][aria-pressed="true"]').count(),1,
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
   await page.locator('[data-history-view="list"]').click();

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
   await page.locator('[data-history-view="categories"]').click();
   assert.deepEqual(await selectedMonths(page),['2026-08','2026-10'],
    'Checked months remain selected across all four reports');
   assert.match(await page.locator('.history-budget-explanation').innerText(),/2 monthly budgets/,
    'Monthly budgets scale by number of checked months');
   await page.locator('[data-history-view="list"]').click();
   await chooseAllMonths(page);
   await page.reload({waitUntil:'load'});
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.locator('[data-history-view="categories"]').click();
   assert.equal(await page.locator('[data-history-budget="'+categoryName+'"]').inputValue(),'275.50',
    'A monthly category budget is saved across page reloads');
   assert.deepEqual(await selectedMonths(page),['2026-10'],
    'Reload resets the view to the current calendar month');

   // A category edit teaches a merchant lesson, which Settings can forget
    // without reverting the transaction's individual saved correction.
    await page.locator('[data-history-view="list"]').click();
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
   assert.equal(await page.locator('[data-category-review]').count(),1,
    'Missing or uncertain transaction and bill categories have a persistent review section');
   const categoryForms=page.locator('[data-category-review-form]');
   const categoryFormsBefore=await categoryForms.count();
   if(categoryFormsBefore){
    const first=categoryForms.first(),categoryId=await first.getAttribute('data-category-id');
    assert.equal(await first.locator('[name=category]').inputValue(),'','Unconfirmed Other never silently preselects a decision');
    assert.ok((await first.locator('[name=category] option').allTextContents()).includes('Other'),
     'Other is offered as a deliberate catch-all in category Review');
    await first.locator('[name=category]').selectOption('Other');
    await first.locator('[type=submit]').click();
    assert.equal(await page.locator('[data-category-review-form]').count(),categoryFormsBefore-1,
     'A saved category confirmation removes its issue from Things to check');
    assert.equal(await page.locator('[data-category-review-form][data-category-id="'+categoryId+'"]').count(),0,
     'Confirmed issue stays out of the current review list');
    const afterOther=page.locator('[data-category-review-form]');
    if(await afterOther.count()){
     const second=afterOther.first(),id=await second.getAttribute('data-category-id');
     await second.locator('[name=category]').selectOption('Shopping');
     await second.locator('[type=submit]').click();
     assert.equal(await page.locator('[data-category-review-form][data-category-id="'+id+'"]').count(),0,
      'Specific categories also remain valid and clear Review');
    }
   }

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
