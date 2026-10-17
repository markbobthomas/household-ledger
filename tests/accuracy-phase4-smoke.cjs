const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const Fixture=require('../accuracy-fixture.js');
const Lab=require('../accuracy-lab.js');
const Forecast=require('../forecast.js');
const Ledger=require('../forecast-ledger.js');
const Model=require('../ledger-data.js');

const rows=Fixture.buildScenario();
const startSnapshot=JSON.stringify(rows);
assert.ok(rows.length>450,'Enough 25-month test history exists');
assert.ok(rows.some(t=>t.scenarioTruth?.recurring),'Fixture contains hidden recurring truth labels');
assert.ok(rows.some(t=>t.scenarioTruth?.recurring===false),'Fixture contains irregular spending');
const report=Lab.runFixture(Fixture,Forecast,Ledger,Model);
assert.equal(report.kind,'fictional-walk-forward');
assert.equal(report.score.snapshots,12,'Twelve out-of-sample 90-day windows scored');
assert.equal(report.folds.length,12);
assert.ok(report.score.recurring.predicted>0);
assert.ok(report.score.recurring.actualRecurring>0);
assert.ok(report.score.recurring.matched>0);
assert.equal(report.score.recurring.predicted,report.score.recurring.matched+report.score.recurring.falsePredictions,'Predictions partition into matched and false');
assert.equal(report.score.recurring.actualRecurring,report.score.recurring.matched+report.score.recurring.missedRecurring,'Recurring truth partitions into found and missed');
assert.ok(report.score.recurring.precision>=0&&report.score.recurring.precision<=100);
assert.ok(report.score.recurring.recall>=0&&report.score.recurring.recall<=100);
assert.ok(report.score.recurring.averageDateErrorDays>=0);
assert.ok(report.score.recurring.averageAmountError>=0);
assert.ok(report.score.scheduledExpenseCoverage>0&&report.score.scheduledExpenseCoverage<=100);
assert.deepEqual(report.score.cash.map(x=>x.days),[30,60,90]);
assert.ok(report.score.cash.every(x=>x.observations===12&&x.mae>=0));
assert.ok(report.score.cash[2].mae>report.score.cash[0].mae,
 'Longer-range balance drift is visible instead of hiding poor performance');
assert.ok(report.score.byCadence.some(x=>x.name==='annual'&&x.missedRecurring>0),
 'Limited annual bill history honestly reduces recall');
assert.ok(report.score.byConfidence.some(x=>x.name==='High'&&x.precision<100),
 'High confidence is not treated as perfect calibrated certainty');
assert.equal(JSON.stringify(rows),startSnapshot,'Accuracy runs never edit test transactions');
const guardrails=require('./accuracy-regression-baseline.json').regressionGuardrails;
assert.ok(report.score.recurring.precision>=guardrails.minimumPrecisionPct,
  'Warn if recurring precision materially regresses on the fixed fictional fixture');
assert.ok(report.score.recurring.recall>=guardrails.minimumRecallPct,
  'Warn if recurring recall deteriorates versus fictional baseline');
assert.ok(report.score.recurring.matched>=guardrails.minimumRecurringMatched,
  'Warn if significantly fewer recurring charges are anticipated');
assert.ok(report.score.cash.find(x=>x.days===90).mae<=guardrails.maximum90DayCashMAE,
  'Warn if 90-day cash error worsens significantly on fictional fixture');


const match=Lab.matchEvents(
 [{id:'p1',date:'2026-04-20',merchant:'A',account:'Checking',type:'expense',amount:50,cadence:'monthly'},
  {id:'p2',date:'2026-04-20',merchant:'A',account:'Checking',type:'expense',amount:50,cadence:'monthly'},
  {id:'p3',date:'2026-04-20',merchant:'B',account:'Checking',type:'expense',amount:50,cadence:'monthly'}],
 [{id:'a1',date:'2026-04-21',merchant:'A',account:'Checking',type:'expense',amount:52,scenarioTruth:{recurring:true}}]
);
assert.equal(match.matched.length,1,'One actual charge cannot satisfy duplicate predictions');
assert.equal(match.unmatchedPredictions.length,2,'Duplicate and false-merchant predictions remain false');
assert.equal(match.missedActuals.length,0);

// A model should never observe future rows or scenario answer labels.
const target='2026-02-01',onlyPast=rows.filter(t=>t.date<=target);
const witness={forecasts:0};
const guarded={
 forecast(history,...args){
  witness.forecasts++;
  assert.ok(history.every(t=>t.date<=target),'History may not include post-as-of actuals');
  assert.ok(history.every(t=>!('scenarioTruth' in t)),'Ground-truth recurrence label is hidden from predictor');
  return Forecast.forecast(history,...args);
 },
 forecastIncome(history,...args){
  witness.forecasts++;
  assert.ok(history.every(t=>t.date<=target),'Future income must remain hidden');
  assert.ok(history.every(t=>!('scenarioTruth' in t)),'Income labels not leaked');
  return Forecast.forecastIncome(history,...args);
 }
};
const originalFold=Lab.evaluateFold({transactions:rows,asOf:target,forecast:guarded,
 ledger:Ledger,dataModel:Model});
assert.ok(witness.forecasts>=30,'All categories and income tested through guarded history only');
const alteredFuture=rows.map(t=>t.date>target?{...t,amount:t.amount+777,
 scenarioTruth:{recurring:!t.scenarioTruth?.recurring,cadence:'annual'}}:t);
const revisedFold=Lab.evaluateFold({transactions:alteredFuture,asOf:target,
 forecast:Forecast,ledger:Ledger,dataModel:Model});
assert.deepEqual(revisedFold.events,originalFold.events,
 'Changing hidden future transactions and labels cannot change historical predictions');
assert.notEqual(revisedFold.recurringTruthCount,originalFold.recurringTruthCount,
 'Future truth is used only for scoring');
const repeat=Lab.runFixture(Fixture,Forecast,Ledger,Model);
assert.deepEqual(repeat.score,report.score,'Scoring is deterministic and reproducible');

(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1350,height:880}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Base=Date;class Fixed extends Base{
   constructor(...args){if(args.length)super(...args);else super('2026-10-17T12:00:00Z')}
   static now(){return new Base('2026-10-17T12:00:00Z').getTime()}
  }
  window.Date=Fixed;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const before=await page.evaluate(()=>localStorage.getItem('household-ledger-v1'));
  await page.locator('aside [data-page="insights"]').click();
  assert.equal(await page.locator('[data-insight]').count(),5);
  assert.equal(await page.locator('[data-insight="merchants"]').getAttribute('aria-selected'),'true','Merchants remains default');
  await page.locator('[data-insight="accuracy"]').click();
  assert.equal(await page.locator('.accuracy-lab').count(),1,'Accuracy lab is rendered under Insights');
  assert.match(await page.locator('.accuracy-lab').innerText(),/fictional history only/i);
  assert.equal(await page.locator('.accuracy-stat').count(),4);
  assert.equal(await page.locator('.accuracy-cash-row').count(),3);
  const displayed=await page.locator('.accuracy-stat strong').first().innerText();
  assert.equal(displayed,report.score.recurring.precision.toFixed(1)+'%','UI matches measured recurring precision');
  await page.locator('.accuracy-detail').first().locator('summary').click();
  assert.ok(await page.locator('.accuracy-table').count()>=1);
  assert.match(await page.locator('.accuracy-lab').innerText(),/fictional anchored balance/i);
  await page.locator('#rerun-accuracy').click();
  assert.equal(await page.locator('.accuracy-stat strong').first().innerText(),displayed,'Rerun produces same reproducible score');
  assert.equal(await page.evaluate(()=>localStorage.getItem('household-ledger-v1')),before,'Scoring never modifies browser ledger');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('[data-insight="accuracy"]').isVisible(),'Accuracy accessible on phone');
  const m=await page.evaluate(()=>({width:document.documentElement.scrollWidth,inner:innerWidth}));
  assert.ok(m.width<=m.inner+1,'Accuracy page has no horizontal body overflow '+JSON.stringify(m));
  assert.deepEqual(errors,[],'No script errors in evaluation UI');
 }finally{await browser.close()}
 const safari=await webkit.launch({headless:true});
 try{
  const iphone=await safari.newPage({...devices['iPhone 13']});
  await iphone.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  await iphone.locator('.mobile-top-nav [data-page="insights"]').click();
  await iphone.locator('[data-insight="accuracy"]').click();
  assert.equal(await iphone.locator('.accuracy-stat').count(),4,'Accuracy numbers shown on mobile Safari');
 }finally{await safari.close()}
 console.log('PASS: Phase 4 held-out backtesting, cash 30/60/90 errors, truth isolation, deterministic replay and mobile accuracy UI');
})().catch(e=>{console.error(e);process.exit(1)});
