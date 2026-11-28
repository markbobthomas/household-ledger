'use strict';
// Fictional private-server test: a pre-existing completed, owner-consented
// payment-first browser result is processed without starting another Agent.
// The first verified payment-to-products link unlocks future scheduled runs;
// a complete but unlinked report MUST NOT unlock automatic spending.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),
 fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 http=require('node:http'),{spawn}=require('node:child_process');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-amazon-payment-pilot-')),
 port=19915,secret=crypto.randomBytes(32).toString('hex'),
 key=crypto.createHash('sha256').update(secret).digest(),
 password='fictional-amazon-payment-pilot-password-123',
 runId='12345678-1234-1234-1234-123456789012',
 createdAt=new Date().toISOString(),today=createdAt.slice(0,10),
 orderDate=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
const tx={id:'fictional-payment-charge',accountId:'fictional-card',
 date:today,merchant:'AMZN Mktp',name:'AMZN Mktp',amount:47.37,pending:false};
const txKey='bank:'+JSON.stringify([tx.accountId,tx.id]);
const encrypt=x=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),
 cipher=Buffer.concat([c.update(Buffer.from(JSON.stringify(x))),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),
 data:cipher.toString('base64')})};
const decrypt=file=>{const x=JSON.parse(fs.readFileSync(file,'utf8'));
 const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(x.iv,'base64'));
 d.setAuthTag(Buffer.from(x.tag,'base64'));
 return JSON.parse(Buffer.concat([d.update(Buffer.from(x.data,'base64')),d.final()]).toString())};
const req=(route,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
 const raw=body===undefined?null:JSON.stringify(body);
 const r=http.request({hostname:'127.0.0.1',port,path:route,method,
  headers:{...headers,...(raw?{'Content-Type':'application/json','X-Pilot-Action':'1'}:{})}},
  res=>{let s='';res.on('data',v=>s+=v);
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,
    data:JSON.parse(s||'{}')}))});
 r.on('error',reject);r.end(raw);
});
async function verify(label,scope,expectedPilot){
 const file=path.join(folder,label+'.enc'),runFile=path.join(folder,label+'.json'),
  log=path.join(folder,label+'.log');
 const state={items:[{id:'fictional-item',token:'fictional-plaid-token',accountIds:[tx.accountId]}],
  accounts:[{id:tx.accountId,itemId:'fictional-item',name:'Fictional card',
   type:'credit',subtype:'credit card',current:100}],
  transactions:{[tx.id]:tx},ledgerAdjustments:{predictions:{},
   categoryOverrides:{[tx.id]:'Other'}},
  amazonCloud:{apiKey:'fictional-tinyfish-key-for-tests',
   profileId:'prof_fictional_amazon123',enabled:true,
   baselineAt:createdAt,runStarts:[createdAt],
   run:{id:runId,status:'running',manual:true,strategy:'payment-first-v1',
    startedAt:createdAt,targets:[txKey]}}};
 const report={status:'COMPLETED',run_id:runId,created_at:createdAt,
  profile_id:'prof_fictional_amazon123',profile_attached:true,
  goal:'Read only Amazon.com Your Payments > Transactions',
  result:{signedIn:true,complete:true,payments:[{
   transactionDate:orderDate,amountCents:4737,
   orderId:'123-1234567-1234567',kind:'charge',productScope:scope,
   titles:['Fictional cast-iron towel rail','Fictional table placemat']
  }]}};
 fs.writeFileSync(file,encrypt(state));fs.writeFileSync(runFile,JSON.stringify(report));
 const env={...process.env,PORT:String(port),PILOT_STATE_PATH:file,
  PILOT_PASSWORD:password,PILOT_ENCRYPTION_KEY:secret,
  PLAID_ENV:'sandbox',PLAID_CLIENT_ID:'fictional-plaid-id',
  PLAID_SECRET:'fictional-plaid-secret',TINYFISH_MOCK_RESULT:runFile,
  TINYFISH_MOCK_LOG:log,
  NODE_OPTIONS:'--require '+path.resolve(__dirname,'amazon-cloud-fetch-mock.cjs')};
 const child=spawn(process.execPath,['pilot/server.cjs'],
  {cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',b=>process.stderr.write(b));
 try{
  let done=false;
  for(let i=0;i<180;i++){
   try{
    if((await req('/healthz')).status===200){
     const s=decrypt(file);
     if(s.amazonCloud.run===null){done=true;break}
    }
   }catch{}
   await new Promise(r=>setTimeout(r,45));
  }
  assert(done,'Payment-first run must finish without an extra paid Agent call');
  const saved=decrypt(file);
  assert.equal(saved.amazonCloud.paymentPilotVersion=== 'payment-first-v1',expectedPilot,
   'Only a real uniquely linked payment-to-shipment product match validates the new automatic strategy');
  assert.equal(saved.amazonCloud.lastPaymentCount,1);
  assert.equal(saved.amazonCloud.lastPaymentMatches,expectedPilot?1:0);
  assert.equal(saved.amazonCloud.lastMatched,expectedPilot?1:0);
  assert.equal(saved.amazonCloud.lastPossible,expectedPilot?0:1);
  assert.equal(saved.amazonCloud.enabled,true,
   'Prior automatic update preference is retained but unverified method remains gated');
  assert.equal(saved.amazonCloud.runStarts.length,1,
   'No new paid browser start during completion/status lookup');
  assert.deepEqual(saved.transactions,state.transactions,'Plaid facts remain immutable');
  assert.equal(saved.ledgerAdjustments.categoryOverrides[tx.id],'Other',
   'Manual category remains protected');
  assert.equal(saved.ledgerAdjustments.amazonAllocations?.[tx.id],undefined,
   'No invented item prices/allocations from actual payment totals');
  const note=decrypt(file+'.forecasts').transactionNotes[txKey];
  assert.match(note,expectedPilot?/^Amazon: Fictional cast-iron towel rail/:
   /^Possible Amazon: Fictional cast-iron towel rail/);
  const login=await req('/auth/login','POST',{password});assert.equal(login.status,200);
  const owner={Cookie:login.headers['set-cookie'].find(c=>c.startsWith('__Host-ledger_session='))};
  const status=await req('/api/amazon-cloud','GET',undefined,owner);
  assert.equal(status.status,200);
  assert.equal(status.data.paymentPilotRequired,!expectedPilot);
  assert.equal(status.data.lastPaymentCount,1);
  assert.equal(status.data.lastPaymentMatches,expectedPilot?1:0);
  assert.equal((await req('/api/amazon-cloud')).status,401,
   'Unauthenticated users cannot see a payment-first summary');
  const calls=fs.readFileSync(log,'utf8').trim().split('\n');
  assert(calls.length>0&&calls.every(url=>url.includes('/v1/runs/')&&
   !url.includes('run-async')),'Tests must not start a paid browser Agent');
 }finally{
  child.kill('SIGTERM');
  await new Promise(resolve=>child.once('exit',resolve));
 }
}
(async()=>{
 await verify('confirmed-shipment','payment',true);
 await verify('order-only','order',false);
 console.log('PASS private Amazon payment-first pilot: exact charge Note, order-only caution, automatic gate, no real Agent or banking edits');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
 fs.rmSync(folder,{recursive:true,force:true});
});
