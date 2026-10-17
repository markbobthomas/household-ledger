const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const F=require('../forecast.js'),Model=require('../ledger-data.js');
const fs=require('fs'),vm=require('vm');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../demo-data.js'),'utf8'),context);
const demo=context.window.createHouseholdLedgerDemo();
const source=demo.transactions;
const todays='2026-10-16';
const groceries=F.forecast(source,'2026-10','Groceries',todays);
assert.ok(groceries.expected.length>=3,'Regular grocers create specific future dates');
assert.ok(groceries.expected.every(t=>t.date>todays&&t.date.startsWith('2026-10')),'Only future current-month dates forecast');
assert.ok(groceries.expected.some(t=>t.merchant==='Costco Warehouse'&&t.date==='2026-10-18'),'Repeated Costco history forecasts Oct 18');
assert.ok(groceries.expected.some(t=>t.merchant==='Safeway'&&t.date==='2026-10-21'),'Repeated Safeway history forecasts Oct 21');
assert.ok(groceries.expected.every(t=>t.evidence>=2&&t.confidence),'Each forecast gives evidence and confidence');
assert.equal(groceries.additional,Math.round(groceries.expected.reduce((n,t)=>n+t.amount,0)*100)/100,'Prediction amount = dated entries, no hidden variable lump');
assert.equal(groceries.variable,0,'No undated catch-all spending');
const subs=F.forecast(source,'2026-10','Subscriptions',todays);
assert.equal(subs.expected.some(t=>t.merchant==='Netflix'),false,'Already-paid monthly Netflix is not forecast again');
assert.ok(subs.expected.some(t=>t.merchant==='Spotify'&&t.date==='2026-10-19'),'Future Spotify bill is forecast on observed date');
const historyOnly=F.forecast(source,'2026-09','Subscriptions',todays);
assert.equal(historyOnly.expected.length,0,'Closed months contain no future predictions');
const insufficient=F.forecast([
 {id:'a',type:'expense',date:'2026-09-06',merchant:'Once only',category:'Groceries',amount:100,account:'Checking'},
 {id:'b',type:'expense',date:'2026-10-02',merchant:'Once only',category:'Groceries',amount:100,account:'Checking'}
],'2026-10','Groceries',todays);
assert.equal(insufficient.expected.length,0,'One historical month is insufficient');
const history=source.map(x=>({...x}));
history.push({id:'already-paid',type:'expense',date:'2026-10-18',merchant:'Costco Warehouse',amount:160,category:'Groceries',account:'Checking'});
const sameDay=F.forecast(history,'2026-10','Groceries','2026-10-19');
assert.ok(!sameDay.expected.some(t=>t.merchant==='Costco Warehouse'&&t.date==='2026-10-18'),'Posted charge is not predicted twice');
const state=Model.migrate({...demo});
const original=JSON.stringify(state.transactions);
const predicted=groceries.expected.find(t=>t.merchant==='Costco Warehouse'&&t.date==='2026-10-18');
Model.updateExpectedTransaction(state,predicted.id,{date:'2026-10-20',amount:140,enabled:true});
const customized=Model.expectedForCategory(state,groceries.expected,'2026-10','Groceries',todays);
assert.equal(customized.find(t=>t.id===predicted.id).amount,140);
assert.equal(customized.find(t=>t.id===predicted.id).date,'2026-10-20');
Model.saveManualExpected(state,{category:'Groceries',merchant:'Expected farmers market',date:'2026-10-23',amount:75});
assert.ok(Model.expectedForCategory(state,groceries.expected,'2026-10','Groceries',todays).some(t=>t.merchant==='Expected farmers market'));
assert.equal(JSON.stringify(state.transactions),original,'All prediction changes leave actuals byte-for-byte unchanged');

(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Base=Date;class Fixed extends Base{constructor(...a){if(a.length)super(...a);else super('2026-10-16T12:00:00Z')}static now(){return new Base('2026-10-16T12:00:00Z').getTime()}}
  window.Date=Fixed;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const budget=page.locator('.budget-entry[data-budget-category="Groceries"]');
  await budget.locator(':scope > details > summary').click();
  const expected=budget.locator('.expected-tx');
  assert.ok(await expected.count()>=3,'Groceries expected transaction rows are visible on expansion');
  const first=expected.first();
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  const id=await first.getAttribute('data-expected');
  await first.locator('summary').click();
  const form=first.locator('form[data-expected-form]');
  assert.ok(await form.locator('input[name=date]').count(),'Expected date is editable inline');
  assert.ok(await form.locator('input[name=amount]').count(),'Expected amount is editable inline');
  assert.equal(await form.locator('input[name=merchant]').count(),0,'Historical merchant is not edited');
  const originalAmount=await form.locator('input[name=amount]').inputValue();
  await form.locator('input[name=amount]').fill('156.78');
  await form.locator('button[type=submit]').click();
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.deepEqual(after.transactions,before.transactions,'Editing dated estimate never touches posted ledger');
  assert.equal(after.predictions.expectedTransactionOverrides[id].amount,156.78,'Expected payment edit persisted as override');
  assert.equal(await budget.locator(':scope > details').evaluate(e=>e.open),true,'Category stays expanded after edit');
  const projection=budget.locator('.expected-total');
  assert.ok((await projection.innerText()).startsWith('$'),'Expected total updates');
  await page.reload({waitUntil:'load'});
  await budget.locator(':scope > details > summary').click();
  const edited=budget.locator('.expected-tx').filter({has:page.locator('[data-expected-form="'+id+'"]')});
  assert.equal(await edited.locator('.expected-value').innerText(),'$156.78','Expected value persists after reload');
  await edited.locator('summary').click();
  await edited.locator('[data-expected-reset]').click();
  const reset=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(reset.predictions.expectedTransactionOverrides[id],undefined,'Automatic historical estimate restored');
  const add=budget.locator('.expected-add');
  await add.locator('summary').click();
  await add.locator('[name=merchant]').fill('Expected farmers market');
  await add.locator('[name=date]').fill('2026-10-23');
  await add.locator('[name=amount]').fill('50');
  await add.locator('button[type=submit]').click();
  const added=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(added.predictions.manualExpectedTransactions.length,1,'One-off expected payment added to forecasts only');
  assert.deepEqual(added.transactions,before.transactions,'Expected payment not added to actual ledger');
  await page.setViewportSize({width:390,height:844});
  const bounds=await page.evaluate(()=>({actual:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.ok(bounds.actual<=bounds.viewport+1,'Dated forecasts stay within phone width');
  assert.deepEqual(errors,[],'No script errors');
  console.log('PASS: Historical dated forecasts, paid-charge suppression, inline edits, reset, manual estimates, phone');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
