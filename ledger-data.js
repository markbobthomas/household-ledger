/* Household Ledger storage contract.
 * Source transactions are not user-editable. User decisions live exclusively in
 * categoryOverrides and predictions. Future Plaid writes come from a secured API.
 */
(function(root){
'use strict';
const VERSION=2;
const copy=x=>JSON.parse(JSON.stringify(x));
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''))&&!Number.isNaN(Date.parse(String(d)+'T12:00:00Z'));
const categorySet=new Set(['Groceries','Shopping','Housing','Utilities','Transportation','Dining','Health','Entertainment','Kids & Family','Insurance','Subscriptions','Other']);
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
function migrate(input){
 const old=input&&typeof input==='object'?input:{};
 const categoryOverrides=old.categoryOverrides&&typeof old.categoryOverrides==='object'&&!Array.isArray(old.categoryOverrides)?copy(old.categoryOverrides):{};
 const predictions=old.predictions&&typeof old.predictions==='object'?copy(old.predictions):{};
 predictions.monthlyBudgets=predictions.monthlyBudgets&&typeof predictions.monthlyBudgets==='object'?predictions.monthlyBudgets:copy(old.budgets||{});
 predictions.categoryForecasts=predictions.categoryForecasts&&typeof predictions.categoryForecasts==='object'?predictions.categoryForecasts:{};
 // Kept for migration only: former undated aggregate overrides never alter dated transaction predictions.
 predictions.expectedTransactionOverrides=predictions.expectedTransactionOverrides&&typeof predictions.expectedTransactionOverrides==='object'?predictions.expectedTransactionOverrides:{};
 predictions.manualExpectedTransactions=Array.isArray(predictions.manualExpectedTransactions)?predictions.manualExpectedTransactions:[];
 predictions.cashFlowStreams=predictions.cashFlowStreams&&typeof predictions.cashFlowStreams==='object'?predictions.cashFlowStreams:{};
 predictions.cashFlowEvents=Array.isArray(predictions.cashFlowEvents)?predictions.cashFlowEvents:[];
 predictions.dailyVariable=predictions.dailyVariable===null||predictions.dailyVariable===undefined?null:Number(predictions.dailyVariable);
 const transactions=(Array.isArray(old.transactions)?old.transactions:[]).filter(t=>t&&typeof t==='object').map(t=>{
  const record=copy(t);
  // Legacy browser records have no verified bank provenance. Never badge as Plaid.
  if(!record.source||typeof record.source!=='object'){
   record.source={provider:record.demo?'demo':'legacy-unverified',providerTransactionId:String(record.id||''),accountId:String(record.accountId||record.account||''),verified:false};
  }
  return record;
 });
 return {version:VERSION,transactions,items:Array.isArray(old.items)?copy(old.items):[],categoryOverrides,predictions,
    sync:old.sync&&typeof old.sync==='object'?copy(old.sync):{plaidCursor:null}};
}
function records(state){
 return (state.transactions||[]).map(t=>({...t,category:state.categoryOverrides?.[t.id]||t.category||'Other'}));
}
function categoryFor(state,id){
 const t=(state.transactions||[]).find(x=>x.id===id);
 return t?(state.categoryOverrides?.[id]||t.category||'Other'):null;
}
function setCategory(state,id,category){
 if(!(state.transactions||[]).some(t=>t.id===id))throw Error('Unknown transaction');
 if(!categorySet.has(category))throw Error('Invalid category');
 state.categoryOverrides??={};
 const original=state.transactions.find(t=>t.id===id).category||'Other';
 if(category===original)delete state.categoryOverrides[id];else state.categoryOverrides[id]=category;
}
function setMonthlyBudget(state,category,amount){
 if(!categorySet.has(category)||!Number.isFinite(Number(amount))||Number(amount)<0)throw Error('Invalid budget');
 state.predictions.monthlyBudgets[category]=round(amount);
}
function setCategoryForecast(state,month,category,additional){
 if(!/^\d{4}-\d{2}$/.test(String(month))||!categorySet.has(category))throw Error('Invalid forecast selection');
 const key=month+'|'+category;
 if(additional===null){delete state.predictions.categoryForecasts[key];return}
 if(!Number.isFinite(Number(additional))||Number(additional)<0)throw Error('Invalid additional forecast');
 state.predictions.categoryForecasts[key]={additional:round(additional)};
}

function updateExpectedTransaction(state,id,adjustment){
 if(typeof id!=='string'||!id.startsWith('hist|')||id.length>500)throw Error('Invalid prediction ID');
 if(adjustment===null){delete state.predictions.expectedTransactionOverrides[id];return}
 if(!adjustment||!validDate(adjustment.date)||!Number.isFinite(Number(adjustment.amount))||Number(adjustment.amount)<0||typeof adjustment.enabled!=='boolean')
  throw Error('Invalid predicted transaction');
 state.predictions.expectedTransactionOverrides[id]={date:String(adjustment.date),amount:round(adjustment.amount),enabled:adjustment.enabled};
}
function saveManualExpected(state,item){
 if(!item||!categorySet.has(item.category)||!validDate(item.date)||!String(item.merchant||'').trim()||!Number.isFinite(Number(item.amount))||Number(item.amount)<0)
  throw Error('Invalid manual expected payment');
 const id=item.id&&String(item.id).startsWith('manual|')?String(item.id):'manual|'+Date.now().toString(36)+Math.random().toString(36).slice(2);
 const next={id,category:item.category,merchant:String(item.merchant).trim().slice(0,130),date:item.date,amount:round(item.amount),enabled:item.enabled!==false,source:'manual'};
 const items=state.predictions.manualExpectedTransactions;
 const i=items.findIndex(x=>x.id===id);
 if(i<0)items.push(next);else items[i]=next;
 return id;
}
function removeManualExpected(state,id){
 state.predictions.manualExpectedTransactions=state.predictions.manualExpectedTransactions.filter(x=>x.id!==id);
}
function expectedForCategory(state,detected,month,category,today){
 const limit=month+'-01',cutoff=month+'-31';
 const overrides=state.predictions.expectedTransactionOverrides||{};
 const rows=[...(detected||[]).map(x=>{
  const o=overrides[x.id];
  return {...x,date:o?.date||x.date,amount:o?.amount??x.amount,enabled:o?.enabled!==false,adjusted:Boolean(o)};
 }),...(state.predictions.manualExpectedTransactions||[]).filter(x=>x.category===category&&x.date>=limit&&x.date<=cutoff)];
 // A disabled item remains visible for review, but never inflates the forecast.
 // An edited historical prediction moved to another month stays attached to
 // its original month; the user can reset it or make a new forecast event.
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.merchant.localeCompare(b.merchant));
}

function setStreamOverride(state,key,override){
 if(typeof key!=='string'||!key||key.length>256)throw Error('Invalid forecast stream');
 if(override===null){delete state.predictions.cashFlowStreams[key];return}
 if(typeof override!=='object'||typeof override.enabled!=='boolean'||!Number.isFinite(Number(override.amount))||Number(override.amount)<0||!Number.isInteger(Number(override.day))||Number(override.day)<1||Number(override.day)>31)throw Error('Invalid stream prediction');
 state.predictions.cashFlowStreams[key]={enabled:override.enabled,amount:round(override.amount),day:Number(override.day)};
}
function setDailyVariable(state,value){
 if(value===null){state.predictions.dailyVariable=null;return}
 if(!Number.isFinite(Number(value))||Number(value)<0)throw Error('Invalid daily spending prediction');
 state.predictions.dailyVariable=round(value);
}
function saveEvent(state,event){
 if(!event||!validDate(event.date)||!['income','expense'].includes(event.type)||!Number.isFinite(Number(event.amount))||Number(event.amount)<=0||!String(event.description||'').trim())throw Error('Invalid projected event');
 const id=typeof event.id==='string'&&event.id?event.id:'prediction-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 const entry={id,date:event.date,type:event.type,amount:round(event.amount),description:String(event.description).trim().slice(0,160),accountId:String(event.accountId||'')};
 const events=state.predictions.cashFlowEvents;
 const index=events.findIndex(x=>x.id===id);
 if(index>=0)events[index]=entry;else events.push(entry);
 return id;
}
function removeEvent(state,id){state.predictions.cashFlowEvents=state.predictions.cashFlowEvents.filter(x=>x.id!==id)}
/* Future authenticated backend response only: never called from the browser edit forms.
 * Plaid amount sign: positive = money leaving this account; negative = money arriving.
 * Upsert replaces provider records on /transactions/sync updates and applies removals.
 */
function applyPlaidSync(state,change){
 if(!change||!Array.isArray(change.added)||!Array.isArray(change.modified)||!Array.isArray(change.removed))throw Error('Invalid Plaid sync batch');
 const byId=new Map((state.transactions||[]).map(t=>[t.id,t]));
 const read=t=>{
  if(!t||!t.transaction_id||!t.account_id||!validDate(t.date)||!Number.isFinite(Number(t.amount)))throw Error('Invalid provider transaction');
  const amount=Number(t.amount);
  const id='plaid:'+t.transaction_id;
  const current=byId.get(id);
  const defaultCategory=current?.category||'Other';
  const next={id,date:t.date,merchant:String(t.merchant_name||t.name||'Unknown'),description:String(t.name||''),amount:round(Math.abs(amount)),type:amount>=0?'expense':'income',category:defaultCategory,
    accountId:String(t.account_id),account:String(t.account_name||t.account_id),pending:Boolean(t.pending),
    source:{provider:'plaid',providerTransactionId:String(t.transaction_id),accountId:String(t.account_id),pendingTransactionId:t.pending_transaction_id||null,verified:true}};
  // Pending->posted often changes the transaction ID; carry a category correction forward.
  const previous=t.pending_transaction_id?'plaid:'+t.pending_transaction_id:null;
  if(previous&&state.categoryOverrides[previous]&&!state.categoryOverrides[id])state.categoryOverrides[id]=state.categoryOverrides[previous];
  byId.set(id,next);
 };
 for(const t of [...change.added,...change.modified])read(t);
 for(const r of change.removed){
  if(!r||!r.transaction_id)throw Error('Invalid provider deletion');
  byId.delete('plaid:'+r.transaction_id);
 }
 state.transactions=[...byId.values()];
 if(typeof change.nextCursor==='string')state.sync.plaidCursor=change.nextCursor;
 return state;
}
const api={VERSION,migrate,records,categoryFor,setCategory,setMonthlyBudget,setCategoryForecast,updateExpectedTransaction,saveManualExpected,removeManualExpected,expectedForCategory,setStreamOverride,setDailyVariable,saveEvent,removeEvent,applyPlaidSync};
root.HouseholdLedgerData=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
