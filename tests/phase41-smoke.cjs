const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const F=require('../forecast.js'),L=require('../forecast-ledger.js');
const M=require('../ledger-data.js'),Cash=require('../cashflow.js'),Lab=require('../accuracy-lab.js');
const Fixture=require('../accuracy-fixture.js'),Holdout=require('../accuracy-fixture-holdout.js');
const asOf='2025-08-01',source=Fixture.buildScenario();
const stored=M.migrate({transactions:source.filter(t=>t.date<=asOf)});
const original=JSON.stringify(stored.transactions);
const shared=L.build(stored,M.records(stored),asOf,90,F,M);
assert.equal(shared.events.some(e=>e.date>shared.through),false,'No event beyond evaluation horizon');
for(const [merchant,due] of [
 ['Home Mortgage','2025-10-02'],['Partner Salary','2025-10-16'],['Cinema Stream','2025-10-12']]){
 assert.ok(shared.events.some(e=>e.merchant===merchant&&e.date===due),
  merchant+' repeats into third forecast month');
}
assert.ok(shared.events.some(e=>e.type==='transfer'&&e.merchant==='Credit Card Settlement'&&e.cashDirection==='out'),
 'Explicit checking-card settlement projected as cash flow, not spending');
assert.equal(shared.events.filter(e=>e.type==='expense'&&e.merchant==='Credit Card Settlement').length,0,
 'Card settlement never counted as a purchase');
assert.ok(shared.events.every(e=>e.type!=='transfer'||e.cashDirection==='out'),
 'No ambiguous or unmatched incoming transfers manufactured');
assert.ok(shared.uncertainty.available&&shared.uncertainty.historyMonths>=3,'Irregular-spending scenario uses completed historical months');
assert.ok(shared.uncertainty.dailyHigh>=shared.uncertainty.dailyLow,'Scenario shows a coherent range');
assert.equal(shared.uncertainty.includedInDatedEvents,false,'No phantom spending transactions');
assert.ok(!shared.events.some(e=>e.merchant==='Neighborhood Grocer'),
 'Irregular grocer not assigned invented exact dates');
const account={id:'checking',name:'Fictional Checking',transactionAccount:'Checking',available:5100,current:5100};
const projected=Cash.cashFlow90({account,asOf,days:90,expectedEvents:shared.events,uncertainty:shared.uncertainty});
const historicalOnly=Cash.cashFlow90({account,asOf,days:90,expectedEvents:shared.events.filter(e=>e.type!=='transfer'),uncertainty:shared.uncertainty});
assert.ok(projected.closing<historicalOnly.closing,'Transfer withdrawals change checking cash');
assert.equal(projected.expectedOutflow-historicalOnly.expectedOutflow,
 shared.events.filter(e=>e.type==='transfer').reduce((n,e)=>n+e.amount,0),
 'Transfer cash deduction equals projected settlement amounts exactly once');
assert.ok(projected.uncertainty.closingTypical<projected.closing,'Illustrative irregular spend lowers scenario balance');
assert.ok(projected.uncertainty.closingLow<=projected.uncertainty.closingTypical&&
 projected.uncertainty.closingHigh>=projected.uncertainty.closingTypical,'Scenario band brackets central case');
assert.equal(JSON.stringify(stored.transactions),original,'No actual source values modified');

const previous=require('./accuracy-regression-baseline.json').baselineAtPhase4;
const main=Lab.runFixture(Fixture,F,L,M),alt=Lab.runFixture(Holdout,F,L,M);
assert.ok(main.score.recurring.recall>previous.recurringRecallPct+20,'Main historical recall improved materially');
assert.ok(main.score.cash[2].mae<previous.cash90DayMAE*.5,'Main 90-day scheduled-only balance error at least halved');
assert.ok(main.score.cash[2].scenarioMAE<main.score.cash[2].mae,'Main irregular-spend scenario improves 90-day balance error');
assert.ok(alt.score.recurring.precision>85&&alt.score.recurring.recall>80,'Independent household not overfit to first scenario');
assert.ok(alt.score.cash[2].scenarioMAE<alt.score.cash[2].mae,'Second household benefits from uncertainty scenario');
assert.ok(alt.score.cash[2].scenarioSamples===12,'Second household scored at same 12 historical dates');
assert.ok(alt.score.byCadence.some(x=>x.name==='monthly'&&x.matched>20));
const evalMain=Lab.evaluateFold({transactions:source,asOf,forecast:F,ledger:L,dataModel:M});
const hidden=source.map(t=>t.date>asOf?{...t,amount:Number(t.amount)+600,scenarioTruth:{recurring:false}}:t);
const evalAltered=Lab.evaluateFold({transactions:hidden,asOf,forecast:F,ledger:L,dataModel:M});
assert.deepEqual(evalAltered.events,evalMain.events,'Changing hidden future never alters predicted events');
assert.equal(JSON.stringify(stored.transactions),original,'Backtesting does not write browser/source ledger');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:820}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Base=Date;class Fixed extends Base{constructor(...xs){if(xs.length)super(...xs);else super('2026-10-17T12:00:00Z')}
  static now(){return new Base('2026-10-17T12:00:00Z').getTime()}}window.Date=Fixed;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const originalBrowser=await page.evaluate(()=>localStorage.getItem('household-ledger-v1'));
  assert.ok(await page.locator('#cashflow .cash-risk').count(),'Risk band is separate from scheduled balance line');
  await page.locator('aside [data-page=insights]').click();await page.locator('[data-insight=accuracy]').click();
  assert.match(await page.locator('.accuracy-lab').innerText(),/Independent fictional household/i);
  assert.match(await page.locator('.accuracy-lab').innerText(),/With irregular-spending scenario/i);
  await page.locator('#rerun-accuracy').click();
  assert.match(await page.locator('.accuracy-lab').innerText(),/Independent fictional household/i);
  assert.equal(await page.evaluate(()=>localStorage.getItem('household-ledger-v1')),originalBrowser,
   'Accuracy comparison never modifies browser ledger');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('[data-insight=accuracy]').isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Phone layout no overflow');
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
 const safari=await webkit.launch({headless:true});
 try{
  const p=await safari.newPage({...devices['iPhone 13']});
  await p.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  await p.locator('.mobile-top-nav [data-page=insights]').click();await p.locator('[data-insight=accuracy]').click();
  assert.ok(await p.locator('.accuracy-stat').count()===4);
 }finally{await safari.close()}
 console.log('PASS: Phase 4.1 90-day recurrence, explicit transfers, uncertainty ranges, independent holdout and mobile accuracy lab');
})().catch(e=>{console.error(e);process.exit(1)});
