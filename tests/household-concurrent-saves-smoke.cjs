'use strict';
// Deterministic fictional two-device test: no real bank connection or balances.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-concurrent-household-'));
const password='fictional-household-strong-password-2026',secret='fictional-household-encryption-secret-2026';
process.env.PILOT_PASSWORD=password;
process.env.PILOT_ENCRYPTION_KEY=secret;
process.env.PLAID_CLIENT_ID='test-client-id';
process.env.PLAID_SECRET='test-secret';
process.env.PLAID_ENV='sandbox';
process.env.PILOT_STATE_PATH=path.join(temp,'pilot.enc');
const key=crypto.createHash('sha256').update(secret).digest();
const initial={items:[{id:'fictional-item',token:'fictional-only',accountIds:['checking']}],
 accounts:[{id:'checking',name:'Checking',type:'depository',subtype:'checking',current:4000}],
 transactions:{},lastSync:'2026-10-30T12:00:00Z',
 ledgerAdjustments:{predictions:{cashCushion:400,futureRecurringRules:[]}}};
function encrypt(value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const data=Buffer.concat([c.update(Buffer.from(JSON.stringify(value))),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')});}
fs.writeFileSync(process.env.PILOT_STATE_PATH,encrypt(initial),{mode:0o600});
const original=fs.readFileSync(process.env.PILOT_STATE_PATH,'utf8');
const {start}=require('../pilot/server.cjs');
(async()=>{let server;
 try{
  server=await start(0);
  const auth='Basic '+Buffer.from('pilot:'+password).toString('base64');
  const send=async(route,body,revision)=>{
   const response=await fetch('http://127.0.0.1:'+server.address().port+route,{
    method:body===undefined?'GET':'POST',
    headers:{Authorization:auth,'Content-Type':'application/json','X-Pilot-Action':'1',
      ...(revision?{'X-Ledger-Revision':revision}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,revision:response.headers.get('x-ledger-revision'),body:await response.json()};
  };
  const a=await send('/api/ledger'),b=await send('/api/ledger');
  assert.match(a.revision,/^[a-f0-9]{64}$/);
  assert.equal(a.revision,b.revision,'Both devices start from the same revision');
  const p1={cashCushion:500,futureRecurringRules:[]},p2={cashCushion:600,futureRecurringRules:[]};
  const saved=await send('/api/ledger/forecasts',{predictions:p1},a.revision);
  assert.equal(saved.status,200);
  assert.notEqual(saved.revision,a.revision);
  const stale=await send('/api/ledger/forecasts',{predictions:p2},b.revision);
  assert.equal(stale.status,409,'Outdated second device must be rejected');
  assert.equal(stale.body.code,'STALE_LEDGER');
  assert.match(stale.body.error,/Reload/);
  assert.deepEqual((await send('/api/ledger')).body.adjustments.predictions,p1,'No stale overwrite');
  const repeat=await send('/api/ledger/forecasts',{predictions:p1},b.revision);
  assert.equal(repeat.status,200,'Identical lost-response retry is idempotent');
  assert.equal(repeat.revision,saved.revision);
  const fresh=await send('/api/ledger');
  assert.equal((await send('/api/ledger/forecasts',{predictions:p2},fresh.revision)).status,200,
   'Reloading permits a deliberate new edit');
  const oldBulk=await send('/api/ledger/adjustments',{predictions:p1},fresh.revision);
  assert.equal(oldBulk.status,409,'Stale whole-settings replacement must also be blocked');
  assert.deepEqual((await send('/api/ledger')).body.adjustments.predictions,p2);
  const racingRevision=(await send('/api/ledger')).revision;
  const [race1,race2]=await Promise.all([
   send('/api/ledger/forecasts',{predictions:{cashCushion:700,futureRecurringRules:[]}},racingRevision),
   send('/api/ledger/forecasts',{predictions:{cashCushion:800,futureRecurringRules:[]}},racingRevision)]);
  assert.deepEqual([race1.status,race2.status].sort(),[200,409],
   'Two simultaneous stale-snapshot writes cannot silently overwrite each other');
  const last=await send('/api/ledger');
  assert.ok([700,800].includes(last.body.adjustments.predictions.cashCushion));
  assert.equal(fs.readFileSync(process.env.PILOT_STATE_PATH,'utf8'),original,
   'Bank connections, balances and source history must not be rewritten');
  // Forecast and whole-settings requests must be serialized as one household edit queue.
  const mixedRevision=(await send('/api/ledger')).revision;
  const [mixed1,mixed2]=await Promise.all([
   send('/api/ledger/forecasts',{predictions:{cashCushion:900,futureRecurringRules:[]}},mixedRevision),
   send('/api/ledger/adjustments',{predictions:{cashCushion:1000,futureRecurringRules:[]}},mixedRevision)]);
  assert.deepEqual([mixed1.status,mixed2.status].sort(),[200,409],
   'Cross-endpoint edits are serialized before version checks');
  const newest=await send('/api/ledger');
  assert.ok([900,1000].includes(newest.body.adjustments.predictions.cashCushion));
  const sourceFile=JSON.parse(fs.readFileSync(process.env.PILOT_STATE_PATH,'utf8'));
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(sourceFile.iv,'base64'));
  decipher.setAuthTag(Buffer.from(sourceFile.tag,'base64'));
  const source=JSON.parse(Buffer.concat([decipher.update(Buffer.from(sourceFile.data,'base64')),decipher.final()]).toString());
  assert.deepEqual(source.items,initial.items,'Account connections are unchanged');
  assert.deepEqual(source.accounts,initial.accounts,'Bank balances are unchanged');
  assert.deepEqual(source.transactions,initial.transactions,'Bank activity is unchanged');
  await new Promise(resolve=>server.close(resolve));server=null;
  server=await start(0);
  const restored=await send('/api/ledger');
  assert.equal(restored.revision,last.revision,'Revision is stable after a restart');
  assert.deepEqual(restored.body.adjustments.predictions,last.body.adjustments.predictions);
  console.log('PASS: stale-device protection, idempotent retries, serialized races and restart-safe revisions');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
