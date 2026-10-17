const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const F=require('../forecast.js'),L=require('../forecast-ledger.js'),C=require('../cashflow.js'),M=require('../ledger-data.js');
const Bank=require('../bank-feed.js');
const fs=require('node:fs'),vm=require('node:vm');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../demo-data.js'),'utf8'),context);
const demo=context.window.createHouseholdLedgerDemo();
const source=M.migrate(demo),asOf='2026-10-16',account=Bank.getSnapshot(asOf).accounts[0];
const raw=JSON.stringify(source.transactions);
const makeRows=()=>M.records(source);
const unified=()=>L.build(source,makeRows(),asOf,90,F,M);
const cash=()=>C.cashFlow90({account,asOf,days:90,expectedEvents:unified().events});
const recurringRows=[
 {id:'j1',type:'expense',category:'Shopping',merchant:'Same Price Service',account:'Checking',date:'2026-07-12',amount:48.75},
 {id:'j2',type:'expense',category:'Shopping',merchant:'Same Price Service',account:'Checking',date:'2026-08-13',amount:48.75},
 {id:'j3',type:'expense',category:'Shopping',merchant:'Same Price Service',account:'Checking',date:'2026-09-12',amount:48.75}
];
const expected=F.forecast(recurringRows,'2026-10','Shopping','2026-10-05');
assert.equal(expected.expected.length,1,'Three matching monthly charges must create a forecast');
assert.equal(expected.expected[0].date,'2026-10-12','Expected around same calendar day');
assert.equal(expected.expected[0].amount,48.75,'Identical amounts retained');
assert.equal(expected.expected[0].confidence,'High','Three same-price charges on near dates signal strong recurrence');
const patternKey=F.patternKey('expense','Shopping','Checking','Same Price Service');
const ruleState=M.migrate({transactions:recurringRows});
M.setPatternRule(ruleState,patternKey,{mode:'none'});
assert.equal(F.forecast(recurringRows,'2026-10','Shopping','2026-10-05',ruleState.predictions.patternRules).expected.length,0,'Not recurring overrides detection');
M.setPatternRule(ruleState,patternKey,null);
assert.equal(F.forecast(recurringRows,'2026-10','Shopping','2026-10-05',ruleState.predictions.patternRules).expected.length,1,'Removing rejection restores automatic recurrence');
M.setPatternRule(ruleState,patternKey,{mode:'monthly',day:23,amount:59});
const forced=F.forecast(recurringRows,'2026-10','Shopping','2026-10-16',ruleState.predictions.patternRules).expected;
assert.equal(forced.length,1);
assert.equal(forced[0].date,'2026-10-23','User-established recurrence overrides due date');
assert.equal(forced[0].amount,59,'User-established recurrence overrides amount');
assert.equal(forced[0].confidence,'Confirmed','Manual pattern visually distinguished');
const oneCharge=[{...recurringRows[0],date:'2026-09-12'}];
assert.equal(F.forecast(oneCharge,'2026-10','Shopping','2026-10-16',ruleState.predictions.patternRules).expected.length,1,
 'Explicit monthly rule can work from a single recorded charge');
const before=unified();
const spotify=before.categoryViews['2026-10|Subscriptions'].active.find(e=>e.merchant==='Spotify');
assert.ok(spotify,'Preview has dated Spotify payment');
const baseline=cash();
M.updateExpectedTransaction(source,spotify.id,{date:spotify.date,amount:spotify.amount+100,enabled:true});
const edited=unified();
assert.equal(edited.categoryViews['2026-10|Subscriptions'].additional,
 before.categoryViews['2026-10|Subscriptions'].additional+100,
 'Budget increases exactly as forecast payment correction');
const projected=cash();
assert.equal(projected.closing,baseline.closing-100,'90 day balance moves by same $100 correction');
assert.equal(projected.opening,baseline.opening,'Starting bank balance remains identical');
assert.equal(projected.series.find(d=>d.date===spotify.date).outflow,
 baseline.series.find(d=>d.date===spotify.date).outflow+100,'Specific predicted date is consistent');
assert.ok(edited.events.some(e=>e.id===spotify.id&&e.amount===spotify.amount+100),'Shared event is single source of truth');
M.setPatternRule(source,F.patternKey('expense','Subscriptions','Checking','Spotify'),{mode:'none'});
assert.ok(!unified().events.some(e=>e.merchant==='Spotify'),'User rejection removes merchant events in all months');
M.setPatternRule(source,F.patternKey('expense','Subscriptions','Checking','Spotify'),null);
assert.ok(unified().events.some(e=>e.merchant==='Spotify'),'Automatic recurrence can be re-established');
assert.equal(JSON.stringify(source.transactions),raw,'Overrides never mutate posted ledger');
assert.ok(!unified().events.some(e=>e.type==='transfer'),'Transfers excluded from dated forecast');
assert.ok(unified().risk.every(r=>r.includedInDatedTotal===false),'Irregular spending risk separated from dated charges');

(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:860}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Base=Date;class FixedDate extends Base{
   constructor(...args){if(args.length)super(...args);else super('2026-10-16T12:00:00Z')}
   static now(){return new Base('2026-10-16T12:00:00Z').getTime()}
  }window.Date=FixedDate;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  assert.equal(await page.locator('#cashflow').count(),1);
  const initial=await page.locator('#cashflow .cash-secondary strong').last().innerText();
  const originals=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')).transactions);
  const category=page.locator('.budget-entry[data-budget-category="Subscriptions"]');
  await category.locator(':scope > details > summary').click();
  const payment=category.locator('.expected-tx').filter({hasText:'Spotify'}).first();
  assert.equal(await payment.count(),1,'A specific dated payment is visible in Budget');
  await payment.locator('summary').click();
  await payment.locator('[name=amount]').fill('111.99');
  await payment.locator('[type=submit]').click();
  assert.notEqual(await page.locator('#cashflow .cash-secondary strong').last().innerText(),initial,
   'Editing a Budget prediction automatically updates 90-day cash chart');
  const updated=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.deepEqual(updated.transactions,originals,'Actual transaction records remain unchanged');
  const cat2=page.locator('.budget-entry[data-budget-category="Subscriptions"]');
  if(!await cat2.locator(':scope > details').evaluate(e=>e.open))await cat2.locator(':scope > details > summary').click();
  const payment2=cat2.locator('.expected-tx').filter({hasText:'Spotify'}).first();
  await payment2.locator('summary').click();
  await payment2.locator('[data-pattern-none]').click();
  const suppressed=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')).predictions.patternRules);
  const spotifyKey=F.patternKey('expense','Subscriptions','Checking','Spotify');
  assert.equal(suppressed[spotifyKey].mode,'none','Not recurring rule is saved');
  assert.equal(await cat2.locator('.expected-tx').filter({hasText:'Spotify'}).count(),0,
   'Rejected pattern disappears from expected rows');
  await cat2.locator('.pattern-rules > summary').click();
  const rules=cat2.locator('.pattern-rule-form');
  await rules.locator('[name=key]').selectOption(spotifyKey);
  await rules.locator('[name=mode]').selectOption('monthly');
  await rules.locator('[name=amount]').fill('11.99');
  await rules.locator('[name=day]').fill('19');
  await rules.locator('button[type=submit]').click();
  assert.ok(await cat2.locator('.expected-tx').filter({hasText:'Spotify'}).count(),'Monthly recurrence re-established');
  await page.locator('aside [data-page=insights]').click();
  assert.equal(await page.locator('[data-insight=merchants]').getAttribute('aria-selected'),'true','Merchants is default in Insights');
  assert.match(await page.locator('#view').innerText(),/Merchant totals/i,'Merchant reporting shown by default');
  await page.locator('[data-insight=categories]').click();
  assert.match(await page.locator('#view').innerText(),/Upcoming expected payments/i,'Categories uses the shared predictions');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('.mobile-top-nav [data-page=reviews]').isVisible(),'Five-tab phone layout retained');
  assert.deepEqual(errors,[],'No JS errors');
  console.log('PASS: Three fixed-price cycles, recurrence suppression/forcing, unified Budget/Insights/cash flow, mobile and immutable bank facts');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
