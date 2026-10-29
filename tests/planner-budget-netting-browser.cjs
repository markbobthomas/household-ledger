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
      // These fictional future forecasts are deliberately different:
      // the Visa subscription is a card PURCHASE (not a checking bill),
      // while the Visa PAYMENT is a checking withdrawal (a Summary bill).
      data.predictions={
       recurringForecastMode:'approved-only',
       futureRecurringRules:[{
        id:'fictional-visa-sub',kind:'event',type:'expense',accountId:'demo-visa',
        frequency:'monthly',anchorDate:'2026-11-05',date:'2026-11-05',
        merchant:'Fictional Visa Subscription',amount:25,category:'Subscriptions'
       }],
       futureTransactionAdds:[
        {id:'fictional-visa-pay',type:'transfer',date:'2026-11-12',
         merchant:'Fictional Visa Payment',amount:600,
         fromAccountId:'demo-checking',toAccountId:'demo-visa'},
        {id:'fictional-savings-move',type:'transfer',date:'2026-11-13',
         merchant:'Fictional Savings Transfer',amount:500,
         fromAccountId:'demo-checking',toAccountId:'demo-savings'},
        ...Array.from({length:6},(_,i)=>({
         id:'fictional-early-bill-'+i,type:'expense',
         date:'2026-10-'+String(20+i).padStart(2,'0'),
         merchant:'Fictional Earlier Bill '+i,amount:10+i,
         accountId:'demo-checking'
        }))
       ]
      };
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
   assert.equal(await page.locator(
    '.home-intro,.home-next-step,.home-all-set,.home-next-bill,.calendar-first-tip,.home-long-range').count(),0,
    name+': Home opens on calendar data, not introductory text');
   assert.equal(await page.locator('.summary-page > .summary-stage').count(),1,
    name+': forecast metrics and calendar are the first surface');
   await page.locator('.planner-nav-primary [data-view="schedules"]').click();
   const upcoming=await page.locator('.bills-upcoming').innerText();
   assert.match(upcoming,/Fictional Visa Payment/,
    name+': Bills shows a linked checking-to-card payment in the same forecast');
   assert.doesNotMatch(upcoming,/Fictional Savings Transfer/,
    name+': savings transfer is not incorrectly presented as a bill');
   assert.doesNotMatch(upcoming,/Fictional Visa Subscription/,
    name+': a credit-card purchase is not a second cash bill');
   assert.match(upcoming,/Fictional Earlier Bill/);
   await page.locator('[data-bills-more]').click();
   assert.match(await page.locator('.bills-range-toggle').innerText(),/30 days/,
    name+': Bills can expand to a 90-day view without modifying forecasts');
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
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.locator('[data-history-view="summary"]').click();
   assert.equal(await page.locator('[data-history-view="summary"][aria-pressed="true"]').count(),1,
    name+': Summary is the fourth Spending subtab');
   assert.equal(await page.locator('[data-recap-spent] strong').innerText(),budgetSpend,
    name+': Summary and Budget net posted spending must agree');
   assert.equal(await page.locator('.financial-recap-page input,.financial-recap-page button').count(),0,
    name+': Summary may not edit any banking or planning information');
   const billCategories=await page.locator('.financial-recap-card').first().innerText();
   assert.match(billCategories,/Credit card payments/);
   assert.match(billCategories,/\$50\.00/,
    name+': one $600 future card payment contributes $50/month across 12 months');
   assert.doesNotMatch(billCategories,/Fictional Visa Subscription/,
    name+': the underlying $25/month card purchases must not also count as bills');
   assert.doesNotMatch(billCategories,/Savings Transfer/,
    name+': internal cash transfer is not a bill');
   assert.match(await page.locator('.financial-recap-upcoming').innerText(),
    /Fictional Visa Payment/,
    name+': credit-card payment appears even when five earlier bills precede it');
   assert.equal(await page.locator('.financial-recap-upcoming .financial-recap-rows .financial-recap-row').count(),5,
    name+': Summary preserves the five earliest bills in chronological order');
   assert.doesNotMatch(await page.locator('.financial-recap-upcoming .financial-recap-rows').innerText(),
    /Fictional Visa Payment/,
    name+': the next card payment occurs after the first five in this fixture');
   assert.equal(await page.locator('[data-recap-next-card-payment]').count(),1,
    name+': the next card payment is separately visible without hiding the first five');
   assert.equal((await page.locator('.financial-recap-upcoming').innerText().then(v=>
    v.match(/Fictional Visa Payment/g)||[])).length,1,
    name+': the linked card payment is shown only once');
   assert.doesNotMatch(await page.locator('.financial-recap-upcoming').innerText(),/Fictional Savings Transfer/,
    name+': internal savings transfer must not appear as a bill');

   // A saved recurring checking-to-card bill (the Bills page, not a
   // one-time Payments add) must be in Summary's NEXT FIVE when due before
   // the other projected withdrawals. Store only fictional demo preferences.
   await page.evaluate(()=>{
    const key='household-planner-sample-settings-v1',
     saved=JSON.parse(localStorage.getItem(key)||'{}');
    saved.futureRecurringRules=[...(saved.futureRecurringRules||[]),{
     id:'fictional-recurring-card-pay',kind:'movement',type:'transfer',
     fromAccountId:'demo-checking',toAccountId:'demo-visa',
     date:'2026-10-22',anchorDate:'2026-10-22',frequency:'monthly',
     merchant:'Fictional Recurring Card Repayment',amount:321,category:'Other'
    }];
    localStorage.setItem(key,JSON.stringify(saved));
   });
   await page.reload({waitUntil:'load'});
   await page.locator('.planner-nav-primary [data-view="schedules"]').click();
   const recurring=page.locator('[data-schedule-card="fictional-recurring-card-pay"]');
   assert.equal(await recurring.count(),1,name+': recurring card payment is listed in Bills');
   assert.match(await recurring.innerText(),/Oct 22/,
    name+': Bills presents a next-week dated card payment, not an unforecasted placeholder');
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.locator('[data-history-view="summary"]').click();
   const firstFive=await page.locator('.financial-recap-upcoming .financial-recap-rows').innerText();
   assert.match(firstFive,/Fictional Recurring Card Repayment/,
    name+': a next-week card payment shown in Bills must also be among Summary next five');
   assert.equal(await page.locator('[data-recap-next-card-payment]').count(),0,
    name+': the card payment within first five must not require an extra row');


   // Configured card autopay is generated from a statement rule instead of
   // the Bills recurring editor. Its linked cash withdrawal must use the
   // same Summary inclusion logic, with the card purchase itself excluded.
   await page.evaluate(()=>{
    const key='household-planner-sample-settings-v1',
     saved=JSON.parse(localStorage.getItem(key)||'{}');
    saved.futureRecurringRules=[];
    saved.paymentRules={'demo-visa':{
     billingStartDate:'2026-09-19',billingEndDate:'2026-10-18',
     nextPaymentDate:'2026-10-22',nextDueDate:'2026-10-23',
     fromAccountId:'demo-checking',method:'statement',
     autopayEnabled:true,lastStatementBalance:420,closingDay:18
    }};
    localStorage.setItem(key,JSON.stringify(saved));
   });
   await page.reload({waitUntil:'load'});
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.locator('[data-history-view="summary"]').click();
   const autopayFive=await page.locator('.financial-recap-upcoming .financial-recap-rows').innerText();
   assert.match(autopayFive,/Credit-card payment \(autopay\)/,
    name+': configured card autopay next week must be one of Summary next five');

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