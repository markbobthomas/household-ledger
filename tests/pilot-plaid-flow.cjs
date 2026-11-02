'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
(async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'hl-plaid-flow-')),port=19849,pass=crypto.randomBytes(24).toString('hex'),store=path.join(folder,'pilot.enc');
 const env={...process.env,LIVE_PLAID_ENABLED:'1',HOSTED_SANDBOX:'1',PORT:String(port),PILOT_PASSWORD:pass,PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'test',PLAID_SECRET:'test',PLAID_ENV:'sandbox',PILOT_STATE_PATH:store,SANDBOX_TEST_PASSWORD:pass,PILOT_LOGIN_REQUIRED_TEST:'1',PILOT_INVALID_FIELD_TEST:'1',RENDER_GIT_COMMIT:'a'.repeat(40)};
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
  assert.equal(before.data.diagnostics.environment,'sandbox');
  assert.equal(before.data.diagnostics.requestHost,'https://sandbox.plaid.com');
  assert.equal(before.data.diagnostics.clientIdEnding,null,
   'Never reveal an entire short client ID; real IDs expose only six characters');
  assert.equal(before.data.diagnostics.deployCommit,'a'.repeat(40));
  assert.equal(before.data.diagnostics.lastSyncAttempt,null,'A page read does not pretend to contact Plaid');
  assert.equal(before.data.diagnostics.lastPlaidCall,null);
  let token=await request('/api/link-token',{});assert.equal(token.data.link_token,'link-test');
  let connected=await request('/api/exchange',{publicToken:'public-test',accountId:'acct-1'});assert.equal(connected.data.connected,true);
  let status=await request('/api/status');assert.equal(status.data.account.current,321.45,'Exact bank current balance');assert.equal(status.data.account.available,300.10,'Separate available');
  assert.equal(status.data.transactions.length,1);assert.equal(status.data.transactions[0].pending,true);
  assert.equal(JSON.stringify(status.data).includes('acct-2'),false,'Only selected account exposed');
  assert.equal(fs.readFileSync(store,'utf8').includes('secret-test-access-token'),false,'Plaid access token encrypted on disk');
  const beforeOriginalDuplicate=await request('/api/ledger');
  const originalDuplicate=await request('/api/exchange',{publicToken:'public-test',accountId:'acct-1'});
  assert.equal(originalDuplicate.code,409,'Same Item returned by exchange must not be removed');
  assert.equal(originalDuplicate.data.code,'ALREADY_CONNECTED');
  const afterOriginalDuplicate=await request('/api/ledger');
  assert.deepEqual(afterOriginalDuplicate.data.accounts,beforeOriginalDuplicate.data.accounts);
  assert.deepEqual(afterOriginalDuplicate.data.transactions,beforeOriginalDuplicate.data.transactions);
  assert.deepEqual(afterOriginalDuplicate.data.adjustments,beforeOriginalDuplicate.data.adjustments);
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
  const beforeNewDuplicate=await request('/api/ledger');
  const newDuplicate=await request('/api/exchange',{
   publicToken:'public-duplicate-new',accountId:'acct-duplicate-new'});
  assert.equal(newDuplicate.code,409,'New Plaid account ID for same bank must not duplicate');
  assert.match(newDuplicate.data.error,/Reconnect without losing saved data/);
  const afterNewDuplicate=await request('/api/ledger');
  assert.deepEqual(afterNewDuplicate.data.accounts,beforeNewDuplicate.data.accounts);
  assert.deepEqual(afterNewDuplicate.data.transactions,beforeNewDuplicate.data.transactions);
  assert.deepEqual(afterNewDuplicate.data.adjustments,beforeNewDuplicate.data.adjustments);
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
  const beforeUpdate=await request('/api/ledger');
  const repaired=await request('/api/link-token',{reconnectAccountId:'acct-1'});
  assert.equal(repaired.code,200);
  assert.deepEqual(repaired.data,{link_token:'link-update-test',mode:'update'});
  const afterUpdate=await request('/api/ledger');
  assert.deepEqual(afterUpdate.data.accounts,beforeUpdate.data.accounts);
  assert.deepEqual(afterUpdate.data.transactions,beforeUpdate.data.transactions);
  assert.deepEqual(afterUpdate.data.adjustments,beforeUpdate.data.adjustments);
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
  // Plaid INVALID_FIELD is a request validation error, NOT proof that bank
  // credentials expired. Never silently force update-mode or erase an Item.
  // Preserve the latest valid source snapshot and make the next action clear.
  const beforeInvalid=await request('/api/ledger');
  const fieldFailed=await request('/api/sync',{});
  assert.equal(fieldFailed.code,502,'Plaid request validation failure is not an expired-login conflict');
  assert.equal(fieldFailed.data.code,'INVALID_FIELD');
  assert.equal(fieldFailed.data.endpoint,'/transactions/sync');
  assert.equal(fieldFailed.data.field,'account_id','Unrecognized failures are diagnosed without changing the sync cursor');
  assert.equal(fieldFailed.data.requestId,'fictional-request-id-42');
  assert.ok(!JSON.stringify(fieldFailed.data).includes('The count field has an invalid value'),
   'Raw Plaid error messages are not exposed to the browser');
  const invalidStatus=await request('/api/status');
  const affected=invalidStatus.data.accounts.find(a=>a.id==='acct-1');
  assert.equal(affected.needsReconnect,false,'API field failure does not demand a bank re-login');
  assert.equal(affected.syncIssue.code,'INVALID_FIELD');
  assert.equal(affected.syncIssue.endpoint,'/transactions/sync');
  assert.equal(affected.syncIssue.field,'account_id');
  assert.equal(affected.syncIssue.requestId,'fictional-request-id-42');
  assert.equal(affected.syncIssue.httpStatus,400);
  assert.equal(affected.syncIssue.errorType,'INVALID_REQUEST');
  assert.equal(affected.syncIssue.hasProviderMessage,true);
  assert.equal(JSON.stringify(affected.syncIssue).includes('The account_id field has an invalid value'),false,
   'Raw provider error details must not appear in persistent diagnostics');
  assert.equal(affected.syncIssue.environment,'sandbox','Error environment is retained with the issue');
  assert.match(affected.syncIssue.observedAt,/^\d{4}-\d{2}-\d{2}T/);
  const diagnostics=invalidStatus.data.diagnostics;
  assert.equal(diagnostics.environment,'sandbox');
  assert.equal(diagnostics.lastSyncAttempt.outcome,'failed');
  assert.match(diagnostics.lastSyncAttempt.at,/^\d{4}-\d{2}-\d{2}T/);
  assert.equal(diagnostics.lastPlaidCall.endpoint,'/transactions/sync');
  assert.equal(diagnostics.lastPlaidCall.outcome,'provider_error');
  assert.equal(diagnostics.lastPlaidCall.code,'INVALID_FIELD');
  assert.equal(diagnostics.lastPlaidCall.httpStatus,400);
  assert.equal(diagnostics.lastPlaidCall.errorType,'INVALID_REQUEST');
  assert.equal(diagnostics.lastPlaidCall.hasProviderMessage,true);
  assert.equal(diagnostics.lastPlaidCall.requestId,'fictional-request-id-42');
  assert.equal(diagnostics.lastPlaidCall.field,'account_id');
  assert.equal(JSON.stringify(diagnostics).includes('secret-test-access-token'),false,
   'Provider diagnostics never disclose the original bank token');
  assert.equal(invalidStatus.data.accounts.find(a=>a.id==='acct-2').syncIssue,null,
   'The healthy institution is not incorrectly flagged as failed');
  const staleField=await request('/api/ledger');
  assert.deepEqual(staleField.data.transactions,beforeInvalid.data.transactions,
   'Failed Plaid validation never mutates the last good imported records');
  assert.deepEqual(staleField.data.adjustments,beforeInvalid.data.adjustments,
   'INVALID_FIELD never drops saved household forecasts or categories');
  assert.equal(staleField.data.syncIssues.length,1,'Persisted invalid-field diagnostic reaches Ledger');
  assert.equal(staleField.data.syncIssues[0].code,'INVALID_FIELD');
  assert.equal(JSON.stringify(staleField.data).includes('secret-test-access-token'),false,
   'API response must never reveal access tokens');
  assert.equal((await request('/api/sync',{})).code,200,'Retry without account deletion can restore the connection');
  const cleared=await request('/api/status');
  assert.equal(cleared.data.accounts.every(a=>a.syncIssue===null),true,
   'Only successful full sync clears Plaid diagnostics');
  assert.equal(cleared.data.diagnostics.lastSyncAttempt.outcome,'success',
   'Fresh successful retry is distinct from an older persisted error');
  assert.equal(cleared.data.diagnostics.lastPlaidCall.outcome,'success');
  const retried=await request('/api/ledger');
  assert.deepEqual(retried.data.adjustments,beforeInvalid.data.adjustments,
   'After retry household settings remain unchanged');
  // Plaid sometimes rejects one optional parameter even after a previous
  // successful connection. Retry only the specifically named field: omitting
  // count is valid and uses Plaid's default page size; re-reading the saved
  // Item from an empty cursor preserves exact transactions and user edits.
  const beforeRecovery=await request('/api/ledger');
  const countFixed=await request('/api/sync',{});
  assert.equal(countFixed.code,200,'A count-specific INVALID_FIELD retries without optional count');
  const afterCount=await request('/api/ledger');
  assert.deepEqual(afterCount.data.adjustments,beforeRecovery.data.adjustments,
   'Retrying a page-size failure cannot reset any household prediction');
  assert.equal(afterCount.data.transactions.length,beforeRecovery.data.transactions.length,
   'Retrying a page-size failure cannot duplicate bank transactions');
  assert.equal((await request('/api/status')).data.accounts[0].syncIssue,null,
   'Successful count recovery does not leave a false connection failure');
  const cursorFixed=await request('/api/sync',{});
  assert.equal(cursorFixed.code,200,
   'A cursor-specific INVALID_FIELD replays with the existing access token');
  const afterCursor=await request('/api/ledger');
  assert.equal(afterCursor.data.accounts.length,beforeRecovery.data.accounts.length,
   'Cursor replay cannot unlink or recreate accounts');
  assert.deepEqual(afterCursor.data.adjustments,beforeRecovery.data.adjustments,
   'Cursor replay preserves category edits and every saved forecast');
  assert.equal(afterCursor.data.transactions.length,beforeRecovery.data.transactions.length,
   'Cursor replay merges existing transaction IDs rather than creating duplicates');
  assert.equal(JSON.stringify(afterCursor.data).includes('secret-test-access-token'),false,
   'No sensitive access token is exposed by recovery');
  assert.equal((await request('/api/status')).data.accounts.every(a=>a.syncIssue===null),true,
   'Successful cursor replay clears only the error flags');
  const beforeClientFailure=await request('/api/ledger');
  const clientFieldFailed=await request('/api/sync',{});
  assert.equal(clientFieldFailed.code,502,'Field diagnostics must not silently relink accounts');
  assert.equal(clientFieldFailed.data.field,'client_id',
   'Safe allowlist recognizes Plaid client_id when the provider identifies it');
  const headerFailed=(await request('/api/status')).data.diagnostics.lastRecovery;
  assert.equal(headerFailed.kind,'header_credentials');
  assert.equal(headerFailed.outcome,'item_accepted_sync_failed',
   'Failed header retry checks Item read-only without changing saved records');
  const clientStatus=await request('/api/status');
  assert.equal(clientStatus.data.accounts.find(a=>a.id==='acct-1').syncIssue.field,'client_id');
  assert.equal(JSON.stringify(clientStatus.data).includes('private value must stay hidden'),false,
   'Never reveal raw provider error text or rejected values');
  assert.deepEqual((await request('/api/ledger')).data.adjustments,beforeClientFailure.data.adjustments,
   'A client ID validation error must not mutate household data');
  assert.equal((await request('/api/sync',{})).code,200,
   'A subsequent authorized refresh can clear the diagnostic');
  const beforeUnknown=await request('/api/ledger');
  assert.equal((await request('/api/sync',{})).code,200,
   'Unknown field safely recovers if optional count is rejected');
  const unknownRecovered=await request('/api/status');
  assert.equal(unknownRecovered.data.diagnostics.lastRecovery.kind,'optional_count');
  assert.equal(unknownRecovered.data.diagnostics.lastRecovery.outcome,'recovered');
  assert.deepEqual((await request('/api/ledger')).data.adjustments,beforeUnknown.data.adjustments,
   'Unknown-field fallback must not change user forecasts');
  const beforeProbe=await request('/api/ledger');
  assert.equal((await request('/api/sync',{})).code,502,
   'Read-only Item check must not pretend an invalid sync succeeded');
  const probeStatus=await request('/api/status');
  assert.equal(probeStatus.data.diagnostics.lastRecovery.kind,'item_check');
  assert.equal(probeStatus.data.diagnostics.lastRecovery.outcome,'accepted');
  assert.equal(probeStatus.data.diagnostics.lastPlaidCall.endpoint,'/transactions/sync');
  assert.deepEqual((await request('/api/ledger')).data.transactions,beforeProbe.data.transactions,
   'Item check cannot alter immutable bank transactions');
  assert.deepEqual((await request('/api/ledger')).data.adjustments,beforeProbe.data.adjustments,
   'Item check cannot alter saved forecasts');
  assert.equal(JSON.stringify(probeStatus.data).includes('secret-test-access-token'),false);
  assert.equal((await request('/api/sync',{})).code,200,
   'A later legitimate refresh resumes with the original Item');
  const beforeHeader=await request('/api/ledger');
  assert.equal((await request('/api/sync',{})).code,200,
   'Named client_id rejection can recover with Plaid documented header authentication');
  const headerStatus=(await request('/api/status')).data;
  assert.equal(headerStatus.diagnostics.lastRecovery.kind,'header_credentials');
  assert.equal(headerStatus.diagnostics.lastRecovery.outcome,'recovered');
  assert.equal(headerStatus.accounts.every(a=>a.syncIssue===null),true);
  assert.deepEqual((await request('/api/ledger')).data.adjustments,beforeHeader.data.adjustments,
   'Header retry cannot change saved forecasts or categories');
  assert.equal(JSON.stringify(headerStatus).includes('secret-test-access-token'),false);
  await request('/api/disconnect',{});
  status=await request('/api/status');assert.equal(status.data.connected,false);assert.equal(status.data.transactions.length,0);
  console.log('PASS Plaid Link exchange, one selected account, exact reported bank balances, encrypted token, pending-posted sync and disconnect');
 }finally{child.kill();fs.rmSync(folder,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
