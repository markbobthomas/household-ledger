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
   assert.equal(await page.locator('.side-link').count(),6,'Summary and Predictions keep History, Reviews and Settings separate');
   const go=async tab=>{
    await page.locator('#planner-menu > summary').click();
    await page.locator('.planner-menu-content [data-view="'+tab+'"]').click();
   };
   assert.equal(await page.locator('#ledger-mode-switch option[value=real]').isDisabled(),true,
    'Public Demo cannot pretend it is authenticated Real');
   assert.match(await page.locator('#source-type').innerText(),/DEMO/);
   assert.match(await page.locator('.summary-page').innerText(),/Lowest projected balance/);
   assert.equal(await page.locator('.planner-menu-content [data-view="transactions"]').textContent(),'All predictions');
   assert.ok(await page.locator('#planner-menu > summary').isVisible(),'Advanced tools use one compact menu');
   assert.equal(await page.locator('[data-summary-days]').count(),6);
   assert.equal(await page.locator('.summary-current').count(),1);
   assert.equal(await page.locator('.summary-coverage-metric').count(),1);
   assert.ok(await page.locator('.calendar-checklist').count()>0);
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
   assert.ok(await page.locator('.calendar-detail-item').count()>0,
    'A date opens individual transaction details');
   const selectedAria=await page.locator('.calendar-day.selected').getAttribute('aria-label'),
    balanceText=await page.locator('.calendar-detail-balance strong').innerText();
   assert.ok(selectedAria.includes(balanceText),
    'Detailed balance is identical to the calendar projected balance for that date');
   await page.locator('[data-calendar-nav="1"]').click();
   assert.match(await page.locator('.calendar-navigation h2').innerText(),/November 2026/);
   assert.ok(await page.locator('[data-calendar-day="2026-11-01"]').count()>0,
    'Next month contains projected balances starting on its first day');
   await page.locator('[data-calendar-actual-day]').last().click();
   assert.match(await page.locator('.calendar-day-detail').innerText(),/BANK HISTORY · NOT A PREDICTION/);
   await page.locator('[data-calendar-today]').click();
   assert.match(await page.locator('.calendar-navigation h2').innerText(),/October 2026/);
   assert.equal(await page.locator('[data-calendar-day="2026-10-19"].selected').count(),1,
    'Start returns to the bank as-of date');
   assert.equal(await page.locator('[data-summary-plot]').count(),1,
    'Previous trend is still available in optional details');
   await page.locator('.summary-extras > summary').click();
   assert.equal(await page.locator('[aria-label="Major payment coverage"]').count(),1,
    'Summary displays one compact monthly coverage matrix');
   assert.ok(await page.locator('.coverage-table tbody tr').count()>=2);
   await page.locator('.coverage-table [data-coverage-cell]').first().click();
   assert.equal(await page.locator('[data-coverage-detail]').isVisible(),true,
    'Tap a month to reveal a projected payment or why it needs review');
   assert.match(await page.locator('.coverage-detail').innerText(),/View predictions|Set up card payments/);
   await page.locator('[data-coverage-close]').click();
   assert.equal(await page.locator('[data-coverage-detail]').isVisible(),false);
   const mortgageCoverageRow=page.locator('.coverage-table tbody tr').filter({hasText:'Mortgage'});
   await mortgageCoverageRow.locator('[data-coverage-cell]').nth(1).click();
   assert.match(await page.locator('.coverage-identify').innerText(),/Which predicted payment is your mortgage/);
   const identifiedMortgage=page.locator('.coverage-mortgage-option').filter({hasText:/Mortgage/}).first();
   assert.ok(await identifiedMortgage.count()>0,
    'The owner can identify a future mortgage straight from the current predictions');
   await identifiedMortgage.click();
   const savedMortgage=await page.evaluate(()=>JSON.parse(
    localStorage.getItem('household-planner-sample-settings-v1')||'{}').mortgageCoverageRules);
   assert.ok(savedMortgage?.checking||Object.values(savedMortgage||{}).some(r=>r?.merchant?.includes('mortgage')),
    'Mortgage identity persists only as a forecast preference, not a new transaction');
   assert.ok(await page.locator('.coverage-table tbody tr').filter({hasText:'Mortgage'})
    .locator('.coverage-cell.covered').count()>=1,
    'The same mortgage forecast series is marked covered after user confirmation');
   const incomeCoverageRow=page.locator('.coverage-table tbody tr').filter({hasText:'Income'});
   await incomeCoverageRow.locator('[data-coverage-cell]').nth(1).click();
   assert.match(await page.locator('.coverage-identify').innerText(),/Which deposits are recurring income/);
   const incomeOption=page.locator('[data-coverage-assign]').first();
   assert.ok(await incomeOption.count()>0,'Income coverage offers current predicted deposit series');
   await incomeOption.click();
   const remembered=await page.evaluate(()=>JSON.parse(
    localStorage.getItem('household-planner-sample-settings-v1')||'{}').coverageAssignments||{});
   assert.ok(Object.keys(remembered).some(k=>k.startsWith('income|')),
    'Income identity persists as classification only');
   await incomeCoverageRow.locator('[data-coverage-cell]').nth(1).click();
   assert.ok(await page.locator('.coverage-identify [data-coverage-assign].tracked').count()>0,
    'Known income is visibly marked as learned on return');
   const billCoverageRow=page.locator('.coverage-table tbody tr').filter({hasText:'Other major bills'});
   await billCoverageRow.locator('[data-coverage-cell]').nth(1).click();
   assert.match(await page.locator('.coverage-identify').innerText(),/Which large bills should be tracked/);
   const billOptions=page.locator('.coverage-identify [data-coverage-assign]');
   assert.ok(await billOptions.count()>0,'Other bills offer existing dated checking withdrawals');
   await billOptions.first().click();
   const savedCoverage=await page.evaluate(()=>JSON.parse(
    localStorage.getItem('household-planner-sample-settings-v1')||'{}').coverageAssignments||{});
   assert.ok(Object.keys(savedCoverage).some(k=>k.startsWith('other-bills|')),
    'Other bill classifications are remembered across Summary views');
   assert.match(await page.locator('.summary-trust').innerText(),/excludes unplanned everyday spending/i,
    'Summary explains what is excluded instead of claiming unwarranted accuracy');
   for(const days of [30,60,90,120,180,360]){
    await page.locator('[data-summary-days="'+days+'"]').click();
    assert.equal(await page.locator('#horizon').inputValue(),String(days));
    assert.match(await page.locator('.summary-end').innerText(),new RegExp('End of '+days+' days'));
    assert.match(await page.locator('[data-summary-plot]').getAttribute('aria-label'),new RegExp(days+'-day forecast'));
   }
   await page.locator('[data-summary-days="90"]').click();
   assert.equal(await page.locator('#horizon').isVisible(),false,
    'Summary shows only its six compact period chips, not a duplicate header selector');
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
   assert.ok((await page.locator('.chart-wrap svg').count())>0,'90-day chart is rendered from forecasting engine');
   assert.match(await page.locator('[aria-label="Selected account projection"]').innerText(),/Lowest balance · next 90 days/);
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
   await page.locator('#horizon').selectOption('30');
   assert.match(await page.locator('.chart-caption').innerText(),/projection/i);
   assert.match(await page.locator('[aria-label="Projected balance curve"] .section-title').innerText(),/30 days/);
   await page.locator('.account-tile').filter({hasText:'Rewards Visa'}).click();
   assert.match(await page.locator('.balance-main').innerText(),/\$810\.00/,'Credit card balance is shown as debt, not checking cash');
   assert.match(await page.locator('.hero-footnote').first().innerText(),/debt/);
   await page.locator('#horizon').selectOption('90');
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
   await page.locator('.future-edit-form [data-remove-recurring]').click();
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
   assert.deepEqual(await fourWeekRows.locator('.future-date').allInnerTexts(),
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
   assert.deepEqual(await payRows.locator('.future-date').allInnerTexts(),
    ['Nov 6','Nov 20','Dec 4','Dec 18','Jan 1','Jan 15'],
    'Two four-week streams combine to provide one payday every 14 days');
   assert.deepEqual((await payRows.locator('.future-amount').allInnerTexts())
    .map(x=>x.replace(/[^0-9.]/g,'')),['3020.00','3075.00','3020.00','3075.00','3020.00','3075.00'],
    'The two separate recurring deposits preserve their own amounts');
   assert.equal(await page.evaluate(()=>JSON.parse(
    localStorage.getItem('household-planner-sample-settings-v1')||'{}')
     .futureRecurringRules?.filter(x=>x.merchant==='Alternating Employer Paycheck').length),2,
    'Same employer creates exactly two independent saved rules');
   await payRows.first().locator('[data-edit-future]').click();
   const editPay=page.locator('.future-edit-form');
   await editPay.locator('[name=scope][value=all]').check();
   await editPay.locator('[name=amount]').fill('3040');
   await editPay.locator('button[type=submit]').click();
   assert.deepEqual((await page.locator('.future-item').filter({hasText:'Alternating Employer Paycheck'})
     .locator('.future-amount').allInnerTexts()).map(x=>x.replace(/[^0-9.]/g,'')),
    ['3040.00','3075.00','3040.00','3075.00','3040.00','3075.00'],
    'Editing one four-week schedule does not alter the alternate paycheck');
   await page.reload({waitUntil:'load'});
   await go('transactions');
   assert.equal(await page.locator('.future-item').filter({hasText:'Alternating Employer Paycheck'}).count(),6,
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
   assert.match(await page.locator('.calendar-math').innerText(),/Yesterday/);
   assert.match(await page.locator('.calendar-math').innerText(),/Deposits/);
   assert.match(await page.locator('.calendar-math').innerText(),/Withdrawals/);
   assert.match(await page.locator('.calendar-math').innerText(),/End of day/);
   await page.locator('[data-calendar-add]').click();
   const quick=page.locator('[data-calendar-quick-form]');
   assert.equal(await quick.locator('[name=date]').inputValue(),'2026-11-09');
   await quick.locator('[name=merchant]').fill('Playground one-time expense');
   await quick.locator('[name=amount]').fill('25');
   await quick.locator('button[type=submit]').click();
   await page.locator('.calendar-detail-item').filter({hasText:'Playground one-time expense'}).waitFor();
   assert.ok(await page.locator('.calendar-notice').innerText().then(x=>x.includes('recalculated')));
   const playground=page.locator('.calendar-detail-item').filter({hasText:'Playground one-time expense'});
   await playground.locator('[data-calendar-edit]').click();
   assert.equal(await quick.locator('[name=amount]').inputValue(),'25',
    'Existing predicted transaction opens in the calendar editor');
   await quick.locator('[name=amount]').fill('40');
   await quick.locator('button[type=submit]').click();
   assert.match(await page.locator('.calendar-detail-item')
    .filter({hasText:'Playground one-time expense'}).innerText(),/\$40\.00/);
   await page.reload({waitUntil:'load'});
   await page.locator('[data-calendar-nav="1"]').click();
   await page.locator('[data-calendar-day="2026-11-09"]').click();
   assert.match(await page.locator('.calendar-detail-item')
    .filter({hasText:'Playground one-time expense'}).innerText(),/\$40\.00/,
    'Calendar-only edits persist across reload');
   await page.locator('.calendar-detail-item')
    .filter({hasText:'Playground one-time expense'}).locator('[data-calendar-edit]').click();
   await quick.locator('[data-calendar-skip]').click();
   assert.equal(await page.locator('.calendar-detail-item')
    .filter({hasText:'Playground one-time expense'}).count(),0,
    'Skipping a selected occurrence removes it from the same balance forecast');
   await page.locator('[data-calendar-day="2026-11-11"]').click();
   await page.locator('[data-calendar-add]').click();
   await quick.locator('[name=merchant]').fill('Playground recurring payment');
   await quick.locator('[name=amount]').fill('90');
   await quick.locator('[name=frequency]').selectOption('monthly');
   await quick.locator('button[type=submit]').click();
   await page.locator('.calendar-detail-item')
    .filter({hasText:'Playground recurring payment'}).waitFor();
   await page.locator('[data-calendar-nav="1"]').click();
   await page.locator('[data-calendar-day="2026-12-11"]').click();
   assert.ok(await page.locator('.calendar-detail-item')
    .filter({hasText:'Playground recurring payment'}).count()>0,
    'Creating a recurring expense from one calendar date creates its next month too');

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
  await page.locator('[data-summary-days="60"]').click();
  assert.equal(await page.locator('.coverage-month').count(),3,
   '60 days from mid-October includes three calendar-month segments');
  const preCard=page.locator('.coverage-table tbody tr').filter({hasText:'Household Visa'});
  assert.equal(await preCard.locator('.coverage-cell.setup').count(),3,
   'Connected card alone is never considered a planned future withdrawal');
  assert.ok(await page.locator('.coverage-table tbody tr').filter({hasText:'Mortgage'})
   .locator('.coverage-cell.covered,.coverage-cell.review').count()>=1,
   'Mortgage forecasts are visible; overlapping inferred mortgages must be flagged rather than silently approved');
  await page.locator('[data-summary-days="90"]').click();
  assert.equal(await page.locator('#horizon').inputValue(),'90');
  await page.locator('[data-summary-days="180"]').click();
  assert.equal(await page.locator('#horizon').inputValue(),'180',
   'Real private forecast recalculates longer ranges from the bank ledger');
  assert.match(await page.locator('.summary-end').innerText(),/End of 180 days/);
  await go('overview');
  assert.equal(await page.locator('.account-tile').count(),2);
  assert.equal(await page.locator('.balance-main').innerText(),'$4,800.00',
   'Real checking starts at bank-reported available cash, not credit card debt');
  await page.locator('#horizon').selectOption('90');
  assert.match(await page.locator('.income-status').innerText(),/PREDICTED/i,
   'Recurring payroll categorized by Plaid as TRANSFER_IN now reaches projected income');
  assert.match(await page.locator('.income-status').innerText(),/3 dated deposits · \$9,300/,
   'Income summary accurately totals three inferred $3,100 future paychecks');
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
  await page.locator('[data-summary-days="60"]').click();
  await page.locator('.summary-extras > summary').click();
  const cardCoverage=page.locator('.coverage-table tbody tr').filter({hasText:'Household Visa'});
  assert.equal(await cardCoverage.locator('.coverage-cell.covered').count(),2,
   'November and December both contain actual linked checking withdrawals');
  for(const column of [1,2]){
   await cardCoverage.locator('[data-coverage-cell]').nth(column).click();
   assert.match(await page.locator('[data-coverage-detail]').innerText(),
    /Credit-card payment is included as a single linked withdrawal/);
   assert.match(await page.locator('.coverage-detail-event').first().innerText(),/Household Visa.*autopay/i);
  }
  assert.ok(await page.locator('.coverage-table tbody tr').filter({hasText:'Mortgage'})
   .locator('.coverage-cell.covered,.coverage-cell.review').count()>=2,
   'Both upcoming mortgage periods are shown or flagged for competing predicted withdrawals');
  await page.locator('[data-summary-days="90"]').click();
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
  assert.equal(predictedDatesBefore,3,'Automatic mortgage estimate appears once per upcoming month');
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
  assert.equal(await singleMortgage.count(),2,
   'November and December have one user-confirmed mortgage each, without the inferred duplicate');
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
   .first().locator('[data-history-plan]').getByText('Edit forecast',{exact:true}).waitFor();
  assert.ok(writes.some(x=>x.predictions?.futureRecurringRules?.some(r=>
   r.merchant==='Storage Unit Monthly'&&r.amount===79&&r.accountId==='checking-real')),
   'Low-confidence candidate becomes a saved private rule only after approval');
  const storage=await page.evaluate(()=>({...localStorage}));
  assert.equal(Object.keys(storage).some(k=>JSON.stringify(storage[k]).includes('mort-4')),false,
   'Raw Real bank transactions are not written to localStorage');
  assert.deepEqual(errors,[]);
  await real.close();
  console.log('PASS compact planner in desktop Chromium and iPhone WebKit: Demo, Real no-fallback, Real Plaid-shaped balances, mortgage future cash, card debt, 30/90 horizon, refresh, privacy, mobile layout');
 }finally{
  if(chrome)await chrome.close();if(iphone)await iphone.close();
  for(const child of children)child.kill('SIGTERM');
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});