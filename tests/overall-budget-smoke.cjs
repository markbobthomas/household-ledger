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
  console.log('PASS overall budget sums individual category caps and preserves category rows');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
