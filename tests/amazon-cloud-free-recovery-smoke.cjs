'use strict';
// Upgrade an already completed TinyFish result automatically ONCE without
// restarting the paid browser. Fictional encrypted state and provider only.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),
 fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 http=require('node:http'),{spawn}=require('node:child_process');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-cloud-free-recovery-'));
const file=path.join(folder,'state.enc'),runFile=path.join(folder,'result.json'),
 log=path.join(folder,'calls.log'),port=19897;
const secret=crypto.randomBytes(32).toString('hex'),
 key=crypto.createHash('sha256').update(secret).digest(),
 stamp=new Date().toISOString(),today=stamp.slice(0,10),
 orderDate=new Date(Date.now()-2*86400000).toISOString().slice(0,10),
 runId='12345678-1234-1234-1234-123456789012';
const tx={id:'fictional-posted-debit',accountId:'fictional-bank',date:today,
 merchant:'AMZN Mktp',name:'AMZN Mktp',amount:27.19,pending:false};
const txKey='bank:'+JSON.stringify([tx.accountId,tx.id]);
const state={items:[{id:'fictional-item',token:'fictional-token',
 accountIds:[tx.accountId]}],
 accounts:[{id:tx.accountId,itemId:'fictional-item',type:'depository',
 subtype:'checking',name:'Fictional Checking',current:300}],
 transactions:{[tx.id]:tx},ledgerAdjustments:{predictions:{}},
 amazonCloud:{enabled:false,apiKey:'fictional-tinyfish-key-1234567890',
  profileId:'prof_fictional_amazon123',baselineAt:stamp,
  runStarts:[stamp],pausedReason:'no-matches',lastFailedRunId:runId,run:null}};
const seal=data=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const bytes=Buffer.concat([c.update(Buffer.from(JSON.stringify(data))),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),
  data:bytes.toString('base64')})};
const read=filename=>{const data=JSON.parse(fs.readFileSync(filename,'utf8'));
 const c=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(data.iv,'base64'));
 c.setAuthTag(Buffer.from(data.tag,'base64'));
 return JSON.parse(Buffer.concat([c.update(Buffer.from(data.data,'base64')),c.final()]).toString())};
fs.writeFileSync(file,seal(state));
fs.writeFileSync(runFile,JSON.stringify({run_id:runId,status:'COMPLETED',
 created_at:stamp,goal:'Read only Amazon.com Your Orders for the last 45 days',
 profile_id:'prof_fictional_amazon123',profile_attached:true,
 result:{signedIn:true,complete:true,orders:[
 {orderId:'123-1234567-1234567',date:orderDate,shipmentDate:orderDate,
  title:'Fictional navy sweater',cents:0,charged:0},
 {orderId:'123-1234567-1234567',date:orderDate,shipmentDate:orderDate,
  title:'Fictional cotton socks',cents:null,charged:0},
 {orderId:'123-7654321-1234567',date:orderDate,shipmentDate:orderDate,
  title:'Fictional measuring cups',cents:0,charged:0}
 ]}}));
const env={...process.env,PORT:String(port),PILOT_ENCRYPTION_KEY:secret,
 PILOT_PASSWORD:'fictional-owner-password',PILOT_STATE_PATH:file,
 PLAID_ENV:'sandbox',PLAID_CLIENT_ID:'fictional-client',PLAID_SECRET:'fictional-secret',
 TINYFISH_MOCK_RESULT:runFile,TINYFISH_MOCK_LOG:log,
 NODE_OPTIONS:'--require '+path.resolve(__dirname,'amazon-cloud-fetch-mock.cjs')};
const health=()=>new Promise((resolve,reject)=>{
 http.get({hostname:'127.0.0.1',port,path:'/healthz'},response=>{
  response.resume();response.on('end',()=>resolve(response.statusCode===200))
 }).on('error',reject)
});
const launch=()=>spawn(process.execPath,['pilot/server.cjs'],{
 cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','ignore','pipe']});
(async()=>{
 let child=launch();
 child.stderr.on('data',b=>process.stderr.write(b));
 try{
  let done=false;
  for(let i=0;i<180;i++){
   try{
    if(await health()&&fs.existsSync(file+'.forecasts')){
     const saved=read(file);
     if(saved.amazonCloud.run===null&&saved.amazonCloud.lastPossible===1){done=true;break}
    }
   }catch{}
   await new Promise(r=>setTimeout(r,45));
  }
  assert(done,'A paused completed run must be recovered once on server startup');
  const saved=read(file),forecast=read(file+'.forecasts');
  assert.equal(saved.amazonCloud.enabled,false,
   'Do not silently enable future paid checks while recovering');
  assert.equal(saved.amazonCloud.pausedReason,null);
  assert.equal(saved.amazonCloud.lastMatched,0);
  assert.equal(saved.amazonCloud.lastPossible,1);
  assert.equal(saved.amazonCloud.pendingAmazonCharges,undefined);
  assert.equal(saved.amazonCloud.scanned[txKey]!==undefined,true);
  assert.equal(saved.amazonCloud.runStarts.length,1,'No new paid run is consumed');
  assert.deepEqual(saved.transactions,state.transactions,'No bank data mutation');
  assert.match(forecast.transactionNotes[txKey],
   /^Possible Amazon \(verify\):/,'Ambiguous candidates must be explicitly labelled');
  assert.equal(saved.ledgerAdjustments.categoryOverrides?.[tx.id],undefined,
   'Possible products cannot assign a category');
  assert.equal(saved.ledgerAdjustments.amazonAllocations?.[tx.id],undefined,
   'Missing prices cannot be allocated to items');
  assert.equal(saved.ledgerAdjustments.amazonEvidence[tx.id].match,'possible');
  assert.equal(saved.ledgerAdjustments.amazonEvidence[tx.id].choices.length,2);
  const count=()=>fs.readFileSync(log,'utf8').trim().split('\n');
  assert(count().length>=2&&count().every(x=>x.includes('/v1/runs/')),
   'Only existing-run GET calls, never paid Agent start');
  const priorCount=count().length;
  child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));
  child=launch();child.stderr.on('data',b=>process.stderr.write(b));
  let restarted=false;
  for(let i=0;i<150;i++){
   try{if(await health()){restarted=true;break}}catch{}
   await new Promise(r=>setTimeout(r,40));
  }
  assert(restarted);
  await new Promise(r=>setTimeout(r,250));
  assert.equal(count().length,priorCount,
   'A process restart cannot repeat the saved-run recovery or initiate a paid check');
  console.log('PASS automatic once-only saved Amazon result recovery, Possible Notes, no provider charges, immutable bank');
 }finally{
  child.kill('SIGTERM');
  fs.rmSync(folder,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
