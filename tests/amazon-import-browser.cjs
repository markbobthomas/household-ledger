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
   let tinyfishConnected=false,tinyfishEnabled=false,tinyfishBlocked=false,
    manualSaved=false,tinyfishRunLimited=false;
   const tinyfishRequests=[],manualRequests=[];
   const cloudSnapshot=()=>({
    connected:tinyfishConnected,enabled:tinyfishEnabled&&!tinyfishBlocked,
    pendingAmazonCharges:2,
    lastOutcome:tinyfishBlocked?'Paused: TinyFish declined the request; no paid run started':'Not yet checked',
    runActive:false,needsAttention:tinyfishBlocked,
    pausedReason:tinyfishBlocked?'invalid-report':null,
    manualReviewAvailable:tinyfishBlocked&&!manualSaved,
    replayAvailable:tinyfishBlocked&&!manualSaved,
    replayRunId:tinyfishBlocked?'12345678-1234-1234-1234-123456789012':null,
    unnotedAmazonCharges:tinyfishBlocked&&!manualSaved?1:0,
    runLimitReason:tinyfishRunLimited?'One Amazon browser check already started today':null,
    initialSetupReady:tinyfishEnabled,
    lastError:tinyfishBlocked?
     'TinyFish rejected the Amazon request (400). Review the paused status before restarting.':null,
    maxCostUsd:2.42
   });
   await page.route('**/api/amazon-cloud',async route=>{
    await route.fulfill({status:200,contentType:'application/json',
     body:JSON.stringify(cloudSnapshot())});
   });
   await page.route('**/api/amazon-cloud/review',async route=>{
    assert.equal(route.request().method(),'GET');
    await route.fulfill({status:200,contentType:'application/json',
     body:JSON.stringify({revision:'fictional-review-revision',
      runId:'12345678-1234-1234-1234-123456789012',
      charges:[{transactionKey:'bank:fictional-owner-only',postedDate:'2026-11-26',
       amountCents:3749,candidates:[{orderId:'123-1234567-1234567',
        orderDate:'2026-11-24',shipmentDate:'2026-11-24',orderTotalCents:null,
        itemPricesVerified:false,titles:['Fictional kitchen filter'],extraItems:0}]}]})});
   });
   await page.route('**/api/amazon-cloud/review/confirm',async route=>{
    const choice=route.request().postDataJSON();
    manualRequests.push(choice);
    assert.deepEqual(choice,{consent:true,
     runId:'12345678-1234-1234-1234-123456789012',
     transactionKey:'bank:fictional-owner-only',orderId:'123-1234567-1234567',
     revision:'fictional-review-revision'},
     'Owner confirms order identity only, never a price, category or bank mutation');
    manualSaved=true;
    await route.fulfill({status:200,contentType:'application/json',
     body:JSON.stringify({saved:true,pendingAmazonCharges:0})});
   });
   await page.route('**/api/amazon-cloud/reprocess',async route=>{
    const args=route.request().postDataJSON();
    assert.deepEqual(args,{consent:true,runId:'12345678-1234-1234-1234-123456789012'},
     'Recovery only reads an already completed run, with owner consent');
    tinyfishRequests.push({action:'reprocess'});
    await route.fulfill({status:202,contentType:'application/json',
     body:JSON.stringify({...cloudSnapshot(),reprocessing:true})});
   });
   await page.route('**/api/amazon-cloud/settings',async route=>{
    const action=route.request().postDataJSON();
    tinyfishRequests.push(action);
    if(action.action==='connect'){
     assert.equal(action.apiKey,'fictional-tinyfish-key-not-a-real-secret',
      'Only the typed key is sent to the private authenticated connection endpoint');
     tinyfishConnected=true;tinyfishEnabled=false;
    }else if(action.action==='enable'){
     assert.equal(tinyfishConnected,true);
     tinyfishEnabled=true;
    }else throw Error('Unexpected setup control mutation: '+action.action);
    await route.fulfill({status:200,contentType:'application/json',
     body:JSON.stringify(cloudSnapshot())});
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
    assert.equal(await page.locator('#cloud-setup-steps').getAttribute('open'),'',
     'Detailed instructions start expanded for first-time users');
    assert.equal(await page.locator('#cloud-setup-steps .cloud-steps > li').count(),9,
     'All nine actions are visible and numbered');
    assert.equal(await page.locator('a[href="https://agent.tinyfish.ai/api-keys"]').count(),1,
     'Direct verified TinyFish API Keys link must be included');
    assert.equal(await page.locator('a[href="https://agent.tinyfish.ai/profiles"]').count(),1,
     'Direct verified TinyFish saved-profiles link bypasses the Agent prompt');
    assert.equal(await page.locator('a[href="https://docs.tinyfish.ai/agent/how-to/create-google-form-with-profile"]').count(),1,
     'Offer official illustrated profile setup for users who cannot find it');
    const setupText=await page.locator('#cloud-setup-steps').innerText();
    for(const phrase of ['What do you want your agent to do?','Agent Playground',
     'do not type an Amazon task','Create profile','Next','Open a browser and sign in',
     'www.amazon.com/your-orders','Save','Default','Create API Key','Copy',
     'Paste TinyFish API key here','Connect TinyFish','Turn on automatic updates']){
     assert(setupText.includes(phrase),name+' is missing a critical actual TinyFish UI instruction: '+phrase);
    }
    await page.locator('#cloud-profile-help summary').click();
    assert.match(await page.locator('#cloud-profile-help').innerText(),/stop setup here/,
     'When saved profiles are unavailable, forbid a charged Agent prompt workaround');
    assert.equal(await page.locator('#cloud-profile-help a[href="#manual-amazon-import"]').count(),1,
     'Offer functional fallback inside saved-profile troubleshooting');
    assert.equal(await page.locator('#manual-amazon-import').isVisible(),true);
    await page.locator('#cloud-profile-help summary').click();
    assert.match(await page.locator('#cloud-status').innerText(),/Not connected/);
    await page.locator('#cloud-api-key').fill('fictional-tinyfish-key-not-a-real-secret');
    await page.locator('#cloud-connect').click();
    await page.waitForFunction(()=>document.querySelector('#cloud-status').textContent.includes('TinyFish connected'));
    assert.equal(await page.locator('#cloud-actions').isVisible(),true,
     'Enable button becomes visible after connection');
    assert.equal(await page.locator('#cloud-setup-steps').getAttribute('open'),null,
     'Instructions collapse after success but remain re-openable');
    await page.locator('#cloud-setup-steps > summary').click();
    assert.equal(await page.locator('#cloud-setup-steps').getAttribute('open'),'',
     'Connected owner can reopen full instructions when a login expires');
    await page.waitForFunction(()=>!document.getElementById('cloud-toggle').disabled);
    assert.equal(await page.locator('#cloud-toggle').isEnabled(),true,
     'After a successful connection, Turn on automatic updates must be usable');
    assert.equal(await page.locator('#cloud-now').isEnabled(),true,
     'Check now stays clickable even when automatic updates are OFF');
    await page.locator('#cloud-now').click();
    assert.match(await page.locator('#cloud-status').innerText(),
     /Turn on automatic updates once/,
     'A connected account without its safe starting point explains the precondition, not a paid launch');
    assert.equal(tinyfishRequests.length,1,'Check now did not launch TinyFish while setup was incomplete');
    await page.locator('#cloud-toggle').click();
    await page.waitForFunction(()=>document.querySelector('#cloud-status').textContent.includes('Automatic updates ON'));
    assert.deepEqual(tinyfishRequests,[{
     action:'connect',apiKey:'fictional-tinyfish-key-not-a-real-secret'
    },{action:'enable'}],'Nine-step setup must save key and enable only after the explicit click');
    assert.equal(await page.locator('#cloud-api-key').inputValue(),'',
     'Connection code is cleared from the browser field after success');
    assert.equal(await page.evaluate(()=>Boolean(document.querySelector('#amazon-cloud').compareDocumentPosition(document.querySelector('#file')) & Node.DOCUMENT_POSITION_FOLLOWING)),true,
      'TinyFish setup should appear before the manual file-import fallback');

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
     // A paused rejection is visible, but the obsolete beta flow is absent.
     tinyfishBlocked=true;
     await page.reload();
     await page.waitForFunction(()=>document.getElementById('cloud-status')
      .textContent.includes('PAUSED'));
     assert.equal(await page.locator('#cloud-beta-help').count(),0,
      'Standard Agent no longer depends on the beta step-limit warning');
     await page.locator('#cloud-explanation summary').click();
     assert.match(await page.locator('#cloud-explanation').innerText(),/150 Agent steps/);
     assert.match(await page.locator('#cloud-explanation').innerText(),/\$2\.42/);
     assert.match(await page.locator('#cloud-explanation').innerText(),/\$31\.46/);
     assert.match(await page.locator('#cloud-detail').innerText(),/TinyFish rejected/);
     assert.equal(await page.locator('#cloud-now').isEnabled(),true,
      'Check now remains clickable during a paused provider result and does not silently launch paid work');
     assert.equal(tinyfishRequests.length,2,
      'Showing paused status must not launch extra provider work');
     assert.equal(await page.locator('#cloud-replay-help').isVisible(),true,
      'A failed run offers a clearly labeled no-charge recovery path');
     await page.locator('#cloud-replay-help summary').click();
     assert.equal(await page.locator('#cloud-replay-id').inputValue(),
      '12345678-1234-1234-1234-123456789012');
     assert.match(await page.locator('#cloud-now').innerText(),/saved result/,
      'Main Check now prioritizes no-charge provider replay');
     const freeResponse=page.waitForResponse(response=>
      response.url().endsWith('/api/amazon-cloud/reprocess')&&response.status()===202);
     await page.locator('#cloud-now').click();
     await freeResponse;
     assert.equal(tinyfishRequests.length,3,
      'Check now used only saved results despite pause, not a new paid Agent');
     const replayResponse=page.waitForResponse(response=>
      response.url().endsWith('/api/amazon-cloud/reprocess')&&response.status()===202);
     await page.locator('#cloud-replay').click();
     await replayResponse;
     assert.equal(tinyfishRequests.length,4,
      'Both free-replay controls only read the existing provider result instead of launching an Agent');
     assert.equal(await page.locator('#cloud-manual-review').isVisible(),true,
      'Paused unmatched charges offer owner-only review without another Agent');
     await page.locator('#cloud-manual-review summary').click();
     await page.locator('#cloud-manual-load').click();
     await page.locator('.cloud-manual-confirm').waitFor();
     assert.match(await page.locator('#cloud-manual-list').innerText(),/Fictional kitchen filter/);
     assert.match(await page.locator('#cloud-manual-list').innerText(),/Order total not available/);
     page.once('dialog',dialog=>dialog.accept());
     await page.locator('.cloud-manual-confirm').click();
     await page.waitForFunction(()=>document.getElementById('cloud-manual-message')
      .textContent.includes('Saved'));
     assert.equal(manualRequests.length,1,'One explicit purchase confirmation is saved');
     assert.equal(tinyfishRequests.length,4,'Manual review cannot start a new paid browser Agent');
     tinyfishBlocked=false;tinyfishRunLimited=true;
     await page.reload();
     await page.waitForFunction(()=>document.querySelector('#cloud-now')&&
      !document.querySelector('#cloud-now').disabled);
     assert.equal(await page.locator('#cloud-now').isEnabled(),true,
      'The daily TinyFish cost cap does not grey out Check now');
     await page.locator('#cloud-now').click();
     assert.match(await page.locator('#cloud-status').innerText(),
      /one-per-day and 30-day safeguards cannot be bypassed/i,
      'A rate-limited Check now explains the block and starts no paid Agent');
     assert.equal(tinyfishRequests.length,4,
      'A connected but rate-limited request cannot start a second paid Agent');
     const mobile=await page.evaluate(()=>({
      width:document.documentElement.clientWidth,
      scroll:document.documentElement.scrollWidth}));
     assert(mobile.scroll<=mobile.width+2,'Manual Amazon review must fit on desktop and mobile');
    assert.deepEqual(errors,[],name+' has no runtime script errors');
   }finally{await ctx.close();await browser.close()}
  }
  console.log('Amazon streamlined import, consented AI, one-tap review and mobile layout PASS');
 }finally{server.kill()}
})();
