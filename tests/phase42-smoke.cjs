const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const Stress=require('../stress-lab.js'),F=require('../forecast.js'),L=require('../forecast-ledger.js'),
 Lab=require('../accuracy-lab.js'),Model=require('../ledger-data.js'),R=require('../reviews.js'),
 A=require('../accuracy-fixture.js'),B=require('../accuracy-fixture-holdout.js');
const source=A.buildScenario(),second=B.buildScenario();
const before=[JSON.stringify(source),JSON.stringify(second)];
const run=()=>Stress.run(A,B,Lab,F,L,Model);
const report=run();
assert.equal(report.scenarioCount,8);
assert.equal(report.trialCount,48);
assert.equal(report.datasetCount,2);
const stressBaseline=require('./phase42-stress-baseline.json');
assert.equal(report.trialCount,stressBaseline.scenarioTrials);
for(const [id,min] of Object.entries(stressBaseline.qualityGates.minRecallPct)){
 const scenario=report.results.find(s=>s.id===id);
 assert.ok(scenario.recall>=min,'Adversarial regression: '+id+' recall fell below fictional quality gate');
}
assert.ok(Math.abs(report.results.find(s=>s.id==='transfer-mirror').deltaBalanceError)<=
 stressBaseline.qualityGates.doubleCountMirrorMaxAddedBalanceError,'No mirror-transfer double count');
assert.ok(report.results.find(s=>s.id==='paused-payroll').deltaBalanceError>=
 stressBaseline.qualityGates.minimumPayrollInterruptionAddedBalanceError,
 'Stress fixture must reveal interrupted payroll risk rather than concealing it');
assert.deepEqual(report.results.map(s=>s.id),[
 'missing-rows','sync-gap','late-history','delayed-future','paused-payroll',
 'renamed-merchant','surprise-refund','transfer-mirror']);
assert.ok(report.results.every(s=>s.windows===6&&Number.isFinite(s.balanceError)));
assert.ok(report.results.find(s=>s.id==='missing-rows').recall>30,'Some forecast schedules survive missing rows');
assert.ok(report.results.find(s=>s.id==='sync-gap').recall>25,'Single stale bank month permits provisional, not verified, forecast');
assert.ok(report.results.find(s=>s.id==='paused-payroll').deltaBalanceError>10000,
 'Interrupted paychecks expose severe unpredictable cash shortfall');
assert.ok(report.results.find(s=>s.id==='renamed-merchant').deltaRecall<0,
 'Unapproved merchant renaming must not silently merge identities');
assert.equal(report.results.find(s=>s.id==='transfer-mirror').deltaBalanceError,0,
 'Savings-side deposit must not inflate checking balance');
assert.ok(report.confidenceAudit.some(x=>x.label==='High'&&x.observedHitRate<99),
 'Under disruption, High confidence is not treated as 99% certain');
assert.ok(report.confidenceAudit.every(x=>x.calibrated===false));
assert.deepEqual(run(),report,'Stable deterministic stress results');
assert.deepEqual([JSON.stringify(source),JSON.stringify(second)],before,'All source fixtures remain unchanged');

const asOf='2026-07-01';
const gap=Stress.perturb(source,asOf,'sync-gap');
const rows=Model.records(Model.migrate({transactions:gap.filter(t=>t.date<=asOf)}));
const expense=F.forecast(rows,'2026-07','Housing',asOf);
const mortgage=expense.expected.find(t=>t.merchant==='Home Mortgage');
assert.ok(mortgage,'Recent outage must not silently erase established mortgage estimate');
assert.notEqual(mortgage.confidence,'High','Provisional data cannot be high-confidence');
assert.equal(mortgage.historyGap,true,'Gap must be explainable in Reviews');
assert.ok(mortgage.warning,'User should know bank feed is incomplete');
const shared=L.build(Model.migrate({transactions:gap.filter(t=>t.date<=asOf)}),rows,asOf,90,F,Model);
assert.ok(shared.events.some(t=>t.merchant==='Home Mortgage'));
assert.ok(R.build(Model.migrate({transactions:gap.filter(t=>t.date<=asOf)}),F,asOf,shared).tasks
 .some(t=>t.kind==='prediction'&&t.merchant==='Home Mortgage'),
 'Gap-affected mortgage returns to Reviews');
const stale=source.filter(t=>t.date<'2026-01-01');
assert.equal(F.forecast(stale,'2026-07','Housing',asOf).expected.length,0,
 'Ancient history must not create falsely reassuring bank charge');
const noIncome=F.forecastIncome([...rows,
 {id:'r1',date:'2026-04-14',merchant:'Refund Web Store',type:'income',amount:12,account:'Checking'},
 {id:'r2',date:'2026-05-14',merchant:'Refund Web Store',type:'income',amount:12,account:'Checking'},
 {id:'r3',date:'2026-06-14',merchant:'Refund Web Store',type:'income',amount:12,account:'Checking'}],
 '2026-07',asOf);
assert.equal(noIncome.expected.some(t=>/refund/i.test(t.merchant)),false,
 'Multiple identical refunds must not become projected paychecks');
const novAsOf='2026-10-20';
const annual=F.forecast(source,'2026-11','Subscriptions',novAsOf);
assert.ok(annual.expected.some(x=>x.merchant==='Annual Digital Membership'&&x.cadence==='annual'),
 'Two prior annual bills may forecast a renewal; insufficient history remains labeled heuristically');
assert.ok(F.forecast(source,'2026-11','Insurance',novAsOf).expected.some(x=>x.cadence==='semiannual'),
 'Semiannual bill recognized after multiple cycles');
assert.ok(!source.some(t=>t.id?.startsWith('stress-')),'No test noise saved in original ledger');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1300,height:880}});const errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 await page.addInitScript(()=>{
  const Base=Date;class Fixed extends Base{constructor(...args){if(args.length)super(...args);else super('2026-10-17T12:00:00Z')}
   static now(){return new Base('2026-10-17T12:00:00Z').getTime()}}window.Date=Fixed;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const stored=await page.evaluate(()=>localStorage.getItem('household-ledger-v1'));
  await page.locator('aside [data-page=insights]').click();
  await page.locator('[data-insight=accuracy]').click();
  assert.equal(await page.locator('.stress-section').count(),1);
  assert.equal(await page.locator('.stress-warning').count(),3);
  assert.match(await page.locator('.stress-section').innerText(),/48 fictional trials/);
  await page.locator('.stress-section .accuracy-detail').first().locator('summary').click();
  assert.equal(await page.locator('.stress-section .accuracy-detail').first().locator('tbody tr').count(),8);
  const confidence=page.locator('.stress-section .accuracy-detail').nth(1);
  await confidence.locator('summary').click();
  assert.match(await confidence.innerText(),/not calibrated probabilities/i);
  await page.locator('#rerun-accuracy').click();
  assert.equal(await page.locator('.stress-warning').count(),3);
  assert.equal(await page.evaluate(()=>localStorage.getItem('household-ledger-v1')),stored,
   'Stress tests never alter personal ledger or prediction overrides');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('.stress-section').isVisible(),'Stress report visible on phone');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
 const safari=await webkit.launch({headless:true});
 try{
  const page=await safari.newPage({...devices['iPhone 13']});
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  await page.locator('.mobile-top-nav [data-page=insights]').click();
  await page.locator('[data-insight=accuracy]').click();
  assert.equal(await page.locator('.stress-warning').count(),3,'iPhone Safari renders adversarial results');
 }finally{await safari.close()}
 console.log('PASS: Phase 4.2 missing data, sync gaps, late postings, income loss, refunds, long cycles, transfers, confidence audit and mobile UI');
})().catch(e=>{console.error(e);process.exit(1)});
