const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const {createServer}=require('../sandbox/server.cjs');
const {createService}=require('../sandbox/plaid-service.cjs');
const {fixtureTransport}=require('../sandbox/fixture.cjs');
async function browserCheck(browser,options,url,mobile){
 const page=await browser.newPage(options),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(url,{waitUntil:'load'});
  const nav=mobile?'.mobile-top-nav [data-page=settings]':'aside [data-page=settings]';
  await page.locator(nav).click();
  const panel=page.locator('#sandbox-panel');
  assert.equal(await panel.count(),1);
  await page.locator('#sandbox-connect').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#sandbox-status')?.textContent.includes('Local fixture mode'));
  await page.locator('#sandbox-connect').click();
  await page.waitForFunction(()=>document.querySelectorAll('.sandbox-item').length===1);
  const one=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(one.transactions.filter(t=>t.source?.simulated).length,8,'Fixture bank data imported');
  assert.equal(one.transactions.filter(t=>t.source?.provider==='demo').length,0,'Demo source rows isolated');
  assert.equal(one.accounts.filter(a=>a.itemId).length,3,'Three linked simulated accounts');
  assert.ok(one.transactions.every(t=>t.source.provider==='plaid'&&t.source.simulated));
  assert.equal(await panel.locator('[data-sandbox-refresh]').count(),1);
  await page.locator('#sandbox-institution').selectOption('ins_109509');
  await page.locator('#sandbox-connect').click();
  await page.waitForFunction(()=>document.querySelectorAll('.sandbox-item').length===2);
  const two=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(two.transactions.length,16);
  assert.equal(new Set(two.transactions.map(t=>t.id)).size,16,'Two provider Item IDs cannot collide');
  await panel.locator('[data-sandbox-refresh]').first().click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('household-ledger-v1')).transactions.some(t=>t.source.pendingTransactionId));
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(after.transactions.filter(t=>t.source.pendingTransactionId).length,1);
  assert.equal(after.transactions.filter(t=>t.pending).length,1,'Only unaffected Item retains pending row');
  await page.locator(mobile?'.mobile-top-nav [data-page=transactions]':'aside [data-page=transactions]').click();
  const table=page.locator('.ledger-table');
  assert.match(await table.innerText(),/Sandbox test/,'Every imported transaction marked as test-only');
  const payment=table.locator('tr').filter({hasText:'Credit Card Payment'}).first();
  assert.match((await payment.innerText()).toLowerCase(),/card payment/);
  await page.locator(mobile?'.mobile-top-nav [data-page=overview]':'aside [data-page=overview]').click();
  assert.match(await page.locator('.account-projection-list').innerText(),/Test Rewards Card/);
  assert.ok(await page.locator('.account-projection-row').count()>=6);
  await page.locator(nav).click();
  await panel.locator('[data-sandbox-disconnect]').first().click();
  await page.waitForFunction(()=>document.querySelectorAll('.sandbox-item').length===1);
  await panel.locator('[data-sandbox-disconnect]').first().click();
  await page.waitForFunction(()=>document.querySelectorAll('.sandbox-item').length===0);
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.ok(restored.transactions.some(t=>t.source?.provider==='demo'),'Disconnect restores original fictional dataset');
  assert.equal(restored.transactions.filter(t=>t.source?.simulated).length,0);
  if(mobile)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),
   'Local Sandbox UI fits phone width');
  assert.deepEqual(errors,[]);
 }finally{await page.close()}
}
(async()=>{
 const app=createServer({service:createService({mode:'fixture',request:fixtureTransport()})});
 const address=await app.listen(0),url='http://127.0.0.1:'+address.port;
 try{
  const chrome=await chromium.launch({headless:true});
  try{await browserCheck(chrome,{viewport:{width:1280,height:900}},url,false)}
  finally{await chrome.close()}
  const safari=await webkit.launch({headless:true});
  try{await browserCheck(safari,{...devices['iPhone 13']},url,true)}
  finally{await safari.close()}
  console.log('PASS: Phase D local fixture UI, two institutions, card reconciliation, pending-posted refresh, Overview, source isolation, disconnect, Chromium/iPhone');
 }finally{await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
