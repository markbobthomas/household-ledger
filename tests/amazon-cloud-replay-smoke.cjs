'use strict';
// Reprocess an already-billed TinyFish result through a fictional private server.
// Must not launch another Agent or alter authoritative Plaid transactions.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),
 path=require('node:path'),crypto=require('node:crypto'),http=require('node:http'),
 {spawn}=require('node:child_process');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-amazon-replay-'));
const file=path.join(folder,'state.enc'),resultFile=path.join(folder,'result.json'),
 log=path.join(folder,'tinyfish.log'),port=19895;
const password='fictional-replay-password',secret=crypto.randomBytes(32).toString('hex'),
 key=crypto.createHash('sha256').update(secret).digest();
const runId='12345678-1234-1234-1234-123456789012';
const day=new Date().toISOString().slice(0,10);
const orderDate=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
const olderDate=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
const charge={id:'fictional-replay-charge',accountId:'fictional-bank',date:day,
 merchant:'AMZN Mktp',name:'AMZN Mktp',amount:21.99,pending:false};
const chargeKey='bank:'+JSON.stringify([charge.accountId,charge.id]);
const state={items:[{id:'fictional-item',token:'fictional-token',accountIds:['fictional-bank']}],
 accounts:[{id:'fictional-bank',itemId:'fictional-item',name:'Fictional Checking',
 type:'depository',subtype:'checking',current:300}],
 transactions:{[charge.id]:charge},ledgerAdjustments:{predictions:{}},
 amazonCloud:{enabled:false,apiKey:'fictional-tinyfish-key-1234567890',
  profileId:'prof_fictional_amazon123',baselineAt:new Date().toISOString(),
  pausedReason:'invalid-report',lastFailedRunId:runId,
  runStarts:[new Date().toISOString()],run:null}};
const seal=data=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const ciphertext=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data))),cipher.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
 data:ciphertext.toString('base64')})};
const unseal=filename=>{const packet=JSON.parse(fs.readFileSync(filename,'utf8')),
 decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(packet.iv,'base64'));
 decipher.setAuthTag(Buffer.from(packet.tag,'base64'));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(packet.data,'base64')),decipher.final()]).toString())};
fs.writeFileSync(file,seal(state));
fs.writeFileSync(resultFile,JSON.stringify({run_id:runId,status:'COMPLETED',
 profile_attached:true,profile_id:'prof_fictional_amazon123',
 created_at:new Date().toISOString(),goal:'Navigate to Amazon.com: Read only Amazon.com Your Orders for the last 45 days',
 result:{signedIn:true,complete:true,orders:[
  {orderId:'123-1234567-1234567',title:'Fictional household storage bin',
   date:orderDate,shipmentDate:orderDate,cents:2199,charged:2199},
  {orderId:'123-9999999-9999999',title:'Fictional unpriced older toy',
   date:olderDate,shipmentDate:olderDate,cents:0,charged:0}
 ]}}));
const request=(route,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
 const content=body===undefined?null:JSON.stringify(body);
 const req=http.request({hostname:'127.0.0.1',port,path:route,method,
  headers:{...headers,...(content?{'Content-Type':'application/json','X-Pilot-Action':'1'}:{})}},res=>{
  let buf='';res.on('data',chunk=>buf+=chunk);res.on('end',()=>resolve({status:res.statusCode,
   headers:res.headers,body:JSON.parse(buf||'{}')}))});
 req.on('error',reject);req.end(content);
});
(async()=>{
 const env={...process.env,PORT:String(port),PILOT_PASSWORD:password,PILOT_ENCRYPTION_KEY:secret,
  PILOT_STATE_PATH:file,PLAID_ENV:'sandbox',PLAID_CLIENT_ID:'fictional-id',
  PLAID_SECRET:'fictional-secret',TINYFISH_MOCK_RESULT:resultFile,
  TINYFISH_MOCK_LOG:log,
  NODE_OPTIONS:'--require '+path.resolve(__dirname,'amazon-cloud-fetch-mock.cjs')};
 const child=spawn(process.execPath,['pilot/server.cjs'],{
  cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',b=>process.stderr.write(b));
 try{
  let ready=false;
  for(let k=0;k<150;k++){
   try{if((await request('/healthz')).status===200){ready=true;break}}catch{}
   await new Promise(r=>setTimeout(r,40))
  }
  assert(ready,'Fictional server must start');
  assert.equal((await request('/api/amazon-cloud/reprocess','POST',
   {consent:true,runId})).status,401,'Public callers cannot reprocess private Amazon data');
  const login=await request('/auth/login','POST',{password});
  assert.equal(login.status,200);
  const owner={Cookie:login.headers['set-cookie'].find(s=>s.startsWith('__Host-ledger_session='))};
  assert.equal((await request('/api/amazon-cloud/reprocess','POST',
   {consent:true,runId:'different-run-identifier'},owner)).status,409,
   'Unrelated provider run IDs cannot be substituted');
  const started=await request('/api/amazon-cloud/reprocess','POST',
   {consent:true,runId},owner);
  assert.equal(started.status,202,'Owner can explicitly recheck the existing result');
  let saved;
  for(let k=0;k<200;k++){
   try{saved=unseal(file);
    if(saved.amazonCloud.run===null&&saved.amazonCloud.lastMatched===1)break
   }catch{}
   await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(saved.amazonCloud.lastMatched,1,
   'Complete priced order is accepted despite unrelated unpriced order');
  assert.equal(saved.amazonCloud.enabled,false,
   'Replaying an existing result cannot enable recurring paid checks');
  assert.equal(saved.amazonCloud.pausedReason,'partial-report',
   'Excluded unpriced orders leave future paid runs paused');
  assert.equal(saved.amazonCloud.runStarts.length,1,
   'Reprocessing does not use another paid Agent start');
  assert.equal(saved.amazonCloud.scanned[chargeKey]!==undefined,true,
   'Only the exactly verified bank charge becomes checked');
  assert.deepEqual(saved.transactions,state.transactions,'Original Plaid facts remain untouched');
  assert.match(unseal(file+'.forecasts').transactionNotes[chargeKey],
   /Fictional household storage bin/);
  const calls=fs.readFileSync(log,'utf8').trim().split('\n');
  assert(calls.length>=2&&calls.every(x=>x.includes('/v1/runs/')),
   'Only existing-run GET requests are made; no new paid Agent request');
  console.log('PASS private owner-only TinyFish replay, partial valid order, no paid launch, immutable bank data');
 }finally{
  child.kill('SIGTERM');
  fs.rmSync(folder,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
