'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),
 fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-cloud-'));
const file=path.join(folder,'private.enc'),log=path.join(folder,'tinyfish.log');
const port=19883,pass='fictional-'+crypto.randomBytes(24).toString('hex'),
 secret=crypto.randomBytes(32).toString('hex'),key=crypto.createHash('sha256').update(secret).digest();
const seal=x=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),
 data=Buffer.concat([c.update(Buffer.from(JSON.stringify(x))),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')})};
const unseal=()=>{const b=JSON.parse(fs.readFileSync(file,'utf8')),c=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(b.iv,'base64'));
 c.setAuthTag(Buffer.from(b.tag,'base64'));return JSON.parse(Buffer.concat([c.update(Buffer.from(b.data,'base64')),c.final()]).toString())};
const date=new Date().toISOString().slice(0,10);
const tx={id:'fictional-amazon-posted',accountId:'fictional-checking',date,merchant:'AMZN Mktp',
 name:'AMZN Mktp',amount:21.99,pending:false,category:null};
const fixture={items:[{id:'fictional-item',token:'fictional-token',accountIds:['fictional-checking'],cursor:'fixture'}],
 accounts:[{id:'fictional-checking',itemId:'fictional-item',name:'Fictional Checking',
 type:'depository',subtype:'checking',current:100,available:100}],
 transactions:{[tx.id]:tx},ledgerAdjustments:{predictions:{}}};
fs.writeFileSync(file,seal(fixture));
const env={...process.env,PORT:String(port),PILOT_PASSWORD:pass,PILOT_ENCRYPTION_KEY:secret,
 PLAID_CLIENT_ID:'fictional-id',PLAID_SECRET:'fictional-secret',PLAID_ENV:'sandbox',
 PILOT_STATE_PATH:file,TINYFISH_MOCK_LOG:log,
 NODE_OPTIONS:'--require '+path.resolve(__dirname,'amazon-cloud-fetch-mock.cjs')};
const req=(route,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
 const payload=body===undefined?null:JSON.stringify(body);
 const r=http.request({hostname:'127.0.0.1',port,path:route,method,
  headers:{...headers,...(payload?{'Content-Type':'application/json','X-Pilot-Action':'1'}:{})}},res=>{
  let s='';res.on('data',q=>s+=q);res.on('end',()=>resolve({
   status:res.statusCode,headers:res.headers,raw:s,
   data:()=>{try{return JSON.parse(s)}catch{return {}}}}));
 });r.on('error',reject);r.end(payload);
});
(async()=>{
 const child=spawn(process.execPath,['pilot/server.cjs'],{cwd:path.resolve(__dirname,'..'),env,
  stdio:['ignore','ignore','pipe']});child.stderr.on('data',b=>process.stderr.write(b));
 try{
  let ready=false;for(let n=0;n<150;n++){
   try{ready=(await req('/healthz')).status===200;if(ready)break}catch{}
   await new Promise(r=>setTimeout(r,40))}
  assert(ready,'Fictional server started');
  assert.equal((await req('/api/amazon-cloud')).status,401,'Owner-only cloud settings');
  assert.equal((await req('/api/amazon-cloud/settings','POST',{action:'enable'})).status,401,
   'Unauthenticated user cannot incur browser cost');
  const login=await req('/auth/login','POST',{password:pass});
  assert.equal(login.status,200);
  const owner={Cookie:login.headers['set-cookie'].find(s=>s.startsWith('__Host-ledger_session='))};
  const before=await req('/api/amazon-cloud','GET',undefined,owner);
  assert.equal(before.status,200);assert.equal(before.data().connected,false);
  assert.equal(before.data().enabled,false);
  assert.equal(before.data().pendingAmazonCharges,1);
  assert.equal((await req('/api/amazon-cloud/settings','POST',{action:'enable'},owner)).status,409,
   'Cannot enable before TinyFish is connected');
  const secretKey='fictional-tinyfish-api-key-0123456789';
  const connected=await req('/api/amazon-cloud/settings','POST',{action:'connect',apiKey:secretKey},owner);
  assert.equal(connected.status,200);
  assert.equal(connected.data().connected,true);
  assert.equal(unseal().amazonCloud.profileId,'prof_fictional_amazon123',
   'Saved Amazon profile identity is fixed at connection time');
  assert.equal(connected.raw.includes(secretKey),false,'Never return the TinyFish API key to clients');
  const activated=(await req('/api/amazon-cloud/settings','POST',{action:'enable'},owner)).data();
  assert.equal(activated.enabled,true);
  assert.equal(activated.pendingAmazonCharges,0,
   'Enabling does not unexpectedly bill for previously posted Amazon purchases');
  assert.ok(unseal().amazonCloud.baselineAt,'First enablement saves a durable starting point');
  assert.equal(unseal().amazonCloud.apiKey,secretKey,'TinyFish connection stored only encrypted');
  assert.deepEqual(unseal().transactions,fixture.transactions,'Original posted bank data is immutable');
  assert.equal((await req('/api/amazon-cloud/settings','POST',{action:'disable'},owner)).data().enabled,false);
  assert.equal((await req('/api/amazon-cloud/settings','POST',{action:'disconnect'},owner)).data().connected,false);
  assert.equal((await req('/api/amazon-cloud/run','POST',{consent:true},owner)).data().disabled,true,
   'Disabled account cannot run a charged Amazon lookup');
  assert.equal((await req('/api/amazon-cloud','GET',undefined,{'X-Ledger-Share':'f'.repeat(64)})).status,401,
   'Spouse category-sharing link cannot open paid browser controls');
  const html=await req('/amazon-import','GET',undefined,owner);
  assert.equal(html.status,200);assert.match(html.raw,/Automatic Amazon updates/);
  assert.doesNotMatch(html.raw,/Load unpacked|chrome:\/\/extensions/,
   'PC installation was replaced by TinyFish cloud setup');
  assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1,
   'Only free TinyProfile validation was sent to TinyFish');
  console.log('PASS private TinyFish setup: auth, encrypted key, no source-bank mutations, off by default, no paid run, Lite denial');
 }finally{child.kill('SIGTERM');fs.rmSync(folder,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
