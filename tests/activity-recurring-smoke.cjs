const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const F=require('../forecast.js'),M=require('../ledger-data.js'),L=require('../forecast-ledger.js');
const source=[{id:'one',date:'2026-10-14',merchant:'Fictional Single Charge',amount:23.45,
 type:'expense',category:'Subscriptions',account:'Checking',source:{provider:'demo',verified:false}}];
const original=JSON.stringify(source);
const key=F.patternKey('expense','Subscriptions','Checking','Fictional Single Charge');
const state=M.migrate({transactions:source});
const future=(month)=>F.forecast(M.records(state),month,'Subscriptions','2026-10-17',state.predictions.patternRules).expected;
assert.equal(future('2026-11').length,0,'Single one-off charge is not automatically fabricated monthly');
const set=(frequency,day=14,anchorDate='2026-10-14')=>M.setPatternRule(state,key,{mode:'schedule',frequency,anchorDate,day,amount:23.45});
set('monthly');
assert.deepEqual(['2026-11','2026-12','2027-01'].map(m=>future(m)[0]?.date),
 ['2026-11-14','2026-12-14','2027-01-14'],'Monthly schedule repeats on original calendar day');
assert.ok(future('2026-11')[0].manualRule,'Explicit schedule has confirmed provenance');
assert.equal(future('2026-10').length,0,'Posted October charge does not reappear as a prediction');
const forecast=L.build(state,M.records(state),'2026-10-17',90,F,M);
assert.ok(forecast.events.some(e=>e.merchant==='Fictional Single Charge'&&e.date==='2026-11-14'&&e.type==='expense'));
assert.ok(forecast.events.every(e=>e.date>'2026-10-17'),'No predictions in recorded past');
assert.equal(state.transactions.length,1,'Prediction never adds a source transaction');
set('weekly');
assert.deepEqual(future('2026-10').map(e=>e.date),['2026-10-21','2026-10-28']);
assert.equal(future('2026-11').length,4,'Weekly repeats multiple times per month');
assert.equal(new Set(future('2026-11').map(e=>e.id)).size,4,'Weekly event IDs are distinct');
set('biweekly');
assert.deepEqual(future('2026-11').map(e=>e.date),['2026-11-11','2026-11-25']);
set('quarterly');
assert.equal(future('2026-11').length,0,'Quarterly must not create monthly copies');
assert.equal(future('2027-01')[0]?.date,'2027-01-14');
set('semiannual');
assert.equal(future('2027-04')[0]?.date,'2027-04-14');
set('annual');
assert.equal(future('2027-10')[0]?.date,'2027-10-14');
set('monthly',31,'2026-10-14');
assert.equal(future('2027-02')[0]?.date,'2027-02-28','Day 31 clamps to last day of February');
M.setPatternRule(state,key,{mode:'none'});
assert.equal(future('2026-11').length,0,'Not recurring overrides all scheduled or learned patterns');
M.setPatternRule(state,key,null);
assert.equal(future('2026-11').length,0,'Reset restores automatic pattern detection, no invented schedule');
assert.equal(JSON.stringify(source),original,'Source record is never modified');
assert.throws(()=>set('invalid'),/valid recurring/);
assert.throws(()=>M.setPatternRule(state,key,{mode:'schedule',frequency:'monthly',anchorDate:'broken',day:14,amount:23.45}),/valid recurring/);
const income=[{...source[0],id:'income1',type:'income',category:'Other',merchant:'Fictional Deposit'}];
const inc=M.migrate({transactions:income});
M.setPatternRule(inc,F.patternKey('income','Income','Checking','Fictional Deposit'),
 {mode:'schedule',frequency:'monthly',anchorDate:'2026-10-14',day:14,amount:23.45});
const incomeLedger=L.build(inc,M.records(inc),'2026-10-17',90,F,M);
assert.ok(incomeLedger.events.some(e=>e.type==='income'&&e.date==='2026-11-14'&&e.postingStatus==='unconfirmed'));
assert.ok(incomeLedger.events.filter(e=>e.type==='income').every(e=>e.confirmed===false));
async function browserCheck(browser,settings={},mobile=false){
 const page=await browser.newPage(settings),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Actual=Date;class Fixed extends Actual{
   constructor(...args){if(args.length)super(...args);else super('2026-10-17T12:00:00Z')}
   static now(){return new Actual('2026-10-17T12:00:00Z').getTime()}
  }
  window.Date=Fixed;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  await page.evaluate(()=>{
   const k='household-ledger-v1',s=JSON.parse(localStorage.getItem(k));
   s.transactions.push({id:'test-charge-recurring',date:'2026-10-14',merchant:'Fictional Single Charge',
    amount:23.45,type:'expense',category:'Subscriptions',account:'Checking',
    source:{provider:'demo',verified:false}});
   localStorage.setItem(k,JSON.stringify(s));
  });
  await page.reload({waitUntil:'load'});
  const nav=mobile?'.mobile-top-nav [data-page=transactions]':'aside [data-page=transactions]';
  await page.locator(nav).click();
  const row=page.locator('.ledger-table tbody tr').filter({has:page.locator('[data-recurring=test-charge-recurring]')});
  const toggle=row.locator('[data-recurring]');
  assert.equal(await row.locator('td').count(),6,'Activity has a new recurring column');
  assert.match(await toggle.innerText(),/Not set/,'One-time transaction is not falsely declared recurring');
  assert.equal(await page.locator('.ledger-table [data-category]').count()>0,true,'Category inline edit stays available');
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')).transactions);
  await toggle.click();
  let editor=row.locator('[data-recurring-form]');
  assert.equal(await editor.count(),1,'Schedule editor appears in its own Activity row');
  assert.equal(await page.locator('#entry').count(),0,'No top-of-page editor');
  assert.equal(await editor.locator('[name=decision]').inputValue(),'auto');
  await editor.locator('[name=decision]').selectOption('schedule');
  assert.equal(await editor.locator('[name=frequency]').inputValue(),'monthly','Monthly is default');
  assert.equal(await editor.locator('[name=day]').inputValue(),'14','Defaults to recorded calendar day');
  assert.equal(await editor.locator('[name=anchorDate]').inputValue(),'2026-10-14');
  await editor.locator('button[type=submit]').click();
  assert.match(await row.locator('[data-recurring]').innerText(),/Recurring · Monthly/);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.deepEqual(stored.transactions,before,'Schedule changes never insert fictional bank activity');
  assert.ok(Object.values(stored.predictions.patternRules).some(r=>r.mode==='schedule'&&r.frequency==='monthly'&&r.day===14));
  const predicted=await page.evaluate(()=>{
   const M=window.HouseholdLedgerData,F=window.HouseholdForecast,L=window.HouseholdForecastLedger;
   const s=M.migrate(JSON.parse(localStorage.getItem('household-ledger-v1')));
   return L.build(s,M.records(s),'2026-10-17',90,F,M).events
    .filter(t=>t.merchant==='Fictional Single Charge').map(t=>({date:t.date,type:t.type}));
  });
  assert.deepEqual(predicted.filter(t=>t.type==='expense').map(t=>t.date).slice(0,3),
   ['2026-11-14','2026-12-14','2027-01-14'],'Recurring Activity rule drives 90-day Budget events');
  await row.locator('[data-recurring]').click();
  editor=row.locator('[data-recurring-form]');
  await editor.locator('[name=decision]').selectOption('none');
  await editor.locator('button[type=submit]').click();
  assert.match(await row.locator('[data-recurring]').innerText(),/Not recurring/);
  const noPredictions=await page.evaluate(()=>{
   const M=window.HouseholdLedgerData,F=window.HouseholdForecast,L=window.HouseholdForecastLedger;
   const s=M.migrate(JSON.parse(localStorage.getItem('household-ledger-v1')));
   return L.build(s,M.records(s),'2026-10-17',90,F,M).events.filter(t=>t.merchant==='Fictional Single Charge').length;
  });
  assert.equal(noPredictions,0,'Explicit No stops forecasts');
  await row.locator('[data-recurring]').click();
  editor=row.locator('[data-recurring-form]');
  await editor.locator('[name=decision]').selectOption('schedule');
  await editor.locator('[name=frequency]').selectOption('weekly');
  await editor.locator('button[type=submit]').click();
  assert.match(await row.locator('[data-recurring]').innerText(),/Weekly/);
  await page.reload({waitUntil:'load'});await page.locator(nav).click();
  assert.match(await page.locator('[data-recurring=test-charge-recurring]').innerText(),/Weekly/,'Rule persists after reload');
  const transfer=page.locator('.ledger-table tbody tr').filter({has:page.locator('td:text-is("transfer")')}).first();
  if(await transfer.count())assert.equal(await transfer.locator('[data-recurring]').count(),0,
   'Direction-ambiguous transfers have no misleading recurrence control');
  if(mobile)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),
   'Inline recurrence controls do not overflow the phone viewport');
  assert.deepEqual(errors,[]);
 }finally{await page.close()}
}
(async()=>{
 const chromiumBrowser=await chromium.launch({headless:true});
 try{await browserCheck(chromiumBrowser,{viewport:{width:1280,height:860}})}finally{await chromiumBrowser.close()}
 const webkitBrowser=await webkit.launch({headless:true});
 try{await browserCheck(webkitBrowser,{...devices['iPhone 13']},true)}finally{await webkitBrowser.close()}
 console.log('PASS: Activity recurrence states, weekly to annual schedules, next-month forecasts, No, reset, immutable source, Chromium and iPhone Safari');
})().catch(error=>{console.error(error);process.exit(1)});
