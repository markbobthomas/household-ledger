'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{
 const port=18891,server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],
  {cwd:path.resolve(__dirname,'..'),stdio:'ignore'});
 let desktop,iphone;
 const url='http://127.0.0.1:'+port+'/index.html';
 try{
  for(let n=0;n<100;n++){
   try{const resp=await fetch(url);if(resp.ok)break}catch{}
   if(n===99)throw Error('Fixture web server did not start');
   await new Promise(r=>setTimeout(r,100));
  }
  desktop=await chromium.launch({headless:true});
  iphone=await webkit.launch({headless:true});
  const cases=[
   ['2026-10-15T18:00:00Z','October 2026','2026-10-15'],
   ['2026-10-31T15:44:00Z','October 2026','2026-10-31'],
   ['2027-01-01T07:30:00Z','December 2026','2026-12-31'],
   ['2027-01-01T08:30:00Z','January 2027','2027-01-01'],
   ['2027-01-01T07:30:00Z','January 2027','2027-01-01','Asia/Tokyo'],
   ['2026-10-31T23:30:00Z','November 2026','2026-11-01','Asia/Tokyo']
  ];
  for(const [browser,device] of [[desktop,'desktop Chromium'],[iphone,'iPhone WebKit']]){
   for(const [instant,expectedMonth,localToday,zone] of cases){
    const context=await browser.newContext({timezoneId:zone||'America/Los_Angeles',
     viewport:device==='iPhone WebKit'?{width:390,height:844}:{width:1280,height:900}});
    await context.addInitScript(iso=>{
     const OriginalDate=Date;
     class FixedDate extends OriginalDate {
      constructor(...args){if(args.length)super(...args);else super(iso)}
      static now(){return new OriginalDate(iso).getTime()}
     }
     window.Date=FixedDate;
    },instant);
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url,{waitUntil:'load'});
    await page.locator('.calendar-month-title').waitFor();
    const month=()=>page.locator('.calendar-month-title').innerText();
    const selectedDay=()=>page.evaluate(()=>window.HouseholdPlannerSummary.currentDay());
    assert.equal(await month(),expectedMonth,
     device+' should show the Pacific-local month at '+instant);
    assert.equal(await selectedDay(),localToday,
     device+' should select actual local today, including Saturday');
    if(localToday==='2026-10-15'){
     // Fictional demo has posted pay and transfer records on the as-of day.
     // Activity and Calendar must display the same records, not just dates
     // strictly earlier than today. The bank balance must not be re-debited.
     const postedRows=page.locator('[data-calendar-today-actual] .calendar-actual-row');
     assert.ok(await postedRows.count()>=2,
      device+' must show today\'s posted Activity records in Calendar');
     const todayText=await page.locator('[data-calendar-detail]').innerText();
     assert.match(todayText,/Household Paycheck/);
     assert.match(todayText,/Transfer to Savings/);
     assert.match(await page.locator('[data-calendar-day="2026-10-15"]').innerText(),
      /Household Paycheck|Transfer to Savings/,
      'Today cell visibly identifies source bank activity');
     await page.locator('.planner-nav-primary [data-view="activity"]').click();
     await page.locator('.history-page').waitFor({state:'attached'});
     const activity=await page.locator('.history-actual-row[data-history-sort-date="2026-10-15"]')
      .allTextContents();
     assert.ok(activity.some(x=>x.includes('Household Paycheck'))&&
      activity.some(x=>x.includes('Transfer to Savings')),
      'The source bank Activity page includes the same fictional today records');
     await page.locator('.planner-nav-primary [data-view="summary"]').click();
     await page.locator('.calendar-month-title').waitFor({state:'attached'});
     assert.ok(await page.locator('[data-calendar-today-actual] .calendar-actual-row').count()>=2,
      'Prepared Calendar navigation preserves current-day bank rows');
    }
    // The back arrow is a real posted-history calendar, not a dead end at
    // the initial forecast date. Previous months retain posted transactions.
    // Anchor to the 15th before subtracting a month: October 31 minus
    // one month otherwise normalizes an invalid September 31 into October.
    const previous=new Date(localToday.slice(0,7)+'-15T12:00:00Z');
    previous.setUTCMonth(previous.getUTCMonth()-1);
    const previousName=previous.toLocaleDateString('en-US',
     {month:'long',year:'numeric',timeZone:'UTC'});
    await page.locator('[data-calendar-nav="-1"]').click();
    assert.equal(await month(),previousName,
     device+' can open last month from a current-day calendar');
    assert.ok(await page.locator('[data-calendar-actual-day]').count()>0,
     'Past calendar renders actual posted-history day cells');
    assert.equal(await page.locator('[data-summary-month-low] .summary-overline').innerText(),
     'Reconstructed lowest in month',
     'Previous month must not label an estimated balance as bank-verified actual');
    await page.locator('[data-calendar-actual-day]').first().click();
    assert.match(await page.locator('[data-calendar-detail]').innerText(),
     /BANK HISTORY.*NOT A PREDICTION/s);
    assert.match(await page.locator('[data-calendar-detail]').innerText(),
     /not a bank-verified|cannot be verified/i,
     'Past-day details explain the limitation of available bank history');
    await page.locator('[data-calendar-nav="1"]').click();
    assert.equal(await month(),expectedMonth,'Forward returns to present from posted history');

    // A single card no longer injects a confusing third figure in the header.
    const cardId=await page.evaluate(asOf=>
     window.HouseholdBankFeed.getSnapshot(asOf).accounts.find(a=>
      String(a.accountType||a.type).toLowerCase()==='credit')?.id||'',localToday);
    assert.ok(cardId,'Fictional fixture includes a credit account');
    await page.locator('#summary-account').selectOption(cardId);
    if(localToday==='2026-10-15')assert.equal(
     await page.locator('[data-calendar-today-actual] .calendar-actual-row').count(),0,
     'Choosing a card must not leak same-day checking transactions into its calendar');
    assert.equal(await page.locator('.summary-numbers>div').count(),2,
     'Card view has the same compact two-number layout as checking');
    assert.equal(await page.locator('[data-summary-card-statement]').count(),0,
     'The redundant middle statement value is removed from Calendar');
    await page.locator('[data-calendar-nav="-1"]').click();
    assert.equal(await page.locator('[data-summary-month-low] .summary-overline').innerText(),
     'Reconstructed lowest in month',
     'Past card months show reconstructed debt lows instead of future statements');
    await page.locator('[data-calendar-nav="1"]').click();
    assert.equal(await page.locator('[data-summary-card-next-statement]').count(),1,
     'Future card months restore the canonical next statement estimate');
    await page.locator('#summary-account').selectOption('all');
    if(await page.locator('[data-calendar-today]').isEnabled())
     await page.locator('[data-calendar-today]').click();
    await page.locator('[data-calendar-nav="1"]').click();
    assert.notEqual(await month(),expectedMonth,
     'Next month must change after '+localToday+' on '+device);
    await page.locator('[data-calendar-nav="-1"]').click();
    assert.equal(await month(),expectedMonth,
     'Previous month must return even when the first day was a weekend');
    assert.equal((await selectedDay()).slice(0,7),localToday.slice(0,7),
     'Returning to current month must not bounce forward into the next month');
    await page.locator('[data-calendar-nav="1"]').click();
    await page.locator('[data-calendar-today]').click();
    assert.equal(await month(),expectedMonth,'Today must restore the actual current month');
    assert.equal(await selectedDay(),localToday,'Today must restore the actual local day');
    assert.equal(await page.locator('[data-calendar-today]').isDisabled(),true,
     'Today is inactive only when the actual as-of date is selected');
    await page.locator('.planner-nav-primary [data-view="activity"]').click();
    await page.locator('.history-page').waitFor({state:'attached'});
    await page.locator('.planner-nav-primary [data-view="summary"]').click();
    await page.locator('.calendar-month-title').waitFor({state:'attached'});
    assert.equal(await month(),expectedMonth,'Switching pages must preserve current calendar month');
    assert.equal(await selectedDay(),localToday,'Switching pages must not replace today');
    assert.deepEqual(errors,[],device+' must have no runtime errors at '+instant);
    await context.close();
   }
  }
  console.log('PASS local calendar day and next/previous/Today across weekend, year and Pacific midnight on Chromium+iPhone WebKit');
 }finally{await desktop?.close();await iphone?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
