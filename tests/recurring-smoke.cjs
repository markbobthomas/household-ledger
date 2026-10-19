const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {analyze}=require('../recurring.js');
const today='2026-10-16';
const context={window:{}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../demo-data.js'),'utf8'),context);
const sample=context.window.createHouseholdLedgerDemo().transactions;
const report=analyze(sample,today);
assert.ok(report.subscriptions.some(x=>x.merchant==='Netflix'&&x.monthlyEstimate===17.99&&x.cadence==='Monthly'),'Netflix must be a detected monthly subscription');
assert.ok(report.subscriptions.some(x=>x.merchant==='Spotify'&&x.monthlyEstimate===11.99),'Spotify must be a detected subscription');
assert.ok(report.bills.some(x=>x.merchant==='Mortgage'),'Regular mortgage is detected');
assert.ok(report.bills.some(x=>x.merchant==='Puget Sound Energy'),'Variable monthly utility is detected');
assert.ok(!report.confirmed.some(x=>['Amazon','Safeway','Costco Warehouse','Home Depot','Kids Activities'].includes(x.merchant)),'Routine shopping and hobby purchases are excluded');
assert.equal(report.monthlyTotal,Math.round((report.subscriptionMonthly+report.billsMonthly)*100)/100,'Detected monthly estimates sum consistently');
const novel=[{id:'one',date:'2026-10-04',merchant:'New Subscription',amount:14.95,type:'expense',category:'Subscriptions',account:'Checking'}];
const unconfirmed=analyze(novel,today);
assert.equal(unconfirmed.confirmed.length,0,'Single subscription is not automatically confirmed');
assert.equal(unconfirmed.review.length,1,'Single subscription is shown for review');
assert.equal(unconfirmed.monthlyTotal,0,'Unconfirmed charge should not inflate monthly recurring forecast');

// A user schedule is authoritative for predictions, independently of historical detection.
const Model=require('../ledger-data.js'),Forecast=require('../forecast.js'),Shared=require('../forecast-ledger.js');
const manual=Model.migrate({transactions:[{...novel[0],id:'manual-1'}]});
const ruleKey=Forecast.patternKey('expense','Subscriptions','Checking','New Subscription');
Model.setPatternRule(manual,ruleKey,{mode:'schedule',frequency:'monthly',anchorDate:'2026-10-04',day:4,amount:14.95});
const manualReport=analyze(Model.records(manual),today,manual.predictions.patternRules);
assert.equal(manualReport.review.length,0,'Manually scheduled subscription leaves review');
assert.equal(manualReport.subscriptions[0].monthlyEstimate,14.95,'Manual schedule appears in recurring totals');
assert.equal(manualReport.subscriptions[0].nextExpected,'2026-11-04','Manual schedule next due is shown');
assert.ok(Shared.build(manual,Model.records(manual),today,90,Forecast,Model).events.some(e=>
 e.merchant==='New Subscription'&&e.date==='2026-11-04'),'Same saved rule predicts future Ledger payment');
Model.setPatternRule(manual,ruleKey,{mode:'none'});
const stopped=analyze(Model.records(manual),today,manual.predictions.patternRules);
assert.equal(stopped.subscriptionMonthly,0,'Not recurring suppresses subscription monthly total');
assert.equal(stopped.suppressed.length,1,'Not recurring stays visible for reopening');
assert.equal(stopped.review.length,0,'Explicitly rejected recurrence is not requested again');
Model.setPatternRule(manual,ruleKey,null);
assert.equal(analyze(Model.records(manual),today,manual.predictions.patternRules).review.length,1,'Reset restores review');
assert.equal(manual.transactions[0].category,'Subscriptions','No recurrence action changes original transaction');
const pending=analyze([{...novel[0],pending:true}],today);
assert.equal(pending.review.length,0,'Pending bank charges do not count as independent posted recurrence evidence');

(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1300,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const Base=Date;class FakeDate extends Base{constructor(...args){if(args.length)super(...args);else super('2026-10-16T12:00:00Z')}static now(){return new Base('2026-10-16T12:00:00Z').getTime()}}window.Date=FakeDate});
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  await page.locator('aside [data-page="insights"]').click();
  assert.equal(await page.locator('[data-insight]').count(),5,'Insights has five tabs including the separate accuracy lab');
  await page.locator('[data-insight="recurring"]').click();
  assert.equal(await page.locator('[data-insight="recurring"]').getAttribute('aria-selected'),'true');
  assert.match(await page.locator('.recurring-stats').innerText(),/Subscriptions \/ month/);
  const subscriptionPanel=page.locator('.recurring-panel').first();
  assert.match(await subscriptionPanel.innerText(),/Netflix/);
  assert.match(await subscriptionPanel.innerText(),/Spotify/);
  const netflix=subscriptionPanel.locator('details.recurring-detail').filter({has:page.locator('summary strong:text-is("Netflix")')});
  assert.equal(await netflix.count(),1,'Netflix appears once in subscriptions');
  assert.equal(await netflix.evaluate(el=>el.open),false,'Subscription starts collapsed');
  await netflix.locator('summary').click();
  assert.equal(await netflix.evaluate(el=>el.open),true,'Subscription opens on click');
  assert.equal(await page.locator('#period').inputValue(),'2026-10','Subscriptions start on current month');
  assert.equal(await netflix.locator('[data-category]').count(),1,'Current month shows only its charge');
  await page.locator('#period').selectOption('all');
  const allNetflix=page.locator('.recurring-panel').first().locator('details.recurring-detail').filter({has:page.locator('summary strong:text-is("Netflix")')});
  await allNetflix.locator('summary').click();
  assert.ok(await allNetflix.locator('[data-category]').count()>=2,'All dates reveals the full subscription history');
  assert.equal(await allNetflix.locator('select[data-category]').first().locator('option').count(),12,
   'Recurring source transactions have an inline category dropdown');
  assert.equal(await page.locator('#entry').count(),0,'No separate category editor');
  assert.equal(await allNetflix.locator('td:nth-child(5) input').count(),0,'Recurring charge amount is read-only');
  await page.locator('#period').selectOption('2026-09');
  const septemberNetflix=page.locator('.recurring-panel').first().locator('details.recurring-detail').filter({has:page.locator('summary strong:text-is("Netflix")')});
  await septemberNetflix.locator('summary').click();
  const dates=await septemberNetflix.locator('tbody tr td:first-child').allInnerTexts();
  assert.ok(dates.length>=1&&dates.every(x=>x.startsWith('2026-09')),'Date selection limits underlying transactions');
  assert.match(await page.locator('.recurring-stats').innerText(),/\$29\.98/,'History-wide subscription estimate persists despite date filter');

  // A single posted subscription was previously review-only with no controls.
  await page.evaluate(()=>{
   const key='household-ledger-v1',state=JSON.parse(localStorage.getItem(key));
   state.transactions.push({id:'subscription-to-schedule',date:'2026-10-04',merchant:'New Experimental Membership',
     amount:14.95,type:'expense',category:'Subscriptions',account:'Checking',pending:false,
     source:{provider:'demo',verified:false}});
   localStorage.setItem(key,JSON.stringify(state));
  });
  await page.reload({waitUntil:'load'});
  await page.locator('aside [data-page=insights]').click();
  await page.locator('[data-insight=recurring]').click();
  const reviewEntry=page.locator('.recurring-detail').filter({has:page.locator('summary strong:text-is("New Experimental Membership")')});
  assert.equal(await reviewEntry.count(),1,'Categorized subscription with limited history is visible');
  assert.ok(await page.locator('.recurring-panel').filter({hasText:'Subscriptions to review'}).locator('.recurring-detail').filter({hasText:'New Experimental Membership'}).count(),'Review list is actionable');
  await reviewEntry.locator(':scope > summary').click();
  await reviewEntry.locator('[data-recurring-open]').click();
  const editor=reviewEntry.locator('.recurring-control-shell [data-recurring-form]');
  assert.equal(await editor.locator('[name=frequency]').inputValue(),'monthly','Manual schedule opens right on reviewed subscription');
  assert.equal(await editor.locator('[name=amount]').inputValue(),'14.95');
  await editor.locator('[data-recurring-save]').click();
  const scheduled=page.locator('.recurring-detail').filter({has:page.locator('summary strong:text-is("New Experimental Membership")')});
  assert.ok(await page.locator('.recurring-panel').first().locator('.recurring-detail').filter({hasText:'New Experimental Membership'}).count(),'Confirmed subscription moves into recurring list');
  assert.match(await scheduled.locator(':scope > summary').innerText(),/\$14\.95 \/ mo/);
  const afterSave=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  const scheduleKey=Forecast.patternKey('expense','Subscriptions','Checking','New Experimental Membership');
  assert.equal(afterSave.predictions.patternRules[scheduleKey].frequency,'monthly','Schedule is persisted as a separate forecast rule');
  assert.equal(afterSave.transactions.find(t=>t.id==='subscription-to-schedule').amount,14.95,'Original charge remains immutable');
  assert.ok(await scheduled.evaluate(e=>e.open),'Edited subscription remains expanded in Insights');
  await scheduled.locator('[data-recurring-open]').click();
  await scheduled.locator('[name=amount]').fill('16.25');
  await scheduled.locator('[data-recurring-save]').click();
  assert.match(await scheduled.locator(':scope > summary').innerText(),/\$16\.25 \/ mo/,'Edited schedule updates recurring total');
  await scheduled.locator('[data-recurring-disable]').click();
  assert.ok(await page.locator('.recurring-panel').filter({hasText:'Marked not recurring'}).locator('.recurring-detail').filter({hasText:'New Experimental Membership'}).count(),'Disabled subscription is reviewable without being forecast');
  await scheduled.locator('[data-recurring-reset]').click();
  assert.equal(await page.locator('.recurring-detail').filter({hasText:'New Experimental Membership'}).count(),1,'Reset preserves one review candidate');
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')))).predictions.patternRules[scheduleKey],undefined);
  await page.setViewportSize({width:390,height:844});
  const dimensions=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  assert.ok(dimensions.document<=dimensions.viewport+1,'No horizontal document overflow on phone: '+JSON.stringify(dimensions));
  await page.locator('[data-insight="bands"]').click();
  assert.equal(await page.locator('details.band-detail').count(),7,'Previous price-band analysis remains reachable');
  assert.deepEqual(errors,[],'No runtime errors');
  console.log('PASS: Five Insights tabs, subscriptions, recurring bills, category-only histories, date filter, review confidence and mobile layout');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
