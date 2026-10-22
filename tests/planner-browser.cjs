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
   assert.equal(await page.locator('h1').innerText(),'Know your balance before the bill.');
   assert.equal(await page.locator('.side-link').count(),0,
    'No duplicate sidebar navigation');
   assert.equal(await page.locator('.planner-nav-primary .tab-link').count(),3,
    'One primary navigation row: calendar, schedules, history');
   assert.deepEqual(await page.locator('.planner-nav-primary .tab-link').allTextContents(),
    ['Calendar','Schedules','History']);
   assert.equal(await page.locator('.planner-nav-primary [data-view="transactions"]').count(),0,
    'Predictions is not an additional primary tab');
   const go=async tab=>{
    const primary=page.locator('.planner-nav-primary [data-view="'+tab+'"]');
    if(await primary.count()){await primary.click();return}
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
    await page.setViewportSize({width:390,height:844});
   }

   assert.equal(await page.locator('#ledger-mode-switch option[value=real]').isDisabled(),true,
    'Public Demo cannot pretend it is authenticated Real');
   assert.match(await page.locator('#source-type').innerText(),/DEMO/);
   assert.match(await page.locator('.summary-page').innerText(),/Lowest projected balance/);
   assert.equal(await page.locator('[data-bank-current-value]').innerText(),'$5,650.25',
    'The demo current balance uses the bank snapshot current, not available $5,400.25');
   assert.match(await page.locator('.summary-bank').innerText(),/Demo current balance/);
   assert.match(await page.locator('.planner-menu-content [data-view="transactions"]').textContent(),
    /All predictions/,'Advanced bulk prediction view remains available without a fourth tab');
   assert.ok(await page.locator('#planner-menu > summary').isVisible(),'Advanced tools use one compact menu');
   assert.equal(await page.locator('.topbar .lead').count(),0,
    'Global header does not repeat the planner introduction');
   assert.equal(await page.locator('.top-actions label[for="ledger-mode-switch"]').count(),0,
    'The source selector has its own accessible name without an extra label');
   await go('settings');
   assert.equal(await page.locator('[aria-label="Bank connection status"]').count(),1,
    'Connection information appears in one compact, actionable Settings section');
   assert.equal(await page.locator('h3').filter({hasText:'Planning assumptions'}).count(),0,
    'Settings does not repeat forecasting disclaimers already present in Calendar');
   assert.equal(await page.locator('[aria-label="Not recurring decisions"]').count(),0,
    'An empty recurrence-exclusion manager does not occupy space in Settings');
   assert.equal(await page.locator('[aria-label="Recurring forecast changes"]').count(),0,
    'Schedules, not a second Settings shortcut, own recurrence editing');
   await go('summary');
   assert.equal(await page.locator('[data-summary-days],#horizon').count(),0,
    'No 30/60/90 period selectors in the simplified planner');
   assert.equal(await page.locator('.summary-low').count(),1,
    'Only the lowest modeled balance is emphasized');
   assert.match(await page.locator('.summary-numbers').innerText(),/next 3 years/);
   assert.equal(await page.locator('.calendar-checklist,.coverage-table,.summary-coverage-metric').count(),0,
    'Ambiguous major-payment assurance panels have been removed');
   assert.equal(await page.locator('.calendar-monthly-list[open]').count(),0,
    'Full-month prediction list is collapsed by default');
   assert.equal(await page.locator('.calendar-day-transactions .calendar-monthly-row').count(),0,
    'No selected-day payments are invented on an empty starting day');
   assert.equal((await page.locator('.calendar-day-detail').innerText()).match(/No transactions predicted for this day/g)?.length,1,
    'Empty days show one plain-language status');
   assert.equal(await page.locator('.calendar-day-detail .calendar-math').count(),0,
    'No zero-only deposits and withdrawals on an empty day');
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
   assert.ok(await selectedPayments.count()>0,
    'Selected forecast day immediately lists its own editable predictions');
   assert.equal(await selectedPayments.count(),await page.locator(
    '.calendar-monthly-list .calendar-monthly-row[data-calendar-list-date="'+chosenDate+'"]').count(),
    'Selected day contains exactly the predictions belonging to that date');
   assert.equal(await page.locator('.calendar-monthly-list .calendar-monthly-row:visible').count(),0,
    'Other days are hidden until explicitly expanding the month');
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
   assert.equal(await page.locator('.calendar-day-detail .calendar-math').count(),1,
    'Only days with transactions show a deposit and withdrawal reconciliation');
   await page.locator('[data-calendar-actual-day]').last().click();
   assert.match(await page.locator('.calendar-day-detail').innerText(),/BANK HISTORY · NOT A PREDICTION/);
   assert.equal(await page.locator('.calendar-monthly-list[open]').count(),0,
    'Historical date selections do not open full-month predictions');
      await page.locator('[data-calendar-nav="1"]').click();
   assert.match(await page.locator('.calendar-navigation h2').innerText(),/November 2026/);
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
   const fullMinimum=await page.locator('.summary-low').innerText();
   for(const n of [10,30,90,180,360,1095]){
    await page.locator('[data-trend-days="'+n+'"]').click();
    assert.equal(await page.locator('[data-trend-days][aria-pressed="true"]').count(),1);
    assert.equal(await page.locator('.summary-low').innerText(),fullMinimum,
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
   await go('history');
   assert.match(await page.locator('.history-page').innerText(),/Actual transaction history/);
   assert.ok(await page.locator('.history-actual-row').count()>20,
    'All loaded bank records can be inspected individually');
   const demoHistoricalMortgage=page.locator('.history-actual-row').filter({hasText:'Mortgage'}).first();
   await demoHistoricalMortgage.locator('[data-history-plan]').click();
   assert.equal(await page.locator('.history-schedule-form [name=amount]').inputValue(),'2650',
    'History can propose future recurrence based on an actual bank record');
   await page.locator('[data-cancel-review-form]').click();
   const historyTransfer=page.locator('.history-actual-row').filter({hasText:'Transfer to Savings'}).first();
   assert.equal(await historyTransfer.locator('[data-history-plan]').count(),1,
    'Every actual bank transfer has a Make recurring action');
   await historyTransfer.locator('[data-history-plan]').click();
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
   assert.equal(await page.locator('#audit-launch').isVisible(),true,'One-click audit is visible in the main planner');
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
   const summary=await incomeGroup.locator('[data-schedule-group-total]').innerText();
   assert.match(summary,/Nov 2026: In \\$6,115\\.00/,
    'Monthly income sums exactly the two deposits scheduled in November, not their annual average');
   assert.match(summary,/12-month total: In \\$79,495\\.00/,
    'Thirteen pay periods for each four-week salary stream are included in the coming 12 full calendar months');
   assert.match(summary,/avg\\/month: In \\$6,624\\.58/,
    'Monthly average is separately labeled and is not confused with a specific month\'s income');
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
   const insuranceHistory=page.locator('.history-actual-row').filter({hasText:'State Farm Insurance'}).first();
   await insuranceHistory.locator('[data-history-plan]').click();
   await page.locator('.history-schedule-form [name=frequency]').selectOption('monthly');
   await page.locator('.history-schedule-form button[type=submit]').click();
   assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}')
    .futureRecurringRules?.some(r=>r.merchant==='State Farm Insurance')),
    'History creates user-confirmed recurring forecasts in saved planning preferences');
   await go('transactions');
   assert.ok(await page.locator('.future-item').filter({hasText:'State Farm Insurance'}).count()>=1,
    'History-to-forecast confirmation creates future payments');
   const inferredMortgage=page.locator('.future-item').filter({hasText:'Mortgage'}).first();
   assert.ok(await inferredMortgage.count()>0);
   await inferredMortgage.locator('[data-edit-future]').click();
   await page.locator('.future-edit-form [data-remove-recurring]').click();
   assert.equal(await page.locator('.future-item').filter({hasText:'Mortgage'}).count(),0,
    'Not recurring stops all inferred mortgage occurrences, not just one payment');
   await go('settings');
   const rejected=page.locator('[aria-label="Not recurring decisions"]');
   assert.match(await rejected.innerText(),/Mortgage/,'Rejected recurrence remains visible and reversible');
   await rejected.locator('.future-skip-line').filter({hasText:'Mortgage'})
    .locator('[data-restore-recurrence]').first().click();
   await go('transactions');
   assert.ok(await page.locator('.future-item').filter({hasText:'Mortgage'}).count()>=2,
    'Allow predictions restores the original auto-inferred schedule');
   await go('history');
   const mortgageHistory=page.locator('.history-actual-row').filter({hasText:'Mortgage'}).first();
   assert.ok(await mortgageHistory.locator('[data-stop-history-recurrence]').count()>0,
    'History also permits rejecting a recognized recurrence');
   await mortgageHistory.locator('[data-stop-history-recurrence]').click();
   await page.locator('.history-actual-row').filter({hasText:'Mortgage'})
    .first().locator('[data-restore-recurrence]').waitFor();
   await go('transactions');
   assert.equal(await page.locator('.future-item').filter({hasText:'Mortgage'}).count(),0);
   await page.reload({waitUntil:'load'});
   await go('transactions');
   assert.equal(await page.locator('.future-item').filter({hasText:'Mortgage'}).count(),0,
    'Not recurring survives browser reload and forecast regeneration');
   await go('settings');
   await page.locator('[aria-label="Not recurring decisions"] .future-skip-line')
    .filter({hasText:'Mortgage'}).locator('[data-restore-recurrence]').first().click();
   await go('transactions');
   assert.ok(await page.locator('.future-item').filter({hasText:'Mortgage'}).count()>=2,
    'User can undo the false rejection from Settings');


   // The calendar is the everyday planning editor, without navigating
   // to Predictions or inventing any separate account-balance calculation.
   await go('summary');
   const checkingOption=page.locator('#summary-account option').filter({hasText:'Checking'}).first();
   await page.locator('#summary-account').selectOption(await checkingOption.getAttribute('value'));
   await page.locator('[data-calendar-nav="1"]').click();
   await page.locator('[data-calendar-day="2026-11-09"]').click();
   assert.equal(await page.locator('.calendar-math').count(),0,
    'No zero-only arithmetic before a forecast payment is added');
   assert.equal(await page.locator('.calendar-day-ending').count(),1);
   await page.locator('[data-calendar-add]').click();
   const quick=page.locator('[data-calendar-quick-form]');
   assert.equal(await quick.locator('[name=date]').inputValue(),'2026-11-09');
   await quick.locator('[name=merchant]').fill('Playground one-time expense');
   await quick.locator('[name=amount]').fill('25');
   await quick.locator('button[type=submit]').click();
   await page.locator('.calendar-day-transactions .calendar-detail-item').filter({hasText:'Playground one-time expense'}).waitFor();
   assert.match(await page.locator('.calendar-math').innerText(),/Yesterday/);
   assert.match(await page.locator('.calendar-math').innerText(),/Withdrawals/);
   assert.equal(await page.locator('.calendar-math').getByText('Deposits').count(),0,
    'There is no empty deposit row for an expense-only day');
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
   const previousSchedules=await page.locator('[data-schedule-card]').count();
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
    assert.ok(rows.every(row=>row.height<=70),
     'Each schedule header fits in one compact row, including on iPhone');
    assert.ok(rows.every(row=>Math.abs(row.left-rows[0].left)<2),
     'Schedules are presented as one scannable list instead of side-by-side cards');
    assert.equal(await page.locator('.schedule-row-main[aria-expanded="false"]').count(),previousSchedules,
     'All untouched schedule rows start collapsed');
    assert.equal(await page.locator('.schedule-more:not([open])').count(),previousSchedules,
     'Rare actions start hidden behind their own menu');
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
   assert.equal(await water.locator('.schedule-more[open]').count(),1);
   await water.locator('[data-schedule-duplicate]').click();
   schedule=page.locator('[data-schedule-new-form]');
   await schedule.locator('[name=scheduleLabel]').fill('Water - Garden');
   assert.equal(await schedule.locator('[name=category]').inputValue(),'Water bills',
    'Separate same-merchant schedule copies category for the new independent stream');
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
   const group=page.locator('[data-schedule-category-group="Water bills"]');
   assert.equal(await group.count(),1);
   assert.match(await group.locator('.schedule-category-heading').innerText(),/Out .*\/mo/,
    'Category grouping shows a normalized monthly withdrawal total');
   assert.match(await group.locator('.schedule-category-heading').innerText(),/355/,
    'Category total includes both independently forecast monthly bills');
   assert.deepEqual(await group.locator('[data-schedule-quick-category]').evaluateAll(rows=>
    rows.map(row=>row.value)),['Water bills','Water bills'],
    'Every grouped row carries its saved category as directly editable data');
   await page.locator('[data-schedule-search]').fill('Garden');
   assert.equal(await page.locator('[data-schedule-card]:visible').count(),1,
    'Search filters instantly without navigating or reopening editors');
   assert.match(await group.locator('[data-schedule-group-total]').innerText(),/220/,
    'Visible category totals reflect only matching scheduled predictions');
   await page.locator('[data-schedule-search]').fill('');
   assert.equal(await page.locator('[data-schedule-card]:visible').count(),2);
   assert.match(await group.locator('[data-schedule-group-total]').innerText(),/355/,
    'Clearing search restores all category totals');
   await page.locator('[data-schedule-search]').fill('Nothing matches');
   assert.equal(await page.locator('[data-schedule-card]:visible').count(),0);
   assert.equal(await page.locator('[data-schedule-search-empty]:visible').count(),1);
   await page.locator('[data-schedule-search]').fill('');
   await page.locator('[data-schedule-category-filter]').selectOption('');
   await page.locator('[data-schedule-sort]').selectOption('order');
   assert.equal(await page.locator('[data-schedule-card]').count(),previousSchedules+2,
    'Clearing the filter restores all schedule actions');


   water=page.locator('[data-schedule-card]').filter({hasText:'Water - House'}).first();
   if(!await water.locator('[data-schedule-inline-plan]').count())
    await water.locator('[data-schedule-edit]').click();
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
   assert.deepEqual(errors,[],'No JavaScript exceptions on public Demo');
   if(mobile){
    const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,window:innerWidth}));
    assert.ok(sizes.scroll<=sizes.window+2,'Mobile planner does not overflow: '+JSON.stringify(sizes));
   }
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
   await page.locator('#planner-menu > summary').click();
   await page.locator('.planner-menu-content [data-view="'+tab+'"]').click();
  };
  await page.route('**/api/ledger',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(realPayload)}));
  const writes=[];
  let failNextForecast=false,legacyAdjustmentCalls=0;
  // Simulate a stale/invalid historical category override: it must NOT block
  // saving a user-confirmed future bill.
  await page.route('**/api/ledger/adjustments',r=>{
   legacyAdjustmentCalls++;
   return r.fulfill({status:400,contentType:'application/json',
    body:'{"error":"Invalid category override"}'});
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
  let refreshed=0;
  await page.route('**/api/sync',r=>{refreshed++;return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})});
  await page.goto(privateUrl+'/?utm_source=chatgpt.com',{waitUntil:'load'});
  await page.locator('#source-type').getByText('REAL BANK').waitFor();
  assert.match(await page.locator('.summary-page').innerText(),/Lowest projected balance/);
  assert.equal(await page.locator('[data-bank-current-value]').innerText(),'$5,000.00',
   'Live bank current must be the Plaid current, not $4,800 available');
  assert.match(await page.locator('.summary-bank').innerText(),/Plaid current balance/);

  assert.match(await page.locator('.summary-numbers').innerText(),/next 3 years/);
  assert.equal(await page.locator('.coverage-month,.coverage-table,.calendar-checklist').count(),0,
   'Long-range calculation does not resurrect old major-payment coverage checks');
  assert.match(await page.locator('.calendar-monthly-unplanned').innerText(),/Household Visa/,
   'Missing card setup remains clearly visible without the removed checklist');
  assert.match(await page.locator('.summary-trust').innerText(),/everyday unplanned spending is excluded/);
  assert.equal(await page.locator('[data-summary-days],#horizon').count(),0);
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
  await ambiguousMortgage.locator('[data-history-plan]').click();
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
   .first().locator('[data-history-plan]').click();
  const homeForm=page.locator('.history-schedule-form');
  await homeForm.locator('button[type=submit]').click();
  await page.locator('.history-page .future-notice').getByText(/Saved recurring forecast/).waitFor();
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
  assert.equal(await page.locator('#audit-launch').isVisible(),true);
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
  await actualMortgage.locator('[data-history-plan]').click();
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
   .first().locator('[data-history-plan]').click();
  const storageForm=page.locator('.history-schedule-form');
  assert.equal(await storageForm.locator('[name=amount]').inputValue(),'79');
  assert.equal(await storageForm.locator('[name=accountId]').inputValue(),'checking-real');
  assert.equal(await storageForm.locator('[name=frequency]').inputValue(),'monthly');
  await storageForm.locator('button[type=submit]').click();
  await page.locator('.history-actual-row').filter({hasText:'Storage Unit Monthly'})
   .first().locator('[data-history-plan]').getByText('View schedule',{exact:true}).waitFor();
  assert.ok(writes.some(x=>x.predictions?.futureRecurringRules?.some(r=>
   r.merchant==='Storage Unit Monthly'&&r.amount===79&&r.accountId==='checking-real')),
   'Low-confidence candidate becomes a saved private rule only after approval');
  const storage=await page.evaluate(()=>({...localStorage}));
  assert.equal(Object.keys(storage).some(k=>JSON.stringify(storage[k]).includes('mort-4')),false,
   'Raw Real bank transactions are not written to localStorage');
  assert.deepEqual(errors,[]);
  await real.close();
  console.log('PASS compact planner in desktop Chromium and iPhone WebKit: fixed three-year minimum, no major-payment coverage, Demo/Real bank integrity, card debt, refresh, privacy and mobile layout');
 }finally{
  if(chrome)await chrome.close();if(iphone)await iphone.close();
  for(const child of children)child.kill('SIGTERM');
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});