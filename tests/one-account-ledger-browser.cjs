'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-live-browser-')),port=19848,pass=crypto.randomBytes(24).toString('hex');
 const child=spawn(process.execPath,['sandbox/server.cjs'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,HOSTED_SANDBOX:'1',LIVE_PLAID_ENABLED:'1',PORT:String(port),PILOT_PASSWORD:pass,PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'placeholder',PLAID_SECRET:'placeholder',PLAID_ENV:'sandbox',PILOT_STATE_PATH:path.join(dir,'pilot.enc'),SANDBOX_TEST_PASSWORD:pass},stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:'+port+'/healthz');if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
  browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({httpCredentials:{username:'pilot',password:pass}});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'load'});
  assert.equal(await page.locator('aside [data-page=settings]').count(),1);
  await page.locator('aside [data-page=settings]').click();
  await page.locator('#ledger-mode-switch').waitFor();
  assert.equal(await page.locator('#ledger-mode-switch').inputValue(),'demo');
  await page.locator('#ledger-mode-switch').selectOption('real');
  await page.waitForFunction(()=>{const choice=document.querySelector('#ledger-mode-switch');
   return choice?.value==='demo'&&!choice.disabled;});
  assert.equal(await page.locator('#ledger-mode-switch').inputValue(),'demo','Cannot enter Real without a connected account');
  await page.locator('#add-custom-category [name=name]').fill('Pet supplies');
  await page.locator('#add-custom-category button[type=submit]').click();
  assert.ok((await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')))).customCategories.includes('Pet supplies'),'Demo category creation uses original Ledger state');
  const bankTest=await ctx.newPage(),postedDate=new Date().toISOString().slice(0,10);
  let currentBalance=1000,availableBalance=950,lastSync=new Date().toISOString(),balanceObservedAt=lastSync;
  await bankTest.route('**/api/ledger',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   connected:true,lastSync,
   account:{id:'acct-1',name:'Test Checking',type:'depository',subtype:'checking',current:currentBalance,available:availableBalance,balanceObservedAt},
   adjustments:{},transactions:[
    {id:'posted',date:postedDate,merchant:'Cafe',amount:25,pending:false,category:{primary:'FOOD_AND_DRINK',detailed:'FOOD_AND_DRINK_RESTAURANT',confidence_level:'HIGH'}},
    {id:'pending',date:postedDate,merchant:'Pending cafe',amount:60,pending:true,category:{primary:'FOOD_AND_DRINK'}},
    {id:'transfer',date:postedDate,merchant:'Savings transfer',amount:400,pending:false,category:{primary:'TRANSFER_OUT'}},
    {id:'unknown',date:postedDate,merchant:'Mystery',amount:19,pending:false,category:null},
    {id:'membership',date:postedDate,merchant:'Example Membership',amount:14.95,pending:false,category:null}]
  })}));
  let syncCount=0;
  await bankTest.route('**/api/sync',route=>{
   syncCount++;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  });
  let adjustments=[];
  await bankTest.route('**/api/ledger/adjustments',async route=>{adjustments.push(route.request().postDataJSON());await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({saved:true})})});
  const errorsReal=[];bankTest.on('pageerror',e=>errorsReal.push(e.message));
  await bankTest.goto('http://127.0.0.1:'+port+'/',{waitUntil:'load'});
  await bankTest.locator('aside [data-page=settings]').click();
  await bankTest.locator('#ledger-mode-switch').selectOption('real');
  await bankTest.locator('#demo-banner').getByText('REAL BANK · PLAID').waitFor();
  // Connected Plaid Overview must never inherit Demo's "bank not connected" status.
  await bankTest.locator('aside [data-page=overview]').click();
  const summary=bankTest.locator('[aria-label="Household overview summary"]');
  assert.match(await summary.locator('[data-overview-source]').innerText(),/1 connected account/);
  assert.match(await summary.locator('[data-overview-coverage]').innerText(),/not necessarily every household account/);
  assert.match(await summary.locator('[data-bank-sync]').innerText(),/Last successful transaction sync/);
  assert.equal(await summary.locator('.bank-overview-account [aria-label="Bank-reported current"]').innerText(),'$1,000.00');
  assert.match(await summary.locator('.bank-overview-available').innerText(),/\$950\.00/);
  assert.match(await bankTest.locator('#cashflow .feed-health').innerText(),/recent sync reported/i,
   'Plaid is recognized by feed health as connected');
  assert.doesNotMatch(await bankTest.locator('#view').innerText(),/bank not connected|no connected bank feed/i);
  assert.match(await bankTest.locator('#cashflow .cash-secondary').innerText(),/Bank-reported available[\s\S]*\$950\.00/i,
   'Projection starts with available balance and labels it as available, not current');
  assert.equal(await bankTest.locator('#cashflow .cash-chart').count(),1,'Fresh linked checking account supports a forecast');
  // Clicking Refresh must perform a genuine authenticated bank sync, then fetch fresh reported balances.
  currentBalance=1234.56;availableBalance=1211.11;
  await bankTest.locator('[data-refresh-bank]').first().click();
  await bankTest.locator('.bank-overview-account [aria-label="Bank-reported current"]').getByText('$1,234.56').waitFor();
  assert.equal(syncCount,1,'Real Overview refresh called the bank sync endpoint');
  assert.match(await bankTest.locator('.bank-overview-available').innerText(),/\$1,211\.11/,
   'Fresh available is separate from unchanged current');
  assert.match(await bankTest.locator('#cashflow .cash-secondary').innerText(),/\$1,211\.11/);
  // A stale bank snapshot is still disclosed as last reported, never projected as current cash.
  lastSync=new Date(Date.now()-5*86400000).toISOString();
  balanceObservedAt=lastSync;
  await bankTest.locator('[data-refresh-bank]').first().click();
  await bankTest.locator('#cashflow').getByText('90-day cash forecast unavailable').waitFor();
  assert.equal(await bankTest.locator('#cashflow .cash-chart').count(),0,'No 90-day cash chart from stale bank data');
  assert.match(await summary.locator('.bank-overview-account').innerText(),/Last reported · stale/);
  assert.equal(await summary.locator('.bank-overview-account [aria-label="Bank-reported current"]').innerText(),'$1,234.56');
  assert.equal(syncCount,2);
  // Restore a fresh fixture for remaining shared-mode regression tests.
  lastSync=new Date().toISOString();balanceObservedAt=lastSync;
  await bankTest.locator('[data-refresh-bank]').first().click();
  await bankTest.locator('#cashflow .cash-chart').waitFor();
  assert.equal(syncCount,3);
  await bankTest.locator('aside [data-page=budgets]').click();
  assert.equal(await bankTest.locator('.budget-entry[data-budget-category="Groceries"]').count(),1,'Original category budget rows retained');
  assert.equal(await bankTest.locator('section[aria-label="Overall monthly budget"]').count(),1,'Same overall budget renderer');
  await bankTest.locator('aside [data-page=transactions]').click();
  const editor=bankTest.locator('select[data-category="posted"]').first();
  await editor.waitFor();
  await editor.selectOption('Groceries');
  for(let i=0;i<60&&!adjustments.some(a=>a.categoryOverrides?.posted==='Groceries');i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(adjustments.some(a=>a.categoryOverrides?.posted==='Groceries'),'Category edit saved via encrypted server preferences');
  // Health category: only a posted expense counts as spending. Pending charges and
  // transfers are visible under Health without being mistaken for spending.
  await bankTest.locator('select[data-category="posted"]').selectOption('Health');
  await bankTest.locator('select[data-category="pending"]').selectOption('Health');
  await bankTest.locator('select[data-category="transfer"]').selectOption('Health');
  await bankTest.locator('aside [data-page=budgets]').click();
  const health=bankTest.locator('.budget-entry[data-budget-category="Health"]');
  assert.equal(await health.locator('.budget-summary-amount').innerText(),'$25.00','Health spent is the posted charge only');
  assert.match(await health.locator(':scope > details > summary').innerText(),/Pending \$60\.00 · not yet counted/,'Pending Health category visible');
  assert.match(await health.locator(':scope > details > summary').innerText(),/1 categorized item not counted as spending/,'Health transfer exclusion disclosed');
  await health.locator(':scope > details > summary').click();
  assert.equal(await health.locator('.recorded-section').first().locator('select[data-category="posted"]').count(),1,'Posted Health expense listed');
  assert.equal(await health.locator('.recorded-section').first().locator('select[data-category="pending"]').count(),0,'Pending not falsely recorded');
  assert.equal(await health.locator('.budget-pending-section select[data-category="pending"]').count(),1,'Pending Health visible separately');
  assert.equal(await health.locator('.budget-excluded-section select[data-category="transfer"]').count(),1,'Health transfer visible separately');
  await bankTest.locator('aside [data-page=settings]').click();
  await bankTest.locator('#add-custom-category [name=name]').fill('Hobbies');
  await bankTest.locator('#add-custom-category button[type=submit]').click();
  for(let i=0;i<60&&!adjustments.some(a=>a.customCategories?.includes('Hobbies'));i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(adjustments.some(a=>a.customCategories?.includes('Hobbies')),'Real category creation is persisted separately');
  // Category review must update every view, even if destination has no budget cap.
  await bankTest.locator('aside [data-page=reviews]').click();
  const review=bankTest.locator('.review-task').filter({hasText:'Mystery'}).first();
  await review.locator('summary').click();
  const reviewForm=review.locator('form[data-review-category]');
  await reviewForm.waitFor();
  await reviewForm.locator('select[name=category]').selectOption('Hobbies');
  await reviewForm.locator('button[type=submit]').click();
  await bankTest.locator('aside [data-page=transactions]').click();
  assert.equal(await bankTest.locator('select[data-category="unknown"]').inputValue(),'Hobbies','Reviewed category updates Activity');
  await bankTest.locator('aside [data-page=insights]').click();
  await bankTest.locator('[data-insight=categories]').click();
  const categoryInsights=bankTest.locator('[data-report-group="category|Hobbies"]');
  await categoryInsights.waitFor();
  assert.ok((await categoryInsights.innerText()).includes('$19.00'),'Reviewed category updates Insights');
  await bankTest.locator('aside [data-page=budgets]').click();
  const hobbies=bankTest.locator('.budget-entry[data-budget-category="Hobbies"]');
  assert.ok((await hobbies.locator('.budget-summary-amount').innerText()).includes('$19.00'),'Uncapped reviewed category appears in Budget');
  assert.equal(await hobbies.locator('[data-inline-budget]').innerText(),'Set cap');
  await hobbies.locator('[data-inline-budget]').click();
  await hobbies.locator('.inline-money-input').fill('100');
  await hobbies.locator('.inline-money-input').press('Enter');
  assert.ok((await hobbies.locator('.budget-summary-amount').innerText()).includes('$19.00'),'Adding cap retains actual reviewed spending');
  assert.equal(await hobbies.locator('[data-inline-budget]').innerText(),'$100.00');
  for(let i=0;i<60&&!adjustments.some(a=>a.categoryOverrides?.unknown==='Hobbies'&&a.predictions?.monthlyBudgets?.Hobbies===100);i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(adjustments.some(a=>a.categoryOverrides?.unknown==='Hobbies'),'Review override posted to encrypted server preferences');
  assert.ok(adjustments.some(a=>a.predictions?.monthlyBudgets?.Hobbies===100),'Real budget cap posted to server preferences');
  // An actual Plaid-shaped single subscription has no automatic schedule.
  // It must be actionable in the same recurring Insights editor as Demo.
  await bankTest.locator('aside [data-page=transactions]').click();
  await bankTest.locator('select[data-category="membership"]').selectOption('Subscriptions');
  await bankTest.locator('aside [data-page=insights]').click();
  await bankTest.locator('[data-insight=recurring]').click();
  const membership=bankTest.locator('.recurring-detail').filter({has:bankTest.locator('summary strong:text-is("Example Membership")')});
  assert.equal(await membership.count(),1,'Real subscription with one charge appears for review');
  await membership.locator(':scope > summary').click();
  await membership.locator('[data-recurring-open]').click();
  const scheduleForm=membership.locator('.recurring-control-shell [data-recurring-form]');
  assert.equal(await scheduleForm.locator('[name=frequency]').inputValue(),'monthly','Real subscriptions can set schedules');
  await scheduleForm.locator('[data-recurring-save]').click();
  const subscriptionRule=['expense','Subscriptions','acct-1','example membership'].map(encodeURIComponent).join('|');
  for(let i=0;i<80&&!adjustments.some(a=>a.predictions?.patternRules?.[subscriptionRule]?.mode==='schedule');i++)
   await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(adjustments.some(a=>a.predictions?.patternRules?.[subscriptionRule]?.frequency==='monthly'),
   'Real subscription schedule persists in encrypted server adjustments');
  assert.match(await membership.locator(':scope > summary').innerText(),/\$14\.95 \/ mo/,'Manually scheduled Real subscription counted immediately');
  await membership.locator('[data-recurring-disable]').click();
  assert.equal(await membership.count(),1,'Real disabled schedule remains available to reverse');
  for(let i=0;i<80&&!adjustments.some(a=>a.predictions?.patternRules?.[subscriptionRule]?.mode==='none');i++)
   await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(adjustments.some(a=>a.predictions?.patternRules?.[subscriptionRule]?.mode==='none'),
   'Real Not recurring choice persists without modifying bank facts');
  const stored=await bankTest.evaluate(()=>localStorage.getItem('household-ledger-v1'));
  assert.equal(stored.includes('posted'),false,'Real bank source transactions never written to localStorage');
  await bankTest.locator('aside [data-page=insights]').click();
  assert.equal(await bankTest.locator('[data-insight=merchants]').count(),1,'Original insights controls retained');
  assert.equal(await bankTest.locator('[data-insight=recurring]').count(),1,'Original recurring analysis retained');
  await bankTest.locator('aside [data-page=reviews]').click();
  assert.equal(await bankTest.locator('.review-filters').count(),1,'Original Reviews controls retained');
  await bankTest.locator('aside [data-page=overview]').click();
  assert.equal(await bankTest.locator('#cashflow').count(),1,'Original 90-day forecast retained');
  assert.equal(await bankTest.locator('#real-mode-surface').count(),0,'Second interface eliminated');
  assert.deepEqual(errorsReal,[],'No JS errors after data-source switching');
  await bankTest.close();
  await page.goto('http://127.0.0.1:'+port+'/bank-connect',{waitUntil:'load'});
  await page.locator('#connect').waitFor();
  await page.locator('#status').getByText('No account connected').waitFor();
  assert.deepEqual(errors,[],'No runtime JavaScript errors in live Ledger or connection screen');
  console.log('PASS private existing Ledger navigation, bank UI, connection screen, no browser exceptions');
 }finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
