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
  if(url.pathname==='/'){
   // The shared token is not a Ledger sign-in; the real server redirects
   // unauthenticated visitors to /login before serving private app assets.
   res.writeHead(303,{'Location':'/login','Cache-Control':'no-store'});
   return res.end();
  }
  if(url.pathname==='/login'){
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
   return res.end('<!doctype html><title>Ledger sign-in</title><h1>Ledger sign-in required</h1>');
  }
  if(req.headers['x-ledger-share']!==token)return json(401,{error:'Link unavailable'});
  if(url.pathname==='/api/share/categorize'&&req.method==='GET')
   return json(200,{revision:'f'.repeat(64),categories:['Groceries','Dining','Shopping'],
    items:server.pending?[{kind:'transaction',id:'fixture-1',
     merchant:'Fictional purchase',date:'2026-11-17',amount:42.25,
     category:'Other',reason:'Missing category',
     note:server.note,editableNote:server.note,notes:[
      {label:'Saved note',text:server.note},
      {label:'Amazon product details',text:'Possible Amazon: Fictional lunch bag'}
     ],suggested:null}]:[]});
  if(url.pathname==='/api/share/categorize'&&req.method==='POST'){
   const chunks=[];req.on('data',x=>chunks.push(x));return req.on('end',()=>{
    const choice=JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(choice.id,'fixture-1');
    if(Object.hasOwn(choice,'note')){
     assert.equal(choice.note,'Reviewed together');
     server.note=choice.note;
     return json(200,{saved:true});
    }
    assert.equal(choice.category,'Groceries');
    server.pending=false;json(200,{saved:true});
   });
  }
  if(url.pathname==='/api/share/budget'&&req.method==='GET')
   return json(200,{month:'2026-11',asOf:'2026-11-24',budgetSet:true,
    spentCents:3025,pendingCents:0,expectedCents:1200,expectedIncluded:true,
    usedCents:4225,totalBudgetCents:10000,
    rows:[{name:'Groceries',spentCents:3025,pendingCents:0,
     expectedCents:1200,usedCents:4225,targetCents:10000,
     items:[{date:'2026-11-17',merchant:'Fictional purchase',source:'posted',cents:3025},
      {date:'2026-11-23',merchant:'Fictional planned charge',source:'expected',cents:1200}]}]});
  json(404,{error:'Not found'});
 });
 server.pending=true;server.note='Household reminder';
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/categorize#'+token;
 let desktop,iphone;
 try{
  for(const [name,driver,options] of [
   ['Desktop Chromium',chromium,{viewport:{width:1200,height:900}}],
   ['iPhone WebKit',webkit,{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]])
  {
   server.pending=true;server.note='Household reminder';
   const browser=await driver.launch({headless:true});
   if(name.startsWith('Desktop'))desktop=browser;else iphone=browser;
   const context=await browser.newContext(options),page=await context.newPage();
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url);
   await page.getByRole('heading',{name:'Categorize purchases'}).waitFor();
   assert.equal(await page.title(),'Ledger Simple · Categorize',name+': title uses product name');
   assert.equal(await page.locator('.brand').innerText(),'LEDGER SIMPLE',name+': mobile brand uses product name');
   assert.equal(await page.getByText('Fictional purchase').count(),1);
   assert.equal(await page.locator('#shared-note').inputValue(),'Household reminder');
   await page.locator('#shared-note').fill('Reviewed together');
   await page.getByRole('button',{name:'Save note'}).click();
   await page.waitForFunction(()=>document.querySelector('#note-feedback')?.textContent==='Note saved');
   assert.equal(server.note,'Reviewed together','Editable note must persist before choosing a category');
   assert.equal(await page.getByText('Possible Amazon: Fictional lunch bag').count(),1);
   assert.equal(await page.getByText('Amazon product details').count(),1);
   assert.equal(await page.getByText('Possible Amazon item match. Check the item before using it to decide.').count(),1);
   await page.getByRole('button',{name:'Groceries',exact:true}).click();
   await page.getByRole('heading',{name:'All caught up'}).waitFor();
   const finishLink=page.locator('#open-ledger-after-review');
   assert.equal(await finishLink.getAttribute('href'),'/',
    name+': completion points to the full Ledger app, not the share URL');
   assert.equal(await finishLink.isVisible(),true);
   // The same open tab should pick up fresh work when a recipient returns.
   server.pending=true;
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
   await page.getByText('Fictional purchase').waitFor();
   await page.getByRole('button',{name:'Groceries',exact:true}).click();
   await page.getByRole('heading',{name:'All caught up'}).waitFor();
   await page.getByRole('button',{name:'See our budget'}).click();
   await page.getByRole('heading',{name:'Our budget'}).waitFor();
   const budgetLink=page.locator('#open-ledger-after-budget');
   assert.equal(await budgetLink.getAttribute('href'),'/',
    name+': shared Budget links to full Ledger without a share token');
   assert.equal(await budgetLink.isVisible(),true);
   await page.waitForFunction(()=>document.querySelector('#budget-total')?.textContent?.includes('$57.75'));
   assert.match(await page.locator('#budget-total').textContent(),/\$57\.75/);
   assert.match(await page.locator('#budget-rows').textContent(),/Groceries/);
   const breakdown=page.locator('.budget-breakdown');
   assert.equal(await breakdown.count(),1);
   assert.equal(await page.locator('.budget-entry:visible').count(),0,
    name+': detailed transactions are collapsed by default');
   await breakdown.locator('summary').click();
   assert.equal(await page.locator('.budget-entry:visible').count(),2,
    name+': category expands to source transactions');
   assert.match(await page.locator('.budget-entries').textContent(),/Fictional planned charge/);
   assert.match(await page.locator('.budget-entries').textContent(),/Expected/);
   assert.equal(await page.getByRole('button',{name:'Back to categorizing'}).count(),1);
   assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true,
    name+': no horizontal scrolling in the shared budget');
   await budgetLink.click();
   await page.getByRole('heading',{name:'Ledger sign-in required'}).waitFor();
   assert.equal(new URL(page.url()).pathname,'/login',
    name+': unauthenticated full app opens sign-in, not a private bank screen');
   assert.equal(new URL(page.url()).hash,'',
    name+': the share token must never be forwarded to full Ledger');
   assert.deepEqual(errors,[],name+': no browser errors while categorizing and viewing budget');
   await context.close();
  }
  console.log('PASS spouse completion Budget navigation and phone layouts in Chromium and WebKit');
 }finally{
  await desktop?.close();await iphone?.close();
  await new Promise(resolve=>server.close(resolve));
 }
})();
