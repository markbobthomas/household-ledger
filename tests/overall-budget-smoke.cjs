'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:860}});
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  await page.locator('aside [data-page=budgets]').click();
  const overall=page.locator('section[aria-label="Overall monthly budget"]');
  assert.equal(await overall.count(),1,'One overall budget summary');
  assert.equal(await overall.locator('.budget-progress').count(),1,'Overall progress bar is visible');
  const actual=await overall.locator('.budget-progress').getAttribute('aria-label');
  assert.ok(actual.includes('spent')&&actual.includes('expected')&&actual.includes('total budget'));
  assert.ok(await page.locator('.budget-entry').count()>=10,'Individual category budgets remain');
  const limits=await page.locator('[data-inline-budget]').evaluateAll(items=>items.map(e=>Number(e.dataset.amount)||0));
  const overallLimit=Number(actual.match(/total budget \$([\d,.]+)/)?.[1]?.replace(/,/g,''));
  assert.ok(Math.abs(overallLimit-limits.reduce((a,b)=>a+b,0))<.01,'Overall cap sums category caps');
  const groceries=page.locator('.budget-entry[data-budget-category="Groceries"]');
  const cap=groceries.locator('[data-inline-budget]'),oldCap=Number(await cap.getAttribute('data-amount'))||0;
  await cap.click();
  await groceries.locator('.inline-money-input').fill(String(oldCap+37));
  await groceries.locator('.inline-money-input').press('Enter');
  const newLabel=await overall.locator('.budget-progress').getAttribute('aria-label');
  const newLimit=Number(newLabel.split('total budget $')[1]?.replace(/,/g,''));
  assert.ok(Math.abs(newLimit-overallLimit-37)<.01,'Overall budget updates immediately after uncapped or capped category edit');
  assert.ok((await overall.innerText()).includes(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(newLimit)),'Visible overall total updates');
  console.log('PASS overall budget sums individual category caps and preserves category rows');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
