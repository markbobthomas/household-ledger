'use strict';
// Isolated one-account pilot. No access to the static Ledger or fictional Sandbox.
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib');
const env=process.env;
const {inspect:accountForecastLinks}=require('./account-forecast-links.cjs');
// Load optional UI modules only inside their relevant edit endpoints.
// A deliberately partial static deployment must still start and serve /healthz.
const savedCategoryChoices=(predictions,customCategories=[])=>
 require('../ledger-data.js').categories({predictions,customCategories});
if(!env.PILOT_PASSWORD||env.PILOT_PASSWORD.length<20||!env.PILOT_ENCRYPTION_KEY||!env.PLAID_CLIENT_ID||!env.PLAID_SECRET)
 throw Error('Missing pilot password (20+ characters), encryption key, or Plaid credentials');
const key=crypto.createHash('sha256').update(env.PILOT_ENCRYPTION_KEY).digest();
const file=env.PILOT_STATE_PATH||'/var/data/pilot.enc';
// Forecast preferences live beside the bank snapshot, but save independently.
// This avoids encrypting and rewriting every Plaid transaction for one edit.
const forecastFile=file+'.forecasts';
const plaidEnvironment=env.PLAID_ENV||'production';
const HOST={production:'https://production.plaid.com',sandbox:'https://sandbox.plaid.com'}[plaidEnvironment];
if(!HOST)throw Error('PLAID_ENV must be production or sandbox');
const deployedCommit=/^[a-f0-9]{40}$/i.test(String(env.RENDER_GIT_COMMIT||''))?env.RENDER_GIT_COMMIT:null;
// Only an authenticated, six-character ID suffix is needed to check which
// Plaid Dashboard team owns the live Render credentials.
const plaidClientIdEnding=String(env.PLAID_CLIENT_ID||'').length>=6?
 String(env.PLAID_CLIENT_ID).slice(-6):null;
// Private, temporary, sanitized diagnostics. No credential, account ID,
// transaction or bank amount is ever recorded; only authenticated users can
// view these observations. In particular, distinguish a locally shown stale
// error from a fresh provider response and show the actual Plaid environment.
let lastPlaidCall=null,lastSyncAttempt=null,lastRecovery=null;
const bankDiagnostics=()=>({
 environment:plaidEnvironment,deployCommit:deployedCommit,
 requestHost:HOST,clientIdEnding:plaidClientIdEnding,
 lastSyncAttempt:lastSyncAttempt?{...lastSyncAttempt}:null,
 lastPlaidCall:lastPlaidCall?{...lastPlaidCall}:null,
 lastRecovery:lastRecovery?{...lastRecovery}:null
});
const safe=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
const stamp=()=>new Date().toISOString();
const freshState=()=>({items:[],transactions:{},accounts:[],lastSync:null,error:null,ledgerAdjustments:{}});
let state=freshState(),forecastWrites=Promise.resolve(),householdEditQueue=Promise.resolve(),accountRemovalBusy=false;
const settingsRevision=()=>crypto.createHmac('sha256',key).update(JSON.stringify(state.ledgerAdjustments||{})).digest('hex');
const staleMessage='Ledger was updated on another device. This edit was not saved. Reload the page to review the latest changes.';
function normalizeState(){
 if(!Array.isArray(state.items))state.items=[];
 if(state.item?.token&&state.accountId&&!state.items.some(i=>i.id===state.item.id))
  state.items.push({id:state.item.id,token:state.item.token,cursor:state.cursor||null,accountIds:[String(state.accountId)]});
 for(const i of state.items)i.accountIds=Array.isArray(i.accountIds)?i.accountIds.map(String):[];
 delete state.item;delete state.accountId;delete state.cursor;
 state.transactions=state.transactions&&typeof state.transactions==='object'?state.transactions:{};
 state.accounts=Array.isArray(state.accounts)?state.accounts:[];
 state.ledgerAdjustments=state.ledgerAdjustments||{};
}
function encrypted(value){
 const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const data=Buffer.concat([c.update(Buffer.from(JSON.stringify(value))),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),
  data:data.toString('base64')});
}
function decrypted(text){
 const b=JSON.parse(text),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(b.iv,'base64'));
 d.setAuthTag(Buffer.from(b.tag,'base64'));
 return JSON.parse(Buffer.concat([d.update(Buffer.from(b.data,'base64')),d.final()]).toString());
}
async function load(){
 try{state=decrypted(await fs.readFile(file,'utf8'));normalizeState()}
 catch(e){if(e.code!=='ENOENT')throw e}
 // A crash during an all-account disconnect must not import preferences
 // from the former household into a new bank connection.
 if(state.forecastResetRequired){
  try{await fs.unlink(forecastFile)}catch(e){if(e.code!=='ENOENT')throw e}
  const ready={...state};delete ready.forecastResetRequired;
  await atomicEncryptedWrite(file,ready);state=ready;
 }
 // Existing users start with their previous encrypted predictions in pilot.enc.
 // Once a forecast is saved separately, this tiny file is authoritative.
 try{
  const predictions=decrypted(await fs.readFile(forecastFile,'utf8'));
  if(!predictions||typeof predictions!=='object'||Array.isArray(predictions))
   throw Error('Invalid encrypted forecast preferences');
  state.ledgerAdjustments.predictions=predictions;
 }catch(e){if(e.code!=='ENOENT')throw e}
 remapPostedMetadata(state.ledgerAdjustments);
}
// The bank snapshot's provider replacement IDs are the durable migration log.
// Replay after loading the independently saved forecast file, so a crash between
// files cannot orphan a pending note or undo its recurring evidence link.
function remapPostedMetadata(adjustments,transactions=state.transactions){
 for(const t of [...(state.transactionReplacements||[]),...Object.values(transactions||{})]){
  if(t.pendingId)require('../ledger-data.js').remapTransactionMetadata(
   adjustments,t.accountId,t.pendingId,t.id);
 }
 return adjustments;
}
// Serialize writes to each encrypted file and stage them under a unique,
// exclusive temporary name. Failed writes never replace the last good file.
// Keep this small boundary shared by bank history, forecasts and sessions.
const encryptedWriteQueues=new Map();
async function atomicEncryptedWrite(filename,value){
 const ciphertext=encrypted(value);
 const previous=encryptedWriteQueues.get(filename)||Promise.resolve();
 const write=previous.catch(()=>{}).then(async()=>{
  await fs.mkdir(path.dirname(filename),{recursive:true});
  const temporary=filename+'.tmp-'+process.pid+'-'+crypto.randomBytes(12).toString('hex');
  try{
   await fs.writeFile(temporary,ciphertext,{mode:0o600,flag:'wx'});
   await fs.rename(temporary,filename);
  }finally{
   try{await fs.unlink(temporary)}catch(error){if(error.code!=='ENOENT')throw error}
  }
 });
 encryptedWriteQueues.set(filename,write);
 try{await write}
 finally{if(encryptedWriteQueues.get(filename)===write)encryptedWriteQueues.delete(filename)}
}
async function save(){
 await atomicEncryptedWrite(file,state);
}
// An Item is removed from the durable local bank snapshot before Plaid is
// asked to revoke it. Encrypted pending entries survive any crash and make
// external cleanup retryable without presenting a revoked Item as connected.
function pendingRevocations(){return Array.isArray(state.pendingRevocations)?state.pendingRevocations:[]}
async function finishPendingRevocation(itemId){
 const pending=pendingRevocations().find(p=>p.id===itemId);
 if(!pending)return;
 try{await plaid('/item/remove',{access_token:pending.token})}
 catch(error){
  if(error.plaidCode!=='ITEM_NOT_FOUND')throw error;
 }
 const next={...state,pendingRevocations:pendingRevocations().filter(p=>p.id!==itemId)};
 try{await atomicEncryptedWrite(file,next)}
 catch(error){error.revocationAcknowledged=true;throw error}
 state=next;
}
async function resumePendingRevocations(){
 for(const pending of [...pendingRevocations()]){
  try{await finishPendingRevocation(pending.id)}catch{
   // Retain the encrypted retry token, not an apparently active Item.
  }
 }
 return pendingRevocations().length;
}
function scheduleRevocationRecovery(){
 if(!pendingRevocations().length)return;
 const prior=householdEditQueue;
 let release;
 householdEditQueue=new Promise(done=>{release=done});
 Promise.resolve(prior).then(()=>resumePendingRevocations()).catch(()=>{}).finally(release);
}
// Session records are separately encrypted and persisted on the existing
// private disk. Never store passwords, bank data or raw bearer IDs there.
const auth=require('./session-auth.cjs')({
 password:env.PILOT_PASSWORD,secret:key,sessionFile:file+'.sessions',
 decrypted,atomicEncryptedWrite
});
// One small encrypted write per forecast edit. The full encrypted bank ledger
// is neither touched nor read, and concurrent browser saves are serialized.
// Only inputs that can affect the canonical projection invalidate its
// 1,095-day result. Notes, budget targets/order, and card warning
// acknowledgements are private display metadata, not financial facts.
// Keep this exclusion list in sync with planner.js forecastFor().
// Compare values rather than object identity: saves replace the preferences.
function projectedPreferencesSignature(predictions){
 const {transactionNotes,categoryDisplayOrder,categoryMonthlyBudgets,
  cardPaymentReviewAcks,...financial}=predictions||{};
 return JSON.stringify(financial);
}
async function saveForecast(predictions,expectedRevision){
 predictions=remapPostedMetadata({predictions:structuredClone(predictions)}).predictions;
 // All writes share this serialized encrypted boundary. Compare against the
 // last saved snapshot INSIDE the queue, so repeated client submissions are
 // idempotent and can never create a new duplicate. Existing legacy duplicate
 // records may remain until the user decides what to do with them; they must
 // not block Ignore, category edits, or other unrelated review decisions.
 const write=forecastWrites.catch(()=>{}).then(async()=>{
  // Check inside the write queue. Identical repeat requests remain idempotent.
  if(expectedRevision&&expectedRevision!==settingsRevision()){
   if(JSON.stringify(state.ledgerAdjustments?.predictions||{})===JSON.stringify(predictions))return;
   const error=new Error(staleMessage);error.httpStatus=409;throw error;
  }
  const previous=state.ledgerAdjustments?.predictions||{};
  require('../planner-transactions.js').assertNoNewForecastDuplicates(previous,predictions);
  const forecastChanged=projectedPreferencesSignature(previous)!==
   projectedPreferencesSignature(predictions);
  await atomicEncryptedWrite(forecastFile,predictions);
  state.ledgerAdjustments.predictions=predictions;
  // Do not invalidate for a note, category-order, budget-target or warning
  // acknowledgement save. Forecast-changing edits must expire the bundle
  // before any subsequent private GET can reuse an obsolete projection.
  if(forecastChanged){invalidatePrepared();schedulePrepared()}
 });
 forecastWrites=write.catch(()=>{});
 await write;
}
async function plaid(endpoint,body,credentialsInHeaders=false){
 const observation={at:stamp(),endpoint,outcome:'started'};
 lastPlaidCall=observation;
 try{
  // Plaid supports credentials in the JSON body or in these headers.
  // Only retry using headers after an explicit client_id/secret rejection.
  const headers={'Content-Type':'application/json'};
  if(credentialsInHeaders){
   headers['PLAID-CLIENT-ID']=env.PLAID_CLIENT_ID;
   headers['PLAID-SECRET']=env.PLAID_SECRET;
  }
  const requestBody=credentialsInHeaders?body:{...body,client_id:env.PLAID_CLIENT_ID,secret:env.PLAID_SECRET};
  const resp=await fetch(HOST+endpoint,{method:'POST',headers,body:JSON.stringify(requestBody),signal:AbortSignal.timeout(25000)});
  const data=await resp.json();
  if(!resp.ok||data.error_code){
   const code=String(data.error_code||resp.status).slice(0,60),
    error=new Error('Plaid request failed: '+code);
   // Expose only response metadata, not Plaid's raw error_message: provider
   // messages may echo credentials or bank request values.
   const httpStatus=Number.isInteger(resp.status)&&resp.status>=100&&resp.status<=599?resp.status:null;
   const errorType=/^[A-Z_]{3,40}$/.test(String(data.error_type||''))?data.error_type:null;
   const hasProviderMessage=typeof data.error_message==='string'&&!!data.error_message.trim();
   // Store only a recognized field name. Plaid error_message can contain
   // rejected values and must never be sent to the Ledger browser.
   const field=String(data.error_message||'').match(/\b(?:access_token|cursor|count|client_id|secret|products|country_codes|language|client_name|client_user_id|redirect_uri|account_id|start_date|end_date)\b/i)?.[0];
   const requestId=/^[a-zA-Z0-9_-]{3,80}$/.test(String(data.request_id||''))?data.request_id:null;
   observation.outcome='provider_error';
   observation.code=code;
   if(httpStatus)observation.httpStatus=httpStatus;
   if(errorType)observation.errorType=errorType;
   observation.hasProviderMessage=hasProviderMessage;
   if(requestId)observation.requestId=requestId;
   if(field)observation.field=field.toLowerCase();
   error.plaidCode=code;error.plaidEndpoint=endpoint;
   error.plaidRequestId=requestId;error.plaidField=field?.toLowerCase()||null;
   error.plaidHttpStatus=httpStatus;error.plaidErrorType=errorType;
   error.plaidHasProviderMessage=hasProviderMessage;
   throw error;
  }
  observation.outcome='success';
  return data;
 }catch(error){
  // If a fetch never got a readable JSON response, this was not a confirmed
  // Plaid INVALID_FIELD and will not have any Plaid request ID to find.
  if(observation.outcome==='started')observation.outcome='transport_or_response_error';
  throw error;
 }
}
async function sync(){
 lastSyncAttempt={at:stamp(),outcome:'started'};lastPlaidCall=null;lastRecovery=null;
 try{
 if(!state.items.length)throw Error('No connected accounts');
 const stages=[],observedAt=stamp(),allIds=new Set();
 for(const item of state.items){
  try{
  if(!item.token||!item.accountIds?.length)throw Error('Incomplete connected institution');
  // Finish all pages before making ANY source or cursor changes. If Plaid
  // identifies an invalid optional count, retry without that field (default
  // 100). If it specifically rejects the previously saved cursor, replay
  // from the start using the SAME Item token and merge by transaction ID.
  // This does not delete old records absent from the replay; a failed replay
  // preserves both the original cursor and the last successful bank snapshot.
  const readPages=async(start,withCount=true,credentialsInHeaders=false)=>{
   for(let attempt=0;attempt<3;attempt++){
    let cursor=start,complete=false;
    const pages=[];
    try{
     for(let n=0;n<100;n++){
      const body={access_token:item.token,
       ...(withCount?{count:500}:{}),...(cursor?{cursor}:{})};
      const page=await plaid('/transactions/sync',body,credentialsInHeaders);
      if(!Array.isArray(page.added)||!Array.isArray(page.modified)||
       !Array.isArray(page.removed)||typeof page.next_cursor!=='string')
       throw Error('Malformed sync response');
      pages.push(page);cursor=page.next_cursor;
      if(!page.has_more){complete=true;break}
     }
     if(!complete)throw Error('Sync pagination incomplete');
     return {cursor,pages};
    }catch(error){
     if(error.plaidCode!=='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'||
      attempt===2)throw error;
    }
   }
  };
  const savedCursor=typeof item.cursor==='string'&&item.cursor?item.cursor:undefined;
  let result;
  try{result=await readPages(savedCursor)}
  catch(error){
   const invalid=error.plaidCode==='INVALID_FIELD'&&
    error.plaidEndpoint==='/transactions/sync';
   if(invalid&&error.plaidField==='count')
    result=await readPages(savedCursor,false);
   else if(invalid&&error.plaidField==='cursor'&&savedCursor)
    result=await readPages(undefined);
   else if(invalid&&['client_id','secret'].includes(error.plaidField)){
    // Exact same credentials/Item/cursor. No relinking or data reset.
    try{
     result=await readPages(savedCursor,true,true);
     lastRecovery={at:stamp(),kind:'header_credentials',outcome:'recovered'};
    }catch(retryError){
     const failedSyncCall=lastPlaidCall?{...lastPlaidCall}:null;
     try{
      await plaid('/item/get',{access_token:item.token},true);
      lastRecovery={at:stamp(),kind:'header_credentials',outcome:'item_accepted_sync_failed'};
     }catch(itemError){
      lastRecovery={at:stamp(),kind:'header_credentials',
       outcome:itemError.plaidCode?'item_rejected':'item_unavailable',
       ...(itemError.plaidCode?{code:itemError.plaidCode}:{})};
     }finally{lastPlaidCall=failedSyncCall}
     throw retryError;
    }
   }
   else if(invalid&&!error.plaidField){
    // Omit ONLY the optional page-size field; never speculate about a
    // different cursor, Item, or credential. Changes stage on full success.
    try{
     result=await readPages(savedCursor,false);
     lastRecovery={at:stamp(),kind:'optional_count',outcome:'recovered'};
    }catch(retryError){
     // Read-only Item metadata distinguishes a working bank Item from
     // a Transactions-only failure without modifying source records.
     const failedSyncCall=lastPlaidCall?{...lastPlaidCall}:null;
     try{
      await plaid('/item/get',{access_token:item.token});
      lastRecovery={at:stamp(),kind:'item_check',outcome:'accepted'};
     }catch(itemError){
      lastRecovery={at:stamp(),kind:'item_check',
       outcome:itemError.plaidCode?'rejected':'unavailable',
       ...(itemError.plaidCode?{code:itemError.plaidCode}:{}),
       ...(itemError.plaidField?{field:itemError.plaidField}:{})};
     }finally{lastPlaidCall=failedSyncCall}
     throw retryError;
    }
   }else throw error;
  }
  const {cursor,pages}=result;
  const response=await plaid('/accounts/get',{access_token:item.token});
  if(!Array.isArray(response.accounts))throw Error('Plaid accounts response incomplete');
  const selected=[];
  for(const id of item.accountIds){
   if(allIds.has(id))throw Error('An account is connected multiple times');
   allIds.add(id);
   const a=response.accounts.find(x=>x.account_id===id);
   if(!a)throw Error('A connected account is no longer available');
   if(!['depository','credit'].includes(a.type))throw Error('Unsupported account type');
   selected.push({id:a.account_id,name:a.name,mask:a.mask||null,type:a.type,subtype:a.subtype,
    itemId:item.id,current:a.balances?.current??null,available:a.balances?.available??null,
    balanceObservedAt:observedAt,currency:a.balances?.iso_currency_code||'USD'});
  }
  stages.push({item,cursor,pages,accounts:selected});
  }catch(error){
   if(error.plaidCode){
    // Request-validation errors aren't proof of an expired bank login.
    // Persist a per-Item diagnostic while retaining the entire last-known-good
    // bank snapshot, original token, cursor and encrypted forecast preferences.
    item.syncIssue={code:error.plaidCode,endpoint:error.plaidEndpoint||null,
     observedAt:stamp(),environment:plaidEnvironment,
     ...(error.plaidHttpStatus?{httpStatus:error.plaidHttpStatus}:{}),
     ...(error.plaidErrorType?{errorType:error.plaidErrorType}:{}),
     ...(error.plaidHasProviderMessage!==undefined?{hasProviderMessage:error.plaidHasProviderMessage}:{}),
     ...(error.plaidField?{field:error.plaidField}:{}),
     ...(error.plaidRequestId?{requestId:error.plaidRequestId}:{})};
    if(error.plaidCode==='ITEM_LOGIN_REQUIRED'){
     item.reconnectRequired=true;
     error.reconnectAccountId=item.accountIds[0]||null;
    }
    await save();
   }
   throw error;
  }
 }
 const next={...state.transactions},adjustments=structuredClone(state.ledgerAdjustments||{}),
  overrides=adjustments.categoryOverrides||{},replacements=[...(state.transactionReplacements||[])];
 adjustments.categoryOverrides=overrides;
 for(const stage of stages){
  const ids=new Set(stage.item.accountIds);
  for(const page of stage.pages){
   for(const t of [...page.added,...page.modified]){
    if(!ids.has(t.account_id))continue;
    if(t.pending_transaction_id){
     const replacement=replacements.find(r=>r.pendingId===t.pending_transaction_id&&r.accountId===t.account_id);
     if(replacement&&replacement.id!==t.transaction_id)throw Error('Conflicting pending replacement identity');
     if(!replacement)
      replacements.push({accountId:t.account_id,pendingId:t.pending_transaction_id,id:t.transaction_id});
     const predecessor=next[t.pending_transaction_id];
     if(predecessor&&(predecessor.accountId!==t.account_id||predecessor.itemId!==stage.item.id))
      throw Error('Pending predecessor belongs to another account or Item');
     require('../ledger-data.js').remapTransactionMetadata(adjustments,t.account_id,t.pending_transaction_id,t.transaction_id);
     delete next[t.pending_transaction_id];
    }
    next[t.transaction_id]={id:t.transaction_id,accountId:t.account_id,itemId:stage.item.id,
     date:t.date,name:t.name,merchant:t.merchant_name||t.name,amount:t.amount,
     pending:!!t.pending,pendingId:t.pending_transaction_id||null,
     category:t.personal_finance_category||null};
   }
   for(const t of page.removed){
    if(!next[t.transaction_id]||ids.has(next[t.transaction_id].accountId)||!next[t.transaction_id].accountId){
     delete next[t.transaction_id];delete overrides[t.transaction_id];
    }
   }
  }
 }
 const legacyId=state.accounts.length===1?state.accounts[0].id:null;
 for(const t of Object.values(next))if(!t.accountId&&legacyId)t.accountId=legacyId;
 const selectedIds=new Set(stages.flatMap(s=>s.accounts.map(a=>a.id)));
 for(const [id,t] of Object.entries(next))if(t.accountId&&!selectedIds.has(t.accountId)){delete next[id];delete overrides[id]}
 const committed={...state,transactions:next,accounts:stages.flatMap(s=>s.accounts),
  transactionReplacements:replacements,ledgerAdjustments:adjustments,
  items:state.items.map(i=>{
   const {syncIssue:_oldIssue,...item}=i;
   return {...item,cursor:stages.find(s=>s.item.id===i.id).cursor,reconnectRequired:false};
  }),lastSync:observedAt,error:null};
 // Publish source rows, cursors and preference remapping together only after
 // the encrypted snapshot is durable. The forecast file is replayed on load.
 await atomicEncryptedWrite(file,committed);state=committed;
 lastSyncAttempt.outcome='success';
 // No paid AI request on bank synchronization.
 return {transactions:Object.keys(next).length,accounts:state.accounts.length,institutions:state.items.length};
 }catch(error){lastSyncAttempt.outcome='failed';throw error}
}
async function html(){return fs.readFile(path.join(__dirname,'index.html'),'utf8')}
// The same authenticated payload still owns all immutable bank facts. The
// prepared projection is a derived, versioned extra attached atomically to it.
function ledgerPayload(){
 if(!state.items.length)return {connected:false,account:null,accounts:[],transactions:[],
  adjustments:{},remoteDisconnectPending:pendingRevocations().length};
 return {connected:true,account:state.accounts[0]||null,accounts:state.accounts,lastSync:state.lastSync,
  transactions:Object.values(state.transactions).filter(t=>t&&typeof t==='object')
   .sort((a,b)=>String(b.date).localeCompare(String(a.date))),
  reconnectAccounts:state.items.filter(i=>i.reconnectRequired).flatMap(i=>i.accountIds).map(String),
  syncIssues:state.items.filter(i=>i.syncIssue).map(i=>({
   accountIds:i.accountIds.map(String),...i.syncIssue
  })),
  adjustments:state.ledgerAdjustments||{}};
}
// RAM only. Bank and forecast persistence remain separately encrypted on disk.
// Forecast-only writes invalidate here only when cash-flow inputs change.
// Bank sync/classification routes still invalidate conservatively.
let preparedGeneration=0,preparedCache=null,prepareScheduled=false;
function invalidatePrepared(){
 preparedGeneration++;
 preparedCache=null;
}
function preparedFor(payload){
 if(!payload.connected)return null;
 const worker=require('./prepared-forecast.cjs'),
  today=worker.pacificDate();
 if(preparedCache&&preparedCache.generation===preparedGeneration&&
  preparedCache.asOf===today)return preparedCache.result;
 // The process is single threaded: the prepared result and bank snapshot
 // cannot change mid-computation. A failed optional compute never prevents
 // displaying the original authoritative source and browser fallback.
 const generation=preparedGeneration;
 const projection=worker.prepare(payload,today);
 const result=projection?{...projection,generation}:null;
 if(generation===preparedGeneration)
  preparedCache={generation,asOf:today,result};
 return result;
}
function schedulePrepared(){
 if(prepareScheduled)return;
 prepareScheduled=true;
 setImmediate(()=>{
  prepareScheduled=false;
  try{preparedFor(ledgerPayload())}
  catch(_error){preparedCache=null}
 });
}
// This fingerprint is a private HMAC of the financial inputs, never an
// exposed source record or a client-controlled cache key. Mere sync timestamps
// do not force an expensive rerun when there was no substantive change.
function aiSnapshotRevision(){
 const accounts=state.accounts.map(a=>[a.id,a.type,a.current,a.available,a.currency]);
 const canonicalDate=require('./prepared-forecast.cjs').pacificDate();
 return crypto.createHmac('sha256',key).update(JSON.stringify({
  accounts,transactions:state.transactions,adjustments:state.ledgerAdjustments,
  asOf:canonicalDate
 })).digest('hex');
}
// A deliberately partial private fallback bundle may omit optional AI
// modules. Never make the core banking/health service depend on their presence.
const aiCacheFactory=(()=>{
 try{return require('./ai-report-cache.cjs').create}
 catch(error){
  if(error.code==='MODULE_NOT_FOUND'&&
    String(error.message).includes("'./ai-report-cache.cjs'"))return null;
  throw error;
 }
})();
const aiReports=aiCacheFactory?aiCacheFactory({
 read:async()=>decrypted(await fs.readFile(file+'.analysis','utf8')),
 write:value=>atomicEncryptedWrite(file+'.analysis',value),
 revision:aiSnapshotRevision,
 available:()=>!!state.items.length,
 snapshot:()=>{
  const prepared=preparedFor(ledgerPayload());
  const context=require('./ai-financial-report.cjs').financialContext(prepared,{
   lastSync:state.lastSync,adjustments:state.ledgerAdjustments});
  // The SAME complete sanitized financial evidence as manual Export Data.
  // Created only during an explicitly consented AI Analysis request.
  context.reportEvidence=require('./analysis-export.cjs').build({
   prepared,context,adjustments:state.ledgerAdjustments,lastSync:state.lastSync,
   syncDiagnostics:{lastAttempt:lastSyncAttempt,
    issues:state.items.filter(i=>i.syncIssue).map(i=>({
     code:i.syncIssue.code,observedAt:i.syncIssue.observedAt}))}
  });
  return context;
 },
 analyze:context=>require('./ai-chat.cjs').analyzeOneClick({
  context,consent:'financial-analysis-v3',apiKey:env.OPENAI_API_KEY,
  model:env.OPENAI_OUTLOOK_MODEL||env.OPENAI_REPORT_MODEL||'gpt-6.2-astra'
 })
}):{
 load:async()=>{},status:()=>({enabled:false,status:'unavailable',report:null}),
 schedule:()=>false,
 setEnabled:async()=>{throw Error('Optional AI analysis module unavailable')},
 clear:async()=>{}
};
// A separate, manual-only encrypted QA report. The banking snapshot
// remains read-only, and the ordinary analysis report/consent are unaffected.
// QA freshness also includes last successful sync and sync warnings, even when
// a bank refresh produced no changed transactions.
const qaSnapshotRevision=()=>crypto.createHmac('sha256',key).update(JSON.stringify({
 financial:aiSnapshotRevision(),lastSync:state.lastSync,
 syncIssues:state.items.map(i=>i.syncIssue?.code||null)
})).digest('hex');
const qaReports=aiCacheFactory?aiCacheFactory({
 read:async()=>decrypted(await fs.readFile(file+'.qaqc','utf8')),
 write:value=>atomicEncryptedWrite(file+'.qaqc',value),
 revision:qaSnapshotRevision,
 available:()=>!!state.items.length,
 snapshot:()=>{
  const prepared=preparedFor(ledgerPayload());
  return require('./ai-qaqc.cjs').buildContext(prepared,{
   lastSync:state.lastSync,adjustments:state.ledgerAdjustments});
 },
 analyze:context=>require('./ai-chat.cjs').analyzeQualityCheck({
  context,consent:'ledger-qaqc-v1',apiKey:env.OPENAI_API_KEY,
  model:env.OPENAI_REPORT_MODEL||'gpt-4.1'
 })
}):{load:async()=>{},status:()=>({enabled:false,status:'unavailable',report:null}),
 schedule:()=>false,clear:async()=>{}};
async function start(port=Number(env.PORT||8788)){
 await load();
 await auth.load();
 // A damaged derived-report cache must never prevent access to bank records.
 // Fail closed on standing external-sharing consent; leave the bank disk alone.
 try{await aiReports.load()}catch{/* Optional AI cache unavailable; bank remains authoritative */}
 try{await qaReports.load()}catch{/* Optional QA cache never blocks bank startup */}
 const server=http.createServer(async(req,res)=>{
  // Route on the URL pathname; tracking/query parameters are not bank actions.
  const requestPath=new URL(req.url,'http://localhost').pathname;
  const respond=(status,data)=>{const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(requestPath.startsWith('/api/'))headers['X-Ledger-Revision']=settingsRevision();
    if(req.method==='POST'&&status>=200&&status<300&&
       (requestPath.startsWith('/api/ledger/')&&requestPath!=='/api/ledger/forecasts'||
        ['/api/sync','/api/exchange','/api/disconnect'].includes(requestPath))){
     invalidatePrepared();
     schedulePrepared();
    }
    const encoded=JSON.stringify(data);
    // The authenticated forecast can be larger than the raw bank response.
    // Compress only when supported by the browser; never allow shared caches.
    if(['/api/ledger','/api/ai/report','/api/ai/qaqc'].includes(requestPath)&&req.method==='GET'&&status===200&&
       encoded.length>4096&&/\\bgzip\\b/i.test(String(req.headers['accept-encoding']||''))){
     headers['Content-Encoding']='gzip';
     headers.Vary='Accept-Encoding';
     res.writeHead(status,headers);
     return res.end(zlib.gzipSync(encoded,{level:3}));
    }
    res.writeHead(status,headers);res.end(encoded)};
  // Render provides the deployed Git SHA at runtime. Health exposes only
  // this public source identifier, never credentials, banking records or disk paths.
  if(requestPath==='/healthz'&&req.method==='GET')return respond(200,{
   ok:true,mode:'multi-account-private',
   commit:deployedCommit,
   // Harmless model identifier, never a provider key or private financial data.
   analysisModel:env.OPENAI_OUTLOOK_MODEL||env.OPENAI_REPORT_MODEL||'gpt-6.2-astra',
   analysisModelSource:env.OPENAI_OUTLOOK_MODEL?'outlook-override':env.OPENAI_REPORT_MODEL?'environment-override':'default'
  });
  const origin=req.headers.origin,host=req.headers.host;
  // Reject cross-origin writes including sign in/out. Other mutations also
  // require the existing non-simple X-Pilot-Action header.
  if(origin){
   try{if(new URL(origin).host!==host)return respond(403,{error:'Origin rejected'})}
   catch{return respond(403,{error:'Origin rejected'})}
  }
  if(req.method==='GET'&&requestPath==='/login'){
   let loginPage;
   try{loginPage=await fs.readFile(path.join(__dirname,'login.html'),'utf8')}
   catch{return respond(503,{error:'Private sign-in page is temporarily unavailable'})}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});
   return res.end(loginPage);
  }
  if(req.method==='POST'&&requestPath==='/auth/login'){
   if(req.headers['x-pilot-action']!=='1'||!String(req.headers['content-type']||'').startsWith('application/json'))
    return respond(403,{error:'Invalid sign-in request'});
   const ip=String(req.socket.remoteAddress||'unknown');
   if(auth.blocked(ip))return respond(429,{error:'Too many attempts. Try again later.'});
   let data;
   try{
    let length=0,parts=[];
    for await(const part of req){length+=part.length;if(length>4096)return respond(413,{error:'Sign-in request too large'});parts.push(part)}
    data=JSON.parse(Buffer.concat(parts).toString());
   }catch{return respond(400,{error:'Invalid sign-in request'})}
   if(!data||typeof data.password!=='string'||Object.keys(data).length!==1||!auth.checkPassword(data.password)){
    auth.failed(ip);return respond(401,{error:'Invalid password'});
   }
   let token;
   try{token=await auth.issue()}
   catch{return respond(503,{error:'Could not start a secure session. Try signing in again.'})}
   auth.successful(ip);
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Set-Cookie':[auth.cookie(token),auth.clearSignedOut(),auth.upgradedCookie()]});
   return res.end(JSON.stringify({signedIn:true,expiresInDays:90}));
  }
  if(req.method==='POST'&&requestPath==='/auth/logout'){
   if(req.headers['x-pilot-action']!=='1')return respond(403,{error:'Action header required'});
   try{await auth.revoke(req)}
   catch{return respond(503,{error:'Could not confirm sign out. Try again.'})}
   // A signed-out browser may still hold its former Basic credentials in
   // browser memory. The tombstone prevents silent Basic reauthentication.
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Set-Cookie':[auth.clearCookie(),auth.signedOutCookie()]});
   return res.end(JSON.stringify({signedOut:true}));
  }
  const expected=Buffer.from('pilot:'+env.PILOT_PASSWORD).toString('base64');
  const supplied=String(req.headers.authorization||'').replace(/^Basic /,'');
  const basic=supplied.length===expected.length&&crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
  // Compatibility with previously cached browser HTTP Basic credentials and
  // existing API clients. Only a first-party session gives 90-day persistence.
  const cookieSession=auth.authenticated(req);
  const basicAuthorized=basic&&!auth.isSignedOut(req)&&!auth.wasUpgraded(req);
  if(!cookieSession&&!basicAuthorized){
   if(req.method==='GET'&&!requestPath.startsWith('/api/')){
    res.writeHead(303,{'Location':'/login','Cache-Control':'no-store'});return res.end();
   }
   return respond(401,{error:'Sign in to your private Ledger to continue'});
  }
  // Upgrade an existing password-authenticated browser automatically on
  // its next page load; do not force the household to enter a new password.
  let upgradeCookie=null;
  if(!cookieSession&&basicAuthorized&&req.method==='GET'&&
     (requestPath==='/'||requestPath==='/index.html')){
   try{upgradeCookie=[auth.cookie(await auth.issue()),auth.clearSignedOut(),auth.upgradedCookie()]}
   catch{ /* A transient session-disk failure must not take down the bank UI. */ }
  }
  if(req.method==='GET'&&requestPath==='/ai-review'){
   let page;try{page=await fs.readFile(path.join(__dirname,'ai-review.html'),'utf8')}
   catch{return respond(503,{error:'AI review unavailable'})}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"});
   return res.end(page);
  }
  if(req.method==='GET'&&requestPath==='/bank-connect'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' https://cdn.plaid.com; style-src 'unsafe-inline'; frame-src https://*.plaid.com; connect-src 'self' https://*.plaid.com; img-src 'self' data:; form-action 'self'"});return res.end(await html())}
  const staticPath=requestPath.slice(1);
  const allowed=/^(?:index[.]html|modern[.]css|planner[.]css|(?:planner|demo-data|forecast|forecast-ledger|accounting|categorization|ledger-data|account-forecast|payment-obligations|planner-intelligence|planner-backtest|planner-transactions|planner-history|planner-recurrence|planner-core|planner-summary|planner-coverage|bank-feed|cashflow|recurring|reviews)[.]js|sandbox[/]sandbox-ui[.]js|pilot[/]data-source[.]js|manifest[.]webmanifest|ledger-icon[.]png)$/;
  if(req.method==='GET'&&(requestPath==='/'||allowed.test(staticPath))){
   const name=staticPath||'index.html';
   let body;
   try{body=await fs.readFile(path.resolve(__dirname,'..',name))}
   catch(error){
    // Never crash the bank server on a browser request for a missing asset.
    if(error.code==='ENOENT')return respond(404,{error:'Static asset not found'});
    process.stderr.write('Static read failed: '+String(error.code||'unknown').slice(0,30)+'\n');
    return respond(500,{error:'Static asset temporarily unavailable'});
   }
   if(name==='index.html'){
    // Ship the required classifier atomically with the private page. If Safari
    // drops a separate script request, the data model used to crash when it
    // reached a Plaid expense; do not let partial resource delivery corrupt a
    // balance forecast. Keep ONE source file; do not copy classification rules.
    let classifier;
    try{classifier=await fs.readFile(path.resolve(__dirname,'../categorization.js'),'utf8')}
    catch(error){
     process.stderr.write('Private UI dependency missing: categorization.js\n');
     return respond(503,{error:'Required calendar component is unavailable. Reload after deployment; no bank data was changed.'});
    }
    let page=body.toString('utf8');
    const dependency='<script src="categorization.js"></script>';
    if(!page.includes(dependency))
     return respond(503,{error:'Required calendar script order is unavailable. Please reload after deployment.'});
    // The private adapter must execute AFTER accounting + categorization and
    // BEFORE ledger-data/planner initialization. Injecting in <head> previously
    // captured null dependency constants permanently, even on successful loads.
    page=page.replace(dependency,'<script>\n'+classifier+'\n</script>\n'+
     '<script src="/pilot/data-source.js"></script>');
    body=Buffer.from(page);
   }
   res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.png')?'image/png':name.endsWith('.webmanifest')?'application/manifest+json':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self' https://cdn.plaid.com; script-src 'self' 'unsafe-inline' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; frame-src https://*.plaid.com; connect-src 'self' https://*.plaid.com; img-src 'self' data: https://*.plaid.com",
   ...(upgradeCookie?{'Set-Cookie':upgradeCookie}:{})});
   return res.end(body);
  }
  if(req.method==='GET'&&requestPath==='/api/ledger'){
   const payload=ledgerPayload();
   if(!payload.connected)return respond(200,payload);
   // Every tab receives one coherent snapshot. Old/partial deployments or an
   // optional forecast failure still return the unmodified authoritative
   // bank payload, allowing the existing client calculation to run.
   let ready=null;
   try{ready=preparedFor(payload)}catch(_error){preparedCache=null}
   return respond(200,ready?{...payload,preparedForecast:ready}:payload);
  }
  if(req.method==='GET'&&requestPath==='/api/ledger/reconciliation-audit'){
   // Private, read-only. The full-history option reports aggregate counts,
   // never transaction identifiers, merchant labels or banking secrets.
   const params=new URL(req.url,'http://localhost').searchParams;
   if(params.get('scope')==='all'&&[...params.keys()].every(k=>k==='scope')){
    if(!state.items.length)return respond(409,{error:'No bank account connected'});
    try{return respond(200,require('./reconciliation-inspection.cjs').auditAll(
      preparedFor(ledgerPayload())));}
    catch{return respond(503,{error:'Source reconciliation audit unavailable'});}
   }
   // The existing one-day source-pair inspection remains supported.
   const dates=params.getAll('date');
   if(dates.length!==1||[...params.keys()].some(k=>k!=='date')||
      !/^\d{4}-\d{2}-\d{2}$/.test(dates[0]))
    return respond(400,{error:'Supply one ISO date'});
   if(!state.items.length)return respond(409,{error:'No bank account connected'});
   try{
    const prepared=preparedFor(ledgerPayload());
    return respond(200,require('./reconciliation-inspection.cjs').inspect(prepared,dates[0]));
   }catch{
    return respond(503,{error:'Canonical source reconciliation audit unavailable'});
   }
  }
  if(req.method==='GET'&&requestPath==='/api/status'){
   const refs=new Map(accountForecastLinks(state).map(x=>[x.id,x]));
   return respond(200,{connected:state.items.length>0,account:state.accounts[0]||null,
    accounts:state.accounts.map(a=>({...a,forecastUsage:refs.get(String(a.id)),
      needsReconnect:state.items.some(i=>i.reconnectRequired&&i.accountIds.includes(String(a.id))),
      syncIssue:state.items.find(i=>i.accountIds.includes(String(a.id)))?.syncIssue||null})),
    lastSync:state.lastSync,diagnostics:bankDiagnostics(),
    remoteDisconnectPending:pendingRevocations().length,
    transactions:Object.values(state.transactions).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,500)});
  }
  if(req.method==='GET'&&requestPath==='/api/ai/qaqc')return respond(200,qaReports.status());
  if(req.method==='GET'&&requestPath==='/api/ai/report'){
   // Read-only status never queues an external API request.
   return respond(200,{...aiReports.status(),
    analysisModel:env.OPENAI_OUTLOOK_MODEL||env.OPENAI_REPORT_MODEL||'gpt-6.2-astra'});
  }
 // Unknown browser navigation should be a 404, not a misleading bank-action error.
  if(req.method==='GET'||req.method==='HEAD')return respond(404,{error:'Not found'});
  if(req.method!=='POST'||req.headers['x-pilot-action']!=='1')return respond(403,{error:'Action header required'});
  let body={};try{let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>524288)return respond(413,{error:'Adjustments too large'});chunks.push(chunk)}body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{return respond(400,{error:'Invalid JSON'})}
  if(requestPath==='/api/ai/settings'){
   // Backward-compatible opt-out: old clients cannot re-enable automatic calls.
   if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).sort().join(',')!=='consent,enabled,scope'||
      typeof body.enabled!=='boolean'||body.scope!=='financial-analysis-auto-v1')
    return respond(400,{error:'Invalid legacy AI Analysis settings'});
   if(body.enabled&&body.consent!==true)return respond(400,{error:'Explicit consent required for any external AI sharing'});
   if(body.enabled)return respond(410,{
    error:'Automatic AI Analysis has been retired. Run Analysis or QA/QC manually.'});
   try{return respond(200,await aiReports.setEnabled(false))}
   catch{return respond(503,{error:'Could not retire automatic AI Analysis preferences'})}
  }
  if(requestPath==='/api/ai/qaqc'){
   // One-time owner authorization, never automatic sharing or a bank mutation.
   if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).sort().join(',')!=='consent,scope'||
      body.consent!==true||body.scope!=='ledger-qaqc-v1')
    return respond(400,{error:'Explicit consent required for Ledger AI QA/QC',
     code:'analysis_consent_required'});
   if(!env.OPENAI_API_KEY)return respond(503,{error:'AI QA/QC is not configured'});
   if(!state.items.length)return respond(409,{error:'Connect an account before running QA/QC'});
   if(accountRemovalBusy)return respond(409,{error:'Account changes are in progress'});
   qaReports.schedule({force:true});
   return respond(202,qaReports.status());
  }
  if(requestPath==='/api/ai/analyze'){
   // Manual refresh remains opt-in, but never makes a browser wait for a
   // multi-pass investigation. The same encrypted cache serves future views.
   if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).sort().join(',')!=='consent,scope'||
      body.consent!==true||body.scope!=='financial-analysis-v3')
    return respond(400,{error:'Explicit consent required for financial analysis',
     code:'analysis_consent_required'});
   if(!env.OPENAI_API_KEY)return respond(503,{error:'AI not configured on this private server'});
   if(!state.items.length)return respond(409,{error:'Connect an account first'});
   aiReports.schedule({force:true});
   return respond(202,aiReports.status());
  }
  if(requestPath==='/api/ai/chat'){
   // Every turn explicitly authorizes scoped, read-only AI investigations.
   // Client-supplied bank records and server-side financial writes are excluded.
   if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).sort().join(',')!=='consent,history,question,scope'||
      body.consent!==true||body.scope!=='financial-chat-v1')
    return respond(400,{error:'Explicit consent required for financial chat',code:'chat_consent_required'});
   if(!env.OPENAI_API_KEY)return respond(503,{error:'AI chat is not configured on this private server'});
   if(!state.items.length)return respond(409,{error:'Connect a bank account first'});
   if(typeof body.question!=='string'||body.question.length>2000||
      !Array.isArray(body.history)||body.history.length>12)
    return respond(400,{error:'Invalid financial chat request',code:'invalid_chat_request'});
   let context;
   try{
    const projection=preparedFor(ledgerPayload());
    context=require('./ai-financial-report.cjs').financialContext(projection,{
     lastSync:state.lastSync,adjustments:state.ledgerAdjustments});
   }catch{
    return respond(409,{error:'Verified financial forecast context is unavailable',code:'forecast_context_unavailable'});
   }
   try{
    const answer=await require('./ai-chat.cjs').chatTurn({
     context,consent:'financial-chat-v1',question:body.question,
     history:body.history,apiKey:env.OPENAI_API_KEY,
     model:env.OPENAI_REPORT_MODEL||'gpt-4.1'
    });
    return respond(200,answer);
   }catch(error){
    const allowed=['invalid_api_key','permission_denied','rate_limit_or_quota','invalid_request',
     'provider_unavailable','provider_rejected','analysis_timeout','provider_connection_failed',
     'invalid_provider_response','invalid_ai_json','invalid_ai_schema','invalid_ai_evidence'];
    const code=allowed.includes(error?.safeCode)?error.safeCode:
     error?.message==='Invalid conversation history'||error?.message==='Invalid conversation turn'||
     error?.message==='Invalid question'?'invalid_chat_request':'analysis_failed';
    return respond(code==='invalid_chat_request'?400:503,{
     error:'Financial chat could not complete. No financial records were changed.',code});
   }
  }
  if(requestPath==='/api/ai/report'){
   // Broader, new data-sharing scope: explicit consent on every run.
   if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).sort().join(',')!=='consent,scope'||
      body.consent!==true||body.scope!=='financial-outlook-v2')
    return respond(400,{error:'Explicit consent required for financial analysis',code:'report_consent_required'});
   if(!env.OPENAI_API_KEY)return respond(503,{error:'AI analysis is not configured on the private server'});
   if(!state.items.length)return respond(409,{error:'Connect a bank account first'});
   let context;
   try{
    const projection=preparedFor(ledgerPayload());
    context=require('./ai-financial-report.cjs').financialContext(projection,{
     lastSync:state.lastSync,adjustments:state.ledgerAdjustments});
   }catch(_error){
    return respond(409,{error:'Verified financial forecast context is unavailable. The report was not generated.',code:'forecast_context_unavailable'});
   }
   try{
    // One model-guided investigation pass. The model only asks bounded,
    // allowlisted questions. Ledger answers from existing in-RAM authoritative
    // source records, never direct model-selected APIs or database commands.
    const investigator=require('./ai-report-investigator.cjs');
    const model=env.OPENAI_REPORT_MODEL||'gpt-4.1';
    const requests=await investigator.planInvestigations({
     context,apiKey:env.OPENAI_API_KEY,model
    });
    const investigation=investigator.investigate(context,requests);
    for(const fact of investigation.facts){
     context.facts.push(fact);context.factIndex.set(fact.id,fact);
    }
    context.investigation={details:investigation.requests,
     factsExamined:investigation.facts.length,
     requestsExecuted:investigation.requestsExecuted};
    const report=await require('./ai-financial-report.cjs').analyzeFinancialOutlook({
     context,consent:'financial-outlook-v2',apiKey:env.OPENAI_API_KEY,model
    });
    // Response remains read-only and uses aliased references, never source IDs.
    return respond(200,report);
   }catch(error){
    const code=['invalid_api_key','permission_denied','rate_limit_or_quota','invalid_request',
     'provider_unavailable','provider_rejected','analysis_timeout','provider_connection_failed',
     'invalid_provider_response','invalid_ai_json','invalid_ai_schema','invalid_ai_evidence'].includes(error?.safeCode)?
     error.safeCode:'analysis_failed';
    return respond(503,{error:'AI financial analysis could not complete. No financial data was changed.',code});
   }
  }
  if(requestPath==='/api/ai/analyze'){
   if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).length!==1||body.consent!==true)
    return respond(400,{error:'Explicit consent required for each AI analysis'});
   if(!env.OPENAI_API_KEY)return respond(503,{error:'AI analysis is not configured on the private server'});
   if(!state.items.length)return respond(409,{error:'Connect a bank account first'});
   const accounts=state.accounts.filter(a=>a&&typeof a.id==='string').map(a=>({id:a.id}));
   const allowed=new Set(accounts.map(a=>a.id));
   const transactions=Object.values(state.transactions).filter(t=>
    t&&typeof t.id==='string'&&allowed.has(t.accountId)&&
    typeof t.amount==='number'&&Number.isFinite(t.amount)&&
    /^\d{4}-\d{2}-\d{2}$/.test(String(t.date||'')))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,240)
    .map(t=>({id:t.id,accountId:t.accountId,date:t.date,amount:t.amount,
      description:t.merchant||t.name||''}));
   if(!transactions.length)return respond(200,{proposals:[]});
   try{
    const proposals=await require('./ai-private-adapter.cjs').analyze({
     transactions,accounts,consent:true,apiKey:env.OPENAI_API_KEY,
     model:env.OPENAI_MODEL||'gpt-4.1-mini'});
    // Compare suggestions locally with Ledger's existing canonical expected events.
    // The private forecast is never included in the external model request.
    let visible=proposals;
    try{
     const prepared=preparedFor(ledgerPayload());
     if(prepared?.bundle?.ledger)
      visible=require('./ai-forecast-reconcile.cjs').reconcile(proposals,transactions,prepared.bundle.ledger);
    }catch(_ignored){/* A failed optional comparison must not change financial data. */}
    return respond(200,{proposals:visible});
   }catch(error){
    const code=['invalid_api_key','permission_denied','rate_limit_or_quota','invalid_request',
     'provider_unavailable','provider_rejected','analysis_timeout','provider_connection_failed',
     'invalid_provider_response','invalid_ai_findings','invalid_ai_json',
     'invalid_ai_schema','invalid_ai_evidence','invalid_ai_account'].includes(error?.safeCode)?error.safeCode:'analysis_failed';
    return respond(503,{error:'AI analysis could not complete. No financial data was changed.',code});
   }
  }
  // Bank sync and account connection changes share the same state and encrypted
  // bank file as category/forecast edits. Serialize the entire mutation,
  // including Plaid staging, not merely the final rename: a sync must not
  // publish a snapshot computed before an overlapping user decision.
  const mutatesBankState=requestPath.startsWith('/api/ledger/')||
   ['/api/sync','/api/exchange','/api/accounts/remove','/api/disconnect',
    '/api/backup/export'].includes(requestPath);
  let releaseEdit=null;
  if(mutatesBankState){
   const previousEdit=householdEditQueue;
   householdEditQueue=new Promise(resolve=>{releaseEdit=resolve});
   await previousEdit;
  }
  try{
   // Prevent an outdated device from overwriting newer household settings.
   const expected=req.headers['x-ledger-revision'];
   if(requestPath.startsWith('/api/ledger/')&&expected&&expected!==settingsRevision()&&
      !(requestPath==='/api/ledger/forecasts'&&body?.predictions&&
        JSON.stringify(body.predictions)===JSON.stringify(state.ledgerAdjustments?.predictions||{})))
    return respond(409,{error:staleMessage,code:'STALE_LEDGER'});
   if(accountRemovalBusy&&[
    '/api/ledger/forecasts','/api/ledger/adjustments','/api/ledger/category',
     '/api/ledger/category-rule','/api/ledger/categories/delete','/api/ledger/categories/rename',
    '/api/ledger/credit-kind','/api/exchange',
    '/api/sync','/api/disconnect','/api/accounts/remove'
   ].includes(requestPath))
    return respond(409,{error:'An account removal is in progress. Refresh and try again.'});
   if(requestPath==='/api/ledger/categories/rename'){
    if(!state.items.length)return respond(409,{error:'No bank account connected'});
    if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).sort().join(',')!=='from,to'||
     typeof body.from!=='string'||typeof body.to!=='string'||
     !body.from||!body.to||body.from.length>40||body.to.length>40)
     return respond(400,{error:'Choose a category and its new name'});
    const M=require('../ledger-data.js'),feed=require('./data-source.js'),
     before=JSON.parse(JSON.stringify(state.ledgerAdjustments||{})),
     accounts=new Map(state.accounts.map(a=>[String(a.id),a]));
    // Recompute effective assignments against server-authoritative bank rows.
    // Never trust client-supplied IDs or let this endpoint write Plaid facts.
    const rows=Object.values(state.transactions).map(tx=>{
     const account=accounts.get(String(tx.accountId));
     return account?feed.record(tx,account):null;
    }).filter(Boolean);
    const decision=M.migrate({transactions:rows,predictions:before.predictions||{},
     categoryOverrides:before.categoryOverrides||{},learning:before.learning||{},
     reviews:before.reviews||{}});
    let renamed;
    try{renamed=M.renameCategory(decision,body.from,body.to)}
    catch(error){return respond(400,{error:String(error.message||error)})}
    try{
     await saveForecast(decision.predictions);
     state.ledgerAdjustments={...before,predictions:decision.predictions,
      categoryOverrides:decision.categoryOverrides,learning:decision.learning};
     await save();
    }catch(error){
     state.ledgerAdjustments=before;
     try{await saveForecast(before.predictions||{})}catch{}
     throw error;
    }
    return respond(200,{saved:true,scope:'category-rename',from:renamed.from,to:renamed.to});
   }
   if(requestPath==='/api/ledger/categories/delete'){
    if(!state.items.length)return respond(409,{error:'No bank account connected'});
    if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).length!==1||typeof body.category!=='string'||
     !body.category||body.category.length>40)
     return respond(400,{error:'Choose a category to delete'});
    const M=require('../ledger-data.js'),feed=require('./data-source.js'),
     before=JSON.parse(JSON.stringify(state.ledgerAdjustments||{})),
     accounts=new Map(state.accounts.map(a=>[String(a.id),a]));
    // The server determines all matching bank IDs from its authoritative feed.
    // The client supplies only the name, not bank history or predicted rows.
    const rows=Object.values(state.transactions).map(tx=>{
     const account=accounts.get(String(tx.accountId));
     return account?feed.record(tx,account):null;
    }).filter(Boolean);
    const decision=M.migrate({transactions:rows,predictions:before.predictions||{},
     categoryOverrides:before.categoryOverrides||{},learning:before.learning||{},
     reviews:before.reviews||{}});
    let removed;
    try{removed=M.removeCategory(decision,body.category)}
    catch(error){return respond(400,{error:String(error.message||error)})}
    try{
     await saveForecast(decision.predictions);
     state.ledgerAdjustments={...before,predictions:decision.predictions,
      categoryOverrides:decision.categoryOverrides,learning:decision.learning};
     await save();
    }catch(error){
     state.ledgerAdjustments=before;
     try{await saveForecast(before.predictions||{})}catch{}
     throw error;
    }
    return respond(200,{saved:true,scope:'category-deletion',category:removed,
     unassigned:rows.filter(row=>decision.categoryOverrides[row.id]==='Uncategorized').length});
   }
   if(requestPath==='/api/ledger/credit-kind'){
    // A scoped owner decision, never a mutation of Plaid transactions.
    // An uncertain bank credit stays out of earned income until confirmed.
    if(!state.items.length)return respond(409,{error:'No bank account connected'});
    if(!body||typeof body!=='object'||Array.isArray(body)||
       Object.keys(body).sort().join(',')!=='kind,transactionId'||
       !['income','refund','transfer','reset'].includes(body.kind)||
       typeof body.transactionId!=='string'||!body.transactionId)
      return respond(400,{error:'Choose a valid incoming credit type'});
    const tx=state.transactions[body.transactionId],
     account=state.accounts.find(a=>String(a.id)===String(tx?.accountId));
    if(!tx||!account||!Number.isFinite(Number(tx.amount))||Number(tx.amount)>=0||
       ['credit','loan'].includes(String(account.type||'').toLowerCase()))
      return respond(400,{error:'Only incoming cash-account bank credits can be reviewed'});
    const before=state.ledgerAdjustments||{},
     reviews={...(before.reviews||{}),
      transactionKinds:{...(before.reviews?.transactionKinds||{})}};
    if(body.kind==='reset')delete reviews.transactionKinds[body.transactionId];
    else reviews.transactionKinds[body.transactionId]=body.kind;
    state.ledgerAdjustments={...before,reviews};
    try{await save()}catch(error){state.ledgerAdjustments=before;throw error}
    return respond(200,{saved:true,scope:'credit-kind'});
   }
   if(requestPath==='/api/ledger/category'){
    // Scoped, read-only-source classification adjustment. Never upload entire
    // bank history or a stale prediction snapshot to change one row's category.
    if(!state.items.length)return respond(409,{error:'No bank account connected'});
    if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).some(k=>!['transactionId','category','remember'].includes(k))||
     (body.remember!==undefined&&body.remember!==true)||
     Object.keys(body).length!==(body.remember===true?3:2))return respond(400,{error:'Invalid category change'});
    const id=String(body.transactionId||'');
    if(!Object.prototype.hasOwnProperty.call(state.transactions,id))
     return respond(400,{error:'Unknown bank transaction'});
    const allowedCats=savedCategoryChoices(state.ledgerAdjustments?.predictions,
     state.ledgerAdjustments?.customCategories);
    const selected=body.category===null?null:
     allowedCats.find(c=>c.toLowerCase()===String(body.category).toLowerCase());
    if(body.category!==null&&!selected)return respond(400,{error:'Invalid category'});
    const before=state.ledgerAdjustments||{};
    const overrides={...(before.categoryOverrides||{})};
    if(body.category===null)delete overrides[id];else overrides[id]=selected;
    let learned=null,nextLearning=null;
    if(body.remember===true&&selected&&!['Other','Uncategorized'].includes(selected)){
     // Rebuild source-backed normalized facts. Never trust a browser-supplied
     // merchant, category history or learned rule.
     const feed=require('./data-source.js'),model=require('../ledger-data.js'),
      byAccount=new Map(state.accounts.map(a=>[String(a.id),a]));
     const rows=Object.values(state.transactions).map(tx=>{
      const account=byAccount.get(String(tx.accountId));
      return account?feed.record(tx,account):null;
     }).filter(Boolean);
     const source=rows.find(tx=>tx.id===id);
     if(source?.type==='expense'){
      const decision=model.migrate({transactions:rows,categoryOverrides:overrides,
       learning:before.learning||{},predictions:before.predictions||{}});
      learned=model.learnCategory(decision,id,selected);
      nextLearning=decision.learning;
     }
    }
    state.ledgerAdjustments={...before,categoryOverrides:overrides,
     ...(nextLearning?{learning:nextLearning}:{})};
    try{await save()}catch(error){
     state.ledgerAdjustments=before;
     throw error;
    }
    return respond(200,{saved:true,scope:'category',learningMode:learned?.mode||null});
   }
   if(requestPath==='/api/ledger/category-rule'){
    if(!state.items.length)return respond(409,{error:'No bank account connected'});
    if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).length!==1||typeof body.ruleKey!=='string'||
     !body.ruleKey||body.ruleKey.length>900)
     return respond(400,{error:'Invalid category rule'});
    const before=state.ledgerAdjustments||{},current=before.learning||{};
    if(!Object.prototype.hasOwnProperty.call(current.categoryRules||{},body.ruleKey))
     return respond(404,{error:'Learned category no longer exists'});
    const next={learning:JSON.parse(JSON.stringify(current))};
    require('../ledger-data.js').removeCategoryRule(next,body.ruleKey);
    state.ledgerAdjustments={...before,learning:next.learning};
    try{await save()}catch(error){state.ledgerAdjustments=before;throw error}
    return respond(200,{saved:true,scope:'category-rule'});
   }
   if(requestPath==='/api/ledger/forecasts'){
    // Forecast rules are not edits to Plaid transactions, balances, or
    // classification overrides. Persist them separately to prevent an
    // unrelated stale category override from blocking a confirmed payment.
    if(!state.items.length)return respond(409,{error:'Connect a bank account before saving a private forecast'});
    if(!body||typeof body!=='object'||Array.isArray(body)||
       Object.keys(body).length!==1||
       !Object.prototype.hasOwnProperty.call(body,'predictions')||
       !body.predictions||typeof body.predictions!=='object'||
       Array.isArray(body.predictions))
     return respond(400,{error:'Invalid forecast preferences'});
    // All bank facts are untouched. A retry of this snapshot is idempotent.
    await saveForecast(body.predictions,req.headers['x-ledger-revision']);
    return respond(200,{saved:true,scope:'predictions'});
   }
   if(requestPath==='/api/ledger/adjustments'){
    if(!state.items.length)return respond(409,{error:'No bank account connected'});
    if(!body||typeof body!=='object'||Array.isArray(body))return respond(400,{error:'Invalid preferences'});
    const allowed=['categoryOverrides','predictions','reviews','learning','customCategories'];
    if(Object.keys(body).some(k=>!allowed.includes(k)))return respond(400,{error:'Bank source fields may not be changed'});
    for(const keyName of allowed){if(body[keyName]!==undefined&&(body[keyName]===null||typeof body[keyName]!=='object'||Array.isArray(body[keyName])&&keyName!=='customCategories'))return respond(400,{error:'Invalid '+keyName})}
    const allowedCats=new Set(savedCategoryChoices(body.predictions||
     state.ledgerAdjustments?.predictions,body.customCategories||
     state.ledgerAdjustments?.customCategories));
    if(body.customCategories&&(body.customCategories.length>50||body.customCategories.some(c=>typeof c!=='string'||c.length<2||c.length>40||!/^[A-Za-z0-9][A-Za-z0-9 &'().-]*$/.test(c))))return respond(400,{error:'Invalid custom categories'});
    if(body.categoryOverrides){
     const ids=new Set(Object.keys(state.transactions).map(String));
     if(Object.entries(body.categoryOverrides).some(([id,category])=>!ids.has(id)||!allowedCats.has(category)))return respond(400,{error:'Invalid category override'});
    }
    // Never permit source records, Plaid tokens, or provider balances in adjustment writes.
    state.ledgerAdjustments=Object.fromEntries(allowed.filter(k=>body[k]!==undefined).map(k=>[k,body[k]]));
    await save();
    // Keep compatibility with the older adjustments route, while the new
    // app only writes future-ledger settings through /forecasts.
    if(body.predictions!==undefined)await saveForecast(body.predictions);
    return respond(200,{saved:true});
   }
   if(requestPath==='/api/analysis/export'){
    // Explicit first-party user action, fully authenticated and same-origin.
    // Never call OpenAI, sync a bank, write a file or expose provider secrets.
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)
     return respond(400,{error:'Unexpected analysis export options'});
    if(!state.items.length)return respond(409,{error:'Connect a bank account before exporting'});
    if(accountRemovalBusy)return respond(409,{error:'Account changes are in progress. Retry shortly.'});
    await forecastWrites;
    let document;
    try{
     const prepared=preparedFor(ledgerPayload());
     document=require('./analysis-export.cjs').build({
      prepared,adjustments:state.ledgerAdjustments,lastSync:state.lastSync,
      // Restrict the manual download to sync outcomes and codes. Never
      // include account IDs, Item identifiers, provider messages or request IDs.
      syncDiagnostics:{lastAttempt:lastSyncAttempt,
       issues:state.items.filter(i=>i.syncIssue).map(i=>({
        code:i.syncIssue.code,observedAt:i.syncIssue.observedAt}))}
     });
    }catch{
     return respond(503,{error:'The complete canonical analysis dataset is not available. No data was changed.'});
    }
    const bytes=Buffer.from(JSON.stringify(document));
    // Never silently truncate the transaction or projection source.
    if(bytes.length>50*1024*1024)return respond(413,{
     error:'Analysis export exceeds the safe download size. No partial file was generated.'
    });
    const today=require('./prepared-forecast.cjs').pacificDate();
    res.writeHead(200,{
     'Content-Type':'application/json; charset=utf-8',
     'Content-Disposition':'attachment; filename="ledger-analysis-'+today+'.json"',
     'Content-Length':bytes.length,
     'Cache-Control':'private, no-store, max-age=0',
     'Pragma':'no-cache','X-Content-Type-Options':'nosniff',
     'Referrer-Policy':'no-referrer',
     'Content-Security-Policy':"default-src 'none'"
    });
    return res.end(bytes);
   }
   if(requestPath==='/api/backup/export'){
    // A backup is a serialized, read-only snapshot. No archive or passphrase
    // is written to the server filesystem or logged. Authentication, Origin,
    // and the explicit action header were enforced above.
    if(!body||typeof body!=='object'||Array.isArray(body)||
       Object.keys(body).length!==1||typeof body.passphrase!=='string'||
       body.passphrase.length<20||body.passphrase.length>512)
     return respond(400,{error:'Use a private recovery passphrase of at least 20 characters'});
    await forecastWrites;
    await auth.flush();
    let archive;
    try{
     archive=await require('./portable-backup.cjs').capture({
      statePath:file,secret:env.PILOT_ENCRYPTION_KEY,passphrase:body.passphrase
     });
    }catch(error){
     // Authentication-tag or disk-integrity failure must fail closed.
     // Do not reveal keys, existing filenames, tokens or private records.
     return respond(503,{error:'Could not verify the encrypted Ledger data for backup. No backup was created.'});
    }
    const today=new Date().toISOString().slice(0,10);
    res.writeHead(200,{
     'Content-Type':'application/octet-stream',
     'Content-Disposition':'attachment; filename="ledger-private-'+today+'.ledgerbackup"',
     'Content-Length':archive.length,
     'Cache-Control':'private, no-store, max-age=0',
     'X-Content-Type-Options':'nosniff',
     'Referrer-Policy':'no-referrer',
     'Content-Security-Policy':"default-src 'none'"
    });
    return res.end(archive);
   }
   if(requestPath==='/api/link-token'){
    const id=body?.reconnectAccountId;
    if(id!==undefined){
     if(typeof id!=='string'||!id||Object.keys(body).length!==1)return respond(400,{error:'Choose one connected account to reconnect'});
     const item=state.items.find(i=>i.accountIds.includes(id));
     if(!item)return respond(404,{error:'That bank account is no longer connected. Refresh the list.'});
     // Use the existing Item token in Link update mode. No new Item and no
     // exchange, disconnect or account ID changes.
     const t=await plaid('/link/token/create',{user:{client_user_id:'household-ledger-private-household'},
      client_name:'Household Ledger',country_codes:['US'],language:'en',access_token:item.token});
     return respond(200,{link_token:t.link_token,mode:'update'});
    }
    if(!body||Object.keys(body).length!==0)return respond(400,{error:'Unexpected bank connection options'});
    const t=await plaid('/link/token/create',{user:{client_user_id:'household-ledger-private-household'},
     client_name:'Household Ledger',products:['transactions'],country_codes:['US'],language:'en'});
    return respond(200,{link_token:t.link_token,mode:'create'});
   }
   if(requestPath==='/api/exchange'){
    // Never attach new accounts while a former household's independent
    // forecast file might still be present after an interrupted reset.
    if(state.forecastResetRequired)
     return respond(503,{error:'Previous household disconnect is still being finalized. Restart Ledger and try again.'});
    if(!body.publicToken||!Array.isArray(body.accountIds)&&!body.accountId)throw Error('Choose at least one account');
    const ids=[...new Set((Array.isArray(body.accountIds)?body.accountIds:[body.accountId]).map(String))];
    if(!ids.length||ids.length>30)throw Error('Choose 1–30 accounts');
    const x=await plaid('/item/public_token/exchange',{public_token:body.publicToken});
    // Never revoke the original Item when the exchanged token refers to an
    // already-connected bank. This check must precede ANY cleanup.
    if(state.items.some(i=>i.id===x.item_id||i.token===x.access_token)||
       pendingRevocations().some(i=>i.id===x.item_id))
     return respond(409,{code:'ALREADY_CONNECTED',
      error:'Bank is already connected. Use Reconnect without losing saved data beside the original account.'});
    let retained=false,inserted=false;
    try{
     const response=await plaid('/accounts/get',{access_token:x.access_token});
     for(const id of ids){
      const a=response.accounts.find(y=>y.account_id===id&&['depository','credit'].includes(y.type));
      if(!a)throw Error('Select only eligible bank or credit accounts');
      if(state.accounts.some(y=>y.id===id))throw Error('This account is already connected');
      // Plaid can assign a new account ID to the same underlying bank.
      // Refuse a confident duplicate instead of orphaning stored metadata.
      if(a.mask&&String(a.mask).length>=3&&state.accounts.some(old=>
       old.mask&&String(old.mask)===String(a.mask)&&old.type===a.type&&
       old.subtype===a.subtype&&String(old.name||'').trim().toLowerCase()===
        String(a.name||'').trim().toLowerCase())){
       const error=new Error('A matching bank account is already saved. Use Reconnect without losing saved data for the existing account.');
       error.httpStatus=409;throw error;
      }
     }
     state.items.push({id:x.item_id,token:x.access_token,cursor:null,accountIds:ids});
     inserted=true;
     await sync();retained=true;
     return respond(200,{connected:true,accounts:state.accounts.length});
    }catch(error){
     // Only an Item added by this attempt may be rolled back.
     if(inserted){state.items=state.items.filter(i=>i.id!==x.item_id);await save()}
     throw error;
    }finally{if(!retained)try{await plaid('/item/remove',{access_token:x.access_token})}catch{}}
   }
   if(requestPath==='/api/sync'){await sync();return respond(200,{ok:true,accounts:state.accounts.length})}
   if(requestPath==='/api/accounts/remove'){
    if(!body||typeof body.accountId!=='string'||!body.accountId||
       body.accountId.length>256||Object.keys(body).length!==1)
     return respond(400,{error:'Choose exactly one connected account'});
    accountRemovalBusy=true;
    try{
     await forecastWrites;
     const id=body.accountId,account=state.accounts.find(a=>String(a.id)===id),
      owners=state.items.filter(i=>i.accountIds.includes(id));
     if(!account||owners.length!==1||String(account.itemId)!==String(owners[0].id))
      return respond(404,{error:'This account is no longer connected. Refresh the list.'});
     const linked=accountForecastLinks(state).find(x=>x.id===id);
     if(!linked||linked.protected)
      return respond(409,{error:'This account has saved forecast settings or edited transactions. Reassign those edits before removing it.'});
     const item=owners[0],revoke=item.accountIds.length===1;
     const previous=state,transactions={},removedIds=new Set();
     for(const [txId,t] of Object.entries(state.transactions)){
      if(String(t.accountId||'')===id||
        !t.accountId&&state.accounts.length===1)removedIds.add(txId);
      else transactions[txId]=t;
     }
     const overrides={...(state.ledgerAdjustments?.categoryOverrides||{})};
     for(const txId of removedIds)delete overrides[txId];
     const next={...state,accounts:state.accounts.filter(a=>String(a.id)!==id),
      items:state.items.flatMap(i=>i.id!==item.id?[i]:
       revoke?[]:[{...i,accountIds:i.accountIds.filter(a=>a!==id)}]),
      transactions,ledgerAdjustments:{...state.ledgerAdjustments,categoryOverrides:overrides},
      ...(revoke?{pendingRevocations:[...pendingRevocations(),
       {id:item.id,token:item.token}]}:{})};
     // Commit FIRST. Failed disk persistence never triggers Plaid revocation.
     await atomicEncryptedWrite(file,next);state=next;
     if(revoke)try{await finishPendingRevocation(item.id)}
     catch(error){
      // Restore a failed provider removal only if a read-only Item check
      // confirms the token is still valid AND that rollback itself is durable.
      // An acknowledged revoke must never be rolled back locally.
      if(!error.revocationAcknowledged){
       let active=false;
       try{await plaid('/item/get',{access_token:item.token});active=true}catch{}
       if(active){
        try{await atomicEncryptedWrite(file,previous);state=previous}catch{}
        if(state===previous)throw error;
       }
      }
      return respond(202,{removed:true,remainingAccounts:state.accounts.length,
       disconnectedInstitution:false,remoteDisconnectPending:true});
     }
     return respond(200,{removed:true,remainingAccounts:state.accounts.length,
      disconnectedInstitution:revoke});
    }finally{accountRemovalBusy=false}
   }
   if(requestPath==='/api/disconnect'){
    await forecastWrites;
    // Commit removal of ALL active Items and the encrypted retry journal
    // before the first irreversible remote revoke. The reset marker guards
    // against replaying a former household's separate forecast file.
    const queue=[...pendingRevocations(),...state.items.map(item=>({
     id:item.id,token:item.token}))];
    const next={...freshState(),pendingRevocations:queue,forecastResetRequired:true};
    await atomicEncryptedWrite(file,next);state=next;
    try{await fs.unlink(forecastFile)}catch(e){if(e.code!=='ENOENT')throw e}
    const resetDone={...state};delete resetDone.forecastResetRequired;
    await atomicEncryptedWrite(file,resetDone);state=resetDone;
    // Never retain a previous household's derived financial analysis or
    // standing external-sharing authorization after disconnect.
    await aiReports.clear();
     await qaReports.clear();
    const remaining=await resumePendingRevocations();
    return respond(remaining?202:200,{ok:true,
     ...(remaining?{remoteDisconnectPending:remaining}:{})});
   }
   return respond(404,{error:'Unknown action'});
  }catch(e){
   if(e.plaidCode){
    return respond(e.plaidCode==='ITEM_LOGIN_REQUIRED'?409:e.plaidCode==='INVALID_FIELD'?502:400,{
     error:e.plaidCode==='ITEM_LOGIN_REQUIRED'?
      'Your bank needs you to sign in again before new transactions can be fetched.':
      e.plaidCode==='INVALID_FIELD'?
       'Plaid rejected a request field. This is not proof your bank login failed; the saved bank history and forecasts are intact.':
       'Plaid request failed: '+e.plaidCode,
     code:e.plaidCode,
     ...(e.plaidEndpoint?{endpoint:e.plaidEndpoint}:{}),
     ...(e.plaidField?{field:e.plaidField}:{}),
     ...(e.plaidRequestId?{requestId:e.plaidRequestId}:{}),
     ...(e.reconnectAccountId?{reconnectAccountId:e.reconnectAccountId}:{})
    });
   }
   return respond(e.httpStatus||400,{error:String(e.message).slice(0,140),
    ...(e.httpStatus===409?{code:'STALE_LEDGER'}:{})})
  }finally{
   if(releaseEdit)releaseEdit();
  }
 });
 return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',()=>{
  // Automatic server-side re-preparation, never a background Plaid sync.
  // A sleeping Render instance cannot execute hourly tasks until it wakes.
  // Resume interrupted provider revocations without blocking health checks.
  // Keep cleanup behind the same queue as bank sync and preference edits.
  scheduleRevocationRecovery();
  schedulePrepared();
  // Server restart never makes a paid AI call.
  const hourly=setInterval(()=>{
   invalidatePrepared();schedulePrepared();scheduleRevocationRecovery();
  },60*60*1000);
  hourly.unref();
  server.once('close',()=>clearInterval(hourly));
  resolve(server);
 })});
}
if(require.main===module)start().then(()=>process.stdout.write('Private multi-account ledger listening\n')).catch(e=>{process.stderr.write('Pilot startup error: '+e.message+'\n');process.exitCode=1});
module.exports={start};
