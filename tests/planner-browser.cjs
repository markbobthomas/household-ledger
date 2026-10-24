'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const crypto=require('node:crypto'),os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'household-planner-'));
 const demoPort=18765,privatePort=18766,pass=crypto.randomBytes(24).toString('hex');
 const children=[];
 let chrome,iphone;
 const fixedDate=()=>{const Base=Date;class FixedDate extends Base{
  constructor(...xs){if(xs.length)super(...xs);else super('2026-10-19T12:00:00Z')}
  static now(){return new Base('2026-10-19T12:00:00Z').getTime()}
 }window.Date=FixedDate;};
 const startup=async(url)=>{for(let n=0;n<80;n++){try{const r=await fetch(url);if(r.status<500)return}catch{}await new Promise(r=>setTimeout(r,80))}throw Error('Server not available: '+url)};
 // Compare the same four data columns and category controls across both
 // ledger tabs, rather than just their outer border/panel dimensions.
 const rowLayout=async(page,selector)=>page.locator(selector).first().evaluate(row=>{
  const root=row.getBoundingClientRect(),rect=selector=>{
   const el=row.querySelector(selector);
   if(!el)throw Error('Missing unified ledger element '+selector);
   const b=el.getBoundingClientRect();
   return {x:Math.round((b.left-root.left)*10)/10,y:Math.round((b.top-root.top)*10)/10,
    pageX:Math.round(b.left*10)/10,width:b.width,height:b.height};
  };
  const select=row.querySelector('.ledger-row-category'),
   name=row.querySelector('.ledger-row-description strong');
  const ancestors=[];for(let p=row.parentElement,i=0;p&&i<4;p=p.parentElement,i++){
   const cs=getComputedStyle(p),r=p.getBoundingClientRect();
   ancestors.push({className:String(p.className),width:r.width,
    paddingLeft:cs.paddingLeft,paddingRight:cs.paddingRight});
  }
  return {height:root.height,width:root.width,left:root.left,ancestors,button:rect('.ledger-row-open'),
   date:rect('.ledger-row-date'),description:rect('.ledger-row-description'),
   amount:rect('.ledger-row-amount'),hint:rect('.ledger-row-hint'),
   category:rect('.ledger-row-category'),
   categoryStyle:{fontSize:getComputedStyle(select).fontSize,
    height:getComputedStyle(select).height,
    borderRadius:getComputedStyle(select).borderRadius,
    background:getComputedStyle(select).backgroundColor,
    color:getComputedStyle(select).color},
   titleStyle:{fontSize:getComputedStyle(name).fontSize,
    color:getComputedStyle(name).color}};
 });

 try{
  children.push(spawn('python3',['-m','http.server',String(demoPort),'--bind','127.0.0.1'],
   {cwd:path.resolve(__dirname,'..'),stdio:'ignore'}));
  children.push(spawn(process.execPath,['sandbox/server.cjs'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore',
   env:{...process.env,LIVE_PLAID_ENABLED:'1',PORT:String(privatePort),PILOT_PASSWORD:pass,
    PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'fictional',
    PLAID_SECRET:'fictional',PLAID_ENV:'sandbox',PILOT_STATE_PATH:path.join(dir,'private.enc')}}));
  await Promise.all([startup('http://127.0.0.1:'+demoPort+'/index.html'),
   startup('http://127.0.0.1:'+privatePort+'/healthz')]);
  chrome=await chromium.launch({headless:true});
  iphone=await webkit.launch({headless:true});
  const staticUrl='http://127.0.0.1:'+demoPort;
  for(const [browser,mobile] of [[chrome,false],[iphone,true]]){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900}});
   await context.addInitScript(fixedDate);
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(staticUrl,{waitUntil:'load'});
   assert.equal(await page.locator('h1').innerText(),'Household Ledger');
   assert.equal(await page.locator('meta[name="ledger-ui-revision"]').getAttribute('content'),
    'calendar-day-single-ledger-20261024-v1','The loaded HTML identifies the task-based UI release');
   assert.match(await page.locator('#deployment-version').textContent(),/Focused Review v1/,
    'More exposes the current Calendar build, even when its menu is closed');
   assert.equal(await page.locator('.side-link').count(),0,
    'No duplicate sidebar navigation');
   assert.equal(await page.locator('.planner-nav-primary .tab-link').count(),4,
    'One primary navigation row: calendar, schedules, history');
   assert.deepEqual(await page.locator('.planner-nav-primary .tab-link').allTextContents(),
    ['Calendar','Repeating','Bank activity','Needs review']);
   assert.equal(await page.locator('.planner-nav-primary [data-view="transactions"]').count(),0,
    'Predictions is available through More instead of the main row');
   const go=async tab=>{
    const primary=page.locator('.planner-nav-primary [data-view="'+tab+'"]');
    if(await primary.count()){await primary.click();return}
    if(tab==='overview'){
     await page.evaluate(()=>{
      const b=document.createElement('button');b.dataset.view='overview';
      b.hidden=true;document.body.appendChild(b);b.click();b.remove();
     });
     return;
    }
    if(await page.locator('#planner-menu').getAttribute('open')===null)
     await page.locator('#planner-menu > summary').click();
    await page.locator('.planner-menu-content [data-view="'+tab+'"]').click();
   };
   // The menu must stay usable on desktop and the narrowest supported iPhones.
   const visibleMenu=async()=>{
    await page.locator('#planner-menu > summary').click();
    const r=await page.locator('.planner-menu-content').evaluate(el=>{
     const b=el.getBoundingClientRect();
     return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,
      screenW:window.innerWidth,screenH:window.innerHeight};
    });
    assert.ok(r.left>=-1&&r.right<=r.screenW+1&&r.top>=0&&r.bottom<=r.screenH+1,
     'Menu remains entirely onscreen: '+JSON.stringify(r));
    await page.keyboard.press('Escape');
   };
   await visibleMenu();
   if(mobile){
    await page.setViewportSize({width:320,height:640});
    await visibleMenu();
    const menu=await page.locator('#planner-menu > summary').boundingBox();
    assert.ok(menu&&menu.x>=0&&menu.x+menu.width<=321,'Menu trigger itself stays onscreen at 320px');
    const tabs=await page.locator('.planner-nav-primary .tab-link').evaluateAll(els=>
     els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,visible:r.width>0&&r.height>0}}));
    assert.equal(tabs.length,4);
    assert.ok(tabs.every(r=>r.visible&&r.left>=-1&&r.right<=321),
     'All four task-based tabs are reachable without sideways navigation at 320px: '+JSON.stringify(tabs));
    await page.setViewportSize({width:390,height:844});
   }

   assert.equal(await page.locator('#ledger-mode-switch option[value=real]').isDisabled(),true,
    'Public Demo cannot pretend it is authenticated Real');
   await page.locator('#planner-menu > summary').click();
   assert.match(await page.locator('#source-type').innerText(),/DEMO/);
   await page.keyboard.press('Escape');
   assert.match(await page.locator('.summary-page').innerText(),/3-year low/);
   assert.equal(await page.locator('[data-bank-current-value]').innerText(),'$5,650.25',
    'The demo current balance uses the bank snapshot current, not available $5,400.25');
   assert.match(await page.locator('.summary-bank').innerText(),/Demo current balance/);
   assert.equal(await page.locator('.planner-menu-content [data-view="transactions"]').count(),1,
    'Overlapping forecast destinations are removed from the main menu');
   assert.equal(await page.locator('.calendar-drilldowns [data-view="transactions"]').count(),0,
    'Full forecast editing and skipped-payment restore stay accessible from Calendar');
   assert.ok(await page.locator('#planner-menu > summary').isVisible(),'Advanced tools use one compact menu');
   assert.equal(await page.locator('.topbar .lead').count(),0,
    'Global header does not repeat the planner introduction');
   assert.equal(await page.locator('.planner-menu-bank label[for="ledger-mode-switch"]').count(),1,
    'The data source selector is explicitly labeled in More');
   assert.equal(await page.locator('.top-actions > #refresh-bank,.top-actions > #ledger-mode-switch').count(),0,
    'Bank controls no longer clutter the top-level header');
   await go('settings');
   const lowAlertInput=page.locator('[data-low-alert-form] [name=lowAlertThreshold]');
   assert.equal(await lowAlertInput.inputValue(),'6000',
    'Default low highlight threshold is $6,000');
   await lowAlertInput.fill('100000');
   await page.locator('[data-low-alert-form] button[type=submit]').click();
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(
    'household-planner-sample-settings-v1')||'{}').lowAlertThreshold),100000,
    'Red threshold saves in forecast-only preferences');
   assert.equal(await page.locator('[aria-label="Bank connection status"]').count(),1,
    'Connection information appears in one compact, actionable Settings section');
   assert.equal(await page.locator('h3').filter({hasText:'Planning assumptions'}).count(),0,
    'Settings does not repeat forecasting disclaimers already present in Calendar');
   assert.equal(await page.locator('[aria-label="Automatic prediction exclusions"]').count(),0,
    'An empty recurrence-exclusion manager does not occupy space in Settings');
   assert.equal(await page.locator('[aria-label="Recurring forecast changes"]').count(),0,
    'Schedules, not a second Settings shortcut, own recurrence editing');
   await go('summary');
   assert.match(await page.locator('.calendar-balance-explainer').innerText(),
    /first balance is sample data.*Future daily balances and lows are estimates/i,
    'A first-time user can distinguish sample bank values from estimated future balances');
   assert.match(await page.locator('[data-calendar-first-tip]').innerText(),/Choose a future date.*Edit/s,
    'The Calendar shows contextual first-use editing guidance');
   await page.locator('[data-calendar-tip-dismiss]').click();
   assert.equal(await page.locator('[data-calendar-first-tip]').count(),0,
    'A newcomer can dismiss the single first-use hint without opening a tutorial');
   assert.equal(await page.evaluate(()=>localStorage.getItem('household-ledger-calendar-tip-hidden-v1')),'1',
    'Dismissed guidance persists independently of bank and forecast data');
   assert.equal(await page.locator('[data-summary-days],#horizon').count(),0,
    'No 30/60/90 period selectors in the simplified planner');
   assert.equal(await page.locator('.summary-numbers .summary-low').count(),2,
    'Monthly and three-year lows are both shown');
   assert.deepEqual(await page.locator('.summary-numbers > div').evaluateAll(elements=>
    elements.map(el=>el.className)),['summary-bank','summary-monthly','summary-minimum'],
    'Bank balance, monthly low, and three-year low appear in that order');
   assert.deepEqual(await page.locator('.summary-numbers > div').evaluateAll(elements=>
    elements.map(el=>({
     border:getComputedStyle(el).borderLeftWidth,
     padding:getComputedStyle(el).paddingLeft
    }))),Array.from({length:3},()=>({border:'0px',padding:'0px'})),
    'All three metrics have identical zero inner borders and left padding');
   assert.equal(await page.locator('.summary-bank [data-bank-current-value]').evaluate(el=>
    getComputedStyle(el).color),'rgb(35, 113, 74)',
    'Bank-reported current balance is green');
   for(const selector of ['.summary-monthly .summary-low','.summary-minimum .summary-low']){
    assert.ok(await page.locator(selector).evaluate(el=>el.classList.contains('summary-low-alert')),
     'Projected lows below the saved threshold must be red');
    assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).color),
     'rgb(180, 59, 54)','Saved threshold turns projected low values red');
   }
   await go('settings');
   await page.locator('[data-low-alert-form] [name=lowAlertThreshold]').fill('0');
   await page.locator('[data-low-alert-form] button[type=submit]').click();
   await go('summary');
   for(const selector of ['.summary-monthly .summary-low','.summary-minimum .summary-low']){
    const actual=await page.locator(selector).evaluate(el=>({
     value:Number(el.textContent.replace(/[^0-9.-]/g,'')),
     red:el.classList.contains('summary-low-alert')
    }));
    assert.equal(actual.red,actual.value<0,
     'At a $0 threshold, only negative projected lows remain red');
   }
   await go('settings');
   await page.locator('[data-low-alert-form] [name=lowAlertThreshold]').fill('6000');
   await page.locator('[data-low-alert-form] button[type=submit]').click();
   await go('summary');
   assert.match(await page.locator('.summary-numbers').innerText(),/3-year low/);
   assert.equal(await page.locator('.calendar-checklist,.coverage-table,.summary-coverage-metric').count(),0,
    'Ambiguous major-payment assurance panels have been removed');
   assert.equal(await page.locator('.calendar-monthly-list[open]').count(),0,
    'Full-month prediction list is collapsed by default');
   assert.equal(await page.locator('.calendar-day-transactions .calendar-monthly-row').count(),0,
    'No selected-day payments are invented on an empty starting day');
   assert.equal((await page.locator('.calendar-day-detail').innerText()).match(/No transactions predicted for this day/g)?.length,1,
    'Empty days show one plain-language status');
   assert.equal(await page.locator('.calendar-day-detail [data-calendar-reconciliation]').count(),0,
    'Empty days contain no invented opening-plus-transactions calculation');
   assert.equal(await page.locator('.calendar-day-detail .calendar-day-ending').count(),1,
    'Empty day still shows one closing balance at its bottom');
   assert.ok(!(await page.locator('.calendar-monthly-list > summary').innerText()).includes('Expand'),
    'The native monthly disclosure does not repeat Expand');
   await page.locator('.calendar-monthly-list > summary').click();
   assert.equal(await page.locator('.calendar-monthly-list[open]').count(),1,
    'Optional month list expands on demand');
   const monthlyEntries=page.locator('.calendar-monthly-list .calendar-monthly-row');
   assert.ok(await monthlyEntries.count()>0,'Expanded month contains actual forecast events');
   const pickedMonth=await monthlyEntries.first().getAttribute('data-calendar-list-date');
   await monthlyEntries.first().click();
   assert.equal(await page.locator('.transaction-detail[role="dialog"]').count(),0,
    'Monthly rows edit without opening a popup or navigating away');
   const expandedMonth=page.locator('[data-inline-row-wrapper]').filter({
    has:page.locator('.calendar-monthly-row[aria-expanded="true"]')});
   assert.equal(await expandedMonth.locator('[data-inline-transaction-editor] .future-edit-form').count(),1,
    'Complete editing fields appear directly under the clicked monthly transaction');
   assert.ok(await expandedMonth.locator('[name=date],[name=merchant],[name=amount]').count()>=3);
   await expandedMonth.locator('[data-cancel-future]').click();
   assert.equal(await page.locator('[data-inline-transaction-editor]').count(),0,
    'Cancel collapses the row without changing the forecast');
   assert.equal(await page.locator('[data-calendar-stage]').count(),1,
    'Summary defaults to a daily balance calendar');
   assert.match(await page.locator('.calendar-navigation h2').innerText(),/October 2026/);
   assert.ok(await page.locator('[data-calendar-day]').count()>=10,
    'Every in-range date displays its projected account balance');
   assert.equal(await page.locator('.calendar-day.selected').count(),1);
   assert.ok(await page.locator('.calendar-day-balance').count()>=10,
    'Balances appear even on days without transactions');
   const projectedDay=page.locator('[data-calendar-day]').filter({
    has:page.locator('.calendar-event')}).first();
   assert.ok(await projectedDay.count()>0,'Daily dates show predicted transaction labels and amounts');
   await projectedDay.click();
   assert.equal(await page.locator('.calendar-monthly-list[open]').count(),0,
    'Selecting a new date returns to the focused view instead of retaining a long month list');
   const chosenDate=await projectedDay.getAttribute('data-calendar-day');
   const selectedPayments=page.locator('.calendar-day-transactions .calendar-monthly-row');
   assert.equal(await page.locator('.calendar-detail-heading [data-calendar-add]').isVisible(),true,
    'Add prediction is directly beside the selected future date');
   assert.match(await page.locator('.calendar-detail-heading [data-calendar-add]').innerText(),/Add prediction/);
   assert.ok(await selectedPayments.count()>0,
    'Selected forecast day immediately lists its own editable predictions');
   assert.equal(await selectedPayments.count(),await page.locator(
    '.calendar-monthly-list .calendar-monthly-row[data-calendar-list-date="'+chosenDate+'"]').count(),
    'Selected day contains exactly the predictions belonging to that date');
   assert.equal(await page.locator('.calendar-monthly-list .calendar-monthly-row:visible').count(),0,
    'Other days are hidden until explicitly expanding the month');
   assert.equal(await selectedPayments.first().locator('.calendar-monthly-view').isVisible(),true,
    'A visible Edit affordance appears on predicted payments even on iPhone');
   assert.match(await selectedPayments.first().locator('.calendar-monthly-view').innerText(),/Edit/);
   await selectedPayments.first().click();
   assert.equal(await page.locator('.calendar-day-transactions [data-inline-transaction-editor]').count(),1,
    'A payment can be edited directly on its selected date');
   await page.locator('.calendar-day-transactions [data-cancel-future]').click();
   assert.equal(await page.locator('[data-inline-transaction-editor]').count(),0);

   const selectedAria=await page.locator('.calendar-day.selected').getAttribute('aria-label'),
    balanceText=await page.locator('.calendar-math-total strong').innerText();
   assert.ok(selectedAria.includes(balanceText),
    'Detailed balance is identical to the calendar projected balance for that date');
   assert.equal(await page.locator('.calendar-day-detail .calendar-detail-balance').count(),0,
    'End-of-day balance does not repeat in the selected-day heading');
   assert.equal(await page.locator('.calendar-math-total').count(),1,
    'Only one end-of-day total remains for the date');
   assert.equal(await page.locator('.calendar-day-detail > :last-child').getAttribute('class'),
    'calendar-math-total calendar-day-ending',
    'Ending balance is the LAST part of the day panel, after edit and add controls');
   const recon=page.locator('.calendar-day-detail [data-calendar-reconciliation]');
   assert.equal(await recon.count(),1,'Selected day uses one arithmetic trail');
   assert.equal(await recon.locator('.calendar-day-opening').count(),1);
   assert.equal(await recon.locator('.calendar-day-transactions .calendar-monthly-row').count(),
    await selectedPayments.count(),'Every canonical movement has one signed editable row');
   assert.equal(await page.locator('.calendar-day-detail .calendar-math').count(),0,
    'No duplicated deposit/withdrawal aggregates appear above the transactions');
   const equation=await recon.evaluate((element)=>{
    const value=text=>Number(text.trim().replace(/[$,\s]/g,'').replace('−','-'));
    const start=value(element.querySelector('.calendar-day-opening strong').textContent),
     movements=[...element.querySelectorAll('.calendar-day-transactions .calendar-monthly-row > strong')]
      .map(el=>value(el.textContent)),
     end=value(document.querySelector('.calendar-day-ending strong').textContent);
    return {start,movements,end};
   });
   assert.equal(Math.round((equation.start+equation.movements.reduce((a,b)=>a+b,0))*100),
    Math.round(equation.end*100),
    'The single signed transaction list explains the exact same projected ending balance');
   await page.locator('[data-calendar-actual-day]').last().click();
   assert.match(await page.locator('.calendar-day-detail').innerText(),/BANK HISTORY · NOT A PREDICTION/);
   assert.equal(await page.locator('.calendar-monthly-list[open]').count(),0,
    'Historical date selections do not open full-month predictions');
      await page.locator('[data-calendar-nav="1"]').click();
   assert.match(await page.locator('.calendar-navigation h2').innerText(),/November 2026/);
   const monthLowFromCells=async()=>page.evaluate(()=>{
    const rows=[...document.querySelectorAll('[data-calendar-day]')];
    const vals=rows.map(el=>({date:el.dataset.calendarDay,
     value:Number(el.querySelector('.calendar-money-wide')?.textContent?.replace(/[^0-9.-]/g,''))}))
     .filter(x=>Number.isFinite(x.value));
    const expected=vals.reduce((a,b)=>b.value<a.value?b:a);
    const metric=document.querySelector('[data-summary-month-value]');
    const date=document.querySelector('[data-calendar-month-low]');
    return {expected,shown:Number(metric?.textContent?.replace(/[^0-9.-]/g,'')),
     date:date?.dataset.calendarMonthLow,marked:document.querySelector('.calendar-day.month-minimum')?.dataset.calendarDay};
   });
   const novemberLow=await monthLowFromCells();
   assert.equal(novemberLow.shown,novemberLow.expected.value,'Monthly low matches the lowest displayed November day');
   assert.equal(novemberLow.date,novemberLow.expected.date,'Monthly low date matches November minimum');
   assert.equal(novemberLow.marked,novemberLow.date,'The actual minimum day is highlighted');
   assert.ok(await page.locator('[data-calendar-day="2026-11-01"]').count()>0,
    'Next month contains projected balances starting on its first day');
   await page.locator('[data-calendar-today]').click();
   assert.match(await page.locator('.calendar-navigation h2').innerText(),/October 2026/);
   assert.equal(await page.locator('[data-calendar-day="2026-10-19"].selected').count(),1,
    'Start returns to the bank as-of date');
   assert.equal(await page.locator('[data-summary-plot]').count(),1,
    'Previous trend is still available in optional details');
   await page.locator('.summary-extras > summary').click();
   assert.equal(await page.locator('[data-trend-days]').count(),6);
   const fullMinimum=await page.locator('.summary-minimum .summary-low').innerText();
   for(const n of [10,30,90,180,360,1095]){
    await page.locator('[data-trend-days="'+n+'"]').click();
    assert.equal(await page.locator('[data-trend-days][aria-pressed="true"]').count(),1);
    assert.equal(await page.locator('.summary-minimum .summary-low').innerText(),fullMinimum,
     'Trend windows must never change the three-year lowest balance');
    assert.equal(await page.locator('.calendar-day.selected').count(),1,
     'Trend windows do not change the selected calendar date');
   }
   assert.equal(await page.locator('.coverage-table,.calendar-checklist').count(),0);
   assert.match(await page.locator('.summary-trust').innerText(),/not a guaranteed minimum/i);
   assert.match(await page.locator('[data-summary-plot]').getAttribute('aria-label'),/3-year balance trend/);
   assert.equal(await page.locator('[data-summary-days],#horizon').count(),0);
   const beforeDate=await page.locator('[data-summary-peek-date]').innerText();
   await page.locator('[data-summary-plot]').focus();
   await page.keyboard.press('End');
   assert.notEqual(await page.locator('[data-summary-peek-date]').innerText(),beforeDate,
    'Keyboard navigation inspects future days without editing the forecast');
   await page.keyboard.press('Home');
   assert.equal(await page.locator('[data-summary-peek-date]').innerText(),'Oct 19, 2026');
   await go('overview');
   assert.ok((await page.locator('.account-tile').count())>=2,'Sample account selection works');
   const checking=page.locator('.account-tile').filter({hasText:'Everyday Checking'});
   await checking.click();
   assert.match(await page.locator('.balance-main').innerText(),/\$5,400\.25/,
    'Demo checking displays an illustrative bank-feed available balance');
   assert.ok((await page.locator('.chart-wrap svg').count())>0,'Forecast chart is rendered from the same engine');
   assert.match(await page.locator('[aria-label="Selected account projection"]').innerText(),/Lowest balance · next 3 years/);
   assert.match(await page.locator('[aria-label="Selected account projection"]').innerText(),/Available after this month's dated payments/);
   assert.match(await page.locator('[aria-label="Selected account projection"]').innerText(),/First projected shortfall/);
   await go('history'); // Unlike Calendar, history displays the global forecast caution.
   const migrationBanner=page.locator('#planner-notice');
   const countMatch=(await migrationBanner.innerText()).match(/(\d+) unsaved automatic repeating estimate/);
   if(countMatch)await migrationBanner.locator('[data-view="reviews"]').click();
   else await go('reviews');
   const legacySection=page.locator('[data-active-legacy-estimates]');
   const legacyRows=legacySection.locator('[data-legacy-estimate]');
   const expectedLegacy=Number(countMatch?.[1]||0);
   assert.equal(await legacyRows.count(),expectedLegacy,
    'Every unsaved automatic estimate named in the global warning gets its own visible review row');
   if(expectedLegacy){
    assert.equal(await legacySection.locator('[data-legacy-estimate-count]').innerText(),
     expectedLegacy+' UNSAVED','Highlighted section count is the active forecast count');
    assert.equal(await page.locator('.reviews-page > section.panel').first().getAttribute(
     'data-active-legacy-estimates'),'',
     'Active automatic forecasts are the first section in Needs review');
    const ids=await legacyRows.evaluateAll(nodes=>nodes.map(el=>el.dataset.legacyEstimate));
    assert.equal(new Set(ids).size,expectedLegacy,
     'Each row identifies one distinct cash movement stream rather than duplicating a merchant');
    assert.ok((await legacySection.locator('.legacy-estimate-state').first().innerText())
     .includes('forecast'),'The row explicitly explains the balance impact');
    const warningColor=await legacySection.locator('.legacy-estimate-count').first()
     .evaluate(el=>getComputedStyle(el).color);
    const channels=(warningColor.match(/\d+/g)||[]).map(Number);
    assert.ok(channels.length>=3&&channels[0]>channels[1]*1.5&&
     channels[0]>channels[2]*1.5,
     'Count receives visible red emphasis with the existing app theme: '+warningColor);
    const first=legacyRows.first(),countBefore=await legacyRows.count();
    assert.equal(await first.locator('[data-review-inline-detail]').count(),0,
     'Automatic estimates start as compact one-line proposals');
    assert.equal(await first.locator('.review-row-open[aria-expanded="false"]').count(),1,
     'Entire review data row is the disclosure button, not a separate Review control');
    assert.equal(await first.locator('.review-row-open .review-row-chevron').innerText(),'›',
     'A single chevron replaces explanatory Edit text on closed review rows');
    assert.equal(await first.locator('.review-row-open button').count(),0,
     'Review rows contain no nested buttons');
    await first.locator('.review-row-open').click();
    const activeEditor=first.locator('[data-review-inline-detail] .history-schedule-form');
    assert.equal(await activeEditor.count(),1,
     'Clicking the forecast row expands its schedule form directly beneath the row');
    assert.equal(await page.locator('.reviews-page .transaction-overlay').count(),0,
     'Review editor never opens a separate overlay');
    assert.equal(await first.locator('.review-row-open').getAttribute('aria-expanded'),'true');
    assert.equal(await activeEditor.locator('[name=category]').count(),1,
     'The same schedule categories are available in the review editor');
    assert.ok((await activeEditor.locator('[name=category] option').allTextContents()).includes('Utility'));
    await activeEditor.locator('[name=category]').selectOption('Utility');
    page.once('dialog',dialog=>dialog.dismiss());
    await first.locator('.review-row-open').click();
    assert.equal(await first.locator('[data-review-inline-detail]').count(),1,
     'Closing a changed review schedule asks before discarding inputs');
    await activeEditor.locator('[data-cancel-review-form]').click();
    assert.equal(await first.locator('[data-review-inline-detail]').count(),0,
     'Cancel collapses the exact row without saving a schedule');
    if(await first.getAttribute('data-recommendation-status')==='pending'){
     await first.locator('[data-ignore-recommendation]').click();
     assert.equal(await legacyRows.count(),countBefore,
      'Ignoring an already forecasted item never hides it from the active-cash inventory');
     assert.equal(await page.locator('[data-legacy-estimate="'+ids[0]+'"]').getAttribute(
      'data-recommendation-status'),'ignored',
      'Ignored legacy forecast still carries an explicit visible status');
     await page.locator('[data-legacy-estimate="'+ids[0]+'"] [data-unignore-recommendation]').click();
    }
   }
   const repeatingSection=page.locator('[data-recommended-repeating]');
   assert.equal(await repeatingSection.locator('[data-legacy-active="true"]').count(),0,
    'Existing automatic estimates are never mixed with speculative recurring suggestions');
   assert.equal(await repeatingSection.count(),1,'Recommended repeating is always a dedicated Review section');
   const originalRecommendations=await repeatingSection.locator('[data-recommended-repeat]').count();
   assert.equal(await repeatingSection.locator('[data-recommendation-status="ignored"]').count(),0,
    'Only unreviewed non-legacy suggestions belong in the general queue');
   assert.equal(await repeatingSection.locator('[data-recommendation-status="scheduled"]').count(),0,
    'Already saved schedules do not appear as new suggestions');
   if(originalRecommendations){
   const suggestion=repeatingSection.locator('[data-recommendation-status="pending"]').first();
   assert.ok(await suggestion.count()>0,'An unconfirmed recommendation can be reviewed');
   assert.equal(await repeatingSection.locator('[data-recommendation-status="ignored"]').count(),0,
    'Only unreviewed recurring suggestions belong to the main queue');
   assert.equal(await repeatingSection.locator('[data-recommendation-status="scheduled"]').count(),0,
    'Saved schedules stay off the Needs review queue');
   assert.equal(await repeatingSection.locator('[data-review-candidate]').count(),0,
    'Ordinary bank transactions are not independently replicated on Needs review');
   const suggestionKey=await suggestion.getAttribute('data-recommended-repeat'),
    trackedRecommendation=page.locator('[data-recommended-repeat="'+suggestionKey+'"]');
   const rulesBeforeIgnore=await page.evaluate(()=>JSON.parse(
    localStorage.getItem('household-planner-sample-settings-v1')||'{}').futureRecurringRules?.length||0);
   await trackedRecommendation.locator('[data-ignore-recommendation]').click();
   assert.equal(await trackedRecommendation.getAttribute('data-recommendation-status'),'ignored',
    'Ignored recommendations keep their saved decision');
   assert.equal(await repeatingSection.locator('[data-recommended-repeat]').count(),originalRecommendations-1,
    'Ignoring removes the row from the active queue');
   assert.equal(await page.locator('[data-ignored-repeating] [data-recommended-repeat="'+suggestionKey+'"]').count(),1,
    'Ignored recommendation moves to the separate collapsed section');
   assert.equal(await page.locator('[data-ignored-repeating]').getAttribute('open'),null,
    'Ignored section is collapsed by default');
   assert.equal(await page.evaluate(()=>JSON.parse(
    localStorage.getItem('household-planner-sample-settings-v1')||'{}').futureRecurringRules?.length||0),
    rulesBeforeIgnore,'No only records a review decision, never deletes a saved plan');
   await page.reload({waitUntil:'load'});
   await go('reviews');
   assert.equal(await trackedRecommendation.getAttribute('data-recommendation-status'),'ignored',
    'Ignored recommendations persist and remain visible after reload');
   assert.ok(await page.evaluate(()=>Object.keys(JSON.parse(
    localStorage.getItem('household-planner-sample-settings-v1')||'{}').repeatingRecommendations||{}).length>0),
    'A durable recommendation inventory is retained in planning settings');
   await page.locator('[data-ignored-repeating] > summary').click();
   await trackedRecommendation.locator('[data-unignore-recommendation]').click();
   assert.equal(await trackedRecommendation.getAttribute('data-recommendation-status'),'pending',
    'Undo ignore moves the suggestion back into the active queue');
   await trackedRecommendation.locator('[data-review-recommendation]').click();
   const recommendedDraft=page.locator('.history-schedule-form');
   assert.equal(await recommendedDraft.count(),1,'Yes opens prefilled editable schedule fields');
   assert.ok(await recommendedDraft.locator('[name=merchant]').inputValue());
   assert.ok(await recommendedDraft.locator('[name=frequency]').inputValue());
   assert.ok(Number(await recommendedDraft.locator('[name=amount]').inputValue())>0);
   assert.equal(await trackedRecommendation.locator('[data-review-inline-detail] .history-schedule-form').count(),1,
    'Ordinary suggested repeats expand within their own row');
   assert.equal(await page.locator('.reviews-page > .history-schedule-form').count(),0,
    'No detached review form appears above all rows');
   assert.equal(await recommendedDraft.locator('[name=category]').count(),1);
   await recommendedDraft.locator('[name=category]').selectOption('Insurance');
   await page.locator('[data-cancel-review-form]').click();

   }else{
    // Every recurring candidate in this fixture may already be an automatic
    // forecast; absence of optional extras is NOT a failure.
    assert.ok(expectedLegacy>0,'Active legacy streams are shown even if there are no other suggestions');
    await legacyRows.first().locator('[data-review-recommendation]').click();
    const draft=page.locator('.history-schedule-form');
    assert.equal(await draft.count(),1,'Specific automatic estimate opens an editable schedule proposal');
    assert.ok(await draft.locator('[name=merchant]').inputValue());
    assert.ok(Number(await draft.locator('[name=amount]').inputValue())>0);
    assert.equal(await legacyRows.first().locator('[data-review-inline-detail]').count(),1);
    assert.equal(await draft.locator('[name=category]').count(),1);
    await legacyRows.first().locator('.review-row-open').click();
    assert.equal(await legacyRows.first().locator('[data-review-inline-detail]').count(),0,
     'Tapping the same row again closes its unchanged inline review form');
   }
   await go('history');
   await go('history');
   assert.equal(await page.locator('.history-page > .page-heading').count(),0,
    'History uses selected tab as title without repeating it');
   assert.ok(await page.locator('.history-actual-row').count()>20,
    'All loaded bank records can be inspected individually');
   assert.equal(await page.locator('.history-row-open').count(),
    await page.locator('.history-actual-row').count(),
    'Every bank-history row has one explicit accessible primary button');
   assert.equal(await page.locator('.history-actual-row button button').count(),0,
    'History rows contain no nested interactive elements');
   const sort=page.locator('[data-history-sort]');
   assert.equal(await sort.count(),1,'Bank activity has one Sort by selector alongside Account and Find');
   assert.equal(await sort.inputValue(),'newest','Newest bank activity is the default');
   const bankColumns=async()=>page.locator('.history-actual-row').evaluateAll(els=>
    els.map(e=>({date:e.dataset.historySortDate,amount:Number(e.dataset.historySortAmount),
     merchant:e.querySelector('.history-actual-description strong')?.textContent||'',
     category:e.querySelector('.ledger-row-category')?.value||''})));
   let ordered=await bankColumns();
   assert.ok(ordered.length>20);
   assert.deepEqual(ordered.map(x=>x.date),
    [...ordered.map(x=>x.date)].sort().reverse(),
    'Default bank history sorts latest to earliest');
   await sort.selectOption('oldest');
   ordered=await bankColumns();
   assert.deepEqual(ordered.map(x=>x.date),
    [...ordered.map(x=>x.date)].sort(),
    'Oldest first sorts all bank records before applying the display limit');
   await sort.selectOption('amount-desc');
   ordered=await bankColumns();
   assert.deepEqual(ordered.map(x=>x.amount),
    [...ordered.map(x=>x.amount)].sort((a,b)=>b-a),
    'Bank amount high-to-low compares absolute transaction amounts');
   await sort.selectOption('amount-asc');
   ordered=await bankColumns();
   assert.deepEqual(ordered.map(x=>x.amount),
    [...ordered.map(x=>x.amount)].sort((a,b)=>a-b));
   await sort.selectOption('merchant');
   ordered=await bankColumns();
   assert.deepEqual(ordered.map(x=>x.merchant.toLocaleLowerCase()),
    [...ordered.map(x=>x.merchant.toLocaleLowerCase())].sort((a,b)=>a.localeCompare(b)),
    'Bank merchant sort follows displayed payee names');
   await sort.selectOption('category');
   ordered=await bankColumns();
   assert.deepEqual(ordered.map(x=>x.category),
    [...ordered.map(x=>x.category)].sort((a,b)=>a.localeCompare(b)),
    'Bank category sorting uses the current category overrides');
   await sort.selectOption('newest');
   await page.locator('[data-history-filter] [name=search]').fill('Safeway');
   await page.locator('[data-history-filter] button[type=submit]').click();
   assert.ok(await page.locator('.history-actual-row').count()>0,
    'Bank search remains available with Sort by');
   assert.ok((await bankColumns()).every(x=>x.merchant.toLowerCase().includes('safeway')));
   await page.locator('[data-history-sort]').selectOption('oldest');
   assert.equal(await page.locator('[data-history-filter] [name=search]').inputValue(),'Safeway',
    'Sort selection preserves active bank transaction search');
   await page.locator('[data-clear-history-search]').click();
   await page.locator('[data-history-sort]').selectOption('newest');
   const countStripGeometry=async(surface,row,count)=>page.evaluate(
    ({surface,row,count})=>{
     const panel=document.querySelector(surface),item=document.querySelector(row),
      strip=document.querySelector(count);
     if(!panel||!item||!strip)throw Error('Missing shared ledger count geometry');
     const box=panel.getBoundingClientRect(),r=item.getBoundingClientRect(),
      c=strip.getBoundingClientRect();
     return {stripY:c.top-box.top,stripX:c.left-box.left,
      stripHeight:c.height,firstRowY:r.top-box.top};
    },{surface,row,count});
   const bankListCount=await countStripGeometry(
    '.history-page .history-list-surface','.history-page .ledger-list-row',
    '.history-page .history-count.ledger-list-count');
   const bankListRow=await rowLayout(page,'.history-page .ledger-list-row');
   const fieldGeometry=async(selector)=>page.locator(selector).first().evaluate(el=>{
    const r=el.getBoundingClientRect();
    return {x:r.x,y:r.y+window.scrollY,width:r.width,height:r.height};
   });
   const bankToolbar=await fieldGeometry('.history-page .ledger-toolbar');
   const bankSearch=await fieldGeometry('.history-page .history-search-wrap input');
   const bankDollar=await fieldGeometry('.history-page .ledger-money-dollar');
   assert.equal(await page.locator('.history-page .ledger-money-dollar').count(),
    await page.locator('.history-page .history-actual-row').count(),
    'All Bank rows show their dollar symbol in the shared fixed amount slot');
   assert.equal(await page.locator('.history-page .ledger-row-category').count(),
    await page.locator('.history-actual-row').count(),
    'Every bank transaction has the same inline category selection affordance as Repeating');
   assert.equal(await page.locator('.history-page .history-row-category').count(),0,
    'Bank category no longer adds a separate stacked label or taller field');

   const safewayHistory=page.locator('.history-actual-row').filter({hasText:'Safeway'}).first();
   const safewayCategory=safewayHistory.locator('[data-history-category]');
   assert.equal(await safewayCategory.inputValue(),'Groceries');
   const safewayId=await safewayCategory.getAttribute('data-history-category');
   const bankCategoryBefore=await page.evaluate(id=>window.HouseholdLedgerData&&
    window.HouseholdLedgerData.migrate(window.createHouseholdLedgerDemo())
     .transactions.find(t=>String(t.id)===id)?.category,safewayId);
   await safewayCategory.selectOption('Shopping');
   assert.equal(await safewayHistory.locator('[data-history-category]').inputValue(),'Shopping',
    'Bank history lets the user categorize a single posted row in place');
   assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem(
    'household-planner-sample-settings-v1')||'{}').categoryOverrides?.[id],safewayId),'Shopping');
   await page.reload({waitUntil:'load'});await go('history');
   assert.equal(await page.locator('[data-history-category="'+safewayId+'"]').inputValue(),'Shopping',
    'Manual category override survives reload');
   assert.equal(await page.evaluate(id=>window.HouseholdLedgerData.migrate(
    window.createHouseholdLedgerDemo()).transactions.find(t=>String(t.id)===id)?.category,safewayId),
    bankCategoryBefore,'Classification overlay does not rewrite the underlying transaction');
   const demoHistoricalMortgage=page.locator('.history-actual-row').filter({hasText:'Mortgage'}).first();
   await demoHistoricalMortgage.locator('.history-row-open').click();
   const mortgageEntry=demoHistoricalMortgage.locator('xpath=..');
   assert.equal(await mortgageEntry.locator('.history-inline-detail .history-schedule-form').count(),1,
    'Bank activity opens its recurring editor directly under the selected bank row');
   assert.equal(await page.locator('.history-page .transaction-overlay').count(),0,
    'A repeating schedule from Bank activity does not open an extra dialog');
   assert.equal(await mortgageEntry.locator('.history-row-open').getAttribute('aria-expanded'),'true');
   assert.equal(await mortgageEntry.locator('.recurrence-editor [name=category]').count(),1,
    'Bank activity uses the same schedule editor category field as Needs review');
   assert.equal(await page.locator('.history-schedule-form [name=amount]').inputValue(),'2650',
    'History can propose future recurrence based on an actual bank record');
   await page.locator('[data-cancel-review-form]').click();
   assert.equal(await mortgageEntry.locator('.history-inline-detail').count(),0,
    'Cancel collapses Bank activity editor without changing the bank transaction');
   const historyTransfer=page.locator('.history-actual-row').filter({hasText:'Transfer to Savings'}).first();
   assert.equal(await historyTransfer.locator('[data-history-plan]').count(),0,
    'History opens from the row without redundant schedule buttons');
   await historyTransfer.click();
   const transferDraft=page.locator('.history-schedule-form');
   assert.equal(await transferDraft.locator('[name=type]').inputValue(),'expense',
    'An unmatched outgoing bank transfer is proposed as an expense, not blocked');
   assert.equal(await transferDraft.locator('[name=type] option[value=transfer]').count(),1,
    'Owner may instead mark a genuine linked household transfer');
   await transferDraft.locator('[name=type]').selectOption('transfer');
   assert.equal(await transferDraft.locator('[name=fromAccountId]').isVisible(),true,
    'Linked transfers require an explicit funding account');
   assert.equal(await transferDraft.locator('[name=toAccountId]').isVisible(),true,
    'Linked transfers require an explicit receiving account');
   await page.locator('[data-cancel-review-form]').click();
   await go('transactions');
   assert.ok(await page.locator('.future-item').filter({hasText:'Mortgage'}).count()>0,
    'One authoritative auto-detected mortgage appears in the future ledger');
   await page.reload({waitUntil:'load'});
   await go('transactions');
   assert.ok(await page.locator('.future-item').filter({hasText:'Mortgage'}).count()>0,
    'Refreshing does not erase bank-derived future predictions');
   await go('settings');
   const auditDetails=page.locator('#accuracy-audit');
   await page.locator('#planner-menu > summary').click();
   assert.equal(await page.locator('#audit-launch').isVisible(),true,
    'The one-click audit is available from More on Settings');
   await page.locator('#audit-launch').click();
   assert.ok(await auditDetails.getAttribute('open')!==null,'One click expands the audit results');
   assert.match(await auditDetails.innerText(),/Prediction accuracy/);
   assert.match(await auditDetails.innerText(),/historical check|Not enough complete historical months|Correct dated forecasts/i,
    'Historical audit is read-only and explains coverage');
   await auditDetails.locator('.audit-run-status').getByText(/Check 1 completed/).waitFor();
   assert.equal(await page.evaluate(()=>{window.__auditTestPage=document.querySelector('.settings-page .page-heading');return !!window.__auditTestPage}),true);
   await auditDetails.locator('[data-run-backtest]').click();
   await auditDetails.locator('.audit-run-status').getByText(/Check 2 completed/).waitFor();
   assert.match(await auditDetails.locator('.audit-run-status').innerText(),/Results unchanged/,
    'Repeated audit visibly completes even when the underlying history has not changed');
   assert.ok(await auditDetails.getAttribute('open')!==null,
    'Repeating from inside the audit leaves the result expanded');
   assert.equal(await page.evaluate(()=>window.__auditTestPage===document.querySelector('.settings-page .page-heading')),true,
    'Rerunning the audit does not redraw the surrounding settings page');
   assert.equal(await auditDetails.locator('[data-run-backtest]').innerText(),'Run check again');
   await go('overview');
   assert.match(await page.locator('.chart-caption').innerText(),/projection/i);
   assert.equal(await page.locator('#horizon').count(),0);
   assert.match(await page.locator('[aria-label="Projected balance curve"] .section-title').innerText(),/3 years|1095 days/);
   // Card-only calendar metrics are intentionally different from checking lows.
   await go('summary');
   const demoCardId=await page.locator('#summary-account option').filter({hasText:'Rewards Visa'}).getAttribute('value');
   assert.ok(demoCardId,'Demo has a selectable credit-card forecast');
   await page.locator('#summary-account').selectOption(demoCardId);
   assert.equal(await page.locator('[data-summary-month-low]').count(),0,
    'A selected credit card does not show the checking-account monthly low');
   assert.equal(await page.locator('[data-summary-card-statement]').count(),1);
   assert.match(await page.locator('[data-summary-card-statement] .summary-overline').innerText(),
    /^(Statement balance|Estimated statement)$/);
   assert.equal(await page.locator('[data-summary-card-next-statement] .summary-overline').innerText(),
    'Next statement estimate');
   assert.equal(await page.locator('[data-summary-next-statement-value]').count(),1);
   assert.equal(await page.locator('[data-summary-card-90day-low]').count(),0,
    'Credit cards no longer show the unrelated 3-month debt minimum');
   assert.equal(await page.locator('.summary-numbers > div').count(),3,
    'Credit-card summary keeps the same three-column layout as checking');
   // The following statement is a different billing cycle from the first
   // displayed statement. An arbitrary future low/debt must never substitute
   // for the next period's posted-and-scheduled statement estimate.
   const computedCard=await page.evaluate(()=>{
    const account={id:'fixture-card',name:'Fixture card',type:'credit',accountType:'credit',current:900};
    const markup=window.HouseholdPlannerSummary.render({
     snapshot:{asOf:'2026-10-19'},chosen:account,
     derived:{series:[
      {date:'2026-10-19',balance:900,events:[]},
      {date:'2026-11-18',balance:800,events:[]},
      {date:'2026-11-19',balance:700,events:[]},
      {date:'2027-01-17',balance:600,events:[]},
      {date:'2027-04-19',balance:20,events:[]}],events:[]},
     bundle:{rows:[],payments:{statements:[
      {cardId:'fixture-card',dueDate:'2026-11-19',withdrawalDate:'2026-11-19',
       confirmed:false,statementBalance:345},
      {cardId:'fixture-card',dueDate:'2026-12-19',withdrawalDate:'2026-12-19',
       confirmed:false,statementBalance:999,periodEnd:'2026-11-18',
       postedTransactions:[{id:'posted-a'},{id:'posted-refund'}],
       predictedTransactions:[{id:'future-a'}]}]}},
     days:200,prefs:{},accounts:[account],fresh:true,ready:()=>true
    });
    const doc=new DOMParser().parseFromString(markup,'text/html');
    return {label:doc.querySelector('[data-summary-card-statement] .summary-overline')?.textContent,
     statement:doc.querySelector('[data-summary-statement-value]')?.textContent,
     next:doc.querySelector('[data-summary-next-statement-value]')?.textContent,
     details:doc.querySelector('[data-summary-card-next-statement] [data-calendar-card-statement-date]')?.textContent,
     close:doc.querySelector('[data-summary-card-next-statement] [data-calendar-card-statement-date]')?.dataset.calendarCardStatementDate};
   });
   assert.deepEqual(computedCard,{label:'Estimated statement',statement:'$345.00',
    next:'$999.00',details:'Closes Nov 18, 2026 · 2 posted, 1 predicted →',close:'2026-11-18'},
    'Following period uses its own statement estimate, not current card debt or a future minimum');
   await page.locator('#summary-account').selectOption('demo-checking');
   assert.equal(await page.locator('[data-summary-month-low]').count(),1);
   assert.equal(await page.locator('[data-summary-card-statement]').count(),0,
    'Switching back restores the original checking-account monthly/three-year metrics');
   await go('overview');
   await page.locator('.account-tile').filter({hasText:'Rewards Visa'}).click();
   assert.match(await page.locator('.balance-main').innerText(),/\$810\.00/,'Credit card balance is shown as debt, not checking cash');
   assert.match(await page.locator('.hero-footnote').first().innerText(),/debt/);
   await go('transactions');
   await page.locator('#transaction-filter').selectOption('demo-checking');
   assert.ok(await page.locator('.future-item').count()>0,'All scheduled transactions are editable on separate page');
   const row=page.locator('.future-item').filter({hasText:'Mortgage'}).first();
   assert.ok(await row.count()>0,'Mortgage prediction is available in future transactions');
   const predictionKey=await row.getAttribute('data-future-item');
   await row.locator('[data-edit-future]').click();
   const editor=page.locator('.future-edit-form[data-future-edit-form]');
   const originalAmount=Number(await editor.locator('[name=amount]').inputValue());
   await editor.locator('[name=amount]').fill(String(originalAmount+75));
   await editor.locator('button[type=submit]').click();
   await page.locator('.future-notice').getByText(/updated/i).waitFor();
   assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}')
    .futureTransactionEdits?.[key]?.amount,predictionKey),originalAmount+75,
    'One-off prediction edits save without changing posted transactions');
   const afterFirst=page.locator('.future-item').filter({hasText:'Mortgage'}).first();
   assert.equal(await afterFirst.locator('[data-edit-series]').count(),0,
    'There is no redundant Edit all future button on recurring transactions');
   await afterFirst.locator('[data-edit-future]').click();
   const seriesForm=page.locator('.future-edit-form');
   assert.equal(await seriesForm.locator('input[name="scope"][value="all"]').count(),1,
    'The single Edit button offers an all-future option');
   assert.equal(await seriesForm.locator('input[name="scope"][value="one"]').isChecked(),true,
    'Edit initially selects this payment only');
   await seriesForm.locator('input[name="scope"][value="all"]').check();
   assert.equal(await seriesForm.locator('input[name="scope"][value="all"]').isChecked(),true,
    'The same editing form can apply updates to every future occurrence');
   const newAmount=originalAmount+125;
   await seriesForm.locator('[name=amount]').fill(String(newAmount));
   await seriesForm.locator('button[type=submit]').click();
   await page.locator('.future-notice').getByText(/recurring schedule/i).waitFor();
   assert.equal(await page.evaluate(amount=>Object.values(
    JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}').futureSeriesEdits||{}
   ).some(x=>x.amount===amount),newAmount),true,
    'Series edit is persisted and survives generation of next-month forecasts');
   const futureMortgageRows=page.locator('.future-item').filter({hasText:'Mortgage'});
   if(await futureMortgageRows.count()>1){
    const repeated=await futureMortgageRows.locator('.future-amount').allInnerTexts();
    assert.ok(repeated.every(t=>t.includes(newAmount.toLocaleString('en-US'))),
     'Visible mortgage months adopt the same new series amount');
   }
   await futureMortgageRows.first().locator('[data-edit-future]').click();
   assert.ok(await page.locator('[data-reset-series]').count(),'Entire repeating rule can be reset');
   await page.locator('[data-reset-series]').click();
   assert.equal(await page.evaluate(()=>Object.keys(
    JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}').futureSeriesEdits||{}
   ).length),0,'Reset all future restores automatic recurring forecasts');
   await page.locator('[data-show-new]').click();
   await page.locator('#future-new-form [name=merchant]').fill('One-time home repair');
   await page.locator('#future-new-form [name=amount]').fill('125');
   await page.locator('#future-new-form [name=date]').fill('2026-11-20');
   await page.locator('#future-new-form button[type=submit]').click();
   await page.getByText('One-time home repair').first().waitFor();
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}')
    .futureTransactionAdds?.some(t=>t.merchant==='One-time home repair')),true,
    'New per-account expense persists in demo without altering bank records');
   await page.reload({waitUntil:'load'});
   await go('transactions');
   assert.ok(await page.getByText('One-time home repair').count(),
    'New transaction is retained after browser reload');
   const unrecognized=page.locator('.future-item').filter({hasText:'One-time home repair'}).first();
   await unrecognized.locator('[data-edit-future]').click();
   const manualEditor=page.locator('.future-edit-form');
   assert.equal(await manualEditor.locator('input[name=scope][value=all]').count(),1,
    'Even a non-recurring manual transaction can be promoted to a recurring series');
   await manualEditor.locator('input[name=scope][value=all]').check();
   await manualEditor.locator('[data-frequency]').selectOption('monthly');
   await manualEditor.locator('button[type=submit]').click();
   await page.locator('.future-notice').getByText(/Recurring schedule/i).waitFor();
   assert.ok(await page.locator('.future-item').filter({hasText:'One-time home repair'}).count()>=2,
    'The confirmed recurring schedule generates multiple future payments');
   assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}')
    .futureRecurringRules?.some(x=>x.merchant==='One-time home repair'&&x.frequency==='monthly')),
    'Explicitly confirmed recurrence is saved, independent of detection');
   const recurringRepair=page.locator('.future-item').filter({hasText:'One-time home repair'}).first();
   await recurringRepair.locator('[data-edit-future]').click();
   assert.equal(await recurringRepair.locator('[data-inline-transaction-editor]').count(),1,
    'Confirmed recurring transactions use the same expandable payment row');
   await recurringRepair.locator('[data-remove-recurring]').click();
   assert.equal(await page.locator('.future-item').filter({hasText:'One-time home repair'}).count(),1,
    'Stopping recurrence returns to the original single user-added payment');
   await page.locator('[data-show-new]').click();
   await page.locator('#future-new-form [name=merchant]').fill('New monthly subscription');
   await page.locator('#future-new-form [name=amount]').fill('18');
   await page.locator('#future-new-form [name=date]').fill('2026-11-15');
   await page.locator('#future-new-form [data-frequency]').selectOption('monthly');
   await page.locator('#future-new-form button[type=submit]').click();
   assert.ok(await page.locator('.future-item').filter({hasText:'New monthly subscription'}).count()>=2,
    'Add transaction can create a recurring set without any historical examples');
   await page.locator('[data-show-new]').click();
   const everyFourForm=page.locator('#future-new-form');
   await everyFourForm.locator('[name=merchant]').fill('Every 4 weeks test payment');
   await everyFourForm.locator('[name=amount]').fill('55');
   await everyFourForm.locator('[name=date]').fill('2026-11-01');
   assert.equal(await everyFourForm.locator('option[value="every-4-weeks"]').innerText(),
    'Every 4 weeks (28 days)','Monthly and every 4 weeks have different scheduling choices');
   await everyFourForm.locator('[data-frequency]').selectOption('every-4-weeks');
   await everyFourForm.locator('button[type=submit]').click();
   const fourWeekRows=page.locator('.future-item').filter({hasText:'Every 4 weeks test payment'});
   assert.ok(await fourWeekRows.count()>=35,'Four-week plan reaches well into the third year');
   assert.deepEqual((await fourWeekRows.locator('.future-date').allInnerTexts()).slice(0,3),
    ['Nov 1','Nov 29','Dec 27'],
    'The actual future ledger moves forward 28 days per occurrence, rather than on calendar months');
   assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}')
    .futureRecurringRules?.some(x=>x.merchant==='Every 4 weeks test payment'&&x.frequency==='every-4-weeks')),
    'Every-four-weeks schedules persist as one confirmed recurrence');
   // Two separate four-week paychecks from the SAME employer, offset 14
   // days, must coexist. Editing or stopping one must never change the other.
   for(const [date,amount] of [['2026-11-06','3020'],['2026-11-20','3075']]){
    await page.locator('[data-show-new]').click();
    const payForm=page.locator('#future-new-form');
    await payForm.locator('[name=type]').selectOption('income');
    await payForm.locator('[name=merchant]').fill('Alternating Employer Paycheck');
    await payForm.locator('[name=date]').fill(date);
    await payForm.locator('[name=amount]').fill(amount);
    await payForm.locator('[name=frequency]').selectOption('every-4-weeks');
    await payForm.locator('button[type=submit]').click();
   }
   const payRows=page.locator('.future-item').filter({hasText:'Alternating Employer Paycheck'});
   assert.ok(await payRows.count()>70,'Independent payroll continues for the whole three-year forecast');
   assert.deepEqual((await payRows.locator('.future-date').allInnerTexts()).slice(0,6),
    ['Nov 6','Nov 20','Dec 4','Dec 18','Jan 1','Jan 15'],
    'Two four-week streams combine to provide one payday every 14 days');
   assert.deepEqual((await payRows.locator('.future-amount').allInnerTexts())
     .slice(0,6).map(x=>x.replace(/[^0-9.]/g,'')),['3020.00','3075.00','3020.00','3075.00','3020.00','3075.00'],
    'The two separate recurring deposits preserve their own amounts');
   assert.equal(await page.evaluate(()=>JSON.parse(
    localStorage.getItem('household-planner-sample-settings-v1')||'{}')
     .futureRecurringRules?.filter(x=>x.merchant==='Alternating Employer Paycheck').length),2,
    'Same employer creates exactly two independent saved rules');
   await payRows.first().locator('[data-edit-future]').click();
   const editPay=page.locator('.future-item').filter({hasText:'Alternating Employer Paycheck'}).first();
   assert.equal(await editPay.locator('.inline-plan-settings').count(),1,
    'Payroll plan settings are embedded in the expanded payment row');
   await editPay.locator('.inline-plan-settings > summary').click();
   await editPay.locator('[data-schedule-edit-form] [name=amount]').fill('3040');
   await editPay.locator('[data-schedule-edit-form] button[type=submit]').click();
   assert.match(await page.locator('.inline-save-result').first().innerText(),
    /Saved.*repeating plan/i);
   assert.deepEqual((await page.locator('.future-item').filter({hasText:'Alternating Employer Paycheck'})
     .locator('.future-amount').allInnerTexts()).slice(0,6).map(x=>x.replace(/[^0-9.]/g,'')),
    ['3040.00','3075.00','3040.00','3075.00','3040.00','3075.00'],
    'Editing one four-week schedule does not alter the alternate paycheck');
   await go('schedules');
   let salarySchedules=page.locator('[data-schedule-card]').filter({hasText:'Alternating Employer Paycheck'});
   assert.equal(await salarySchedules.count(),2);
   for(let i=0;i<2;i++){
    salarySchedules=page.locator('[data-schedule-card]').filter({hasText:'Alternating Employer Paycheck'});
    await salarySchedules.nth(i).locator('[data-schedule-quick-category]').selectOption('Income');
   }
   await page.locator('[data-schedule-sort]').selectOption('category');
   const incomeGroup=page.locator('[data-schedule-category-group="Income"]');
   assert.equal(await incomeGroup.locator('[data-schedule-card]').count(),2);
   let total=await incomeGroup.locator('[data-schedule-group-total]').innerText();
   assert.ok(total.includes('Nov 2026: In $6,115.00'),
    'November income must be the two actual dated deposits, not a prorated annual average');
   assert.doesNotMatch(total,/12-month|avg\/month|\/mo/,
    'Category header must not show an annual total or monthly average');
   await page.locator('[data-schedule-search]').fill('Nonexistent schedule');
   assert.equal(await incomeGroup.locator('[data-schedule-card]:visible').count(),0);
   await page.locator('[data-schedule-search]').fill('Alternating Employer Paycheck');
   total=await incomeGroup.locator('[data-schedule-group-total]').innerText();
   assert.equal(total,'Nov 2026: In $6,115.00',
    'Search restores the same exact next-month income without extra totals');
   await page.locator('[data-schedule-sort]').selectOption('order');
   await page.reload({waitUntil:'load'});
   await go('transactions');
   assert.ok(await page.locator('.future-item').filter({hasText:'Alternating Employer Paycheck'}).count()>70,
    'Both payroll recurrences persist across reload without double counting');
   await page.locator('[data-show-new]').click();
   const linkForm=page.locator('#future-new-form');
   await linkForm.locator('[name=merchant]').fill('Insurance payment estimate');
   await linkForm.locator('[data-frequency]').selectOption('monthly');
   await linkForm.locator('[data-history-link-search]').fill('State Farm');
   const postedInsurance=linkForm.locator('[data-history-example]').first();
   await postedInsurance.waitFor();
   assert.ok((await linkForm.locator('[data-history-link-results]').innerText()).includes('State Farm Insurance'),
    'Any recurring schedule can search Plaid history by bank merchant name');
   await postedInsurance.check();
   assert.match(await linkForm.locator('[data-history-link-results]').innerText(),/1 bank transaction linked/,
    'Owner can explicitly attach posted history even when the forecast payee name differs');
   await linkForm.locator('[data-history-link-search]').fill('Insurance');
   assert.equal(await linkForm.locator('[data-history-example]:checked').count(),1,
    'Linked history persists while trying different payee searches');
   await page.locator('[data-cancel-new]').click();
   await go('history');
   const explanation=await page.locator('.history-explanation').innerText();
   assert.match(explanation,/saved repeating plans take priority/i,
    'History explains that owner-confirmed plans supersede estimates');
   assert.match(explanation,/Bank activity stays here/i,
    'The UI promises bank source records are never deleted');
   assert.equal(await page.locator('[data-history-auto-prediction]').count(),0,
    'History no longer offers a competing automatic prediction system');
   const unscheduledHistory=page.locator('.history-actual-row[data-history-forecast-state="unplanned"]').first();
   assert.ok(await unscheduledHistory.count()>0,'Unplanned bank rows remain visible');
   assert.match(await unscheduledHistory.innerText(),/Not scheduled/);
   assert.equal(await unscheduledHistory.locator('.history-row-open .history-row-hint').innerText(),'›',
    'Bank activity uses the shared chevron-only review affordance');
   const insuranceHistory=page.locator('.history-actual-row').filter({hasText:'State Farm Insurance'}).first();
   assert.equal(await insuranceHistory.getAttribute('data-history-forecast-state'),'automatic');
   assert.equal(await insuranceHistory.locator('.history-row-open .history-row-hint').innerText(),'›');
   await insuranceHistory.locator('.history-row-open').click();
   assert.equal(await insuranceHistory.locator('xpath=..').locator('.history-inline-detail').count(),1);
   await page.locator('.history-schedule-form [name=frequency]').selectOption('monthly');
   await page.locator('.history-schedule-form button[type=submit]').click();
   assert.ok(await page.evaluate(()=>JSON.parse(
    localStorage.getItem('household-planner-sample-settings-v1')||'{}')
    .futureRecurringRules?.some(r=>r.merchant==='State Farm Insurance')),
    'Confirm repeating creates one explicitly saved repeating plan');
   await go('history');
   const savedInsurance=page.locator('.history-actual-row').filter({hasText:'State Farm Insurance'}).first();
   assert.equal(await savedInsurance.getAttribute('data-history-forecast-state'),'confirmed');
   assert.equal(await savedInsurance.locator('.history-row-open .history-row-hint').innerText(),'›',
    'Confirmed bank payment opens in place with the same chevron');
   assert.equal(await savedInsurance.locator('[data-history-auto-prediction]').count(),0,
    'Saved repeating plans no longer have the misleading exclusion toggle');
   await savedInsurance.locator('.history-row-open').click();
   const inlineConfirmed=savedInsurance.locator('xpath=..').locator('[data-schedule-edit-form]');
   assert.equal(await inlineConfirmed.count(),1,
    'Confirmed payments edit their existing saved schedule directly under the bank row');
   assert.equal(await inlineConfirmed.locator('[name=category]').count(),1);
   assert.equal(await page.locator('.history-page .transaction-overlay').count(),0);
   await savedInsurance.locator('xpath=..').locator('[data-history-inline-close]').click();
   await go('transactions');
   assert.ok(await page.locator('.future-item').filter({hasText:'State Farm Insurance'}).count()>=1,
    'Confirmed recurring insurance remains in the canonical future ledger');
   const inferredMortgage=page.locator('.future-item').filter({hasText:'Mortgage'}).first();
   assert.ok(await inferredMortgage.count()>0);
   await inferredMortgage.locator('[data-edit-future]').click();
   await page.locator('.future-edit-form [data-remove-recurring]').click();
   assert.equal(await page.locator('.future-item').filter({hasText:'Mortgage'}).count(),0,
    'Existing inferred recurrence removal still works in the prediction editor');
   await go('settings');
   const rejected=page.locator('[aria-label="Automatic prediction exclusions"]');
   assert.match(await rejected.innerText(),/Mortgage/,'Exclusion is recorded and reversible');
   await rejected.locator('.future-skip-line').filter({hasText:'Mortgage'})
    .locator('[data-restore-recurrence]').first().click();
   await go('transactions');
   assert.ok(await page.locator('.future-item').filter({hasText:'Mortgage'}).count()>=2,
    'Restoring eligibility regenerates the original inferred mortgage without a manual schedule');
   await go('history');
   const mortgageHistory=page.locator('.history-actual-row').filter({hasText:'Mortgage'}).first();
   assert.equal(await mortgageHistory.getAttribute('data-history-forecast-state'),'automatic');
   assert.equal(await mortgageHistory.locator('[data-history-auto-prediction]').count(),0);
   await go('reviews');
   const gate=page.locator('[data-activate-saved-schedules]');
   assert.equal(await gate.count(),1,'One deliberate switch controls the forecast migration');
   assert.equal(await gate.isDisabled(),true,
    'Unreviewed existing automatic mortgage and bill estimates block cutover');
   assert.ok(await page.locator('[data-recommended-repeat][data-legacy-active="true"]').count()>0,
    'Every currently forecasted unsaved stream stays visible for review');
   // The calendar is the everyday planning editor, without navigating
   // to Predictions or inventing any separate account-balance calculation.
   await go('summary');
   const checkingOption=page.locator('#summary-account option').filter({hasText:'Checking'}).first();
   await page.locator('#summary-account').selectOption(await checkingOption.getAttribute('value'));
   await page.locator('[data-calendar-nav="1"]').click();
   await page.locator('[data-calendar-day="2026-11-09"]').click();
   assert.equal(await page.locator('[data-calendar-reconciliation]').count(),0,
    'No opening-balance equation is needed before a forecast payment is added');
   assert.equal(await page.locator('.calendar-day-ending').count(),1);
   await page.locator('[data-calendar-add]').click();
   const quick=page.locator('[data-calendar-quick-form]');
   assert.equal(await quick.locator('[name=date]').inputValue(),'2026-11-09');
   await quick.locator('[name=merchant]').fill('Playground one-time expense');
   await quick.locator('[name=amount]').fill('25');
   await quick.locator('button[type=submit]').click();
   await page.locator('.calendar-day-transactions .calendar-detail-item').filter({hasText:'Playground one-time expense'}).waitFor();
   assert.match(await page.locator('.calendar-day-opening').innerText(),/Yesterday/);
   assert.equal(await page.locator('.calendar-day-opening strong').count(),1);
   assert.equal(await page.locator('.calendar-day-transactions .calendar-monthly-row > strong').count(),1,
    'The expense is shown once, with its name and editable amount in one row');
   assert.match(await page.locator('.calendar-day-transactions .calendar-monthly-row > strong').innerText(),
    /−\$25\.00/,'The transaction list itself supplies the debit needed to explain the daily total');
   assert.equal(await page.locator('.calendar-math').count(),0,
    'No additional withdrawals/deposits subtotal repeats the selected transaction amount');
   assert.equal(await page.locator('.calendar-day-detail > :last-child').getAttribute('class'),
    'calendar-math-total calendar-day-ending',
    'Single ending balance remains at bottom after adding a transaction');
   assert.ok(await page.locator('.calendar-notice').innerText().then(x=>x.includes('recalculated')));
   const playground=page.locator('.calendar-day-transactions .calendar-detail-item').filter({hasText:'Playground one-time expense'});
   await playground.click();
   const universal=page.locator('.calendar-detail-entry [data-inline-transaction-editor] .future-edit-form');
   assert.equal(await page.locator('.transaction-detail').count(),0,
    'Calendar day edits are inline and do not open a modal');
   assert.equal(await universal.locator('[name=amount]').inputValue(),'25',
    'Editable amount is directly beneath the clicked calendar date row');
   await universal.locator('[name=amount]').fill('40');
   await universal.locator('button[type=submit]').click();
   assert.match(await page.locator('.calendar-day-transactions .calendar-detail-item')
    .filter({hasText:'Playground one-time expense'}).innerText(),/\$40\.00/);
   await page.reload({waitUntil:'load'});
   assert.equal(await page.locator('[data-calendar-first-tip]').count(),0,
    'Dismissed first-use guidance stays dismissed after a reload');
   await page.locator('[data-calendar-nav="1"]').click();
   await page.locator('[data-calendar-day="2026-11-09"]').click();
   assert.match(await page.locator('.calendar-day-transactions .calendar-detail-item')
    .filter({hasText:'Playground one-time expense'}).innerText(),/\$40\.00/,
    'Calendar-only edits persist across reload');
   await page.locator('.calendar-day-transactions .calendar-detail-item')
    .filter({hasText:'Playground one-time expense'}).click();
   assert.ok(await page.locator('.calendar-detail-entry [data-remove-added]').count()>0,
    'An individually added payment can be removed from the expanded row');
   await page.locator('.calendar-detail-entry [data-remove-added]').click();
   assert.equal(await page.locator('.calendar-day-transactions .calendar-detail-item')
    .filter({hasText:'Playground one-time expense'}).count(),0,
    'Skipping a selected occurrence removes it from the same balance forecast');
   await page.locator('[data-calendar-day="2026-11-11"]').click();
   await page.locator('[data-calendar-add]').click();
   await quick.locator('[name=merchant]').fill('Playground recurring payment');
   await quick.locator('[name=amount]').fill('90');
   await quick.locator('[name=frequency]').selectOption('monthly');
   await quick.locator('button[type=submit]').click();
   await page.locator('.calendar-day-transactions .calendar-detail-item')
    .filter({hasText:'Playground recurring payment'}).waitFor();
   await page.locator('[data-calendar-nav="1"]').click();
   await page.locator('[data-calendar-day="2026-12-11"]').click();
   assert.ok(await page.locator('.calendar-day-transactions .calendar-detail-item')
    .filter({hasText:'Playground recurring payment'}).count()>0,
    'Creating a recurring expense from one calendar date creates its next month too');


   // Same merchant/date: separately saved streams and editable inline rows.
   await go('schedules');
   assert.match(await page.locator('[data-schedule-new]').innerText(),/Repeating payment/,
    'Compact Add repeating button is visible within the search/sort toolbar');
   assert.equal(await page.locator('.schedule-page .ledger-toolbar [data-schedule-new]').count(),1,
    'Add repeating occupies a reserved toolbar slot, not an extra top row');
   assert.equal(await page.locator('.schedule-page .page-actions').count(),0,
    'Repeating no longer reserves a separate full-height Add action row');
   assert.match(await page.locator('.schedule-page .page-task-hint').innerText(),/upcoming date/,
    'The Repeating screen explains how to edit one occurrence or the whole schedule');
   const previousSchedules=await page.locator('[data-schedule-card]').count();
   const repeatingListRow=await rowLayout(page,'.schedule-page .ledger-list-row');
   const repeatingCount=page.locator('[data-schedule-visible-count]');
   assert.equal(await repeatingCount.count(),1,
    'Repeating has one count strip in the same list position as Bank activity');
   assert.equal(await repeatingCount.getAttribute('data-schedule-total-count'),
    String(previousSchedules));
   assert.equal((await repeatingCount.innerText()).trim(),
    'Showing '+previousSchedules+' of '+previousSchedules+' repeating transactions');
   const repeatingListCount=await countStripGeometry(
    '.schedule-page .schedule-grid','.schedule-page .ledger-list-row',
    '.schedule-page .schedule-list-count');
   for(const metric of ['stripY','stripX','stripHeight','firstRowY']){
    assert.ok(Math.abs(repeatingListCount[metric]-bankListCount[metric])<=2,
     'Repeating count and first payment row match Bank activity vertical spacing: '+metric+
      JSON.stringify({bank:bankListCount,repeating:repeatingListCount,mobile}));
   }
   const repeatingToolbar=await fieldGeometry('.schedule-page .ledger-toolbar');
   const repeatingSearch=await fieldGeometry('.schedule-page .schedule-search-wrap input');
   const repeatingDollar=await fieldGeometry('.schedule-page .ledger-money-dollar');
   assert.equal(await page.locator('.schedule-page .ledger-money-dollar').count(),
    await page.locator('.schedule-page .schedule-card').count(),
    'All Repeating rows use the same anchored dollar symbol slot');
   for(const metric of ['x','y','width','height']){
    assert.ok(Math.abs(repeatingToolbar[metric]-bankToolbar[metric])<=2,
     'Both search toolbars match exact document '+metric+' with no extra Repeating button row: '+
      JSON.stringify({bank:bankToolbar,repeating:repeatingToolbar,mobile}));
    assert.ok(Math.abs(repeatingSearch[metric]-bankSearch[metric])<=2,
     'Search boxes match exact document '+metric+' between both pages: '+
      JSON.stringify({bank:bankSearch,repeating:repeatingSearch,mobile}));
   }
   assert.ok(Math.abs(repeatingDollar.x-bankDollar.x)<=1,
    'The literal $ glyph (not merely the amount column) aligns between pages: '+
     JSON.stringify({bank:bankDollar,repeating:repeatingDollar,mobile}));
   assert.ok(Math.abs(repeatingDollar.width-bankDollar.width)<=1,
    'Both amount glyphs use identical physical widths');
   assert.equal(await page.locator('.schedule-page .ledger-row-category').count(),
    await page.locator('[data-schedule-card]').count(),
    'Every Repeating row uses the same visible inline category control');
   assert.deepEqual(repeatingListRow.categoryStyle,bankListRow.categoryStyle,
    'Category dropdowns have identical visual styles across Bank activity and Repeating');
   assert.deepEqual(repeatingListRow.titleStyle,bankListRow.titleStyle,
    'Payment names have identical typography across Bank activity and Repeating');
   assert.ok(Math.abs(repeatingListRow.left-bankListRow.left)<=2,
    'The Bank activity and Repeating lists start at the same horizontal position');
   assert.ok(Math.abs(repeatingListRow.width-bankListRow.width)<=2,
    'The Bank activity and Repeating rows occupy the same available width');
   for(const field of ['date','description','amount','category']){
    assert.ok(Math.abs(repeatingListRow[field].x-bankListRow[field].x)<=2,
     field+' aligns relative to the row across Repeating and Bank activity');
    assert.ok(Math.abs(repeatingListRow[field].pageX-bankListRow[field].pageX)<=2,
     field+' stays aligned at the same viewport x-coordinate when switching tabs: '+
      JSON.stringify({bank:bankListRow,repeating:repeatingListRow}));
   }
   assert.ok(Math.abs(
    repeatingListRow.hint.x+repeatingListRow.hint.width-
    bankListRow.hint.x-bankListRow.hint.width)<=2,
    'Both variable-length action hints align at their right edge');
   assert.ok(Math.abs(repeatingListRow.height-bankListRow.height)<=3,
    'Both tabs use the same compact row height, including on iPhone: '+
     JSON.stringify({mobile,bank:bankListRow,repeating:repeatingListRow}));

   assert.equal(await page.locator('[data-schedule-sort]').count(),1);
   assert.equal(await page.locator('[data-schedule-category-filter]').count(),1);
   const values=async()=>page.locator('.schedule-row-amount strong').evaluateAll(nodes=>
    nodes.map(node=>Number((node.textContent||'').replace(/[^0-9.]/g,''))));
   await page.locator('[data-schedule-sort]').selectOption('value-desc');
   let amounts=await values();
   assert.deepEqual(amounts,[...amounts].sort((a,b)=>b-a),
    'Amount sorting follows the value displayed on the schedule row');
   await page.locator('[data-schedule-sort]').selectOption('value-asc');
   amounts=await values();
   assert.deepEqual(amounts,[...amounts].sort((a,b)=>a-b));
   await page.locator('[data-schedule-sort]').selectOption('order');
   await page.locator('[data-schedule-category-manager] > summary').click();
   const categories=page.locator('[data-schedule-category-add]');
   await categories.locator('[name=categoryName]').fill('Water bills');
   await categories.locator('button[type=submit]').click();
   assert.match(await page.locator('[data-schedule-category-notice]').innerText(),/Added Water bills/);
   assert.equal(await page.locator('[data-schedule-category-filter] option[value="Water bills"]').count(),1,
    'Custom categories appear immediately without reload');
   assert.equal(await page.locator('.schedule-heading,.schedule-metrics,.schedule-actions').count(),0,
    'Collapsed schedules do not use three stacked rows of repeated details and buttons');
   if(previousSchedules>0){
    const rows=await page.locator('.schedule-compact-row').evaluateAll(els=>els.map(e=>{
     const rect=e.getBoundingClientRect();return {height:rect.height,left:rect.left};
    }));
    assert.ok(rows.every(row=>row.height<=(mobile?106:70)),
     'Schedule rows match the responsive Bank activity height without creating tall cards');
    assert.ok(rows.every(row=>Math.abs(row.left-rows[0].left)<2),
     'Schedules are presented as one scannable list instead of side-by-side cards');
    assert.equal(await page.locator('.schedule-row-main[aria-expanded="false"]').count(),previousSchedules,
     'All untouched schedule rows start collapsed');
    assert.equal(await page.locator('.schedule-more:not([open])').count(),previousSchedules,
     'Rare actions start hidden behind their own menu');
   }
   if(previousSchedules>0){
    assert.equal(await page.locator('.schedule-card .schedule-edit-label').count(),0,
     'Repeating rows no longer show redundant Edit or Close text');
    assert.equal(await page.locator('.schedule-card .schedule-row-chevron').count(),previousSchedules,
     'Every Repeating row keeps its chevron as the only disclosure affordance');
    assert.equal(await page.locator('.schedule-card .schedule-row-chevron').first().innerText(),'›');
   }
   assert.equal(await page.locator('.schedule-discovery,[data-schedule-from-actual]').count(),0,
    'Same-merchant charges no longer create an independent heuristic panel or extra-schedule prompts');
   const beforeNumbers=await page.locator('[data-schedule-card]').evaluateAll(cards=>
    cards.map(card=>({
      number:Number(card.dataset.scheduleNumber),
      label:card.querySelector('.schedule-number')?.textContent?.trim()
    })));
   assert.deepEqual(beforeNumbers,beforeNumbers.map((_,i)=>({number:i+1,label:String(i+1)})),
    'Every existing schedule is labeled 1 through N in saved list order');
   await page.locator('[data-schedule-new]').click();
   let schedule=page.locator('[data-schedule-new-form]');
   assert.equal(await page.locator('.schedule-creation .recurrence-editor .schedule-form').count(),1,
    'Repeating creates forecasts using the same shared inline editor as Needs review');
   assert.equal(await page.locator('.transaction-detail').count(),0,
    'Schedule creation does not open a separate popup editor');
   await schedule.locator('[name=scheduleLabel]').fill('Water - House');
   await schedule.locator('[name=category]').selectOption('Water bills');
   await schedule.locator('[name=merchant]').fill('Same Merchant Water');
   await schedule.locator('[name=amount]').fill('135');
   await schedule.locator('[name=date]').fill('2026-11-10');
   await schedule.locator('button[type=submit]').click();
   assert.equal(await page.locator('[data-schedule-card]').count(),previousSchedules+1);
   assert.equal(await page.locator('[data-schedule-card]').last().getAttribute('data-schedule-number'),
    String(previousSchedules+1),'A new independent schedule receives the next number');
   assert.equal(await page.locator('[data-schedule-card]').last().locator('.schedule-number').innerText(),
    String(previousSchedules+1));
   let water=page.locator('[data-schedule-card]').filter({hasText:'Water - House'}).first();
   assert.equal(await water.locator('[data-schedule-quick-category]').inputValue(),'Water bills');
   await water.locator('[data-schedule-quick-category]').selectOption('Insurance');
   water=page.locator('[data-schedule-card]').filter({hasText:'Water - House'}).first();
   assert.equal(await water.locator('[data-schedule-quick-category]').inputValue(),'Insurance',
    'Category changes with one row-level picker, without the schedule editor');
   await page.reload({waitUntil:'load'});
   await go('schedules');
   water=page.locator('[data-schedule-card]').filter({hasText:'Water - House'}).first();
   assert.equal(await water.locator('[data-schedule-quick-category]').inputValue(),'Insurance',
    'Quick category assignment persists after reload');
   await water.locator('[data-schedule-quick-category]').selectOption('Water bills');
   water=page.locator('[data-schedule-card]').filter({hasText:'Water - House'}).first();
   if(!await water.locator('[data-schedule-inline-plan]').count())
    await water.locator('[data-schedule-edit]').click();
   assert.ok(await water.locator('[data-schedule-inline-plan]').count(),
    'Schedule settings and upcoming payments expand inside their own schedule');
   await water.locator('.schedule-more > summary').click();
   assert.equal(await water.locator('[data-schedule-duplicate]').count(),0,
    'Redundant Separate bill action is removed');
   await page.locator('[data-schedule-new]').click();
   schedule=page.locator('[data-schedule-new-form]');
   assert.equal(await schedule.locator('[name=separateSchedule]').inputValue(),'on',
    'New schedule always creates an independent recurring stream');
   await schedule.locator('[name=scheduleLabel]').fill('Water - Garden');
   await schedule.locator('[name=merchant]').fill('Same Merchant Water');
   await schedule.locator('[name=category]').selectOption('Water bills');
   await schedule.locator('[name=amount]').fill('220');
   await schedule.locator('[name=date]').fill('2026-11-10');
   await schedule.locator('button[type=submit]').click();
   assert.equal(await page.locator('[data-schedule-card]').count(),previousSchedules+2,
    'Separate same-merchant bills never merge');
   assert.deepEqual(await page.locator('[data-schedule-card]').evaluateAll(cards=>
    cards.map(card=>Number(card.dataset.scheduleNumber))),
    Array.from({length:previousSchedules+2},(_,i)=>i+1),
    'Distinct same-merchant schedules keep separate consecutive numbers');
   assert.equal(await page.locator('.schedule-discovery').count(),0,
    'Removing merchant discovery does not remove or merge separately saved bills');
   // Rare actions remain accessible without consuming full rows.
   water=page.locator('[data-schedule-card]').filter({hasText:'Water - House'}).first();
   await water.locator('.schedule-more > summary').click();
   await water.locator('[data-schedule-remove]').click();
   water=page.locator('[data-schedule-card]').filter({hasText:'Water - House'}).first();
   assert.equal(await water.locator('.schedule-more[open] [data-schedule-remove]').innerText(),
    'Confirm remove','Deletion stays a two-step action inside the compact menu');
   await water.locator('[data-schedule-cancel-remove]').click();
   assert.equal(await page.locator('[data-schedule-card]').count(),previousSchedules+2,
    'Canceling removal leaves both independent schedules intact');
   await page.locator('[data-schedule-sort]').selectOption('category');
   await page.locator('[data-schedule-category-filter]').selectOption('Water bills');
   assert.equal(await page.locator('[data-schedule-card]').count(),2,
    'Category filter shows only the two assigned schedules');
   assert.equal((await page.locator('[data-schedule-visible-count]').innerText()).trim(),
    'Showing 2 of '+(previousSchedules+2)+' repeating transactions',
    'Repeating count reflects selected categories without losing total schedules');
   const group=page.locator('[data-schedule-category-group="Water bills"]');
   assert.equal(await group.count(),1);
   assert.match(await group.locator('.schedule-category-heading').innerText(),/[A-Z][a-z]{2} \d{4}: Out /,
    'Category grouping shows exact next-calendar-month withdrawals');
   assert.match(await group.locator('.schedule-category-heading').innerText(),/355/,
    'Category total includes both independently forecast monthly bills');
   assert.deepEqual(await group.locator('[data-schedule-quick-category]').evaluateAll(rows=>
    rows.map(row=>row.value)),['Water bills','Water bills'],
    'Every grouped row carries its saved category as directly editable data');
   await page.locator('[data-schedule-search]').fill('Garden');
   assert.equal(await page.locator('[data-schedule-card]:visible').count(),1,
    'Search filters instantly without navigating or reopening editors');
   assert.equal((await page.locator('[data-schedule-visible-count]').innerText()).trim(),
    'Showing 1 of '+(previousSchedules+2)+' repeating transactions',
    'Live searching updates the visible recurring count without rerendering');
   assert.match(await group.locator('[data-schedule-group-total]').innerText(),/220/,
    'Visible category totals reflect only matching scheduled predictions');
   await page.locator('[data-schedule-search]').fill('');
   assert.equal(await page.locator('[data-schedule-card]:visible').count(),2);
   assert.match(await group.locator('[data-schedule-group-total]').innerText(),/355/,
    'Clearing search restores all category totals');
   assert.doesNotMatch(await group.locator('[data-schedule-group-total]').innerText(),/12-month|avg\/month|\/mo/,
    'Search does not reintroduce annual totals or averages');
   await page.locator('[data-schedule-search]').fill('Nothing matches');
   assert.equal(await page.locator('[data-schedule-card]:visible').count(),0);
   assert.match(await page.locator('[data-schedule-visible-count]').innerText(),
    /^Showing 0 of \d+ repeating transactions$/,
    'Zero-result search keeps the count visible and explicit');
   assert.equal(await page.locator('[data-schedule-search-empty]:visible').count(),1);
   await page.locator('[data-schedule-search]').fill('');
   await page.locator('[data-schedule-category-filter]').selectOption('');
   await page.locator('[data-schedule-sort]').selectOption('order');
   assert.equal(await page.locator('[data-schedule-card]').count(),previousSchedules+2,
    'Clearing the filter restores all schedule actions');


   water=page.locator('[data-schedule-card]').filter({hasText:'Water - House'}).first();
   if(!await water.locator('[data-schedule-inline-plan]').count())
    await water.locator('[data-schedule-edit]').click();
   assert.equal(await water.locator('.schedule-inline-plan .recurrence-editor [name=category]').count(),1,
    'Repeating edits have the identical shared Category field and form hierarchy');
   await water.locator('.schedule-occurrence-disclosure > summary').click();
   assert.equal(await water.locator('[data-plan-estimates]').count(),0,
    'There is no separate option to batch-edit an arbitrary set of dates');
   assert.equal(await water.locator('[data-schedule-estimate-form]').count(),0,
    'Range amount forms are removed');
   // Set a specific December amount by expanding its own payment row.
   await water.locator('[data-schedule-occurrence-key]').filter({hasText:'Dec 10'}).first().click();
   let decemberEdit=water.locator('[data-inline-transaction-editor] .future-edit-form');
   assert.equal(await decemberEdit.locator('[name=scope][value=one]').isChecked(),true);
   await decemberEdit.locator('[name=amount]').fill('175');
   await decemberEdit.locator('button[type=submit]').click();
   water=page.locator('[data-schedule-card]').filter({hasText:'Water - House'}).first();
   await water.locator('.schedule-occurrence-disclosure > summary').click();
   assert.match(await water.locator('[data-schedule-occurrence-key]').filter({hasText:'Dec 10'}).first().innerText(),/175/,
    'An individual December estimate is set directly on December, without a date range');
   assert.ok(await water.locator('[data-schedule-inline-plan]').count(),
    'The repeating schedule stays expanded after changing one date');
   const november=water.locator('[data-schedule-occurrence-key]').filter({hasText:'Nov 10'}).first();
   assert.equal(await november.count(),1,'November payment is visible directly in its plan');
   await november.click();
   const onePayment=water.locator('[data-inline-transaction-editor] .future-edit-form');
   assert.equal(await onePayment.locator('[name=scope][value=one]').isChecked(),true,
    'One-date edit is the default');
   assert.equal(await onePayment.locator('[name=scope][value=all]').count(),1,
    'All future payments can also be edited using the same fields');
   await onePayment.locator('[name=amount]').fill('147');
   await onePayment.locator('button[type=submit]').click();
   water=page.locator('[data-schedule-card]').filter({hasText:'Water - House'}).first();
   await water.locator('.schedule-occurrence-disclosure > summary').click();
   assert.match(await water.locator('[data-schedule-occurrence-key]')
    .filter({hasText:'Nov 10'}).first().innerText(),/147/);
   assert.match(await water.locator('[data-schedule-occurrence-key]')
    .filter({hasText:'Dec 10'}).first().innerText(),/175/,
    'December keeps its independent one-date override');
   await water.locator('[data-schedule-occurrence-key]').filter({hasText:'Dec 10'}).first().click();
   assert.equal(await water.locator('[data-inline-transaction-editor]').count(),1,
    'Clicking December expands editing immediately underneath its own row');
   await water.locator('[data-cancel-future]').click();
   assert.equal(await water.locator('[data-inline-transaction-editor]').count(),0);
   assert.equal(await page.locator('.transaction-detail').count(),0);
   await water.locator('[data-schedule-edit]').click();

   await go('summary');
   await page.locator('[data-calendar-today]').click();
   await page.locator('[data-calendar-nav="1"]').click();
   await page.locator('[data-calendar-day="2026-11-10"]').click();
   assert.ok(await page.locator('.calendar-day-transactions .selected-date').count()>0,
    'Selecting the day shows only its scheduled payments directly below the balance');
   assert.ok(await page.locator('.calendar-day-transactions .calendar-detail-item').filter({hasText:'Water - House'}).count()>0);
   assert.ok(await page.locator('.calendar-day-transactions .calendar-detail-item').filter({hasText:'Water - Garden'}).count()>0);
   await page.locator('[data-calendar-nav="1"]').click();
   await page.locator('[data-calendar-day="2026-12-10"]').click();
   assert.match(await page.locator('.calendar-day-transactions .calendar-detail-item')
    .filter({hasText:'Water - House'}).innerText(),/175/);
   assert.match(await page.locator('.calendar-day-transactions .calendar-detail-item')
    .filter({hasText:'Water - Garden'}).innerText(),/220/);
   await page.locator('.calendar-day-transactions .calendar-detail-item').filter({hasText:'Water - House'}).click();
   const inlineWater=page.locator('.calendar-monthly-entry').filter({hasText:'Water - House'}).first();
   assert.equal(await page.locator('.transaction-detail').count(),0,
    'Calendar and Schedules use inline fields without another modal');
   assert.equal(await inlineWater.locator('.future-edit-form').count(),1);
   assert.equal(await inlineWater.locator('.future-edit-form [name=scope][value=all]').count(),1,
    'The same payment fields may apply to later recurring payments');
   await inlineWater.locator('[data-cancel-future]').click();
   assert.equal(await inlineWater.locator('[data-inline-transaction-editor]').count(),0);
   assert.equal(await page.locator('.summary-page').count(),1);
   assert.equal(await page.locator('.calendar-detail-items').count(),0,
    'Only one calendar transaction list is displayed');

      assert.equal(await page.locator('button[data-page=budgets]').count(),0,'No old spending tabs');
   assert.equal(await page.locator('main .budget-entry').count(),0,'No category budget UI');
   // The existing forecast is preserved until all active unsaved streams
   // are reviewed. Ignored recommendations remain visible after migration.
   await go('reviews');
   const switchMode=page.locator('[data-activate-saved-schedules]');
   assert.equal(await switchMode.count(),1);
   const activePending=page.locator(
    '[data-recommended-repeat][data-legacy-active="true"][data-recommendation-status="pending"]');
   let reviewed=0;
   while(await activePending.count()){
    if(reviewed++>90)throw Error('Migration inventory kept changing during review');
    const row=activePending.first(),key=await row.getAttribute('data-recommended-repeat');
    await row.locator('[data-ignore-recommendation]').click();
    await page.waitForFunction(k=>Array.from(document.querySelectorAll('[data-recommended-repeat]'))
     .some(e=>e.dataset.recommendedRepeat===k&&e.dataset.recommendationStatus==='ignored'),key);
   }
   assert.equal(await switchMode.isDisabled(),false,
    'Cutover becomes available only after every unsaved legacy stream has a decision');
   await switchMode.click();
   assert.equal(await page.locator('[data-activate-saved-schedules]').count(),0);
   assert.equal(await page.locator('[data-activate-saved-schedules]').count(),0,
    'Successful migration removes the cutover control without adding duplicate settings');
   const storedMode=()=>page.evaluate(()=>JSON.parse(
    localStorage.getItem('household-planner-sample-settings-v1')||'{}').recurringForecastMode);
   assert.equal(await storedMode(),'approved-only',
    'Cutover is explicitly persisted with forecast preferences');
   await page.reload({waitUntil:'load'});
   assert.equal(await storedMode(),'approved-only',
    'Saved-schedules-only mode survives reload');
   await go('reviews');
   assert.ok(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem(
    'household-planner-sample-settings-v1')||'{}').repeatingRecommendations||{}).length>0),
    'Cutover preserves recommendation history even when obsolete non-recurring purchases are filtered from view');
   assert.deepEqual(errors,[],'No JavaScript exceptions on public Demo');
   if(mobile){
    const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,window:innerWidth}));
    assert.ok(sizes.scroll<=sizes.window+2,'Mobile planner does not overflow: '+JSON.stringify(sizes));
   }
   // Isolated fictional card data: closing-date grouping, refunds, pending
   // charges and future repeating occurrences in both browser engines.
   const statementCtx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900}});
   await statementCtx.addInitScript(fixedDate);
   await statementCtx.addInitScript(()=>{
    localStorage.setItem('household-planner-sample-settings-v1',JSON.stringify({
     recurringForecastMode:'approved-only',
     paymentRules:{'demo-visa':{
      billingStartDate:'2026-10-01',billingEndDate:'2026-10-31',closingDay:31,
      lastStatementClose:'2026-10-31',nextPaymentDate:'2026-11-20',
      nextDueDate:'2026-11-20',fromAccountId:'demo-checking',
      autopayEnabled:true,method:'statement'
     }},
     futureRecurringRules:[{
      id:'fixture-card-repeating',kind:'event',accountId:'demo-visa',
      originalAccountId:'demo-visa',merchant:'Fictional Card Membership',
      originalMerchant:'Fictional Card Membership',type:'expense',
      originalType:'expense',amount:15,matchAmount:15,category:'Subscriptions',
      frequency:'monthly',anchorDate:'2026-10-22',sourceAnchorDate:'2026-10-22',
      sourceFrequency:'monthly',amountBasis:'fixed',
      matchNames:['fictional card membership'],exampleIds:[]
     }]
    }));
    let original;
    Object.defineProperty(window,'createHouseholdLedgerDemo',{
     configurable:true,set(fn){original=fn},
     get(){return original&&function(){
      const data=original(),row=(id,date,merchant,type,amount,pending=false)=>({
       id,date,merchant,type,amount,pending,category:'Other',account:'Visa',
       cashDirection:type==='refund'?'in':type==='transfer'?'in':'out',demo:true
      });
      data.transactions.push(
       row('statement-previous','2026-09-29','Prior Statement Purchase','expense',20),
       row('statement-current','2026-10-02','Current Statement Purchase','expense',50),
       row('statement-refund','2026-10-10','Current Statement Refund','refund',10),
       row('statement-pending','2026-10-11','Pending Card Charge','expense',500,true),
       row('statement-payment','2026-10-15','Card Settlement','transfer',200)
      );
      return data;
     }}
    });
   });
   const statementPage=await statementCtx.newPage(),statementErrors=[];
   statementPage.on('pageerror',e=>statementErrors.push(e.message));
   await statementPage.goto(staticUrl,{waitUntil:'load'});
   await statementPage.locator('.planner-nav-primary [data-view="schedules"]').click();
   const statementAccount=statementPage.locator('[name="scheduleAccount"]');
   assert.equal(await statementAccount.count(),1,'Repeating has an account selector');
   assert.equal(await statementAccount.inputValue(),'all');
   await statementAccount.selectOption('demo-visa');
   assert.equal(await statementPage.locator('[data-schedule-card]').count(),1);
   const cycles=statementPage.locator('[data-repeating-statement-group]');
   assert.deepEqual(await cycles.evaluateAll(els=>els.map(x=>x.dataset.repeatingStatementGroup)),
    ['2026-10-31','2026-11-30','2026-12-31']);
   assert.deepEqual(await cycles.locator('.ledger-statement-total').allInnerTexts(),
    ['Net charges $15.00','Net charges $15.00','Net charges $15.00']);
   await statementPage.locator('[data-schedule-search]').fill('no matching card charge');
   assert.equal(await statementPage.locator('[data-repeating-statement-group]:visible').count(),0);
   await statementPage.locator('[data-schedule-search]').fill('');
   assert.equal(await statementPage.locator('[data-repeating-statement-group]:visible').count(),3);
   await statementAccount.selectOption('demo-checking');
   assert.equal(await statementPage.locator('[data-repeating-statement-periods]').count(),0);
   await statementPage.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await statementPage.locator('[data-history-statement-group]').count(),0);
   await statementPage.locator('[name=historyAccount]').selectOption('demo-visa');
   const historicalGroups=statementPage.locator('[data-history-statement-group]');
   assert.deepEqual(await historicalGroups.evaluateAll(els=>els.map(e=>e.dataset.historyStatementGroup)),
    ['2026-10-31','2026-09-30']);
   assert.deepEqual(await historicalGroups.locator('.ledger-statement-total').allInnerTexts(),
    ['Net charges $40.00','Net charges $20.00']);
   assert.equal(await statementPage.locator('.history-actual-row').count(),5);
   await statementPage.locator('[data-history-sort]').selectOption('merchant');
   assert.deepEqual(await historicalGroups.locator('.ledger-statement-total').allInnerTexts(),
    ['Net charges $40.00','Net charges $20.00']);
   await statementPage.locator('[data-history-filter] [name=search]').fill('Current Statement Purchase');
   await statementPage.locator('[data-history-filter] button[type=submit]').click();
   assert.deepEqual(await historicalGroups.locator('.ledger-statement-total').allInnerTexts(),
    ['Net charges $50.00']);
   await statementCtx.close();
   assert.deepEqual(statementErrors,[]);
   await context.close();
  }
  const privateUrl='http://127.0.0.1:'+privatePort;
  const empty=await chrome.newContext({httpCredentials:{username:'pilot',password:pass}});
  await empty.addInitScript(fixedDate);
  await empty.addInitScript(()=>localStorage.setItem('household-ledger-view-mode','real'));
  const emptyPage=await empty.newPage(),emptyErrors=[];emptyPage.on('pageerror',e=>emptyErrors.push(e.message));
  await emptyPage.goto(privateUrl,{waitUntil:'load'});
  await emptyPage.getByText('Real bank information is not available yet.').waitFor();
  assert.equal(await emptyPage.locator('#ledger-mode-switch').inputValue(),'real',
   'An unavailable Real bank does not switch itself to fictional Demo');
  assert.equal(await emptyPage.locator('.account-tile').count(),0,
   'Disconnected Real does not show a fabricated balance');
  assert.ok((await emptyPage.locator('a[href="/bank-connect"]').count())>0,
   'Bank connection workflow is preserved');
  assert.deepEqual(emptyErrors,[]);
  await empty.close();

  const account={id:'checking-real',name:'Household Checking',mask:'1842',type:'depository',
   subtype:'checking',itemId:'bank-1',current:5000,available:4800,balanceObservedAt:'2026-10-19T09:00:00Z'};
  const card={id:'credit-real',name:'Household Visa',mask:'6555',type:'credit',
   subtype:'credit card',itemId:'bank-1',current:1200,available:null,balanceObservedAt:'2026-10-19T09:00:00Z'};
  const mortgagePfc={primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_MORTGAGE_PAYMENT',confidence_level:'HIGH'};
  const dates=['2026-06-02','2026-07-02','2026-08-02','2026-09-02','2026-10-02'];
  const transactions=dates.map((date,i)=>({id:'mort-'+i,accountId:'checking-real',
   date,name:'Home Mortgage ACH',merchant:'Home Mortgage ACH',amount:2590,pending:false,category:mortgagePfc}));
  for(const month of ['2026-08','2026-09'])
   transactions.push({id:'storage-'+month,accountId:'checking-real',date:month+'-09',
    name:'Storage Unit Monthly',merchant:'Storage Unit Monthly',amount:79,pending:false,
    category:{primary:'GENERAL_MERCHANDISE',detailed:'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE',
     confidence_level:'HIGH'}});
  transactions.push({id:'unclassified-ach-mortgage',accountId:'checking-real',
   date:'2026-09-14',name:'House Loan ACH Unrecognized',merchant:'House Loan ACH Unrecognized',
   amount:2000,pending:false,
   category:{primary:'TRANSFER_OUT',detailed:'TRANSFER_OUT_OTHER_TRANSFER_OUT',confidence_level:'LOW'}});
  transactions.push({id:'one-missing-mortgage',accountId:'checking-real',
   date:'2026-09-15',name:'Mortgage Servicer X',merchant:'Mortgage Servicer X',
   amount:2000,pending:false,
   category:{primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_MORTGAGE_PAYMENT',confidence_level:'HIGH'}});
  transactions.push({id:'card-purchase',accountId:'credit-real',date:'2026-10-10',
   name:'Grocery Card Charge',merchant:'Grocery Card Charge',amount:300,pending:false,
   category:{primary:'FOOD_AND_DRINK',detailed:'FOOD_AND_DRINK_GROCERIES',confidence_level:'HIGH'}});
  for(const month of ['2026-06','2026-07','2026-08','2026-09'])
   transactions.push({id:'card-month-'+month,accountId:'credit-real',date:month+'-10',
    name:'Grocery Card Charge',merchant:'Grocery Card Charge',amount:300,pending:false,
    category:{primary:'FOOD_AND_DRINK',detailed:'FOOD_AND_DRINK_GROCERIES',confidence_level:'HIGH'}});
  for(const month of ['2026-06','2026-07','2026-08','2026-09','2026-10'])
   transactions.push({id:'streaming-'+month,accountId:'credit-real',date:month+'-05',
    name:'Netflix subscription',merchant:'Netflix subscription',amount:18,pending:false,
    category:{primary:'SUBSCRIPTIONS',detailed:'SUBSCRIPTIONS_TV_AND_MOVIES',confidence_level:'HIGH'}});
  for(const month of ['2026-06','2026-07','2026-08','2026-09','2026-10'])
   transactions.push({id:'income-'+month,accountId:'checking-real',date:month+'-12',
    name:'ACME Employer Payroll',merchant:'ACME Employer Payroll',amount:-3100,pending:false,
    category:{primary:'TRANSFER_IN',detailed:'TRANSFER_IN_OTHER_TRANSFER_IN',confidence_level:'HIGH'}});
  const realPayload={connected:true,accounts:[account,card],account,lastSync:'2026-10-19T09:00:00Z',
   transactions,adjustments:{}};
  const real=await chrome.newContext({httpCredentials:{username:'pilot',password:pass},viewport:{width:1280,height:900}});
  await real.addInitScript(fixedDate);
  await real.addInitScript(()=>localStorage.setItem('household-ledger-view-mode','real'));
  const page=await real.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const go=async tab=>{
   const primary=page.locator('.planner-nav-primary [data-view="'+tab+'"]');
   if(await primary.count()){await primary.click();return}
   if(tab==='overview'){
    await page.evaluate(()=>{
     const b=document.createElement('button');b.dataset.view='overview';
     b.hidden=true;document.body.appendChild(b);b.click();b.remove();
    });
    return;
   }
   if(await page.locator('#planner-menu').getAttribute('open')===null)
    await page.locator('#planner-menu > summary').click();
   await page.locator('.planner-menu-content [data-view="'+tab+'"]').click();
  };
  await page.route('**/api/ledger',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(realPayload)}));
  const writes=[],categoryWrites=[];
  let failNextForecast=false,legacyAdjustmentCalls=0;
  // Simulate a stale/invalid historical category override: it must NOT block
  // saving a user-confirmed future bill.
  await page.route('**/api/ledger/adjustments',r=>{
   legacyAdjustmentCalls++;
   return r.fulfill({status:400,contentType:'application/json',
    body:'{"error":"Invalid category override"}'});
  });
  await page.route('**/api/ledger/category',r=>{
   const data=r.request().postDataJSON();
   assert.deepEqual(Object.keys(data).sort(),['category','transactionId'],
    'Category changes send only a bank record ID and category');
   categoryWrites.push(data);
   realPayload.adjustments.categoryOverrides??={};
   if(data.category===null)delete realPayload.adjustments.categoryOverrides[data.transactionId];
   else realPayload.adjustments.categoryOverrides[data.transactionId]=data.category;
   return r.fulfill({status:200,contentType:'application/json',
    body:'{"saved":true,"scope":"category"}'});
  });
  await page.route('**/api/ledger/forecasts',r=>{
   const data=r.request().postDataJSON();
   assert.deepEqual(Object.keys(data),['predictions'],
    'The forecast API may only receive predictions, not bank records or category overrides');
   if(failNextForecast){
    failNextForecast=false;
    return r.fulfill({status:503,contentType:'application/json',
     body:'{"error":"Forecast settings temporarily unavailable"}'});
   }
   writes.push(data);
   return r.fulfill({status:200,contentType:'application/json',
    body:'{"saved":true,"scope":"predictions"}'});
  });
  let refreshed=0,loginRequired=false;
  await page.route('**/api/sync',r=>{
   refreshed++;
   return loginRequired?r.fulfill({status:409,contentType:'application/json',
    body:'{"error":"Your bank needs you to sign in again","code":"ITEM_LOGIN_REQUIRED","reconnectAccountId":"checking-real"}'}):
    r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  });
  await page.goto(privateUrl+'/?utm_source=chatgpt.com',{waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelector('#source-type')?.textContent==='REAL BANK');
  assert.match(await page.locator('.summary-page').innerText(),/3-year low/);
  assert.equal(await page.locator('[data-bank-current-value]').innerText(),'$5,000.00',
   'Live bank current must be the Plaid current, not $4,800 available');
  assert.match(await page.locator('.summary-bank').innerText(),/Plaid current balance/);

  assert.match(await page.locator('.summary-numbers').innerText(),/3-year low/);
  assert.equal(await page.locator('.coverage-month,.coverage-table,.calendar-checklist').count(),0,
   'Long-range calculation does not resurrect old major-payment coverage checks');
  assert.match(await page.locator('.calendar-monthly-unplanned').innerText(),/Household Visa/,
   'Missing card setup remains clearly visible without the removed checklist');
  assert.match(await page.locator('.summary-trust').innerText(),/everyday unplanned spending is excluded/);
  assert.equal(await page.locator('[data-summary-days],#horizon').count(),0);
  await go('overview');
  await go('history');
  const immutableProviderCategory=JSON.stringify(realPayload.transactions.find(t=>t.id==='card-purchase').category);
  await Promise.all([
   page.waitForResponse(response=>response.url().endsWith('/api/ledger/category')),
   page.locator('[data-history-category="card-purchase"]').selectOption('Shopping')
  ]);
  assert.equal(categoryWrites.length,1,'One category selection makes one scoped write');
  assert.equal(categoryWrites[0].category,'Shopping');
  assert.equal(await page.locator('[data-history-category="card-purchase"]').inputValue(),'Shopping');
  assert.equal(JSON.stringify(realPayload.transactions.find(t=>t.id==='card-purchase').category),
   immutableProviderCategory,'Bank category overrides do not rewrite Plaid facts');
  assert.equal(legacyAdjustmentCalls,0,'No whole-account legacy adjustments write was attempted');
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelector('#source-type')?.textContent==='REAL BANK');
  await go('history');
  assert.equal(await page.locator('[data-history-category="card-purchase"]').inputValue(),'Shopping',
   'Category override survives private bank refresh');
  await go('overview');
  assert.equal(await page.locator('.account-tile').count(),2);
  assert.equal(await page.locator('.balance-main').innerText(),'$4,800.00',
   'Real checking starts at bank-reported available cash, not credit card debt');
  assert.match(await page.locator('.income-status').innerText(),/PREDICTED/i,
   'Recurring payroll categorized by Plaid as TRANSFER_IN now reaches projected income');
  assert.match(await page.locator('.income-status').innerText(),/dated deposits/,
   'Income summary includes recurring payroll over the fixed forecast period');
  assert.match(await page.locator('.overview-upcoming-item').first().innerText(),/Home Mortgage ACH/,
   'Real mortgage history produces expected future cash withdrawals');
  assert.ok(await page.locator('.overview-upcoming-item').count()>=1);
  assert.match(await page.locator('[aria-label="Selected account projection"]').innerText(),/First projected shortfall/);
  const setMain=page.locator('[data-set-main="checking-real"]');
  if(await setMain.count())await setMain.click();
  await page.locator('[aria-label="Selected account projection"] .status-tag.good')
   .filter({hasText:/^MAIN ACCOUNT$/}).waitFor();
  assert.match(await page.locator('[aria-label="Selected account projection"]').innerText(),/MAIN ACCOUNT/,
   'The chosen checking account becomes the persistent primary focus');
  await go('history');
  assert.match(await page.locator('.history-page').innerText(),/Home Mortgage ACH/,
   'Plaid posted mortgage visible separately from future predictions');
  const ambiguousMortgage=page.locator('.history-actual-row').filter({hasText:'House Loan ACH Unrecognized'}).first();
  await ambiguousMortgage.click();
  assert.match(await ambiguousMortgage.innerText(),/transfer/i,
   'The source ACH entry really is a transfer, not a pre-classified mortgage expense');
  const uncertainForm=page.locator('.history-schedule-form');
  assert.equal(await uncertainForm.locator('[name=type]').inputValue(),'expense',
   'An actual misclassified ACH mortgage can be scheduled as a checking withdrawal');
  assert.equal(await uncertainForm.locator('[name=amount]').inputValue(),'2000');
  await uncertainForm.locator('[data-cancel-review-form]').click();
  await go('transactions');
  assert.ok(await page.locator('.future-item').filter({hasText:'Storage Unit Monthly'}).count()>0,
   'Two precisely repeating storage payments are in the future ledger');
  assert.ok(await page.locator('.future-item').filter({hasText:'Home Mortgage ACH'}).count()>0,
   'The recurring mortgage is also in that same future ledger');
  await go('history');
  await page.locator('.history-actual-row').filter({hasText:'Home Mortgage ACH'})
   .first().click();
  const homeForm=page.locator('.history-schedule-form');
  assert.equal(await homeForm.locator('[name=category]').count(),1,
   'Bank record to schedule confirmation shares the Category field');
  await homeForm.locator('[name=category]').selectOption('Mortgage');
  await homeForm.locator('button[type=submit]').click();
  await page.locator('.history-page .future-notice').getByText(/Saved recurring forecast/).waitFor();
  await go('schedules');
  const savedMortgagePlan=page.locator('[data-schedule-card]').filter({hasText:'Home Mortgage ACH'}).first();
  assert.equal(await savedMortgagePlan.locator('[data-schedule-quick-category]').inputValue(),'Mortgage',
   'Real-account schedule confirmation persists selected Category on the forecast plan');
  await go('history');
  assert.ok(await page.locator('.history-actual-row').filter({hasText:'Home Mortgage ACH'}).count()>0,
   'Bank source history remains visible after category assignment');
  await go('settings');
  const cardSettings=page.locator('#card-autopay');
  if(await cardSettings.getAttribute('open')===null)
   await cardSettings.locator('summary').click();
  const cardForm=page.locator('[data-card-rule="credit-real"]');
  assert.match(await cardForm.innerText(),/SETUP REQUIRED/,
   'Connected credit card cannot contribute forecasts until billing setup is saved');
  await cardForm.locator('[name=autopayEnabled]').selectOption('yes');
  await cardForm.locator('[name=method]').selectOption('statement');
  assert.equal(await cardForm.locator('[name=fromAccountId]').isVisible(),true,
   'Funding account becomes required for autopay');
  assert.equal(await cardForm.locator('[name=minimumAmount]').isVisible(),false,
   'Minimum payment amount stays hidden for full statement autopay');
  await cardForm.locator('[name=fromAccountId]').selectOption('checking-real');
  await cardForm.locator('[name=billingStartDate]').fill('2026-09-19');
  await cardForm.locator('[name=billingEndDate]').fill('2026-10-18');
  await cardForm.locator('[name=lastStatementBalance]').fill('1200');
  await cardForm.locator('[name=nextPaymentDate]').fill('2026-11-11');
  await cardForm.locator('[name=nextDueDate]').fill('2026-11-12');
  await cardForm.locator('button[type=submit]').click();
  await cardForm.locator('.card-statement-preview .card-preview-amount').first().getByText('$1,200.00',{exact:true}).waitFor();
  assert.match(await cardForm.locator('.card-statement-preview').first().innerText(),/Household Checking/,
   'Private bank card statement previews identify the paying account');
  assert.match(await cardForm.locator('.card-statement-preview').first().innerText(),
   /Actual posted purchases|Actual net period spending/,
   'Statement preview identifies factual posted card purchases separately from guesses');
  const actualEntries=cardForm.locator('.card-statement-preview').first().locator('.card-actual-transactions');
  assert.ok(await actualEntries.count(),'Actual card transactions can be inspected line by line');
  await actualEntries.locator('summary').click();
  assert.match(await actualEntries.innerText(),/Grocery Card Charge|Netflix subscription/,
   'Posted card charges are individually auditable for their billing period');
  assert.match(await cardForm.locator('.card-statement-preview').first().innerText(),/Planned/,
   'Before bank posts withdrawal, its date is explicitly a plan, not actual history');
  await go('summary');
  await page.locator('#summary-account').selectOption('credit-real');
  assert.equal(await page.locator('[data-summary-card-statement] .summary-overline').innerText(),
   'Statement balance','An issued statement is labeled separately from a forecast estimate');
  assert.equal(await page.locator('[data-summary-statement-value]').innerText(),'$1,200.00',
   'Calendar uses the validated issued amount, not the card current debt or checking withdrawal');
  assert.equal(await page.locator('[data-summary-card-next-statement] .summary-overline').innerText(),
   'Next statement estimate');
  assert.equal(await page.locator('[data-summary-next-statement-value]').count(),1,
   'Connected card shows the following statement estimate next to its issued statement');
  assert.equal(await page.locator('[data-summary-month-low]').count(),0);
  const dueButton=page.locator('[data-summary-card-statement] [data-calendar-card-statement-date]');
  assert.equal(await dueButton.count(),1,'Current issued statement provides its own due-date drilldown');
  await dueButton.click();
  assert.equal(await page.locator('.calendar-day.selected').getAttribute('data-calendar-day'),
   '2026-11-12','Current statement date opens its due date inside the card Calendar');
  const nextClosing=page.locator('[data-summary-card-next-statement] [data-calendar-card-statement-date]');
  assert.equal(await nextClosing.count(),1,
   'Following estimated statement has a separate closing-date drilldown');
  await nextClosing.click();
  assert.equal(await page.locator('.calendar-day.selected').getAttribute('data-calendar-day'),
   '2026-11-18','Following estimate opens its actual closing date without changing the prior due date');
  await page.locator('#summary-account').selectOption('checking-real');
  assert.equal(await page.locator('[data-summary-month-low]').count(),1,
   'Checking metrics are unaffected by selecting a credit card');
  await page.locator('[data-calendar-today]').click();
  await page.locator('[data-calendar-nav="1"]').click();
  await page.locator('[data-calendar-day="2026-11-11"]').click();
  const cardNov=page.locator('.calendar-day-transactions .calendar-monthly-entry')
   .filter({hasText:'Credit-card payment'}).first();
  assert.ok(await cardNov.count()>0,'The projected checking card payment has an itemized breakdown');
  await cardNov.locator('[data-open-card-payment]').click();
  const itemized=cardNov.locator('[data-inline-transaction-editor]');
  assert.equal(await page.locator('.transaction-detail').count(),0);
  assert.equal(await itemized.isVisible(),true);
  assert.match(await itemized.innerText(),/Actual posted card transactions/);
  assert.match(await itemized.innerText(),/Scheduled\/recurring card transactions/);
  assert.match(await itemized.innerText(),/Identifiable activity/);
  assert.match(await itemized.innerText(),/no historical-average spending allowance|No historical spending averages/i);
  assert.equal(await itemized.locator('.future-edit-form').count(),1);
  await itemized.locator('[data-cancel-future]').click();
  assert.equal(await page.locator('.calendar-checklist,.coverage-table').count(),0,
   'Card setup is inspectable directly from payments without a separate assurance matrix');
  assert.match(await page.locator('.summary-trust').innerText(),/not a guaranteed minimum/i);
  await go('overview');
  assert.match(await page.locator('.upcoming-card-bills').innerText(),/Household Visa/,
   'Overview shows the next card statement and due date');
  await go('transactions');
  assert.match(await page.locator('.transactions-page').innerText(),/ACME Employer Payroll/,
   'Predicted payroll is listed as an editable future deposit for checking');
  assert.match(await page.locator('.transactions-page').innerText(),/Deposit/,
   'Payroll has positive deposit direction rather than a transfer or expense');
  assert.match(await page.locator('.transactions-page').innerText(),/Credit-card payment/,
   'A confirmed full-statement card payment is a dated checking withdrawal');
  const cardSeries=page.locator('.future-item').filter({hasText:'Credit-card payment'}).first();
  assert.equal(await cardSeries.locator('[data-edit-series]').count(),0,
   'No duplicate card-payment editing action');
  await cardSeries.locator('[data-edit-future]').click();
  const cardSeriesForm=page.locator('.future-edit-form');
  assert.equal(await cardSeriesForm.locator('input[name=scope][value=all]').count(),1,
   'Card autopay supports linked all-future edits in the regular Edit form');
  await cardSeriesForm.locator('input[name=scope][value=all]').check();
  assert.equal(await cardSeriesForm.locator('input[name=scope][value=all]').isChecked(),true);
  await cardSeriesForm.locator('[name=amount]').fill('1275');
  await cardSeriesForm.locator('button[type=submit]').click();
  await page.locator('.future-notice').getByText(/recurring schedule/i).waitFor();
  assert.ok(writes.some(x=>Object.values(x.predictions?.futureSeriesEdits||{})
   .some(v=>v.amount===1275)),'Recurring card payments persist only as private adjustments; recent forecast save: '+JSON.stringify(writes.at(-1)?.predictions?.futureRecurringRules?.slice(-1)||writes.at(-1)?.predictions?.futureSeriesEdits||{}).slice(0,750));
  const recurringCardRows=page.locator('.future-item').filter({hasText:'Credit-card payment'});
  assert.ok(await recurringCardRows.count()>=2,'Two future card cycles are visible');
  const matchingAmounts=await recurringCardRows.locator('.future-amount').allInnerTexts();
  assert.ok(matchingAmounts.every(t=>t.includes('$1,275')),
   'Both checking-to-card transfers use the new recurring payment amount');
  await page.locator('[data-show-new]').click();
  await page.locator('#future-new-form [name=merchant]').fill('One-time plumbing');
  await page.locator('#future-new-form [name=amount]').fill('175');
  await page.locator('#future-new-form [name=date]').fill('2026-11-23');
  await page.locator('#future-new-form button[type=submit]').click();
  await page.getByText('One-time plumbing').first().waitFor();
  await go('settings');
  for(let i=0;i<45&&!writes.some(x=>x.predictions?.paymentRules?.['credit-real']);i++)
   await new Promise(r=>setTimeout(r,80));
  assert.ok(writes.some(x=>x.predictions?.paymentRules?.['credit-real']?.fromAccountId==='checking-real'),
   'Card full-statement autopay setting persists through private adjustment API');
  assert.ok(writes.some(x=>x.predictions?.futureTransactionAdds?.some(t=>t.merchant==='One-time plumbing')),
   'One-off forecast additions persist as private adjustments, never as source transactions');
  assert.ok(writes.some(x=>x.predictions?.futureRecurringRules?.some(r=>
    r.merchant==='Home Mortgage ACH'&&r.accountId==='checking-real')),
   'Confirmed mortgage schedule persists in private encrypted forecast preferences');
  const auditReal=page.locator('#accuracy-audit');
  await page.locator('#planner-menu > summary').click();
  assert.equal(await page.locator('#audit-launch').isVisible(),true,
   'Real-bank accuracy audit is available from More on Settings');
  await page.locator('#audit-launch').click();
  assert.ok(await auditReal.getAttribute('open')!==null,'Real bank audit expands using one click');
  assert.match(await auditReal.innerText(),/Prediction accuracy/);
  assert.match(await auditReal.innerText(),/Historical|historical|months|history/i,
   'Private Real bank data is processed in memory by the same audit');
  await auditReal.locator('.audit-run-status').getByText(/Check 1 completed/).waitFor();
  await auditReal.locator('[data-run-backtest]').click();
  await auditReal.locator('.audit-run-status').getByText(/Check 2 completed/).waitFor();
  assert.match(await auditReal.locator('.audit-run-status').innerText(),/Results unchanged/,
   'Rerun in Real mode communicates no change instead of appearing unresponsive');
  assert.ok(await auditReal.getAttribute('open')!==null,
   'Real-mode rerun retains the expanded audit section');
  assert.match(await auditReal.innerText(),/Refresh bank first/,
   'An audit recheck clearly distinguishes recalculation from fetching new Plaid data');
  await go('overview');
  await page.locator('.account-tile').filter({hasText:'Household Visa'}).click();
  assert.equal(await page.locator('.balance-main').innerText(),'$1,200.00',
   'Selecting a card switches to debt without reducing checking');
  await page.locator('.account-tile').filter({hasText:'Household Checking'}).click();
  assert.equal(await page.locator('.balance-main').innerText(),'$4,800.00',
   'Switching back preserves bank-reported checking');
  await page.locator('#planner-menu > summary').click();
  await page.locator('#refresh-bank').click();
  await page.waitForFunction(()=>document.querySelector('#source-type')?.textContent==='REAL BANK');
  assert.equal(refreshed,1,'Private Plaid refresh remains reachable');
  await go('transactions');
  const predictedMortgage=page.locator('.future-item').filter({hasText:'Mortgage Servicer X'});
  assert.ok(await predictedMortgage.count()>=1,
   'One strongly identified actual $2,000 mortgage is forecast automatically without three months');
  const predictedDatesBefore=await predictedMortgage.count();
  assert.equal(predictedDatesBefore,36,'Automatic mortgage estimate repeats throughout the three-year modeled period');
  await go('history');
  const actualMortgage=page.locator('.history-actual-row').filter({hasText:'Mortgage Servicer X'}).first();
  await actualMortgage.click();
  const mortgageForm=page.locator('.history-schedule-form');
  assert.equal(await mortgageForm.locator('[name=amount]').inputValue(),'2000');
  assert.equal(await mortgageForm.locator('[name=accountId]').inputValue(),'checking-real');
  assert.equal(await mortgageForm.locator('[name=date]').inputValue(),'2026-11-15');
  assert.equal(await mortgageForm.locator('[name=frequency]').inputValue(),'monthly');
  // The manual due date must supersede inferred November 15, not create
  // a second monthly $2,000 checking withdrawal.
  await mortgageForm.locator('[name=date]').fill('2026-11-25');
  failNextForecast=true;
  await mortgageForm.locator('button[type=submit]').click();
  await mortgageForm.locator('[role=alert]').getByText(/Forecast settings temporarily unavailable/).waitFor();
  assert.ok(await page.locator('.history-schedule-form').count()===1,
   'Failed save leaves the recurring confirmation editable for retry');
  await mortgageForm.locator('button[type=submit]').click();
  await page.locator('.history-page .future-notice').getByText(/Saved recurring forecast/).waitFor();
  assert.equal(legacyAdjustmentCalls,0,'Saving future predictions never resubmits Plaid categories');
  assert.ok(writes.some(x=>x.predictions?.futureRecurringRules?.some(r=>
   r.merchant==='Mortgage Servicer X'&&r.amount===2000&&r.accountId==='checking-real')),
   'Mortgage rule saved as private prediction, not bank-transaction change');
  await go('transactions');
  const singleMortgage=page.locator('.future-item').filter({hasText:'Mortgage Servicer X'});
  assert.equal(await singleMortgage.count(),35,
   'One owner-confirmed mortgage per remaining billing month, without the inferred duplicate');
  assert.match(await singleMortgage.first().innerText(),/Nov 25/,
   'Owner-selected mortgage date takes priority over the historical posting day');
  await go('history');
  await page.locator('.history-actual-row').filter({hasText:'Storage Unit Monthly'})
   .first().click();
  const storageForm=page.locator('.history-schedule-form');
  assert.equal(await storageForm.locator('[name=amount]').inputValue(),'79');
  assert.equal(await storageForm.locator('[name=accountId]').inputValue(),'checking-real');
  assert.equal(await storageForm.locator('[name=frequency]').inputValue(),'monthly');
  await storageForm.locator('button[type=submit]').click();
  await page.locator('.history-actual-row').filter({hasText:'Storage Unit Monthly'})
   .first().locator('.history-actual-description').getByText('Repeating plan saved',{exact:false}).waitFor();
  assert.ok(writes.some(x=>x.predictions?.futureRecurringRules?.some(r=>
   r.merchant==='Storage Unit Monthly'&&r.amount===79&&r.accountId==='checking-real')),
   'Low-confidence candidate becomes a saved private rule only after approval');
  const storage=await page.evaluate(()=>({...localStorage}));
  assert.equal(Object.keys(storage).some(k=>JSON.stringify(storage[k]).includes('mort-4')),false,
   'Raw Real bank transactions are not written to localStorage');
  // Re-authentication is actionable on the Ledger after a failed refresh.
  // Previously imported balances must remain readable and never become Demo.
  loginRequired=true;
  await go('summary');
  if(await page.locator('#planner-menu').getAttribute('open')===null)
   await page.locator('#planner-menu > summary').click();
  await page.locator('#refresh-bank').click();
  await page.locator('#planner-notice').getByText('Bank connection needs attention.').waitFor();
  assert.match(await page.locator('#planner-notice').innerText(),/sign in again|renew permission/i);
  assert.equal(await page.locator('#planner-notice a[href="/bank-connect"]').innerText(),'Reconnect bank');
  assert.equal(await page.locator('[data-bank-current-value]').innerText(),'$5,000.00',
   'Bank authorization failure never clears the previously imported starting balance');
  loginRequired=false;
  await page.locator('#refresh-bank').click();
  await page.waitForFunction(()=>!document.querySelector('#planner-notice')?.textContent
   .includes('Bank connection needs attention.'));
  // Reconnect control launches Link update mode, not a new public-token flow.
  const connectionPage=await real.newPage(),connectErrors=[];
  connectionPage.on('pageerror',e=>connectErrors.push(e.message));
  await connectionPage.route('https://cdn.plaid.com/link/v2/stable/link-initialize.js',r=>
   r.fulfill({status:200,contentType:'text/javascript',body:
    'window.Plaid={create:function(opts){window.__linkOptions=opts;return {open:function(){window.__linkOpened=true}}}};'}));
  let needsReconnect=true,requestedAccount='';
  await connectionPage.route('**/api/status',r=>r.fulfill({status:200,
   contentType:'application/json',body:JSON.stringify({
    connected:true,lastSync:'2026-10-19T09:00:00Z',
    accounts:[{...account,forecastUsage:{protected:true,counts:{}},needsReconnect}],transactions:[]})}));
  await connectionPage.route('**/api/link-token',r=>{
   requestedAccount=r.request().postDataJSON().reconnectAccountId;
   return r.fulfill({status:200,contentType:'application/json',
    body:'{"link_token":"fixture-update-token","mode":"update"}'});
  });
  await connectionPage.route('**/api/sync',r=>{
   needsReconnect=false;
   return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  });
  await connectionPage.goto(privateUrl+'/bank-connect',{waitUntil:'load'});
  await connectionPage.locator('#repair-alert').waitFor({state:'visible'});
  assert.match(await connectionPage.locator('#repair-alert').innerText(),/preserved/);
  await connectionPage.locator('[data-reconnect-account]').click();
  await connectionPage.waitForFunction(()=>window.__linkOpened===true);
  assert.equal(requestedAccount,'checking-real','Repair targets the original connected Item');
  assert.equal(await connectionPage.evaluate(()=>window.__linkOptions.token),'fixture-update-token');
  await connectionPage.evaluate(()=>window.__linkOptions.onSuccess('unused-update-mode-public-token',{}));
  await connectionPage.locator('#repair-alert').waitFor({state:'hidden'});
  assert.deepEqual(connectErrors,[]);
  await connectionPage.close();
  assert.deepEqual(errors,[]);
  await real.close();
  console.log('PASS compact planner in desktop Chromium and iPhone WebKit: fixed three-year minimum, no major-payment coverage, Demo/Real bank integrity, card debt, refresh, privacy and mobile layout');
 }finally{
  if(chrome)await chrome.close();if(iphone)await iphone.close();
  for(const child of children)child.kill('SIGTERM');
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});