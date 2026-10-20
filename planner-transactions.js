/* Editable future cash movements. Forecast-only adjustments, never bank source edits. */
(function(root){
'use strict';
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&
 new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const allowedTypes=new Set(['expense','income','refund']);
const ensure=state=>{state.predictions??={};state.predictions.futureTransactionEdits??={};
 state.predictions.futureTransactionAdds??=[];return state.predictions};
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
 if(type==='income'&&(accounts||[]).find(a=>String(a.id)===accountId)?.type==='credit')
  throw Error('For credit cards, use a refund instead of income');
 return {date,accountId,merchant:name,amount:round(amount),type};
}
function transferFields(data,accounts,asOf){
 const date=String(data.date||''),fromAccountId=String(data.fromAccountId||''),
  toAccountId=String(data.toAccountId||''),amount=Number(data.amount);
 if(!validDate(date)||date<=asOf)throw Error('Choose a future date');
 const known=ids(accounts);
 if(!known.has(fromAccountId)||!known.has(toAccountId)||fromAccountId===toAccountId)
  throw Error('Choose two different linked accounts for this transfer');
 if(!validAmount(data.amount))throw Error('Enter a positive dollar amount');
 return {date,amount:round(amount),fromAccountId,toAccountId};
}
function saveEdit(state,key,data,accounts,asOf){
 if(typeof key!=='string'||key.length>600||!(/^(event|movement)\|/.test(key)))
  throw Error('Unknown future transaction');
 const fields=key.startsWith('movement|')?transferFields(data,accounts,asOf):
  normalFields(data,accounts,asOf);
 ensure(state).futureTransactionEdits[key]=fields;return fields;
}
function skip(state,key){
 if(typeof key!=='string'||key.length>600||!(/^(event|movement)\|/.test(key)))
  throw Error('Unknown future transaction');
 ensure(state).futureTransactionEdits[key]={skipped:true};
}
function restore(state,key){delete ensure(state).futureTransactionEdits[key]}
function add(state,data,accounts,asOf){
 const transfer=data.type==='transfer';
 const fields=transfer?transferFields(data,accounts,asOf):normalFields(data,accounts,asOf);
 const record={id:'future-add|'+Date.now().toString(36)+'|'+Math.random().toString(36).slice(2,10),
  ...fields,...(transfer?{type:'transfer',merchant:'Account transfer'}:{})};
 ensure(state).futureTransactionAdds.push(record);
 return record;
}
function removeAdded(state,id){
 const p=ensure(state),index=p.futureTransactionAdds.findIndex(t=>t.id===id);
 if(index<0)throw Error('Added transaction not found');
 p.futureTransactionAdds.splice(index,1);
 delete p.futureTransactionEdits[keyMovement('plan|'+id+'|'+state.date)];
}
const api={ensure,keyEvent,keyMovement,normalFields,transferFields,saveEdit,skip,restore,add,removeAdded};
root.HouseholdPlannerTransactions=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
