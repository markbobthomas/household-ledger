const { chromium }=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1365,height:850}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const nav=page.locator('aside button[data-page]');
  assert.deepEqual(await nav.allInnerTexts(),['Budget','Activity','Insights','Reviews','Settings']);
  assert.equal(await page.locator('link[href^="modern.css?v="]').count(),1,'Versioned core style sheet loaded');
  assert.equal(await page.locator('style').count(),0,'Legacy inline CSS removed');
  assert.equal(await page.locator('.eyebrow').count(),0,'Decorative eyebrow removed');
  assert.equal(await page.locator('.page-top').count(),1,'Dense title and actions row');
  assert.equal(await page.locator('.panel').first().evaluate(e=>getComputedStyle(e).boxShadow),'none','Reports use flat surfaces');
  assert.equal(await page.locator('#cashflow .cash-primary-amount').count(),1,'Single hero metric');
  assert.equal(await page.locator('#cashflow .cash-numbers').count(),0,'Old four-card row removed');
  assert.equal(await page.locator('.budget-entry .budget-edit').count(),0,'Budget edit buttons not repeated outside rows');
  assert.equal(await page.locator('#addBtn').count(),0,'No add transaction button');
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
  // Switching between a long Budget page and short Settings page must not
  // shift the overall workspace as the browser scrollbar appears/disappears.
  const geometry=()=>page.evaluate(()=>{
    const r=document.querySelector('.page-top').getBoundingClientRect(),
      c=document.querySelector('.content').getBoundingClientRect();
    return {left:r.left,width:r.width,contentLeft:c.left,contentWidth:c.width};
  });
  const beforeSettings=await geometry();
  await page.locator('aside [data-page="settings"]').click();
  const settingsGeometry=await geometry();
  for(const key of Object.keys(beforeSettings)){
    assert.ok(Math.abs(beforeSettings[key]-settingsGeometry[key])<=1,
      'Settings layout should not shift '+key+': '+JSON.stringify({beforeSettings,settingsGeometry}));
  }
  await page.locator('aside [data-page="insights"]').click();
  assert.equal(await page.locator('[data-insight="recurring"]').innerText(),'Recurring',
    'Recurring tab has short label');
  await page.locator('aside [data-page="budgets"]').click();
  await page.setViewportSize({width:390,height:844});
  await page.reload({waitUntil:'load'});
  assert.equal(await page.locator('#title').isVisible(),true);
  assert.equal(await page.locator('#addBtn').count(),0,'No manual transaction entry on phone');
  const sizes=await page.evaluate(()=>({body:document.documentElement.scrollWidth,window:innerWidth,canvas:document.body.scrollWidth}));
  assert.ok(sizes.body<=sizes.window+1,'No phone-width horizontal document overflow: '+JSON.stringify(sizes));
  assert.equal(await page.locator('.mobile-top-nav').isVisible(),true,'Section tabs visible near top on phones');
  assert.deepEqual(await page.locator('.mobile-top-nav button').allInnerTexts(),['Budget','Activity','Insights','Reviews','Settings']);
  const topTabs=await page.evaluate(()=>{
    const n=document.querySelector('.mobile-top-nav'),r=n.getBoundingClientRect(),b=n.querySelector('button');
    const br=b.getBoundingClientRect(),target=document.elementFromPoint(br.left+br.width/2,br.top+br.height/2);
    return {display:getComputedStyle(n).display,position:getComputedStyle(n).position,top:r.top,clickable:b===target||b.contains(target)};
  });
  assert.equal(topTabs.display,'grid','Phone section selector is displayed');
  assert.equal(topTabs.position,'sticky','Section tabs remain handy when scrolling');
  assert.ok(topTabs.top>=0&&topTabs.top<190,'Tabs are at top of phone screen: '+JSON.stringify(topTabs));
  assert.ok(topTabs.clickable,'Navigation buttons are unobstructed');
  const mobileSize=()=>page.evaluate(()=>({
    viewport:window.innerWidth,
    scrollWidth:document.documentElement.scrollWidth,
    mainWidth:document.querySelector('main').getBoundingClientRect().width
  }));
  const budgetSize=await mobileSize();
  await page.locator('.mobile-top-nav [data-page="settings"]').click();
  const settingsSize=await mobileSize();
  assert.ok(Math.abs(settingsSize.mainWidth-budgetSize.mainWidth)<=1,
    'Phone workspace does not resize on Settings: '+JSON.stringify({budgetSize,settingsSize}));
  assert.ok(settingsSize.scrollWidth<=settingsSize.viewport+1,'No Settings horizontal overflow');
  await page.locator('.mobile-top-nav [data-page="insights"]').click();
  assert.equal(await page.locator('#title').innerText(),'Insights','Top section tabs navigate');
  assert.equal(await page.locator('[data-insight="recurring"]').innerText(),'Recurring',
    'Short Recurring tab appears on phone');
  await page.locator('.mobile-top-nav [data-page="budgets"]').click();
  await page.evaluate(()=>window.scrollTo(0,Math.floor(document.body.scrollHeight/2)));
  const stickyTop=await page.locator('.mobile-top-nav').evaluate(e=>e.getBoundingClientRect().top);
  assert.ok(stickyTop>=65&&stickyTop<=85,'Navigation row stays pinned near top while scrolling: '+stickyTop);
  await page.evaluate(()=>window.scrollTo(0,0));
  const mobile=await page.evaluate(()=>{
    const nav=document.querySelector('aside'),buttons=[...nav.querySelectorAll('button[data-page]')],bar=document.querySelector('.budget-progress');
    const nr=nav.getBoundingClientRect();
    return {
      navPosition:getComputedStyle(nav).position,navBottom:nr.bottom,
      viewportHeight:innerHeight,
      navColumns:getComputedStyle(nav).gridTemplateColumns.split(' ').length,
      iconCount:buttons.filter(b=>getComputedStyle(b.querySelector('.nav-icon')).display!=='none').length,
      smallestTarget:Math.min(...buttons.map(b=>b.getBoundingClientRect().height)),
      budgetBarHeight:bar.getBoundingClientRect().height,
      chartViewBox:document.querySelector('.cash-chart').getAttribute('viewBox')
    };
  });
  assert.equal(mobile.navPosition,'fixed','Phone navigation should be docked');
  assert.ok(Math.abs(mobile.navBottom-mobile.viewportHeight)<=2,'Bottom navigation should touch screen bottom');
  assert.equal(mobile.navColumns,5,'Five phone navigation destinations');
  assert.equal(mobile.iconCount,5,'Phone navigation shows five icons');
  assert.ok(mobile.smallestTarget>=44,'Navigation has touch-sized buttons');
  assert.ok(mobile.budgetBarHeight>=16,'Budget bars are prominent on mobile');
  assert.ok(mobile.chartViewBox.includes('560 260'),'Bank chart uses phone-readable axis labels');
  await page.locator('aside [data-page="transactions"]').click();
  assert.equal(await page.locator('.ledger-table tr').first().evaluate(e=>getComputedStyle(e).display),'grid','Transactions become phone-friendly rows');
  await page.locator('aside [data-page="budgets"]').click();
  await page.locator('.cash-panel .cash-detail > summary').first().click();
  assert.equal(await page.locator('.daily-cash-table tr').first().evaluate(e=>getComputedStyle(e).display),'grid','Daily cash flow becomes phone-friendly rows');
  await page.setViewportSize({width:320,height:740});
  const narrow=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,width:innerWidth,bars:[...document.querySelectorAll('.budget-progress')].map(x=>x.getBoundingClientRect().height)}));
  assert.ok(narrow.doc<=narrow.width+1,'No overflow on narrow phones: '+JSON.stringify(narrow));
  assert.ok(narrow.bars.every(h=>h>=16),'All budget bars remain thick on narrow phones');
  await page.setViewportSize({width:390,height:844});
  await page.locator('aside [data-page="insights"]').click();
  await page.locator('[data-insight="merchants"]').click();
  assert.equal(await page.locator('.panel details.drill-detail').count()>0,true);
  await page.locator('[data-insight="bands"]').click();
  assert.equal(await page.locator('details.band-detail').count(),7);
  await page.locator('aside [data-page="settings"]').click();
  assert.equal(await page.locator('#settings-import').count(),0,'No bank statement import or manual entry on phone');
  assert.equal(await page.locator('#backup').isVisible(),true,'Read-only export available on phone');
  assert.deepEqual(errors,[],'No JavaScript errors');
  console.log('PASS: High-contrast developer layout, no legacy CSS, working controls, mobile width and preserved insights');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
