const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
async function check(browser,context={},phone=false){
 const page=await browser.newPage(context),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const Real=Date;class Fixed extends Real{
   constructor(...args){if(args.length)super(...args);else super('2026-10-16T12:00:00Z')}
   static now(){return new Real('2026-10-16T12:00:00Z').getTime()}
  }window.Date=Fixed;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const initial=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  const groceries=page.locator('.budget-entry[data-budget-category="Groceries"]');
  await groceries.locator(':scope > details > summary').click();
  const row=groceries.locator('.ledger-table tbody tr').first();
  const id=await row.locator('[data-category]').getAttribute('data-category');
  const firstButton=row.locator('[data-category]');
  assert.match(await firstButton.getAttribute('class'),/editable-value/,
   'Existing category name is clearly editable');
  assert.equal(await row.locator('td').count(),5,'Duplicate action column removed');
  assert.equal(await page.locator('.ledger-table [data-category]').count()>0,true);
  await firstButton.click();
  const select=row.locator('select.inline-category-select');
  assert.equal(await select.count(),1,'Dropdown replaces name at its original position');
  assert.equal(await select.locator('option').count(),12);
  assert.equal(await page.locator('#entry').count(),0,'No separate editor');
  assert.equal(await row.locator('input[type=number],input[type=date]').count(),0,
   'Recorded bank date and amount are not editable');
  await select.press('Escape');
  assert.equal(await row.locator('select').count(),0,'Escape cancels selection');
  const previous=await row.locator('[data-category]').innerText();
  const destination=previous==='Shopping'?'Housing':'Shopping';
  await row.locator('[data-category]').click();
  await row.locator('.inline-category-select').selectOption(destination);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.deepEqual(saved.transactions,initial.transactions,'Source facts remain byte-for-byte unchanged');
  assert.equal(saved.categoryOverrides[id],destination,'Only this transaction is overridden');
  assert.deepEqual(saved.learning?.categoryRules,initial.learning?.categoryRules,
   'Quick categorization does not silently create reusable merchant rules');
  const target=page.locator('.budget-entry[data-budget-category="'+destination+'"]');
  assert.ok(await target.locator(':scope > details').evaluate(e=>e.open),
   'Destination budget expands without navigating to a separate editor');
  assert.equal(await target.locator('[data-category="'+id+'"]').count(),1,
   'Moved record is visible in its new category');
  assert.equal(await groceries.locator(':scope > details').evaluate(e=>e.open),true,
   'Original budget section stays expanded');
  assert.equal(await page.locator('.editable-forecast').count(),0);
  await page.locator('aside [data-page=transactions]').click();
  const activity=page.locator('.ledger-table [data-category="'+id+'"]');
  assert.equal(await activity.innerText(),destination,'Activity shows the same correction');
  await activity.click();
  const activityDropdown=page.locator('.inline-category-select');
  await activityDropdown.selectOption(previous);
  const reset=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(reset.categoryOverrides[id],undefined,'Returning to source category removes the override');
  await page.reload({waitUntil:'load'});
  await page.locator('aside [data-page=transactions]').click();
  assert.equal(await page.locator('[data-category="'+id+'"]').innerText(),previous,'Reload preserves result');
  await page.locator('aside [data-page=insights]').click();
  await page.locator('[data-insight=bands]').click();
  const band=page.locator('.band-detail').filter({has:page.locator('[data-category]')}).first();
  await band.locator('summary').click();
  const bandCategory=band.locator('[data-category]').first();
  assert.equal(await band.locator('.details-table tbody tr').first().locator('td').count(),6,
   'Purchase-size table no longer needs a category action column');
  await bandCategory.click();
  assert.equal(await band.locator('.inline-category-select').count(),1,
   'Purchase-size categories also edit in place');
  await band.locator('.inline-category-select').press('Escape');
  assert.equal(await band.evaluate(e=>e.open),true,'Purchase band stays expanded');
  await page.locator('[data-insight=merchants]').click();
  const merchant=page.locator('.drill-detail[data-report-group]').first();
  await merchant.locator('summary').click();
  await merchant.locator('[data-category]').first().click();
  assert.equal(await merchant.locator('.inline-category-select').count(),1,
   'Merchant drilldowns use the same inline dropdown');
  await merchant.locator('.inline-category-select').press('Escape');
  if(phone)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),
   'Category dropdown never overflows the iPhone viewport');
  assert.deepEqual(errors,[],'No page errors');
 }finally{await page.close()}
}
(async()=>{
 const chrome=await chromium.launch({headless:true});
 try{await check(chrome,{viewport:{width:1280,height:860}})}finally{await chrome.close()}
 const safari=await webkit.launch({headless:true});
 try{await check(safari,{...devices['iPhone 13']},true)}finally{await safari.close()}
 console.log('PASS: Inline category dropdowns on Budget, Activity, Insights and purchase details; safe single-item changes, Escape, persistence and iPhone Safari');
})().catch(e=>{console.error(e);process.exit(1)});
