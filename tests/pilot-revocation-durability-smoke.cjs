'use strict';
// Fictional-only failure injection for the irreversible Plaid revoke boundary.
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),
 path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-revocation-'));
const password='fictional-safe-revocation-password',secret='fictional-safe-revocation-encryption-key';
const encryptionKey=crypto.createHash('sha256').update(secret).digest();
let active=null,port=19963;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function decrypt(file){
 const d=JSON.parse(fs.readFileSync(file,'utf8')),
  cipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey,Buffer.from(d.iv,'base64'));
 cipher.setAuthTag(Buffer.from(d.tag,'base64'));
 return JSON.parse(Buffer.concat([
  cipher.update(Buffer.from(d.data,'base64')),cipher.final()
 ]).toString());
}
async function request(url,body){
 const data=body===undefined?null:JSON.stringify(body);
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:url,method:data?'POST':'GET',
   headers:{Authorization:'Basic '+Buffer.from('pilot:'+password).toString('base64'),
    ...(data?{'X-Pilot-Action':'1','Content-Type':'application/json'}:{})}},res=>{
    let result='';res.on('data',part=>result+=part);
    res.on('end',()=>{
     try{resolve({code:res.statusCode,data:JSON.parse(result)})}catch(error){reject(error)}
    });
   });
  req.on('error',reject);req.end(data);
 });
}
async function stop(){
 if(!active)return;
 const child=active;active=null;
 if(child.exitCode!==null)return;
 child.kill('SIGTERM');
 await new Promise(resolve=>{
  child.once('exit',resolve);
  const kill=setTimeout(()=>child.kill('SIGKILL'),3000);
  kill.unref();
 });
}
async function start(store,mode){
 port++;
 const env={...process.env,PORT:String(port),PILOT_PASSWORD:password,
  PILOT_ENCRYPTION_KEY:secret,PLAID_CLIENT_ID:'fictional',PLAID_SECRET:'fictional',
  PLAID_ENV:'sandbox',PILOT_STATE_PATH:store,
  PILOT_REMOVE_TEST:'1',PILOT_TEST_REVOKE_MARKER:store+'.revokes',
  ...(mode?{PILOT_DISCONNECT_DISK_FAILURE_TEST:mode}:{})};
 active=spawn(process.execPath,['--require','./tests/pilot-plaid-stub.cjs','pilot/server.cjs'],
  {cwd:root,env,stdio:'ignore'});
 for(let n=0;n<120;n++){
  try{const r=await request('/healthz');if(r.code===200)return}catch{}
  await pause(40);
 }
 throw Error('Fictional bank server did not start');
}
async function connected(accounts){
 const x=await request('/api/exchange',{publicToken:'public-test',accountIds:accounts});
 assert.equal(x.code,200,'Fictional Plaid Item imported');
}
async function runCase(name,mode,all){
 const store=path.join(folder,name+'.enc'),marker=store+'.revokes';
 await start(store,mode);
 await connected(all?['acct-1','acct-2']:['acct-1']);
 const before=await request('/api/ledger');
 assert.equal(before.data.connected,true);
 if(all){
  assert.equal((await request('/api/ledger/forecasts',{predictions:{
   cashCushion:420,futureRecurringRules:[]
  }})).code,200);
  assert.equal(fs.existsSync(store+'.forecasts'),true);
 }
 const response=await request(all?'/api/disconnect':'/api/accounts/remove',
  all?{}:{accountId:'acct-1'});
 const attempts=fs.existsSync(marker)?fs.readFileSync(marker,'utf8').trim().split('\n').length:0;
 if(mode==='before'){
  assert.equal(response.code,400,'Failed local commit refuses provider revoke');
  assert.equal(attempts,0,'No provider call before durable bank-state commit');
  const original=await request('/api/ledger');
  assert.equal(original.data.connected,true,'Old active bank snapshot remains');
  assert.deepEqual(original.data.transactions,before.data.transactions,
   'Provider source facts remain unchanged after failed local write');
  assert.equal(decrypt(store).pendingRevocations?.length||0,0);
  if(all)assert.equal(fs.existsSync(store+'.forecasts'),true,
   'Failed household disconnect leaves independent forecasts intact');
  await stop();await start(store,null);
  assert.equal((await request('/api/ledger')).data.connected,true,
   'Restart retains existing account after pre-commit failure');
 }else{
  assert.equal(response.code,202,'Post-revoke cleanup failure stays recoverable');
  assert.equal(attempts,1,'Provider call follows durable local removal');
  const removed=await request('/api/ledger');
  assert.equal(removed.data.connected,false,'Revoked bank Item is not active');
  assert.deepEqual(removed.data.accounts,[]);
  assert.deepEqual(removed.data.transactions,[]);
  assert.equal(removed.data.remoteDisconnectPending,1);
  const saved=decrypt(store);
  assert.equal(saved.items.length,0);
  assert.equal(saved.accounts.length,0);
  assert.equal(saved.pendingRevocations.length,1,'Encrypted retry intent survives cleanup failure');
  assert.equal(fs.readFileSync(store,'utf8').includes('secret-test-access-token'),false,
   'Plaid credentials remain encrypted at rest');
  if(all){
   assert.equal(fs.existsSync(store+'.forecasts'),false,
    'Household disconnect cleared the old forecast file');
   assert.equal(saved.forecastResetRequired,undefined,
    'Forecast reset marker completed before provider revoke');
  }
  await stop();await start(store,null);
  let clean=false;
  for(let n=0;n<120;n++){
   if((decrypt(store).pendingRevocations||[]).length===0){clean=true;break}
   await pause(40);
  }
  assert.equal(clean,true,'Restart retries provider cleanup and commits the result');
  assert.equal((await request('/api/ledger')).data.connected,false);
  if(all){
   const fresh=await request('/api/exchange',{
    publicToken:'public-second',accountIds:['acct-2']});
   assert.equal(fresh.code,200,'New household can connect after cleanup');
   const next=await request('/api/ledger');
   assert.equal(next.data.connected,true);
   assert.equal(next.data.adjustments.predictions?.cashCushion,undefined,
    'Old household forecasts do not attach to newly linked bank');
  }
 }
 await stop();
}
(async()=>{
 try{
  await runCase('remove-precommit','before',false);
  await runCase('remove-postrevoke','after',false);
  await runCase('disconnect-precommit','before',true);
  await runCase('disconnect-postrevoke','after',true);
  console.log('PASS Plaid durability: precommit refusal, post-revoke quarantine, restart recovery, encrypted data and forecast reset');
 }finally{
  await stop();
  fs.rmSync(folder,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
