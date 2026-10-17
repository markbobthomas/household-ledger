const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const H=require('../feed-health.js'),Bank=require('../bank-feed.js');
const F=require('../forecast.js'),L=require('../forecast-ledger.js'),M=require('../ledger-data.js');
const A=require('../accuracy-fixture.js'),B=require('../accuracy-fixture-holdout.js'),C=require('../accuracy-fixture-seasonal.js');
const Lab=require('../accuracy-lab.js'),R=require('../readiness-lab.js');
const now=new Date('2026-10-17T20:00:00Z');
const demo=Bank.getSnapshot('2026-10-17'),h=H.assess(demo,[],[],now);
assert.equal(h.status,'not-connected');
assert.equal(h.authoritative,false);
assert.equal(h.lastSuccessfulSync,null);
assert.equal(h.pendingCount,null);
assert.equal(h.missingAccountIds,null);
assert.match(h.warnings.join(' '),/No connected bank feed/i);
assert.equal(H.assess({...demo,asOf:'2026-10-17'},[],[],now).status,'not-connected',
 'A current demo date must not be called a successful sync');
const connected=(overrides={})=>({...demo,mode:'live',connected:true,
 lastSuccessfulSync:'2026-10-17T19:00:00Z',accounts:[{id:'a1'}],...overrides});
assert.equal(H.assess(connected(),[],['a1'],now).status,'recent-sync-reported');
assert.equal(H.assess(connected(),[],['a1'],now).authoritative,false);
assert.equal(H.assess(connected({lastSuccessfulSync:null}),[],[],now).status,'attention');
assert.equal(H.assess(connected({lastSuccessfulSync:'2026-10-01T10:00:00Z'}),[],['a1'],now).status,'stale');
assert.deepEqual(H.assess(connected(),[],['a1','missing'],now).missingAccountIds,['missing']);
const pending=H.assess(connected(),[
 {date:'2026-10-09',pending:true,source:{provider:'plaid'}},
 {date:'2026-10-17',pending:true,source:{provider:'plaid'}}],['a1'],now);
assert.equal(pending.pendingCount,2);
assert.equal(pending.oldPendingCount,1);
const source=[A.buildScenario(),B.buildScenario(),C.buildScenario()];
const unchanged=source.map(x=>JSON.stringify(x));
assert.ok(source[2].some(x=>x.account==='Business'&&x.type==='income'));
const report=R.run([A,B,C],Lab,F,L,M);
assert.equal(report.householdCount,3);
assert.equal(report.scenarioCount,4);
assert.equal(report.trialCount,36);
assert.ok(report.results.every(s=>s.trials===9&&Number.isFinite(s.delta90DayError)));
assert.equal(report.results.find(s=>s.id==='ambiguous-transfer').delta90DayError,0,
 'Unknown-direction transfers have no assumed checking impact');
assert.ok(report.results.find(s=>s.id==='employer-change').deltaRecall<0,
 'New employer identity must not be silently merged');
assert.ok(report.results.find(s=>s.id==='new-account').deltaRecall<0,
 'Unseen account has no known recurring schedule yet');
assert.deepEqual(report,R.run([A,B,C],Lab,F,L,M),'Stress results deterministic');
assert.deepEqual(source.map(x=>JSON.stringify(x)),unchanged,'Synthetic fixtures immutable');
const cutoff='2026-07-01',historical=source[0].filter(t=>t.date<=cutoff);
const state=M.migrate({transactions:historical}),f=L.build(state,M.records(state),cutoff,90,F,M);
assert.ok(f.events.some(t=>t.type==='income'&&t.postingStatus==='unconfirmed'&&t.confirmed===false));
assert.ok(f.events.filter(t=>t.type==='income').every(t=>t.postingStatus==='unconfirmed'));
const manual=M.migrate({transactions:historical});
M.saveEvent(manual,{id:'manual-in',date:'2026-07-18',amount:555,type:'income',description:'Expected gift',accountId:'demo-checking'});
const manually=L.build(manual,M.records(manual),cutoff,90,F,M);
assert.ok(manually.events.some(t=>t.id==='manual-in'&&t.postingStatus==='unconfirmed'));
assert.deepEqual(source[0].filter(t=>t.date<=cutoff),historical);
const unknownHistory=R.perturb(source[1],cutoff,'ambiguous-transfer').filter(t=>t.date<=cutoff);
const withTransfers=L.build(M.migrate({transactions:unknownHistory}),unknownHistory,cutoff,90,F,M);
assert.ok(!withTransfers.events.some(t=>t.merchant==='Unidentified internal sweep'),
 'Unknown-direction transfers must not invent cash movements');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:860}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const Old=Date;class Fixed extends Old{
   constructor(...args){super(...(args.length?args:['2026-10-17T12:00:00Z']))}
   static now(){return new Old('2026-10-17T12:00:00Z').getTime()}}
   window.Date=Fixed});
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const initialStorage=await page.evaluate(()=>localStorage.getItem('household-ledger-v1'));
  await page.locator('aside [data-page=overview]').click();
  assert.match(await page.locator('.feed-health').innerText(),/demo only|not connected/i);
  assert.match(await page.locator('.income-caution').innerText(),/unconfirmed/i);
  await page.locator('aside [data-page=insights]').click();
  await page.locator('[data-insight=accuracy]').click();
  assert.equal(await page.locator('.readiness-section').count(),1);
  await page.locator('.readiness-section details').first().locator('summary').click();
  assert.equal(await page.locator('.readiness-section tbody tr').count(),4);
  assert.match(await page.locator('.readiness-section').innerText(),/36 fictional trials/);
  assert.equal(await page.evaluate(()=>localStorage.getItem('household-ledger-v1')),initialStorage);
  await page.locator('aside [data-page=settings]').click();
  assert.match(await page.locator('.feed-health-settings').innerText(),/No verified bank sync/i);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No mobile overflow');
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
 const safari=await webkit.launch({headless:true});
 try{
  const page=await safari.newPage({...devices['iPhone 13']});
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  await page.locator('.mobile-top-nav [data-page=overview]').click();
  assert.equal(await page.locator('.feed-health').count(),1);
  await page.locator('.mobile-top-nav [data-page=insights]').click();
  await page.locator('[data-insight=accuracy]').click();
  assert.equal(await page.locator('.readiness-section').count(),1);
 }finally{await safari.close()}
 console.log('PASS: Phase 4.3 feed health, provisional income, expanded fictional scenarios and mobile rendering');
})().catch(e=>{console.error(e);process.exit(1)});
