'use strict';
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const F=require('../forecast.js');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const mobile of [false,true]){
   const now=new Date(),month=now.toLocaleDateString('en-CA').slice(0,7);
   const previous=new Date(Number(month.slice(0,4)),Number(month.slice(5,7))-2,1);
   const prior=previous.toLocaleDateString('en-CA').slice(0,7);
   const merchant='Sample recurring bill',key=F.patternKey('expense','Subscriptions','Checking',merchant);
   const fixture={transactions:[
    {id:'bill-prev',date:prior+'-05',merchant,amount:100,category:'Subscriptions',account:'Checking',type:'expense',source:{provider:'demo'}},
    {id:'bill-current',date:month+'-05',merchant,amount:100,category:'Subscriptions',account:'Checking',type:'expense',source:{provider:'demo'}}
   ],predictions:{monthlyBudgets:{Subscriptions:30},patternRules:{[key]:{mode:'schedule',frequency:'monthly',anchorDate:prior+'-05',day:5,amount:100}}}};
   const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:900}});
   await page.addInitScript(data=>localStorage.setItem('household-ledger-v1',JSON.stringify(data)),fixture);
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
   const nav=mobile?'.mobile-top-nav':'aside';
   await page.locator(nav+' [data-page=budgets]').click();
   const category=page.locator('[data-budget-category=Subscriptions]'),
    projected=category.locator('.budget-row-projection'),overall=page.locator('.budget-overview-projection');
   assert.equal(await projected.count(),1);
   assert.match(await projected.innerText(),/\$70\.00 over/,'Category displays explicit $70 overage');
   assert.match(await overall.innerText(),/\$70\.00 over/,'Overall budget displays overage');
   for(const el of [projected,category.locator('.budget-overage'),overall]){
    const color=await el.evaluate(e=>getComputedStyle(e).color);
    assert.equal(color,'rgb(180, 35, 50)','Over-budget amount is visibly red');
   }
   const edit=category.locator('[data-inline-budget]');
   await edit.click();await category.locator('.inline-money-input').fill('200');
   await category.locator('.inline-money-input').press('Enter');
   assert.equal(await projected.locator('.budget-overage').count(),0,'Cap increase immediately removes overage');
   assert.equal(await overall.locator('.budget-overage').count(),0,'Overall overage updates when category cap changes');
   assert.equal(await projected.getAttribute('class')?.then(s=>s.includes('over-budget')),false);
   await page.locator(nav+' [data-page=insights]').click();
   await page.locator('[data-insight=categories]').click();
   assert.equal(await page.locator('[data-report-group="category|Subscriptions"] .budget-overage').count(),0,
    'Insights shares the same updated cap');
   await page.locator(nav+' [data-page=budgets]').click();
   await category.locator('[data-inline-budget]').click();
   await category.locator('.inline-money-input').fill('30');
   await category.locator('.inline-money-input').press('Enter');
   await page.locator(nav+' [data-page=insights]').click();
   await page.locator('[data-insight=categories]').click();
   assert.match(await page.locator('[data-report-group="category|Subscriptions"] .budget-overage').innerText(),/\$70\.00/);
   assert.deepEqual(errors,[],'No browser errors');
   await page.close();
  }
  console.log('PASS desktop and mobile red over-budget amounts, exact overages and immediate cap reconciliation across Budget/Insights');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
