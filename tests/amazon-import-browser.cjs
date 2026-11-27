'use strict';
// Synthetic desktop/iPhone acceptance test for the single Amazon owner workflow.
// No household, bank, Amazon, or OpenAI credentials are used.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {spawn}=require('node:child_process'),{chromium,webkit}=require('./browser-harness.cjs');
module.exports=(async()=>{
 const port=19103,url='http://127.0.0.1:'+port+'/pilot/amazon-import.html';
 const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{
  cwd:path.resolve(__dirname,'..'),stdio:'ignore'
 });
 const csv='Order ID,Order Date,Product Name,Item Total,Total Charged\n'+
  '"113-1234567-7654321","2026-11-22","Laundry detergent, 50 oz","29.50","29.50"';
 const html=fs.readFileSync(path.resolve(__dirname,'../pilot/amazon-import.html'),'utf8');
 assert.equal((html.match(/<\/html>/g)||[]).length,1,'No trailing duplicate HTML or scripts');
 assert(!html.includes('Check saved item Notes'),'Retired review action removed from primary page');
 assert(!html.includes('Save previewed changes'),'Retired second-upload path removed from page');
 async function ready(){
  for(let i=0;i<100;i++){
   try{if((await fetch(url)).ok)return}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  throw Error('Amazon browser fixture server did not start');
 }
 try{
  await ready();
  for(const [engine,name,width] of [[chromium,'desktop Chromium',1280],[webkit,'iPhone WebKit',390]]){
   const browser=await engine.launch({headless:true});
   const ctx=await browser.newContext({viewport:{width,height:800}});
   const page=await ctx.newPage(),errors=[],uploads=[],notes=[],aiRequests=[],writes=[];
   page.on('pageerror',e=>errors.push(e.message));
   // Streaming File bodies are not exposed reliably by Playwright's
   // postDataBuffer() in WebKit. Verify the original File before dispatch.
   await page.addInitScript(()=>{
    const original=window.fetch.bind(window);
    window.__amazonFileUploads=[];
    window.fetch=async (url,options)=>{
     if(String(url).includes('/api/ledger/amazon-import')&&
        options?.body instanceof Blob){
      window.__amazonFileUploads.push({
       name:options.body.name,text:await options.body.text()});
     }
     return original(url,options);
    };
   });
   let remaining=[
    {id:'fictional-exact',date:'2026-11-24',amountCents:2950,
     merchant:'AMAZON',note:'Amazon: Laundry detergent, 50 oz',
     match:'exact',currentCategory:'Uncategorized',
     suggestedCategory:'Home & Maintenance',requiresVerification:false},
    {id:'fictional-possible',date:'2026-11-23',amountCents:1900,
     merchant:'AMZN',note:'Possible Amazon: Pet grooming brush',
     match:'possible',currentCategory:'Uncategorized',
     suggestedCategory:null,requiresVerification:true}
   ];
   await page.route('**/api/ledger/amazon-review',async route=>{
    await route.fulfill({status:200,contentType:'application/json',
     headers:{'x-ledger-revision':'fictional-revision'},
     body:JSON.stringify({items:remaining,categories:['Home & Maintenance','Pets','Shopping','Other'],
      stats:{amazonCharges:2,confirmed:1,possible:1,unmatched:0,notes:2,
        exactEvidence:1,possibleEvidence:1,legacyItemNotes:0,
        unidentifiedCharges:0,specificCategoryCharges:1,
        splitCharges:1,splitItemLines:2,unclassifiedItemLines:1,
        manuallyReviewedCharges:1,aiReviewedCharges:0,staleEvidence:0,
        review:remaining.length}})});
   });
   await page.route('**/api/ledger/amazon-review-choice',async route=>{
    const d=route.request().postDataJSON();writes.push(d);
    assert.equal(route.request().headers()['x-ledger-revision'],'fictional-revision');
    assert(!('amount' in d),'Manual category write contains no bank amounts');
    assert(!('note' in d),'Manual category write does not overwrite product Notes');
    remaining=remaining.filter(t=>t.id!==d.transactionId);
    await route.fulfill({status:200,contentType:'application/json',
     headers:{'x-ledger-revision':'fictional-revision'},body:JSON.stringify({saved:true})});
   });
   await page.route('**/api/ledger/amazon-import',async route=>{
    const req=route.request();
    const binary=req.headers()['content-type']==='application/octet-stream';
    if(binary){
     uploads.push({filename:decodeURIComponent(req.headers()['x-amazon-filename']),
      dryRun:req.headers()['x-amazon-dry-run']});
     await route.fulfill({status:200,contentType:'application/json',
      headers:{'x-ledger-revision':'fictional-revision'},
      body:JSON.stringify({ready:1,applied:1,notesReady:1,
       evidenceSaved:1,confidentCategories:1,savedNoteStats:{itemNotes:2}})});
    }else{
     const d=req.postDataJSON();notes.push(d);
     assert.deepEqual(d,{mode:'saved-notes',dryRun:true,replaceOther:false});
     await route.fulfill({status:200,contentType:'application/json',
      headers:{'x-ledger-revision':'fictional-revision'},
      body:JSON.stringify({ready:0,savedNoteStats:{itemNotes:2}})});
    }
   });
   await page.route('**/api/ledger/amazon-ai',async route=>{
    const d=route.request().postDataJSON();aiRequests.push(d);
    assert.deepEqual(d,{action:'preview',consent:true,replaceOther:false});
    await route.fulfill({status:200,contentType:'application/json',
     body:JSON.stringify({proposed:1,costUsd:.0007,costCeilingUsd:.05,
      examples:[{transactionId:'fictional-possible',note:'Possible Amazon: Pet grooming brush',
       category:'Pets',possibleMatch:true}]})});
   });
   try{
    await page.goto(url);
    await page.locator('#review-card #accept').waitFor();
    assert.match(await page.locator('#review-count').innerText(),/2 remaining/);
    assert.equal(await page.locator('#results').isHidden(),true,'No diagnostics before import');
    assert.equal(await page.locator('#browser-sync-setup').count(),0,
     'Desktop setup was replaced rather than duplicated');
    assert.equal(await page.locator('#amazon-cloud').isVisible(),true,
     'Cloud setup is available on desktop and iPhone');
    assert.match(await page.locator('#amazon-cloud').innerText(),/Monday, Thursday and Saturday/);
    assert.match(await page.locator('#amazon-cloud').innerText(),/No new Amazon charges/);
    assert.equal(await page.locator('#cloud-api-key').getAttribute('type'),'password');
    assert.equal(await page.locator('#cloud-setup-steps').isVisible(),true);

    assert.equal(await page.locator('#quick-categories .quick').count()>0,true,
      'Common spending categories are available as one-tap choices');
    await page.locator('#accept').click();
    await page.waitForFunction(()=>document.getElementById('review-count').textContent.includes('1 remaining'));
    assert.deepEqual(writes[0],{transactionId:'fictional-exact',category:'Home & Maintenance',
     lineIndex:null,verified:true});
    await page.locator('#ai-check').click();
    await page.waitForFunction(()=>document.getElementById('ai-status').textContent.includes('1 proposed'));
    assert.match(await page.locator('#ai-status').innerText(),/\$0\.0007/);
    await page.locator('#accept').click();
    await page.waitForFunction(()=>document.getElementById('review-message').textContent.includes('Verify the possible'));
    assert.equal(writes.length,1,'Possible product cannot be accepted without verification');
    await page.locator('#verified').check();
    await page.locator('#accept').click();
    await page.waitForFunction(()=>!document.getElementById('finish').hidden);
    assert.deepEqual(writes[1],{transactionId:'fictional-possible',category:'Pets',
     lineIndex:null,verified:true});
    assert.match(await page.locator('#finished-message').innerText(),/up to date/);
    await page.locator('#file').setInputFiles({name:'Amazon-orders.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await page.locator('#ai-consent').check();
    await page.locator('#import').click();
    await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Import saved and verified'));
    await page.waitForFunction(()=>document.getElementById('ai-status').textContent.includes('1 proposed'));
    assert.equal(uploads.length,1,'One import action sends file exactly once');
    const captured=await page.evaluate(()=>window.__amazonFileUploads);
    assert.deepEqual(captured,[{name:'Amazon-orders.csv',text:csv}],
     'The exact original CSV bytes are sent once without base64 encoding');
    assert.equal(uploads[0].filename,'Amazon-orders.csv');
    assert.equal(uploads[0].dryRun,'0');
    assert.deepEqual(notes,[{mode:'saved-notes',dryRun:true,replaceOther:false}]);
    assert.equal(aiRequests.length,2,'AI is opt-in at import and when directly requested');
    assert.equal(await page.locator('#results').isHidden(),false);
    assert.match(await page.locator('#stats').innerText(),/Notes added/);
    assert.match(await page.locator('#stats').innerText(),/Categories assigned/);
    assert.match(await page.locator('#stats').innerText(),/Need review/);
    assert.match(await page.locator('#stats').innerText(),/Unmatched/);
    assert.match(await page.locator('#import-summary').innerText(),/Product information saved privately/);
    await page.locator('#advanced summary').click();
    const quality=await page.locator('#quality-summary').innerText();
    assert.match(quality,/1 exact product-evidence matches/);
    assert.match(quality,/1 unverified possible matches/);
    assert.match(quality,/1 of 2 charges have saved specific categories/);
    assert.match(quality,/including 1 unresolved product categories/);
    assert.equal(await page.locator('#quality-summary').evaluate(el=>
     el.textContent.includes('fictional-exact')),false,
     'Aggregate diagnostics never expose a bank transaction ID');
    const dimensions=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,
     width:document.documentElement.clientWidth}));
    assert(dimensions.scrollWidth<=dimensions.width+2,name+' mobile layout must fit');
    assert.deepEqual(errors,[],name+' has no runtime script errors');
   }finally{await ctx.close();await browser.close()}
  }
  console.log('Amazon streamlined import, consented AI, one-tap review and mobile layout PASS');
 }finally{server.kill()}
})();
