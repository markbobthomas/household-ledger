const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.goto('http://127.0.0.1:8765/', { waitUntil: 'load' });
    await page.locator('aside [data-page="insights"]').click();
    await page.locator('[data-insight="bands"]').click();
    const bands = page.locator('details.band-detail');
    assert.equal(await bands.count(), 7, 'All seven price bands should render');
    const band = bands.nth(3);
    assert.equal(await band.evaluate(el => el.open), false, 'Band should initially be collapsed');
    await band.locator('summary').click();
    assert.equal(await band.evaluate(el => el.open), true, 'Click must expand band immediately');
    assert.match(await band.innerText(), /Transaction total/i, 'Expanded band should include table');
    const firstEdit = band.locator('button[data-edit]').first();
    assert.ok(await firstEdit.count(), 'Test band should contain an item with edit navigation');
    await firstEdit.click();
    assert.equal(await page.locator('#entry').count(), 1, 'View / edit should open the source transaction');
    await page.locator('#cancel').click();
    await page.locator('#period').selectOption('2026-09');
    const selectedMonth = await page.locator('#period').inputValue();
    assert.equal(selectedMonth, '2026-09', 'Date filter should remain functional');
    await bands.nth(0).locator('summary').click();
    assert.equal(await bands.nth(0).evaluate(el => el.open), true, 'Date-filtered band should expand');
    assert.deepEqual(errors, [], 'Page should have no JavaScript errors');
    console.log('PASS: Price-band expand, detail table, edit navigation, date filter and no script errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1) });
