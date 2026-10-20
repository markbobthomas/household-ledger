'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'household-forecast-test-'));
const password='isolated-forecast-test-password-2026';
const encryption='isolated-secret-for-private-prediction-test';
const statePath=path.join(temp,'pilot.enc');
process.env.PILOT_PASSWORD=password;
process.env.PILOT_ENCRYPTION_KEY=encryption;
process.env.PLAID_CLIENT_ID='test-only-not-real';
process.env.PLAID_SECRET='test-only-not-real';
process.env.PILOT_STATE_PATH=statePath;
process.env.PLAID_ENV='sandbox';
const key=crypto.createHash('sha256').update(encryption).digest();
const transactions={'bank-tx':{id:'bank-tx',accountId:'checking',
 date:'2026-09-15',merchant:'Mortgage Servicer',amount:2000,pending:false}};
const initial={items:[{id:'item-1',token:'dummy-test-token',accountIds:['checking']}],
 accounts:[{id:'checking',name:'Checking',type:'depository',current:3000,available:3000}],
 transactions,lastSync:'2026-10-19T10:00:00Z',error:null,
 ledgerAdjustments:{
  categoryOverrides:{'removed-transaction':'Housing'}, // deliberately stale
  predictions:{cashCushion:500,futureRecurringRules:[]},
  reviews:{categoryConfirmed:{}},learning:{categoryRules:{}}
 }};
function encrypt(data){
 const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const bytes=Buffer.concat([c.update(Buffer.from(JSON.stringify(data))),c.final()]);
 fs.writeFileSync(statePath,JSON.stringify({iv:iv.toString('base64'),
  tag:c.getAuthTag().toString('base64'),data:bytes.toString('base64')}),{mode:0o600});
}
function decrypt(){
 const o=JSON.parse(fs.readFileSync(statePath,'utf8')),
 d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(o.iv,'base64'));
 d.setAuthTag(Buffer.from(o.tag,'base64'));
 return JSON.parse(Buffer.concat([d.update(Buffer.from(o.data,'base64')),d.final()]).toString());
}
encrypt(initial);
const {start}=require('../pilot/server.cjs');
(async()=>{
 let server;
 try{
  server=await start(0);
  const url='http://127.0.0.1:'+server.address().port;
  const auth='Basic '+Buffer.from('pilot:'+password).toString('base64');
  const request=async(route,body)=>{
   const r=await fetch(url+route,{method:body===undefined?'GET':'POST',
    headers:{Authorization:auth,'X-Pilot-Action':'1','Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:r.status,json:await r.json()};
  };
  const rule={id:'manual|checking|mortgage',kind:'event',type:'expense',frequency:'monthly',
   accountId:'checking',merchant:'Mortgage Servicer',amount:2000,anchorDate:'2026-11-15'};
  const planned={cashCushion:350,futureRecurringRules:[rule]};
  const legacy=await request('/api/ledger/adjustments',{
   categoryOverrides:initial.ledgerAdjustments.categoryOverrides,predictions:planned});
  assert.equal(legacy.status,400,'Legacy full-adjustments request is blocked by stale category overrides');
  assert.match(legacy.json.error,/Invalid category override/);
  const saved=await request('/api/ledger/forecasts',{predictions:planned});
  assert.equal(saved.status,200,'Dedicated forecast save is independent from bank categorizations');
  assert.deepEqual(saved.json,{saved:true,scope:'predictions'});
  const after=await request('/api/ledger');
  assert.equal(after.status,200);
  assert.deepEqual(after.json.adjustments.predictions,planned,'Forecast rule is available after save');
  assert.deepEqual(after.json.adjustments.categoryOverrides,initial.ledgerAdjustments.categoryOverrides,
   'Unrelated category overrides are preserved, not resubmitted or erased');
  const stored=decrypt();
  assert.deepEqual(stored.transactions,transactions,'Plaid transaction source is byte-for-byte unchanged');
  assert.deepEqual(stored.accounts,initial.accounts,'Bank balances are unchanged');
  assert.deepEqual(stored.items,initial.items,'Plaid credentials/connections are unchanged');
  assert.deepEqual(stored.ledgerAdjustments.predictions,planned,
   'Saved predictions persisted in encrypted file');
  assert.doesNotMatch(fs.readFileSync(statePath,'utf8'),/Mortgage Servicer/,
   'Forecast and bank history are encrypted at rest');
  const invalid=await request('/api/ledger/forecasts',{predictions:planned,transactions:[]});
  assert.equal(invalid.status,400,'Forecast endpoint rejects attempted source-bank edits');
  const array=await request('/api/ledger/forecasts',{predictions:[]});
  assert.equal(array.status,400,'Only a prediction-settings object is allowed');
  assert.deepEqual(decrypt().transactions,transactions);
  console.log('PASS forecast-only persistence survives stale bank categories; old adjustments rejected; encrypted rule survives reload; bank data and Plaid connections unchanged; invalid source edits blocked');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
