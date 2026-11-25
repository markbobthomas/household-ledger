'use strict';
// Fictional desktop + iPhone UI: final one-tap budget, no full Ledger sign-in.
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('./browser-harness.cjs');
const pageSource=fs.readFileSync(path.join(__dirname,'../pilot/category-share.html'),'utf8');
const token='a'.repeat(64);
module.exports=(async()=>{
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json',
   'Cache-Control':'no-store','X-Ledger-Revision':'f'.repeat(64)});res.end(JSON.stringify(body))};
  if(url.pathname==='/categorize'){
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
   return res.end(pageSource);
  }
  if(req.headers['x-ledger-share']!==token)return json(401,{error:'Link unavailable'});
  if(url.pathname==='/api/share/categorize'&&req.method==='GET')
   return json(200,{revision:'f'.repeat(64),categories:['Groceries','Dining','Shopping'],
    items:server.pending?[{kind:'transaction',id:'fixture-1',
     merchant:'Fictional purchase',date:'2026-11-17',amount:42.25,
     category:'Other',reason:'Missing category',
     note:'Amazon: Fictional lunch bag',suggested:null}]:[]});
  if(url.pathname==='/api/share/categorize'&&req.method==='POST'){
   const chunks=[];req.on('data',x=>chunks.push(x));return req.on('end',()=>{
    const choice=JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(choice.id,'fixture-1');
    assert.equal(choice.category,'Groceries');
    server.pending=false;json(200,{saved:true});
   });
  }
  if(url.pathname==='/api/share/budget'&&req.method==='GET')
   return json(200,{month:'2026-11',asOf:'2026-11-24',budgetSet:true,
    spentCents:4225,pendingCents:0,expectedCents:0,expectedIncluded:true,
    usedCents:4225,totalBudgetCents:10000,
    rows:[{name:'Groceries',spentCents:4225,pendingCents:0,
     expectedCents:0,usedCents:4225,targetCents:10000}]});
  json(404,{error:'Not found'});
 });
 server.pending=true;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/categorize#'+token;
 let desktop,iphone;
 try{
  for(const [name,driver,options] of [
   ['Desktop Chromium',chromium,{viewport:{width:1200,height:900}}],
   ['iPhone WebKit',webkit,{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]])
  {
   server.pending=true;
   const browser=await driver.launch({headless:true});
   if(name.startsWith('Desktop'))desktop=browser;else iphone=browser;
   const context=await browser.newContext(options),page=await context.newPage();
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url);
   await page.getByRole('heading',{name:'Categorize purchases'}).waitFor();
   assert.equal(await page.getByText('Fictional purchase').count(),1);
   assert.equal(await page.getByText('Amazon: Fictional lunch bag').count(),1);
   await page.getByRole('button',{name:'Groceries',exact:true}).click();
   await page.getByRole('heading',{name:'All caught up'}).waitFor();
   await page.getByRole('button',{name:'See our budget'}).click();
   await page.getByRole('heading',{name:'Our budget'}).waitFor();
   await page.waitForFunction(()=>document.querySelector('#budget-total')?.textContent?.includes('$57.75'));
   assert.match(await page.locator('#budget-total').textContent(),/\$57\.75/);
   assert.match(await page.locator('#budget-rows').textContent(),/Groceries/);
   assert.equal(await page.getByRole('button',{name:'Back to categorizing'}).count(),1);
   assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true,
    name+': no horizontal scrolling in the shared budget');
   assert.deepEqual(errors,[],name+': no browser errors while categorizing and viewing budget');
   await context.close();
  }
  console.log('PASS spouse completion Budget navigation and phone layouts in Chromium and WebKit');
 }finally{
  await desktop?.close();await iphone?.close();
  await new Promise(resolve=>server.close(resolve));
 }
})();
