'use strict';
// Device-local startup preference; only fictional data and static app files.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{
 const port=18916,url='http://127.0.0.1:'+port+'/index.html';
 const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{
  cwd:path.resolve(__dirname,'..'),stdio:'ignore'
 });
 let chrome,iphone;
 const ready=async()=>{
  for(let attempt=0;attempt<100;attempt++){
   try{const response=await fetch(url);if(response.ok)return}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Fictional Ledger server failed to start');
 };
 try{
  await ready();
  chrome=await chromium.launch({headless:true});
  iphone=await webkit.launch({headless:true});
  for(const [browser,label] of [[chrome,'desktop Chromium'],[iphone,'iPhone WebKit']]){
   const context=await browser.newContext({viewport:label.startsWith('iPhone')?{width:390,height:844}:{width:1280,height:900}});
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   const waitForPage=async()=>page.locator('#planner-main .planner-page').first().waitFor();
   const openSettings=async()=>{
    await page.locator('#planner-menu>summary').click();
    await page.locator('#planner-menu [data-view="settings"]').click();
    await page.locator('#ledger-opening-page').waitFor();
   };
   await page.goto(url,{waitUntil:'load'});
   await waitForPage();
   assert.equal(await page.locator('.summary-page').count(),1,'Home remains default without a saved choice');
   await openSettings();
   const select=page.locator('#ledger-opening-page');
   assert.deepEqual(await select.locator('option').evaluateAll(nodes=>nodes.map(n=>[n.value,n.textContent])),
    [['summary','Home'],['history','Spending'],['schedules','Bills'],
     ['activity','Activity'],['reviews','Things to check'],
     ['trend','Balance Trend'],['transactions','All upcoming predictions'],
     ['settings','Settings']]);
   assert.equal(await select.inputValue(),'summary');
   const choices=['activity','history','schedules','reviews','trend','transactions','settings','summary'];
   for(const value of choices){
    // Choosing an opening page doesn't interrupt whatever is being edited.
    await select.selectOption(value);
    assert.equal(await page.locator('.settings-page').count(),1,
      'Choosing an opening page must not immediately navigate away from Settings');
    assert.equal(await page.evaluate(()=>localStorage.getItem('household-ledger-opening-page-v1')),
      value,'Opening page is saved only as a browser preference');
    await page.reload({waitUntil:'load'});
    await waitForPage();
    if(value==='activity'){
     assert.equal(await page.locator('.history-page').count(),1,'Activity opens on History list surface');
     assert.equal(await page.locator('.history-page [data-history-view="list"]').count()>0,true,
      'Activity shows the actual transaction list, not Spending categories');
    }
    if(value==='summary')assert.equal(await page.locator('.summary-page').count(),1);
    if(value==='settings')assert.equal(await page.locator('.settings-page').count(),1);
    // Return to Settings to select the next preference without modifying forecasts.
    if(value!=='settings')await openSettings();
    assert.equal(await page.locator('#ledger-opening-page').inputValue(),value);
   }
   // Invalid stale preference fails safe to Home, rather than blank navigation.
   await page.evaluate(()=>localStorage.setItem('household-ledger-opening-page-v1','unexpected-view'));
   await page.reload({waitUntil:'load'});
   await waitForPage();
   assert.equal(await page.locator('.summary-page').count(),1,'Invalid preference falls back to Home');
   await context.close();
   const second=await browser.newContext();
   const other=await second.newPage();
   await other.goto(url,{waitUntil:'load'});
   await other.locator('#planner-main .summary-page').waitFor();
   assert.equal(await other.evaluate(()=>localStorage.getItem('household-ledger-opening-page-v1')),null,
    'Another device does not inherit this user's chosen opening page');
   await second.close();
   assert.deepEqual(errors,[],'No page errors on '+label);
  }
  console.log('PASS opening page selection, reload, invalid fallback and device isolation in Chromium and iPhone WebKit');
 }finally{await chrome?.close();await iphone?.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
