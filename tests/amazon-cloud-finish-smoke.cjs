'use strict';
// Entire server/API import through one fictional completed cloud report.
// No live Amazon, bank, TinyFish credentials or paid requests are used.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),
 os=require('node:os'),path=require('node:path'),http=require('node:http'),
 {spawn}=require('node:child_process');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-cloud-finish-'));
const file=path.join(folder,'state.enc'),resultFile=path.join(folder,'run.json'),
 log=path.join(folder,'calls.log'),port=19885;
const secret=crypto.randomBytes(32).toString('hex'),key=crypto.createHash('sha256').update(secret).digest();
const writeEncrypted=(filename,value)=>{
 const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const data=Buffer.concat([c.update(Buffer.from(JSON.stringify(value))),c.final()]);
 fs.writeFileSync(filename,JSON.stringify({iv:iv.toString('base64'),
  tag:c.getAuthTag().toString('base64'),data:data.toString('base64')}));
};
const readEncrypted=filename=>{
 const b=JSON.parse(fs.readFileSync(filename,'utf8')),c=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(b.iv,'base64'));
 c.setAuthTag(Buffer.from(b.tag,'base64'));
 return JSON.parse(Buffer.concat([c.update(Buffer.from(b.data,'base64')),c.final()]).toString());
};
const today=new Date().toISOString().slice(0,10);
const orderDate=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
const tx={id:'fictional-amazon-charge',accountId:'fictional-checking',date:today,
 merchant:'AMZN Mktp',name:'AMZN Mktp',amount:21.99,pending:false,category:null};
const bankKey='bank:'+JSON.stringify([tx.accountId,tx.id]);
const base={items:[{id:'fictional-item',token:'fictional-plaidsafe',accountIds:[tx.accountId]}],
 accounts:[{id:tx.accountId,name:'Fictional Checking',type:'depository',subtype:'checking',
  itemId:'fictional-item',current:300,available:300}],
 transactions:{[tx.id]:tx},ledgerAdjustments:{predictions:{}},
 amazonCloud:{enabled:true,apiKey:'fictional-tinyfish-key-1234567890',
  run:{id:'12345678-1234-1234-1234-123456789012',targets:[bankKey],
   status:'running',startedAt:new Date().toISOString()}}};
writeEncrypted(file,base);
fs.writeFileSync(resultFile,JSON.stringify({status:'COMPLETED',result:{
 signedIn:true,orders:[{orderId:'123-1234567-1234567',title:'Fictional household storage bin',
 date:orderDate,shipmentDate:orderDate,cents:2199,charged:2199}]}}));
const env={...process.env,PORT:String(port),PILOT_PASSWORD:'fictional-test-password',
 PILOT_ENCRYPTION_KEY:secret,PILOT_STATE_PATH:file,PLAID_ENV:'sandbox',
 PLAID_CLIENT_ID:'fictional-id',PLAID_SECRET:'fictional-secret',TINYFISH_MOCK_RESULT:resultFile,
 TINYFISH_MOCK_LOG:log,NODE_OPTIONS:'--require '+path.resolve(__dirname,'amazon-cloud-fetch-mock.cjs')};
const get=route=>new Promise((resolve,reject)=>{
 http.get({hostname:'127.0.0.1',port,path:route},r=>{
  let s='';r.on('data',x=>s+=x);r.on('end',()=>resolve({status:r.statusCode,body:s}));
 }).on('error',reject);
});
(async()=>{
 const child=spawn(process.execPath,['pilot/server.cjs'],{cwd:path.resolve(__dirname,'..'),
  env,stdio:['ignore','ignore','pipe']});child.stderr.on('data',x=>process.stderr.write(x));
 try{
  let complete=false;
  for(let n=0;n<150;n++){
   try{if((await get('/healthz')).status===200&&fs.existsSync(file+'.forecasts')){
    const state=readEncrypted(file);
    if(!state.amazonCloud.run&&state.amazonCloud.lastSuccessAt){complete=true;break}
   }}catch{}
   await new Promise(r=>setTimeout(r,60));
  }
  assert.equal(complete,true,'Completed TinyFish report must finish through private importer');
  const saved=readEncrypted(file),predictions=readEncrypted(file+'.forecasts');
  assert.deepEqual(saved.transactions,base.transactions,'Cloud import never edits Plaid charges');
  assert.equal(Object.keys(saved.transactions).length,1,'No second transaction created');
  assert.match(predictions.transactionNotes[bankKey],/Fictional household storage bin/,
   'Matched Amazon item is saved as transaction Note');
  assert.equal(saved.amazonCloud.run,null,'Run cleared only after durable save');
  assert.equal(saved.amazonCloud.scanned[bankKey]!==undefined,true,
   'Checked bank transaction is remembered to avoid repeat paid run');
  assert.equal(saved.amazonCloud.lastMatched,1);
  assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1,
   'One read-only TinyFish run-status lookup, no new browser agent');
  console.log('PASS completed cloud Amazon result: exact local match, private Note, immutable bank row, durable no-repeat status');
 }finally{child.kill();fs.rmSync(folder,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
