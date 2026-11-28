'use strict';
// A valid but price-incomplete TinyFish report MUST NOT disable future
// owner-consented scheduled checks when tentative product Notes were saved.
// Fictional encrypted bank state; no real Agent or Plaid calls.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),
 fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 http=require('node:http'),{spawn}=require('node:child_process');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-cloud-possible-'));
const file=path.join(folder,'state.enc'),report=path.join(folder,'report.json'),
 log=path.join(folder,'tinyfish.log'),port=19898;
const secret=crypto.randomBytes(32).toString('hex'),
 key=crypto.createHash('sha256').update(secret).digest(),
 now=new Date().toISOString(),day=now.slice(0,10),
 ordered=new Date(Date.now()-2*86400000).toISOString().slice(0,10),
 runId='12345678-1234-1234-1234-123456789012';
const charge={id:'fictional-charge',accountId:'fictional-card',
 date:day,merchant:'AMZN Mktp',name:'AMZN Mktp',amount:36.17,pending:false};
const chargeKey='bank:'+JSON.stringify([charge.accountId,charge.id]);
const baseline={items:[{id:'fictional-item',token:'fictional-token',
 accountIds:[charge.accountId]}],accounts:[{id:charge.accountId,itemId:'fictional-item',
 name:'Fictional Card',type:'credit',subtype:'credit card',current:500}],
 transactions:{[charge.id]:charge},ledgerAdjustments:{predictions:{},
 categoryOverrides:{[charge.id]:'Other'}},
 amazonCloud:{enabled:true,apiKey:'fictional-tinyfish-key-1234567890',
  profileId:'prof_fictional_amazon123',baselineAt:now,runStarts:[now],
  run:{id:runId,targets:[chargeKey],status:'running',startedAt:now}}};
const encode=payload=>{const iv=crypto.randomBytes(12),
 c=crypto.createCipheriv('aes-256-gcm',key,iv),
 data=Buffer.concat([c.update(Buffer.from(JSON.stringify(payload))),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),
 tag:c.getAuthTag().toString('base64'),data:data.toString('base64')})};
const decode=filename=>{const x=JSON.parse(fs.readFileSync(filename,'utf8')),
 c=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(x.iv,'base64'));
 c.setAuthTag(Buffer.from(x.tag,'base64'));
 return JSON.parse(Buffer.concat([c.update(Buffer.from(x.data,'base64')),c.final()]).toString())};
fs.writeFileSync(file,encode(baseline));
fs.writeFileSync(report,JSON.stringify({run_id:runId,status:'COMPLETED',
 created_at:now,profile_id:'prof_fictional_amazon123',profile_attached:true,
 goal:'Read only Amazon.com Your Orders for the last 45 days',
 result:{complete:true,signedIn:true,orders:[
 {orderId:'123-0000001-1111111',title:'Fictional art canvas',
  date:ordered,shipmentDate:ordered,cents:0,charged:0},
 {orderId:'123-0000002-2222222',title:'Fictional craft pencils',
  date:ordered,shipmentDate:ordered,cents:0,charged:0}
 ]}}));
const env={...process.env,PORT:String(port),PILOT_ENCRYPTION_KEY:secret,
 PILOT_PASSWORD:'fictional-password',PILOT_STATE_PATH:file,
 PLAID_ENV:'sandbox',PLAID_CLIENT_ID:'fictional-id',PLAID_SECRET:'fictional-secret',
 TINYFISH_MOCK_RESULT:report,TINYFISH_MOCK_LOG:log,
 NODE_OPTIONS:'--require '+path.resolve(__dirname,'amazon-cloud-fetch-mock.cjs')};
const health=()=>new Promise((resolve,reject)=>{
 http.get({hostname:'127.0.0.1',port,path:'/healthz'},res=>{
  res.resume();res.on('end',()=>resolve(res.statusCode===200))
 }).on('error',reject);
});
(async()=>{
 const child=spawn(process.execPath,['pilot/server.cjs'],
 {cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',x=>process.stderr.write(x));
 try{
  let ready=false;
  for(let i=0;i<160;i++){
   try{if(await health()&&fs.existsSync(file+'.forecasts')){
    const current=decode(file);
    if(current.amazonCloud.run===null&&current.amazonCloud.lastPossible===1){
     ready=true;break
    }
   }}catch{}
   await new Promise(r=>setTimeout(r,45));
  }
  assert(ready,'Completed but partially priced report must be processed');
  const saved=decode(file),forecast=decode(file+'.forecasts');
  assert.equal(saved.amazonCloud.enabled,true,
   'A useful Possible Note must preserve the already enabled future schedule');
  assert.equal(saved.amazonCloud.pausedReason,null);
  assert.equal(saved.amazonCloud.lastUnmatched,0);
  assert.equal(saved.amazonCloud.lastMatched,0);
  assert.equal(saved.amazonCloud.lastPossible,1);
  assert.equal(saved.amazonCloud.scanned[chargeKey]!==undefined,true);
  assert.match(forecast.transactionNotes[chargeKey],/^Possible Amazon \(verify\):/);
  assert.equal(saved.ledgerAdjustments.categoryOverrides[charge.id],'Other',
   'Never overwrite owner categories with uncertain product titles');
  assert.equal(saved.ledgerAdjustments.amazonAllocations?.[charge.id],undefined);
  assert.deepEqual(saved.transactions,baseline.transactions);
  assert.equal(saved.amazonCloud.runStarts.length,1);
  assert(fs.readFileSync(log,'utf8').trim().split('\n').every(x=>
   x.includes('/v1/runs/')),'A completed check must not launch a paid new Agent');
  console.log('PASS possible Amazon Notes, saved immutable bank and category, automatic schedule remains enabled');
 }finally{child.kill('SIGTERM');fs.rmSync(folder,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
