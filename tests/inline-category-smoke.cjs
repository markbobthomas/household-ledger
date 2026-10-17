const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
async function exercise(browser,context={},phone=false){
 const page=await browser.newPage(context),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Real=Date;
  class Fixed extends Real{
   constructor(...args){if(args.length)super(...args);else super('2026-10-16T12:00:00Z')}
   static now(){return new Real('2026-10-16T12:00:00Z').getTime()}
  }
  window.Date=Fixed;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const original=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  const groceries=page.locator('.budget-entry[data-budget-category="Groceries"]');
  await groceries.locator(':scope > details > summary').click();
  const row=groceries.locator('.ledger-table tbody tr').first(),category=row.locator('select[data-category]');
  const id=await category.getAttribute('data-category'),old=await category.inputValue();
  assert.match(await category.getAttribute('class'),/editable-value/,'Underlined editable value');
  assert.equal(await category.locator('option').count(),12,'Every category present in native dropdown');
  assert.equal(await row.locator('td').count(),5,'No duplicate category action column');
  assert.equal(await page.locator('.ledger-table button[data-category],#entry').count(),0,'No category popup or redundant edit button');
  assert.equal(await row.locator('td:nth-child(5) input').count(),0,'Recorded amount stays read-only');
  const next=old==='Shopping'?'Housing':'Shopping';
  await category.selectOption(next);
  const changed=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(changed.categoryOverrides[id],next,'Selected category saved for individual transaction');
  assert.deepEqual(changed.transactions,original.transactions,'Recorded transactions never change');
  assert.deepEqual(changed.learning?.categoryRules,original.learning?.categoryRules,
   'Quick edit does not create a broad merchant rule');
  const destination=page.locator('.budget-entry[data-budget-category="'+next+'"]');
  assert.ok(await destination.locator(':scope > details').evaluate(e=>e.open),'Destination budget opens');
  assert.ok(await groceries.locator(':scope > details').evaluate(e=>e.open),'Original budget stays expanded');
  assert.equal(await destination.locator('select[data-category="'+id+'"]').count(),1,'Moved record appears in destination category');
  await page.locator('aside [data-page=transactions]').click();
  const activity=page.locator('select[data-category="'+id+'"]');
  assert.equal(await activity.inputValue(),next,'Activity reflects saved category');
  await activity.selectOption(old);
  const reverted=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(reverted.categoryOverrides[id],undefined,'Changing back to original removes override');
  await page.reload({waitUntil:'load'});
  await page.locator('aside [data-page=transactions]').click();
  assert.equal(await page.locator('select[data-category="'+id+'"]').inputValue(),old,'Native select persists after reload');
  await page.locator('aside [data-page=insights]').click();
  await page.locator('[data-insight=bands]').click();
  const band=page.locator('details.band-detail').filter({has:page.locator('select[data-category]')}).first();
  await band.locator('summary').click();
  assert.equal(await band.locator('.details-table tbody tr').first().locator('td').count(),6,
   'Purchase-size list no longer has a separate action column');
  const bandCategory=band.locator('select[data-category]').first(),bandId=await bandCategory.getAttribute('data-category');
  const from=await bandCategory.inputValue(),to=from==='Shopping'?'Housing':'Shopping';
  await bandCategory.selectOption(to);
  assert.ok(await band.evaluate(e=>e.open),'Band expansion preserved after category edit');
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')))).categoryOverrides[bandId],to);
  await band.locator('select[data-category="'+bandId+'"]').selectOption(from);
  await page.locator('[data-insight=merchants]').click();
  const group=page.locator('.drill-detail[data-report-group]').first();
  await group.locator('summary').click();
  const merchantSelect=group.locator('select[data-category]').first();
  assert.equal(await merchantSelect.locator('option').count(),12,'Merchant drilldowns use the same dropdown');
  const source=await merchantSelect.inputValue();
  await merchantSelect.selectOption(source==='Other'?'Shopping':'Other');
  assert.ok(await group.evaluate(e=>e.open),'Merchant group remains expanded when edited');
  if(phone)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),
   'Native dropdown fits within mobile viewport');
  assert.deepEqual(errors,[],'No JavaScript errors');
 }finally{await page.close()}
}
(async()=>{
 const chrome=await chromium.launch({headless:true});
 try{await exercise(chrome,{viewport:{width:1280,height:860}})}finally{await chrome.close()}
 const safari=await webkit.launch({headless:true});
 try{await exercise(safari,{...devices['iPhone 13']},true)}finally{await safari.close()}
 console.log('PASS: Native underlined category dropdowns in Budget, Activity, Insights and purchase details; read-only sources, persistence, desktop and iPhone Safari');
})().catch(err=>{console.error(err);process.exit(1)});
