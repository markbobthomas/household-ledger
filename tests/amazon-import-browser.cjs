'use strict';
// Synthetic end-to-end test of browser-extracted CSV entering the real import UI.
// No Amazon session, real bank accounts or private Ledger credentials are needed.
const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium,webkit}=require('./browser-harness.cjs');
module.exports=(async()=>{
 const port=19103,url='http://127.0.0.1:'+port+'/pilot/amazon-import.html';
 const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{
  cwd:path.resolve(__dirname,'..'),stdio:'ignore'
 });
 const csv='Order ID,Order Date,Product Name,Item Total,Total Charged\r\n'+
  '"113-1234567-7654321","2026-11-22","Laundry detergent, 50 oz","29.50","29.50"';
 async function ready(){
  for(let i=0;i<80;i++){
   try{if((await fetch(url)).ok)return}catch(_){}
   await new Promise(r=>setTimeout(r,100));
  }
  throw Error('Amazon import fixture server could not start');
 }
 try{
  await ready();
  for(const [engine,name,width] of [[chromium,'desktop Chromium',1280],[webkit,'iPhone WebKit',390]]){
   const browser=await engine.launch({headless:true});
   const context=await browser.newContext({viewport:{width,height:800}});
   const page=await context.newPage(),requests=[],errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   // Playwright cannot inspect a Blob streaming upload through postDataBuffer()
   // in all browsers. Verify exact transmitted File contents at the fetch
   // boundary inside each tested Chromium/WebKit page instead.
   await page.addInitScript(()=>{
    const original=window.fetch.bind(window);
    window.__amazonUploads=[];
    window.fetch=async(input,options={})=>{
     if(String(input).includes('/api/ledger/amazon-import')){
      window.__amazonUploads.push({
       name:options.body?.name,bytes:await options.body?.text(),
       contentType:options.headers?.['Content-Type'],
       dryRun:options.headers?.['X-Amazon-Dry-Run']
      });
     }
     return original(input,options);
    };
   });
   await page.route('**/api/ledger/amazon-import',async route=>{
    const request=route.request(),headers=request.headers();
    assert.equal(headers['content-type'],'application/octet-stream');
    assert.equal(decodeURIComponent(headers['x-amazon-filename']),'Amazon-browser-sync.csv');
    const captured=request.postDataBuffer();
    if(captured!==null)assert.equal(captured.toString('utf8'),csv);
    const d={fileName:'Amazon-browser-sync.csv',dryRun:headers['x-amazon-dry-run']==='1'};
    requests.push(d);
    if(requests.length===2)assert.equal(headers['x-ledger-revision'],'fictional-revision');
    await route.fulfill({status:200,contentType:'application/json',
     headers:{'x-ledger-revision':'fictional-revision'},
     body:JSON.stringify({importedItems:1,matches:1,ready:d.dryRun?1:0,applied:d.dryRun?0:1,
      needsReview:0,ambiguousOrders:0,unmatchedOrders:0,alreadyImported:0,
      examples:[{date:'2026-11-24',amountCents:2950,orderId:'113-1234567-7654321',
       categories:['Home & Maintenance'],needsReview:false}]})});
   });
   await page.goto(url);
   assert.equal(await page.locator('#apply').isDisabled(),true,'No category write before preview');
   // Same DOM File/DataTransfer handoff as the MV3 Ledger-tab injection.
   await page.evaluate(csvText=>{
    const transfer=new DataTransfer();
    transfer.items.add(new File([csvText],'Amazon-browser-sync.csv',{type:'text/csv'}));
    const file=document.getElementById('file');
    file.files=transfer.files;
    file.dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('check').click();
   },csv);
   await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Matches checked'));
   assert.equal(requests.length,1,name+' previews exactly once');
   assert.equal(requests[0].dryRun,true,name+' does not save automatically');
   assert.equal(await page.locator('#apply').isDisabled(),false,name+' can approve reviewed match');
   await page.locator('#apply').click();
   await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Saved 1'));
   assert.equal(requests.length,2,name+' explicitly applies exactly once');
   assert.equal(requests[1].dryRun,false);
   const uploads=await page.evaluate(()=>window.__amazonUploads);
   assert.equal(uploads.length,2,name+' sends the exact file twice only after user approval');
   for(const upload of uploads){
    assert.equal(upload.name,'Amazon-browser-sync.csv');
    assert.equal(upload.bytes,csv,name+' sends original CSV bytes, not base64');
    assert.equal(upload.contentType,'application/octet-stream');
   }
   assert.deepEqual(uploads.map(u=>u.dryRun),['1','0']);
   assert.deepEqual(errors,[],name+' has no JavaScript errors');
   await context.close();
  }
 }finally{server.kill('SIGTERM')}
 console.log('Amazon browser handoff + explicit approval PASS (Chromium, iPhone WebKit)');
})();
