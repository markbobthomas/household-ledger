const { chromium }=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1365,height:850}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const nav=page.locator('aside button[data-page]');
  assert.deepEqual(await nav.allInnerTexts(),['Budget','Activity','Insights','Settings']);
  assert.equal(await page.locator('link[href="modern.css"]').count(),1,'Core style sheet loaded');
  assert.equal(await page.locator('style').count(),0,'Legacy inline CSS removed');
  assert.equal(await page.locator('.eyebrow').count(),0,'Decorative eyebrow removed');
  assert.equal(await page.locator('.page-top').count(),1,'Dense title and actions row');
  assert.equal(await page.locator('.panel').first().evaluate(e=>getComputedStyle(e).boxShadow),'none','Reports use flat surfaces');
  assert.equal(await page.locator('#cashflow .cash-primary-amount').count(),1,'Single hero metric');
  assert.equal(await page.locator('#cashflow .cash-numbers').count(),0,'Old four-card row removed');
  assert.equal(await page.locator('.budget-entry .budget-edit').count(),0,'Budget edit buttons not repeated outside rows');
  assert.equal(await page.locator('#addBtn').isVisible(),true);
  const bodyFont=await page.locator('body').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
  const navFont=await page.locator('aside button').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
  assert.ok(bodyFont>=15&&navFont>=14,'Typography should be enlarged across the desktop UI');
  const expectedBar=page.locator('.budget-progress .forecast').first();
  assert.equal(await expectedBar.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 20, 147)','Expected budget spending uses hot pink');
  assert.equal(await page.locator('.budget-legend span').last().evaluate(e=>getComputedStyle(e,'::before').backgroundColor),'rgb(255, 20, 147)','Expected-spending legend matches pink bar');
  await page.locator('aside [data-page="insights"]').click();
  for(const tab of ['categories','merchants','bands','recurring']){
    await page.locator('[data-insight="'+tab+'"]').click();
    const pos=await page.evaluate(()=>({tabs:document.querySelector('.insight-tabs').getBoundingClientRect().top,stats:document.querySelector('.stats').getBoundingClientRect().top}));
    assert.ok(pos.tabs<pos.stats,'Tabs should precede the metrics in '+tab+': '+JSON.stringify(pos));
  }
  const tabFont=await page.locator('.insight-tabs button').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
  assert.ok(tabFont>=14,'Insights tab labels should be larger');
  await page.locator('aside [data-page="budgets"]').click();
  const bodyBg=await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor);
  const asideBg=await page.locator('aside').evaluate(e=>getComputedStyle(e).backgroundColor);
  assert.equal(bodyBg,'rgb(255, 255, 255)','White workspace background active');
  assert.equal(asideBg,'rgb(17, 20, 24)','Near-black navigation active');
  await page.setViewportSize({width:390,height:844});
  await page.reload({waitUntil:'load'});
  assert.equal(await page.locator('#title').isVisible(),true);
  assert.equal(await page.locator('#addBtn').isVisible(),true,'New entry remains accessible on phone');
  const sizes=await page.evaluate(()=>({body:document.documentElement.scrollWidth,window:innerWidth,canvas:document.body.scrollWidth}));
  assert.ok(sizes.body<=sizes.window+1,'No phone-width horizontal document overflow: '+JSON.stringify(sizes));
  await page.locator('aside [data-page="insights"]').click();
  await page.locator('[data-insight="merchants"]').click();
  assert.equal(await page.locator('.panel details.drill-detail').count()>0,true);
  await page.locator('[data-insight="bands"]').click();
  assert.equal(await page.locator('details.band-detail').count(),7);
  await page.locator('aside [data-page="settings"]').click();
  assert.equal(await page.locator('#settings-import').isVisible(),true,'Import available on phone');
  assert.deepEqual(errors,[],'No JavaScript errors');
  console.log('PASS: High-contrast developer layout, no legacy CSS, working controls, mobile width and preserved insights');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
