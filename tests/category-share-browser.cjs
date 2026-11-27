'use strict';
// Fictional desktop + iPhone UI: final one-tap budget, no full Ledger sign-in.
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('./browser-harness.cjs');
const pageSource=fs.readFileSync(path.join(__dirname,'../pilot/category-share.html'),'utf8');
const fullSource=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
assert.match(fullSource,/id="lite-switch"[^>]*>Lite<\/a>/,'Full Ledger exposes Lite in the top bar');
assert.doesNotMatch(fullSource,/id="category-share-link"/,'No separate sharing menu option');
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
  const owner=req.headers.cookie?.includes('fictional-owner-session');
  if(url.pathname==='/api/ledger/category-share'&&owner)
   return json(200,{active:false,token:null});
  if(req.headers['x-ledger-share']!==token&&!owner)return json(401,{error:'Link unavailable'});
  if(url.pathname==='/api/share/categorize'&&req.method==='GET')
   return json(200,{revision:'f'.repeat(64),categories:['Groceries','Dining','Shopping'],
    items:[...(server.pending?[{kind:'transaction',id:'fixture-1',
     merchant:'Fictional purchase',date:'2026-11-17',amount:42.25,
     category:'Other',reason:'Missing category',
     note:server.note,editableNote:server.note,notes:[
      {label:'Saved note',text:server.note},
      {label:'Amazon product details',text:'Possible Amazon: Fictional lunch bag'}
     ],suggested:null}]:[]),...(server.addSecond?[{kind:'transaction',id:'fixture-2',
      merchant:'Fictional second purchase',date:'2026-11-18',amount:16.75,
      category:'Other',reason:'Missing category',notes:[],editableNote:'',suggested:null}]:[])]});
  if(url.pathname==='/api/share/categorize'&&req.method==='POST'){
   const chunks=[];req.on('data',x=>chunks.push(x));return req.on('end',()=>{
    const choice=JSON.parse(Buffer.concat(chunks).toString());
    server.writeCount++;
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
  if(url.pathname==='/api/share/budget/edit'&&req.method==='POST'){
   const chunks=[];req.on('data',x=>chunks.push(x));return req.on('end',()=>{
    const choice=JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(choice,{id:'fixture-1',lineIndex:null,category:'Dining',
     note:'Corrected purchase note'});
    server.budgetCategory=choice.category;server.budgetNote=choice.note;
    json(200,{saved:true});
   });
  }
  if(url.pathname==='/api/share/budget'&&req.method==='GET')
   return json(200,{month:'2026-11',asOf:'2026-11-24',budgetSet:true,
    spentCents:3025,pendingCents:0,expectedCents:1200,expectedIncluded:true,
    usedCents:4225,totalBudgetCents:10000,
    categories:['Groceries','Dining','Shopping'],
    rows:[{name:'Groceries',spentCents:server.budgetCategory==='Groceries'?3025:0,
     pendingCents:0,expectedCents:1200,
     usedCents:server.budgetCategory==='Groceries'?4225:1200,targetCents:10000,
     items:[...(server.budgetCategory==='Groceries'?[{
      id:'fixture-1',lineIndex:null,category:'Groceries',editableNote:server.budgetNote,
      date:'2026-11-17',merchant:'Fictional purchase',source:'posted',cents:3025}]:[]),
      {date:'2026-11-23',merchant:'Fictional planned charge',source:'expected',cents:1200}]},
     {name:'Dining',spentCents:server.budgetCategory==='Dining'?3025:0,
      pendingCents:0,expectedCents:0,usedCents:server.budgetCategory==='Dining'?3025:0,
      targetCents:null,items:server.budgetCategory==='Dining'?[{
       id:'fixture-1',lineIndex:null,category:'Dining',editableNote:server.budgetNote,
       date:'2026-11-17',merchant:'Fictional purchase',source:'posted',cents:3025}]:[]}]});
  json(404,{error:'Not found'});
 });
 server.pending=true;server.note='Household reminder';server.budgetCategory='Groceries';server.budgetNote='Household reminder';server.addSecond=false;server.writeCount=0;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/categorize#'+token;
 let desktop,iphone;
 try{
  for(const [name,driver,options] of [
   ['Desktop Chromium',chromium,{viewport:{width:1200,height:900}}],
   ['iPhone WebKit',webkit,{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]])
  {
   server.pending=true;server.note='Household reminder';server.budgetCategory='Groceries';server.budgetNote='Household reminder';server.addSecond=true;server.writeCount=0;
   const browser=await driver.launch({headless:true});
   if(name.startsWith('Desktop'))desktop=browser;else iphone=browser;
   const context=await browser.newContext(options),page=await context.newPage();
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url);
   await page.getByRole('heading',{name:'Categorize purchases'}).waitFor();
   assert.equal(await page.title(),'Ledger Lite · Categorize',name+': title uses product name');
   assert.equal(await page.locator('.brand').innerText(),'LEDGER LITE',name+': mobile brand uses product name');
   assert.equal(await page.getByText('Fictional purchase').count(),1);
   // Skip advances without writing a decision. Both Refresh controls restart at
   // the first still-uncategorized purchase, including previously passed items.
   await page.getByRole('button',{name:'Skip for now'}).click();
   await page.getByText('Fictional second purchase').waitFor();
   await page.getByRole('button',{name:'Skip for now'}).click();
   await page.getByRole('heading',{name:'That’s everything for now'}).waitFor();
   assert.equal(await page.locator('#again').textContent(),'Refresh');
   await page.locator('#again').click();
   await page.getByText('Fictional purchase',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Skip for now'}).click();
   await page.getByText('Fictional second purchase').waitFor();
   await page.locator('#reload').click();
   await page.getByText('Fictional purchase',{exact:true}).waitFor();
   assert.equal(server.writeCount,0,name+': Skip and Refresh never save categorization decisions');
   server.addSecond=false;
   await page.locator('#reload').click();
   // The previous purchase is already onscreen. Wait for the new GET to finish
   // before editing; otherwise a response can replace the note draft.
   await page.waitForFunction(()=>document.querySelector('#count')?.textContent==='1 uncategorized');
   await page.getByText('Fictional purchase',{exact:true}).waitFor();
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
   await page.reload();
   await page.getByRole('heading',{name:'All caught up'}).waitFor();
   const fullLink=page.getByRole('link',{name:'Open full Ledger',exact:true});
   const finishLink=page.locator('#open-ledger-after-review');
   assert.equal(await finishLink.getAttribute('href'),'/',name+': end of review retains Full link');
   assert.equal(await finishLink.isVisible(),true);
   assert.equal(await fullLink.getAttribute('href'),'/',name+': Full switch has no bearer');
   assert.equal(await fullLink.isVisible(),true);
   // The same open tab should pick up fresh work when a recipient returns.
   server.pending=true;
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
   await page.getByText('Fictional purchase').waitFor();
   await page.getByRole('button',{name:'Groceries',exact:true}).click();
   await page.getByRole('heading',{name:'All caught up'}).waitFor();
   await page.getByRole('button',{name:'See our budget'}).click();
   await page.getByRole('heading',{name:'Our budget'}).waitFor();
   assert.equal(await fullLink.isVisible(),true,name+': Full switch stays visible in Budget');
   const budgetLink=page.locator('#open-ledger-after-budget');
   assert.equal(await budgetLink.getAttribute('href'),'/',name+': Budget retains a Full link');
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
   assert.equal(await page.locator('.budget-edit-button').count(),1,
    name+': only posted purchase is editable; expected remains read-only');
   await page.getByRole('button',{name:'Edit Fictional purchase'}).click();
   await page.locator('.budget-edit-form select').selectOption('Dining');
   await page.locator('.budget-edit-form textarea').fill('Corrected purchase note');
   await page.locator('.budget-edit-form button.primary').click();
   await page.waitForFunction(()=>document.querySelector('#budget-error')?.textContent==='Saved');
   assert.equal(server.budgetCategory,'Dining');
   assert.equal(server.budgetNote,'Corrected purchase note');
   await page.locator('.budget-breakdown').last().locator('summary').click();
   assert.match(await page.locator('.budget-entries').last().textContent(),/Fictional purchase/);
   assert.equal(await page.getByRole('button',{name:'Back to categorizing'}).count(),1);
   assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true,
    name+': no horizontal scrolling in the shared budget');
   await fullLink.click();
   await page.getByRole('heading',{name:'Ledger sign-in required'}).waitFor();
   assert.equal(new URL(page.url()).pathname,'/login',
    name+': unauthenticated full app opens sign-in, not a private bank screen');
   assert.equal(new URL(page.url()).hash,'',
    name+': the share token must never be forwarded to full Ledger');
   assert.deepEqual(errors,[],name+': no browser errors while categorizing and viewing budget');
   await context.close();
   // Signed-in owner can use Lite directly, without creating a share link.
   server.pending=true;
   const ownerContext=await browser.newContext(options);
   await ownerContext.addCookies([{name:'fictional-owner-session',value:'1',
    domain:'127.0.0.1',path:'/'}]);
   const ownerPage=await ownerContext.newPage();
   await ownerPage.goto(url.split('#')[0]);
   await ownerPage.getByRole('heading',{name:'Categorize purchases'}).waitFor();
   assert.equal(await ownerPage.getByRole('link',{name:'Share'}).isVisible(),true,
    name+': owner can access old permanent sharing manager from Lite');
   await ownerContext.close();
  }
  console.log('PASS spouse completion Budget navigation and phone layouts in Chromium and WebKit');
 }finally{
  await desktop?.close();await iphone?.close();
  await new Promise(resolve=>server.close(resolve));
 }
})();
