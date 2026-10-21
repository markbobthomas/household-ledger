'use strict';
// Offline only: separate bank-account removal must NEVER clear another account
// or its encrypted forecast preferences, even for a shared Plaid Item.
const assert=require('node:assert/strict');
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-account-removal-')),
  port=19857,pass=crypto.randomBytes(24).toString('hex'),store=path.join(dir,'bank.enc');
 const env={...process.env,PORT:String(port),PILOT_PASSWORD:pass,
  PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),
  PLAID_CLIENT_ID:'fictional',PLAID_SECRET:'fictional',PLAID_ENV:'sandbox',
  PILOT_STATE_PATH:store,PILOT_REMOVE_TEST:'1',PILOT_REMOVE_FAIL_FIRST:'1'};
 let child;
 const start=()=>spawn(process.execPath,['--require','./tests/pilot-plaid-stub.cjs','pilot/server.cjs'],
  {cwd:path.resolve(__dirname,'..'),env,stdio:'ignore'});
 const api=(route,body,auth=true,action=true)=>new Promise((resolve,reject)=>{
  const payload=body===undefined?null:JSON.stringify(body);
  const r=http.request({hostname:'127.0.0.1',port,path:route,method:payload?'POST':'GET',
   headers:{...(auth?{Authorization:'Basic '+Buffer.from('pilot:'+pass).toString('base64')}:{}),
    ...(payload?{'Content-Type':'application/json',...(action?{'X-Pilot-Action':'1'}:{})}:{})}},res=>{
    let raw='';res.on('data',v=>raw+=v);res.on('end',()=>{
     try{resolve({code:res.statusCode,data:JSON.parse(raw)})}
     catch{resolve({code:res.statusCode,raw})}
    });
   });
  r.on('error',reject);r.end(payload);
 });
 const ready=async()=>{for(let i=0;i<100;i++){
  try{if((await api('/healthz',undefined,false)).code===200)return}
  catch{}
  await new Promise(r=>setTimeout(r,50))
 }throw Error('Private test server did not start')};
 try{
  child=start();await ready();
  assert.equal((await api('/api/accounts/remove',{accountId:'acct-1'},false)).code,401,
   'Unauthenticated removal is forbidden');
  assert.equal((await api('/api/accounts/remove',{accountId:'acct-1'},true,false)).code,403,
   'Account removal requires explicit action header');
  assert.equal((await api('/api/accounts/remove',{accountId:'acct-1'})).code,404);
  const form=await new Promise((resolve,reject)=>{
   http.get({hostname:'127.0.0.1',port,path:'/bank-connect',
    headers:{Authorization:'Basic '+Buffer.from('pilot:'+pass).toString('base64')}},res=>{
    let html='';res.on('data',v=>html+=v);res.on('end',()=>resolve(html));
   }).on('error',reject);
  });
  assert.match(form,/data-remove-account/,'Every connected bank account receives a remove button');
  assert.match(form,/accounts\/remove/,'The button calls the scoped bank API');
  assert.match(form,/Your actual bank account will NOT be closed/);
  assert.equal((await api('/api/exchange',{publicToken:'public-test',accountIds:['acct-1','acct-2']})).code,200);
  let ledger=(await api('/api/ledger')).data;
  assert.equal(ledger.accounts.length,2);
  assert.ok(ledger.transactions.some(t=>t.accountId==='acct-2'&&t.id==='card-from-shared-item'),
   'Card source imported through same Plaid institution');
  assert.ok(ledger.transactions.some(t=>t.accountId==='acct-1'));
  const savedPrefs={primaryAccountId:'acct-1',futureRecurringRules:[
   {id:'income-rule',accountId:'acct-1',merchant:'Employer',amount:3000,frequency:'monthly'},
   {id:'card-rule',accountId:'acct-2',merchant:'Card charge',amount:30,frequency:'monthly'}
  ],paymentRules:{'acct-2':{method:'statement',fromAccountId:'acct-1'}}};
  assert.equal((await api('/api/ledger/forecasts',{predictions:savedPrefs})).code,200);
  assert.equal((await api('/api/ledger/adjustments',{
   categoryOverrides:{'card-from-shared-item':'Shopping'},
   customCategories:[],predictions:savedPrefs
  })).code,200);
  assert.equal((await api('/api/accounts/remove',{accountId:'missing'})).code,404);
  assert.equal((await api('/api/accounts/remove',{accountId:'acct-2',other:'acct-1'})).code,400,
   'Cannot submit a bulk or ambiguous removal');
  let usage=(await api('/api/status')).data.accounts;
  assert.ok(usage.find(a=>a.id==='acct-1').forecastUsage.protected,
   'Checking has saved payroll schedule, card funding role and primary account selection');
  assert.ok(usage.find(a=>a.id==='acct-2').forecastUsage.protected,
   'Card has saved recurring rule, card payment and category edits');
  assert.equal((await api('/api/accounts/remove',{accountId:'acct-2'})).code,409,
   'Never silently remove a card with saved prediction links');
  assert.equal((await api('/api/accounts/remove',{accountId:'acct-1'})).code,409,
   'Never silently remove primary checking with saved prediction links');
  assert.equal((await api('/api/status')).data.accounts.length,2,
   'Attempts to remove protected accounts do not alter bank connections');
  const keepAcct1={primaryAccountId:'acct-1',futureRecurringRules:[
   {id:'income-rule',accountId:'acct-1',originalAccountId:'acct-1',merchant:'Employer',
    amount:3000,frequency:'monthly'}]};
  assert.equal((await api('/api/ledger/adjustments',{
   categoryOverrides:{},customCategories:[],predictions:keepAcct1
  })).code,200,'Owner can explicitly clear unwanted card settings prior to removal');
  usage=(await api('/api/status')).data.accounts;
  assert.equal(usage.find(a=>a.id==='acct-2').forecastUsage.forecastLinks,0);
  assert.equal(usage.find(a=>a.id==='acct-2').forecastUsage.categoryEdits,0);
  assert.equal(usage.find(a=>a.id==='acct-2').forecastUsage.protected,false);
  assert.equal(usage.find(a=>a.id==='acct-1').forecastUsage.protected,true);
  let removed=await api('/api/accounts/remove',{accountId:'acct-2'});
  assert.equal(removed.code,200);
  assert.equal(removed.data.disconnectedInstitution,false,
   'Removing one of two selected accounts must not revoke shared Plaid Item');
  ledger=(await api('/api/ledger')).data;
  assert.deepEqual(ledger.accounts.map(a=>a.id),['acct-1']);
  assert.ok(ledger.transactions.every(t=>t.accountId==='acct-1'),
   'Only the removed account transactions disappear from private Ledger');
  assert.equal(ledger.adjustments.categoryOverrides['card-from-shared-item'],undefined);
  assert.deepEqual(ledger.adjustments.predictions,keepAcct1,
   'Removing an unlinked account never wipes saved payroll on the other account');
  assert.equal((await api('/api/sync',{})).code,200);
  ledger=(await api('/api/ledger')).data;
  assert.equal(ledger.accounts.length,1,'Sync does not reintroduce removed shared-Item account');
  assert.ok(ledger.transactions.some(t=>t.accountId==='acct-1'),
   'Remaining account continues to sync normally');
  assert.equal((await api('/api/exchange',{publicToken:'public-second',accountIds:['acct-2']})).code,200,
   'Previously removed account can be reconnected in a distinct bank link');
  ledger=(await api('/api/ledger')).data;
  assert.deepEqual(ledger.accounts.map(a=>a.id),['acct-1','acct-2']);
  assert.equal(ledger.transactions.filter(t=>t.id==='card-from-shared-item').length,0,
   'Old removed-bank transactions do not leak into the newly connected card');
  assert.equal((await api('/api/accounts/remove',{accountId:'acct-1'})).code,409,
   'Reconnected card does not make the protected main checking account safe to remove');
  const keepAcct2={futureRecurringRules:[
   {id:'card-rule',accountId:'acct-2',originalAccountId:'acct-2',
    merchant:'Card charge',amount:30,frequency:'monthly'}]};
  assert.equal((await api('/api/ledger/forecasts',{predictions:keepAcct2})).code,200,
   'Explicit owner changes can move protection to the remaining account');
  assert.equal((await api('/api/status')).data.accounts.find(a=>a.id==='acct-1')
   .forecastUsage.protected,false);
  assert.equal((await api('/api/status')).data.accounts.find(a=>a.id==='acct-2')
   .forecastUsage.protected,true);
  // Mock Plaid returns one failure for the first revoke. The source must not
  // mutate locally if the provider could not disconnect the final Item.
  const failed=await api('/api/accounts/remove',{accountId:'acct-1'});
  assert.equal(failed.code,400);
  assert.match(failed.data.error,/Plaid request failed/);
  ledger=(await api('/api/ledger')).data;
  assert.equal(ledger.accounts.length,2,'Failed provider revoke preserves all local account data');
  removed=await api('/api/accounts/remove',{accountId:'acct-1'});
  assert.equal(removed.code,200);
  assert.equal(removed.data.disconnectedInstitution,true,
   'Final account removal revokes ONLY that institution');
  ledger=(await api('/api/ledger')).data;
  assert.deepEqual(ledger.accounts.map(a=>a.id),['acct-2']);
  assert.ok(ledger.transactions.every(t=>t.accountId==='acct-2'));
  assert.deepEqual(ledger.adjustments.predictions,keepAcct2,
   'Existing encrypted forecast preferences remain intact after removing a checking account');
  const encrypted=fs.readFileSync(store,'utf8');
  assert.ok(!encrypted.includes('secret-'),'No Plaid token is written in clear text');
  assert.ok(!encrypted.includes('Employer'),'Existing forecast preferences stay encrypted');
  child.kill('SIGTERM');
  await new Promise(r=>child.once('exit',r));
  child=start();await ready();
  ledger=(await api('/api/ledger')).data;
  assert.deepEqual(ledger.accounts.map(a=>a.id),['acct-2'],
   'Removed accounts stay removed after server restart');
  assert.deepEqual(ledger.adjustments.predictions,savedPrefs,
   'Encrypted forecasts survive restart and account removal');
  assert.equal((await api('/api/sync',{})).code,200,'Remaining credit connection still syncs after restart');
  ledger=(await api('/api/ledger')).data;
  assert.deepEqual(ledger.accounts.map(a=>a.id),['acct-2']);
  console.log('PASS individual Plaid account removal: auth, shared Item, failed revoke rollback, encrypted forecast preservation, sync/restart, source isolation');
 }finally{
  if(child&&!child.killed)child.kill('SIGTERM');
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
