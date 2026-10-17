const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',err=>errors.push(err.message));
await page.addInitScript(()=>{
  const OriginalDate=Date;
  class DemoDate extends OriginalDate{
    constructor(...args){if(args.length)super(...args);else super('2026-10-16T12:00:00Z')}
    static now(){return new OriginalDate('2026-10-16T12:00:00Z').getTime()}
  }
  window.Date=DemoDate;
});
try{
await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
const categories=page.locator('.grid .panel').first().locator('details.drill-detail');
assert.ok(await categories.count()>2,'Overview categories should be expandable');
await categories.first().locator('summary').click();
assert.ok(await categories.first().evaluate(el=>el.open),'Category should expand');
assert.ok(await categories.first().locator('button[data-edit]').count()>0,'Category should list editable transactions');
const overviewMerchants=page.locator('.grid .panel').nth(1).locator('details.drill-detail');
await overviewMerchants.first().locator('summary').click();
assert.ok(await overviewMerchants.first().evaluate(el=>el.open),'Overview merchants should expand');
await page.locator('aside [data-page="merchants"]').click();
const merchants=page.locator('#view details.drill-detail');
assert.ok(await merchants.count()>5,'Merchant totals should be expandable');
const amazon=page.locator('details.drill-detail').filter({has:page.locator('summary b:text-is("Amazon")')});
assert.ok(await amazon.count()>0,'Amazon should exist in merchant totals');
await amazon.first().locator('summary').click();
assert.ok(await amazon.first().evaluate(el=>el.open),'Amazon drilldown should expand');
assert.ok(await amazon.first().locator('button[data-edit]').count()>0,'Amazon should have transaction rows');
await page.locator('aside [data-page="insights"]').click();
const insightCategories=page.locator('.grid .panel').nth(1).locator('details.drill-detail');
assert.ok(await insightCategories.count()>2,'Insight categories should expand');
await insightCategories.first().locator('summary').click();
assert.ok(await insightCategories.first().evaluate(el=>el.open),'Insight category should expand');
await page.locator('aside [data-page="budgets"]').click();
await page.locator('#period').selectOption('2026-10');
const budget=page.locator('.budget-entry').filter({has:page.locator('summary strong:text-is("Groceries")')});
assert.equal(await budget.count(),1,'Grocery budget should render');
const bar=budget.locator('.budget-progress');
const actual=bar.locator('.actual'),forecast=bar.locator('.forecast');
const actualWidth=await actual.evaluate(el=>parseFloat(el.style.width));
const forecastWidth=await forecast.evaluate(el=>parseFloat(el.style.width));
assert.ok(actualWidth>0&&forecastWidth>0,'Both actual and projected spending should be visible');
const actualColor=await actual.evaluate(el=>getComputedStyle(el).backgroundColor);
const forecastColor=await forecast.evaluate(el=>getComputedStyle(el).backgroundColor);
assert.notEqual(actualColor,forecastColor,'Projected amounts must have a different color');
assert.match(await budget.innerText(),/Projected month-end/i,'Projected month-end total should be visible');
await budget.locator('summary').click();
assert.ok(await budget.locator('details').evaluate(el=>el.open),'Budget category should expand');
assert.ok(await budget.locator('button[data-edit]').count()>0,'Budget should list transactions');
assert.match(await budget.innerText(),/Projected additional/i,'Forecast breakdown should appear in expanded row');
await page.locator('#period').selectOption('2026-09');
const past=page.locator('.budget-entry').filter({has:page.locator('summary strong:text-is("Groceries")')});
assert.match(await past.innerText(),/Past month: actual spending only/);
assert.equal(await past.locator('.forecast').evaluate(el=>parseFloat(el.style.width)),0,'Past months should have no future forecast');
assert.deepEqual(errors,[],'No runtime script errors');
console.log('PASS: Overview categories/merchants, Merchant totals, Insights categories, Budgets drilldown, two-color forecast and past-month behavior');
}finally{await browser.close()}
})().catch(err=>{console.error(err);process.exit(1)});
