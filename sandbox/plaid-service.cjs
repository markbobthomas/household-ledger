'use strict';
// Plaid Sandbox only. Never import this from a browser.
// This module has no production host and never returns an access token to callers.
const HOST='https://sandbox.plaid.com';
const ALLOWED_INSTITUTIONS={
 ins_109508:'First Platypus Bank',
 ins_109509:'First Gingham Credit Union',
 ins_109510:'Tattersall Federal Credit Union'
};
class PlaidError extends Error{
 constructor(message,code='PLAID_ERROR',status=502){super(message);this.code=code;this.status=status}
}
function remoteTransport({clientId,secret,fetchImpl=global.fetch}){
 if(!clientId||!secret)throw new PlaidError('Both Plaid Sandbox credentials are required','CREDENTIALS_REQUIRED',400);
 if(typeof fetchImpl!=='function')throw Error('fetch is required');
 return async(path,payload={})=>{
  if(!/^\/[a-z0-9_/-]+$/.test(path))throw new PlaidError('Invalid Plaid endpoint','BAD_PATH',400);
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),20000);
  try{
   const resp=await fetchImpl(HOST+path,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...payload,client_id:clientId,secret}),signal:ctrl.signal
   });
   const data=await resp.json();
   if(!resp.ok||data.error_code){
    throw new PlaidError(data.error_message||'Plaid Sandbox request failed',
     data.error_code||'PLAID_HTTP_ERROR',resp.status>=400&&resp.status<500?400:502);
   }
   return data;
  }catch(e){
   if(e instanceof PlaidError)throw e;
   throw new PlaidError(e.name==='AbortError'?'Plaid Sandbox request timed out':'Plaid Sandbox is unavailable',
    e.name==='AbortError'?'TIMEOUT':'NETWORK_ERROR',503);
  }finally{clearTimeout(timer)}
 };
}
const normalDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s:null;
const stripAccount=(a,itemId,institution,when)=>({
 account_id:a.account_id,name:a.name,official_name:a.official_name||a.name,mask:a.mask||null,
 type:a.type,subtype:a.subtype,iso_currency_code:a.balances?.iso_currency_code||null,
 current:a.balances?.current??null,available:a.balances?.available??null,
 accountType:a.type==='credit'?'credit':a.subtype==='savings'?'savings':a.type==='depository'?'checking':'other',
 itemId,institution,balanceAsOf:when,
 id:a.account_id,transactionAccount:a.name
});
const stripTransaction=t=>({
 transaction_id:t.transaction_id,account_id:t.account_id,
 amount:t.amount,date:t.date,
 name:t.name,merchant_name:t.merchant_name||t.name,pending:Boolean(t.pending),
 pending_transaction_id:t.pending_transaction_id||null,
 personal_finance_category:t.personal_finance_category&&typeof t.personal_finance_category==='object'?
  {primary:t.personal_finance_category.primary||null,
   detailed:t.personal_finance_category.detailed||null,
   confidence_level:t.personal_finance_category.confidence_level||null}:null
});
function createService({request,now=()=>new Date(),mode='fixture'}){
 if(typeof request!=='function')throw Error('Plaid transport required');
 const items=new Map();
 let sequence=0;
 const stamp=()=>now().toISOString();
 const sanitizeItem=item=>({
  itemId:item.itemId,institution:item.institution,institutionId:item.institutionId,
  accountCount:item.accounts.length,transactionCount:item.transactions.size,
  cursorPresent:Boolean(item.cursor),lastSuccessfulSync:item.syncedAt,connected:true,
  warning:item.warning||null
 });
 async function syncOne(item){
  const priorCursor=item.cursor||null;
  let final=null,lastError;
  for(let attempt=0;attempt<3;attempt++){
   const pages=[];
   let cursor=priorCursor,finished=false;
   try{
    for(let pg=0;pg<100;pg++){
     const body={access_token:item.accessToken,count:500};
     if(cursor)body.cursor=cursor;
     const page=await request('/transactions/sync',body);
     if(!page||!Array.isArray(page.added)||!Array.isArray(page.modified)||
      !Array.isArray(page.removed)||typeof page.next_cursor!=='string'||typeof page.has_more!=='boolean')
      throw new PlaidError('Malformed transactions sync page','BAD_SYNC_PAGE',502);
     pages.push(page);cursor=page.next_cursor;
     if(!page.has_more){finished=true;break}
     if(!cursor)throw new PlaidError('Plaid pagination returned an empty cursor','BAD_SYNC_CURSOR',502);
    }
    if(!finished)throw new PlaidError('Plaid sync exceeded 100 pages','PAGE_LIMIT',502);
    final={pages,cursor};break;
   }catch(e){
    lastError=e;
    if(e.code!=='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'||attempt===2)throw e;
    // Restart all pages at the original committed cursor.
   }
  }
  if(!final)throw lastError||Error('Unknown sync failure');
  const next=new Map(item.transactions);
  for(const page of final.pages){
   for(const raw of [...page.added,...page.modified]){
    if(!raw?.transaction_id||!raw?.account_id||!Number.isFinite(Number(raw.amount))||!normalDate(raw.date))
     throw new PlaidError('Malformed Plaid transaction row','BAD_TRANSACTION',502);
    const t=stripTransaction(raw);
    if(t.pending_transaction_id)next.delete(t.pending_transaction_id);
    next.set(t.transaction_id,t);
   }
   for(const r of page.removed){
    if(!r?.transaction_id)throw new PlaidError('Malformed removal row','BAD_REMOVE',502);
    next.delete(r.transaction_id);
   }
  }
  // Refresh cached account metadata separately from transaction sync.
  const resp=await request('/accounts/get',{access_token:item.accessToken});
  if(!Array.isArray(resp.accounts))throw new PlaidError('Missing account list','BAD_ACCOUNTS',502);
  const observedAt=stamp(),accounts=resp.accounts.map(a=>
   stripAccount(a,item.itemId,item.institution,observedAt.slice(0,10)));
  for(const a of accounts){
   for(const other of items.values()){
    if(other.itemId===item.itemId)continue;
    if(other.accounts.some(x=>x.id===a.id))
     throw new PlaidError('Duplicate Plaid account ID across institutions','ACCOUNT_ID_CONFLICT',409);
   }
  }
  // Single commit point. A failed page/metadata update leaves all prior item state.
  item.transactions=next;item.accounts=accounts;item.cursor=final.cursor;item.syncedAt=observedAt;
  item.warning=next.size===0?'No transactions yet; Plaid may still be initializing this Item.':null;
  return {itemId:item.itemId,added:final.pages.reduce((n,p)=>n+p.added.length,0),
   modified:final.pages.reduce((n,p)=>n+p.modified.length,0),
   removed:final.pages.reduce((n,p)=>n+p.removed.length,0),
   transactions:next.size,accounts:accounts.length,pages:final.pages.length};
 }
 async function exchange(publicToken,institutionId){
  if(typeof publicToken!=='string'||!publicToken.startsWith('public-'))
   throw new PlaidError('A valid Sandbox public token is required','BAD_PUBLIC_TOKEN',400);
  const ex=await request('/item/public_token/exchange',{public_token:publicToken});
  if(!ex.access_token||!ex.item_id)throw new PlaidError('Plaid token exchange response invalid','BAD_EXCHANGE');
  if(items.has(ex.item_id))throw new PlaidError('Institution already connected','ALREADY_CONNECTED',409);
  const institution=ALLOWED_INSTITUTIONS[institutionId]||'Sandbox institution';
  const item={itemId:ex.item_id,institution,institutionId:institutionId||null,
   accessToken:ex.access_token,cursor:null,accounts:[],transactions:new Map(),
   syncedAt:null,warning:null};
  items.set(item.itemId,item);
  try{
   const result=await syncOne(item);
   return {...sanitizeItem(item),sync:result};
  }catch(e){
   // Keep the Item so a later Sync can recover from initialization delays.
   item.warning='First sync did not complete. Retry Sync.';
   return {...sanitizeItem(item),needsRetry:true,errorCode:e.code||'SYNC_FAILED'};
  }
 }
 return {
  mode,status(){
   return {mode,connected:items.size>0,credentialConfigured:mode==='plaid',
    items:[...items.values()].map(sanitizeItem),provider:'Plaid Sandbox only',
    liveBankConnections:0};
  },
  async createLinkToken(){
   if(mode!=='plaid')throw new PlaidError('Plaid credentials required for Link','CREDENTIALS_REQUIRED',400);
   const r=await request('/link/token/create',{
    user:{client_user_id:'household-sandbox-local'},client_name:'Household Ledger Sandbox',
    products:['transactions'],country_codes:['US'],language:'en'
   });
   if(!r.link_token)throw new PlaidError('Plaid did not return a link token','BAD_LINK');
   return {link_token:r.link_token};
  },
  async connectTest(institutionId='ins_109508',profile='standard'){
   if(!(institutionId in ALLOWED_INSTITUTIONS))throw new PlaidError('Only approved Sandbox institutions are supported','UNKNOWN_INSTITUTION',400);
   if(!['standard','dynamic'].includes(profile))throw new PlaidError('Invalid Sandbox profile','BAD_PROFILE',400);
   const options=profile==='dynamic'?
    {override_username:'user_transactions_dynamic',override_password:'pass_good'}:
    {override_username:'user_good',override_password:'pass_good'};
   const r=await request('/sandbox/public_token/create',{
    institution_id:institutionId,initial_products:['transactions'],options});
   return exchange(r.public_token,institutionId);
  },
  exchangePublicToken:exchange,
  async sync(itemId=null){
   const targets=itemId?[items.get(itemId)].filter(Boolean):[...items.values()];
   if(itemId&&!targets.length)throw new PlaidError('Unknown Sandbox Item','NOT_FOUND',404);
   const results=[],errors=[];
   for(const t of targets){
    try{results.push(await syncOne(t))}catch(e){errors.push({itemId:t.itemId,code:e.code||'SYNC_FAILED',message:e.message})}
   }
   return {results,errors,complete:errors.length===0};
  },
  async refresh(itemId){
   const item=items.get(itemId);if(!item)throw new PlaidError('Unknown Sandbox Item','NOT_FOUND',404);
   await request('/transactions/refresh',{access_token:item.accessToken});
   return {refreshRequested:true,itemId,notice:'Transactions updates may be asynchronous. Sync again after Plaid delivers them.'};
  },
  snapshot(){
   return {asOf:stamp().slice(0,10),mode:'plaid',connected:items.size>0,
    lastSuccessfulSync:[...items.values()].map(x=>x.syncedAt).filter(Boolean).sort().at(-1)||null,
    accounts:[...items.values()].flatMap(x=>x.accounts.map(a=>({...a,simulated:true}))),
    items:[...items.values()].map(x=>({...sanitizeItem(x),
     accounts:x.accounts.map(a=>({...a})),transactions:[...x.transactions.values()].map(t=>({...t}))})),
    source:mode==='plaid'?'Plaid Sandbox test accounts (not real banks)':'Local Plaid-shaped fixture (no Plaid calls)',
    simulated:true
   };
  },
  async disconnect(itemId){
   const item=items.get(itemId);if(!item)throw new PlaidError('Unknown Item','NOT_FOUND',404);
   // Never forget an Item whose Plaid removal failed; it would leak a subscription.
   await request('/item/remove',{access_token:item.accessToken});
   items.delete(itemId);
   return {disconnected:true,itemId};
  }
 };
}
module.exports={createService,remoteTransport,PlaidError,ALLOWED_INSTITUTIONS};
