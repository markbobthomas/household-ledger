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
 const sourceIsLive=snapshot.connected===true||snapshot.mode==='connected'||snapshot.mode==='plaid';
 const diagnostics={unassigned:[],unmatchedTransfers:[],unverifiedAccounts:[],suppressedDuplicates:[],
  pairedMovements:[],staleSnapshots:[],missingTimestamps:[],ambiguousMovements:[],
  returnedPayments:[],duplicateEvents:[],statementWarnings:[],statementChecks:[]};
 for(const a of snapshot.accounts){
  const id=String(a.id||a.account_id||'');
  if(!id||byId.has(id))throw Error('Every account needs a unique stable ID');
  const type=typeOf(a),current=Number(a.current),available=Number(a.available);
  const hasCurrent=Number.isFinite(current)&&a.current!==null&&a.current!==undefined;
  // A credit card's current balance is money owed, never cash available.
  // Never substitute available funds or derived transaction totals for a bank's current balance.
  const initial=hasCurrent?current:null;
  const disconnected=a.disconnected===true||a.status==='disconnected';
  const valid=type!=='unsupported'&&initial!==null&&!disconnected;
  const live=sourceIsLive||a.provider==='plaid'||a.source?.provider==='plaid';
  const observedRaw=a.balanceAsOf||a.observedAt||a.balanceObservedAt||a.asOf||null;
  const observedDate=observedRaw?String(observedRaw).slice(0,10):null;
  const age=observedDate&&iso(observedDate)?deltaDays(asOf,observedDate):null;
  const simulated=snapshot.mode==='demo'||a.simulated===true;
  const balanceStatus=disconnected?'disconnected':!valid?'unavailable':simulated?'simulated':
   !live?'unverified':age===null?'unknown-age':age<0?'future-dated':age>2?'stale':'fresh';
  if(['stale','future-dated','disconnected'].includes(balanceStatus))
   diagnostics.staleSnapshots.push({accountId:id,name:a.name||id,status:balanceStatus,ageDays:age});
  if(live&&balanceStatus==='unknown-age')
   diagnostics.missingTimestamps.push({accountId:id,name:a.name||id});
  const state={id,name:String(a.name||id),type,valid,balanceStatus,balanceAgeDays:age,opening:valid?round(initial):null,
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
 const postings=new Map();
 const householdEvents=[],movementSignatures=new Set();
 const post=(accountId,date,kind,amount,original,groupId=null)=>{
  const a=byId.get(accountId);
  if(!a?.valid){diagnostics.unverifiedAccounts.push({id:original.id||null,accountId,reason:'No verified account balance/type'});return false}
  const row={accountId,date,kind,amount:round(amount),id:original.id||null,merchant:original.merchant||original.description||'Expected event',
   type:original.type||kind,description:original.description||'',transferGroupId:groupId,
   predictionKey:original._forecastKey||(groupId?movementKey(groupId):null),
   fromAccountId:original.fromAccountId||null,toAccountId:original.toAccountId||null,
   seriesKey:original._seriesKey||null,baseDate:original._seriesDate||date,
   cadence:original.cadence||null};
  if(!postings.has(date))postings.set(date,[]);
  postings.get(date).push(row);householdEvents.push(row);
  return true;
 };
 const historical=Array.isArray(options.records)?options.records:[];
 const seriesEdits=options.futureSeriesEdits||{},seriesTools=options.seriesTools||null;
 const forecastEdits=options.futureTransactionEdits||{},extra=Array.isArray(options.futureTransactionAdds)?
  options.futureTransactionAdds:[];
 const encode=x=>encodeURIComponent(String(x));
 const eventKey=(id,accountId)=>'event|'+encode(id)+'|'+encode(accountId);
 const movementKey=id=>'movement|'+encode(id);
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
 const seenEventIds=new Map();
 const projected=[...(Array.isArray(expectedEvents)?expectedEvents:[]),
  ...extra.filter(e=>e.type!=='transfer')].filter(e=>e&&e.enabled!==false).map((e,i)=>{
   const key=eventKey(e.id||'unnamed-'+i,e._forecastOriginalAccountId||resolve(e.accountId||e.account)||'');
   const edit=forecastEdits[key];
   if(edit?.skipped)return null;
   const updated=edit?{...e,...edit}:e;
   return {...updated,_forecastKey:key,_accountId:resolve(updated.accountId||updated.account),
    _eventIndex:i};
  }).filter(e=>e&&iso(e.date)&&e.date>asOf&&e.date<=through&&
   Number.isFinite(Number(e.amount))&&Number(e.amount)>0).filter(e=>{
   if(e.id===undefined||e.id===null||e.id==='')return true;
   const id=String(e.id),signature=[e.date,e._accountId,e.type,e.cashDirection,e.amount].join('|');
   if(!seenEventIds.has(id)){seenEventIds.set(id,signature);return true}
   diagnostics.duplicateEvents.push({id,reason:seenEventIds.get(id)===signature?'Repeat event ID':'Conflicting event ID'});
   return false;
  });
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
  const competitors=candidates.filter(q=>q!==e&&!coveredEvents.has(q._eventIndex)&&
    q._accountId===e._accountId&&q.cashDirection===e.cashDirection&&
    Math.abs(Number(q.amount)-Number(e.amount))<.011&&Math.abs(deltaDays(q.date,e.date))<=3);
  // Repeated identical ACH debits or credits must not be arbitrarily attached to
  // one of several possible peers (including a missing bank-side posting).
  if(inverse.length>1||competitors.length){
   diagnostics.ambiguousMovements.push({id:e.id,accountId:e._accountId,reason:'Multiple plausible payment counterparts'});
   continue;
  }
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
  const status=p.status||'scheduled';
  if(!['scheduled','cancelled','returned'].includes(status)){
   diagnostics.unassigned.push({id:p.id||null,reason:'Unknown payment status'});continue;
  }
  if(status==='cancelled')continue;
  if(status==='returned'&&(p.frequency||'once')!=='once'){
   diagnostics.unassigned.push({id:p.id||null,reason:'Returned payments must be one-time; schedule retries separately'});continue;
  }
  // If a payment already posted before this snapshot but will be returned
  // afterward, its original leg is already in the opening balances. Only
  // project the future reversal; never subtract that payment twice.
  const anchor=String(p.anchorDate||p.date||''),returnAt=String(p.reversalDate||'');
  if(status==='returned'&&iso(anchor)&&anchor<=asOf&&iso(returnAt)&&returnAt>asOf&&returnAt<=through){
   movements.push({id:'return|'+String(p.id)+'|'+returnAt,date:returnAt,amount,
    fromAccountId:to,toAccountId:from,source:'user plan',status:'reversal',
    reverses:'posted|'+String(p.id)+'|'+anchor});
   diagnostics.returnedPayments.push({id:p.id,paymentDate:anchor,reversalDate:returnAt,
    amount:round(amount),withinHorizon:true,originalIncludedInSnapshot:true});
  }
  for(const when of occurrences(p,asOf,through)){
   // A confirmed card autopay amount supersedes older inferred card-payment
   // transfers, including when their estimated amounts differ.
   const inferredIndex=movements.findIndex(m=>m.source==='matched history'&&
    m.fromAccountId===from&&m.toAccountId===to&&Math.abs(deltaDays(m.date,when))<=2&&
    (byId.get(from)?.type==='credit'||byId.get(to)?.type==='credit'));
   if(inferredIndex>=0){
    const inferred=movements.splice(inferredIndex,1)[0];
    diagnostics.suppressedDuplicates.push({id:p.id,matching:inferred.id,reason:'Card autopay replaces inferred settlement'});
    if(Math.abs(inferred.amount-amount)>.011)
     diagnostics.ambiguousMovements.push({id:p.id,matching:inferred.id,reason:'Inferred amount differs; entered statement amount used'});
   }
   const exists=movements.find(m=>m.fromAccountId===from&&m.toAccountId===to&&
    Math.abs(m.amount-amount)<.011&&Math.abs(deltaDays(m.date,when))<=2);
   if(exists){
    diagnostics.suppressedDuplicates.push({id:p.id,matching:exists.id,reason:'Overlapping payment amount/date/accounts'});
    diagnostics.ambiguousMovements.push({id:p.id,matching:exists.id,reason:'Duplicate or competing planned payment'});
    continue;
   }
   const movement={id:'plan|'+String(p.id)+'|'+when,date:when,amount,
    fromAccountId:from,toAccountId:to,source:'user plan',status,
    seriesKey:seriesTools?.seriesPlan?.(p)||null,baseDate:when,
    cadence:p.origin==='card-autopay'?'monthly':p.frequency==='biweekly'?'every 2 weeks':p.frequency};
   movements.push(movement);
   if(status==='returned'){
    const reversalDate=String(p.reversalDate||'');
    if(!iso(reversalDate)||reversalDate<when){
     diagnostics.unassigned.push({id:p.id,reason:'Returned payment needs a valid reversal date on or after its payment date'});
     movements.pop();continue;
    }
    const reversal={...movement,id:'return|'+String(p.id)+'|'+reversalDate,date:reversalDate,
     fromAccountId:to,toAccountId:from,status:'reversal',reverses:movement.id};
    // A return beyond the horizon remains a pending exposure; do not invent an earlier credit.
    if(reversalDate<=through)movements.push(reversal);
    diagnostics.returnedPayments.push({id:p.id,paymentDate:when,reversalDate,amount:round(amount),
     withinHorizon:reversalDate<=through});
   }
  }
 }
 // Extra owner-entered future transfers share both account legs, exactly once.
 for(const entry of extra.filter(e=>e.type==='transfer')){
  movements.push({id:'future|'+entry.id,date:entry.date,amount:Number(entry.amount),
   fromAccountId:String(entry.fromAccountId),toAccountId:String(entry.toAccountId),source:'future add',
   merchant:'Account transfer'});
 }
 // Explicit movement replaces a standalone inferred leg that describes the
 // very same money leaving or entering one of its account endpoints.
 for(const e of candidates){
  if(coveredEvents.has(e._eventIndex)||!e._accountId)continue;
  const replaces=movements.some(m=>{
   if(Math.abs(deltaDays(e.date,m.date))>2)return false;
   const leg=e.cashDirection==='out'&&m.fromAccountId===e._accountId||
    e.cashDirection==='in'&&m.toAccountId===e._accountId;
   if(!leg)return false;
   if(Math.abs(Number(e.amount)-m.amount)<.011)return true;
   // If the earlier transfer was identified as a card settlement, an owner-
   // entered card payment overrides a competing inferred amount.
   const card=byId.get(m.toAccountId);
   const merchant=norm(e.merchant);
   const identifiesCard=card?.type==='credit'&&
    (/credit card|card payment|visa|mastercard|amex|discover|payment thank you|card autopay/.test(merchant)||
     merchant.includes(norm(card.name)));
   if(identifiesCard&&m.source==='user plan'){
    diagnostics.ambiguousMovements.push({id:e.id,matching:m.id,reason:'Card payment estimate differs; entered statement amount used'});
    return true;
   }
   return false;
  });
  if(replaces){coveredEvents.add(e._eventIndex);diagnostics.suppressedDuplicates.push({id:e.id,reason:'Paired movement already projected'})}
 }
 for(const original of movements){
  const change=forecastEdits[movementKey(original.id)];
  if(change?.skipped)continue;
  const seriesApplied=original.seriesKey&&seriesTools?.applySeries?
   seriesTools.applySeries(original,original.baseDate||original.date,original.seriesKey,seriesEdits):original;
  const m=change?{...seriesApplied,...change}:seriesApplied;
  if(!iso(m.date)||m.date<=asOf||m.date>through||!(Number(m.amount)>0)||
    !byId.has(String(m.fromAccountId))||!byId.has(String(m.toAccountId))||
    m.fromAccountId===m.toAccountId){
   diagnostics.unassigned.push({id:m.id,reason:'Invalid edited future transfer'});continue;
  }
  if(!byId.get(m.fromAccountId)?.valid||!byId.get(m.toAccountId)?.valid){
   diagnostics.unverifiedAccounts.push({id:m.id,reason:'Transfer accounts require verified balances'});continue;
  }
  const k=[m.id,m.date,m.fromAccountId,m.toAccountId].join('|');
  if(movementSignatures.has(k))continue;
  movementSignatures.add(k);
  const from=byId.get(m.fromAccountId),to=byId.get(m.toAccountId);
  const kind=from.type==='credit'||to.type==='credit'?'card_payment':'internal_transfer';
  const details={id:m.id,merchant:m.merchant||(kind==='card_payment'?'Credit-card payment':'Account transfer'),
   type:'transfer',fromAccountId:from.id,toAccountId:to.id,
   _seriesKey:m.seriesKey||null,_seriesDate:m.baseDate||m.date,cadence:m.cadence||null};
  post(from.id,m.date,'transfer_out',m.amount,details,m.id);
  post(to.id,m.date,'transfer_in',m.amount,details,m.id);
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
 // Statement metadata comes from liabilities, not transaction frequency. It
 // never fabricates a future charge; check only verified/scheduled payments.
 for(const a of accounts.filter(x=>x.type==='credit')){
  const li=a.source.liabilities||a.source.statement||{};
  const due=String(li.next_payment_due_date||li.nextPaymentDueDate||'');
  const minRaw=li.minimum_payment_amount??li.minimumPaymentAmount;
  const minimum=minRaw==null?null:Number(minRaw);
  const statementRaw=li.last_statement_balance??li.lastStatementBalance;
  const statementBalance=statementRaw==null?null:Number(statementRaw);
  const issued=String(li.last_statement_issue_date||li.lastStatementIssueDate||'');
  if(!iso(due)||minimum===null||!Number.isFinite(minimum)){
   diagnostics.statementChecks.push({accountId:a.id,status:'unknown',reason:'Due date or minimum payment unavailable'});
   continue;
  }
  const payments=diagnostics.pairedMovements.filter(m=>m.toAccountId===a.id&&m.kind==='card_payment'&&
   m.status!=='reversal'&&m.date>=asOf&&m.date<=due&&
   !diagnostics.returnedPayments.some(x=>String(m.id).includes(String(x.id)))).reduce((n,m)=>n+m.amount,0);
  const status=due<asOf?'past-due':minimum>payments+.009?'shortfall':'covered';
  const check={accountId:a.id,dueDate:due,minimum:round(minimum),planned:round(payments),
   shortfall:round(Math.max(0,minimum-payments)),statementBalance:Number.isFinite(statementBalance)?round(statementBalance):null,
   statementIssued:iso(issued)?issued:null,status};
  diagnostics.statementChecks.push(check);
  if(status==='shortfall'||status==='past-due')diagnostics.statementWarnings.push(check);
 }
 const household={openingCash,closingCash:daysSeries.at(-1).cash,openingDebt,
  closingDebt:daysSeries.at(-1).debt,openingNet,closingNet:daysSeries.at(-1).net,
  expectedSpending:round(householdSpending),expectedIncome:round(householdIncome),
  forecastChange:round(daysSeries.at(-1).net-openingNet),
  explainedChange:round(householdIncome-householdSpending),
  conservationDifference:round(daysSeries.at(-1).net-openingNet-(householdIncome-householdSpending)),
  complete:accounts.every(a=>a.valid)&&diagnostics.unassigned.length===0&&
   diagnostics.unverifiedAccounts.length===0&&diagnostics.unmatchedTransfers.length===0&&
   diagnostics.staleSnapshots.length===0&&diagnostics.missingTimestamps.length===0&&
   diagnostics.ambiguousMovements.length===0&&diagnostics.duplicateEvents.length===0&&
   diagnostics.returnedPayments.every(x=>x.withinHorizon)};
 household.readyForLive=sourceIsLive&&household.complete&&
  accounts.every(a=>a.balanceStatus==='fresh')&&diagnostics.statementWarnings.length===0&&
  diagnostics.statementChecks.every(c=>c.status!=='unknown');
 return {asOf,through,days,accounts,series:daysSeries,household,diagnostics,
  events:householdEvents,plans:diagnostics.pairedMovements};
}
const api={build,occurrences};
root.HouseholdAccountForecast=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
