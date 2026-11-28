'use strict';
// A checked Amazon charge can still have no product Note. 'Check now' must
// reuse a pinned completed result for FREE even with automatic updates ON,
// the bank charge already scanned, and one paid run already consumed today.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),
 fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 http=require('node:http'),{spawn}=require('node:child_process');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-amazon-check-now-'));
const file=path.join(folder,'state.enc'),runFile=path.join(folder,'completed.json'),
 log=path.join(folder,'calls.log'),port=19899,runId='12345678-1234-1234-1234-123456789012';
const password='fictional-strong-private-password',secret=crypto.randomBytes(32).toString('hex'),
 key=crypto.createHash('sha256').update(secret).digest(),
 today=new Date().toISOString().slice(0,10),
 ordered=new Date(Date.now()-2*86400000).toISOString().slice(0,10),
 createdAt=new Date().toISOString();
const tx={id:'fictional-bank-charge',accountId:'fictional-card',date:today,
 merchant:'AMZN Mktp',name:'AMZN Mktp',amount:58.75,pending:false};
const txKey='bank:'+JSON.stringify([tx.accountId,tx.id]);
const state={items:[{id:'fictional-item',token:'fictional-plaid-token',
 accountIds:[tx.accountId]}],accounts:[{id:tx.accountId,itemId:'fictional-item',
 name:'Fictional credit card',type:'credit',subtype:'credit card',current:90}],
 transactions:{[tx.id]:tx},ledgerAdjustments:{predictions:{},
 categoryOverrides:{[tx.id]:'Other'}},
 amazonCloud:{enabled:true,apiKey:'fictional-tinyfish-key-1234567890',
  profileId:'prof_fictional_amazon123',baselineAt:createdAt,
  scanned:{[txKey]:createdAt},runStarts:[createdAt],run:null,
  lastCompletedRunId:runId,lastCompletedRunAt:createdAt,pausedReason:null}};
const seal=data=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const ciphertext=Buffer.concat([c.update(Buffer.from(JSON.stringify(data))),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),
 data:ciphertext.toString('base64')})};
const read=filename=>{const raw=JSON.parse(fs.readFileSync(filename,'utf8'));
 const dec=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(raw.iv,'base64'));
 dec.setAuthTag(Buffer.from(raw.tag,'base64'));
 return JSON.parse(Buffer.concat([dec.update(Buffer.from(raw.data,'base64')),dec.final()]).toString())};
fs.writeFileSync(file,seal(state));
fs.writeFileSync(runFile,JSON.stringify({status:'COMPLETED',run_id:runId,
 created_at:createdAt,profile_id:'prof_fictional_amazon123',profile_attached:true,
 goal:'Read only Amazon.com Your Orders for the last 45 days',
 result:{signedIn:true,complete:true,orders:[
 {orderId:'123-1234567-1234567',title:'Fictional household wall calendar',
  date:ordered,shipmentDate:ordered,cents:0,charged:5875},
 {orderId:'123-1234567-1234567',title:'Fictional pen holder',
  date:ordered,shipmentDate:ordered,cents:0,charged:5875}
 ]}}));
const request=(route,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
 const raw=body===undefined?null:JSON.stringify(body);
 const req=http.request({hostname:'127.0.0.1',port,path:route,method,
  headers:{...headers,...(raw?{'Content-Type':'application/json','X-Pilot-Action':'1'}:{})}},
  res=>{let s='';res.on('data',v=>s+=v);
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,
    body:JSON.parse(s||'{}')}))});
 req.on('error',reject);req.end(raw);
});
(async()=>{
 const env={...process.env,PORT:String(port),PILOT_STATE_PATH:file,
  PILOT_ENCRYPTION_KEY:secret,PILOT_PASSWORD:password,
  PLAID_ENV:'sandbox',PLAID_CLIENT_ID:'fictional-id',PLAID_SECRET:'fictional-secret',
  TINYFISH_MOCK_RESULT:runFile,TINYFISH_MOCK_LOG:log,
  NODE_OPTIONS:'--require '+path.resolve(__dirname,'amazon-cloud-fetch-mock.cjs')};
 const child=spawn(process.execPath,['pilot/server.cjs'],
  {cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',x=>process.stderr.write(x));
 try{
  let started=false;
  for(let i=0;i<150;i++){
   try{if((await request('/healthz')).status===200){started=true;break}}catch{}
   await new Promise(r=>setTimeout(r,45));
  }
  assert(started,'Private fictional server must start');
  assert.equal((await request('/api/amazon-cloud')).status,401,
   'Unauthenticated visitors cannot see bank matching status');
  const login=await request('/auth/login','POST',{password});
  assert.equal(login.status,200);
  const owner={Cookie:login.headers['set-cookie'].find(c=>c.startsWith('__Host-ledger_session='))};
  const before=await request('/api/amazon-cloud','GET',undefined,owner);
  assert.equal(before.status,200);
  assert.equal(before.body.enabled,true);
  assert.equal(before.body.pendingAmazonCharges,0,
   'This charge was inspected during the previous paid run');
  assert.equal(before.body.unnotedAmazonCharges,1,
   'No product Note means it still needs resolution');
  assert.equal(before.body.replayAvailable,true,
   'One paid run today cannot disable a free saved-result lookup');
  assert.match(before.body.runLimitReason,/already started today/);
  const blocked=await request('/api/amazon-cloud/run','POST',{consent:true},owner);
  assert.equal(blocked.status,202);
  assert.equal(blocked.body.limitReached,true,
   'A second billable Agent launch remains impossible today');
  assert.equal(fs.existsSync(log),false,'Blocked paid check made no provider request');
  assert.equal((await request('/api/amazon-cloud/reprocess','POST',
   {consent:true,runId},{})).status,401,'Public replay remains private');
  const replay=await request('/api/amazon-cloud/reprocess','POST',{consent:true,runId},owner);
  assert.equal(replay.status,202);
  assert.equal(replay.body.reprocessing,true);
  let saved;
  for(let i=0;i<150;i++){
   try{saved=read(file);if(saved.amazonCloud.run===null&&saved.amazonCloud.lastMatched===1)break}
   catch{}
   await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(saved.amazonCloud.lastMatched,1,
   'Previously scanned missing-Note charge was matched against cached orders');
  assert.equal(saved.amazonCloud.enabled,true,
   'Free replay must preserve explicitly enabled automatic updates');
  assert.equal(saved.amazonCloud.pausedReason,null);
  assert.equal(saved.amazonCloud.runStarts.length,1,
   'Free replay cannot count as a paid browser run');
  assert.deepEqual(saved.transactions,state.transactions);
  assert.equal(saved.ledgerAdjustments.categoryOverrides[tx.id],'Other',
   'Existing manual categories cannot change');
  assert.equal(saved.ledgerAdjustments.amazonAllocations?.[tx.id],undefined,
   'Missing item prices can only create product Notes');
  const note=read(file+'.forecasts').transactionNotes[txKey];
  assert.match(note,/Fictional household wall calendar/);
  assert.match(note,/Fictional pen holder/);
  const after=await request('/api/amazon-cloud','GET',undefined,owner);
  assert.equal(after.body.unnotedAmazonCharges,0);
  assert.equal(after.body.replayAvailable,false,
   'Once the Note exists, another redundant replay is not offered');
  assert.equal(after.body.pendingAmazonCharges,0);
  const calls=fs.readFileSync(log,'utf8').trim().split('\n');
  assert(calls.length>0&&calls.every(u=>u.includes('/v1/runs/')&&
   !u.includes('/v1/automation/')),'Provider interaction only reads the existing completed run');
  console.log('PASS enabled Amazon Check now reuses saved order report on scanned bank debit, daily paid cap protected, Note/category safety');
 }finally{child.kill('SIGTERM');fs.rmSync(folder,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
