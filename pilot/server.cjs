'use strict';
// Isolated one-account pilot. No access to the static Ledger or fictional Sandbox.
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
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
const HOST={production:'https://production.plaid.com',sandbox:'https://sandbox.plaid.com'}[env.PLAID_ENV||'production'];
if(!HOST)throw Error('PLAID_ENV must be production or sandbox');
const safe=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
const stamp=()=>new Date().toISOString();
const freshState=()=>({items:[],transactions:{},accounts:[],lastSync:null,error:null,ledgerAdjustments:{}});
let state=freshState(),forecastWrites=Promise.resolve(),accountRemovalBusy=false;
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
 // Existing users start with their previous encrypted predictions in pilot.enc.
 // Once a forecast is saved separately, this tiny file is authoritative.
 try{
  const predictions=decrypted(await fs.readFile(forecastFile,'utf8'));
  if(!predictions||typeof predictions!=='object'||Array.isArray(predictions))
   throw Error('Invalid encrypted forecast preferences');
  state.ledgerAdjustments.predictions=predictions;
 }catch(e){if(e.code!=='ENOENT')throw e}
}
async function atomicEncryptedWrite(filename,value){
 await fs.mkdir(path.dirname(filename),{recursive:true});
 const temporary=filename+'.tmp';
 await fs.writeFile(temporary,encrypted(value),{mode:0o600});
 await fs.rename(temporary,filename);
}
async function save(){
 await atomicEncryptedWrite(file,state);
}
// One small encrypted write per forecast edit. The full encrypted bank ledger
// is neither touched nor read, and concurrent browser saves are serialized.
async function saveForecast(predictions,expectedRevision){
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
  require('../planner-transactions.js').assertNoNewForecastDuplicates(
   state.ledgerAdjustments?.predictions||{},predictions);
  await atomicEncryptedWrite(forecastFile,predictions);
  state.ledgerAdjustments.predictions=predictions;
 });
 forecastWrites=write.catch(()=>{});
 await write;
}
async function plaid(endpoint,body){
 const resp=await fetch(HOST+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,client_id:env.PLAID_CLIENT_ID,secret:env.PLAID_SECRET}),signal:AbortSignal.timeout(25000)});
 const data=await resp.json();
 if(!resp.ok||data.error_code){
  const code=String(data.error_code||resp.status).slice(0,60),
   error=new Error('Plaid request failed: '+code);
  error.plaidCode=code;throw error;
 }
 return data;
}
async function sync(){
 if(!state.items.length)throw Error('No connected accounts');
 const stages=[],observedAt=stamp(),allIds=new Set();
 for(const item of state.items){
  try{
  if(!item.token||!item.accountIds?.length)throw Error('Incomplete connected institution');
  let cursor=item.cursor||undefined,pages=[],complete=false;
  for(let attempt=0;attempt<3;attempt++){
   cursor=item.cursor||undefined;pages=[];complete=false;
   try{
    for(let n=0;n<100;n++){
     const page=await plaid('/transactions/sync',{access_token:item.token,count:500,...(cursor?{cursor}:{})});
     if(!Array.isArray(page.added)||!Array.isArray(page.modified)||!Array.isArray(page.removed)||typeof page.next_cursor!=='string')throw Error('Malformed sync response');
     pages.push(page);cursor=page.next_cursor;
     if(!page.has_more){complete=true;break}
    }
    if(!complete)throw Error('Sync pagination incomplete');
    break;
   }catch(error){if(!error.message.includes('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION')||attempt===2)throw error}
  }
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
   if(error.plaidCode==='ITEM_LOGIN_REQUIRED'){
    // Preserve bank history, IDs and forecast preferences on expired consent.
    item.reconnectRequired=true;
    error.reconnectAccountId=item.accountIds[0]||null;
    await save();
   }
   throw error;
  }
 }
 const next={...state.transactions},overrides={...(state.ledgerAdjustments?.categoryOverrides||{})};
 for(const stage of stages){
  const ids=new Set(stage.item.accountIds);
  for(const page of stage.pages){
   for(const t of [...page.added,...page.modified]){
    if(!ids.has(t.account_id))continue;
    if(t.pending_transaction_id){
     delete next[t.pending_transaction_id];
     if(Object.prototype.hasOwnProperty.call(overrides,t.pending_transaction_id)){
      if(!Object.prototype.hasOwnProperty.call(overrides,t.transaction_id))
       overrides[t.transaction_id]=overrides[t.pending_transaction_id];
      delete overrides[t.pending_transaction_id];
     }
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
 state.transactions=next;state.accounts=stages.flatMap(s=>s.accounts);
 state.items=state.items.map(i=>({...i,cursor:stages.find(s=>s.item.id===i.id).cursor,reconnectRequired:false}));
 state.ledgerAdjustments.categoryOverrides=overrides;
 state.lastSync=observedAt;state.error=null;await save();
 return {transactions:Object.keys(next).length,accounts:state.accounts.length,institutions:state.items.length};
}
async function html(){return fs.readFile(path.join(__dirname,'index.html'),'utf8')}
async function start(port=Number(env.PORT||8788)){
 await load();
 const server=http.createServer(async(req,res)=>{
  // Route on the URL pathname; tracking/query parameters are not bank actions.
  const requestPath=new URL(req.url,'http://localhost').pathname;
  const respond=(status,data)=>{const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(requestPath.startsWith('/api/'))headers['X-Ledger-Revision']=settingsRevision();
    res.writeHead(status,headers);res.end(JSON.stringify(data))};
  // Render provides the deployed Git SHA at runtime. Health exposes only
  // this public source identifier, never credentials, banking records or disk paths.
  if(requestPath==='/healthz'&&req.method==='GET')return respond(200,{
   ok:true,mode:'multi-account-private',
   commit:/^[a-f0-9]{40}$/i.test(String(env.RENDER_GIT_COMMIT||''))?env.RENDER_GIT_COMMIT:null
  });
  const expected=Buffer.from('pilot:'+env.PILOT_PASSWORD).toString('base64');
  const provided=String(req.headers.authorization||'').replace(/^Basic /,'');
  const equal=provided.length===expected.length&&crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(expected));
  if(!equal){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Private bank pilot"','Cache-Control':'no-store'});return res.end('Authentication required')}
  const origin=req.headers.origin,host=req.headers.host;
  if(origin&&new URL(origin).host!==host)return respond(403,{error:'Origin rejected'});
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
   res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.png')?'image/png':name.endsWith('.webmanifest')?'application/manifest+json':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self' https://cdn.plaid.com; script-src 'self' 'unsafe-inline' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; frame-src https://*.plaid.com; connect-src 'self' https://*.plaid.com; img-src 'self' data: https://*.plaid.com"});
   return res.end(body);
  }
  if(req.method==='GET'&&requestPath==='/api/ledger'){
   if(!state.items.length)return respond(200,{connected:false,account:null,accounts:[],transactions:[],adjustments:{}});
   // No truncation: all imported records for the selected accounts.
   return respond(200,{connected:true,account:state.accounts[0]||null,accounts:state.accounts,lastSync:state.lastSync,
    transactions:Object.values(state.transactions).filter(t=>t&&typeof t==='object').sort((a,b)=>String(b.date).localeCompare(String(a.date))),
    reconnectAccounts:state.items.filter(i=>i.reconnectRequired).flatMap(i=>i.accountIds).map(String),
     adjustments:state.ledgerAdjustments||{}});
  }
  if(req.method==='GET'&&requestPath==='/api/status'){
   const refs=new Map(accountForecastLinks(state).map(x=>[x.id,x]));
   return respond(200,{connected:state.items.length>0,account:state.accounts[0]||null,
    accounts:state.accounts.map(a=>({...a,forecastUsage:refs.get(String(a.id)),
      needsReconnect:state.items.some(i=>i.reconnectRequired&&i.accountIds.includes(String(a.id)))})),
    lastSync:state.lastSync,
    transactions:Object.values(state.transactions).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,500)});
  }
  // Unknown browser navigation should be a 404, not a misleading bank-action error.
  if(req.method==='GET'||req.method==='HEAD')return respond(404,{error:'Not found'});
  if(req.method!=='POST'||req.headers['x-pilot-action']!=='1')return respond(403,{error:'Action header required'});
  let body={};try{let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>524288)return respond(413,{error:'Adjustments too large'});chunks.push(chunk)}body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{return respond(400,{error:'Invalid JSON'})}
  try{
   // Prevent an outdated device from overwriting newer household settings.
   const expected=req.headers['x-ledger-revision'];
   if(requestPath.startsWith('/api/ledger/')&&expected&&expected!==settingsRevision()&&
      !(requestPath==='/api/ledger/forecasts'&&body?.predictions&&
        JSON.stringify(body.predictions)===JSON.stringify(state.ledgerAdjustments?.predictions||{})))
    return respond(409,{error:staleMessage,code:'STALE_LEDGER'});
   if(accountRemovalBusy&&[
    '/api/ledger/forecasts','/api/ledger/adjustments','/api/ledger/category',
     '/api/ledger/category-rule','/api/ledger/categories/delete','/api/ledger/categories/rename','/api/exchange',
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
    if(!body.publicToken||!Array.isArray(body.accountIds)&&!body.accountId)throw Error('Choose at least one account');
    const ids=[...new Set((Array.isArray(body.accountIds)?body.accountIds:[body.accountId]).map(String))];
    if(!ids.length||ids.length>30)throw Error('Choose 1–30 accounts');
    const x=await plaid('/item/public_token/exchange',{public_token:body.publicToken});
    let retained=false;
    try{
     if(state.items.some(i=>i.id===x.item_id))throw Error('This institution is already connected');
     const response=await plaid('/accounts/get',{access_token:x.access_token});
     for(const id of ids){
      const a=response.accounts.find(y=>y.account_id===id&&['depository','credit'].includes(y.type));
      if(!a)throw Error('Select only eligible bank or credit accounts');
      if(state.accounts.some(y=>y.id===id))throw Error('This account is already connected');
     }
     state.items.push({id:x.item_id,token:x.access_token,cursor:null,accountIds:ids});
     await sync();retained=true;
     return respond(200,{connected:true,accounts:state.accounts.length});
    }catch(error){state.items=state.items.filter(i=>i.id!==x.item_id);await save();throw error}
    finally{if(!retained)try{await plaid('/item/remove',{access_token:x.access_token})}catch{}}
   }
   if(requestPath==='/api/sync'){await sync();return respond(200,{ok:true,accounts:state.accounts.length})}
   if(requestPath==='/api/accounts/remove'){
    if(!body||typeof body.accountId!=='string'||!body.accountId||
       body.accountId.length>256||Object.keys(body).length!==1)
     return respond(400,{error:'Choose exactly one connected account'});
    accountRemovalBusy=true;
    try{
     // Finish in-flight encrypted preference saves before checking references.
     await forecastWrites;
     const id=body.accountId,account=state.accounts.find(a=>String(a.id)===id),
      owners=state.items.filter(i=>i.accountIds.includes(id));
     if(!account||owners.length!==1||String(account.itemId)!==String(owners[0].id))
      return respond(404,{error:'This account is no longer connected. Refresh the list.'});
     // Refuse the operation even from a stale browser or direct API call.
     // Removing a card that funds a schedule (or its linked checking account)
     // would otherwise silently strand the user's previously edited forecasts.
     const linked=accountForecastLinks(state).find(x=>x.id===id);
     if(!linked||linked.protected)
      return respond(409,{error:'This account has saved forecast settings or edited transactions. Reassign those edits before removing it.'});
     const item=owners[0],revoke=item.accountIds.length===1;
     if(revoke)await plaid('/item/remove',{access_token:item.token});
     const previous=state,transactions={},removedIds=new Set();
     for(const [txId,t] of Object.entries(state.transactions)){
      if(String(t.accountId||'')===id||
        !t.accountId&&state.accounts.length===1)removedIds.add(txId);
      else transactions[txId]=t;
     }
     const overrides={...(state.ledgerAdjustments?.categoryOverrides||{})};
     for(const txId of removedIds)delete overrides[txId];
     state={...state,accounts:state.accounts.filter(a=>String(a.id)!==id),
      items:state.items.flatMap(i=>i.id!==item.id?[i]:
       revoke?[]:[{...i,accountIds:i.accountIds.filter(a=>a!==id)}]),
      transactions,ledgerAdjustments:{...state.ledgerAdjustments,categoryOverrides:overrides}};
     try{await save()}catch(error){state=previous;throw error}
     return respond(200,{removed:true,remainingAccounts:state.accounts.length,
      disconnectedInstitution:revoke});
    }finally{accountRemovalBusy=false}
   }
   if(requestPath==='/api/disconnect'){
    for(const item of state.items)await plaid('/item/remove',{access_token:item.token});
    await forecastWrites;
    state=freshState();await save();
    // An old household's saved schedules must not attach to a new bank link.
    try{await fs.unlink(forecastFile)}catch(e){if(e.code!=='ENOENT')throw e}
    return respond(200,{ok:true});
   }
   return respond(404,{error:'Unknown action'});
  }catch(e){
   if(e.plaidCode==='ITEM_LOGIN_REQUIRED')
    return respond(409,{error:'Your bank needs you to sign in again before new transactions can be fetched.',
     code:'ITEM_LOGIN_REQUIRED',reconnectAccountId:e.reconnectAccountId||null});
   return respond(e.httpStatus||400,{error:e.message.startsWith('Plaid request failed:')?e.message:String(e.message).slice(0,140),
    ...(e.httpStatus===409?{code:'STALE_LEDGER'}:{})})
  }
 });
 return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',()=>resolve(server))});
}
if(require.main===module)start().then(()=>process.stdout.write('Private multi-account ledger listening\n')).catch(e=>{process.stderr.write('Pilot startup error: '+e.message+'\n');process.exitCode=1});
module.exports={start};
