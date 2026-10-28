/* Editable future cash movements. Forecast-only adjustments, never bank source edits. */
(function(root){
'use strict';
const validDate=s=>{const text=String(s||''),parsed=new Date(text+'T12:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===text;};
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const CategoryLibrary=root.HouseholdLedgerData||
 (typeof require==='function'?require('./ledger-data.js'):null);
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
 const p=ensure(state),previous=p.futureTransactionEdits[key];
 // An older duplicate must not block editing an unrelated occurrence.
 // Compare the existing saved record identities with the proposed change.
 const before={...p,futureTransactionEdits:{...p.futureTransactionEdits}};
 p.futureTransactionEdits[key]=fields;
 try{assertNoNewForecastDuplicates(before,p)}
 catch(error){
  if(previous===undefined)delete p.futureTransactionEdits[key];
  else p.futureTransactionEdits[key]=previous;
  throw error;
 }
 return fields;
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
// Only the canonical future-add array stores user-created one-offs. Reject
// an exact duplicate before allocating another durable record ID. Linked
// transfers are compared once as a single money movement, not two account legs.
const cleanMerchant=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
function oneOffKey(row,asOf=''){
 const day=forecastBusinessDate(String(row.date||''),asOf);
 const movement=row.type==='transfer'&&row.fromAccountId&&row.toAccountId;
 const identity=movement?['movement',row.fromAccountId,row.toAccountId]:
  ['event',row.accountId,row.type,row.cashDirection||''];
 return JSON.stringify([...identity,day,cleanMerchant(row.merchant),
  Math.round(Number(row.amount)*100)]);
}
function assertDistinctOneOffs(predictions,asOf=''){
 const found=new Set(),ids=new Set();
 for(const row of predictions?.futureTransactionAdds||[]){
  // Editing/skipping a single occurrence must not create an accidental
  // duplicate of a different saved one-off. Preserve the saved record ID.
  const edit=predictions?.futureTransactionEdits?.[row.type==='transfer'?
   keyMovement('future|'+row.id):keyEvent(row.id,row.accountId)];
  if(edit?.skipped)continue;
  const effective=edit?{...row,...edit}:row,key=oneOffKey(effective,asOf);
  if(ids.has(String(row.id))||found.has(key))
   throw Error('This future transaction is already saved. Edit the existing prediction instead of adding it twice.');
  ids.add(String(row.id));found.add(key);
 }
}
function assertDistinctSchedules(predictions){
 const ids=new Set(),saved=new Set();
 for(const rule of predictions?.futureRecurringRules||[]){
  if(!rule||typeof rule!=='object')throw Error('Invalid recurring prediction');
  const identity=[
   String(rule.kind||''),String(rule.accountId||rule.fromAccountId||''),
   String(rule.toAccountId||''),String(rule.type||'transfer'),
   String(rule.cashDirection||''),String(rule.anchorDate||''),
   String(rule.frequency||''),Math.round(Number(rule.amount)*100),
   cleanMerchant(rule.originalMerchant||rule.merchant),
   cleanMerchant(rule.scheduleLabel||rule.merchant)
  ].join('|');
  if(ids.has(String(rule.id))||saved.has(identity))
   throw Error('This recurring transaction already has an identical prediction. Edit the existing prediction instead.');
  ids.add(String(rule.id));saved.add(identity);
 }
}
function assertUniqueForecastTransactions(predictions){
 assertDistinctOneOffs(predictions);
 assertDistinctSchedules(predictions);
}
// Earlier versions could save indistinguishable schedules. Their existence
// must not lock unrelated forecast, category, or Review decisions.
// Compare durable record identities to forbid NEW duplicate pairs, rather
// than rejecting the entire saved catalog on every write.
function duplicatePairs(predictions){
 const groups=new Map(),pairs=new Map();
 const add=(kind,key,id)=>{
  const group=kind+'|'+key;
  if(!groups.has(group))groups.set(group,[]);
  groups.get(group).push(String(id));
 };
 for(const [i,row] of (predictions?.futureTransactionAdds||[]).entries()){
  if(!row||typeof row!=='object')continue;
  const id=String(row.id||'index:'+i),
   edit=predictions?.futureTransactionEdits?.[row.type==='transfer'?
    keyMovement('future|'+row.id):keyEvent(row.id,row.accountId)];
  if(edit?.skipped)continue;
  add('one-off',oneOffKey(edit?{...row,...edit}:row),id);
 }
 for(const [i,rule] of (predictions?.futureRecurringRules||[]).entries()){
  if(!rule||typeof rule!=='object')continue;
  const identity=[
   String(rule.kind||''),String(rule.accountId||rule.fromAccountId||''),
   String(rule.toAccountId||''),String(rule.type||'transfer'),
   String(rule.cashDirection||''),String(rule.anchorDate||''),
   String(rule.frequency||''),Math.round(Number(rule.amount)*100),
   cleanMerchant(rule.originalMerchant||rule.merchant),
   cleanMerchant(rule.scheduleLabel||rule.merchant)
  ];
  add('schedule',JSON.stringify(identity),String(rule.id||'index:'+i));
 }
 for(const [group,ids] of groups){
  if(ids.length<2)continue;
  ids.sort();
  for(let i=0;i<ids.length;i++)
   for(let j=i+1;j<ids.length;j++){
    const pair=JSON.stringify([group,ids[i],ids[j]]);
    pairs.set(pair,(pairs.get(pair)||0)+1);
   }
 }
 return pairs;
}
function assertNoNewForecastDuplicates(previous,next){
 const before=duplicatePairs(previous),after=duplicatePairs(next);
 for(const [pair,count] of after){
  if(count>(before.get(pair)||0))
   throw Error(pair.includes('one-off')?
    'This future transaction is already saved. Edit the existing prediction instead of adding it twice.':
    'This recurring transaction already has an identical prediction. Edit the existing prediction instead.');
 }
}
function add(state,data,accounts,asOf){
 const transfer=data.type==='transfer',
  fields=transfer?transferFields(data,accounts,asOf):normalFields(data,accounts,asOf),
  recordData={...fields,...(transfer?{type:'transfer'}:{})},p=ensure(state);
 // Pre-existing duplicate one-offs are preserved, not silently removed.
 // Only this newly requested record is checked against existing saves.
 if(p.futureTransactionAdds.some(saved=>oneOffKey(saved,asOf)===oneOffKey(recordData,asOf)))
  throw Error('This future transaction is already saved. Edit the existing prediction instead of adding it twice.');
 // An identical one-off should edit the dated occurrence of a saved prediction,
 // rather than create a second payment on the same account and date.
 const generated=generatedRecurring(p.futureRecurringRules||[],shift(fields.date,-8),shift(fields.date,8));
 if([...generated.events,...generated.plans].some(e=>{
  const candidate={...e,...(e.seriesRuleId?{type:'transfer'}:{})};
  return oneOffKey(candidate,asOf)===oneOffKey(recordData,asOf);
 }))throw Error('This transaction is already covered by a recurring prediction. Edit that occurrence instead.');
 const record={id:'future-add|'+Date.now().toString(36)+'|'+Math.random().toString(36).slice(2,10),
  ...recordData};
 p.futureTransactionAdds.push(record);
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
/* A future occurrence is modeled on the Friday before a weekend, without
 * mutating its stable recurrence anchor or bank-posted historical source date.
 * If Friday is already inside the authoritative bank snapshot (<= asOf), it
 * cannot be inserted retroactively: use Monday instead of losing the charge. */
const forecastBusinessDate=(iso,asOf='')=>{
 if(!validDate(iso))return iso;
 const day=new Date(iso+'T12:00:00Z').getUTCDay();
 if(day!==0&&day!==6)return iso;
 const prior=shift(iso,day===6?-1:-2);
 return prior>asOf?prior:shift(iso,day===6?2:1);
};
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
// Prediction menus are views of the canonical Ledger category library.
const defaultScheduleCategories=Object.freeze(CategoryLibrary.categories({predictions:{}}));
const scheduleCategories=state=>CategoryLibrary.categories(state);
function scheduleCategory(name,state){
 const value=CategoryLibrary.canonicalCategory(state,name||'Uncategorized');
 if(!value)throw Error('Choose an existing prediction category or add it first');
 return value;
}
function setScheduleCategory(state,id,category){
 const list=state?.predictions?.futureRecurringRules||[];
 const rule=list.find(r=>String(r.id)===String(id));
 if(!rule)throw Error('This prediction changed. Open the list again.');
 const value=scheduleCategory(category,state);
 const p=ensure(state),current=p.futureRecurringRules.find(r=>String(r.id)===String(id));
 if(!current)throw Error('This prediction changed. Open the list again.');
 current.category=value;
 return {id:current.id,category:value};
}
const addScheduleCategory=(state,name)=>CategoryLibrary.addCategory(state,name);

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
// Saved matching boundaries describe acceptable BANK POSTING evidence only.
// They never move or change the amount of an underlying forecast occurrence.
// Missing bounds preserve legacy cadence/date matching and variable bills.
const defaultMatchDays=frequency=>frequency==='weekly'?2:
 ['biweekly','every-4-weeks'].includes(frequency)?3:6;
function matchWindow(rule){
 const dayValue=(name)=>{
  const x=rule?.[name];
  return x!==''&&x!==null&&x!==undefined&&Number.isInteger(Number(x))&&
   Number(x)>=0&&Number(x)<=14?Number(x):null;
 };
 const amountValue=(name)=>{
  const x=rule?.[name];
  return x!==''&&x!==null&&x!==undefined&&Number.isFinite(Number(x))&&
   Number(x)>=0?Number(x):null;
 };
 const before=dayValue('matchDaysBefore'),after=dayValue('matchDaysAfter');
 return {before:before??defaultMatchDays(rule?.frequency),
  after:after??defaultMatchDays(rule?.frequency),
  customDays:before!==null||after!==null,
  min:amountValue('matchAmountMin'),max:amountValue('matchAmountMax')};
}
function postedWithinMatchWindow(rule,bank,date,amount,explicit=false,overdue=false){
 if(!validDate(date)||!validDate(bank?.date)||!(Number(bank?.amount)>0))
  return false;
 const window=matchWindow(rule),actual=Number(bank.amount),
  low=window.min,high=window.max;
 if(low!==null&&actual+0.005<low||high!==null&&actual-0.005>high)return false;
 if(window.customDays)
  return bank.date>=shift(date,-window.before)&&bank.date<=shift(date,window.after);
 // Legacy overdue reconciliation used ±7 days except weekly (±2).
 // Preserve it unless explicit user boundaries supersede that policy.
 if(overdue)return Math.abs(daysBetween(bank.date,date))<=
  (rule.frequency==='weekly'?2:7);
 const gap=Math.abs(daysBetween(bank.date,date)),
  cycle=['monthly','quarterly','semiannual','annual'].includes(rule.frequency)&&
   bank.date.slice(0,7)===date.slice(0,7)&&gap<=21;
 return gap<=(explicit?Math.max(window.before,14):window.before)||cycle;
}
function savedMatchBounds(data,old){
 const get=(name,integer)=>{
  const value=data[name]===undefined?old?.[name]:data[name];
  if(value===undefined||value===null||value==='')return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||(integer?(!Number.isInteger(n)||n>14):n>999999999))
   throw Error(integer?'Matching date window must be 0–14 whole days':
    'Matching amount must be a valid nonnegative dollar value');
  return integer?n:Math.round((n+Number.EPSILON)*100)/100;
 };
 const matchDaysBefore=get('matchDaysBefore',true),
  matchDaysAfter=get('matchDaysAfter',true),
  matchAmountMin=get('matchAmountMin',false),
  matchAmountMax=get('matchAmountMax',false);
 if(matchAmountMin!==null&&matchAmountMax!==null&&matchAmountMin>matchAmountMax)
  throw Error('Minimum matching amount must not exceed maximum');
 return {matchDaysBefore,matchDaysAfter,matchAmountMin,matchAmountMax};
}
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
  for(let i=n;i<n+Math.ceil(Math.max(0,daysBetween(through,asOf))/step)+2;i++){
   const d=shift(start,i*step);if(d>through)break;if(d>asOf&&d>=start)dates.push(d)
  }
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
// Resolve an existing confirmed schedule's historical cadence independently
// of the editable "next date". Never mutate saved state and never create past
// commitments solely because a user has planned a new future payment.
// Recover only from explicit older source evidence or independently observed,
// phase-compatible posted bank payments. The audit is bounded for efficiency.
function reconciliationAnchor(rule,records=[],accounts=[],asOf=''){
 const start=String(rule?.anchorDate||''),
  frequency=String(rule?.frequency||''),
  interval={weekly:7,biweekly:14,'every-4-weeks':28}[frequency],
  cashDebit=rule?.kind==='event'&&
   (rule.type==='expense'||rule.type==='transfer'&&rule.cashDirection==='out'),
  account=String(rule?.accountId||'');
 if(!cashDebit||!validDate(start)||!validDate(asOf)||!frequencies.has(frequency)||
  start<=shift(asOf,-90)||!accounts.some(a=>String(a.id)===account))return start;
 const dateIndex=new Set();
 // Replay at most 90 days of this same schedule, never assume a payment
 // outside the protected history horizon or a different cycle phase.
 const begin=shift(asOf,-90);
 for(let d=start,n=0;n<120&&d>=begin;n++){
  if(validDate(d))dateIndex.add(d);
  if(interval)d=shift(d,-interval);
  else if(frequency==='twice-monthly'){
   const last=shift(d,-1), month=last.slice(0,7);
   const options=[Number(start.slice(-2)),Number(rule.secondDay)].filter(x=>
    Number.isInteger(x)&&x>=1&&x<=31).map(day=>monthAt(month+'-01',0,day));
   d=options.filter(x=>x<d).sort().at(-1)||monthAt(d,-1,Number(start.slice(-2)));
  }else d=monthAt(start,-(n+1)*({monthly:1,quarterly:3,
   semiannual:6,annual:12}[frequency]||1),Number(start.slice(-2)));
 }
 const dates=[...dateIndex].filter(d=>d<=asOf&&d>=begin).sort();
 if(!dates.length)return start;
 const prior=String(rule.reconciliationAnchorDate||'');
 // This is the durable anchor captured before changing future defaults.
 if(validDate(prior)&&prior<start){
  const earliest=dates.find(d=>d>=prior);
  if(earliest)return earliest;
 }
 const original=String(rule.sourceAnchorDate||'');
 if(rule.sourceFrequency===frequency&&validDate(original)&&original<start){
  const source=dates.find(d=>Math.abs(daysBetween(d,original))<=
   (interval?Math.min(4,Math.round(interval/4)):14));
  if(source)return source;
 }
 const bank=(records||[]).filter(row=>!row.pending&&validDate(row.date)&&
  row.date<=asOf&&Number(row.amount)>0&&
  accountRef(row.accountId||row.account,accounts)===account&&
  bankDirection(row)==='expense'&&
  historicalScheduleMatches(row,accounts,[rule]).length===1);
 const directIds=new Set((rule.exampleIds||[]).map(String));
 const evidence=dates.filter(date=>bank.some(row=>
  postedWithinMatchWindow(rule,row,date,rule.amount,false,true)));
 if(!evidence.length)return start;
 // A bank-posted example explicitly owned by this forecast is strong
 // evidence. Otherwise require two distinct observations of the cadence;
 // one unrelated same-payee payment must not backdate a new schedule.
 const directlyLinked=bank.some(row=>directIds.has(String(row.id))&&
  evidence.some(date=>postedWithinMatchWindow(rule,row,date,rule.amount,false,true)));
 return directlyLinked||evidence.length>=2?evidence[0]:start;
}
function manualSeriesKey(ruleId){return 'user-series|'+encodeURIComponent(String(ruleId))}

// Ambiguity is a choice of existing forecast schedules, never permission to
// create another debit or combine independent paycheck phases.
function scheduleChoice(candidates){
 const e=Error('Several saved predictions match this payment. Choose the one to update.');
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
    (r.type===type||r.kind==='event'&&r.type==='transfer'&&
     (r.cashDirection==='out'?'expense':r.cashDirection==='in'?'income':null)===type)));
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
 // A historical payment already associated with an existing prediction can
 // only update THAT schedule. A stale form or separate-bill checkbox must
 // never silently create a competing recurring obligation.
 if(reference?.bankTransactionId){
  const actual=(records||[]).find(t=>String(t.id)===String(reference.bankTransactionId));
  if(!actual)throw Error('This bank transaction changed. Refresh bank history before saving.');
  const attached=historicalScheduleMatches(actual,accounts,p.futureRecurringRules);
  if(attached.length){
   if(separate)throw Error('This bank transaction already belongs to a prediction. Open its existing plan; do not create a duplicate.');
   if(!requestedId)throw scheduleChoice(attached);
   if(!attached.some(r=>r.id===requestedId))
    throw Error('This bank transaction belongs to another prediction. Reopen it from History.');
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
 // Explicit separate streams stay possible, but never create an
 // indistinguishable copy of the very same prediction on a repeated Save.
 if(separate&&!reference?.recurringRuleId){
  const label=String(data.scheduleLabel||fields.merchant||'').trim().toLowerCase(),
   duplicate=p.futureRecurringRules.find(r=>
    r.kind===(transfer?'movement':'event')&&
    String(r.accountId||r.fromAccountId)===String(fields.accountId||fields.fromAccountId)&&
    String(r.toAccountId||'')===String(fields.toAccountId||'')&&
    String(r.type||'transfer')===String(fields.type||'transfer')&&
    String(r.cashDirection||'')===String(fields.cashDirection||'')&&
    String(r.anchorDate)===String(fields.date)&&
    String(r.frequency)===frequency&&Number(r.amount)===Number(fields.amount)&&
    String(r.scheduleLabel||r.merchant||'').trim().toLowerCase()===label);
  if(duplicate)throw Error('This repeating payment is already predicted. Edit the existing prediction instead.');
 }
 // A separately named obligation has a durable payment-stream ID, not a
 // merchant/date/amount identity. Both bills may post on the same day.
 if(separate){
  if(reference?.recurringRuleId||requestedId)
   throw Error('Create a separate prediction without selecting an existing one.');
  const prefix='manual|stream|'+[transfer?'movement':'event',baseAccount,
   merchantKey(originalMerchant)].map(encodeURIComponent).join('|')+'|';
  let n=1;
  while(p.futureRecurringRules.some(r=>r.id===prefix+n))n++;
  id=prefix+n;
 }
 // Different historical rows can be labeled expense vs ACH transfer, but
 // refer to the same one mortgage payment. Reuse its existing rule instead
 // of saving two recurring predictions with distinct source type identities.
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
  // An exact cadence can disambiguate a pair of different saved predictions.
  const linked=linkedSchedule(matching,selectedExampleIds);
  const cadenceMatches=matching.filter(r=>r.frequency===frequency);
  const candidates=linked?[linked]:(cadenceMatches.length===1?cadenceMatches:matching);
  if(requestedId){
   const chosen=candidates.find(r=>r.id===requestedId);
   if(!chosen)throw Error('Selected recurring prediction is no longer a match. Reopen this payment.');
   id=chosen.id;
  }else if(candidates.length===1)id=candidates[0].id;
  else if(candidates.length>1)throw scheduleChoice(candidates);
  else if(frequency!=='every-4-weeks'&&sameType.length)
   throw scheduleChoice(sameType);
 }
 let old=p.futureRecurringRules.find(r=>r.id===id);
 if(reference?.recurringRuleId&&!old)
  throw Error('The saved recurring prediction changed. Reopen it before editing.');
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
 // that already owns that same bank payee, not create a duplicate prediction.
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
    throw Error('This bank payment is also connected to another prediction. Review its links.');
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
  throw Error('Choose the matching saved recurring prediction before saving.');
 if(!names.length)throw Error('Enter a merchant name');
 // The editor displays the NEXT occurrence. A change to the amount,
 // category, label or matching limits must not move the recurrence anchor.
 const unchangedNext=old&&old.frequency===frequency&&
  fields.date===recurrenceDates(old,asOf,shift(asOf,1095))[0];
 const anchorDate=unchangedNext?old.anchorDate:fields.date;
 // Immutable original due-date evidence is never overwritten by editing the
 // future schedule. The forecast may use it to audit unpaid past occurrences.
 const reconciliationAnchorDate=old?.reconciliationAnchorDate||old?.anchorDate||anchorDate;
 const rule={id,kind:transfer?'movement':'event',frequency,anchorDate,
  reconciliationAnchorDate,
  ...savedMatchBounds(data,old),
  ...(secondDay?{secondDay}:{}),...fields,
  scheduleLabel:String(data.scheduleLabel||old?.scheduleLabel||'').trim().slice(0,110),
  category:scheduleCategory(data.category===undefined?old?.category:data.category,state),
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
 // bill prevents one bank record being "owned" by both saved predictions.
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
/* One consistent bank-history setting for account + cash direction + payee.
 * ON means automatic discovery is permitted, not that a future payment is
 * guaranteed. OFF blocks automatically inferred future payments, never
 * existing saved plans or immutable posted records. A named historical
 * transaction is not itself a predicted future transaction. */
function historyAutoPredictionEnabled(preferences,accountId,type,merchant){
 const aid=String(accountId||''),kind=String(type||''),name=sourceMerchant(merchant);
 if(!aid||!kind||!name)return null;
 const exclusions=preferences?.futureRecurrenceExclusions||{},
  exact=recurrenceKey(aid,kind,merchant);
 return !Object.entries(exclusions).some(([key,item])=>
  key===exact||Boolean(item&&!item.manualRuleId&&
   String(item.accountId)===aid&&String(item.type)===kind&&
   sourceMerchant(item.merchant)===name));
}
function setHistoryAutoPrediction(state,{accountId,type,merchant}={},enabled=true){
 const aid=String(accountId||''),kind=String(type||''),name=String(merchant||'');
 if(!aid||!sourceMerchant(name)||!['expense','income','refund','transfer'].includes(kind))
  throw Error('This bank payment has no usable payee, account, or direction');
 const p=ensure(state),exclusions=p.futureRecurrenceExclusions??={},
  exact=recurrenceKey(aid,kind,name);
 if(enabled){
  // Clear account/payee-wide, phase-specific, and automatically inferred
  // exclusions together, including legacy variants. Never resurrect or
  // remove any saved repeating rule; explicit plans are handled separately.
  const keys=Object.entries(exclusions).filter(([key,item])=>
   key===exact||Boolean(item&&!item.manualRuleId&&
    String(item.accountId)===aid&&String(item.type)===kind&&
    sourceMerchant(item.merchant)===sourceMerchant(name))).map(([key])=>key);
  for(const key of keys)restoreRecurrence(state,key);
  // A previous legacy decision may exist even without an exclusion entry.
  // Its cleanup belongs to the same policy change, not to bank transaction data.
  return {key:exact,enabled:true,cleared:keys.length};
 }
 // The single history policy is not a "delete schedule" action. In particular
 // never touch two independent confirmed paychecks sharing this merchant.
 exclusions[exact]={accountId:aid,type:kind,merchant:name,historyOptOut:true};
 return {key:exact,enabled:false};
}
// Backward compatibility for existing calls/tests.
function excludeHistorySuggestions(state,reference){
 return setHistoryAutoPrediction(state,reference,false);
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
 if(row.recurringRuleId&&!rule)throw Error('The original recurring prediction changed. Refresh and select it again.');
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
  throw Error('This employer has confirmed predictions. Choose the exact paycheck in Predictions.');
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
 if(!r)throw Error('That prediction no longer exists.');
 if(!validAmount(data.amount))throw Error('Enter a positive estimated amount.');
 const value=round(data.amount),scope=String(data.scope||'all');
 if(scope!=='all')throw Error('Edit one dated payment, or change the entire repeating prediction.');
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
 if(!r)throw Error('The saved prediction no longer exists.');
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
     merchant,category:r.category||'Uncategorized',scopedEstimate,amountEstimate:estimated.estimated?'schedule-estimate':null,
     seriesRuleId:r.id,source:'user-recurring'});
   }else{
    events.push({id:'user|'+r.id+'|'+d,date:d,amount,
     merchant,category:r.category||'Uncategorized',scopedEstimate,amountEstimate:estimated.estimated?'schedule-estimate':null,
     accountId:r.accountId,type:r.type,category:r.category||'Uncategorized',
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
/* A posted bank fact may cover ONE upcoming obligation, never every schedule
 * with the same merchant. Explicit bank IDs outrank renamed Plaid descriptions.
 * If competing independent schedules cannot be differentiated, keep their
 * projections and surface one actionable review item instead of guessing. */
function postedCoverage(generated,rules,records,accounts,asOf){
 const byId=new Map((rules||[]).map(r=>[String(r.id),r])),
  posted=(records||[]).filter(t=>!t.pending&&validDate(t.date)&&
   t.date<=asOf&&Number(t.amount)>0&&String(t.id||'')),
  items=[...(generated.events||[]).map(item=>({item,kind:'event',id:item.ruleId})),
   ...(generated.plans||[]).map(item=>({item,kind:'movement',id:item.seriesRuleId}))],
  pairs=[],byPosted=new Map(),review=[],
  // A posting only needs occurrences from the rules it actually matched.
  // Keep their original global indices and visit order for tie stability.
  itemsByRule=new Map();
 items.forEach(({id},index)=>{
  const key=String(id);
  if(!itemsByRule.has(key))itemsByRule.set(key,[]);
  itemsByRule.get(key).push(index);
 });
 posted.forEach((t,p)=>{
  const matched=historicalScheduleMatches(t,accounts,rules);
  if(!matched.length)return;
  const linked=matched.filter(r=>(r.exampleIds||[]).some(id=>String(id)===String(t.id)));
  const candidates=linked.length?linked:matched,
   relevant=[...new Set(candidates.flatMap(r=>itemsByRule.get(String(r.id))||[]))].sort((a,b)=>a-b);
  for(const index of relevant){
   const {item,kind,id}=items[index],r=byId.get(String(id));
   if(!r||!candidates.some(x=>String(x.id)===String(id)))continue;
   const effective=kind==='movement'&&item._postedView?item._postedView:item,
    date=String(effective.date||effective.anchorDate||item.anchorDate||''),
    account=String(kind==='movement'?effective.fromAccountId:effective.accountId);
   if(!validDate(date)||date<=asOf||
    !sameDirection(t,kind==='event'&&r.type==='transfer'?
     (r.cashDirection==='out'?'expense':'income'):
     kind==='event'?r.type:'transfer')||
    accountRef(t.accountId||t.account,accounts)!==account)continue;
   const explicit=linked.some(x=>String(x.id)===String(r.id));
   // Posted bank evidence is accepted only inside THIS prediction's date
   // and amount boundaries. One bank row still covers at most one rule.
   if(!postedWithinMatchWindow(r,t,date,item.amount,explicit))continue;
   const gap=Math.abs(daysBetween(t.date,date));
   const expected=Math.max(1,Number(item.amount)||1),
    deviation=Math.abs(Number(t.amount)-expected)/expected,
    candidate={index,p,ruleId:String(r.id),date,gap,deviation,explicit,
     score:(explicit?-100:0)+Math.min(2,deviation)*4+gap*.16,
     tie:String(r.id)+'|'+date+'|'+String(t.id)};
   pairs.push(candidate);
   if(!byPosted.has(p))byPosted.set(p,[]);
   byPosted.get(p).push(candidate);
  }
 });
 const unresolved=new Set();
 for(const [p,matches] of byPosted){
  const future=matches.slice().sort((a,b)=>a.score-b.score||a.tie.localeCompare(b.tie)),
   bestByRule=new Map();
  for(const m of future)if(!bestByRule.has(m.ruleId))bestByRule.set(m.ruleId,m);
  const distinct=[...bestByRule.values()].sort((a,b)=>a.score-b.score||a.tie.localeCompare(b.tie));
  if(distinct.length<2)continue;
  const [first,second]=distinct,
   uniqueExplicit=first.explicit&&!second.explicit,
   amountClear=first.deviation<=.18&&
    (second.deviation-first.deviation>.18||second.gap-first.gap>=3);
  if(uniqueExplicit||amountClear)continue;
  const t=posted[p];
  // Only genuinely competing FUTURE confirmed obligations require a decision.
  unresolved.add(p);
  review.push({bankId:String(t.id),merchant:String(t.merchant||t.name||'Bank payment'),
   amount:Number(t.amount),date:t.date,accountId:accountRef(t.accountId||t.account,accounts),
   candidates:distinct.map(m=>({ruleId:m.ruleId,date:m.date,
    amount:Number(items[m.index].item.amount),label:String(byId.get(m.ruleId)?.scheduleLabel||
     byId.get(m.ruleId)?.merchant||'Predicted payment')}))});
 }
 pairs.sort((a,b)=>a.score-b.score||a.tie.localeCompare(b.tie));
 const usedItems=new Set(),usedPosted=new Set();
 for(const pair of pairs){
  if(unresolved.has(pair.p)||usedItems.has(pair.index)||usedPosted.has(pair.p))continue;
  usedItems.add(pair.index);usedPosted.add(pair.p);
 }
 const n=(generated.events||[]).length;
 return {
  events:(generated.events||[]).filter((_,i)=>!usedItems.has(i)),
  plans:(generated.plans||[]).filter((_,i)=>!usedItems.has(n+i)),
  review
 };
}
function linkPostedToSchedule(state,bankId,ruleId,records,accounts){
 const rules=state?.predictions?.futureRecurringRules||[],
  target=rules.find(r=>String(r.id)===String(ruleId)),
  bank=(records||[]).find(t=>String(t.id)===String(bankId));
 if(!target||!bank||bank.pending||!validDate(bank.date)||!(Number(bank.amount)>0))
  throw Error('This posted payment or prediction changed. Refresh and try again.');
 const account=accountRef(bank.accountId||bank.account,accounts);
 if(String(target.originalAccountId||target.accountId||target.fromAccountId)!==account||
  !sameDirection(bank,target.kind==='movement'?'transfer':
   target.type==='transfer'?(target.cashDirection==='out'?'expense':'income'):target.type))
  throw Error('Bank account or payment direction does not match this prediction.');
 const p=ensure(state),r=p.futureRecurringRules.find(x=>String(x.id)===String(ruleId));
 // A deliberate decision may reassign a bank posting, but never alters
 // the bank record, creates another prediction, or rewrites future amounts.
 for(const other of p.futureRecurringRules){
  if(String(other.id)===String(ruleId))continue;
  if(Array.isArray(other.exampleIds))
   other.exampleIds=other.exampleIds.filter(id=>String(id)!==String(bankId));
 }
 r.exampleIds=[...new Set([...(r.exampleIds||[]).map(String),String(bankId)])];
 // User-confirmed aliases help recognize future bank postings even if
 // Plaid's displayed payee differs from the prediction name. Shared aliases
 // across two obligations remain ambiguous and require another decision.
 const alias=merchantKey(bank.merchant||bank.name);
 if(alias)r.matchNames=[...new Set([...(r.matchNames||[]),alias])];
 return r.id;
}

const api={ensure,keyEvent,keyMovement,normalFields,transferFields,saveEdit,skip,restore,add,removeAdded,oneOffKey,assertDistinctOneOffs,assertDistinctSchedules,assertUniqueForecastTransactions,assertNoNewForecastDuplicates,
 seriesEvent,seriesPlan,applySeries,saveSeriesEdit,resetSeries,
 frequencies,defaultScheduleCategories,scheduleCategories,reconciliationAnchor,matchWindow,postedWithinMatchWindow,savedMatchBounds,scheduleCategory,setScheduleCategory,addScheduleCategory,findExamples,bankDirection,sameDirection,historicalScheduleMatches,recurrenceDates,manualSeriesKey,defineRecurring,removeRecurring,generatedRecurring,scheduleAmount,setScheduleEstimate,removeScheduleEstimate,matchesRecurring,postedCoverage,linkPostedToSchedule,
 recurrenceKey,isNotRecurring,historyAutoPredictionEnabled,setHistoryAutoPrediction,stopRecurrence,excludeHistorySuggestions,restoreRecurrence,
 // Shared primitives only; scheduling, recommendation and payment policies stay
 // separate. Preserve unknown/ambiguous account references unchanged.
 merchantKey,accountRef,daysBetween,shift,monthAt,forecastBusinessDate};
root.HouseholdPlannerTransactions=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
