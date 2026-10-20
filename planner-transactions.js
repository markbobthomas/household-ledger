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
 return {...source,date,amount:change.amount,
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
const daysBetween=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
const accountRef=(value,accounts)=>{
 const v=String(value||'');
 const found=(accounts||[]).filter(a=>[a.id,a.name,a.transactionAccount].some(x=>String(x||'')===v));
 return found.length===1?String(found[0].id):v;
};
function findExamples(records,reference,accounts){
 const account=reference.kind==='movement'?String(reference.fromAccountId):String(reference.accountId);
 const amount=Number(reference.amount||0),type=reference.type||'transfer',
  name=merchantKey(reference.merchant),head=name.split(' ').find(word=>word.length>3)||name;
 return (records||[]).filter(t=>!t.pending&&validDate(t.date)&&
  accountRef(t.accountId||t.account,accounts)===account&&merchantKey(t.merchant)&&
  (type==='transfer'?t.type==='transfer':t.type===type)&&
  Math.abs(Number(t.amount)-amount)<.011).sort((a,b)=>{
   const score=t=>merchantKey(t.merchant)===name?2:
    merchantKey(t.merchant).includes(head)&&head.length>3?1:0;
   return score(b)-score(a)||b.date.localeCompare(a.date);
  }).slice(0,10).map(t=>({id:String(t.id),date:t.date,
   merchant:String(t.merchant),amount:Number(t.amount),accountId:account,type:t.type}));
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
  for(let i=0;i<=16;i+=spacing){
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
 const p=ensure(state);
 const baseAccount=reference?.kind==='movement'?String(reference.fromAccountId):
  String(reference?.accountId||fields.accountId);
 const originalMerchant=reference?.originalMerchant||reference?.merchant||fields.merchant;
 const originalAmount=Number(reference?.sourceAmount??reference?.amount??fields.amount);
 const originalType=reference?.type||fields.type;
 let id=reference?.recurringRuleId||'manual|'+[transfer?'movement':'event',
  baseAccount,reference?.toAccountId||'',originalType,merchantKey(originalMerchant),round(originalAmount)]
  .map(encodeURIComponent).join('|');
 // Different historical rows can be labeled expense vs ACH transfer, but
 // refer to the same one mortgage payment. Reuse its existing rule instead
 // of saving two recurring schedules with distinct source type identities.
 // Account and amount are required; two different paying accounts, or a
 // real internal transfer and an expense, must remain separate.
 if(!reference?.recurringRuleId){
  const sameMerchant=p.futureRecurringRules.filter(r=>
   r.kind===(transfer?'movement':'event')&&
   String(r.originalAccountId||r.accountId||r.fromAccountId)===baseAccount&&
   (!transfer||String(r.toAccountId)===String(fields.toAccountId))&&
   (merchantKey(r.originalMerchant||r.merchant)===merchantKey(originalMerchant)||
    (r.matchNames||[]).includes(merchantKey(originalMerchant))));
  const exact=sameMerchant.filter(r=>
   Math.abs(Number(r.matchAmount??r.amount)-originalAmount)<.011);
  if(exact.length>1||sameMerchant.length>1)
   throw Error('Several recurring schedules already exist for this merchant and account. Review them before adding another.');
  if(exact.length===1)id=exact[0].id;
  else if(sameMerchant.length===1){
   const oldAmount=Number(sameMerchant[0].matchAmount??sameMerchant[0].amount);
   const change=Math.abs(oldAmount-originalAmount)/Math.max(oldAmount,originalAmount,1);
   if(change>.25)
    throw Error('A different recurring amount already exists for this merchant and account. Edit its existing recurring schedule before adding another.');
   // One unique recurring item whose monthly amount shifted modestly:
   // update its existing rule rather than creating a second debit.
   id=sameMerchant[0].id;
  }
 }
 const old=p.futureRecurringRules.find(r=>r.id===id);
 const candidates=(records||[]).filter(t=>!t.pending&&validDate(t.date)&&String(t.id||'')&&
  accountRef(t.accountId||t.account,accounts)===baseAccount&&
  merchantKey(t.merchant)&&Number(t.amount)>0);
 const chosen=[...new Set((selectedExampleIds||[]).map(String))];
 const examples=chosen.map(id=>candidates.find(t=>String(t.id)===id));
 if(examples.some(t=>!t))throw Error('One of the historical examples is no longer available');
 if(examples.some(t=>Math.abs(Number(t.amount)-originalAmount)>.011||
  (transfer?t.type!=='transfer':t.type!==originalType)))
  throw Error('Select examples of the same amount and transaction type');
 const names=[originalMerchant,...examples.map(t=>t.merchant)].map(merchantKey).filter(Boolean);
 if(!names.length)throw Error('Enter a merchant name');
 const rule={id,kind:transfer?'movement':'event',frequency,anchorDate:fields.date,
  ...(secondDay?{secondDay}:{}),...fields,
  originalAccountId:old?.originalAccountId||baseAccount,
  sourceAnchorDate:old?.sourceAnchorDate||reference?.baseDate||reference?.date||fields.date,
  sourceFrequency:old?.sourceFrequency||({
   'every 2 weeks':'biweekly','every 4 weeks':'every-4-weeks','twice monthly':'twice-monthly','3 / month':null,
   '4 / month':null,'5 / month':null
  }[reference?.cadence]||reference?.cadence||frequency),
  originalMerchant:old?.originalMerchant||originalMerchant,
  originalType:old?.originalType||originalType,
  matchAmount:round(originalAmount),
  matchNames:[...new Set([...(old?.matchNames||[]),...names])],
  exampleIds:[...new Set([...(old?.exampleIds||[]),...chosen])],
  ...(old?.sourceAddedId||reference?.addedId?{sourceAddedId:old?.sourceAddedId||reference?.addedId}:{}),
  ...(old?.sourceKey||reference?.key?{sourceKey:old?.sourceKey||reference?.key}:{})};
 const index=p.futureRecurringRules.findIndex(r=>r.id===id);
 if(index<0)p.futureRecurringRules.push(rule);else p.futureRecurringRules[index]=rule;
 // Explicit confirmation reverses any earlier "Not recurring" decision for
 // this precise merchant, account and movement direction.
 delete p.futureRecurrenceExclusions?.[recurrenceKey(
  rule.originalAccountId,rule.kind==='movement'?'transfer':rule.type,rule.originalMerchant)];
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
 const p=ensure(state);
 if(!p.futureRecurrenceExclusions?.[key])throw Error('This recurrence is not currently excluded');
 delete p.futureRecurrenceExclusions[key];
 return key;
}
function stopRecurrence(state,row){
 if(!row||!['event','movement'].includes(row.kind))throw Error('Choose a recurring forecast');
 const p=ensure(state),rule=(p.futureRecurringRules||[]).find(r=>r.id===row.recurringRuleId);
 const accountId=String(rule?.originalAccountId||rule?.accountId||rule?.fromAccountId||
  row.sourceAccountId||row.accountId||row.fromAccountId||'');
 const merchant=String(rule?.originalMerchant||row.sourceMerchant||row.merchant||'');
 const type=rule?(rule.kind==='movement'?'transfer':rule.type):recurringType(row);
 if(!accountId||!sourceMerchant(merchant)||!['expense','income','refund','transfer'].includes(type))
  throw Error('This forecast has no identifiable recurring source');
 const key=recurrenceKey(accountId,type,merchant);
 p.futureRecurrenceExclusions??={};
 p.futureRecurrenceExclusions[key]={accountId,type,merchant};
 const remove=(p.futureRecurringRules||[]).filter(r=>
  String(r.originalAccountId||r.accountId||r.fromAccountId)===accountId&&
  (r.kind==='movement'?'transfer':r.type)===type&&
  sourceMerchant(r.originalMerchant||r.merchant)===sourceMerchant(merchant));
 const ids=new Set(remove.map(r=>r.id));
 p.futureRecurringRules=p.futureRecurringRules.filter(r=>!ids.has(r.id));
 const keys=new Set([row.seriesKey,...remove.map(r=>manualSeriesKey(r.id))].filter(Boolean));
 const signature=[accountId,type,sourceMerchant(merchant)].map(encodeURIComponent).join('|');
 for(const k of Object.keys(p.futureSeriesEdits||{})){
  if(keys.has(k)||k.startsWith('series|'+signature+'|'))delete p.futureSeriesEdits[k];
 }
 for(const k of Object.keys(p.futureTransactionEdits||{})){
  if(!k.startsWith('event|')&&!k.startsWith('movement|'))continue;
  let entry;try{entry=decodeURIComponent(k.split('|')[1]||'')}catch{continue}
  if([...ids].some(id=>entry.startsWith('user|'+id+'|'))||
   entry.startsWith('auto|series|'+signature+'|'))delete p.futureTransactionEdits[k];
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
function generatedRecurring(rules,asOf,through){
 const events=[],plans=[];
 for(const r of rules||[]){
  for(const d of recurrenceDates(r,asOf,through)){
   if(r.kind==='movement'){
    plans.push({id:'user|'+r.id+'|'+d,anchorDate:d,frequency:'once',
     amount:r.amount,fromAccountId:r.fromAccountId,toAccountId:r.toAccountId,
     merchant:r.merchant,seriesRuleId:r.id,source:'user-recurring'});
   }else{
    events.push({id:'user|'+r.id+'|'+d,date:d,amount:r.amount,
     merchant:r.merchant,accountId:r.accountId,type:r.type,category:'Confirmed recurring',
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
 if(kind==='event'&&event.type!==rule.originalType)return false;
 const sameName=(rule.matchNames||[]).includes(merchantKey(event.merchant));
 if(!sameName||Math.abs(Number(event.amount)-Number(rule.matchAmount))>.011)return false;
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
 const byId=new Map((rules||[]).map(r=>[r.id,r]));
 const used=new Set(),posted=(records||[]).filter(t=>!t.pending&&validDate(t.date)&&
  t.date<=asOf&&Number(t.amount)>0&&String(t.id||''));
 function covered(item,id,kind){
  const r=byId.get(id);if(!r)return false;
  const effective=kind==='movement'&&item._postedView?item._postedView:item;
  const date=String(effective.date||effective.anchorDate||item.anchorDate||''),
   account=String(kind==='movement'?effective.fromAccountId:effective.accountId);
  const type=kind==='movement'?'transfer':item.type;
  const tolerance=r.frequency==='weekly'?2:['biweekly','every-4-weeks'].includes(r.frequency)?3:6;
  const possible=posted.find(t=>!used.has(String(t.id))&&
   t.type===(kind==='event'?(r.originalType||type):type)&&
   accountRef(t.accountId||t.account,accounts)===account&&
   (r.matchNames||[]).includes(merchantKey(t.merchant))&&
   Math.min(Math.abs(Number(t.amount)-Number(r.amount)),
    Math.abs(Number(t.amount)-Number(r.matchAmount)))<.011&&
   Math.abs(daysBetween(t.date,date))<=tolerance);
  if(!possible)return false;
  used.add(String(possible.id));return true;
 }
 return {
  events:(generated.events||[]).filter(e=>!covered(e,e.ruleId,'event')),
  plans:(generated.plans||[]).filter(p=>!covered(p,p.seriesRuleId,'movement'))
 };
}
const api={ensure,keyEvent,keyMovement,normalFields,transferFields,saveEdit,skip,restore,add,removeAdded,
 seriesEvent,seriesPlan,applySeries,saveSeriesEdit,resetSeries,
 frequencies,findExamples,recurrenceDates,manualSeriesKey,defineRecurring,removeRecurring,generatedRecurring,matchesRecurring,postedCoverage,
 recurrenceKey,isNotRecurring,stopRecurrence,restoreRecurrence};
root.HouseholdPlannerTransactions=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
