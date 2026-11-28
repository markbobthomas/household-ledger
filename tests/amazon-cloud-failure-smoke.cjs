'use strict';
// Regression for three bad TinyFish outcomes: never accept, silently retry,
// or re-bill an unsafe Amazon report. Fictional encrypted state only.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),
 os=require('node:os'),path=require('node:path'),http=require('node:http'),
 {spawn}=require('node:child_process');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-cloud-fail-')),port=19889;
const secret=crypto.randomBytes(32).toString('hex'),
 key=crypto.createHash('sha256').update(secret).digest();
const stamp=new Date().toISOString(),day=stamp.slice(0,10);
const tx={id:'fictional-charge',accountId:'fictional-checking',date:day,
 name:'AMZN Mktp',merchant:'AMZN Mktp',amount:21.99,pending:false};
const chargeKey='bank:'+JSON.stringify([tx.accountId,tx.id]);
const root={items:[{id:'fictional-item',token:'fictional-plaidsafe',
 accountIds:[tx.accountId]}],accounts:[{id:tx.accountId,itemId:'fictional-item',
 name:'Fictional Checking',type:'depository',subtype:'checking',current:500}],
 transactions:{[tx.id]:tx},ledgerAdjustments:{predictions:{}},
 amazonCloud:{enabled:true,apiKey:'fictional-tinyfish-key-123456789',
  profileId:'prof_fictional_amazon123',baselineAt:stamp,
  run:{id:'12345678-1234-1234-1234-123456789012',
   startedAt:stamp,status:'running',targets:[chargeKey]}}};
const encode=data=>{
 const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const body=Buffer.concat([c.update(Buffer.from(JSON.stringify(data))),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),
  data:body.toString('base64')});
};
const decode=file=>{
 const raw=JSON.parse(fs.readFileSync(file,'utf8')),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(raw.iv,'base64'));
 d.setAuthTag(Buffer.from(raw.tag,'base64'));
 return JSON.parse(Buffer.concat([d.update(Buffer.from(raw.data,'base64')),d.final()]).toString());
};
const ready=()=>new Promise((resolve,reject)=>{
 http.get({hostname:'127.0.0.1',port,path:'/healthz'},r=>{
  r.resume();r.on('end',()=>resolve(r.statusCode===200));
 }).on('error',reject);
});
async function verify(label,provider,reason){
 const file=path.join(folder,label+'.enc'),json=path.join(folder,label+'.json'),
  log=path.join(folder,label+'.log');
 fs.writeFileSync(file,encode(root));
 fs.writeFileSync(json,JSON.stringify(provider));
 const env={...process.env,PORT:String(port),PILOT_STATE_PATH:file,
  PILOT_ENCRYPTION_KEY:secret,PILOT_PASSWORD:'fictional-password-with-valid-length',
  PLAID_ENV:'sandbox',PLAID_CLIENT_ID:'fictional-id',
  PLAID_SECRET:'fictional-secret',
  TINYFISH_MOCK_RESULT:json,TINYFISH_MOCK_LOG:log,
  NODE_OPTIONS:'--require '+path.resolve(__dirname,'amazon-cloud-fetch-mock.cjs')};
 const child=spawn(process.execPath,['pilot/server.cjs'],{
  cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','ignore','pipe']
 });
 child.stderr.on('data',b=>process.stderr.write(b));
 try{
  let done=false;
  for(let i=0;i<180;i++){
   try{
    if(await ready()){
     const now=decode(file);
     if(now.amazonCloud?.run===null){done=true;break}
    }
   }catch{}
   await new Promise(r=>setTimeout(r,45));
  }
  assert(done,label+' was not completed safely');
  const saved=decode(file),cloud=saved.amazonCloud;
  if(reason==='no-matches'){
   // A complete signed-in result is NOT a broken connection. A charge
   // without a product Note remains visible, but cannot trigger a second
   // unattended paid Agent run just because Amazon omitted its order.
   assert.equal(cloud.enabled,true,label+' leaves opted-in updates enabled');
   assert.equal(cloud.pausedReason,null,label+' is not a provider failure');
   assert.ok(cloud.scanned?.[chargeKey],label+' avoids repeat paid scans');
   assert.equal(cloud.lastUnmatched,1,label+' preserves unresolved count');
   assert.equal(cloud.lastMatched,0);
   assert.equal(cloud.lastCompletedRunId,root.amazonCloud.run.id);
  }else{
   assert.equal(cloud.enabled,false,label+' must pause future paid browsing');
   assert.equal(cloud.pausedReason,reason,label+' must identify why it paused');
   assert.equal(cloud.scanned?.[chargeKey],undefined,label+' must not mark unknown charge checked');
   assert.equal(cloud.lastSuccessAt,undefined,label+' must never report a false success');
  }
  assert.deepEqual(saved.transactions,root.transactions,label+' must not touch source bank data');
  assert.equal(fs.existsSync(file+'.forecasts'),false,
   label+' must not create product Notes from unverified order data');
  assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1,
   label+' should poll an existing run, not start a second paid Agent');
 }finally{
  child.kill('SIGTERM');
  await new Promise(r=>child.once('exit',r)).catch(()=>{});
 }
}
(async()=>{
 await verify('incomplete',{status:'COMPLETED',result:{signedIn:true,
  complete:false,orders:[{orderId:'123-1234567-1234567',title:'Uncertain item',
   date:day,shipmentDate:day,cents:2199,charged:2199}]}},'invalid-report');
 await verify('empty',{status:'COMPLETED',result:{signedIn:true,
  complete:true,orders:[]}},'empty-report');
 await verify('no-match',{status:'COMPLETED',created_at:stamp,result:{signedIn:true,
  complete:true,orders:[{orderId:'123-1234567-1234567',
   title:'Fictional unrelated item',
   date:new Date(Date.now()-20*86400000).toISOString().slice(0,10),
   shipmentDate:new Date(Date.now()-20*86400000).toISOString().slice(0,10),
   cents:9999,charged:9999}]}},'no-matches');
 await verify('failed',{status:'FAILED',result:null},'run-failed');
 console.log('PASS Amazon cloud failure isolation: four bad reports paused, no repeat spending or bank mutations');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
 fs.rmSync(folder,{recursive:true,force:true});
});
