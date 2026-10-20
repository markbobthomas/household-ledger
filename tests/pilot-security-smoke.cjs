'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-pilot-'));
const port=19845,pass='test-'+crypto.randomBytes(24).toString('hex');
const env={...process.env,PORT:String(port),PILOT_PASSWORD:pass,PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'test-placeholder',PLAID_SECRET:'test-placeholder',PLAID_ENV:'sandbox',PILOT_STATE_PATH:path.join(dir,'pilot.enc')};
function get(route,auth){return new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port,path:route,headers:auth?{Authorization:'Basic '+Buffer.from('pilot:'+pass).toString('base64')}:{}},r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>resolve({status:r.statusCode,body}))}).on('error',reject)})}
(async()=>{
 const child=spawn(process.execPath,['pilot/server.cjs'],{cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});
 try{
  for(let i=0;i<100;i++){try{let h=await get('/healthz',false);if(h.status===200)break}catch{}await new Promise(r=>setTimeout(r,50))}
  assert.equal((await get('/healthz',false)).status,200);
  assert.equal((await get('/api/status',false)).status,401,'Bank metadata must not be accessible anonymously');
  assert.equal((await get('/',false)).status,401,'Pilot UI requires authentication');
  assert.equal((await get('/api/status',true)).status,200);
  assert.equal(JSON.parse((await get('/api/status',true)).body).connected,false);
  const ledger=await get('/',true);assert.equal(ledger.status,200);assert.match(ledger.body,/Household Ledger/,'Existing Ledger is served in live mode');
  for(const route of ['/?utm_source=chatgpt.com','/?utm_source=chatgpt.com&ref=planner','/index.html?ref=planner']){
   const result=await get(route,true);
   assert.equal(result.status,200,'Homepage navigation must ignore harmless query parameters: '+route);
   assert.match(result.body,/planner-core[.]js/,'Embedded private planner uses the same unified ledger and accuracy engine');
  }
  const broken=await get('/not-a-route?utm_source=chatgpt.com',true);
  assert.equal(broken.status,404,'Unknown browser links return Not found, not an API action-header error');
  assert.equal((await get('/api/ledger?source=browser',false)).status,401,'Query parameters do not bypass authentication');
  const link=await get('/bank-connect',true);assert.equal(link.status,200);assert.match(link.body,/Connect accounts/,'Plaid authorization available on same website');
  assert.equal((await get('/pilot/data-source.js',true)).status,200);
  assert.equal((await get('/planner-transactions.js',true)).status,200,'Protected server serves forecast-only editing module');
  const denied=await new Promise((resolve,reject)=>{
   const req=http.request({hostname:'127.0.0.1',port,path:'/api/ledger/adjustments?ref=planner',
    method:'POST',headers:{Authorization:'Basic '+Buffer.from('pilot:'+pass).toString('base64'),
     'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});
   req.on('error',reject);req.end('{}');
  });
  assert.equal(denied,403,'Protected bank actions still require the explicit action header');
  assert.ok(!(await get('/api/status',true)).body.includes('test-placeholder'),'Secrets absent from responses');
  // A stale browser/deploy can request a previously allowlisted static asset.
  // Missing files must not terminate the private bank server process.
  const partial=path.join(dir,'partial-deploy');
  fs.mkdirSync(path.join(partial,'pilot'),{recursive:true});
  fs.copyFileSync(path.join(__dirname,'../pilot/server.cjs'),path.join(partial,'pilot/server.cjs'));
  fs.writeFileSync(path.join(partial,'index.html'),'<html><head></head><body>partial deployment</body></html>');
  const altPort=port+1;
  const partialChild=spawn(process.execPath,['pilot/server.cjs'],{
   cwd:partial,env:{...env,PORT:String(altPort),PILOT_STATE_PATH:path.join(dir,'partial.enc')},stdio:'ignore'
  });
  const alternate=route=>new Promise((resolve,reject)=>{
   http.get({hostname:'127.0.0.1',port:altPort,path:route,
    headers:{Authorization:'Basic '+Buffer.from('pilot:'+pass).toString('base64')}},res=>{
    res.resume();res.on('end',()=>resolve(res.statusCode));
   }).on('error',reject);
  });
  try{
   for(let i=0;i<100;i++){try{if(await alternate('/healthz')===200)break}catch{}
    await new Promise(r=>setTimeout(r,50))}
   assert.equal(await alternate('/healthz'),200);
   assert.equal(await alternate('/planner.js'),404,'Absent asset should give 404, not kill server');
   assert.equal(await alternate('/healthz'),200,'Server remains healthy after asset error');
   assert.equal(await alternate('/'),200,'Homepage still serves after asset error');
  }finally{partialChild.kill()}
  console.log('PASS pilot auth, health, missing-asset crash protection and no leaked credentials');
 }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
