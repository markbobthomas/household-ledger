const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const model=require('../cashflow.js');
const bank=require('../bank-feed.js');
const runModel=()=>model.cashFlow90({account:bank.getSnapshot('2026-10-16').accounts[0],asOf:'2026-10-16',days:90,transactions:[
  {date:'2026-07-01',merchant:'Paycheck',amount:3000,type:'income',category:'Other',account:'Checking'},
  {date:'2026-08-01',merchant:'Paycheck',amount:3000,type:'income',category:'Other',account:'Checking'},
  {date:'2026-09-01',merchant:'Paycheck',amount:3000,type:'income',category:'Other',account:'Checking'},
  {date:'2026-07-02',merchant:'Rent',amount:1800,type:'expense',category:'Housing',account:'Checking'},
  {date:'2026-08-02',merchant:'Rent',amount:1800,type:'expense',category:'Housing',account:'Checking'},
  {date:'2026-09-02',merchant:'Rent',amount:1800,type:'expense',category:'Housing',account:'Checking'},
  {date:'2026-07-16',merchant:'Groceries',amount:90,type:'expense',category:'Groceries',account:'Checking'},
  {date:'2026-08-16',merchant:'Groceries',amount:90,type:'expense',category:'Groceries',account:'Checking'},
  {date:'2026-09-16',merchant:'Groceries',amount:90,type:'expense',category:'Groceries',account:'Checking'},
  {date:'2026-09-10',merchant:'Wrong account expense',amount:500000,type:'expense',category:'Housing',account:'Savings'},
  {date:'2026-10-16',merchant:'Already in bank balance',amount:8000,type:'expense',category:'Shopping',account:'Checking'}
]});
const testForecast=runModel();
assert.equal(testForecast.series.length,91,'90 future days plus current snapshot');
assert.equal(testForecast.opening,5400.25,'Opening value comes from bank feed, not a user input');
assert.equal(testForecast.series[1].date,'2026-10-17','Start next day to avoid double counting posted transactions');
assert.equal(testForecast.through,'2027-01-14','Exactly 90 days after Oct 16');
assert.ok(testForecast.streams.some(x=>x.merchant==='Paycheck'),'Detect future regular income');
assert.ok(testForecast.streams.some(x=>x.merchant==='Rent'),'Detect future bills');
assert.ok(testForecast.minimum===Math.min(...testForecast.series.slice(1).map(d=>d.balance)),'Lowest forecast is computed across future balances');
const {chromium:chromiumBrowser}=require('playwright');
(async()=>{
 const browser=await chromiumBrowser.launch({headless:true});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   const Base=Date;
   class DemoDate extends Base{
     constructor(...args){if(args.length)super(...args);else super('2026-10-16T12:00:00Z')}
     static now(){return new Base('2026-10-16T12:00:00Z').getTime()}
   }
   window.Date=DemoDate;
 });
 try{
   await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
   assert.equal(await page.locator('#title').innerText(),'Budgets');
   const card=page.locator('#cashflow');
   assert.equal(await card.count(),1,'Cash-flow forecast visible on main page');
   assert.match(await card.innerText(),/SIMULATED BANK DATA/);
   assert.match(await card.innerText(),/Everyday Checking/);
   assert.match(await card.innerText(),/Lowest projected balance/);
   assert.match(await card.innerText(),/Oct 31, 2026/);
   assert.match(await card.innerText(),/\$5,036\.02/,'Known demo low balance');
   assert.equal(await card.locator('input').count(),0,'No manual bank starting balance input');
   assert.equal(await card.locator('svg.cash-chart').count(),1,'Forecast chart visible');
   const details=card.locator('details.cash-detail').first();
   await details.locator('summary').first().click();
   assert.equal(await details.evaluate(el=>el.open),true,'90-day detail expands');
   assert.equal(await details.locator('tbody tr').count(),90,'Shows each day of the forecast');
   await details.locator('tr').nth(2).locator('details.cash-day-detail summary').click();
   assert.ok(await details.locator('.cash-day-detail[open]').count()>0,'Projected day shows its entries');
   // Personal browser-local spending must not enter the fake bank simulation.
   await page.evaluate(()=>{const key='household-ledger-v1',d=JSON.parse(localStorage.getItem(key));
     d.transactions.push({id:'personal',date:'2026-09-01',merchant:'Private expense',type:'expense',category:'Housing',amount:9999999,account:'Checking'});
     localStorage.setItem(key,JSON.stringify(d));
   });
   await page.reload({waitUntil:'load'});
   assert.match(await page.locator('#cashflow').innerText(),/\$5,036\.02/,'Forecast ignores personal transactions in demo mode');
   await page.locator('#period').selectOption('2026-09');
   assert.match(await page.locator('#cashflow').innerText(),/Oct 31, 2026/,'90-day forecast independent of selected budget month');
   assert.deepEqual(errors,[],'No JavaScript runtime errors');
   console.log('PASS: Simulated bank balance, low date/amount, 90-day chart & details, isolation from real data, budget date independence');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
