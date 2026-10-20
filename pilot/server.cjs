'use strict';
// Isolated one-account pilot. No access to the static Ledger or fictional Sandbox.
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const env=process.env;
if(!env.PILOT_PASSWORD||env.PILOT_PASSWORD.length<20||!env.PILOT_ENCRYPTION_KEY||!env.PLAID_CLIENT_ID||!env.PLAID_SECRET)
 throw Error('Missing pilot password (20+ characters), encryption key, or Plaid credentials');
const key=crypto.createHash('sha256').update(env.PILOT_ENCRYPTION_KEY).digest();
const file=env.PILOT_STATE_PATH||'/var/data/pilot.enc';
const HOST={production:'https://production.plaid.com',sandbox:'https://sandbox.plaid.com'}[env.PLAID_ENV||'production'];
if(!HOST)throw Error('PLAID_ENV must be production or sandbox');
const safe=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
const stamp=()=>new Date().toISOString();
const freshState=()=>({items:[],transactions:{},accounts:[],lastSync:null,error:null,ledgerAdjustments:{}});
let state=freshState();
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
async function load(){
 try{const b=JSON.parse(await fs.readFile(file,'utf8'));const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(b.iv,'base64'));d.setAuthTag(Buffer.from(b.tag,'base64'));state=JSON.parse(Buffer.concat([d.update(Buffer.from(b.data,'base64')),d.final()]).toString());normalizeState()}
 catch(e){if(e.code!=='ENOENT')throw e}
}
async function save(){
 const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),b=Buffer.from(JSON.stringify(state));
 const ciphertext=Buffer.concat([c.update(b),c.final()]);
 await fs.mkdir(path.dirname(file),{recursive:true});
 const tmp=file+'.tmp';
 await fs.writeFile(tmp,JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:ciphertext.toString('base64')}),{mode:0o600});
 await fs.rename(tmp,file);
}
async function plaid(endpoint,body){
 const resp=await fetch(HOST+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,client_id:env.PLAID_CLIENT_ID,secret:env.PLAID_SECRET}),signal:AbortSignal.timeout(25000)});
 const data=await resp.json();
 if(!resp.ok||data.error_code)throw Error('Plaid request failed: '+String(data.error_code||resp.status).slice(0,60));
 return data;
}
async function sync(){
 if(!state.items.length)throw Error('No connected accounts');
 const stages=[],observedAt=stamp(),allIds=new Set();
 for(const item of state.items){
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
 state.items=state.items.map(i=>({...i,cursor:stages.find(s=>s.item.id===i.id).cursor}));
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
  const respond=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
  if(requestPath==='/healthz'&&req.method==='GET')return respond(200,{ok:true,mode:'multi-account-private'});
  const expected=Buffer.from('pilot:'+env.PILOT_PASSWORD).toString('base64');
  const provided=String(req.headers.authorization||'').replace(/^Basic /,'');
  const equal=provided.length===expected.length&&crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(expected));
  if(!equal){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Private bank pilot"','Cache-Control':'no-store'});return res.end('Authentication required')}
  const origin=req.headers.origin,host=req.headers.host;
  if(origin&&new URL(origin).host!==host)return respond(403,{error:'Origin rejected'});
  if(req.method==='GET'&&requestPath==='/bank-connect'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' https://cdn.plaid.com; style-src 'unsafe-inline'; frame-src https://*.plaid.com; connect-src 'self' https://*.plaid.com; img-src 'self' data:; form-action 'self'"});return res.end(await html())}
  const staticPath=requestPath.slice(1);
  const allowed=/^(?:index[.]html|modern[.]css|planner[.]css|(?:planner|demo-data|forecast|forecast-ledger|accounting|categorization|ledger-data|account-forecast|payment-obligations|planner-intelligence|planner-backtest|planner-transactions|planner-history|planner-recurrence|bank-feed|feed-health|cashflow|recurring|reviews|accuracy-fixture|accuracy-fixture-holdout|accuracy-fixture-seasonal|accuracy-lab|stress-lab|readiness-lab)[.]js|sandbox[/]sandbox-ui[.]js|pilot[/]data-source[.]js)$/;
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
   if(name==='index.html')body=Buffer.from(body.toString('utf8').replace('</head>','<script src="/pilot/data-source.js"></script></head>'));
   res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self' https://cdn.plaid.com; script-src 'self' 'unsafe-inline' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; frame-src https://*.plaid.com; connect-src 'self' https://*.plaid.com; img-src 'self' data: https://*.plaid.com"});
   return res.end(body);
  }
  if(req.method==='GET'&&requestPath==='/api/ledger'){
   if(!state.items.length)return respond(200,{connected:false,account:null,accounts:[],transactions:[],adjustments:{}});
   // No truncation: all imported records for the selected accounts.
   return respond(200,{connected:true,account:state.accounts[0]||null,accounts:state.accounts,lastSync:state.lastSync,
    transactions:Object.values(state.transactions).filter(t=>t&&typeof t==='object').sort((a,b)=>String(b.date).localeCompare(String(a.date))),
    adjustments:state.ledgerAdjustments||{}});
  }
  if(req.method==='GET'&&requestPath==='/api/status')return respond(200,{connected:state.items.length>0,account:state.accounts[0]||null,accounts:state.accounts,lastSync:state.lastSync,transactions:Object.values(state.transactions).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,500)});
  // Unknown browser navigation should be a 404, not a misleading bank-action error.
  if(req.method==='GET'||req.method==='HEAD')return respond(404,{error:'Not found'});
  if(req.method!=='POST'||req.headers['x-pilot-action']!=='1')return respond(403,{error:'Action header required'});
  let body={};try{let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>524288)return respond(413,{error:'Adjustments too large'});chunks.push(chunk)}body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{return respond(400,{error:'Invalid JSON'})}
  try{
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
    const previous=state.ledgerAdjustments.predictions;
    state.ledgerAdjustments.predictions=body.predictions;
    try{await save()}catch(error){
     // An unsuccessful write must not be reported as a saved prediction.
     if(previous===undefined)delete state.ledgerAdjustments.predictions;
     else state.ledgerAdjustments.predictions=previous;
     throw error;
    }
    return respond(200,{saved:true,scope:'predictions'});
   }
   if(requestPath==='/api/ledger/adjustments'){
    if(!state.items.length)return respond(409,{error:'No bank account connected'});
    if(!body||typeof body!=='object'||Array.isArray(body))return respond(400,{error:'Invalid preferences'});
    const allowed=['categoryOverrides','predictions','reviews','learning','customCategories'];
    if(Object.keys(body).some(k=>!allowed.includes(k)))return respond(400,{error:'Bank source fields may not be changed'});
    for(const keyName of allowed){if(body[keyName]!==undefined&&(body[keyName]===null||typeof body[keyName]!=='object'||Array.isArray(body[keyName])&&keyName!=='customCategories'))return respond(400,{error:'Invalid '+keyName})}
    const allowedCats=new Set(['Groceries','Shopping','Housing','Utilities','Transportation','Dining','Health','Entertainment','Kids & Family','Insurance','Subscriptions','Other']);
    if(body.customCategories&&(body.customCategories.length>50||body.customCategories.some(c=>typeof c!=='string'||c.length<2||c.length>40||!/^[A-Za-z0-9][A-Za-z0-9 &'().-]*$/.test(c))))return respond(400,{error:'Invalid custom categories'});
    for(const name of body.customCategories||[])allowedCats.add(name);
    if(body.categoryOverrides){
     const ids=new Set(Object.keys(state.transactions).map(String));
     if(Object.entries(body.categoryOverrides).some(([id,category])=>!ids.has(id)||!allowedCats.has(category)))return respond(400,{error:'Invalid category override'});
    }
    // Never permit source records, Plaid tokens, or provider balances in adjustment writes.
    state.ledgerAdjustments=Object.fromEntries(allowed.filter(k=>body[k]!==undefined).map(k=>[k,body[k]]));
    await save();return respond(200,{saved:true});
   }
   if(requestPath==='/api/link-token'){
    const t=await plaid('/link/token/create',{user:{client_user_id:'household-ledger-private-household'},
     client_name:'Household Ledger',products:['transactions'],country_codes:['US'],language:'en'});
    return respond(200,{link_token:t.link_token});
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
   if(requestPath==='/api/disconnect'){
    for(const item of state.items)await plaid('/item/remove',{access_token:item.token});
    state=freshState();await save();return respond(200,{ok:true});
   }
   return respond(404,{error:'Unknown action'});
  }catch(e){return respond(400,{error:e.message.startsWith('Plaid request failed:')?e.message:String(e.message).slice(0,140)})}
 });
 return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',()=>resolve(server))});
}
if(require.main===module)start().then(()=>process.stdout.write('Private multi-account ledger listening\n')).catch(e=>{process.stderr.write('Pilot startup error: '+e.message+'\n');process.exitCode=1});
module.exports={start};
