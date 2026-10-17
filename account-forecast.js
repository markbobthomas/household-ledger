/* Phase B: deterministic, reconciled multi-account projections.
 * One household event is posted once to its real account. An owned-account
 * movement has two equal-and-opposite legs (including credit settlements).
 * No provider balances or immutable source transactions are modified.
 */
(function(root){
'use strict';
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const iso=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const date=s=>new Date(s+'T12:00:00Z');
const addDays=(s,n)=>{const d=date(s);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const deltaDays=(a,b)=>Math.round((date(a)-date(b))/86400000);
const norm=s=>String(s||'').toLowerCase().trim().replace(/\s+/g,' ');
const cashTypes=new Set(['checking','savings','depository']);
const cardTypes=new Set(['credit','credit_card','credit card']);
const validFrequency=new Set(['once','weekly','biweekly','monthly','quarterly','semiannual','annual']);
const monthIndex=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7));
const monthEnd=s=>new Date(Date.UTC(Number(s.slice(0,4)),Number(s.slice(5,7)),0)).getUTCDate();
function typeOf(a){
 const raw=norm(a.accountType||a.type||a.subtype);
 if(cardTypes.has(raw))return 'credit';
 if(cashTypes.has(raw))return raw==='depository'?'checking':raw;
 return 'unsupported';
}
function occurrences(plan,asOf,end){
 const anchor=String(plan.anchorDate||plan.date||''),frequency=plan.frequency||'once';
 if(!iso(anchor)||!validFrequency.has(frequency))return [];
 if(frequency==='once')return anchor>asOf&&anchor<=end?[anchor]:[];
 if(frequency==='weekly'||frequency==='biweekly'){
  const span=frequency==='weekly'?7:14,from=Math.max(0,Math.ceil(deltaDays(asOf,anchor)/span));
  const results=[];
  for(let i=from;i<from+60;i++){
   const day=addDays(anchor,i*span);
   if(day>end)break;
   if(day>asOf&&day>=anchor)results.push(day);
  }
  return results;
 }
 const step={monthly:1,quarterly:3,semiannual:6,annual:12}[frequency],wanted=Number(plan.day||anchor.slice(8,10));
 if(!Number.isInteger(wanted)||wanted<1||wanted>31)return [];
 const result=[];
 for(let m=asOf.slice(0,7);m<=end.slice(0,7);){
  const diff=monthIndex(m)-monthIndex(anchor.slice(0,7));
  if(diff>=0&&diff%step===0){
   const d=m+'-'+String(Math.min(wanted,monthEnd(m))).padStart(2,'0');
   if(d>asOf&&d<=end&&d>=anchor)result.push(d);
  }
  const [y,mo]=m.split('-').map(Number);
  const next=new Date(Date.UTC(y,mo,1));m=next.toISOString().slice(0,7);
 }
 return result;
}
function build(snapshot,expectedEvents=[],plans=[],options={}){
 const asOf=String(snapshot?.asOf||''),days=options.days??90;
 if(!iso(asOf)||!Number.isInteger(days)||days<1||days>366)throw Error('Valid as-of and 1–366 days are required');
 if(!Array.isArray(snapshot.accounts)||!snapshot.accounts.length)throw Error('Account snapshots are required');
 const through=addDays(asOf,days);
 const accounts=[],byId=new Map(),aliases=new Map();
 for(const a of snapshot.accounts){
  const id=String(a.id||a.account_id||'');
  if(!id||byId.has(id))throw Error('Every account needs a unique stable ID');
  const type=typeOf(a),current=Number(a.current),available=Number(a.available);
  const hasCurrent=Number.isFinite(current)&&a.current!==null&&a.current!==undefined;
  // A credit card's current balance is money owed, never cash available.
  const initial=hasCurrent?current:(type!=='credit'&&Number.isFinite(available)&&a.available!=null?available:null);
  const valid=type!=='unsupported'&&initial!==null;
  const state={id,name:String(a.name||id),type,valid,opening:valid?round(initial):null,
   openingAvailable:valid&&type!=='credit'&&Number.isFinite(available)&&a.available!=null?round(available):null,
   openingCurrent:hasCurrent?round(current):null,
   balance:valid?round(initial):null,availableBalance:valid&&type!=='credit'&&Number.isFinite(available)&&a.available!=null?round(available):null,
   series:[],source:a,minimum:null,lowestDate:null,events:[],closing:null,closingAvailable:null};
  accounts.push(state);byId.set(id,state);
  for(const alias of [id,a.name,a.transactionAccount]){
   const k=norm(alias);if(!k)continue;
   if(!aliases.has(k))aliases.set(k,new Set());aliases.get(k).add(id);
  }
 }
 const resolve=value=>{
  const k=norm(value);
  if(!k)return null;
  if(byId.has(String(value)))return String(value);
  const matches=aliases.get(k);
  return matches?.size===1?[...matches][0]:null;
 };
 const postings=new Map(),diagnostics={unassigned:[],unmatchedTransfers:[],unverifiedAccounts:[],suppressedDuplicates:[],pairedMovements:[]};
 const householdEvents=[],movementSignatures=new Set();
 const post=(accountId,date,kind,amount,original,groupId=null)=>{
  const a=byId.get(accountId);
  if(!a?.valid){diagnostics.unverifiedAccounts.push({id:original.id||null,accountId,reason:'No verified account balance/type'});return false}
  const row={accountId,date,kind,amount:round(amount),id:original.id||null,merchant:original.merchant||original.description||'Expected event',
   type:original.type||kind,description:original.description||'',transferGroupId:groupId};
  if(!postings.has(date))postings.set(date,[]);
  postings.get(date).push(row);householdEvents.push(row);
  return true;
 };
 const historical=Array.isArray(options.records)?options.records:[];
 const rowById=new Map(historical.map(t=>[String(t.id),t]));
 const historicalPartners=new Map();
 for(const row of historical){
  if(!row.pairedTransactionId)continue;
  const peer=rowById.get(String(row.pairedTransactionId));
  if(!peer)continue;
  const own=resolve(row.accountId||row.account),other=resolve(peer.accountId||peer.account);
  if(!own||!other||own===other)continue;
  const lookup=own+'|'+norm(row.merchant);
  if(!historicalPartners.has(lookup))historicalPartners.set(lookup,new Set());
  historicalPartners.get(lookup).add(other);
 }
 const projected=(Array.isArray(expectedEvents)?expectedEvents:[]).filter(e=>
  e&&iso(e.date)&&e.date>asOf&&e.date<=through&&Number.isFinite(Number(e.amount))&&Number(e.amount)>0&&e.enabled!==false)
  .map((e,i)=>({...e,_accountId:resolve(e.accountId||e.account),_eventIndex:i}));
 const candidates=projected.filter(e=>e.type==='transfer'&&['in','out'].includes(e.cashDirection));
 const coveredEvents=new Set();
 const movements=[];
 // A single confirmed recurring transfer leg can be expanded to its matched
 // historical counterpart. Both expected legs, if present, are merged once.
 for(const e of candidates){
  if(coveredEvents.has(e._eventIndex)||!e._accountId)continue;
  const related=historicalPartners.get(e._accountId+'|'+norm(e.merchant));
  if(!related||related.size!==1)continue;
  const other=[...related][0],from=e.cashDirection==='out'?e._accountId:other,
   to=e.cashDirection==='out'?other:e._accountId;
  const inverse=candidates.filter(q=>q!==e&&!coveredEvents.has(q._eventIndex)&&q._accountId===other&&
    q.cashDirection!==e.cashDirection&&Math.abs(Number(q.amount)-Number(e.amount))<.011&&
    Math.abs(deltaDays(q.date,e.date))<=3);
  // Multiple equally plausible counterparts are ambiguous; don't synthesize.
  if(inverse.length>1)continue;
  const groupId='matched|'+[String(e.id||e._eventIndex),String(inverse[0]?.id||'')].sort().join('|');
  coveredEvents.add(e._eventIndex);
  if(inverse.length)coveredEvents.add(inverse[0]._eventIndex);
  movements.push({id:groupId,date:e.cashDirection==='out'?e.date:inverse[0]?.date||e.date,
   amount:Number(e.amount),fromAccountId:from,toAccountId:to,source:'matched history',forecastIds:[e.id,inverse[0]?.id].filter(Boolean)});
 }
 for(const p of Array.isArray(plans)?plans:[]){
  const amount=Number(p?.amount),from=String(p?.fromAccountId||''),to=String(p?.toAccountId||'');
  if(!byId.has(from)||!byId.has(to)||from===to||!(amount>0)||!Number.isFinite(amount)){
   diagnostics.unassigned.push({id:p?.id||null,reason:'Invalid planned account movement'});continue;
  }
  for(const when of occurrences(p,asOf,through)){
   // A reviewed explicit plan takes precedence over inferred matching movement
   // or single source leg of same amount/date/accounts; never double-pay a card.
   const exists=movements.find(m=>m.fromAccountId===from&&m.toAccountId===to&&
    Math.abs(m.amount-amount)<.011&&Math.abs(deltaDays(m.date,when))<=2);
   if(exists){diagnostics.suppressedDuplicates.push({id:p.id,matching:exists.id});continue}
   movements.push({id:'plan|'+String(p.id)+'|'+when,date:when,amount,fromAccountId:from,toAccountId:to,source:'user plan'});
  }
 }
 // Explicit movement replaces a standalone inferred leg that describes the
 // very same money leaving or entering one of its account endpoints.
 for(const e of candidates){
  if(coveredEvents.has(e._eventIndex)||!e._accountId)continue;
  const replaces=movements.some(m=>Math.abs(Number(e.amount)-m.amount)<.011&&
   Math.abs(deltaDays(e.date,m.date))<=2&&
   (e.cashDirection==='out'&&m.fromAccountId===e._accountId||
    e.cashDirection==='in'&&m.toAccountId===e._accountId));
  if(replaces){coveredEvents.add(e._eventIndex);diagnostics.suppressedDuplicates.push({id:e.id,reason:'Paired movement already projected'})}
 }
 for(const m of movements){
  if(!byId.get(m.fromAccountId)?.valid||!byId.get(m.toAccountId)?.valid){
   diagnostics.unverifiedAccounts.push({id:m.id,reason:'Transfer accounts require verified balances'});continue;
  }
  const k=[m.id,m.date,m.fromAccountId,m.toAccountId].join('|');
  if(movementSignatures.has(k))continue;
  movementSignatures.add(k);
  const from=byId.get(m.fromAccountId),to=byId.get(m.toAccountId);
  const kind=from.type==='credit'||to.type==='credit'?'card_payment':'internal_transfer';
  post(from.id,m.date,'transfer_out',m.amount,{id:m.id,merchant:kind==='card_payment'?'Credit-card payment':'Account transfer',type:'transfer'},m.id);
  post(to.id,m.date,'transfer_in',m.amount,{id:m.id,merchant:kind==='card_payment'?'Credit-card payment':'Account transfer',type:'transfer'},m.id);
  diagnostics.pairedMovements.push({...m,kind,amount:round(m.amount)});
 }
 for(const e of projected){
  if(coveredEvents.has(e._eventIndex))continue;
  if(!e._accountId){
   diagnostics.unassigned.push({id:e.id||null,merchant:e.merchant||'',reason:'Expected event has no uniquely identifiable account'});continue;
  }
  const account=byId.get(e._accountId);
  if(!account.valid){diagnostics.unverifiedAccounts.push({id:e.id||null,accountId:e._accountId});continue}
  let kind;
  if(e.type==='expense')kind=account.type==='credit'?'card_purchase':'expense';
  else if(e.type==='income')kind=account.type==='credit'?'card_credit':'income';
  else if(e.type==='refund')kind=account.type==='credit'?'card_refund':'refund';
  else if(e.type==='transfer'&&e.cashDirection==='out')kind='transfer_out';
  else if(e.type==='transfer'&&e.cashDirection==='in')kind='transfer_in';
  else {diagnostics.unassigned.push({id:e.id||null,reason:'Expected event needs a valid money direction'});continue}
  if(kind==='card_credit'){
   diagnostics.unassigned.push({id:e.id||null,reason:'Credit-card income requires an identified refund or transfer'});continue;
  }
  if(kind.startsWith('transfer_'))diagnostics.unmatchedTransfers.push({id:e.id||null,accountId:e._accountId,amount:Number(e.amount)});
  post(e._accountId,e.date,kind,Number(e.amount),e);
 }
 const daysSeries=[];
 let householdSpending=0,householdIncome=0;
 for(let i=0;i<=days;i++){
  const currentDay=addDays(asOf,i),entries=postings.get(currentDay)||[];
  let cash=0,debt=0,net=0;
  for(const account of accounts){
   const dayPosts=entries.filter(e=>e.accountId===account.id);
   if(account.valid){
    let netChange=0,inflow=0,outflow=0,purchases=0;
    for(const p of dayPosts){
     const a=Number(p.amount);
     // Positive card balance = liability owed. Deposit/credit reduces debt.
     const change=account.type==='credit'?
      (['card_purchase','transfer_out'].includes(p.kind)?a:
       ['card_refund','transfer_in'].includes(p.kind)?-a:0):
      (['income','refund','transfer_in'].includes(p.kind)?a:-a);
     if(p.kind==='expense'||p.kind==='card_purchase')householdSpending+=a;
     if(p.kind==='refund'||p.kind==='card_refund')householdSpending-=a;
     if(p.kind==='income')householdIncome+=a;
     netChange+=change;
     if(account.type==='credit'){
      if(change>=0)purchases+=change;else outflow+=-change;
     }else if(change>=0)inflow+=change;else outflow+=-change;
    }
    account.balance=round(account.balance+netChange);
    if(account.availableBalance!==null)account.availableBalance=round(account.availableBalance+netChange);
    const visible=account.type==='credit'?account.balance:account.availableBalance??account.balance;
    if(account.minimum===null||visible<account.minimum){account.minimum=visible;account.lowestDate=currentDay}
    account.series.push({date:currentDay,balance:visible,currentBalance:account.balance,
     income:round(inflow),outflow:round(outflow),purchases:round(purchases),events:dayPosts});
    account.events.push(...dayPosts);
    if(account.type==='credit')debt+=account.balance;
    else {cash+=account.balance}
    net+=account.type==='credit'?-account.balance:account.balance;
   }
  }
  daysSeries.push({date:currentDay,cash:round(cash),debt:round(debt),net:round(net),
   movements:entries});
 }
 for(const a of accounts){a.closing=a.valid?round(a.balance):null;
  a.closingAvailable=a.valid&&a.type!=='credit'?a.availableBalance:null;
  delete a.balance;delete a.availableBalance;
 }
 const openingCash=round(accounts.filter(a=>a.valid&&a.type!=='credit').reduce((n,a)=>n+a.opening,0));
 const openingDebt=round(accounts.filter(a=>a.valid&&a.type==='credit').reduce((n,a)=>n+a.opening,0));
 const openingNet=round(openingCash-openingDebt);
 const household={openingCash,closingCash:daysSeries.at(-1).cash,openingDebt,
  closingDebt:daysSeries.at(-1).debt,openingNet,closingNet:daysSeries.at(-1).net,
  expectedSpending:round(householdSpending),expectedIncome:round(householdIncome),
  forecastChange:round(daysSeries.at(-1).net-openingNet),
  explainedChange:round(householdIncome-householdSpending),
  conservationDifference:round(daysSeries.at(-1).net-openingNet-(householdIncome-householdSpending)),
  complete:accounts.every(a=>a.valid)&&diagnostics.unassigned.length===0&&
   diagnostics.unverifiedAccounts.length===0&&diagnostics.unmatchedTransfers.length===0};
 return {asOf,through,days,accounts,series:daysSeries,household,diagnostics,
  events:householdEvents,plans:diagnostics.pairedMovements};
}
const api={build,occurrences};
root.HouseholdAccountForecast=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
