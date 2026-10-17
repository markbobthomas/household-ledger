const {chromium,webkit,devices}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 for (const [name,engine,options] of [
  ['desktop',chromium,{viewport:{width:1440,height:850}}],
  ['narrow-desktop',chromium,{viewport:{width:795,height:820}}],
  ['phone-chromium',chromium,{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3}],
  ['iphone-webkit',webkit,{...devices['iPhone 13']}]
 ]) {
  const browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage(options);
   await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
   const measure=()=>page.evaluate(()=>{
    const rect=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
    return {innerWidth,innerHeight,devicePixelRatio,visualWidth:visualViewport?.width,visualHeight:visualViewport?.height,docWidth:document.documentElement.scrollWidth,docHeight:document.documentElement.scrollHeight,
      bodyWidth:document.body.scrollWidth,bodyHeight:document.body.scrollHeight,
      scrollTop:scrollY, maxScroll:document.documentElement.scrollHeight-innerHeight,
      documentOverflow:getComputedStyle(document.documentElement).overflowY,bodyOverflow:getComputedStyle(document.body).overflowY,
      scrolled:document.scrollingElement===document.body?'body':'html',
      pageTop:rect('.page-top'),content:rect('.content'),main:rect('main'),nav:rect('.mobile-top-nav'),bottomNav:rect('aside'),toolbar:rect('.toolbar'),view:rect('#view'),
      settingsColumns:getComputedStyle(document.querySelector('.settings-grid')||document.body).gridTemplateColumns
    };
   });
   const before=await measure();
   await page.evaluate(()=>window.scrollTo(0,800));
   const budgetScrolled=await measure();
   await page.locator(name.includes('phone')||name.includes('iphone')?'.mobile-top-nav [data-page="settings"]':'aside [data-page="settings"]').click();
   const after=await measure();
   assert.ok(after.scrollTop<=1,'Settings must start at top without animated scrolling on '+name+': '+JSON.stringify({afterScroll:after.scrollTop}));
   assert.equal(after.innerWidth,before.innerWidth,'Settings must not resize viewport width on '+name);
   assert.equal(after.visualHeight,before.visualHeight,'Settings must not resize viewport height on '+name);
   assert.ok(Math.abs(after.pageTop.x-before.pageTop.x)<=1,'Settings header must not shift left/right on '+name);
   assert.ok(Math.abs(after.pageTop.width-before.pageTop.width)<=1,'Settings header width must stay stable on '+name);
   assert.ok(after.docHeight>after.innerHeight,'Settings should retain a scrollable canvas on '+name);
   await page.locator(name.includes('phone')||name.includes('iphone')?'.mobile-top-nav [data-page="budgets"]':'aside [data-page="budgets"]').click();
   const back=await measure();
   assert.ok(back.scrollTop<=1,'Returning to Budget starts at top without animation on '+name);
   console.log('PASS SETTINGS SIZE '+name+' '+JSON.stringify({width:after.docWidth,viewportWidth:after.innerWidth,viewportHeight:after.innerHeight,settingsScroll:after.scrollTop,settingsHeight:after.docHeight,budgetScroll:budgetScrolled.scrollTop}));
  } finally {await browser.close()}
 }
})().catch(e=>{console.error(e);process.exit(1)});
