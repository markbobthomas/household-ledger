const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const names=[['budgets','Budget'],['overview','Overview'],['transactions','Activity'],
 ['insights','Insights'],['reviews','Reviews'],['settings','Settings']];
async function check(browser,options,mobile){
 const page=await browser.newPage(options),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Actual=Date;
  class Fixed extends Actual{
   constructor(...args){if(args.length)super(...args);else super('2026-10-17T12:00:00Z')}
   static now(){return new Actual('2026-10-17T12:00:00Z').getTime()}
  }
  window.Date=Fixed;
 });
 const nav=key=>page.locator(mobile?'.mobile-top-nav [data-page="'+key+'"]':'aside [data-page="'+key+'"]');
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  assert.equal(await page.locator('#title').innerText(),'Budgets','Budget is the factory-default opening tab');
  assert.equal(await page.locator('#cashflow').count(),0,'Budget contains no 90-day forecast panel');
  assert.ok(await page.locator('.budget-entry').count()>=12,'Monthly categories remain in Budget');
  assert.ok(await page.locator('[data-inline-budget]').count()>=12,'In-place cap editing remains in Budget');
  assert.ok(await page.locator('#period').isVisible(),'Budget retains its month selector');
  assert.deepEqual(await page.locator('aside button[data-page]').allInnerTexts(),
   names.map(([,name])=>name));
  if(mobile)assert.deepEqual(await page.locator('.mobile-top-nav button').allInnerTexts(),
   names.map(([,name])=>name));
  const before=await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.getItem('household-ledger-v1'))));
  await nav('overview').click();
  assert.equal(await page.locator('#title').innerText(),'Overview');
  assert.equal(await page.locator('#cashflow').count(),1,'Cash projection belongs on Overview');
  const mainBalance=page.locator('.overview-current .overview-balance-value');
  assert.equal(await mainBalance.innerText(),'$5,650.25','The primary balance is the bank-feed current balance, not net transaction flow');
  assert.match(await page.locator('.overview-current .overview-available').innerText(),/\$5,400\.25/,'Available is secondary and separate');
  const historical=page.locator('details.overview-history-details');
  assert.equal(await historical.count(),1,'Old history totals remain available below the forecast');
  assert.equal(await historical.evaluate(el=>el.open),false,'Loaded spending and income are collapsed by default');
  assert.ok(await historical.evaluate(el=>!!el.querySelector('.stat')),'Historical numbers are retained, not discarded');
  const hierarchy=await page.evaluate(()=>{
   const current=document.querySelector('.overview-balance-value'),
    low=document.querySelector('#cashflow .cash-primary-amount'),
    history=document.querySelector('.overview-history-details');
   return {positions:[current,low,history].map(el=>el?.getBoundingClientRect().top+window.scrollY),
    currentFont:parseFloat(getComputedStyle(current).fontSize),
    lowFont:parseFloat(getComputedStyle(low).fontSize)};
  });
  assert.ok(hierarchy.positions[0]<hierarchy.positions[1]&&hierarchy.positions[1]<hierarchy.positions[2],
   'Visual reading order is current balance, projected low, then collapsed history');
  assert.ok(hierarchy.currentFont>hierarchy.lowFont,'Current balance has larger type than projected low');
  await historical.locator(':scope > summary').click();
  assert.match(await historical.innerText(),/Recorded spending · loaded history/);
  await historical.locator(':scope > summary').click();

  assert.equal(await page.locator('.budget-entry').count(),0,'Overview omits the category budget list');
  assert.ok(await page.locator('.account-projection-row').count()>=4,'All account predictions moved intact');
  assert.equal(await page.locator('svg.cash-chart').count(),1,'90-day chart moved intact');
  assert.equal(await page.locator('.account-plan-detail').count(),1,'Payment planner remains in Overview');
  assert.equal(await page.locator('.account-reliability').count(),1,'Reconciliation tools remain in Overview');
  assert.equal(await page.locator('#period').isVisible(),false,'Overview has a fixed 90-day window, no misleading month filter');
  assert.equal(await nav('overview').getAttribute('class'),'active');
  const chart=await page.locator('#cashflow .cash-primary-amount').innerText();
  await nav('budgets').click();
  assert.equal(await page.locator('#cashflow').count(),0);
  assert.ok(await page.locator('.budget-entry').count()>=12);
  await nav('settings').click();
  const selector=page.locator('#default-page');
  assert.equal(await selector.isVisible(),true,'Settings has Menu preferences start-page control');
  assert.match(await page.locator('.menu-preferences').innerText(),/Default opening tab/);
  assert.deepEqual(await selector.locator('option').allInnerTexts(),names.map(x=>x[1]));
  assert.equal(await selector.inputValue(),'budgets');
  await selector.selectOption('overview');
  assert.equal(await page.evaluate(()=>localStorage.getItem('household-ledger-default-page')),'overview');
  assert.equal(await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.getItem('household-ledger-v1')))),before,
   'Changing startup tab cannot rewrite bank facts, categories, or predictions');
  assert.equal(await page.locator('#title').innerText(),'Settings','Changing startup tab does not navigate unexpectedly');
  await page.reload({waitUntil:'load'});
  assert.equal(await page.locator('#title').innerText(),'Overview','Overview is remembered as the startup tab');
  assert.equal(await page.locator('#cashflow .cash-primary-amount').innerText(),chart,
   'Forecast is unchanged by the starting-tab preference');
  assert.ok(await nav('overview').evaluate(e=>e.classList.contains('active')));
  assert.ok(await page.locator('aside [data-page=overview]').evaluate(e=>e.classList.contains('active')));
  for(const [key] of names){
   await nav('settings').click();
   await page.locator('#default-page').selectOption(key);
   await page.reload({waitUntil:'load'});
   assert.equal(await page.locator('aside button.active').getAttribute('data-page'),key,
    'Startup destination persists: '+key);
   assert.equal(await nav(key).evaluate(e=>e.classList.contains('active')),true);
   assert.equal(await page.locator('#title').innerText(),key==='transactions'?'Transactions':
    key.charAt(0).toUpperCase()+key.slice(1));
  }
  // Invalid values from older versions/edited local preferences are ignored.
  await page.evaluate(()=>localStorage.setItem('household-ledger-default-page','unknown-future-page'));
  await page.reload({waitUntil:'load'});
  assert.equal(await page.locator('aside button.active').getAttribute('data-page'),'budgets',
   'Invalid saved default safely returns to Budget');
  await page.evaluate(()=>localStorage.removeItem('household-ledger-default-page'));
  await page.reload({waitUntil:'load'});
  assert.equal(await page.locator('aside button.active').getAttribute('data-page'),'budgets',
   'Clearing the preference restores Budget as default');
  if(mobile){
   await page.setViewportSize({width:320,height:740});
   for(const key of ['budgets','overview','settings']){
    await nav(key).click();
    const v=await page.evaluate(()=>({
     scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,
     bottom:document.querySelectorAll('aside button[data-page]').length,
     top:document.querySelectorAll('.mobile-top-nav button').length
    }));
    assert.ok(v.scrollWidth<=v.viewport+1,'No 320px phone overflow on '+key+': '+JSON.stringify(v));
    assert.equal(v.bottom,6);assert.equal(v.top,6);
   }
   await page.setViewportSize({width:390,height:844});
   await nav('overview').click();
   assert.ok(await page.locator('.mobile-top-nav [data-page=overview]').evaluate(e=>e.classList.contains('active')));
   assert.ok(await page.locator('aside [data-page=overview]').evaluate(e=>e.classList.contains('active')));
  }
  assert.deepEqual(errors,[],'No browser script errors');
 }finally{await page.close()}
}
(async()=>{
 const desktop=await chromium.launch({headless:true});
 try{await check(desktop,{viewport:{width:1365,height:850}},false)}finally{await desktop.close()}
 const safari=await webkit.launch({headless:true});
 try{await check(safari,{...devices['iPhone 13']},true)}finally{await safari.close()}
 console.log('PASS: Separate Budget/Overview, six synchronized navigation tabs, all startup destinations, persistent Menu setting, bank immutability, Chromium and iPhone Safari');
})().catch(err=>{console.error(err);process.exit(1)});
