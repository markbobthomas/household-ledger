/* Household Ledger storage contract.
 * Source transactions are not user-editable. User decisions live exclusively in
 * categoryOverrides and predictions. Future Plaid writes come from a secured API.
 */
(function(root){
'use strict';
const VERSION=3;
const Accounting=root.HouseholdAccounting||(typeof require==='function'?require('./accounting.js'):null);
const copy=x=>JSON.parse(JSON.stringify(x));
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''))&&!Number.isNaN(Date.parse(String(d)+'T12:00:00Z'));
const categorySet=new Set(['Groceries','Shopping','Housing','Utilities','Transportation','Dining','Health','Entertainment','Kids & Family','Insurance','Subscriptions','Other']);
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
function migrate(input){
 const old=input&&typeof input==='object'?input:{};
 const categoryOverrides=old.categoryOverrides&&typeof old.categoryOverrides==='object'&&!Array.isArray(old.categoryOverrides)?copy(old.categoryOverrides):{};
 const reviews=old.reviews&&typeof old.reviews==='object'&&!Array.isArray(old.reviews)?copy(old.reviews):{categoryConfirmed:{},predictionConfirmed:{}};
 reviews.categoryConfirmed=reviews.categoryConfirmed&&typeof reviews.categoryConfirmed==='object'?reviews.categoryConfirmed:{};
 reviews.predictionConfirmed=reviews.predictionConfirmed&&typeof reviews.predictionConfirmed==='object'?reviews.predictionConfirmed:{};
 const learning=old.learning&&typeof old.learning==='object'&&!Array.isArray(old.learning)?copy(old.learning):{};
 learning.categoryRules=learning.categoryRules&&typeof learning.categoryRules==='object'&&!Array.isArray(learning.categoryRules)?learning.categoryRules:{};
 learning.ruleHistory=Array.isArray(learning.ruleHistory)?learning.ruleHistory:[];
 const predictions=old.predictions&&typeof old.predictions==='object'?copy(old.predictions):{};
 predictions.monthlyBudgets=predictions.monthlyBudgets&&typeof predictions.monthlyBudgets==='object'?predictions.monthlyBudgets:copy(old.budgets||{});
 predictions.categoryForecasts=predictions.categoryForecasts&&typeof predictions.categoryForecasts==='object'?predictions.categoryForecasts:{};
 // Kept for migration only: former undated aggregate overrides never alter dated transaction predictions.
 predictions.expectedTransactionOverrides=predictions.expectedTransactionOverrides&&typeof predictions.expectedTransactionOverrides==='object'?predictions.expectedTransactionOverrides:{};
 predictions.manualExpectedTransactions=Array.isArray(predictions.manualExpectedTransactions)?predictions.manualExpectedTransactions:[];
 predictions.patternRules=predictions.patternRules&&typeof predictions.patternRules==='object'&&!Array.isArray(predictions.patternRules)?predictions.patternRules:{};
 predictions.cashFlowStreams=predictions.cashFlowStreams&&typeof predictions.cashFlowStreams==='object'?predictions.cashFlowStreams:{};
 predictions.cashFlowEvents=Array.isArray(predictions.cashFlowEvents)?predictions.cashFlowEvents:[];
 predictions.accountMovements=Array.isArray(predictions.accountMovements)?predictions.accountMovements:[];
 predictions.dailyVariable=predictions.dailyVariable===null||predictions.dailyVariable===undefined?null:Number(predictions.dailyVariable);
 const accounts=Array.isArray(old.accounts)?copy(old.accounts):[];
 const sync=old.sync&&typeof old.sync==='object'?copy(old.sync):{plaidCursor:null};
 sync.itemCursors=sync.itemCursors&&typeof sync.itemCursors==='object'&&!Array.isArray(sync.itemCursors)?sync.itemCursors:{};
 const transactions=(Array.isArray(old.transactions)?old.transactions:[]).filter(t=>t&&typeof t==='object').map(t=>{
  const record=copy(t);
  // Legacy browser records have no verified bank provenance. Never badge as Plaid.
  if(!record.source||typeof record.source!=='object'){
   record.source={provider:record.demo?'demo':'legacy-unverified',providerTransactionId:String(record.id||''),accountId:String(record.accountId||record.account||''),verified:false};
  }
  return record;
 });
 return {version:VERSION,transactions,accounts,items:Array.isArray(old.items)?copy(old.items):[],categoryOverrides,predictions,reviews,learning,sync};
}
// Category learning never edits authoritative ledger rows. A learned rule can
// automatically resolve an unclassified/low-confidence transaction only when
// the merchant is safe for a repeated single category and evidence agrees.
const mixedUse=/\b(amazon|walmart|costco|target|home depot|lowe'?s|ebay|etsy|paypal|venmo|square|stripe|apple|google|general store|marketplace)\b/i;
const merchantKey=s=>String(s||'').toLowerCase().trim().replace(/\s+/g,' ').replace(/(?:\s*[-#*]\s*\d{3,})$/,'');
const accountKey=t=>String(t.accountId||t.account||'Unknown');
const categoryRuleKey=t=>[accountKey(t),merchantKey(t.merchant),t.type||'expense'].map(encodeURIComponent).join('|');
const numericCategoryConfidence=t=>{
 const n=Number(t?.categoryConfidence??t?.category_confidence??t?.source?.categoryConfidence);
 return Number.isFinite(n)&&n>=0&&n<=1?n:null;
};
function categoryRuleSafety(state,t){
 const related=(state.transactions||[]).filter(row=>row.type==='expense'&&categoryRuleKey(row)===categoryRuleKey(t));
 const categories=new Set(related.map(x=>state.categoryOverrides?.[x.id]||x.category).filter(x=>x&&x!=='Other'));
 const mixed=mixedUse.test(t.merchant)||categories.size>1;
 return {mixed,count:related.length,distinctCategories:categories.size,
  cause:mixedUse.test(t.merchant)?'Multi-purpose merchant':categories.size>1?'Conflicting past categories':'Consistent merchant history'};
}
function resolution(state,t){
 const explicit=state.categoryOverrides?.[t.id];
 if(explicit)return {category:explicit,method:'manual',confidence:'Confirmed',ruleKey:null};
 const original=t.category||'Other';
 const key=categoryRuleKey(t),rule=state.learning?.categoryRules?.[key];
 if(!rule||t.type!=='expense')return {category:original,method:'source',confidence:'Source',ruleKey:null};
 const safety=categoryRuleSafety(state,t);
 const applicable=original==='Other'||(numericCategoryConfidence(t)!==null&&numericCategoryConfidence(t)<.7);
 const safe=rule.mode==='auto'&&!safety.mixed&&applicable;
 // Never overwrite a specific provider category with high/unknown confidence.
 if(safe)return {category:rule.category,method:'learned',confidence:'User rule',ruleKey:key,
  explanation:'Learned from your review of '+rule.merchant};
 return {category:original,method:rule.mode==='suggest'||safety.mixed?'suggested':'source',
  confidence:rule.mode==='suggest'?'Review recommended':'Source',ruleKey:key,
  suggested:rule.category,conflict:original!=='Other'&&original!==rule.category,
  explanation:safety.mixed?safety.cause:original!=='Other'?'Original category preserved':'Rule awaiting review'};
}
function records(state){
 return Accounting.reconcile(state).transactions.map(t=>({...t,...resolution(state,t),originalCategory:t.category||'Other'}));
}
function categoryFor(state,id){
 const t=(state.transactions||[]).find(x=>x.id===id);
 return t?resolution(state,t).category:null;
}
function learnCategory(state,id,category,remember=true){
 const t=(state.transactions||[]).find(x=>x.id===id);
 if(!t||t.type!=='expense')throw Error('Unknown expense transaction');
 if(!categorySet.has(category)||category==='Other')throw Error('Choose a specific category before learning a rule');
 if(!remember)return null;
 state.learning??={categoryRules:{},ruleHistory:[]};
 state.learning.categoryRules??={};state.learning.ruleHistory??=[];
 const key=categoryRuleKey(t),safety=categoryRuleSafety(state,t);
 const mode=safety.mixed?'suggest':'auto';
 const previous=state.learning.categoryRules[key];
 const next={category,mode,merchant:String(t.merchant||''),account:accountKey(t),
   sourceId:id,createdAt:new Date().toISOString(),count:safety.count,reason:safety.cause,
   previousCategory:previous?.category||null};
 state.learning.categoryRules[key]=next;
 state.learning.ruleHistory.push({key,action:'learn',category,mode,date:next.createdAt});
 if(state.learning.ruleHistory.length>150)state.learning.ruleHistory=state.learning.ruleHistory.slice(-150);
 return {key,...next};
}
function removeCategoryRule(state,key){
 if(!state.learning?.categoryRules?.[key])return false;
 const old=state.learning.categoryRules[key];
 delete state.learning.categoryRules[key];
 state.learning.ruleHistory??=[];
 state.learning.ruleHistory.push({key,action:'removed',category:old.category,date:new Date().toISOString()});
 return true;
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

function setPatternRule(state,key,rule){
 if(typeof key!=='string'||!key||key.length>600)throw Error('Invalid pattern key');
 state.predictions.patternRules??={};
 const clearForecastEdits=()=>{
  const parts=key.split('|');
  if(parts.length!==4)return;
  for(const id of Object.keys(state.predictions.expectedTransactionOverrides||{})){
   const p=id.split('|');
   if(p[0]==='hist'&&p.length>=6&&p[2]===parts[1]&&p[3]===parts[2]&&p[4]===parts[3])
    delete state.predictions.expectedTransactionOverrides[id];
  }
 };
 if(rule===null){clearForecastEdits();delete state.predictions.patternRules[key];return}
 if(!rule||!['none','monthly','trust','schedule'].includes(rule.mode))throw Error('Invalid recurrence decision');
 if(rule.mode==='none'){state.predictions.patternRules[key]={mode:'none'};return}
 if(rule.mode==='schedule'){
  const allowed=['weekly','biweekly','monthly','quarterly','semiannual','annual'];
  const anchorDate=String(rule.anchorDate||'');
  const day=Number(rule.day),amount=Number(rule.amount);
  if(!allowed.includes(rule.frequency)||!validDate(anchorDate)||
     !Number.isInteger(day)||day<1||day>31||
     !Number.isFinite(amount)||amount<=0||amount>999999999)
    throw Error('Choose a valid recurring frequency, starting date, day and amount');
  clearForecastEdits();
  const isTransfer=key.split('|')[0]==='transfer';
  const cashDirection=isTransfer?rule.cashDirection:null;
  if(isTransfer&&!['in','out'].includes(cashDirection))
   throw Error('Choose whether the recurring transfer moves money into or out of this account');
  state.predictions.patternRules[key]={mode:'schedule',frequency:rule.frequency,anchorDate,
   day,amount:round(amount),...(isTransfer?{cashDirection}:{}),source:'activity'};
  return;
 }
 if(rule.mode==='trust'){
  if(typeof rule.cadence!=='string'||!['weekly','every 2 weeks','monthly','twice monthly','quarterly','semiannual','annual','3 / month','4 / month','5 / month'].includes(rule.cadence)||
     !Number.isFinite(Number(rule.amount))||Number(rule.amount)<=0||
     !Number.isInteger(Number(rule.day))||Number(rule.day)<1||Number(rule.day)>31)
     throw Error('Invalid confirmed recurrence');
  state.predictions.patternRules[key]={mode:'trust',cadence:rule.cadence,day:Number(rule.day),
    amount:round(rule.amount),confirmedAt:new Date().toISOString(),source:'review'};
  return;
 }
 if(!Number.isInteger(Number(rule.day))||Number(rule.day)<1||Number(rule.day)>31||
   !Number.isFinite(Number(rule.amount))||Number(rule.amount)<=0)throw Error('Invalid recurring amount or date');
 clearForecastEdits();
 state.predictions.patternRules[key]={mode:'monthly',day:Number(rule.day),amount:round(rule.amount)};
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
/* Future paired movements are forecast-only. Never duplicate these inside source transactions. */
function saveAccountMovement(state,item){
 const from=String(item?.fromAccountId||''),to=String(item?.toAccountId||'');
 const amount=Number(item?.amount),anchorDate=String(item?.anchorDate||item?.date||'');
 const frequency=String(item?.frequency||'once'),day=Number(item?.day||anchorDate.slice(8,10));
 if(!from||!to||from===to||from.length>200||to.length>200||
  !validDate(anchorDate)||!['once','weekly','biweekly','monthly','quarterly','semiannual','annual'].includes(frequency)||
  !(amount>0)||!Number.isFinite(amount)||amount>999999999||!Number.isInteger(day)||day<1||day>31)
  throw Error('Choose two different accounts, valid date, frequency and positive amount');
 const status=String(item.status||'scheduled'),reversalDate=String(item.reversalDate||'');
 if(!['scheduled','cancelled','returned'].includes(status)||
   status==='returned'&&(frequency!=='once'||!validDate(reversalDate)||reversalDate<anchorDate))
  throw Error('A returned payment needs one payment and its reversal date');
 const id=item.id&&String(item.id).startsWith('movement|')?String(item.id):
  'movement|'+Date.now().toString(36)+Math.random().toString(36).slice(2);
 const record={id,fromAccountId:from,toAccountId:to,anchorDate,frequency,day,amount:round(amount),
  status,...(status==='returned'?{reversalDate}:{})};
 state.predictions.accountMovements??=[];
 const i=state.predictions.accountMovements.findIndex(m=>m.id===id);
 if(i<0)state.predictions.accountMovements.push(record);else state.predictions.accountMovements[i]=record;
 return id;
}
function removeAccountMovement(state,id){
 state.predictions.accountMovements=(state.predictions.accountMovements||[]).filter(x=>x.id!==id);
}
/* Future authenticated backend response only: never called from the browser edit forms.
 * Plaid amount sign: positive = money leaving this account; negative = money arriving.
 * Upsert replaces provider records on /transactions/sync updates and applies removals.
 */
function applyPlaidSync(state,change){
 if(!change||!Array.isArray(change.added)||!Array.isArray(change.modified)||!Array.isArray(change.removed))
  throw Error('Invalid Plaid sync batch');
 // Stage the entire provider mutation, including account metadata and the
 // next cursor. A failed page must leave the committed ledger bit-for-bit intact.
 const staged=copy(state),itemId=String(change.itemId||'');
 if(itemId&&change.hasMore===true&&!change.__pageBatch)
  throw Error('Incomplete Plaid Item updates must use applyPlaidSyncPages');
 // Never reassign an institution's account ID to a different Plaid Item.
 if(itemId&&Array.isArray(change.accounts))
  for(const raw of change.accounts){
   const id=String(raw.account_id||raw.id||'');
   const original=(state.accounts||[]).find(a=>a.id===id);
   if(original?.itemId&&original.itemId!==itemId)
    throw Error('Duplicate account ID across Plaid Items');
  }
 staged.sync??={plaidCursor:null,itemCursors:{}};
 staged.sync.itemCursors??={};
 if(Array.isArray(change.accounts))
  Accounting.registerAccounts(staged,change.accounts.map(a=>({...a,itemId:a.itemId||a.item_id||itemId})));
 const byId=new Map((staged.transactions||[]).map(t=>[t.id,t]));
 const providerId=id=>'plaid:'+(itemId?itemId+':':'')+String(id);
 const read=t=>{
  if(!t||!t.transaction_id||!t.account_id||!validDate(t.date)||
   t.amount===null||t.amount===undefined||!Number.isFinite(Number(t.amount)))
   throw Error('Invalid provider transaction');
  const amount=Number(t.amount),id=providerId(t.transaction_id);
  const current=byId.get(id),defaultCategory=current?.category||'Other';
  const meta=(staged.accounts||[]).find(a=>a.id===String(t.account_id));
  if(itemId&&meta?.itemId&&meta.itemId!==itemId)
   throw Error('Account belongs to a different Plaid Item');
  const next={id,date:t.date,merchant:String(t.merchant_name||t.name||'Unknown'),
   description:String(t.name||''),amount:round(Math.abs(amount)),
   type:amount>=0?'expense':'income',category:defaultCategory,
   accountId:String(t.account_id),account:String(meta?.name||t.account_name||t.account_id),
   pending:Boolean(t.pending),source:{provider:'plaid',providerTransactionId:String(t.transaction_id),
    accountId:String(t.account_id),itemId:itemId||null,plaidAmount:amount,
    pendingTransactionId:t.pending_transaction_id||null,verified:true}};
  const previous=t.pending_transaction_id?providerId(t.pending_transaction_id):null;
  if(previous&&staged.categoryOverrides?.[previous]&&!staged.categoryOverrides[id])
   staged.categoryOverrides[id]=staged.categoryOverrides[previous];
  if(previous)byId.delete(previous);
  byId.set(id,next);
 };
 for(const t of [...change.added,...change.modified])read(t);
 for(const r of change.removed){
  if(!r||!r.transaction_id)throw Error('Invalid provider deletion');
  byId.delete(providerId(r.transaction_id));
 }
 staged.transactions=[...byId.values()];
 if(typeof change.nextCursor==='string'){
  if(itemId)staged.sync.itemCursors[itemId]=change.nextCursor;
  else staged.sync.plaidCursor=change.nextCursor;
 }
 Object.assign(state,staged);
 return state;
}
/* Atomic, fully paginated /transactions/sync handoff. The server must fetch
 * every page before persisting a completed Item cursor; never publish partial
 * provider updates after a failed page, interrupted sync or malformed cursor.
 */
function applyPlaidSyncPages(state,batch){
 if(!batch||!String(batch.itemId||'')||!Array.isArray(batch.pages)||!batch.pages.length)
  throw Error('Completed Plaid Item sync requires an Item ID and pages');
 const staged=copy(state);
 batch.pages.forEach((page,i)=>{
  if(!page||typeof page.nextCursor!=='string'||!page.nextCursor)
   throw Error('Plaid sync page is missing its cursor');
  const last=i===batch.pages.length-1;
  if(last&&page.hasMore!==false||!last&&page.hasMore!==true)
   throw Error('Plaid Item update is incomplete or pages are inconsistent');
  applyPlaidSync(staged,{...page,itemId:batch.itemId,__pageBatch:true,
   ...(i===0&&Array.isArray(batch.accounts)?{accounts:batch.accounts}:{})});
 });
 Object.assign(state,staged);
 return state;
}
const api={VERSION,migrate,records,accountsFor:Accounting.accountsFor,registerAccounts:Accounting.registerAccounts,accountingView:Accounting.reconcile,categoryFor,resolution,categoryRuleKey,categoryRuleSafety,learnCategory,removeCategoryRule,setCategory,setMonthlyBudget,setCategoryForecast,setPatternRule,updateExpectedTransaction,saveManualExpected,removeManualExpected,expectedForCategory,setStreamOverride,setDailyVariable,saveEvent,removeEvent,saveAccountMovement,removeAccountMovement,applyPlaidSync,applyPlaidSyncPages};
root.HouseholdLedgerData=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
