'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
(async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'hl-plaid-flow-')),port=19849,pass=crypto.randomBytes(24).toString('hex'),store=path.join(folder,'pilot.enc');
 const env={...process.env,LIVE_PLAID_ENABLED:'1',HOSTED_SANDBOX:'1',PORT:String(port),PILOT_PASSWORD:pass,PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'test',PLAID_SECRET:'test',PLAID_ENV:'sandbox',PILOT_STATE_PATH:store,SANDBOX_TEST_PASSWORD:pass,PILOT_LOGIN_REQUIRED_TEST:'1'};
 const child=spawn(process.execPath,['--require','./tests/pilot-plaid-stub.cjs','sandbox/server.cjs'],{cwd:path.resolve(__dirname,'..'),env,stdio:'ignore'});
 const request=(route,body)=>{
  return new Promise((resolve,reject)=>{
   const b=body===undefined?null:JSON.stringify(body);
   const r=http.request({hostname:'127.0.0.1',port,path:route,method:b?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from('pilot:'+pass).toString('base64'),...(b?{'Content-Type':'application/json','X-Pilot-Action':'1'}:{})}},res=>{
    let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({code:res.statusCode,data:JSON.parse(raw)}))});
   r.on('error',reject);r.end(b);
  });
 };
 try{
  for(let i=0;i<100;i++){try{const r=await request('/api/status');if(r.code===200)break}catch{}await new Promise(r=>setTimeout(r,50))}
  let before=await request('/api/status');assert.equal(before.data.connected,false);
  let token=await request('/api/link-token',{});assert.equal(token.data.link_token,'link-test');
  let connected=await request('/api/exchange',{publicToken:'public-test',accountId:'acct-1'});assert.equal(connected.data.connected,true);
  let status=await request('/api/status');assert.equal(status.data.account.current,321.45,'Exact bank current balance');assert.equal(status.data.account.available,300.10,'Separate available');
  assert.equal(status.data.transactions.length,1);assert.equal(status.data.transactions[0].pending,true);
  assert.equal(JSON.stringify(status.data).includes('acct-2'),false,'Only selected account exposed');
  assert.equal(fs.readFileSync(store,'utf8').includes('secret-test-access-token'),false,'Plaid access token encrypted on disk');
  const pendingOverride=await request('/api/ledger/adjustments',{categoryOverrides:{'pending-1':'Groceries'}});
  assert.equal(pendingOverride.code,200);
  await request('/api/sync',{});
  const carried=await request('/api/ledger');
  assert.equal(carried.data.adjustments.categoryOverrides['posted-1'],'Groceries','Manual category follows replaced pending transaction');
  assert.equal(carried.data.adjustments.categoryOverrides['pending-1'],undefined,'Obsolete pending ID is removed');

  status=await request('/api/status');
  assert.equal(status.data.transactions.length,1,'Pending charge replaced rather than duplicated');
  assert.equal(status.data.transactions[0].pending,false);
  assert.equal(status.data.account.current,321.45,'Transactions never mutate bank-reported balances');
  const full=await request('/api/ledger');
  assert.equal(full.code,200);
  assert.equal(full.data.transactions.length,1,'Shared Ledger receives one selected account, not truncated HTML');
  assert.equal(full.data.account.current,321.45,'Ledger source current balance matches bank');
  const preferences={
   customCategories:['Pet supplies'],
   categoryOverrides:{'posted-1':'Pet supplies'},
   predictions:{monthlyBudgets:{'Pet supplies':200}},
   reviews:{categoryConfirmed:{}},learning:{categoryRules:{}}
  };
  const saved=await request('/api/ledger/adjustments',preferences);
  assert.equal(saved.code,200,'Only non-bank adjustments can be stored');
  let after=await request('/api/ledger');
  const sourceBankRecord=JSON.stringify(after.data.transactions[0]);
  const categorySave=await request('/api/ledger/category',
   {transactionId:'posted-1',category:'Dining'});
  assert.equal(categorySave.code,200,'Private category endpoint accepts one source-scoped override');
  assert.equal(categorySave.data.scope,'category');
  after=await request('/api/ledger');
  assert.equal(after.data.adjustments.categoryOverrides['posted-1'],'Dining');
  assert.equal(after.data.adjustments.predictions.monthlyBudgets['Pet supplies'],200,
   'Changing a category leaves previously saved forecast preferences intact');
  assert.equal(JSON.stringify(after.data.transactions[0]),sourceBankRecord,
   'Scoped category overrides never rewrite Plaid source records');
  assert.equal((await request('/api/ledger/category',{
   transactionId:'not-a-bank-transaction',category:'Dining'})).code,400,
   'Unknown bank transaction IDs cannot create category changes');
  assert.equal((await request('/api/ledger/category',{
   transactionId:'posted-1',category:'Made-up category'})).code,400,
   'Private server validates the category selection');
  assert.equal((await request('/api/ledger/category',{
   transactionId:'posted-1',category:'Pet supplies'})).code,200,
   'Custom categories supported without changing the source bank transaction');
  after=await request('/api/ledger');
  assert.equal(after.data.adjustments.customCategories[0],'Pet supplies');
  assert.equal(after.data.adjustments.categoryOverrides['posted-1'],'Pet supplies');
  assert.equal(after.data.account.current,321.45,'Category changes never recalculate bank balances');
  assert.equal(after.data.transactions[0].amount,10,'Original bank amount remains immutable');
  const illegal=await request('/api/ledger/adjustments',{transactions:[{id:'posted-1',amount:99999}]});
  assert.equal(illegal.code,400,'Server refuses bank transaction modification through settings');
  const unknown=await request('/api/ledger/adjustments',{categoryOverrides:{'fake-bank-transaction':'Shopping'}});
  assert.equal(unknown.code,400,'Server rejects override without matching bank transaction');
  assert.equal(fs.readFileSync(store,'utf8').includes('Pet supplies'),false,'Even custom categories encrypted at rest');
  // A second connected credit institution must not erase checking or preferences.
  assert.equal((await request('/api/link-token',{})).code,200,'Can connect without disconnecting first');
  const linked=await request('/api/exchange',{publicToken:'public-second',accountIds:['acct-2']});
  assert.equal(linked.code,200,'Add a credit account alongside existing checking');
  const household=await request('/api/ledger');
  assert.equal(household.data.accounts.length,2,'Both accounts coexist');
  assert.equal(household.data.accounts.find(a=>a.id==='acct-1').current,321.45,'Checking still bank-reported');
  assert.equal(household.data.accounts.find(a=>a.id==='acct-2').current,900,'Card debt is independent');
  assert.equal(household.data.transactions.find(t=>t.id==='credit-charge-1').accountId,'acct-2','Card purchases retain card account ID');
  assert.equal(household.data.transactions.find(t=>t.id==='credit-payment-1').amount,-100,'Card payment source credit is not an income');
  assert.equal(household.data.transactions.find(t=>t.id==='posted-1').accountId,'acct-1','Checking records unchanged');
  assert.equal(household.data.adjustments.categoryOverrides['posted-1'],'Pet supplies','Manual adjustments retained');
  assert.equal(JSON.stringify(household.data).includes('secret-second-access-token'),false,'No token in response');
  assert.equal(fs.readFileSync(store,'utf8').includes('secret-second-access-token'),false,'Second token encrypted');
  // The banking token remains encrypted and unchanged when Plaid requires
  // bank sign-in; no bank records, source balances or forecasts are cleared.
  const savedBeforeRepair=await request('/api/ledger');
  const loginFailed=await request('/api/sync',{});
  assert.equal(loginFailed.code,409,'Expired bank login returns a recoverable conflict');
  assert.equal(loginFailed.data.code,'ITEM_LOGIN_REQUIRED');
  assert.equal(loginFailed.data.reconnectAccountId,'acct-1');
  const needsRepair=await request('/api/status');
  assert.equal(needsRepair.data.accounts.find(a=>a.id==='acct-1').needsReconnect,true);
  assert.equal(needsRepair.data.accounts.find(a=>a.id==='acct-2').needsReconnect,false);
  const stale=await request('/api/ledger');
  assert.deepEqual(stale.data.transactions,savedBeforeRepair.data.transactions,
   'Failed refresh retains the original immutable bank transaction snapshot');
  assert.deepEqual(stale.data.adjustments,savedBeforeRepair.data.adjustments,
   'Failed refresh does not erase category edits or saved predictions');
  assert.deepEqual(stale.data.reconnectAccounts,['acct-1']);
  assert.equal(fs.readFileSync(store,'utf8').includes('secret-test-access-token'),false);
  const invalid=await request('/api/link-token',{reconnectAccountId:'some-other-bank'});
  assert.equal(invalid.code,404,'Cannot request update mode for an unconnected bank');
  const invalidShape=await request('/api/link-token',{reconnectAccountId:'acct-1',unknown:'value'});
  assert.equal(invalidShape.code,400,'Update-mode token requests accept only the selected account');
  const repaired=await request('/api/link-token',{reconnectAccountId:'acct-1'});
  assert.equal(repaired.code,200);
  assert.deepEqual(repaired.data,{link_token:'link-update-test',mode:'update'});
  // Plaid update mode does NOT exchange a new public token. A fresh sync after
  // reauthorization retains the same selected IDs and account-specific edits.
  assert.equal((await request('/api/sync',{})).code,200,
   'Successful reauthorization restores the original Items without new connection IDs');
  const finalStatus=await request('/api/status');
  assert.equal(finalStatus.data.accounts.length,2);
  assert.equal(finalStatus.data.accounts.every(a=>!a.needsReconnect),true);
  const restored=await request('/api/ledger');
  assert.equal(restored.data.reconnectAccounts.length,0);
  assert.equal(restored.data.adjustments.categoryOverrides['posted-1'],'Pet supplies');
  assert.equal(restored.data.accounts.find(a=>a.id==='acct-1').current,321.45);
  assert.equal(restored.data.accounts.find(a=>a.id==='acct-2').current,900);
  assert.equal(JSON.stringify(restored.data).includes('secret-test-access-token'),false);
  await request('/api/disconnect',{});
  status=await request('/api/status');assert.equal(status.data.connected,false);assert.equal(status.data.transactions.length,0);
  console.log('PASS Plaid Link exchange, one selected account, exact reported bank balances, encrypted token, pending-posted sync and disconnect');
 }finally{child.kill();fs.rmSync(folder,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
