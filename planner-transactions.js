/* Editable future cash movements. Forecast-only adjustments, never bank source edits. */
(function(root){
'use strict';
const validDate=s=>{const text=String(s||''),parsed=new Date(text+'T12:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===text;};
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const allowedTypes=new Set(['expense','income','refund','transfer']);
const ensure=state=>{state.predictions??={};state.predictions.futureTransactionEdits??={};
 state.predictions.futureTransactionAdds??=[];state.predictions.futureSeriesEdits??={};return state.predictions};
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
 if(!validDate(baseDate)||baseDate<=asOf)throw Error('Select a future recurring payment');
 const fields=kind==='movement'?transferFields(data,accounts,asOf):normalFields(data,accounts,asOf);
 const supported=['monthly','quarterly','semiannual','annual','weekly','every 2 weeks','biweekly','twice monthly','3 / month','4 / month','5 / month'];
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
const api={ensure,keyEvent,keyMovement,normalFields,transferFields,saveEdit,skip,restore,add,removeAdded,
 seriesEvent,seriesPlan,applySeries,saveSeriesEdit,resetSeries};
root.HouseholdPlannerTransactions=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
