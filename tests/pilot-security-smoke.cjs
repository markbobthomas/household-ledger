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
  assert.equal((await get('/',true)).status,200);
  assert.ok(!(await get('/api/status',true)).body.includes('test-placeholder'),'Secrets absent from responses');
  console.log('PASS isolated pilot authentication, healthcheck, empty state, no leaked Plaid credentials');
 }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
