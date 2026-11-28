'use strict';
// TinyFish reads Amazon only. The private Ledger server matches its structured
// results to authoritative posted bank charges; no Plaid data goes to TinyFish.
const Evidence=require('./amazon-evidence.cjs');
const pairing=require('./amazon-pairing.cjs');
const amazon=require('./amazon-import.cjs');
const apply=require('./amazon-apply.cjs');
const API='https://agent.tinyfish.ai';
const DEFAULT_AGENT_MAX_STEPS=150,MAX_DURATION=600,MAX_ORDERS=250;
const MAX_RUNS_30_DAYS=13; // includes deliberate owner-triggered runs
const MAX_RUNS_PER_PACIFIC_DAY=1;
const RECOVERY_VERSION='possible-cloud-matches-v1';
const PAYMENT_VERSION='payment-first-v1';
const PAYMENT_URL='https://www.amazon.com/cpe/yourpayments/transactions';
const MAX_ESTIMATED_RUN_USD=2.42; // model: default 150*$0.016 + 10 minutes*$0.002; NOT a provider-enforced dollar cap
const DAYS=new Set([1,4,6]); // Monday / Thursday / Saturday, Pacific time
const isoDate=s=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||'')))return false;
 const date=new Date(s+'T12:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===s;
};
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
function runsInWindow(cloud,now=new Date()){
 const end=now.getTime(),start=end-30*86400000;
 const starts=(cloud?.runStarts||[]).filter(t=>{
  const ms=Date.parse(t);
  return Number.isFinite(ms)&&ms>start&&ms<=end;
 });
 return {month:starts.length,
  today:starts.filter(t=>local(new Date(t)).day===local(now).day).length,
  starts};
}
function limit(cloud,now=new Date()){
 const tally=runsInWindow(cloud,now);
 if(tally.month>=MAX_RUNS_30_DAYS)return '30-day limit reached';
 if(tally.today>=MAX_RUNS_PER_PACIFIC_DAY)return 'One Amazon browser check already started today';
 return null;
}
function baseline(state,cloud,now=new Date()){
 const at=now.toISOString(),scanned={...(cloud.scanned||{})};
 // Existing transactions at first enablement are not a surprise paid
 // historical import; only newly posted/unmatched charges after setup
 // trigger unattended browsing. Manual ZIP import handles earlier history.
 for(const t of Object.values(state.transactions||{}))if(Evidence.isAmazon(t))
  scanned[keyFor(t)]=at;
 const keys=Object.keys(scanned);
 if(keys.length>4000)for(const k of keys.sort((a,b)=>scanned[a].localeCompare(scanned[b]))
  .slice(0,keys.length-4000))delete scanned[k];
 return {...cloud,baselineAt:cloud.baselineAt||at,scanned};
}
function due(cloud,now=new Date()){
 const slot=local(now);
 return cloud?.enabled===true&&!!cloud?.baselineAt&&!cloud?.pausedReason&&!cloud?.run&&
  !limit(cloud,now)&&DAYS.has(slot.weekday)&&slot.hour>=8&&
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
function paymentPilotPassed(cloud){
 return cloud?.paymentPilotVersion===PAYMENT_VERSION;
}
function safeStatus(state){
 const c=state.amazonCloud||{},waiting=eligible(state).length,usage=runsInWindow(c),
  possible=Object.values(state.ledgerAdjustments?.amazonEvidence||{}).filter(e=>
   e?.match==='possible'&&e?.uncertainty==='cloud-unverified-settlement').length,
  notes=state.ledgerAdjustments?.predictions?.transactionNotes||{},
  unnoted=eligible(state,{retry:true}).filter(t=>
   !String(notes[t.key]||'').trim()),
  missing=unnoted.length,
  txByKey=new Map(Object.values(state.transactions||{}).map(t=>[keyFor(t),t])),
  replayId=c.lastCompletedRunId||c.lastFailedRunId||null,
  lastRead=Date.parse(c.lastCompletedRunAt||''),
  tried=new Set(c.lastFreeReplayRunId===replayId&&
   c.lastFreeReplayVersion===RECOVERY_VERSION?
    c.lastFreeReplayTargets||[]:[]),
  earlier=unnoted.some(t=>{
   const tx=txByKey.get(t.key);
   return tx&&!tried.has(t.key)&&(!Number.isFinite(lastRead)||
    Date.parse(tx.date+'T12:00:00Z')<=lastRead+86400000);
  }),
  replayReady=!!c.apiKey&&!c.run&&!!replayId&&earlier;
 return {enabled:c.enabled===true,connected:!!c.apiKey,
  paymentPilotRequired:!!c.apiKey&&!paymentPilotPassed(c),
  lastPaymentCount:c.lastPaymentCount||0,
  lastPaymentMatches:c.lastPaymentMatches||0,
  lastAttemptAt:c.lastAttemptAt||null,lastSuccessAt:c.lastSuccessAt||null,
  lastCheckedAt:c.lastCheckedAt||null,
  lastOutcome:c.lastOutcome||'Not yet checked',lastCount:c.lastCount||0,
  lastMatched:c.lastMatched||0,lastPossible:c.lastPossible||0,
  possibleAmazonCharges:possible,lastUnmatched:c.lastUnmatched||0,
  runActive:!!c.run,runStatus:c.run?.status||null,
  amazonSignInConfirmed:c.amazonSignInClaimed===true,
  needsAttention:!!c.pausedReason||c.run?.status==='uncertain',
  pausedReason:c.pausedReason||null,
  replayRunId:replayId,
  manualReviewAvailable:!!c.apiKey&&!!replayId&&!c.run&&
   (missing>0||possible>0),
  replayAvailable:replayReady,
  unnotedAmazonCharges:missing,
  pendingAmazonCharges:waiting,maxCostUsd:MAX_ESTIMATED_RUN_USD,
  runsLast30Days:usage.month,maxRuns30Days:MAX_RUNS_30_DAYS,
  runLimitReason:limit(c),initialSetupReady:!!c.baselineAt,
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
  let reason='',provider={};
  try{reason=(await res.text()).slice(0,3000)}catch{}
  try{provider=JSON.parse(reason)}catch{}
  const issue=provider?.error&&typeof provider.error==='object'?provider.error:{};
  const rawCode=String(issue.code||'');
  const code=/^[A-Z][A-Z0-9_]{2,50}$/.test(rawCode)?rawCode:null;
  const requestId=String(provider.request_id||res.headers?.get?.('x-request-id')||'');
  // Provider error messages are untrusted and can quote input. Never echo
  // credentials, URLs, order IDs or long opaque identifiers in Ledger status.
  const safeDetail=String(issue.message||'').replaceAll(apiKey,'[redacted]')
   .replace(/https?:\/\/\S+/gi,'[website]')
   .replace(/\S+@\S+\.\S+/g,'[redacted]')
   .replace(/\b\d{3}-\d{7}-\d{7}\b/g,'[order]')
   .replace(/\b[A-Za-z0-9_-]{40,}\b/g,'[redacted]')
   .replace(/[\r\n\t]+/g,' ').slice(0,180);
  const message=res.status===401||res.status===403?
   'TinyFish key not accepted, or this feature is not permitted for the account.':
   res.status===402?'TinyFish wallet needs funds. Open your TinyFish account.':
   res.status===400||res.status===422?
    'TinyFish rejected the Amazon request ('+res.status+
    (code?', '+code:'')+').'+(safeDetail?' '+safeDetail:''):
   'TinyFish could not complete the request ('+res.status+').';
  const correlation=/^[A-Za-z0-9_-]{8,85}$/.test(requestId)?
   ' Request ID: '+requestId+'.':'';
  const error=new Error(message+correlation);
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
 // A wallet lookup can return 404 for valid legacy TinyFish API keys.
 // Profile listing is a documented, read-only authenticated endpoint that
 // also verifies the actual saved browser this integration needs.
 const data=await request(apiKey,API+'/v1/profiles',{},fetcher);
 if(!Array.isArray(data.profiles))throw Error('TinyFish did not return a usable profile list');
 const profile=data.profiles.find(p=>p?.is_default===true);
 if(!profile||!/^prof_[a-zA-Z0-9_-]{6,100}$/.test(String(profile.id||''))){
  const error=new Error('In TinyFish → TinyProfiles, create or select a profile and set it as Default before connecting Ledger.');
  error.httpStatus=409;throw error;
 }
 const sites=profile.signed_in_sites;
 const seen=Array.isArray(sites)?sites.some(p=>{
  const site=String(typeof p==='string'?p:p?.site||p?.domain||'').toLowerCase();
  return site==='amazon.com'||site.endsWith('.amazon.com');
 }):null;
 if(seen===false){
  const error=new Error('Amazon is not saved in the Default TinyProfile. Open its setup browser, sign into Amazon, choose Save, and then press Connect TinyFish again.');
  error.httpStatus=409;throw error;
 }
 // Some accounts omit signed_in_sites metadata; that is not proof of a
 // saved login. The first real read will still fail closed if absent.
 return {profileId:profile.id,amazonSignInClaimed:seen===true};
}
function goal(){
 return 'Read only Amazon.com Your Payments > Transactions for the last 45 days '+
 'using the existing signed-in saved browser profile. Start at the Transactions page, '+
 'NOT the Your Orders list. Find actual completed CHARGES and their posted payment amounts/dates. '+
 'Amazon may charge separate shipments from one order separately; never substitute an order total for a payment amount. '+
 'For EACH visible completed charge, follow its transaction details and linked order/shipment, '+
 'and read the associated product names if Amazon reveals them. '+
 'productScope="payment" ONLY if Amazon specifically links those product names to THAT charge/shipment; '+
 'productScope="order" if only all products for the entire order are shown; '+
 'productScope="unknown" if the payment cannot be linked to any products. '+
 'Never claim all products of a multi-shipment order were paid for by one shipment. '+
 'Return a payments array of records with transactionDate (YYYY-MM-DD actual Amazon payment date), '+
 'amountCents (positive integer charge amount in cents, null if missing), '+
 'orderId (Amazon order number or empty string if missing), kind (charge, refund, authorization, or unknown), '+
 'productScope (payment, order, or unknown), and titles (array of observed product names; empty if unknown). '+
 'Return only observed information: NEVER zero instead of an unknown charge amount, never invented names/dates or duplicated charges. '+
 'Do not return card numbers, card last-four digits, payment methods, addresses, emails or billing details. '+
 'Do NOT buy, cancel, submit forms, change settings, contact sellers or open payment-method editing. '+
 'Read-only transaction details and order details are permitted; payment-method management is not. '+
 'Stop before dates older than 45 days. Include all observed completed charges, even if their linked order cannot be read. '+
 'Set complete=false if the date range is not fully covered, transaction pages cannot be read, or the list is truncated. '+
 'Stop if signed out or challenged and set signedIn=false. Limit 100 payment entries. '+
 'No bank or Ledger access is needed.';
}
// The old order format stays readable for no-cost replay of already completed
// browser runs. NEW paid runs only request the transaction-first format.
const orderSchema={type:'object',properties:{
 orders:{type:'array',items:{type:'object',properties:{
  orderId:{type:'string'},title:{type:'string'},date:{type:'string'},
  shipmentDate:{type:'string'},cents:{type:'integer',nullable:true},charged:{type:'integer',nullable:true}
 },required:['orderId','title','date','shipmentDate','cents','charged']}},
 signedIn:{type:'boolean'},complete:{type:'boolean'}
},required:['orders','signedIn','complete']};
const paymentSchema={type:'object',properties:{
 payments:{type:'array',items:{type:'object',properties:{
  transactionDate:{type:'string'},amountCents:{type:'integer',nullable:true},
  orderId:{type:'string'},kind:{type:'string'},productScope:{type:'string'},
  titles:{type:'array',items:{type:'string'}}
 },required:['transactionDate','amountCents','orderId','kind','productScope','titles']}},
 signedIn:{type:'boolean'},complete:{type:'boolean'}
},required:['payments','signedIn','complete']};
function knownGoal(value){
 const g=String(value||'');
 return g.includes('Read only Amazon.com Your Orders')||
  g.includes('Read only Amazon.com Your Payments');
}
async function start(apiKey,profileId,fetcher){
 if(!/^prof_[a-zA-Z0-9_-]{6,100}$/.test(String(profileId||'')))
  throw Error('TinyFish saved Amazon profile is not connected. Reconnect in Ledger settings.');
 const result=await request(apiKey,API+'/v1/automation/run-async',{
  method:'POST',body:JSON.stringify({url:PAYMENT_URL,
   goal:goal(),use_profile:true,profile_id:profileId,browser_profile:'lite',
   agent_config:{max_duration_seconds:MAX_DURATION},
   output_schema:paymentSchema})
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
 if(data.complete!==true)throw Error('Amazon returned an incomplete report. No purchases were changed');
 // New payment-first reports are charge/settlement records, not orders.
 // Do NOT reuse the old 'charged' order-total field to represent a payment.
 if(Array.isArray(data.payments)){
  if(data.payments.length>100)
   throw Error('Amazon payment report exceeds the bounded 100-entry scan');
  const runDay=typeof run.created_at==='string'&&Number.isFinite(Date.parse(run.created_at))?
   new Date(run.created_at):new Date();
  const earliest=new Date(runDay.getTime()-45*86400000).toISOString().slice(0,10);
  const latest=new Date(runDay.getTime()+2*86400000).toISOString().slice(0,10);
  let ignoredOutsideWindow=0;
  const payments=[];
  for(const row of data.payments){
   if(!row||!isoDate(row.transactionDate)||
      !(row.amountCents===null||(Number.isSafeInteger(row.amountCents)&&
       row.amountCents>=0&&row.amountCents<=20000000))||
      typeof row.orderId!=='string'||
      !(row.orderId===''||/^\d{3}-\d{7}-\d{7}$/.test(row.orderId))||
      !['charge','refund','authorization','unknown'].includes(row.kind)||
      !['payment','order','unknown'].includes(row.productScope)||
      !Array.isArray(row.titles)||row.titles.length>40||
      row.titles.some(t=>typeof t!=='string'||!t.trim()||t.length>240))
    throw Error('Amazon payment report included invalid or unverified transaction fields');
   if(row.transactionDate<earliest||row.transactionDate>latest){
    ignoredOutsideWindow++;continue;
   }
   // A whole-order product list cannot be promoted to a shipment-level
   // identity merely because the payment amount is correct.
   payments.push({...row,titles:row.titles.map(t=>t.trim())});
  }
  const result=[];
  Object.defineProperties(result,{
   payments:{value:payments},
   unpricedOrders:{value:[]},
   ignoredOutsideWindow:{value:ignoredOutsideWindow}
  });
  return result;
 }
 if(!Array.isArray(data.orders)||data.orders.length>MAX_ORDERS)
  throw Error('Amazon order report was not complete or was too large');
 // A source can report complete:true yet omit item-level prices. Preserve
 // the entire uncertain order as unavailable; never infer a missing line from
 // a known total or silently present a partial order as an exact match.
 const runDay=typeof run.created_at==='string'&&Number.isFinite(Date.parse(run.created_at))?
  new Date(run.created_at):new Date();
 const earliest=new Date(runDay.getTime()-45*86400000).toISOString().slice(0,10);
 const latest=new Date(runDay.getTime()+2*86400000).toISOString().slice(0,10);
 const groups=new Map(),seen=new Set();let ignoredOutsideWindow=0;
 for(const r of data.orders){
  if(!r||!/^\d{3}-\d{7}-\d{7}$/.test(String(r.orderId||''))||
    !isoDate(r.date)||r.shipmentDate&&!isoDate(r.shipmentDate)||
    typeof r.title!=='string'||r.title.trim().length<4||r.title.length>240||
    !(r.cents===null||(Number.isSafeInteger(r.cents)&&r.cents>=0&&r.cents<=20000000))||
    !(r.charged===null||(Number.isSafeInteger(r.charged)&&r.charged>=0&&r.charged<=20000000)))
   throw Error('Amazon report included an invalid or unverified order item');
  if(r.date<earliest||r.date>latest){ignoredOutsideWindow++;continue}
  const id=[r.orderId,r.title,r.cents,r.shipmentDate].join('|');
  if(seen.has(id))continue;seen.add(id);
  if(!groups.has(r.orderId))groups.set(r.orderId,[]);
  groups.get(r.orderId).push({...r,title:r.title.trim()});
 }
 const priced=[],unpricedOrders=[];
 for(const [orderId,items] of groups){
  const amounts=[...new Set(items.map(i=>i.charged))];
  const charged=amounts.length===1&&amounts[0]>0?amounts[0]:null;
  if(items.some(i=>!Number.isSafeInteger(i.cents)||i.cents<=0)){
   const shipmentDays=[...new Set(items.map(i=>i.shipmentDate||i.date))];
   // Preserve observed titles only in transient memory. The bank matcher
   // still requires a unique exact full-order charge before saving a Note.
   unpricedOrders.push({orderId,date:items[0].date,
    shipmentDate:shipmentDays.sort().at(-1),
    multiShipment:shipmentDays.length!==1,
    items:items.map(i=>({title:i.title,cents:i.cents>0?i.cents:null,
     date:i.date,shipmentDate:i.shipmentDate||''})),
    charged});
   continue;
  }
  // Inconsistent order totals are not trustworthy order-level evidence.
  for(const i of items)priced.push({...i,charged});
 }
 Object.defineProperties(priced,{
  unpricedOrders:{value:unpricedOrders},
  ignoredOutsideWindow:{value:ignoredOutsideWindow}
 });
 return priced;
}
// Match actual Amazon payment transactions to bank settlements; payment
// amounts are NEVER order totals, and whole-order products are only Possible.
function preparePayments(state,payments,categories,targets){
 const before=state.ledgerAdjustments||{},
  chosen=new Set(Array.isArray(targets)?targets:[]),
  all=Object.values(state.transactions||{}).filter(Evidence.isAmazon),
  scoped=all.filter(t=>chosen.has(keyFor(t))),
  notes=before.predictions?.transactionNotes||{};
 if(!scoped.length)throw Error('Reserved Amazon charges are no longer posted');
 const gap=(bank,day)=>Math.round((Date.parse(bank.date+'T12:00:00Z')-
  Date.parse(day+'T12:00:00Z'))/86400000);
 const matches=[],suggestions=[];
 // Match only a unique exact amount from a completed charge in Amazon's
 // payment list. A repeated payment or another bank debit that could own it
 // makes the identity ambiguous; never pick by superficial order proximity.
 for(const tx of scoped){
  if(String(notes[keyFor(tx)]||'').trim())continue;
  const amount=Math.round(Number(tx.amount)*100);
  if(!Number.isSafeInteger(amount)||amount<=0)continue;
  const found=payments.filter(p=>p.kind==='charge'&&p.amountCents===amount&&
   gap(tx,p.transactionDate)>=-2&&gap(tx,p.transactionDate)<=10);
  if(found.length!==1)continue;
  const payment=found[0];
  if(!payment.orderId||!payment.titles.length||
     payment.productScope==='unknown')continue;
  const competing=all.some(other=>keyFor(other)!==keyFor(tx)&&
   Math.round(Number(other.amount)*100)===amount&&
   gap(other,payment.transactionDate)>=-2&&gap(other,payment.transactionDate)<=10);
  if(competing)continue;
  const items=payment.titles.map(title=>({title,cents:null}));
  const shared={transactionId:tx.id,accountId:tx.accountId,amountCents:amount,
   orderId:payment.orderId,date:tx.date,items,
   categories:[],lines:[],needsReview:true,alreadyImported:false,
   notesOnly:true};
  if(payment.productScope==='payment'){
   matches.push({...shared,confidence:'exact',
    source:'payment-transaction-no-item-prices',
    note:pairing.itemNote(items)});
  }else{
   suggestions.push({...shared,confidence:'possible',
    source:'payment-order-products-not-shipment-verified',
    note:pairing.itemNote(items,'Possible Amazon: '),
    choices:[{orderId:payment.orderId,date:payment.transactionDate,items}],
    suggestedCategory:null});
  }
 }
 const involved=Object.fromEntries([...matches,...suggestions]
  .map(m=>[m.transactionId,scoped.find(t=>t.id===m.transactionId)])
  .filter(([,tx])=>!!tx));
 const proposal=apply.prepare({
  matches,suggestions,bankCharges:scoped.length,
  importedItems:payments.length,orderGroups:new Set(payments.map(p=>p.orderId)).size
 },before,{transactions:involved,categories,automatic:false,replaceOther:false});
 return {...proposal,
  matchedKeys:matches.map(m=>keyFor(involved[m.transactionId])),
  possibleKeys:suggestions.map(m=>keyFor(involved[m.transactionId])),
  noteOnlyMatches:matches.length,paymentMatches:matches.length,
  paymentPossible:suggestions.length,paymentRows:payments.length,
  unpricedOrderCount:0};
}
function prepare(state,orders,categories,targets){
 if(Array.isArray(orders.payments))
  return preparePayments(state,orders.payments,categories,targets);
 const before=state.ledgerAdjustments||{},
  chosen=new Set(Array.isArray(targets)?targets:[]);
 if(!chosen.size)throw Error('Amazon run did not reserve any bank charges');
 // CRITICAL: Never let a new cloud batch rewrite Notes/categories on earlier
 // historical charges, manually reviewed charges, or another account.
 // The read-only bank matcher receives only the exact charge IDs reserved
 // before the external TinyFish request.
 const scoped=Object.fromEntries(Object.values(state.transactions||{}).filter(t=>
  Evidence.isAmazon(t)&&chosen.has(keyFor(t))).map(t=>[t.id,t]));
 if(!Object.keys(scoped).length)throw Error('Reserved Amazon charges are no longer posted');
 const match=amazon.match(orders,scoped,before,categories);
 // A partially unreadable order might be the same posted bank debit.
 // Do not claim another order's product as verified if that incomplete order
 // could have settled on the same date/amount, including split shipments.
 const uncertain=orders.unpricedOrders||[];
 const exactMatches=(match.matches||[]).filter(m=>{
  if(m.confidence!=='exact')return false;
  const tx=scoped[m.transactionId];if(!tx)return false;
  const amount=Math.round(Number(tx.amount)*100);
  return !uncertain.some(order=>{
   const when=order.shipmentDate||order.date;
   const gap=Math.round((Date.parse(tx.date+'T12:00:00Z')-
    Date.parse(when+'T12:00:00Z'))/86400000);
   return gap>=-2&&gap<=21&&(order.charged===null||order.charged>=amount);
  });
 });
 // Automatic cloud imports are narrower than manual imports: no speculative
 // Possible notes or inferred broad categories from uncertain identity.
 // The follow-up category pass also sees only those exactly matched charges.
 // An item price is required for item-level allocation, but not for a
 // product Note if a fully observed single-shipment ORDER total exactly
 // equals a unique posted bank charge. Never infer individual item prices
 // or categorize this note-only match.
 const datedGap=(tx,when)=>Math.round((Date.parse(tx.date+'T12:00:00Z')-
  Date.parse(when+'T12:00:00Z'))/86400000);
 const pricedGroups=new Map();
 for(const row of orders){
  if(!pricedGroups.has(row.orderId))pricedGroups.set(row.orderId,[]);
  pricedGroups.get(row.orderId).push(row);
 }
 const nearbyPriced=(tx,amount)=>[...pricedGroups.values()].some(items=>{
  const day=items.map(i=>i.shipmentDate||i.date).sort().at(-1);
  const gap=datedGap(tx,day);
  return gap>=-2&&gap<=7&&
   (items.some(i=>i.cents===amount)||items.reduce((n,i)=>n+i.cents,0)===amount||
    items.some(i=>i.charged===amount));
 });
 const alreadyExact=new Set(exactMatches.map(m=>m.transactionId));
 const tentative=[];
 for(const tx of Object.values(scoped)){
  if(alreadyExact.has(tx.id))continue;
  const amount=Math.round(Number(tx.amount)*100);
  if(!Number.isSafeInteger(amount)||amount<=0||nearbyPriced(tx,amount))continue;
  const choices=uncertain.filter(order=>{
   if(order.multiShipment||order.charged!==amount||!order.items?.length)return false;
   const gap=datedGap(tx,order.shipmentDate||order.date);
   return gap>=-1&&gap<=7;
  });
  if(choices.length!==1)continue;
  const order=choices[0];
  // Scope writes to reserved transactions, but evaluate uniqueness against
  // ALL existing posted bank charges. A previously checked/saved debit may
  // already own the order; never attach its titles to a second debit.
  const wholeHistory=Object.values(state.transactions||{}).filter(Evidence.isAmazon);
  if(wholeHistory.some(other=>keyFor(other)!==keyFor(tx)&&
   Math.round(Number(other.amount)*100)===amount&&
   datedGap(other,order.shipmentDate||order.date)>=-1&&
   datedGap(other,order.shipmentDate||order.date)<=7))continue;
  if(Object.entries(before.amazonEvidence||{}).some(([id,e])=>
   id!==String(tx.id)&&e?.match==='exact'&&e?.orderId===order.orderId))continue;
  // A second incompletely priced order may settle as the same bank debit,
  // especially when Amazon splits charges. Do not automatically choose.
  if(uncertain.some(other=>other!==order&&
   datedGap(tx,other.shipmentDate||other.date)>=-1&&
   datedGap(tx,other.shipmentDate||other.date)<=7&&
   (other.charged===null||other.charged>=amount)))continue;
  tentative.push({tx,order,amount});
 }
 const owners=new Map();
 for(const c of tentative)owners.set(c.order.orderId,(owners.get(c.order.orderId)||0)+1);
 const noteOnly=tentative.filter(c=>owners.get(c.order.orderId)===1).map(({tx,order,amount})=>({
  transactionId:tx.id,accountId:tx.accountId,amountCents:amount,
  orderId:order.orderId,date:tx.date,
  note:pairing.itemNote(order.items),items:order.items,
  confidence:'exact',source:'order-total-no-item-price',notesOnly:true,
  categories:[],lines:[],needsReview:true,alreadyImported:false
 }));
 const matches=[...exactMatches,...noteOnly];
 const confirmed=new Set(matches.map(m=>m.transactionId));
 const claimed=new Set([
  ...matches.map(m=>String(m.orderId).split(' · ')[0]),
  ...Object.values(before.amazonEvidence||{}).filter(e=>e?.match==='exact')
   .map(e=>String(e.orderId||'').split(' · ')[0])
 ]);
 // Amazon often posts settlement amounts different from product or order
 // totals. Exact reconciliation is still mandatory for confirmation and
 // categorization, but an observed title can be saved as explicitly POSSIBLE.
 // Score only actual orders in the completed provider report, never guesses.
 const allOrders=[
  ...[...pricedGroups].map(([orderId,items])=>{
   const known=[...new Set(items.map(i=>i.charged))];
   return {orderId,items,shipmentDate:items.map(i=>i.shipmentDate||i.date).sort().at(-1),
    charged:known.length===1&&known[0]>0?known[0]:null};
  }),...uncertain
 ].filter(order=>order.items?.length&&!claimed.has(order.orderId));
 const suggestions=[];
 for(const tx of Object.values(scoped)){
  if(confirmed.has(tx.id))continue;
  const key=keyFor(tx),existing=String(before.predictions?.transactionNotes?.[key]||'').trim();
  if(existing)continue; // Never replace handwritten or prior imported Notes.
  const amount=Math.round(Number(tx.amount)*100);
  if(!Number.isSafeInteger(amount)||amount<=0)continue;
  const options=allOrders.map(order=>{
   const days=datedGap(tx,order.shipmentDate||order.date);
   if(days< -1||days>7)return null;
   const total=order.charged;
   const discrepancy=total?Math.abs(total-amount)/Math.max(total,amount):null;
   // An unknown total is weaker than a genuine measured near-total, but
   // Amazon split shipments make modest amount differences non-conclusive.
   if(discrepancy===null&&days>4)return null;
   if(discrepancy!==null&&discrepancy>.35&&days>3)return null;
   const score=(discrepancy===null?.55:discrepancy<=.35?discrepancy:.65)+
    Math.abs(days-2)*.07;
   return {order,score};
  }).filter(Boolean).sort((a,b)=>a.score-b.score||
   a.order.orderId.localeCompare(b.order.orderId));
  if(!options.length)continue;
  // Disclose alternatives instead of quietly treating the best-ranked
  // candidate as verified. The complete private evidence retains up to 3.
  const selected=options.slice(0,3),unique=selected.length===1||
   (selected[1].score-selected[0].score>=.28&&selected[0].score<=.22);
  const choices=unique?selected.slice(0,1):selected;
  const shown=choices.map(({order})=>({orderId:order.orderId,
   date:order.shipmentDate||order.date,items:order.items}));
  const note=unique?pairing.itemNote(shown[0].items,'Possible Amazon: '):
   pairing.choiceNote(shown);
  if(!note||note.length>160)continue;
  suggestions.push({transactionId:tx.id,accountId:tx.accountId,
   amountCents:amount,date:tx.date,orderId:shown[0].orderId,
   note,confidence:'possible',source:'cloud-unverified-settlement',
   choices:shown,suggestedCategory:null});
 }
 const proposedTransactions=Object.fromEntries([...matches,...suggestions]
  .map(m=>[m.transactionId,scoped[m.transactionId]]).filter(([_,tx])=>!!tx));
 const proposal=apply.prepare({...match,matches,suggestions},before,{
  transactions:proposedTransactions,categories,
  automatic:before.categoryAutomation?.automatic!==false,replaceOther:false});
 return {...proposal,matchedKeys:matches.map(m=>keyFor(scoped[m.transactionId])),
  possibleKeys:suggestions.map(m=>keyFor(scoped[m.transactionId])),
  noteOnlyMatches:noteOnly.length,unpricedOrderCount:uncertain.length};
}
function visited(cloud,run,matchedKeys=[]){
 const scanned={...(cloud.scanned||{})},at=new Date().toISOString();
 const verified=new Set(matchedKeys);
 for(const target of run.targets||[])if(verified.has(target)&&typeof target==='string'&&target.startsWith('bank:'))
  scanned[target]=at;
 // Avoid an unbounded encrypted database, prioritizing recent last-visited IDs.
 const keys=Object.keys(scanned);
 if(keys.length>4000)for(const id of keys.sort((a,b)=>scanned[a].localeCompare(scanned[b]))
  .slice(0,keys.length-4000))delete scanned[id];
 return scanned;
}
module.exports={local,due,eligible,safeStatus,ensureKey,validateKey,start,getRun,
 parseOrders,prepare,visited,baseline,limit,runsInWindow,RECOVERY_VERSION,MAX_RUNS_30_DAYS,
 MAX_ESTIMATED_RUN_USD,DEFAULT_AGENT_MAX_STEPS,MAX_DURATION,goal,orderSchema,
 paymentSchema,PAYMENT_URL,PAYMENT_VERSION,knownGoal,paymentPilotPassed};
