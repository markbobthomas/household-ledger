'use strict';
// TinyFish reads Amazon only. The private Ledger server matches its structured
// results to authoritative posted bank charges; no Plaid data goes to TinyFish.
const crypto=require('node:crypto');
const Evidence=require('./amazon-evidence.cjs');
const pairing=require('./amazon-pairing.cjs');
const amazon=require('./amazon-import.cjs');
const apply=require('./amazon-apply.cjs');
const API='https://agent.tinyfish.ai';
const MAX_STEPS=45,MAX_DURATION=600,MAX_ORDERS=250;
const MAX_ESTIMATED_RUN_USD=1.00; // 45*$0.016 + 10 minutes*$0.002 ~= $0.74
const DAYS=new Set([1,4,6]); // Monday / Thursday / Saturday, Pacific time
const isoDate=s=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||'')))return false;
 const date=new Date(s+'T12:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===s;
};
const isId=s=>/^[\w-]{6,100}$/.test(String(s||''));
const keyFor=pairing.keyFor;
function local(now=new Date()){
 const pieces=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'America/Los_Angeles',weekday:'short',year:'numeric',month:'2-digit',
  day:'2-digit',hour:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(p=>[p.type,p.value]));
 return {day:pieces.year+'-'+pieces.month+'-'+pieces.day,
  weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(pieces.weekday),
  hour:Number(pieces.hour)};
}
function due(cloud,now=new Date()){
 const slot=local(now);
 return cloud?.enabled===true&&!cloud?.run&&DAYS.has(slot.weekday)&&slot.hour>=8&&
  cloud.lastScheduledDay!==slot.day;
}
function eligible(state,options={}){
 const cloud=state.amazonCloud||{},source=state.transactions||{},
  adjustments=state.ledgerAdjustments||{},notes=adjustments.predictions?.transactionNotes||{},
  scanned=cloud.scanned||{};
 const now=Date.now();
 return Object.values(source).filter(t=>{
  if(!Evidence.isAmazon(t))return false;
  const day=Date.parse(t.date+'T12:00:00Z');
  if(!Number.isFinite(day)||day<now-45*86400000||day>now+2*86400000)return false;
  if(!options.retry&&scanned[keyFor(t)])return false;
  const saved=String(notes[keyFor(t)]||'').trim();
  const e=adjustments.amazonEvidence?.[t.id];
  if(e?.match==='exact'&&Evidence.valid(e,t))return false;
  if(saved.startsWith('Amazon: '))return false;
  return true;
 }).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,200)
  .map(t=>({key:keyFor(t),id:String(t.id),accountId:String(t.accountId)}));
}
function safeStatus(state){
 const c=state.amazonCloud||{},waiting=eligible(state).length;
 return {enabled:c.enabled===true,connected:!!c.apiKey,
  lastAttemptAt:c.lastAttemptAt||null,lastSuccessAt:c.lastSuccessAt||null,
  lastOutcome:c.lastOutcome||'Not yet checked',lastCount:c.lastCount||0,
  lastMatched:c.lastMatched||0,runActive:!!c.run,
  pendingAmazonCharges:waiting,maxCostUsd:MAX_ESTIMATED_RUN_USD,
  schedule:'Monday, Thursday and Saturday after 8 AM Pacific',
  lastError:c.lastError||null};
}
const ensureKey=key=>typeof key==='string'&&key.length>=16&&key.length<=512&&
 !/[\s<>]/.test(key);
async function request(apiKey,url,options={},fetcher=fetch){
 if(!ensureKey(apiKey))throw Error('TinyFish connection missing');
 const res=await fetcher(url,{
  ...options,headers:{'X-API-Key':apiKey,'Content-Type':'application/json',
   ...(options.headers||{})},signal:AbortSignal.timeout(12000)
 });
 if(!res.ok){
  // TinyFish currently gates the max_steps feature by account. Never retry
  // a rejected step-capped request without its cap, which could bill more.
  let reason='';
  try{reason=(await res.text()).slice(0,2000)}catch{}
  const message=res.status===403&&/max[_ -]?steps|beta|step limit|feature gate/i.test(reason)?
   'TinyFish has not enabled per-run step limits for this account. Ask TinyFish to enable this feature; Ledger will not submit an uncapped browser run.':
   res.status===401||res.status===403?
   'TinyFish key not accepted, or your account is not permitted to use this feature. Check the TinyFish connection.':
   res.status===402?'TinyFish wallet needs funds. Open your TinyFish account.':
   'TinyFish could not complete the request ('+res.status+').';
  const error=new Error(message);
  // A definitive 4xx rejection means the paid run did not start. A timeout,
  // a 5xx or a malformed successful response may have started billing.
  if([400,401,402,403,422].includes(res.status))error.notStarted=true;
  throw error;
 }
 const data=await res.json();
 if(!data||typeof data!=='object')throw Error('TinyFish returned an invalid response');
 return data;
}
async function validateKey(apiKey,fetcher){
 await request(apiKey,API+'/v1/wallet',{},fetcher);
 return true;
}
function goal(){
 return 'Read only Amazon.com Your Orders for the last 45 days using the already signed-in saved browser profile. '+
 'Do not buy, cancel, change settings, submit forms, contact sellers or open payment details. '+
 'Read order detail pages as needed to identify individual products, shipment dates, '+
 'item totals inclusive of tax/discount/shipping, and exact order totals; '+
 'for multiple items return one row per priced item and do not guess prices. '+
 'Return an orders array with orderId (Amazon format 123-1234567-1234567), '+
 'title, date (YYYY-MM-DD order date), shipmentDate (YYYY-MM-DD or empty), '+
 'cents (integer cents per item), charged (integer order total cents or null). '+
 'Skip cancelled or unavailable items. Stop if not signed in or challenged and '+
 'report that clearly rather than inventing purchase details. Limit 250 items. '+
 'No bank account or Ledger website access is needed.';
}
const orderSchema={type:'object',properties:{
 orders:{type:'array',items:{type:'object',properties:{
  orderId:{type:'string'},title:{type:'string'},date:{type:'string'},
  shipmentDate:{type:'string'},cents:{type:'integer'},charged:{type:['integer','null']}
 },required:['orderId','title','date','shipmentDate','cents','charged']}},
 signedIn:{type:'boolean'}
},required:['orders','signedIn']};
async function start(apiKey,fetcher){
 const result=await request(apiKey,API+'/v1/automation/run-async',{
  method:'POST',body:JSON.stringify({session_id:crypto.randomUUID(),url:'https://www.amazon.com/your-orders',
   goal:goal(),use_profile:true,browser_profile:'lite',
   agent_config:{mode:'default',max_steps:MAX_STEPS,max_duration_seconds:MAX_DURATION},
   output_schema:orderSchema})
 },fetcher);
 if(typeof result.run_id!=='string'||!/^[a-zA-Z0-9-]{16,90}$/.test(result.run_id))
  throw Error('TinyFish did not provide a valid run ID; check TinyFish before retrying');
 return result.run_id;
}
async function getRun(apiKey,id,fetcher){
 if(!/^[a-zA-Z0-9-]{16,90}$/.test(String(id||'')))throw Error('Invalid TinyFish run ID');
 return request(apiKey,API+'/v1/runs/'+encodeURIComponent(id),{},fetcher);
}
function parseOrders(run){
 if(run?.status!=='COMPLETED')throw Error('TinyFish has not completed this run');
 const data=typeof run.result==='string'?JSON.parse(run.result):run.result;
 if(data?.signedIn!==true)throw Error('Amazon sign-in is needed in TinyFish');
 if(!Array.isArray(data.orders)||data.orders.length>MAX_ORDERS)
  throw Error('Amazon order report was not complete or was too large');
 const seen=new Set(),out=[];
 for(const r of data.orders){
  if(!r||! /^\d{3}-\d{7}-\d{7}$/.test(String(r.orderId||''))||
    !isoDate(r.date)||r.shipmentDate&&!isoDate(r.shipmentDate)||
    typeof r.title!=='string'||r.title.trim().length<4||r.title.length>240||
    !Number.isSafeInteger(r.cents)||r.cents<1||r.cents>20000000||
    r.charged!==null&&(!Number.isSafeInteger(r.charged)||r.charged<1||r.charged>20000000))
   throw Error('Amazon report included an invalid or unverified order item');
  const id=[r.orderId,r.title,r.cents,r.shipmentDate].join('|');
  if(seen.has(id))continue;seen.add(id);
  out.push({orderId:r.orderId,title:r.title.trim(),date:r.date,
   shipmentDate:r.shipmentDate||'',cents:r.cents,charged:r.charged});
 }
 return out;
}
function prepare(state,orders,categories){
 const before=state.ledgerAdjustments||{};
 const match=amazon.match(orders,state.transactions||{},before,categories);
 return apply.prepare(match,before,{transactions:state.transactions||{},categories,
  automatic:before.categoryAutomation?.automatic!==false,replaceOther:false});
}
function visited(cloud,run){
 const scanned={...(cloud.scanned||{})},at=new Date().toISOString();
 for(const target of run.targets||[])if(typeof target==='string'&&target.startsWith('bank:'))
  scanned[target]=at;
 // Avoid an unbounded encrypted database, prioritizing recent last-visited IDs.
 const keys=Object.keys(scanned);
 if(keys.length>4000)for(const id of keys.sort((a,b)=>scanned[a].localeCompare(scanned[b]))
  .slice(0,keys.length-4000))delete scanned[id];
 return scanned;
}
module.exports={local,due,eligible,safeStatus,ensureKey,validateKey,start,getRun,
 parseOrders,prepare,visited,MAX_ESTIMATED_RUN_USD,MAX_STEPS,MAX_DURATION,goal,orderSchema};
