'use strict';
// Private owner flow, fictional encrypted state and mock-only GET /v1/runs.
// The test rejects any paid Agent launch and checks immutable Plaid records.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),
 fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 http=require('node:http'),{spawn}=require('node:child_process');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-amazon-owner-'));
const file=path.join(folder,'state.enc'),resultFile=path.join(folder,'result.json'),
 log=path.join(folder,'calls.log'),port=19896,runId='12345678-1234-1234-1234-123456789012',
 password='fictional-owner-review-password';
const secret=crypto.randomBytes(32).toString('hex'),
 key=crypto.createHash('sha256').update(secret).digest(),
 date=new Date().toISOString().slice(0,10),
 older=new Date(Date.now()-3*86400000).toISOString().slice(0,10);
const bank={id:'fictional-purchase',accountId:'fictional-bank',date,
 name:'AMZN Mktp',merchant:'AMZN Mktp',pending:false,amount:37.49};
const bankKey='bank:'+JSON.stringify([bank.accountId,bank.id]);
const state={items:[{id:'fictional-item',token:'fictional-plaidsafe',accountIds:[bank.accountId]}],
 accounts:[{id:bank.accountId,itemId:'fictional-item',type:'depository',subtype:'checking',
  name:'Fictional Checking',current:500}],
 transactions:{[bank.id]:bank},
 ledgerAdjustments:{predictions:{},categoryOverrides:{[bank.id]:'Other'}},
 amazonCloud:{enabled:false,apiKey:'fictional-tinyfish-key-1234567890',
  profileId:'prof_fictional_amazon123',baselineAt:new Date().toISOString(),
  pausedReason:'no-matches',lastFailedRunId:runId,
  runStarts:[new Date().toISOString()],run:null}};
const seal=data=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data))),cipher.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
  data:encrypted.toString('base64')})};
const unseal=filename=>{const data=JSON.parse(fs.readFileSync(filename,'utf8'));
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(data.iv,'base64'));
 decipher.setAuthTag(Buffer.from(data.tag,'base64'));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.data,'base64')),decipher.final()]).toString())};
fs.writeFileSync(file,seal(state));
fs.writeFileSync(resultFile,JSON.stringify({status:'COMPLETED',run_id:runId,
 created_at:new Date().toISOString(),profile_id:'prof_fictional_amazon123',
 profile_attached:true,goal:'Read only Amazon.com Your Orders for the last 45 days',
 result:{signedIn:true,complete:true,orders:[
  {orderId:'123-1234567-1234567',title:'Fictional cooking thermometer',
   date:older,shipmentDate:older,cents:0,charged:0},
  {orderId:'123-1234567-1234567',title:'Fictional kitchen sponge',
   date:older,shipmentDate:older,cents:0,charged:0}
 ]}}));
const request=(route,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
 const data=body===undefined?null:JSON.stringify(body);
 const req=http.request({hostname:'127.0.0.1',port,path:route,method,
  headers:{...headers,...(data?{'Content-Type':'application/json','X-Pilot-Action':'1'}:{})}},response=>{
  let s='';response.on('data',x=>s+=x);response.on('end',()=>resolve({
   status:response.statusCode,headers:response.headers,body:JSON.parse(s||'{}')}))});
 req.on('error',reject);req.end(data);
});
(async()=>{
 const env={...process.env,PORT:String(port),PILOT_STATE_PATH:file,
  PILOT_ENCRYPTION_KEY:secret,PILOT_PASSWORD:password,PLAID_ENV:'sandbox',
  PLAID_CLIENT_ID:'fictional-id',PLAID_SECRET:'fictional-secret',
  TINYFISH_MOCK_RESULT:resultFile,TINYFISH_MOCK_LOG:log,
  NODE_OPTIONS:'--require '+path.resolve(__dirname,'amazon-cloud-fetch-mock.cjs')};
 const child=spawn(process.execPath,['pilot/server.cjs'],{
  cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',data=>process.stderr.write(data));
 try{
  let alive=false;
  for(let i=0;i<150;i++){
   try{if((await request('/healthz')).status===200){alive=true;break}}catch{}
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert(alive,'The private fictional bank server must start');
  assert.equal((await request('/api/amazon-cloud/review')).status,401,
   'Unauthenticated users cannot browse Amazon product candidates');
  assert.equal((await request('/api/amazon-cloud/review/confirm','POST',
   {consent:true,runId,orderId:'123-1234567-1234567',
    transactionKey:bankKey,revision:'not-valid'})).status,401,
   'Unauthenticated users cannot save product Notes');
  const login=await request('/auth/login','POST',{password});
  assert.equal(login.status,200);
  const owner={Cookie:login.headers['set-cookie'].find(v=>v.startsWith('__Host-ledger_session='))};
  const review=await request('/api/amazon-cloud/review','GET',undefined,owner);
  assert.equal(review.status,200,'The owner can read the saved provider result');
  assert.equal(review.body.runId,runId);
  assert.equal(review.body.charges.length,1);
  assert.equal(review.body.charges[0].amountCents,3749);
  assert.equal(review.body.charges[0].candidates.length,1);
  assert.equal(review.body.charges[0].candidates[0].orderTotalCents,null);
  const selection={consent:true,runId,
   orderId:review.body.charges[0].candidates[0].orderId,
   transactionKey:bankKey,revision:review.body.revision};
  assert.equal((await request('/api/amazon-cloud/review/confirm','POST',
   {...selection,revision:'stale-revision'},owner)).status,409,
   'A stale owner review must not save');
  assert.equal((await request('/api/amazon-cloud/review/confirm','POST',
   {...selection,orderId:'123-9999999-9999999'},owner)).status,409,
   'An order missing from this specific bank charge cannot be selected');
  const savedResponse=await request('/api/amazon-cloud/review/confirm','POST',
   selection,owner);
  assert.equal(savedResponse.status,200);
  assert.equal(savedResponse.body.saved,true);
  assert.equal(savedResponse.body.pendingAmazonCharges,0);
  const saved=unseal(file),forecast=unseal(file+'.forecasts');
  assert.deepEqual(saved.transactions,state.transactions,
   'Owner confirmation must not create or edit a Plaid transaction');
  assert.match(forecast.transactionNotes[bankKey],/Fictional cooking thermometer/);
  assert.equal(saved.ledgerAdjustments.predictions.transactionNotes[bankKey],
   forecast.transactionNotes[bankKey]);
  assert.equal(saved.ledgerAdjustments.categoryOverrides[bank.id],'Other',
   'A handwritten category is never overwritten by a product Note');
  assert.equal(saved.ledgerAdjustments.amazonAllocations?.[bank.id],undefined,
   'No item allocation can be created from missing prices');
  assert.equal(saved.ledgerAdjustments.amazonEvidence[bank.id].uncertainty,
   'owner-selected-no-amount-reconciliation');
  assert.equal(saved.amazonCloud.enabled,false,'Automatic paid checks remain OFF');
  assert.equal(saved.amazonCloud.pausedReason,null);
  assert.equal(saved.amazonCloud.runStarts.length,1,'No new paid Agent run was recorded');
  assert.equal(saved.amazonCloud.scanned[bankKey]!==undefined,true);
  assert.equal((await request('/api/amazon-cloud/review','GET',undefined,owner)).status,409,
   'Resolved charge is not offered for repeated owner matching');
  const providerCalls=fs.readFileSync(log,'utf8').trim().split('\n');
  assert(providerCalls.length>=3&&providerCalls.every(url=>
   url.includes('/v1/runs/')&&!url.includes('/v1/automation/')),
   'All TinyFish requests are read-only existing-run lookups');
  console.log('PASS private owner Amazon order confirmation, exact account-scoped Note only, no paid run, immutable bank');
 }finally{child.kill('SIGTERM');fs.rmSync(folder,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
