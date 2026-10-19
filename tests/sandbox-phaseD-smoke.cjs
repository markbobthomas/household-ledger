'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createServer}=require('../sandbox/server.cjs');
const {createService,remoteTransport}=require('../sandbox/plaid-service.cjs');
const {fixtureTransport}=require('../sandbox/fixture.cjs');
const {verifyPlaidWebhook}=require('../sandbox/webhook.cjs');
const M=require('../ledger-data.js');
const A=require('../accounting.js');
(async()=>{
 const service=createService({request:fixtureTransport(),mode:'fixture'});
 const server=createServer({service});
 const address=await server.listen(0),base='http://127.0.0.1:'+address.port;
 const call=async(route,payload,headers={})=>{
  const res=await fetch(base+'/api/sandbox/'+route,payload===undefined?{}:{
   method:'POST',headers:{'Content-Type':'application/json','X-Household-Sandbox':'1',...headers},
   body:JSON.stringify(payload)});
  return {status:res.status,data:await res.json()};
 };
 try{
  const stat=await call('status');
  assert.equal(stat.data.mode,'fixture');
  assert.equal(stat.data.credentialConfigured,false);
  assert.equal(stat.data.connected,false);
  assert.equal((await call('link-token',{})).status,400,'Fixture mode never claims a real Plaid Link session');
  let res=await call('connect',{institutionId:'ins_109508',profile:'standard'});
  assert.equal(res.status,200);
  assert.equal(res.data.accountCount,3);
  assert.equal(res.data.transactionCount,8);
  assert.equal(res.data.sync.pages,2,'Realistic pagination completes before commit');
  assert.equal(JSON.stringify(res).includes('access_fixture'),false,'Tokens not returned');
  const a=res.data.itemId;
  res=await call('connect',{institutionId:'ins_109509',profile:'dynamic'});
  assert.equal(res.data.accountCount,3);const b=res.data.itemId;
  assert.notEqual(a,b);
  res=await call('status');
  assert.equal(res.data.items.length,2);
  assert.equal(JSON.stringify(res.data).includes('access_fixture'),false);
  const snapshot=(await call('snapshot')).data;
  assert.equal(snapshot.accounts.length,6);
  assert.equal(snapshot.items.reduce((n,i)=>n+i.transactions.length,0),16);
  assert.equal(JSON.stringify(snapshot).includes('access_fixture'),false);
  assert.equal(snapshot.accounts.filter(x=>x.accountType==='credit').length,2);
  assert.ok(snapshot.items.every(i=>i.transactions.some(t=>t.pending)));
  let state=M.migrate({transactions:[]});
  for(const item of snapshot.items)M.applyPlaidSyncPages(state,{itemId:item.itemId,
   accounts:item.accounts,pages:[{added:item.transactions,modified:[],removed:[],
    hasMore:false,nextCursor:'test:'+item.itemId,simulated:true}]});
  assert.equal(state.transactions.length,16);
  const grouped=M.accountingView(state);
  assert.equal(grouped.summary.matchedTransfers,4,'Card settlements and checking-savings transfers matched within each institution');
  assert.equal(grouped.summary.income,4900);
  assert.equal(grouped.summary.spending,143.8,'Card groceries less refunds across 2 institutions');
  assert.ok(state.transactions.every(t=>t.source?.simulated),'Sandbox transactions marked simulated');
  const old=state.transactions.length;
  res=await call('sync',{});
  assert.equal(res.data.complete,true);
  assert.equal((await call('snapshot')).data.items.reduce((n,i)=>n+i.transactions.length,0),old,'Idempotent incremental sync');
  const before=(await call('snapshot')).data;
  res=await call('refresh',{itemId:a});
  assert.equal(res.status,200);
  res=await call('sync',{itemId:a});
  assert.equal(res.data.complete,true);
  const after=(await call('snapshot')).data;
  const rows=after.items.find(i=>i.itemId===a).transactions;
  assert.equal(rows.some(t=>t.transaction_id===a+'-pending'),false,'Pending row tombstoned');
  assert.equal(rows.some(t=>t.pending_transaction_id===a+'-pending'),true,'Posted replacement retained');
  assert.equal(after.items.find(i=>i.itemId===b).transactions.length,8,'Unrelated institution unchanged');
  res=await call('connect',{institutionId:'bank-of-real-money'});
  assert.equal(res.status,400,'Only known simulated institutions accepted');
  res=await call('disconnect',{itemId:a});
  assert.equal(res.data.disconnected,true);
  assert.equal((await call('snapshot')).data.accounts.length,3);
  await call('disconnect',{itemId:b});
  assert.equal((await call('status')).data.connected,false);
  const forbidden=await fetch(base+'/api/sandbox/connect',{method:'POST',
   headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(forbidden.status,403,'Cross-site posts without same-origin marker rejected');
  const cross=await call('connect',{institutionId:'ins_109508'}, {Origin:'https://evil.example'});
  assert.equal(cross.status,403,'Cross-origin requests blocked');
  const staticFile=await fetch(base+'/index.html');
  assert.equal(staticFile.status,200);
  assert.match(await staticFile.text(),/Household Ledger/);
  assert.equal((await fetch(base+'/.git/config')).status,404,'Secrets/internal files are not served');
  assert.equal((await fetch(base+'/sandbox/server.cjs')).status,404,'Server code cannot be downloaded');
  assert.equal((await fetch(base+'/PLAID_INTEGRATION_PLAN.md')).status,404);
  assert.equal((await fetch(base+'/sandbox/sandbox-ui.js')).status,200);
  console.log('PASS: Phase D local Sandbox service, 2 fake institutions, 6 accounts, 16 transactions, card reconciliation, atomic source, pending-posted, secure loopback, disconnect');
 }finally{await server.close()}
 // Plaid-shaped sync retry on mid-pagination mutation; never skip pages.
 let attempts=0,pendingCursor=null;
 const transport=async(path,payload)=>{
  if(path==='/sandbox/public_token/create')return {public_token:'public-sandbox-test'};
  if(path==='/item/public_token/exchange')return {access_token:'access-sandbox-secret',item_id:'item_sandbox_123'};
  if(path==='/transactions/sync'){
   pendingCursor=payload.cursor||null;
   if(!payload.cursor){attempts++;return {added:[],modified:[],removed:[],has_more:true,next_cursor:'page1'};}
   if(attempts===1)throw Object.assign(Error('Pagination changed'),{code:'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'});
   return {added:[{transaction_id:'t1',account_id:'a1',amount:15,date:'2026-10-10',name:'Coffee'}],
    modified:[],removed:[],has_more:false,next_cursor:'page2'};
  }
  if(path==='/accounts/get')return {accounts:[{account_id:'a1',name:'Checking',
   type:'depository',subtype:'checking',balances:{current:500,available:450,iso_currency_code:'USD'}}]};
  if(path==='/item/remove')return {};
  throw Error('Unexpected transport route: '+path);
 };
 const provider=createService({request:transport,mode:'plaid'});
 const p=await provider.connectTest('ins_109508');
 assert.equal(p.needsRetry,undefined);
 assert.equal(attempts,2,'Mutation during page 2 restarts pagination from original cursor');
 assert.equal(provider.snapshot().items[0].transactions.length,1);
 assert.equal(provider.snapshot().items[0].transactionCount,1);
 assert.equal(pendingCursor,'page1');
 const fail=createService({request:async(path,body)=>{
  if(path==='/sandbox/public_token/create')return {public_token:'public-sandbox-test'};
  if(path==='/item/public_token/exchange')return {access_token:'access-private',item_id:'item_failed'};
  if(path==='/transactions/sync')return {added:[],modified:[],removed:[],has_more:true,next_cursor:'x'};
  if(path==='/accounts/get')return {accounts:[]};
  return {};
 },mode:'plaid'});
 const attempt=await fail.connectTest('ins_109508');
 assert.equal(attempt.needsRetry,true);
 assert.equal(fail.snapshot().items[0].transactionCount,0,'Unfinished pagination cannot publish partial sources');
 // Plaid HTTP transport hardcoded to sandbox host and keeps secret off client responses.
 let received={};
 const remote=remoteTransport({clientId:'id',secret:'test_secret',fetchImpl:async(url,request)=>{
  received={url,request:JSON.parse(request.body)};
  return {ok:true,json:async()=>({accounts:[]})};
 }});
 await remote('/accounts/get',{access_token:'server-only'});
 assert.equal(received.url,'https://sandbox.plaid.com/accounts/get');
 assert.equal(received.request.secret,'test_secret');
 await assert.rejects(remote('https://production.plaid.com/accounts/get',{}),/Invalid Plaid endpoint/);
 // Sign a real ES256/sha256 JWT fixture; tampered, expired and unsigned bodies are rejected.
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
 const publicJwk={...publicKey.export({format:'jwk'}),kid:'kid-1',alg:'ES256',use:'sig'};
 const body='{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE","item_id":"i"}';
 const header=Buffer.from(JSON.stringify({alg:'ES256',kid:'kid-1'})).toString('base64url');
 const payload=Buffer.from(JSON.stringify({iat:Math.floor(Date.now()/1000),
  request_body_sha256:crypto.createHash('sha256').update(body).digest('hex')})).toString('base64url');
 const toSign=header+'.'+payload;
 const signed=crypto.sign('sha256',Buffer.from(toSign),{key:privateKey,dsaEncoding:'ieee-p1363'});
 const jwt=toSign+'.'+signed.toString('base64url');
 const getKey=async()=>({key:publicJwk});
 assert.equal((await verifyPlaidWebhook(body,jwt,getKey)).webhook_type,'TRANSACTIONS');
 await assert.rejects(verifyPlaidWebhook(body+' ',jwt,getKey),/body mismatch/);
 await assert.rejects(verifyPlaidWebhook(body,toSign+'.'+(signed.toString('base64url')[0]==='A'?'B':'A')+signed.toString('base64url').slice(1),getKey),/signature rejected/);
 await assert.rejects(verifyPlaidWebhook(body,jwt,getKey,Date.now()+3600000),/expired/);
 console.log('PASS: Phase D Plaid paging restart, incomplete rollback, Sandbox-only transport and ES256 webhook signature/body/replay verification');
})().catch(err=>{console.error(err);process.exitCode=1});
