'use strict';
// Fictional end-to-end UI: merchant refunds net against the original category,
// and a bank-described ACH card payment is not counted a second time.
const assert=require('node:assert/strict'),path=require('node:path');
const {spawn}=require('node:child_process'),{chromium,webkit}=require('playwright');
(async()=>{
 const port=19871,server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],
  {cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
 let chrome,iphone;
 const url='http://127.0.0.1:'+port+'/index.html';
 try{
  for(let i=0;i<100;i++){
   try{if((await fetch(url)).ok)break}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  chrome=await chromium.launch({headless:true});
  iphone=await webkit.launch({headless:true});
  for(const [browser,name] of [[chrome,'Chromium'],[iphone,'iPhone WebKit']]){
   const context=await browser.newContext({
    viewport:name==='Chromium'?{width:1280,height:900}:{width:390,height:844}
   });
   await context.addInitScript(()=>{
    const Base=Date;
    class Clock extends Base{
     constructor(...v){super(...(v.length?v:['2026-10-19T12:00:00Z']))}
     static now(){return new Base('2026-10-19T12:00:00Z').getTime()}
    }
    window.Date=Clock;
   });
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/demo-data.js',async route=>{
    const response=await route.fetch(),js=await response.text();
    // This function's source is appended to the fictional demo file; it runs
    // before planner.js imports the demo state, not on a real bank server.
    function injectFictionalActivity(){
     const original=window.createHouseholdLedgerDemo;
     window.createHouseholdLedgerDemo=function(){
      const data=original();
      const account=(id,type,name)=>({id,type,name});
      data.accounts=[
       account('demo-checking','checking','Checking'),
       account('demo-savings','savings','Savings'),
       account('demo-visa','credit','Visa'),
       account('demo-mastercard','credit','Mastercard')
      ];
      const extra=(id,date,merchant,amount,category,type,accountId,plaidAmount)=>({
       id,date,merchant,amount,category,type,accountId,
       account:accountId==='demo-visa'?'Visa':'Checking',pending:false,
       demo:true,source:{provider:'demo',verified:true,plaidAmount}
      });
      data.transactions.push(
       extra('ui-card-health','2026-10-09','Fictional Clinic',100,'Health',
        'expense','demo-visa',100),
       extra('ui-card-health-refund','2026-10-13','Refund Fictional Clinic',40,'Other',
        'refund','demo-visa',-40),
       extra('ui-old-entertainment','2026-09-19','Fictional Stage',60,'Entertainment',
        'expense','demo-visa',60),
       extra('ui-later-refund','2026-10-15','Refund Fictional Stage',25,'Other',
        'refund','demo-visa',-25),
       extra('ui-disguised-payment','2026-10-14','ACH PMT 831',100,'Shopping',
        'expense','demo-checking',100),
       extra('ui-card-credit','2026-10-16','ACCOUNT CREDIT 831',100,'Other',
        'refund','demo-visa',-100)
      );
      return data;
     };
    }
    await route.fulfill({response,body:js+'\n('+injectFictionalActivity.toString()+')();'});
   });
   await page.goto(url,{waitUntil:'load'});
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.equal(await page.locator('[data-history-view="categories"][aria-pressed="true"]').count(),1,
    name+': Budget opens by default');
   const category=key=>page.locator('[data-history-category-row="'+key+'"] .history-category-actual').innerText();
   assert.equal(await category('Health'),'$60.00',
    name+': card purchase $100 less same-month $40 merchant refund is $60');
   assert.equal(await category('Entertainment'),'-$25.00',
    name+': refund this month reduces Budget even when purchase was last month');
   assert.equal(await category('Shopping'),'$141.73',
    name+': disguised $100 repayment does not add to checking-side category spending');
   const widths=await page.locator('.history-budget-fill').evaluateAll(rows=>
    rows.map(x=>parseFloat(x.style.width)));
   assert.ok(widths.every(n=>Number.isFinite(n)&&n>=0&&n<=100),
    name+': refunds never produce a negative or invalid progress width');
   assert.equal(await page.locator('.history-donut,.history-legend-dot').count(),0,
    name+': Budget omits the unused pie chart and color legend');
   // The separate, read-only Summary must match Budget's complete monthly
   // spending, including cross-account card-payment suppression and refunds.
   const budgetSpend=(await page.locator('.history-spending-overview strong').innerText()).replace(/ spent$/,'');
   await page.locator('.planner-nav-primary [data-view="recap"]').click();
   assert.equal(await page.locator('[data-recap-spent] strong').innerText(),budgetSpend,
    name+': Summary and Budget net posted spending must agree');
   assert.equal(await page.locator('.financial-recap-page input,.financial-recap-page button').count(),0,
    name+': Summary may not edit any banking or planning information');
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   assert.ok(await page.locator('[data-history-category-row="Entertainment"]').isVisible(),
    name+': refunds still appear as signed spending in the full-width Budget list');
   await page.locator('[data-history-category-row="Entertainment"] [data-history-drill-category]').click();
   assert.equal(await page.locator('[data-history-entry="ui-later-refund"]').count(),1,
    name+': drilling into net-negative category finds the posted refund');
   assert.deepEqual(errors,[],name+': no browser exceptions in Budget');
   await context.close();
  }
  console.log('PASS Budget net refunds + card settlements in desktop Chromium and iPhone WebKit');
 }finally{await chrome?.close();await iphone?.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});