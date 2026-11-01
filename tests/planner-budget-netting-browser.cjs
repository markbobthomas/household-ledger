'use strict';
// Fictional end-to-end UI: card repayments remain cash-flow forecasts but
// Summary monthly bills count only recurring/scheduled card purchases.
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
      // The Visa subscription and scheduled charge are monthly Summary bills.
      // The full Visa repayment affects checking cash flow but is not an
      // additional household expense in the monthly bill summary.
      data.predictions={
       recurringForecastMode:'approved-only',
       futureRecurringRules:[
        {id:'fictional-mortgage',kind:'event',type:'expense',accountId:'demo-checking',
         frequency:'monthly',anchorDate:'2026-10-02',date:'2026-10-02',
         merchant:'Mortgage',amount:2650,category:'Housing'},
        {id:'fictional-daycare',kind:'event',type:'expense',accountId:'demo-checking',
         frequency:'monthly',anchorDate:'2026-10-03',date:'2026-10-03',
         merchant:'Daycare',amount:825,category:'Kids & Family'},
        {id:'fictional-energy',kind:'event',type:'expense',accountId:'demo-checking',
         frequency:'monthly',anchorDate:'2026-10-04',date:'2026-10-04',
         merchant:'Puget Sound Energy',amount:106.70,category:'Utilities'},
        {id:'fictional-zelle-childcare',kind:'event',type:'transfer',
         cashDirection:'out',accountId:'demo-checking',
         frequency:'monthly',anchorDate:'2026-10-08',date:'2026-10-08',
         merchant:'Fictional Zelle Childcare',amount:125,category:'Kids & Family'},
        {id:'fictional-visa-sub',kind:'event',type:'expense',accountId:'demo-visa',
         frequency:'monthly',anchorDate:'2026-10-05',date:'2026-10-05',
         merchant:'Fictional Visa Subscription',amount:25,category:'Subscriptions'}
       ],
       futureTransactionAdds:[
        {id:'fictional-visa-pay',type:'transfer',date:'2026-11-12',
         merchant:'Fictional Visa Payment',amount:600,
         fromAccountId:'demo-checking',toAccountId:'demo-visa'},
        {id:'fictional-scheduled-visa-charge',type:'expense',
         date:'2026-11-18',merchant:'Fictional Scheduled Card Charge',
         amount:15,category:'Insurance',accountId:'demo-visa'},
        {id:'fictional-scheduled-checking-charge',type:'expense',
         date:'2026-11-19',merchant:'Fictional Scheduled Checking Charge',
         amount:100,category:'Health',accountId:'demo-checking'},
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
       extra('ui-recurring-card-bill','2026-10-05',
        'Fictional Visa Subscription',25,'Subscriptions','expense','demo-visa',25),
       extra('ui-incidental-card-shopping','2026-10-06',
        'Fictional Unscheduled Card Shopping',50,'Subscriptions','expense','demo-visa',50),
       extra('ui-incidental-checking-bill','2026-10-07',
        'Fictional Unscheduled Utility',99,'Utilities','expense','demo-checking',99),
       {...extra('ui-confirmed-zelle','2026-10-08','Fictional Zelle Childcare',
         125,'Kids & Family','transfer','demo-checking',125),cashDirection:'out'},
       // An October Sunday pending Visa purchase still belongs to October
       // Budget, not Friday's shifted forecast or the later posting date.
       {...extra('ui-weekend-pending-card','2026-10-18','Fictional Weekend Hardware',90,
        'House & Maintenance','expense','demo-visa',90),pending:true},
       {...extra('ui-pending-card-payment','2026-10-18','Credit card payment',220,
        'Shopping','expense','demo-checking',220),pending:true},
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
   await page.waitForFunction(()=>!document.querySelector('#planner-main .ledger-page-wait'),null,{timeout:30000});
   const currentBills=await page.locator('.bills-upcoming').innerText();
   assert.match(currentBills,/Fictional Earlier Bill/,
    name+': Upcoming lists the next checking withdrawals');
   await page.locator('[data-bills-pane="upcoming"] [data-bills-month]').selectOption('2026-11');
   const novemberBills=await page.locator('.bills-upcoming').innerText();
   assert.match(novemberBills,/Fictional Visa Payment/,
    name+': Upcoming includes the cash-to-card payment once');
   assert.doesNotMatch(novemberBills,/Fictional Savings Transfer/,
    name+': Savings movement is not a bill');
   assert.doesNotMatch(novemberBills,/Fictional Visa Subscription/,
    name+': Card purchases are listed in Statements, not cash Upcoming');
   assert.doesNotMatch(novemberBills,/Fictional Scheduled Card Charge/,
    name+': Scheduled credit-card purchase is not another checking withdrawal');
   assert.match(novemberBills,/Fictional Scheduled Checking Charge/,
    name+': Checking charge remains in Upcoming');
   await page.locator('[data-bills-pane="upcoming"] [data-bills-month]').selectOption('');
   await page.locator('[data-bills-more]').click();
   assert.match(await page.locator('.bills-range-toggle').innerText(),/30 days/,
    name+': Bills can expand to a 90-day view without modifying forecasts');
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.waitForFunction(()=>!document.querySelector('#planner-main .ledger-page-wait'),null,{timeout:30000});
   assert.equal(await page.locator('[data-history-view="categories"][aria-pressed="true"]').count(),1,
    name+': Budget opens by default');
   const category=key=>page.locator('[data-history-category-row="'+key+'"] .history-category-actual').innerText();
   assert.equal(await category('Health'),'$60.00',
    name+': card purchase $100 less same-month $40 merchant refund is $60');
   assert.equal(await category('Entertainment'),'-$25.00',
    name+': refund this month reduces Budget even when purchase was last month');
   assert.equal(await category('Shopping'),'$141.73',
    name+': disguised $100 repayment does not add to checking-side category spending');
   assert.equal(await category('House & Maintenance'),'$90.00',
    name+': a Sunday pending card purchase appears in its bank-date month as provisional Budget usage');
   const provisional=await page.locator('[data-history-category-row="House & Maintenance"]').innerText();
   assert.match(provisional,/1 pending/,
    name+': Budget labels the bank transaction pending rather than posted');
   assert.doesNotMatch(await page.locator('[data-history-category-row="Shopping"]').innerText(),
    /pending/,'A pending card repayment must not be mistaken for provisional shopping');
   const widths=await page.locator('.history-budget-fill').evaluateAll(rows=>
    rows.map(x=>parseFloat(x.style.width)));
   assert.ok(widths.every(n=>Number.isFinite(n)&&n>=0&&n<=100),
    name+': refunds never produce a negative or invalid progress width');
   assert.equal(await page.locator('.history-donut,.history-legend-dot').count(),0,
    name+': Budget omits the unused pie chart and color legend');
   // Summary Spent remains posted-only. Budget also reserves pending card
   // purchases, while card repayments and cash transfers remain excluded.
   const overview=await page.locator('.history-spending-overview').innerText(),
    parts=overview.match(/(\$[\d,.]+) spent · (\$[\d,.]+) pending · (\$[\d,.]+) expected/),
    budgetUsed=await page.locator('.history-spending-overview strong').innerText(),
    centsOf=value=>Math.round(Number(String(value).replace(/[^0-9.-]/g,''))*100);
   assert.ok(parts,name+': Budget distinguishes posted, pending, and predicted amounts');
   assert.equal(parts[2],'$90.00',
    name+': only the pending weekend purchase enters provisional Budget usage');
   assert.equal(parts[3],'$75.00',
    name+': October Budget includes six remaining dated bills without guessing shopping');
   assert.equal(centsOf(budgetUsed),centsOf(parts[1])+centsOf(parts[2])+centsOf(parts[3]),
    name+': Budget combines posted, pending and scheduled expenses once');
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.waitForFunction(()=>!document.querySelector('#planner-main .ledger-page-wait'),null,{timeout:30000});
   await page.locator('[data-history-view="summary"]').click();
   assert.equal(await page.locator('[data-history-view="summary"][aria-pressed="true"]').count(),1,
    name+': Summary is the fourth Spending subtab');
   assert.equal(await page.locator('[data-recap-spent] strong').innerText(),parts[1],
    name+': Summary Spent is posted-only, equal to the actual portion of Budget');
   assert.equal(await page.locator('.financial-recap-page [data-history-month-picker]').count(),1,
    name+': Summary shares the calendar-month picker');
   assert.equal(await page.locator('.financial-recap-page input:not([data-history-month-option]),.financial-recap-page button:not([data-history-month-toggle]):not([data-history-month-current]):not([data-history-month-all])').count(),0,
    name+': Summary can select report months but cannot edit financial information');
   const moneyCents=text=>Math.round(Number(String(text).replace(/[^0-9.-]/g,''))*100),
    octoberBills=moneyCents(await page.locator('[data-recap-bills] strong').innerText()),
    octoberBreakdown=await page.locator('[data-recap-bills] small').innerText(),
    paidMatch=octoberBreakdown.match(/Paid (\$[\d,.]+) · Upcoming (\$[\d,.]+)/);
   assert.ok(paidMatch,name+': October shows posted and remaining bills');
   const paidOctober=moneyCents(paidMatch[1]),upcomingOctober=moneyCents(paidMatch[2]);
   assert.equal(paidOctober,373170,
    name+': posted recurring cash bills, outward Zelle bill and card subscription all count');
   assert.doesNotMatch(await page.locator('.financial-recap-card').first().innerText(),
    /Fictional Unscheduled Utility/,
    name+': checking purchases do not become bills solely because their category says Utilities');
   assert.equal(upcomingOctober,7500,
    name+': six future October checking bills total $75');
   assert.equal(octoberBills,paidOctober+upcomingOctober,
    name+': current calendar month includes posted plus upcoming bills without averaging');
   // Saved checking and Visa rules plus one-time schedules across both
   // accounts are November bills. The repayment and savings transfer are not.
   await page.locator('[data-history-month-toggle]').click();
   await page.locator('[data-history-month-option][value="2026-11"]').check();
   await page.locator('[data-history-month-option][value="2026-10"]').uncheck();
   assert.equal(await page.locator('[data-recap-bills] strong').innerText(),'$3,846.70',
    name+': November includes scheduled checking, outward Zelle and credit-card expenses');
   const billCategories=await page.locator('.financial-recap-card').first().innerText();
   assert.match(billCategories,/Subscriptions/);
   assert.match(billCategories,/\$25\.00/,
    name+': recurring card subscription is reported at the charge amount');
   assert.match(billCategories,/Housing|\$2,650\.00/,
    name+': recurring checking mortgage also appears in monthly bills');
   assert.match(billCategories,/Health|\$100\.00/,
    name+': expressly scheduled checking charge is included');
   assert.doesNotMatch(billCategories,/Credit card payments|\$600\.00/,
    name+': card repayment cannot inflate monthly bill categories');
   await page.locator('[data-history-month-option][value="2026-10"]').check();
   assert.equal(moneyCents(await page.locator('[data-recap-bills] strong').innerText()),
    octoberBills+384670,
    name+': two selected months add checking, Zelle and card November bill schedules');
   await page.locator('[data-history-month-option][value="2026-10"]').uncheck();
   await page.locator('[data-history-month-toggle]').click();
   assert.doesNotMatch(billCategories,/Fictional Unscheduled Card Shopping/,
    name+': unscheduled card purchases never become monthly bills');
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

   // A saved recurring checking-to-card repayment must still appear in
   // Summary's NEXT FIVE cash outflows, but not in expense-only Bills.
   // Store only fictional demo preferences.
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
   await page.waitForFunction(()=>!document.querySelector('#planner-main .ledger-page-wait'),null,{timeout:30000});
   const recurring=page.locator('[data-schedule-card="fictional-recurring-card-pay"]');
   assert.equal(await recurring.count(),0,
    name+': card repayment is excluded from Repeating expense plans');
   assert.match(await page.locator('.bills-upcoming').innerText(),/Fictional Recurring Card Repayment/,
    name+': recurring card repayment is visible in Upcoming cash bills');
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.waitForFunction(()=>!document.querySelector('#planner-main .ledger-page-wait'),null,{timeout:30000});
   await page.locator('[data-history-view="summary"]').click();
   const firstFive=await page.locator('.financial-recap-upcoming .financial-recap-rows').innerText();
   assert.match(firstFive,/Fictional Recurring Card Repayment/,
    name+': next-week card repayment remains in Summary cash forecasts despite Bills exclusion');
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
   await page.locator('.planner-nav-primary [data-view="schedules"]').click();
   await page.waitForFunction(()=>!document.querySelector('#planner-main .ledger-page-wait'),null,{timeout:30000});
   await page.locator('[data-bills-tab="statements"]').click();
   const cardSelect=page.locator('[data-bills-statement-account]'),
    periodSelect=page.locator('[data-bills-statement-period]'),
    statement=page.locator('[data-bills-pane="statements"] [data-bills-statement]');
   assert.equal(await cardSelect.count(),1,name+': select exactly one card');
   assert.equal(await periodSelect.count(),1,name+': select exactly one statement');
   assert.equal(await cardSelect.inputValue(),'demo-visa',
    name+': configured card is initially selected');
   assert.equal(await statement.count(),1,
    name+': only the selected statement is rendered');
   assert.equal(await page.locator('.bills-card-statements').count(),1,
    name+': only one card detail is rendered');
   const options=await periodSelect.locator('option').evaluateAll(nodes=>
    nodes.map(n=>({value:n.value,label:n.textContent})));
   assert.ok(options.length>=2&&options.every(x=>/\b20\d{2}\b.*\b20\d{2}\b/.test(x.label))&&
    options.some(x=>x.label.includes('2026')),
    name+': every billing range shows full years, including future-year cycles');
   const currentChoice=await periodSelect.inputValue();
   assert.equal(currentChoice,'2026-11-18',
    name+': the open billing period is the initial selection');
   assert.match(await statement.innerText(),/Current · open/);
   assert.match(await statement.innerText(),/Posted net charges/);
   assert.match(await statement.innerText(),/Predicted net charges/);
   assert.match(await statement.innerText(),/Expected card payment/);
   assert.match(await statement.innerText(),/2026/,
    name+': rendered statement period includes the year');
   await periodSelect.selectOption('2026-10-18');
   assert.equal(await statement.count(),1);
   assert.match(await statement.innerText(),/Sep 19, 2026/);
   assert.match(await statement.innerText(),/Oct 18, 2026/);
   assert.equal(await page.locator('.bills-statement-line').count()>0,true,
    name+': prior billing cycle retains its transaction rows');
   const pastDates=(await page.locator('.bills-statement-line > span:first-child')
    .allTextContents()).map(text=>Date.parse(text.trim()+', 2026'));
   assert.ok(pastDates.length>=3&&new Set(pastDates).size>1&&
    pastDates.every((date,index)=>Number.isFinite(date)&&
     date>=Date.parse('2026-09-19')&&date<=Date.parse('2026-10-18')&&
     (!index||pastDates[index-1]>=date)),
    name+': historical statement shows multiple dated charges newest to oldest');
   await periodSelect.selectOption(currentChoice);
   const currentDates=(await page.locator('.bills-statement-line > span:first-child')
    .allTextContents()).map(text=>Date.parse(text.trim()+', 2026'));
   assert.ok(currentDates.every((date,index)=>Number.isFinite(date)&&
    date>=Date.parse('2026-10-19')&&date<=Date.parse('2026-11-18')&&
    (!index||currentDates[index-1]>=date)),
    name+': current statement also keeps predicted and posted charges newest first');
   assert.equal(await statement.count(),1);
   assert.match(await statement.innerText(),/Current · open/);
   await cardSelect.selectOption('demo-mastercard');
   assert.equal(await page.locator('.bills-card-statements').count(),1,
    name+': changing cards does not add more card sections');
   assert.equal(await page.locator('[data-bills-card="demo-visa"]').count(),0);
   assert.equal(await page.locator('[data-bills-card="demo-mastercard"]').count(),1);
   assert.equal(await periodSelect.inputValue(),'',
    name+': unconfigured card does not inherit Visa statement choice');
   await cardSelect.selectOption('demo-visa');
   assert.equal(await periodSelect.inputValue(),currentChoice,
    name+': returning to configured card restores its current statement');
   for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:844});
    const geometry=await page.locator('.schedule-page').evaluate(root=>{
     const tabs=[...root.querySelectorAll('.ledger-section-tabs [data-bills-tab]')]
      .map(el=>el.getBoundingClientRect()),
      controls=[...root.querySelectorAll('.bills-statement-filters select')]
       .map(el=>el.getBoundingClientRect());
     return {tabs:tabs.map(r=>({top:r.top,width:r.width,right:r.right})),
      controls:controls.map(r=>({top:r.top,right:r.right,width:r.width})),
      viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth};
    });
    assert.ok(geometry.tabs.length===3&&
     geometry.tabs.every(r=>Math.abs(r.top-geometry.tabs[0].top)<=2)&&
     geometry.tabs.every(r=>Math.abs(r.width-geometry.tabs[0].width)<=2)&&
     geometry.controls.length===2&&
     geometry.controls.every(r=>r.width>65&&r.right<=width+2)&&
     geometry.overflow<=3,
     name+': three tabs on one row and two statement selectors fit at '+width+
     'px: '+JSON.stringify(geometry));
   }
   await page.setViewportSize({width:name==='Chromium'?1280:390,height:name==='Chromium'?900:844});
   assert.equal(await page.locator('[data-bills-tab]').count(),3);
   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.waitForFunction(()=>!document.querySelector('#planner-main .ledger-page-wait'),null,{timeout:30000});
   await page.locator('[data-history-view="summary"]').click();
   const autopayFive=await page.locator('.financial-recap-upcoming .financial-recap-rows').innerText();
   assert.match(autopayFive,/Credit-card payment \(autopay\)/,
    name+': configured card autopay next week must be one of Summary next five');

   await page.locator('.planner-nav-primary [data-view="history"]').click();
   await page.waitForFunction(()=>!document.querySelector('#planner-main .ledger-page-wait'),null,{timeout:30000});
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