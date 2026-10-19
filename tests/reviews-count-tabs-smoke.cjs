const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
async function check(browser,options={},phone=false){
 const page=await browser.newPage(options),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const Native=Date;class FixedDate extends Native{
   constructor(...args){if(args.length)super(...args);else super('2026-10-17T12:00:00Z')}
   static now(){return new Native('2026-10-17T12:00:00Z').getTime()}
  }
  window.Date=FixedDate;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const nav=phone?'.mobile-top-nav [data-page=reviews]':'aside [data-page=reviews]';
  await page.locator(nav).click();
  assert.equal(await page.locator('.review-filters button').count(),4);
  assert.equal(await page.locator('.review-stats,.review-count').count(),0,
   'No duplicate static count bar or duplicate total in header');
  assert.deepEqual(await page.locator('.review-filter-label').allInnerTexts(),['All','Categories','Predictions','Reconciliation']);
  const tabs=page.locator('.review-filters button');
  const numbers=(await page.locator('.review-filter-count').allInnerTexts()).map(Number);
  assert.equal(numbers[0],numbers[1]+numbers[2]+numbers[3],'Combined counters partition all reviews');
  assert.equal(numbers[0],await page.locator('.review-task').count(),'All-count matches displayed rows');
  assert.equal(await tabs.nth(0).getAttribute('aria-pressed'),'true','Current filter exposed accessibly');
  assert.equal(await page.locator('.review-filters').count(),1,'Only one filter control strip');
  assert.equal(await page.locator('.review-task-list,.review-stats').count(),0,'No legacy count widgets');
  await page.locator('[data-review-filter=category]').click();
  assert.equal(await page.locator('[data-review-filter=category]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.review-task').count(),numbers[1]);
  assert.equal(await page.locator('.review-task-kind:text-is("Prediction")').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-review-filter')),'category',
   'Changing filters retains keyboard focus');
  await page.locator('[data-review-filter=prediction]').click();
  assert.equal(await page.locator('.review-task').count(),numbers[2]);
  assert.equal(await page.locator('.review-task-kind:text-is("Category")').count(),0);
  await page.locator('[data-review-filter=category]').click();
  if(numbers[1]){
   const first=page.locator('.review-task').first();
   await first.locator('summary').click();
   const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')).transactions);
   await first.locator('[data-review-confirm]').click();
   const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')).transactions);
   assert.deepEqual(after,before,'Filter change and review approval do not alter source transactions');
   const newNumbers=(await page.locator('.review-filter-count').allInnerTexts()).map(Number);
   assert.equal(newNumbers[1],numbers[1]-1,'Category count updates after confirming a review');
   assert.equal(newNumbers[0],numbers[0]-1,'All-count updates in the same control');
   assert.equal(await page.locator('[data-review-filter=category]').getAttribute('aria-pressed'),'true',
    'Selected filter remains active after a review');
  }
  await page.locator('[data-review-filter=all]').click();
  assert.equal(await page.locator('#review-task-list').count(),1);
  if(phone)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),
   'Combined count/filter row fits on a narrow phone');
  assert.deepEqual(errors,[]);
 }finally{await page.close()}
}
(async()=>{
 const chrome=await chromium.launch({headless:true});
 try{await check(chrome,{viewport:{width:1280,height:860}})}finally{await chrome.close()}
 const safari=await webkit.launch({headless:true});
 try{await check(safari,{...devices['iPhone 13']},true)}finally{await safari.close()}
 console.log('PASS: Review counts double as filters, updates, accessibility, immutable ledger, desktop and iPhone Safari');
})().catch(err=>{console.error(err);process.exit(1)});
