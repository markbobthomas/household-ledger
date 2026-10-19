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
let state={item:null,accountId:null,cursor:null,transactions:{},accounts:[],lastSync:null,error:null};
async function load(){
 try{const b=JSON.parse(await fs.readFile(file,'utf8'));const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(b.iv,'base64'));d.setAuthTag(Buffer.from(b.tag,'base64'));state=JSON.parse(Buffer.concat([d.update(Buffer.from(b.data,'base64')),d.final()]).toString())}
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
 if(!state.item)throw Error('No connected account');
 const token=state.item.token;
 let cursor=state.cursor||undefined,pages=[],done=false;
 for(let attempt=0;attempt<3;attempt++){
  pages=[];cursor=state.cursor||undefined;done=false;
  try{
   for(let i=0;i<100;i++){
    const p=await plaid('/transactions/sync',{access_token:token,count:500,...(cursor?{cursor}:{})});
    if(!Array.isArray(p.added)||!Array.isArray(p.modified)||!Array.isArray(p.removed)||typeof p.next_cursor!=='string')throw Error('Malformed sync response');
    pages.push(p);cursor=p.next_cursor;
    if(!p.has_more){done=true;break}
   }
   if(!done)throw Error('Sync pagination incomplete');
   break;
  }catch(e){if(!e.message.includes('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION')||attempt===2)throw e}
 }
 // Snapshot is directly reported by Plaid. Never calculate from transactions.
 const accountResponse=await plaid('/accounts/get',{access_token:token});
 const account=accountResponse.accounts.find(a=>a.account_id===state.accountId);
 if(!account)throw Error('Selected account is no longer available');
 // Expose only the one selected account.
 const next={...state.transactions};
 for(const p of pages){
  for(const t of [...p.added,...p.modified]){
   if(t.account_id!==state.accountId)continue;
   if(t.pending_transaction_id)delete next[t.pending_transaction_id];
   next[t.transaction_id]={id:t.transaction_id,date:t.date,name:t.name,merchant:t.merchant_name||t.name,amount:t.amount,pending:!!t.pending,pendingId:t.pending_transaction_id||null,category:t.personal_finance_category||null};
  }
  for(const t of p.removed)delete next[t.transaction_id];
 }
 state.transactions=next;state.cursor=cursor;state.accounts=[{id:account.account_id,name:account.name,mask:account.mask,type:account.type,subtype:account.subtype,current:account.balances?.current??null,available:account.balances?.available??null,balanceObservedAt:stamp(),currency:account.balances?.iso_currency_code||'USD'}];
 state.lastSync=stamp();state.error=null;await save();
 return {transactions:Object.keys(next).length};
}
async function html(){return fs.readFile(path.join(__dirname,'index.html'),'utf8')}
async function start(port=Number(env.PORT||8788)){
 await load();
 const server=http.createServer(async(req,res)=>{
  const respond=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
  if(req.url==='/healthz'&&req.method==='GET')return respond(200,{ok:true,mode:'one-account-pilot'});
  const expected=Buffer.from('pilot:'+env.PILOT_PASSWORD).toString('base64');
  const provided=String(req.headers.authorization||'').replace(/^Basic /,'');
  const equal=provided.length===expected.length&&crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(expected));
  if(!equal){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Private bank pilot"','Cache-Control':'no-store'});return res.end('Authentication required')}
  const origin=req.headers.origin,host=req.headers.host;
  if(origin&&new URL(origin).host!==host)return respond(403,{error:'Origin rejected'});
  if(req.method==='GET'&&req.url==='/bank-connect'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' https://cdn.plaid.com; style-src 'unsafe-inline'; frame-src https://*.plaid.com; connect-src 'self' https://*.plaid.com; img-src 'self' data:; form-action 'self'"});return res.end(await html())}
  const staticPath=req.url.split('?')[0].slice(1);
  const allowed=/^(?:index[.]html|modern[.]css|(?:demo-data|forecast|forecast-ledger|accounting|categorization|ledger-data|account-forecast|bank-feed|feed-health|cashflow|recurring|reviews|accuracy-fixture|accuracy-fixture-holdout|accuracy-fixture-seasonal|accuracy-lab|stress-lab|readiness-lab)[.]js|sandbox[/]sandbox-ui[.]js|pilot[/]ledger-ui[.]js)$/;
  if(req.method==='GET'&&(req.url==='/'||allowed.test(staticPath))){
   const name=req.url.split('?')[0].slice(1)||'index.html';
   let body=await fs.readFile(path.resolve(__dirname,'..',name));
   if(name==='index.html')body=Buffer.from(body.toString('utf8').replace('</head>','<script src="/pilot/ledger-ui.js" defer></script></head>'));
   res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self' https://cdn.plaid.com; script-src 'self' 'unsafe-inline' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; frame-src https://*.plaid.com; connect-src 'self' https://*.plaid.com; img-src 'self' data: https://*.plaid.com"});
   return res.end(body);
  }
  if(req.method==='GET'&&req.url==='/api/status')return respond(200,{connected:!!state.item,account:state.accounts[0]||null,lastSync:state.lastSync,transactions:Object.values(state.transactions).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,500)});
  if(req.method!=='POST'||req.headers['x-pilot-action']!=='1')return respond(403,{error:'Action header required'});
  let body={};try{let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>8192)return respond(413,{error:'Too large'});chunks.push(chunk)}body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{return respond(400,{error:'Invalid JSON'})}
  try{
   if(req.url==='/api/link-token'){
    if(state.item)throw Error('One account only. Disconnect first.');
    const t=await plaid('/link/token/create',{user:{client_user_id:'household-ledger-single-pilot'},client_name:'Household Ledger Pilot',products:['transactions'],country_codes:['US'],language:'en',account_filters:{depository:{account_subtypes:['checking']}}});
    return respond(200,{link_token:t.link_token});
   }
   if(req.url==='/api/exchange'){
    if(state.item)throw Error('Already connected');
    if(!body.publicToken||!body.accountId)throw Error('Missing Plaid Link selection');
    const x=await plaid('/item/public_token/exchange',{public_token:body.publicToken});
    const accounts=await plaid('/accounts/get',{access_token:x.access_token});
    const chosen=accounts.accounts.find(a=>a.account_id===body.accountId&&a.type==='depository'&&a.subtype==='checking');
    if(!chosen){await plaid('/item/remove',{access_token:x.access_token});throw Error('Select one checking account only')}
    state.item={id:x.item_id,token:x.access_token};state.accountId=chosen.account_id;await save();
    try{await sync()}catch(e){state.error='Initial sync pending';await save()}
    return respond(200,{connected:true});
   }
   if(req.url==='/api/sync'){await sync();return respond(200,{ok:true})}
   if(req.url==='/api/disconnect'){if(state.item)await plaid('/item/remove',{access_token:state.item.token});state={item:null,accountId:null,cursor:null,transactions:{},accounts:[],lastSync:null,error:null};await save();return respond(200,{ok:true})}
   return respond(404,{error:'Unknown action'});
  }catch(e){return respond(400,{error:e.message.startsWith('Plaid request failed:')?e.message:String(e.message).slice(0,140)})}
 });
 return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',()=>resolve(server))});
}
if(require.main===module)start().then(()=>process.stdout.write('Private one-account pilot listening\n')).catch(e=>{process.stderr.write('Pilot startup error: '+e.message+'\n');process.exitCode=1});
module.exports={start};
