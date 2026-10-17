const {chromium}=require('playwright');
const assert=require('node:assert/strict');
async function testMonth(browser,date,expectedMonth){
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(iso=>{
    const Native=Date;
    class StubDate extends Native{
      constructor(...args){if(args.length)super(...args);else super(iso+'T12:00:00Z')}
      static now(){return new Native(iso+'T12:00:00Z').getTime()}
    }
    window.Date=StubDate;
  },date);
  try{
    await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
    assert.equal(await page.locator('#period').inputValue(),expectedMonth,'Budgets starts in current month');
    const pages=['transactions','insights','settings'];
    for(const view of pages){
      await page.locator('aside [data-page="'+view+'"]').click();
      assert.equal(await page.locator('#period').inputValue(),expectedMonth,view+' starts in current month');
      assert.equal(await page.locator('#period option[value="all"]').count(),1,'All dates remains optional');
    }
    // On sparse or future months, do not fall back to All dates.
    await page.locator('aside [data-page="transactions"]').click();
    assert.equal(await page.locator('#period').inputValue(),expectedMonth,'No-data month remains selected');
    await page.locator('#period').selectOption('all');
    assert.equal(await page.locator('#period').inputValue(),'all','All dates is still selectable');
    await page.locator('aside [data-page="insights"]').click();
    assert.equal(await page.locator('#period').inputValue(),'all','Manual All dates choice preserved between non-budget pages');
    await page.locator('#period').selectOption('2026-09');
    await page.locator('aside [data-page="budgets"]').click();
    assert.equal(await page.locator('#period').inputValue(),'2026-09','Chosen month stays in sync with Budgets');
    await page.locator('#period').selectOption(expectedMonth);
    await page.locator('aside [data-page="insights"]').click();
    assert.equal(await page.locator('#period').inputValue(),expectedMonth,'Budget selection syncs to Insights');
    assert.deepEqual(errors,[],'No JavaScript errors while changing dates');
    const dims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:window.innerWidth}));
    assert.ok(dims.scroll<=dims.width+1,'No horizontal overflow on phone');
  }finally{await page.close()}
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  await testMonth(browser,'2026-10-16','2026-10');
  await testMonth(browser,'2026-11-16','2026-11');
  console.log('PASS: Current month defaults on all pages, empty-month retention, All dates option, synced month selection and phone layout');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
