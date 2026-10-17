const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const M=require('../ledger-data.js');
const cash=require('../cashflow.js');
const bank=require('../bank-feed.js');

const v1={transactions:[{id:'old-1',date:'2026-09-01',merchant:'Rent',amount:2000,type:'expense',category:'Housing',account:'Checking'}],items:[],budgets:{Housing:2800}};
const migrated=M.migrate(v1);
assert.equal(migrated.version,2);
assert.equal(migrated.transactions[0].source.provider,'legacy-unverified','Existing data must not be relabeled as bank-verified');
assert.equal(migrated.predictions.monthlyBudgets.Housing,2800,'Old budgets are migrated to predictions');
const original=JSON.stringify(migrated.transactions);
M.setCategory(migrated,'old-1','Other');
assert.equal(JSON.stringify(migrated.transactions),original,'Categorization must not alter source record');
assert.equal(M.records(migrated)[0].category,'Other');
M.setCategory(migrated,'old-1','Housing');
assert.equal(Object.keys(migrated.categoryOverrides).length,0,'Resetting to source category clears override');
M.setCategoryForecast(migrated,'2026-10','Housing',1250);
M.setMonthlyBudget(migrated,'Housing',2600);
assert.equal(JSON.stringify(migrated.transactions),original,'Forecast/budget changes never rewrite ledger');
assert.equal(M.migrate(migrated).predictions.categoryForecasts['2026-10|Housing'].additional,1250,'Migration is idempotent');
assert.throws(()=>M.setCategory(migrated,'missing','Shopping'));
assert.throws(()=>M.setCategory(migrated,'old-1','Fabricated'));
assert.throws(()=>M.setCategoryForecast(migrated,'2026-10','Housing',-1));
assert.throws(()=>M.saveEvent(migrated,{date:'2026-10-21',amount:-10,type:'expense',description:'Fake'}));
const eventId=M.saveEvent(migrated,{date:'2026-10-21',amount:200,type:'expense',description:'Forecasted home repair'});
assert.equal(migrated.predictions.cashFlowEvents[0].id,eventId);
assert.equal(JSON.stringify(migrated.transactions),original,'Predicted event does not become actual');
const b=bank.getSnapshot('2026-10-16').accounts[0];
const history=[
 {date:'2026-07-01',merchant:'Salary',amount:2000,type:'income',account:'Checking'},
 {date:'2026-08-01',merchant:'Salary',amount:2000,type:'income',account:'Checking'},
 {date:'2026-09-01',merchant:'Salary',amount:2000,type:'income',account:'Checking'}
];
const baseline=cash.cashFlow90({account:b,asOf:'2026-10-16',transactions:history});
const adjusted=cash.cashFlow90({account:b,asOf:'2026-10-16',transactions:history,predictionOverrides:{events:[{date:'2026-10-21',amount:200,type:'expense',description:'Forecasted home repair',accountId:b.id}],dailyVariable:3}});
assert.equal(adjusted.opening,baseline.opening,'Bank balance is immutable');
assert.equal(adjusted.closing,Math.round((baseline.closing-200-90*3)*100)/100,'Adjustments affect future balances only');
const sample=[
 {transaction_id:'bank-101',account_id:'checking-1',date:'2026-09-21',name:'Grocer',amount:45.5,pending:true}
];
const store=M.migrate({});
M.applyPlaidSync(store,{added:sample,modified:[],removed:[],nextCursor:'cursor-a'});
assert.equal(store.transactions.length,1);
assert.equal(store.transactions[0].amount,45.5);
assert.equal(store.transactions[0].source.provider,'plaid');
M.setCategory(store,'plaid:bank-101','Groceries');
M.applyPlaidSync(store,{added:[],modified:[{...sample[0],amount:46,pending:false}],removed:[],nextCursor:'cursor-b'});
assert.equal(store.transactions.length,1,'Provider re-sync is an upsert, not a duplicate');
assert.equal(store.transactions[0].amount,46,'Provider, not user, can reconcile changed bank charge');
assert.equal(M.records(store)[0].category,'Groceries','Category override survives provider updates');
M.applyPlaidSync(store,{added:[{transaction_id:'bank-102',pending_transaction_id:'bank-101',account_id:'checking-1',date:'2026-09-22',name:'Grocer',amount:46}],modified:[],removed:[{transaction_id:'bank-101'}]});
assert.equal(store.transactions.length,1,'Pending-to-posted transactions reconcile');
assert.equal(M.records(store)[0].category,'Groceries','Pending category transfers to posted ID');

(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1365,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Base=Date;
  class FixedDate extends Base{constructor(...a){if(a.length)super(...a);else super('2026-10-16T12:00:00Z')}static now(){return new Base('2026-10-16T12:00:00Z').getTime()}}
  window.Date=FixedDate;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  assert.equal(await page.locator('#addBtn,#importBtn,#settings-import,#restore,#load-demo').count(),0,'Cannot manually add or import ledger rows');
  await page.locator('aside [data-page="transactions"]').click();
  const first=page.locator('.ledger-table tbody tr').first();
  const merchant=await first.locator('td').nth(1).innerText();
  const recordId=await first.locator('[data-category]').getAttribute('data-category');
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  await first.locator('[data-category]').click();
  assert.equal(await page.locator('#entry [name="category"]').count(),1);
  assert.equal(await page.locator('#entry [name="amount"],#entry [name="date"],#entry [name="merchant"],#delete').count(),0,'Category edit shows no bank-field controls');
  await page.locator('#entry [name="category"]').selectOption('Shopping');
  await page.locator('#entry button[type="submit"]').click();
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.deepEqual(after.transactions,before.transactions,'Source ledger must be byte-for-byte unchanged by categorizing');
  assert.equal(after.categoryOverrides[recordId],'Shopping','Category correction stored separately from source');
  await page.reload({waitUntil:'load'});
  await page.locator('aside [data-page="transactions"]').click();
  assert.equal(await page.locator('.ledger-table tbody tr').first().locator('td').nth(2).innerText(),'Shopping','Categorization survives reload');
  await page.locator('aside [data-page="budgets"]').click();
  const category=page.locator('.budget-entry').filter({has:page.locator('.budget-title:text-is("Groceries")')});
  await category.locator('summary').click();
  await category.locator('[data-budget]').click();
  assert.equal(await page.locator('#entry [name="additional"]').count(),1,'Additional category spending can be predicted');
  await page.locator('#entry [name="additional"]').fill('999');
  await page.locator('#entry button[type="submit"]').click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.deepEqual(stored.transactions,before.transactions,'Adjusting a category forecast never writes to ledger');
  assert.equal(stored.predictions.categoryForecasts['2026-10|Groceries'].additional,999);
  await page.locator('.forecast-editor > summary').click();
  const daily=page.locator('[data-daily-prediction]').first();
  await daily.click();
  await page.locator('#entry [name="amount"]').fill('20');
  await page.locator('#entry button[type="submit"]').click();
  const afterDaily=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(afterDaily.predictions.dailyVariable,20,'Daily cash spending is a prediction');
  assert.deepEqual(afterDaily.transactions,before.transactions,'Daily prediction never changes source rows');
  await page.locator('.forecast-editor > summary').click();
  await page.locator('[data-add-event]').click();
  await page.locator('#entry [name="date"]').fill('2026-10-21');
  await page.locator('#entry [name="amount"]').fill('250');
  await page.locator('#entry [name="description"]').fill('Test forecast event');
  await page.locator('#entry button[type="submit"]').click();
  const afterEvent=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(afterEvent.predictions.cashFlowEvents.length,1);
  assert.deepEqual(afterEvent.transactions,before.transactions,'Predicted expense not inserted into ledger');
  await page.locator('aside [data-page="settings"]').click();
  assert.equal(await page.locator('#settings-import,#restore,#addBtn').count(),0);
  assert.match(await page.locator('#view').innerText(),/Read-only ledger/i);
  assert.deepEqual(errors,[],'No browser script errors');
  console.log('PASS: Immutable ledger migration, Plaid reconciliation, categorization persistence and forecast-only controls');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
