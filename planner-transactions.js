/* Editable future cash movements. Forecast-only adjustments, never bank source edits. */
(function(root){
'use strict';
const validDate=s=>{const text=String(s||''),parsed=new Date(text+'T12:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===text;};
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const allowedTypes=new Set(['expense','income','refund','transfer']);
const ensure=state=>{state.predictions??={};state.predictions.futureTransactionEdits??={};
 state.predictions.futureTransactionAdds??=[];state.predictions.futureSeriesEdits??={};state.predictions.futureRecurringRules??=[];return state.predictions};
const ids=accounts=>new Set((accounts||[]).map(a=>String(a.id)));
const validAmount=v=>v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<=999999999;
const keyEvent=(id,accountId)=>'event|'+encodeURIComponent(String(id))+'|'+encodeURIComponent(String(accountId));
const keyMovement=id=>'movement|'+encodeURIComponent(String(id));
function normalFields(data,accounts,asOf){
 const date=String(data.date||''),accountId=String(data.accountId||'').trim(),
  name=String(data.merchant||'').trim().slice(0,160),amount=Number(data.amount),type=String(data.type||'');
 if(!validDate(date)||date<=asOf)throw Error('Choose a future date');
 if(!ids(accounts).has(accountId))throw Error('Choose one of your connected accounts');
 if(!name)throw Error('Enter a transaction name');
 if(!validAmount(data.amount))throw Error('Enter a positive dollar amount');
 if(!allowedTypes.has(type))throw Error('Choose an expense, income or refund');
 if(type==='transfer'&&!['in','out'].includes(String(data.cashDirection)))throw Error('Choose a transfer direction');
 if(type==='income'&&(accounts||[]).find(a=>String(a.id)===accountId)?.type==='credit')
  throw Error('For credit cards, use a refund instead of income');
 return {date,accountId,merchant:name,amount:round(amount),type,
  ...(type==='transfer'?{cashDirection:String(data.cashDirection)}:{})};
}
function transferFields(data,accounts,asOf){
 const date=String(data.date||''),fromAccountId=String(data.fromAccountId||''),
  toAccountId=String(data.toAccountId||''),amount=Number(data.amount);
 if(!validDate(date)||date<=asOf)throw Error('Choose a future date');
 const known=ids(accounts);
 if(!known.has(fromAccountId)||!known.has(toAccountId)||fromAccountId===toAccountId)
  throw Error('Choose two different linked accounts for this transfer');
 if(!validAmount(data.amount))throw Error('Enter a positive dollar amount');
 return {date,amount:round(amount),fromAccountId,toAccountId,
  merchant:String(data.merchant||'Account transfer').trim().slice(0,160)||'Account transfer'};
}
function saveEdit(state,key,data,accounts,asOf){
 if(typeof key!=='string'||key.length>600||!(/^(event|movement)\|/.test(key)))
  throw Error('Unknown future transaction');
 const fields=key.startsWith('movement|')?transferFields(data,accounts,asOf):
  normalFields(data,accounts,asOf);
 ensure(state).futureTransactionEdits[key]=fields;return fields;
}
function skip(state,key,details={}){
 if(typeof key!=='string'||key.length>600||!(/^(event|movement)\|/.test(key)))
  throw Error('Unknown future transaction');
 ensure(state).futureTransactionEdits[key]={skipped:true,
  label:String(details.label||'Future transaction').slice(0,160),
  date:String(details.date||''),accountId:String(details.accountId||''),
  toAccountId:String(details.toAccountId||'')};
}
function restore(state,key){delete ensure(state).futureTransactionEdits[key]}
function add(state,data,accounts,asOf){
 const transfer=data.type==='transfer';
 const fields=transfer?transferFields(data,accounts,asOf):normalFields(data,accounts,asOf);
 const record={id:'future-add|'+Date.now().toString(36)+'|'+Math.random().toString(36).slice(2,10),
  ...fields,...(transfer?{type:'transfer'}:{})};
 ensure(state).futureTransactionAdds.push(record);
 return record;
}
function removeAdded(state,id){
 const p=ensure(state),index=p.futureTransactionAdds.findIndex(t=>t.id===id);
 if(index<0)throw Error('Added transaction not found');
 p.futureTransactionAdds.splice(index,1);
 for(const key of Object.keys(p.futureTransactionEdits))if(
  key.startsWith('event|'+encodeURIComponent(String(id))+'|')||
  key===keyMovement('future|'+id))delete p.futureTransactionEdits[key];
}
/* A series identity intentionally omits the date, so rules survive a new
 * month and a Plaid sync. The original account/merchant is never rewritten. */
const clean=s=>String(s||'').toLowerCase().trim().replace(/\s+/g,' ');
const seriesEvent=(e,accountId)=>{
 if(e.source==='owner-bill'&&e.frequency==='monthly'&&e.billId)
  return 'bill|'+encodeURIComponent(String(e.billId));
 if(e.source!=='historical'&&!e.manualRule)return null;
 if(!['income','expense','refund'].includes(e.type)||!e.cadence)return null;
 return 'recurring|'+[e.type,String(accountId||e.accountId||e.account||''),clean(e.merchant)]
  .map(encodeURIComponent).join('|');
};
const seriesPlan=p=>{
 if(p.origin==='card-autopay')return 'autopay|'+encodeURIComponent(String(p.toAccountId));
 if(p.id&&String(p.id).startsWith('movement|')&&p.frequency!=='once')
  return 'plan|'+encodeURIComponent(String(p.id));
 return null;
};
const shift=(date,offset)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)};
const monthEnd=m=>new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).getUTCDate();
function applySeries(source,baseDate,seriesKey,rules){
 const change=seriesKey?(rules||{})[seriesKey]:null;
 if(!change||baseDate<change.startsOn)return source;
 const useCalendar=change.calendarDay&&change.cadence!=='twice monthly';
 const date=useCalendar?baseDate.slice(0,7)+'-'+String(Math.min(change.calendarDay,monthEnd(baseDate.slice(0,7)))).padStart(2,'0'):
  shift(baseDate,Number(change.dayOffset)||0);
 return {...source,date,amount:source.scopedEstimate||!validAmount(change.amount)?
  source.amount:change.amount,
  ...(change.merchant?{merchant:change.merchant}:{}),
  ...(change.accountId?{accountId:change.accountId,account:change.accountId}:{}),
  ...(change.fromAccountId?{fromAccountId:change.fromAccountId}:{}),
  ...(change.toAccountId?{toAccountId:change.toAccountId}:{}),
  ...(change.type?{type:change.type}:{}),
  ...(change.cashDirection?{cashDirection:change.cashDirection}:{})};
}
function saveSeriesEdit(state,seriesKey,baseDate,data,accounts,asOf,cadence,kind){
 if(!seriesKey||typeof seriesKey!=='string'||seriesKey.length>600||
  !['event','movement'].includes(kind))throw Error('This transaction is not an editable recurring series');
 if(!validDate(baseDate))throw Error('Select a valid repeating payment date');
 const fields=kind==='movement'?transferFields(data,accounts,asOf):normalFields(data,accounts,asOf);
 const supported=['monthly','quarterly','semiannual','annual','weekly','every 2 weeks','biweekly','every-4-weeks','twice monthly','3 / month','4 / month','5 / month'];
 if(!supported.includes(cadence))throw Error('Recurring frequency is not known; edit just this payment');
 const offset=Math.round((new Date(fields.date+'T12:00:00Z')-new Date(baseDate+'T12:00:00Z'))/86400000);
 if(Math.abs(offset)>31)throw Error('The new payment date must be within 31 days of its current date');
 const monthly=['monthly','quarterly','semiannual','annual'].includes(cadence);
 const rule={startsOn:baseDate,cadence,dayOffset:offset,
  calendarDay:monthly&&fields.date.slice(0,7)===baseDate.slice(0,7)?Number(fields.date.slice(-2)):null,
  amount:fields.amount,
  merchant:fields.merchant,
  ...(kind==='movement'?{fromAccountId:fields.fromAccountId,toAccountId:fields.toAccountId}:
   {accountId:fields.accountId,type:fields.type,...(fields.type==='transfer'?{cashDirection:fields.cashDirection}:{})})};
 ensure(state).futureSeriesEdits[seriesKey]=rule;
 return rule;
}
function resetSeries(state,seriesKey){
 delete ensure(state).futureSeriesEdits[seriesKey];
}

/* User-defined recurrence is authoritative when automatic inference cannot
 * find a reliable series. Rule identity includes account/type/source merchant;
 * individual bank transactions and their categories are never modified. */
const frequencies=new Set(['weekly','biweekly','every-4-weeks','twice-monthly','monthly','quarterly','semiannual','annual']);
const merchantKey=value=>clean(value).replace(/[^a-z0-9]+/g,' ').trim();
const phaseOf=date=>Math.floor(Date.parse(date+'T12:00:00Z')/86400000)%28;
const phaseDistance=(a,b)=>{if(!validDate(a)||!validDate(b))return 28;
 const delta=Math.abs(phaseOf(a)-phaseOf(b));return Math.min(delta,28-delta)};
const samePhase=(a,b)=>phaseDistance(a,b)<=3;
const daysBetween=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
const accountRef=(value,accounts)=>{
 const v=String(value||'');
 const found=(accounts||[]).filter(a=>[a.id,a.name,a.transactionAccount].some(x=>String(x||'')===v));
 return found.length===1?String(found[0].id):v;
};
// Account + cash direction + merchant identity determine a recurring stream.
 // The payment amount is evidence for estimation, never part of its identity.
const bankDirection=t=>t.type==='transfer'&&!t.pairedTransactionId?
 (t.cashDirection==='in'?'income':t.cashDirection==='out'?'expense':null):t.type;
const sameDirection=(t,type)=>bankDirection(t)===type||
 (type==='transfer'&&t.type==='transfer'&&Boolean(t.pairedTransactionId));
function findExamples(records,reference,accounts,search=''){
 const account=reference.kind==='movement'?String(reference.fromAccountId):String(reference.accountId),
  type=reference.kind==='movement'?'transfer':reference.type||'expense',
  name=merchantKey(reference.sourceMerchant||reference.merchant),
  query=merchantKey(search),head=name.split(' ').find(word=>word.length>3)||name;
 return (records||[]).filter(t=>!t.pending&&validDate(t.date)&&Number(t.amount)>0&&
  accountRef(t.accountId||t.account,accounts)===account&&sameDirection(t,type)&&
  merchantKey(t.merchant||t.name)&&(query?
   merchantKey(t.merchant||t.name).includes(query):true)).sort((a,b)=>{
   const score=t=>{const merchant=merchantKey(t.merchant||t.name);
    return merchant===name?3:merchant.includes(name)&&name.length>3?2:
     merchant.includes(head)&&head.length>3?1:0};
   return score(b)-score(a)||b.date.localeCompare(a.date);
  }).slice(0,16).map(t=>({id:String(t.id),date:t.date,
   merchant:String(t.merchant||t.name),amount:Number(t.amount),
   accountId:account,type:t.type,bankDirection:bankDirection(t)}));
}
const monthAt=(anchor,offset,day)=>{
 const [y,m]=anchor.slice(0,7).split('-').map(Number),d=new Date(Date.UTC(y,m-1+offset,1,12));
 const month=d.toISOString().slice(0,7);
 return month+'-'+String(Math.min(day,monthEnd(month))).padStart(2,'0');
};
function recurrenceDates(rule,asOf,through){
 const dates=[],start=rule.anchorDate;
 if(!validDate(start)||!frequencies.has(rule.frequency))return dates;
 if(['weekly','biweekly','every-4-weeks'].includes(rule.frequency)){
  const step=rule.frequency==='weekly'?7:rule.frequency==='biweekly'?14:28,n=Math.max(0,Math.ceil(daysBetween(asOf,start)/step));
  for(let i=n;i<n+60;i++){const d=shift(start,i*step);if(d>through)break;if(d>asOf&&d>=start)dates.push(d)}
 }else{
  const spacing={monthly:1,'twice-monthly':1,quarterly:3,semiannual:6,annual:12}[rule.frequency];
  // A saved monthly bill should not expire just because its anchor is old.
  // Preserve its original month phase while skipping elapsed months.
  const index=iso=>Number(iso.slice(0,4))*12+Number(iso.slice(5,7)),
   elapsed=index(asOf)-index(start),last=index(through)-index(start),
   begin=Math.max(0,Math.floor(elapsed/spacing)*spacing-spacing);
  for(let i=begin;i<=last+spacing;i+=spacing){
   for(const day of rule.frequency==='twice-monthly'?[Number(start.slice(-2)),Number(rule.secondDay)]:[Number(start.slice(-2))]){
    const d=monthAt(start,i,day);
    if(d>=start&&d>asOf&&d<=through)dates.push(d);
   }
   if(monthAt(start,i,1)>through)break;
  }
 }
 return [...new Set(dates)].sort();
}
function manualSeriesKey(ruleId){return 'user-series|'+encodeURIComponent(String(ruleId))}

// Ambiguity is a choice of existing forecast schedules, never permission to
// create another debit or combine independent paycheck phases.
function scheduleChoice(candidates){
 const e=Error('Several saved schedules match this payment. Choose the one to update.');
 e.code='RECURRING_SCHEDULE_CHOICE';
 e.options=candidates.map(r=>({id:r.id,merchant:r.merchant,frequency:r.frequency,
  anchorDate:r.anchorDate,amount:Number(r.amount),accountId:r.accountId||r.fromAccountId}));
 return e;
}
function linkedSchedule(candidates,selectedExampleIds){
 const ids=new Set((selectedExampleIds||[]).map(String));
 const linked=candidates.filter(r=>(r.exampleIds||[]).some(id=>ids.has(String(id))));
 return linked.length===1?linked[0]:null;
}
/* A historical bank payment may already belong to an owner-confirmed rule.
 * Resolve by account, cash direction, and explicit bank IDs/merchant aliases;
 * NEVER by the transaction amount, which changes for utilities and payroll.
 * A genuine pair of same-payee rules remains ambiguous unless an explicitly
 * linked bank ID or unambiguous four-week paycheck phase identifies one. */
function historicalScheduleMatches(row,accounts,rules=[]){
 if(!row)return [];
 const account=accountRef(row.accountId||row.account,accounts);
 if(!account)return [];
 // Bank identifiers outrank provider category and renamed merchant metadata.
 // Plaid may reclassify an ACH payment after its schedule was confirmed.
 const explicit=(rules||[]).filter(r=>{
  const source=String(r.originalAccountId||r.accountId||r.fromAccountId),
   ids=(r.exampleIds||[]).map(String);
  return source===account&&ids.includes(String(row.id))||
   r.kind==='movement'&&Boolean(row.pairedTransactionId)&&
   String(r.toAccountId)===account&&ids.includes(String(row.pairedTransactionId));
 });
 if(explicit.length)return explicit;
 const type=bankDirection(row),name=merchantKey(row.merchant||row.name);
 if(!type)return [];
 const kind=type==='transfer'?'movement':'event',
  eligible=(rules||[]).filter(r=>
   r.kind===kind&&
   String(r.originalAccountId||r.accountId||r.fromAccountId)===account&&
   (kind==='movement'?Boolean(row.pairedTransactionId)&&
    (!row.toAccountId||String(r.toAccountId)===String(row.toAccountId)):
    r.type===type));
 if(!name)return [];
 const named=eligible.filter(r=>
  [r.originalMerchant,r.merchant,...(r.matchNames||[])]
   .some(alias=>merchantKey(alias)===name));
 if(named.length>1&&validDate(row.date)&&
  named.every(r=>r.frequency==='every-4-weeks')){
  const phased=named.filter(r=>validDate(r.anchorDate)&&samePhase(row.date,r.anchorDate));
  if(phased.length===1)return phased;
 }
 return named;
}
function defineRecurring(state,data,accounts,asOf,reference=null,records=[],selectedExampleIds=[]){
 const transfer=reference?reference.kind==='movement':data.type==='transfer';
 const fields=transfer?transferFields(data,accounts,asOf):normalFields(data,accounts,asOf);
 const frequency=String(data.frequency||'');
 if(!frequencies.has(frequency))throw Error('Choose how often this payment repeats');
 let secondDay=null;
 if(frequency==='twice-monthly'){
  secondDay=Number(data.secondDay);
  if(!Number.isInteger(secondDay)||secondDay<1||secondDay>31||
   secondDay===Number(fields.date.slice(-2)))throw Error('Choose a different second payday (1–31)');
 }
 const p=ensure(state),requestedId=String(data.existingRuleId||''),
  separate=data.separateSchedule===true||data.separateSchedule==='yes'||data.separateSchedule==='on';
 // A historical payment already associated with an existing schedule can
 // only update THAT schedule. A stale form or separate-bill checkbox must
 // never silently create a competing recurring obligation.
 if(reference?.bankTransactionId){
  const actual=(records||[]).find(t=>String(t.id)===String(reference.bankTransactionId));
  if(!actual)throw Error('This bank transaction changed. Refresh bank history before saving.');
  const attached=historicalScheduleMatches(actual,accounts,p.futureRecurringRules);
  if(attached.length){
   if(separate)throw Error('This bank transaction already belongs to a schedule. Open its existing plan; do not create a duplicate.');
   if(!requestedId)throw scheduleChoice(attached);
   if(!attached.some(r=>r.id===requestedId))
    throw Error('This bank transaction belongs to another schedule. Reopen it from History.');
  }
 }
 const baseAccount=reference?.kind==='movement'?String(reference.sourceAccountId||reference.fromAccountId):
  String(reference?.sourceAccountId||reference?.accountId||fields.accountId);
 const originalMerchant=reference?.originalMerchant||reference?.sourceMerchant||reference?.merchant||fields.merchant;
 const originalAmount=Number(reference?.sourceAmount??reference?.amount??fields.amount);
 // A Plaid ACH classified as transfer can still be an expense or paycheck.
 const originalType=reference?.originalType||reference?.sourceType||reference?.type||fields.type;
 const forecastType=transfer?'transfer':fields.type;
 let id=reference?.recurringRuleId||'manual|'+[transfer?'movement':'event',
  baseAccount,reference?.toAccountId||'',originalType,merchantKey(originalMerchant),
  frequency==='every-4-weeks'?'phase'+phaseOf(fields.date):round(originalAmount)]
  .map(encodeURIComponent).join('|');
 // A separately named obligation has a durable payment-stream ID, not a
 // merchant/date/amount identity. Both bills may post on the same day.
 if(separate){
  if(reference?.recurringRuleId||requestedId)
   throw Error('Create a separate schedule without selecting an existing one.');
  const prefix='manual|stream|'+[transfer?'movement':'event',baseAccount,
   merchantKey(originalMerchant)].map(encodeURIComponent).join('|')+'|';
  let n=1;
  while(p.futureRecurringRules.some(r=>r.id===prefix+n))n++;
  id=prefix+n;
 }
 // Different historical rows can be labeled expense vs ACH transfer, but
 // refer to the same one mortgage payment. Reuse its existing rule instead
 // of saving two recurring schedules with distinct source type identities.
 // Account and amount are required; two different paying accounts, or a
 // real internal transfer and an expense, must remain separate.
 if(!reference?.recurringRuleId&&!separate){
  const sameMerchant=p.futureRecurringRules.filter(r=>
   r.kind===(transfer?'movement':'event')&&
   String(r.originalAccountId||r.accountId||r.fromAccountId)===baseAccount&&
   (!transfer||String(r.toAccountId)===String(fields.toAccountId))&&
   (merchantKey(r.originalMerchant||r.merchant)===merchantKey(originalMerchant)||
    (r.matchNames||[]).includes(merchantKey(originalMerchant))));
  // Only one confirmed series per source merchant/account/direction. The bill
  // may change dramatically (seasonal utilities or deductions on a paycheck).
  // Never manufacture a second series just because the amount changed.
  const sameType=sameMerchant.filter(r=>(r.kind==='movement'?'transfer':r.type)===forecastType);
  const matching=sameType.filter(r=>frequency==='every-4-weeks'&&
   r.frequency==='every-4-weeks'?samePhase(r.anchorDate,fields.date):
   frequency!=='every-4-weeks');
  // Bank transaction IDs are stronger evidence than the common payee name.
  // An exact cadence can disambiguate a pair of different saved schedules.
  const linked=linkedSchedule(matching,selectedExampleIds);
  const cadenceMatches=matching.filter(r=>r.frequency===frequency);
  const candidates=linked?[linked]:(cadenceMatches.length===1?cadenceMatches:matching);
  if(requestedId){
   const chosen=candidates.find(r=>r.id===requestedId);
   if(!chosen)throw Error('Selected recurring schedule is no longer a match. Reopen this payment.');
   id=chosen.id;
  }else if(candidates.length===1)id=candidates[0].id;
  else if(candidates.length>1)throw scheduleChoice(candidates);
  else if(frequency!=='every-4-weeks'&&sameType.length)
   throw scheduleChoice(sameType);
 }
 let old=p.futureRecurringRules.find(r=>r.id===id);
 if(reference?.recurringRuleId&&!old)
  throw Error('The saved recurring schedule changed. Reopen it before editing.');
 const candidates=(records||[]).filter(t=>!t.pending&&validDate(t.date)&&String(t.id||'')&&
  accountRef(t.accountId||t.account,accounts)===baseAccount&&
  merchantKey(t.merchant)&&Number(t.amount)>0);
 const chosen=[...new Set((selectedExampleIds||[]).map(String))];
 const examples=chosen.map(id=>candidates.find(t=>String(t.id)===id));
 if(examples.some(t=>!t))throw Error('One of the historical examples is no longer available');
 if(examples.some(t=>!sameDirection(t,forecastType)))
  throw Error('Linked bank transactions must be from the same account and cash direction');
 // Automatically connect unambiguous same-name posted history, even when
 // transaction amounts vary. Selecting bank examples also connects different
 // Plaid descriptions to the same manually named utility or paycheck.
 const phaseRecords=rows=>frequency==='every-4-weeks'?
  rows.filter(t=>samePhase(t.date,fields.date)):rows;
 // Do not claim ALL same-merchant bank transactions for a new independent
 // stream. Its bank evidence must be individually selected by the owner.
 const autoLinks=separate?[]:phaseRecords(candidates.filter(t=>sameDirection(t,forecastType)&&
  merchantKey(t.merchant||t.name)===merchantKey(originalMerchant)));
 // Same employer, opposite paycheck phase is deliberately NOT linked as
 // source evidence for this four-week rule.
 const evidence=[...new Map([...autoLinks,...phaseRecords(examples)].map(t=>[String(t.id),t])).values()];
 const names=[originalMerchant,...evidence.map(t=>t.merchant||t.name)]
  .map(merchantKey).filter(Boolean);
 // The user may label a bill "Electric" while Plaid calls it "PSE".
 // An explicitly linked bank payee must also merge with any existing rule
 // that already owns that same bank payee, not create a duplicate schedule.
 if(!reference?.recurringRuleId&&!separate&&evidence.length){
  const overlapping=p.futureRecurringRules.filter(r=>
   r.kind===(transfer?'movement':'event')&&
   String(r.originalAccountId||r.accountId||r.fromAccountId)===baseAccount&&
   (r.kind==='movement'?'transfer':r.type)===forecastType&&
   (r.matchNames||[merchantKey(r.originalMerchant||r.merchant)])
    .some(name=>names.includes(name))&&
   (frequency==='every-4-weeks'&&r.frequency==='every-4-weeks'?
    samePhase(r.anchorDate,fields.date):frequency!=='every-4-weeks'));
  if(requestedId){
   const picked=overlapping.find(r=>r.id===requestedId);
   if(overlapping.length&&!picked)
    throw Error('This bank payment is also connected to another schedule. Review its links.');
   if(picked){id=picked.id;old=picked}
  }else if(overlapping.length>1){
   const linked=linkedSchedule(overlapping,selectedExampleIds);
   if(linked){id=linked.id;old=linked}
   else if(!old||!overlapping.some(r=>r.id===old.id))
    throw scheduleChoice(overlapping);
  }else if(overlapping.length===1){
   if(old&&old.id!==overlapping[0].id)throw scheduleChoice([old,overlapping[0]]);
   id=overlapping[0].id;old=overlapping[0];
  }
 }
 if(requestedId&&id!==requestedId)
  throw Error('Choose the matching saved recurring schedule before saving.');
 if(!names.length)throw Error('Enter a merchant name');
 const rule={id,kind:transfer?'movement':'event',frequency,anchorDate:fields.date,
  ...(secondDay?{secondDay}:{}),...fields,
  scheduleLabel:String(data.scheduleLabel||old?.scheduleLabel||'').trim().slice(0,110),
  amountBasis:data.amountBasis==='estimate'||data.amountBasis==='fixed'?data.amountBasis:
   old?.amountBasis||'fixed',
  // Honor previously saved date-range amounts until the owner explicitly
  // changes the repeating amount. A new "all future" edit supersedes them.
  amountWindows:old&&Number(fields.amount)===Number(old.amount)&&
   data.resetAmountWindows!=='on'&&Array.isArray(old.amountWindows)?
    old.amountWindows.slice():[],
  originalAccountId:old?.originalAccountId||baseAccount,
  sourceAnchorDate:frequency==='every-4-weeks'?
   (old?.sourceAnchorDate&&samePhase(old.sourceAnchorDate,fields.date)?
    old.sourceAnchorDate:fields.date):
   old?.sourceAnchorDate||reference?.baseDate||reference?.date||fields.date,
  sourceFrequency:frequency==='every-4-weeks'?'every-4-weeks':
   old?.sourceFrequency||({
   'every 2 weeks':'biweekly','every 4 weeks':'every-4-weeks','twice monthly':'twice-monthly','3 / month':null,
   '4 / month':null,'5 / month':null
  }[reference?.cadence]||reference?.cadence||frequency),
  originalMerchant:old?.originalMerchant||originalMerchant,
  originalType:old?.originalType||originalType,
  matchAmount:round(originalAmount),
  // Saved bank-example merchant aliases become a stable source identity.
  matchNames:[...new Set([...(old?.matchNames||[]),...names])],
  exampleIds:[...new Set([...(old?.exampleIds||[]),...evidence.map(t=>String(t.id))])],
  ...(old?.sourceAddedId||reference?.addedId?{sourceAddedId:old?.sourceAddedId||reference?.addedId}:{}),
  ...(old?.sourceKey||reference?.key?{sourceKey:old?.sourceKey||reference?.key}:{})};
 const index=p.futureRecurringRules.findIndex(r=>r.id===id);
 if(index<0)p.futureRecurringRules.push(rule);
 else{
  p.futureRecurringRules[index]=rule;
  // Explicit edits to the authoritative schedule replace parallel legacy
  // series edits to prevent hidden amount/date overrides.
  delete p.futureSeriesEdits?.[manualSeriesKey(id)];
 }
 // Explicitly transferring posted examples to a newly created independent
 // bill prevents one bank record being "owned" by both saved schedules.
 if(separate&&chosen.length){
  const moved=new Set(chosen);
  for(const sibling of p.futureRecurringRules)if(sibling.id!==id)
   sibling.exampleIds=(sibling.exampleIds||[]).filter(example=>!moved.has(String(example)));
 }
 // Explicit confirmation reverses any earlier "Not recurring" decision for
 // this precise merchant, account and movement direction.
 const exclusionKey=recurrenceKey(
  rule.originalAccountId,rule.kind==='movement'?'transfer':rule.type,rule.originalMerchant);
 delete p.futureRecurrenceExclusions?.[exclusionKey];
 if(frequency==='every-4-weeks')
  delete p.futureRecurrenceExclusions?.[exclusionKey+'|phase'+phaseOf(fields.date)];
 return rule;
}
/* One authoritative, account-scoped opt-out for bank-derived recurrence.
 * Unlike a one-off skip, this lasts through every refresh and amount change.
 * No rule here edits, deletes, or annotates a posted Plaid transaction. */
const sourceMerchant=value=>merchantKey(value);
const recurrenceKey=(accountId,type,merchant)=>[String(accountId||''),String(type||''),sourceMerchant(merchant)]
 .map(encodeURIComponent).join('|');
const recurringType=row=>row.kind==='movement'?'transfer':row.sourceType==='transfer'?
 (row.type==='income'?'income':'expense'):(row.sourceType||row.type||'expense');
function isNotRecurring(preferences,accountId,type,merchant){
 return Boolean((preferences?.futureRecurrenceExclusions||{})[recurrenceKey(accountId,type,merchant)]);
}
function restoreRecurrence(state,key){
 const p=ensure(state),entry=p.futureRecurrenceExclusions?.[key];
 if(!entry)throw Error('This recurrence is not currently excluded');
 delete p.futureRecurrenceExclusions[key];
 // An automatic-series exclusion never owns a real confirmed recurring
 // rule or the employer's general history decision.
 if(entry.seriesKey||entry.manualRuleId)return key;
 // Older app versions tracked rejected suggestions in two independent
 // preference maps. Clear matching legacy rejections too, so Allow predictions
 // always means the recurrence can actually be considered again.
 for(const old of Object.keys(p.historyPatternDecisions||{})){
  const parts=old.split('|').map(x=>{try{return decodeURIComponent(x)}catch{return x}});
  if(parts[0]===entry.accountId&&parts[1]===entry.type&&
   sourceMerchant(parts[2])===sourceMerchant(entry.merchant))
   delete p.historyPatternDecisions[old];
 }
 for(const old of Object.keys(p.plannerRoutineDecisions||{})){
  const parts=old.split('|');
  if(parts[1]===entry.accountId&&parts[0]===entry.type&&
   sourceMerchant(parts[2])===sourceMerchant(entry.merchant))
   delete p.plannerRoutineDecisions[old];
 }
 p.mortgageReviewDismissals=(p.mortgageReviewDismissals||[]).filter(old=>{
  const parts=old.split('|').map(x=>{try{return decodeURIComponent(x)}catch{return x}});
  return !(parts[1]===entry.accountId&&
   sourceMerchant(parts[2])===sourceMerchant(entry.merchant));
 });
 return key;
}
function stopRecurrence(state,row){
 if(!row||!['event','movement'].includes(row.kind))throw Error('Choose a recurring forecast');
 const p=ensure(state),rule=(p.futureRecurringRules||[]).find(r=>r.id===row.recurringRuleId);
 if(row.recurringRuleId&&!rule)throw Error('The original recurring schedule changed. Refresh and select it again.');
 const accountId=String(rule?.originalAccountId||rule?.accountId||rule?.fromAccountId||
  row.sourceAccountId||row.accountId||row.fromAccountId||'');
 const merchant=String(rule?.originalMerchant||row.sourceMerchant||row.merchant||'');
 const type=rule?(rule.kind==='movement'?'transfer':rule.type):recurringType(row);
 if(!accountId||!sourceMerchant(merchant)||!['expense','income','refund','transfer'].includes(type))
  throw Error('This forecast has no identifiable recurring source');
 // An inferred income series is not permission to delete any independently
 // confirmed paychecks from the same employer. Exclude its exact engine
 // series instead, including only its own phase if it is a 28-day stream.
 const inferredIncome=!rule&&type==='income'&&
  typeof row.seriesKey==='string'&&row.seriesKey.startsWith('series|');
 if(inferredIncome){
  const key='auto-series|'+encodeURIComponent(row.seriesKey);
  p.futureRecurrenceExclusions??={};
  p.futureRecurrenceExclusions[key]={accountId,type,merchant,seriesKey:row.seriesKey};
  delete p.futureSeriesEdits[row.seriesKey];
  return {key,accountId,type,merchant,removedRules:0,autoSeries:true};
 }
 // A history-level merchant-wide rejection must never silently erase
 // unrelated existing four-week pay phases. Use a specific forecast instead.
 if(!rule&&type==='income'&&(p.futureRecurringRules||[]).some(r=>
  String(r.originalAccountId||r.accountId)===accountId&&r.type===type&&
  (r.matchNames||[sourceMerchant(r.originalMerchant||r.merchant)])
   .includes(sourceMerchant(merchant))))
  throw Error('This employer has confirmed schedules. Choose the exact paycheck in Future Transactions.');
 const phaseDate=rule?.frequency==='every-4-weeks'?rule.anchorDate:
  row.cadence==='every-4-weeks'?row.baseDate||row.date:null,
  // Separate obligations can have the identical merchant, account, due
  // date, direction and amount. Stopping ONE may never blacklist its sibling.
  siblings=rule&&(p.futureRecurringRules||[]).some(r=>
   r.id!==rule.id&&String(r.originalAccountId||r.accountId||r.fromAccountId)===accountId&&
   (r.kind==='movement'?'transfer':r.type)===type&&
   sourceMerchant(r.originalMerchant||r.merchant)===sourceMerchant(merchant)),
  ruleOnly=Boolean(siblings&&!phaseDate),
  key=ruleOnly?'manual-rule|'+encodeURIComponent(rule.id):
   recurrenceKey(accountId,type,merchant)+(phaseDate?'|phase'+phaseOf(phaseDate):'');
 p.futureRecurrenceExclusions??={};
 p.futureRecurrenceExclusions[key]={accountId,type,merchant,
  ...(ruleOnly?{manualRuleId:rule.id}:{}),
  ...(phaseDate?{phaseDate,frequency:'every-4-weeks'}:{})};
 const remove=(p.futureRecurringRules||[]).filter(r=>
  String(r.originalAccountId||r.accountId||r.fromAccountId)===accountId&&
  (r.kind==='movement'?'transfer':r.type)===type&&
  sourceMerchant(r.originalMerchant||r.merchant)===sourceMerchant(merchant)&&
  (rule?r.id===rule.id:!phaseDate||r.frequency==='every-4-weeks'&&samePhase(phaseDate,r.anchorDate)));
 const ids=new Set(remove.map(r=>r.id));
 p.futureRecurringRules=p.futureRecurringRules.filter(r=>!ids.has(r.id));
 const keys=new Set([row.seriesKey,...remove.map(r=>manualSeriesKey(r.id))].filter(Boolean));
 const signature=[accountId,type,sourceMerchant(merchant)].map(encodeURIComponent).join('|');
 for(const k of Object.keys(p.futureSeriesEdits||{})){
  if(keys.has(k)||!phaseDate&&k.startsWith('series|'+signature+'|'))delete p.futureSeriesEdits[k];
 }
 for(const k of Object.keys(p.futureTransactionEdits||{})){
  if(!k.startsWith('event|')&&!k.startsWith('movement|'))continue;
  let entry;try{entry=decodeURIComponent(k.split('|')[1]||'')}catch{continue}
  if([...ids].some(id=>entry.startsWith('user|'+id+'|'))||
   !phaseDate&&entry.startsWith('auto|series|'+signature+'|')||
   phaseDate&&row.seriesKey&&entry.startsWith('auto|'+row.seriesKey+'|'))
   delete p.futureTransactionEdits[k];
 }
 return {key,accountId,type,merchant,removedRules:ids.size};
}
function removeRecurring(state,id){
 const p=ensure(state),index=p.futureRecurringRules.findIndex(r=>r.id===id);
 if(index<0)throw Error('Recurring rule no longer exists');
 p.futureRecurringRules.splice(index,1);
 delete p.futureSeriesEdits[manualSeriesKey(id)];
 // Individual exceptions to a removed rule must not reappear if it is
 // subsequently recreated with the same stable identity.
 const prefix=encodeURIComponent('user|'+id+'|');
 for(const key of Object.keys(p.futureTransactionEdits||{}))
  if(key.includes(prefix))delete p.futureTransactionEdits[key];
}

// A default amount applies to every occurrence. A dated estimate replaces
// only occurrences in its interval; latest explicit interval wins.
function scheduleAmount(rule,date){
 const windows=Array.isArray(rule.amountWindows)?rule.amountWindows:[];
 const override=windows.filter(w=>validDate(w.from)&&validDate(w.through)&&
  w.from<=date&&date<=w.through&&validAmount(w.amount)).at(-1);
 return {amount:round(override?.amount??rule.amount),
  estimated:override?true:rule.amountBasis==='estimate',
  scoped:Boolean(override)};
}
function setScheduleEstimate(state,id,data,asOf){
 const p=ensure(state),r=p.futureRecurringRules.find(v=>v.id===id);
 if(!r)throw Error('That schedule no longer exists.');
 if(!validAmount(data.amount))throw Error('Enter a positive estimated amount.');
 const value=round(data.amount),scope=String(data.scope||'all');
 if(scope!=='all')throw Error('Edit one dated payment, or change the entire repeating schedule.');
 r.amount=value;r.amountBasis='estimate';
 // All future means ALL future: old date-range overrides are superseded,
 // whereas individually saved transaction edits remain independent.
 r.amountWindows=[];
 const old=p.futureSeriesEdits?.[manualSeriesKey(id)];
 if(old)delete old.amount;
 return r;
}
function removeScheduleEstimate(state,id,index){
 const r=ensure(state).futureRecurringRules.find(v=>v.id===id);
 if(!r)throw Error('The saved schedule no longer exists.');
 if(!Number.isInteger(index)||index<0||index>=r.amountWindows?.length)
  throw Error('That forecast estimate no longer exists.');
 r.amountWindows.splice(index,1);
}
function generatedRecurring(rules,asOf,through){
 const events=[],plans=[];
 for(const r of rules||[]){
  for(const d of recurrenceDates(r,asOf,through)){
   const estimated=scheduleAmount(r,d),amount=estimated.amount,
    merchant=r.scheduleLabel||r.merchant,scopedEstimate=estimated.scoped;
   if(r.kind==='movement'){
    plans.push({id:'user|'+r.id+'|'+d,anchorDate:d,frequency:'once',
     amount,fromAccountId:r.fromAccountId,toAccountId:r.toAccountId,
     merchant,scopedEstimate,amountEstimate:estimated.estimated?'schedule-estimate':null,
     seriesRuleId:r.id,source:'user-recurring'});
   }else{
    events.push({id:'user|'+r.id+'|'+d,date:d,amount,
     merchant,scopedEstimate,amountEstimate:estimated.estimated?'schedule-estimate':null,
     accountId:r.accountId,type:r.type,category:'Confirmed recurring',
     cashDirection:r.cashDirection,source:'user-recurring',cadence:r.frequency,
     ruleId:r.id,_seriesKey:manualSeriesKey(r.id),_seriesDate:d});
   }
  }
 }
 return {events,plans};
}
function matchesRecurring(rule,event,accounts){
 const account=accountRef(event.accountId||event.account||event.fromAccountId,accounts);
 const sourceAccount=String(rule.originalAccountId);
 if(account!==sourceAccount||!(Number(event.amount)>0))return false;
 const kind=rule.kind==='movement'?'movement':'event';
 const eventKind=event.kind==='movement'?'movement':'event';
 if(kind!==eventKind)return false;
 if(kind==='movement'&&String(event.toAccountId)!==String(rule.toAccountId))return false;
 if(kind==='event'&&event.type!==rule.type)return false;
 const sameName=(rule.matchNames||[]).includes(merchantKey(event.merchant));
 if(!sameName)return false;
 const date=String(event.date||event.anchorDate||'');
 if(!validDate(date)||date<rule.sourceAnchorDate&&daysBetween(rule.sourceAnchorDate,date)>7)return false;
 const sourceSchedule=frequencies.has(rule.sourceFrequency)?{
  ...rule,frequency:rule.sourceFrequency,anchorDate:rule.sourceAnchorDate,
  secondDay:rule.sourceSecondDay||rule.secondDay
 }:rule;
 return recurrenceDates(sourceSchedule,shift(date,-7),shift(date,7))
  .some(d=>Math.abs(daysBetween(d,date))<=
   (rule.sourceFrequency==='weekly'?2:['biweekly','every-4-weeks'].includes(rule.sourceFrequency)?3:6));
}

/* Source bank balances already include posted transactions. One posted payment
 * can cover at most one future scheduled occurrence; never forecast it again. */
function postedCoverage(generated,rules,records,accounts,asOf){
 const byId=new Map((rules||[]).map(r=>[r.id,r])),
  posted=(records||[]).filter(t=>!t.pending&&validDate(t.date)&&
   t.date<=asOf&&Number(t.amount)>0&&String(t.id||'')),
  items=[...(generated.events||[]).map(item=>({item,kind:'event',id:item.ruleId})),
   ...(generated.plans||[]).map(item=>({item,kind:'movement',id:item.seriesRuleId}))],
  pairs=[];
 // Reconcile as a GROUP, not in schedule creation order. When one of two
 // same-day water bills posts early, match the actual amount to the most
 // plausible obligation; leave the OTHER bill in the cash forecast.
 items.forEach(({item,kind,id},index)=>{
  const r=byId.get(id);if(!r)return;
  const effective=kind==='movement'&&item._postedView?item._postedView:item,
   date=String(effective.date||effective.anchorDate||item.anchorDate||''),
   account=String(kind==='movement'?effective.fromAccountId:effective.accountId),
   tolerance=r.frequency==='weekly'?2:['biweekly','every-4-weeks'].includes(r.frequency)?3:6;
  if(!validDate(date))return;
  posted.forEach((t,p)=>{
   if(!sameDirection(t,kind==='event'?r.type:'transfer')||
    accountRef(t.accountId||t.account,accounts)!==account||
    !(r.matchNames||[]).includes(merchantKey(t.merchant||t.name)))return;
   const gap=Math.abs(daysBetween(t.date,date)),
    cycle=['monthly','quarterly','semiannual','annual'].includes(r.frequency)&&
     t.date.slice(0,7)===date.slice(0,7);
   if(gap>tolerance&&!cycle)return;
   const expected=Math.max(1,Number(item.amount)||1),
    deviation=Math.abs(Number(t.amount)-expected)/expected,
    // Historical links indicate source identity but do not guarantee
    // future bill amounts. Amount then date are safer than creation order.
    linked=(r.exampleIds||[]).includes(String(t.id));
   pairs.push({index,p,score:(linked?-100:0)+deviation*10+gap*.01,
    tie:String(r.id)+'|'+date+'|'+String(t.id)});
  });
 });
 pairs.sort((a,b)=>a.score-b.score||a.tie.localeCompare(b.tie));
 const usedItems=new Set(),usedPosted=new Set();
 for(const pair of pairs){
  if(usedItems.has(pair.index)||usedPosted.has(pair.p))continue;
  usedItems.add(pair.index);usedPosted.add(pair.p);
 }
 const n=(generated.events||[]).length;
 return {
  events:(generated.events||[]).filter((_,i)=>!usedItems.has(i)),
  plans:(generated.plans||[]).filter((_,i)=>!usedItems.has(n+i))
 };
}
const api={ensure,keyEvent,keyMovement,normalFields,transferFields,saveEdit,skip,restore,add,removeAdded,
 seriesEvent,seriesPlan,applySeries,saveSeriesEdit,resetSeries,
 frequencies,findExamples,bankDirection,sameDirection,historicalScheduleMatches,recurrenceDates,manualSeriesKey,defineRecurring,removeRecurring,generatedRecurring,scheduleAmount,setScheduleEstimate,removeScheduleEstimate,matchesRecurring,postedCoverage,
 recurrenceKey,isNotRecurring,stopRecurrence,restoreRecurrence};
root.HouseholdPlannerTransactions=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
