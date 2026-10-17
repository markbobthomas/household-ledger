const {webkit,devices}=require('playwright');
const assert=require('node:assert/strict');

(async()=>{
 const browser=await webkit.launch({headless:true});
 try{
  const page=await browser.newPage({...devices['iPhone 13']});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const top=page.locator('.mobile-top-nav');
  assert.ok(await top.isVisible(),'Top navigation visible in iPhone Safari');
  assert.deepEqual(await top.locator('[data-page]').allInnerTexts(),['Budget','Overview','Activity','Insights','Reviews','Settings']);
  const style=await top.evaluate(e=>({top:e.getBoundingClientRect().top,position:getComputedStyle(e).position,background:getComputedStyle(e).backgroundColor}));
  assert.equal(style.position,'sticky');
  assert.ok(style.top>=0&&style.top<160,'Navigation is near phone top: '+JSON.stringify(style));
  await top.locator('[data-page="insights"]').click();
  assert.equal(await page.locator('#title').innerText(),'Insights');
  assert.ok(await top.locator('[data-page="insights"]').evaluate(e=>e.classList.contains('active')));
  await top.locator('[data-page="budgets"]').click();
  await page.evaluate(()=>window.scrollTo(0,Math.floor(document.body.scrollHeight/2)));
  await page.waitForTimeout(150);
  const b=await top.boundingBox();
  assert.ok(b.y>=65&&b.y<=85,'Top tabs remain sticky after scrolling: '+JSON.stringify(b));
  assert.equal(await page.locator('aside [data-page="insights"]').isVisible(),true,'Bottom app tabs remain available');
  assert.deepEqual(errors,[],'No client errors on iPhone WebKit');
  console.log('PASS: iPhone WebKit navigation visible, sticky, tappable and synchronized with bottom tabs');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
