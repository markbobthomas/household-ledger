'use strict';
// Fictional private-state fixture; no live Plaid credentials or household data.
const assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const worker=require('../pilot/prepared-forecast.cjs');
const feed=require('../pilot/data-source.js');
const model=require('../ledger-data.js');
const tx=require('../planner-transactions.js');
const payments=require('../payment-obligations.js');
const planner=require('../planner-core.js');

const asOf=worker.pacificDate(),after=tx.shift(asOf,5);
const account={id:'fictional-cash-1',name:'Fictional Checking',type:'depository',
 subtype:'checking',itemId:'fictional-item-1',mask:'4321',current:9400,
 available:9400,balanceObservedAt:new Date().toISOString(),currency:'USD'};
const initial={items:[{id:'fictional-item-1',token:'FICTIONAL-TOKEN',
 cursor:null,accountIds:[account.id]}],
 transactions:{'fictional-posted-1':{id:'fictional-posted-1',
  accountId:account.id,itemId:account.itemId,date:asOf,
  merchant:'Fictional Grocery',name:'Fictional Grocery',amount:40,pending:false}},
 accounts:[account],lastSync:new Date().toISOString(),error:null,
 ledgerAdjustments:{predictions:{warnBelow:500}}};
const payload={
 connected:true,account,accounts:[account],lastSync:initial.lastSync,
 transactions:Object.values(initial.transactions),adjustments:initial.ledgerAdjustments
};
const expected=feed.prepare(payload,asOf);
const produced=worker.prepare(payload,asOf);
const browser=planner.materialize(expected.snapshot,model.records(expected.state),
 expected.state.predictions||{},tx,payments,1095,{weekendPolicy:'friday'});
assert.deepEqual(produced.bundle,browser,'Server must use identical canonical projection and bank input');
assert.equal(produced.version,worker.VERSION);
assert.equal(produced.asOf,asOf);
assert.equal(produced.horizon,1095);
assert.equal(JSON.stringify(produced).includes('FICTIONAL-TOKEN'),false);
assert.equal(worker.prepare({connected:false}),null);

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-prepared-'));
const store=path.join(dir,'pilot.enc'),password='fictional-'+crypto.randomBytes(24).toString('hex');
const encryptionKey=crypto.randomBytes(32).toString('hex'),secret=crypto.createHash('sha256').update(encryptionKey).digest();
const encrypt=value=>{
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',secret,iv);
 const data=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))),cipher.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
  data:data.toString('base64')});
};
fs.writeFileSync(store,encrypt(initial),{mode:0o600});
const port=19537,auth='Basic '+Buffer.from('pilot:'+password).toString('base64');
const env={...process.env,PORT:String(port),PILOT_PASSWORD:password,
 PILOT_ENCRYPTION_KEY:encryptionKey,PILOT_STATE_PATH:store,
 PLAID_CLIENT_ID:'test-id',PLAID_SECRET:'test-secret',PLAID_ENV:'sandbox'};
const request=(route,body,authorized=true)=>new Promise((resolve,reject)=>{
 const encoded=body===undefined?null:JSON.stringify(body);
 const req=http.request({hostname:'127.0.0.1',port,path:route,
  method:encoded===null?'GET':'POST',headers:{
   ...(authorized?{Authorization:auth}:{}),
   ...(encoded?{'Content-Type':'application/json','X-Pilot-Action':'1'}:{})}},
  res=>{let raw='';res.on('data',b=>raw+=b);
   res.on('end',()=>{let data;try{data=JSON.parse(raw)}catch{data=null}
    resolve({status:res.statusCode,data,headers:res.headers,raw})})});
 req.on('error',reject);req.end(encoded||undefined);
});
(async()=>{
 const child=spawn(process.execPath,['pilot/server.cjs'],{
  cwd:path.resolve(__dirname,'..'),env,stdio:'ignore'
 });
 try{
  for(let i=0;i<100;i++){try{if((await request('/healthz',false)).status===200)break}catch{}
   await new Promise(r=>setTimeout(r,50))}
  assert.equal((await request('/api/ledger',undefined,false)).status,401,
   'Prepared bundle never bypasses private authentication');
  const first=await request('/api/ledger');
  assert.equal(first.status,200);
  assert.equal(first.headers['cache-control'],'no-store','No bank data browser disk cache');
  assert.deepEqual(first.data.preparedForecast.bundle,JSON.parse(JSON.stringify(browser)));
  assert.equal(first.data.preparedForecast.asOf,asOf);
  assert.equal(first.data.preparedForecast.version,worker.VERSION);
  const same=await request('/api/ledger');
  assert.equal(same.data.preparedForecast.generation,first.data.preparedForecast.generation,
   'Unchanged snapshots reuse a single prepared generation');
  const saved=await request('/api/ledger/forecasts',{predictions:{
   warnBelow:700,futureTransactionAdds:[{
    id:'fictional-next-expense',accountId:account.id,type:'expense',
    date:after,merchant:'Fictional Planned Bill',amount:60
   }]
  }});
  assert.equal(saved.status,200,'Forecast-only edit commits normally');
  const next=await request('/api/ledger');
  assert.ok(next.data.preparedForecast.generation>first.data.preparedForecast.generation,
   'Every accepted client edit invalidates server prepared projections');
  assert.ok(next.data.preparedForecast.bundle.ledger.some(row=>row.merchant==='Fictional Planned Bill'),
   'Subsequent authenticated read sees updated planned payment');
  assert.deepEqual(next.data.transactions,first.data.transactions,
   'Recomputing forecasts cannot change read-only posted bank history');
  assert.equal(JSON.stringify(next.data).includes('FICTIONAL-TOKEN'),false,
   'Prepared projection cannot leak saved bank access tokens');
  assert.equal(fs.readFileSync(store,'utf8').includes('Fictional Planned Bill'),false,
   'Forecast changes never become plaintext server storage');
  console.log('PASS server prepared forecast parity, private auth, repeated reads, client edit invalidation, and no bank mutation');
 }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
