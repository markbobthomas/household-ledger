const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
async function run(browser,options={},isPhone=false){
 const page=await browser.newPage(options),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Native=Date;class FixedDate extends Native{
   constructor(...a){if(a.length)super(...a);else super('2026-10-16T12:00:00Z')}
   static now(){return new Native('2026-10-16T12:00:00Z').getTime()}
  }
  window.Date=FixedDate;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const cap=page.locator('.budget-entry[data-budget-category="Groceries"] [data-inline-budget]');
  assert.ok(await cap.isVisible(),'Cap is visible without opening the category');
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(await page.locator('.budget-entry[data-budget-category="Groceries"] > details').evaluate(e=>e.open),false);
  await cap.click();
  assert.equal(await page.locator('.inline-money-input').count(),1);
  assert.equal(await page.locator('.inline-money-input').getAttribute('inputmode'),'decimal');
  await page.locator('.inline-money-input').fill('575.25');
  await page.locator('.inline-money-input').press('Enter');
  assert.equal(await cap.innerText(),'$575.25');
  assert.equal(await page.locator('.budget-entry[data-budget-category="Groceries"] > details').evaluate(e=>e.open),false,
   'Tapping just the amount does not expand a budget');
  assert.equal(await page.locator('#flash .editable-forecast').count(),0,'No overlay or top-of-page editor');
  let current=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(current.predictions.monthlyBudgets.Groceries,575.25);
  assert.deepEqual(current.transactions,before.transactions,'Budget edit does not change source transactions');
  const progress=page.locator('.budget-entry[data-budget-category="Groceries"] .budget-progress');
  assert.match(await progress.getAttribute('aria-label'),/budget \$575.25/);
  await cap.click();
  await page.locator('.inline-money-input').fill('900.00');
  await page.locator('.inline-money-input').press('Escape');
  assert.equal(await cap.innerText(),'$575.25','Escape reverts an uncommitted edit');
  await cap.click();
  await page.locator('.inline-money-input').fill('invalid');
  await page.locator('.inline-money-input').press('Enter');
  assert.equal(await page.locator('.inline-money-input').count(),1,'Invalid input remains editable');
  await page.locator('.inline-money-input').press('Escape');
  await cap.click();
  await page.locator('.inline-money-input').fill('600.50');
  await page.locator('#title').click();
  assert.equal(await cap.innerText(),'$600.50','Blur commits a valid changed amount');
  await page.reload({waitUntil:'load'});
  assert.equal(await page.locator('.budget-entry[data-budget-category="Groceries"] [data-inline-budget]').innerText(),'$600.50',
   'Budget edit survives a reload');
  const budget=page.locator('.budget-entry[data-budget-category="Groceries"]');
  await budget.locator(':scope > details > summary').click({position:{x:20,y:20}});
  assert.equal(await budget.locator(':scope > details').evaluate(e=>e.open),true);
  const predicted=budget.locator('.expected-tx').first(),expectedId=await predicted.getAttribute('data-expected');
  const editable=predicted.locator('[data-inline-expected]');
  assert.ok(await editable.isVisible(),'Expected payment has the same visible affordance');
  await editable.click();
  await predicted.locator('.inline-money-input').fill('171.24');
  await predicted.locator('.inline-money-input').press('Enter');
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.deepEqual(after.transactions,before.transactions,'Prediction edit never modifies bank source records');
  assert.equal(after.predictions.expectedTransactionOverrides[expectedId].amount,171.24);
  assert.equal(await page.locator('.budget-entry[data-budget-category="Groceries"] > details').evaluate(e=>e.open),true,
   'Category stays expanded after prediction edit');
  assert.equal(await budget.locator('.expected-tx').first().locator('.expected-value').innerText(),'$171.24');
  await budget.locator('.expected-tx').first().locator('summary').click({position:{x:14,y:12}});
  assert.equal(await budget.locator('.expected-tx').first().locator('input[name="date"]').count(),1,
   'Detailed date editor remains reachable');
  assert.equal(await budget.locator('.expected-tx').first().locator('input[name="amount"]').count(),1,
   'Detailed amount editor remains reachable');
  assert.equal(await page.locator('.ledger-table td:nth-child(5) .editable-value').count(),0,
   'Recorded purchase amounts remain read-only even when categories are editable');
  assert.ok(await page.locator('.ledger-table td:nth-child(3) .editable-category').count()>0,
   'Category names intentionally use the same editable-value styling');
  if(isPhone)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),
    'Inline controls fit within the phone viewport');
  assert.deepEqual(errors,[],'No browser script errors');
 }finally{await page.close()}
}
(async()=>{
 const chrome=await chromium.launch({headless:true});
 try{await run(chrome,{viewport:{width:1300,height:850}})}finally{await chrome.close()}
 const safari=await webkit.launch({headless:true});
 try{await run(safari,{...devices['iPhone 13']},true)}finally{await safari.close()}
 console.log('PASS: Inline budget and expected amounts, Enter/Escape/blur, reload, immutable source, desktop and iPhone Safari');
})().catch(e=>{console.error(e);process.exit(1)});
