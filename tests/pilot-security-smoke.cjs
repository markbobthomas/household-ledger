'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-pilot-'));
const port=19845,pass='test-'+crypto.randomBytes(24).toString('hex');
const env={...process.env,PORT:String(port),PILOT_PASSWORD:pass,PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'test-placeholder',PLAID_SECRET:'test-placeholder',PLAID_ENV:'sandbox',PILOT_STATE_PATH:path.join(dir,'pilot.enc'),RENDER_GIT_COMMIT:'a'.repeat(40)};
function get(route,auth,cookie=''){return new Promise((resolve,reject)=>{
 const headers={...(auth?{Authorization:'Basic '+Buffer.from('pilot:'+pass).toString('base64')}:{}),
  ...(cookie?{Cookie:cookie}:{})};
 http.get({hostname:'127.0.0.1',port,path:route,headers},r=>{
  let body='';r.on('data',c=>body+=c);
  r.on('end',()=>resolve({status:r.statusCode,body,headers:r.headers}));
 }).on('error',reject);
})}
function post(route,body={},cookie='',extra={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:route,method:'POST',
   headers:{'X-Pilot-Action':'1','Content-Type':'application/json',
    ...(cookie?{Cookie:cookie}:{}),...extra}},r=>{
   let response='';r.on('data',c=>response+=c);
   r.on('end',()=>resolve({status:r.statusCode,body:response,headers:r.headers}));
  });req.on('error',reject);req.end(JSON.stringify(body));
 });
}
(async()=>{
 const child=spawn(process.execPath,['pilot/server.cjs'],{cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});
 try{
  for(let i=0;i<100;i++){try{let h=await get('/healthz',false);if(h.status===200)break}catch{}await new Promise(r=>setTimeout(r,50))}
  const health=await get('/healthz',false);
  assert.equal(health.status,200);
  assert.equal(JSON.parse(health.body).commit,'a'.repeat(40),
   'Only the public deployed source commit is available without bank authentication');
  assert.ok(!health.body.includes(pass),'Private password never appears in deployment check');
  assert.equal((await get('/api/status',false)).status,401,'Bank metadata must not be accessible anonymously');
  assert.equal((await get('/',false)).status,303,'Unsigned browser navigates to private login screen');
  const loginPage=await get('/login',false);
  assert.equal(loginPage.status,200,'Sign-in screen is accessible without exposing protected bank data');
  assert.match(loginPage.body,/Household Ledger/);
  assert.equal((await post('/auth/login',{password:'wrong'})).status,401,'Incorrect password never creates a session');
  const first=await post('/auth/login',{password:pass});
  assert.equal(first.status,200,'Correct existing password grants a private session');
  const firstCookie=first.headers['set-cookie'].find(c=>c.startsWith('__Host-ledger_session='));
  assert.match(firstCookie,/Secure; HttpOnly; SameSite=Strict/);
  assert.match(firstCookie,/Max-Age=7776000/,'Exactly 90 days until absolute cookie expiration');
  assert.equal((await get('/api/status',false,firstCookie)).status,200,
   'The signed session accesses bank metadata without Basic Authorization');
  assert.ok(!fs.readFileSync(path.join(dir,'pilot.enc.sessions'),'utf8').includes(firstCookie.split('=')[1].split(';')[0]),
   'Raw session IDs never persist to disk');
  const second=await post('/auth/login',{password:pass});
  const secondCookie=second.headers['set-cookie'].find(c=>c.startsWith('__Host-ledger_session='));
  assert.equal((await get('/api/status',false,secondCookie)).status,200);
  assert.equal((await post('/auth/logout',{},firstCookie)).status,200,
   'Device can explicitly revoke its 90-day session');
  assert.equal((await get('/api/status',false,firstCookie)).status,401,
   'Revoked cookies cannot access bank data');
  assert.equal((await get('/api/status',false,secondCookie)).status,200,
   'Signing out one household device does not sign out the other');
  const tombstone=(await post('/auth/logout',{},secondCookie)).headers['set-cookie']
    .find(c=>c.startsWith('__Host-ledger_signed_out='));
  assert.equal((await get('/api/status',true,tombstone)).status,401,
   'Signing out cannot silently fall back to browser-cached legacy Basic credentials');
  const third=await post('/auth/login',{password:pass});
  const persistentCookie=third.headers['set-cookie'].find(c=>c.startsWith('__Host-ledger_session='));
  assert.equal((await get('/api/status',false,persistentCookie)).status,200);
  const upgradedMarker=third.headers['set-cookie']
    .find(c=>c.startsWith('__Host-ledger_upgraded='));
  assert.equal((await get('/api/status',true,upgradedMarker)).status,401,
   'After cookie expiry, cached Basic credentials cannot silently renew access');
  assert.equal((await get('/api/status',true)).status,200);
  assert.equal(JSON.parse((await get('/api/status',true)).body).connected,false);
  const ledger=await get('/',true);assert.equal(ledger.status,200);assert.match(ledger.body,/<h1>Ledger<\/h1>/,'Ledger brand is served in live mode');
  assert.match(ledger.body,/<script>\s*[\s\S]*HouseholdCategorization=api;/,
   'The required classifier ships inside the authenticated private page');
  assert.doesNotMatch(ledger.body,/<script src="categorization\.js"><\/script>/,
   'Private Calendar never depends on a separate categorization network request');
  const accountingIndex=ledger.body.indexOf('accounting.js?v='),
   privateIndex=ledger.body.indexOf('<script src="/pilot/data-source.js"></script>'),
   modelIndex=ledger.body.indexOf('ledger-data.js?v=');
  assert.ok(accountingIndex>=0&&accountingIndex<privateIndex&&privateIndex<modelIndex,
   'Private bank adapter loads after the accounting/classifier modules and before the data model');
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
  assert.match(ledger.body,/manifest[.]webmanifest/,'Private app exposes install manifest');
  assert.match(ledger.body,/apple-touch-icon/,'iPhone gets an app icon');
  assert.equal((await get('/manifest.webmanifest',false)).status,303,
    'Install manifest is never exposed without private authentication');
  assert.equal((await get('/ledger-icon.png',false)).status,303,
    'The private icon follows the same authentication boundary');
  assert.equal((await get('/manifest.webmanifest',true)).status,200);
  assert.equal((await get('/ledger-icon.png',true)).status,200);
  assert.equal((await get('/planner-transactions.js',true)).status,200,'Protected server serves forecast-only editing module');
  // Retired Phase 4 accuracy/readiness research was not part of the site.
  // The authenticated server must no longer expose those obsolete scripts.
  for(const asset of ['feed-health.js','accuracy-fixture.js','accuracy-fixture-holdout.js',
    'accuracy-fixture-seasonal.js','accuracy-lab.js','stress-lab.js','readiness-lab.js']){
   assert.equal((await get('/'+asset,true)).status,404,
    'Retired laboratory asset must not remain a served browser dependency: '+asset);
  }
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
  fs.copyFileSync(path.join(__dirname,'../pilot/account-forecast-links.cjs'),
   path.join(partial,'pilot/account-forecast-links.cjs'));
  fs.copyFileSync(path.join(__dirname,'../pilot/session-auth.cjs'),
   path.join(partial,'pilot/session-auth.cjs'));
  fs.copyFileSync(path.join(__dirname,'../pilot/login.html'),
   path.join(partial,'pilot/login.html'));
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
   assert.equal(await alternate('/'),503,
    'Partial deployments fail visibly instead of serving a broken forecast page');
  }finally{partialChild.kill()}
  // A fresh Render process must load the encrypted session file, not force
  // the household to sign in on every restart.
  const restartPort=port+2;
  const restarted=spawn(process.execPath,['pilot/server.cjs'],{
   cwd:path.resolve(__dirname,'..'),env:{...env,PORT:String(restartPort)},stdio:'ignore'
  });
  try{
   const status=()=>new Promise((resolve,reject)=>{
    http.get({hostname:'127.0.0.1',port:restartPort,path:'/api/status',
     headers:{Cookie:persistentCookie}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode))}).on('error',reject);
   });
   for(let attempt=0;attempt<100;attempt++){
    try{if(await status()===200)break}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
   }
   assert.equal(await status(),200,'Encrypted private sessions survive Render restarts');
  }finally{restarted.kill()}
  console.log('PASS private 90-day login, per-device logout, encrypted persistence, health and crash protection');
 }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
