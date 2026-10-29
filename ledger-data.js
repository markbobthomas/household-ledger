/* Household Ledger storage contract.
 * Source transactions are not user-editable. User decisions live exclusively in
 * categoryOverrides and predictions. Future Plaid writes come from a secured API.
 */
(function(root){
'use strict';
const VERSION=3;
const Accounting=root.HouseholdAccounting||(typeof require==='function'?require('./accounting.js'):null);
const Categorization=root.HouseholdCategorization||(typeof require==='function'?require('./categorization.js'):null);
const copy=x=>JSON.parse(JSON.stringify(x));
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''))&&!Number.isNaN(Date.parse(String(d)+'T12:00:00Z'));
// The ONE category registry for History, Scheduled, Calendar editors and Review.
// Legacy singular spellings are aliases, not separate selectable categories.
// Each assignment stores only a name; custom definitions are saved exactly once
// under predictions.scheduleCategories with the other planning preferences.
const categorySet=new Set(['Uncategorized','Groceries','Shopping','Housing','Mortgage','Rent',
 'Utility','Transportation','Dining','Health','Healthcare','Entertainment','Kids & Family',
 'Childcare','Insurance','Subscriptions','Loan','Tax','Income','Savings','Transfer','Other']);
const aliases=Object.freeze({utility:'Utility',utilities:'Utility',subscription:'Subscriptions'});
const builtinsByName=new Map([...categorySet].map(name=>[name.toLocaleLowerCase(),name]));
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const validCustomName=s=>typeof s==='string'&&s===s.trim()&&s.length>=2&&s.length<=40&&
 /^[\p{L}\p{N}][\p{L}\p{N} &\/().,+'-]*$/u.test(s);
const normalizeCategory=name=>{
 const value=String(name||'').trim().replace(/\s+/g,' ');
 if(!value)return '';
 return aliases[value.toLocaleLowerCase()]||builtinsByName.get(value.toLocaleLowerCase())||value;
};
function dedupeCategoryNames(names){
 const all=[],seen=new Set();
 for(const name of names){
  if(typeof name!=='string')continue;
  const value=normalizeCategory(name),key=value.toLocaleLowerCase();
  if(!validCustomName(value)||seen.has(key))continue;
  seen.add(key);all.push(value);
 }
 return all;
}
// Deleted names stay hidden even if immutable provider records still use them.
// "Uncategorized" is the internal Unassigned status, not a named category.
const removedCategory=(state,name)=>Array.isArray(state?.predictions?.deletedCategories)&&
 state.predictions.deletedCategories.some(c=>normalizeCategory(c).toLowerCase()===normalizeCategory(name).toLowerCase());
function categories(state,observed=[]){
 const saved=state?.predictions?.scheduleCategories||[];
 const assigned=[
  ...(state?.predictions?.futureRecurringRules||[]).map(r=>r?.category),
  ...(state?.transactions||[]).map(t=>t?.category),
  ...Object.values(state?.categoryOverrides||{}),
  ...Object.values(state?.learning?.categoryRules||{}).map(r=>r?.category)
 ];
 return dedupeCategoryNames([...categorySet,...(Array.isArray(saved)?saved:[]),
  ...(Array.isArray(state?.customCategories)?state.customCategories:[]),
  ...(Array.isArray(observed)?observed:[]),...assigned])
  .filter(c=>c==='Uncategorized'||!removedCategory(state,c));
}
function canonicalCategory(state,name){
 const requested=normalizeCategory(name);
 return categories(state).find(c=>c.toLocaleLowerCase()===requested.toLocaleLowerCase())||'';
}
const isCategory=(state,name)=>Boolean(canonicalCategory(state,name));
function addCategory(state,name){
 const value=normalizeCategory(name);
 if(!validCustomName(value))throw Error('Category must be 2–40 letters/numbers and ordinary punctuation');
 if(value==='Uncategorized')throw Error('Unassigned is a status, not a named category');
 if(isCategory(state,value))throw Error('Category already exists');
 state.predictions??={};
 if(removedCategory(state,value)){
  state.predictions.deletedCategories=state.predictions.deletedCategories.filter(c=>
   normalizeCategory(c).toLowerCase()!==value.toLowerCase());
  if(categorySet.has(value))return value;
 }
 const saved=state.predictions.scheduleCategories??=[];
 if(!Array.isArray(saved)||saved.length>=100)throw Error('Category limit reached');
 saved.push(value);
 return value;
}

// Category deletion affects only classification overlays and saved preferences;
// never edit bank source transactions, their amounts, account links or dates.
// Bank income and transfers are displayed under their known transaction type
// when the source category is Other. Treat that display category as assigned
// for deletion, while preserving the original bank record.
const kindDisplayCategory=(t,category)=>{
 if(!['Other','Uncategorized',''].includes(String(category||'Other')))return null;
 return t.type==='income'?'Income':t.type==='transfer'?'Transfer':null;
};
function removeCategory(state,name){
 const category=canonicalCategory(state,name);
 if(!category||category==='Uncategorized')throw Error('Category is not available');
 state.predictions??={};
 const p=state.predictions,target=category.toLowerCase(),
  same=v=>normalizeCategory(v).toLowerCase()===target,
  affected=(state.transactions||[]).filter(t=>{
   const category=categoryFor(state,t.id);
   return same(category)||(!state.categoryOverrides?.[t.id]&&
    same(kindDisplayCategory(t,category)));
  }).map(t=>t.id);
 state.categoryOverrides??={};
 for(const id of affected)state.categoryOverrides[id]='Uncategorized';
 for(const [id,value] of Object.entries(state.categoryOverrides))
  if(same(value))state.categoryOverrides[id]='Uncategorized';
 const update=(value,depth=0)=>{
  if(!value||typeof value!=='object'||depth>18)return;
  if(Array.isArray(value)){for(const item of value)update(item,depth+1);return}
  if(Object.prototype.hasOwnProperty.call(value,'category')&&same(value.category)){
   value.category='Uncategorized';
   value.categoryReviewed=false;
  }
  for(const [key,item] of Object.entries(value)){
   if(['deletedCategories','scheduleCategories','categoryMonthlyBudgets','monthlyBudgets',
    'categoryForecasts'].includes(key))continue;
   if(item&&typeof item==='object')update(item,depth+1);
  }
 };
 update(p);
 p.scheduleCategories=(Array.isArray(p.scheduleCategories)?p.scheduleCategories:[]).filter(c=>!same(c));
 p.deletedCategories=dedupeCategoryNames([...(p.deletedCategories||[]),category]);
 for(const key of ['categoryMonthlyBudgets','monthlyBudgets']){
  if(!p[key]||typeof p[key]!=='object')continue;
  for(const k of Object.keys(p[key]))if(same(k))delete p[key][k];
 }
 if(p.categoryForecasts&&typeof p.categoryForecasts==='object')
  for(const k of Object.keys(p.categoryForecasts))
   if(same(k.slice(k.indexOf('|')+1)))delete p.categoryForecasts[k];
 state.learning??={categoryRules:{},ruleHistory:[]};
 state.learning.categoryRules??={};
 for(const [key,rule] of Object.entries(state.learning.categoryRules))
  if(same(rule.category))removeCategoryRule(state,key);
 return category;
}
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
 // Read both historical category stores once, deduplicate and retain their
 // definitions solely in the existing encrypted forecast-preferences store.
 // This is an in-memory migration; importing never alters actual bank facts.
 predictions.scheduleCategories=dedupeCategoryNames([
  ...(Array.isArray(predictions.scheduleCategories)?predictions.scheduleCategories:[]),
  ...(Array.isArray(old.customCategories)?old.customCategories:[])
 ]).filter(name=>!categorySet.has(name));
 predictions.deletedCategories=dedupeCategoryNames(
  Array.isArray(predictions.deletedCategories)?predictions.deletedCategories:[])
  .filter(name=>name!=='Uncategorized');
 predictions.monthlyBudgets=predictions.monthlyBudgets&&typeof predictions.monthlyBudgets==='object'?predictions.monthlyBudgets:copy(old.budgets||{});
 predictions.categoryForecasts=predictions.categoryForecasts&&typeof predictions.categoryForecasts==='object'?predictions.categoryForecasts:{};
 // Kept for migration only: former undated aggregate overrides never alter dated transaction predictions.
 predictions.expectedTransactionOverrides=predictions.expectedTransactionOverrides&&typeof predictions.expectedTransactionOverrides==='object'?predictions.expectedTransactionOverrides:{};
 predictions.manualExpectedTransactions=Array.isArray(predictions.manualExpectedTransactions)?predictions.manualExpectedTransactions:[];
 predictions.patternRules=predictions.patternRules&&typeof predictions.patternRules==='object'&&!Array.isArray(predictions.patternRules)?predictions.patternRules:{};
 predictions.cashFlowStreams=predictions.cashFlowStreams&&typeof predictions.cashFlowStreams==='object'?predictions.cashFlowStreams:{};
 predictions.cashFlowEvents=Array.isArray(predictions.cashFlowEvents)?predictions.cashFlowEvents:[];
 predictions.accountMovements=Array.isArray(predictions.accountMovements)?predictions.accountMovements:[];
 predictions.paymentRules=predictions.paymentRules&&typeof predictions.paymentRules==='object'&&!Array.isArray(predictions.paymentRules)?predictions.paymentRules:{};
 predictions.paymentBills=Array.isArray(predictions.paymentBills)?predictions.paymentBills:[];
 predictions.cashCushion=Number.isFinite(Number(predictions.cashCushion))&&Number(predictions.cashCushion)>=0?Number(predictions.cashCushion):500;
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
 return {version:VERSION,transactions,accounts,items:Array.isArray(old.items)?copy(old.items):[],categoryOverrides,predictions,reviews,learning,sync,customCategories:[]};
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
// Only build this derived index when resolving a full history with learned
// rules. A one-off category lookup still calculates from current source facts.
function categorySafetyIndex(state){
 const grouped=new Map();
 for(const t of state.transactions||[]){
  if(t.type!=='expense')continue;
  const key=categoryRuleKey(t);
  if(!grouped.has(key))grouped.set(key,{count:0,categories:new Set()});
  const group=grouped.get(key),category=state.categoryOverrides?.[t.id]||t.category;
  group.count++;
  if(category&&category!=='Other')group.categories.add(category);
 }
 return grouped;
}
function categoryRuleSafety(state,t,index){
 const stored=index?.get(categoryRuleKey(t));
 const related=index?null:(state.transactions||[]).filter(row=>
  row.type==='expense'&&categoryRuleKey(row)===categoryRuleKey(t));
 const categories=index?(stored?.categories||new Set()):
  new Set(related.map(x=>state.categoryOverrides?.[x.id]||x.category).filter(x=>x&&x!=='Other'));
 const mixed=mixedUse.test(t.merchant)||categories.size>1;
 return {mixed,count:index?(stored?.count||0):related.length,distinctCategories:categories.size,
  cause:mixedUse.test(t.merchant)?'Multi-purpose merchant':categories.size>1?'Conflicting past categories':'Consistent merchant history'};
}
function resolution(state,t,index){
 const explicit=state.categoryOverrides?.[t.id];
 if(explicit==='Uncategorized'||explicit&&removedCategory(state,explicit))
  return {category:'Uncategorized',method:'unassigned',confidence:'Needs review',ruleKey:null};
 if(explicit)return {category:explicit,method:'manual',confidence:'Confirmed',ruleKey:null};
 const original=t.category||'Other';
 if(removedCategory(state,original))
  return {category:'Uncategorized',method:'unassigned',confidence:'Needs review',ruleKey:null};
 // Re-evaluate old Plaid mortgage rows even if an earlier import mislabeled
 // the loan withdrawal as a transfer. Keep the original bank record unchanged.
 const legacyMortgage=t.source?.provider==='plaid'&&t.type==='transfer'&&
  Categorization.loanBill?.(t)?.isMortgage&&Number(t.source?.plaidAmount)>0;
 const bankCategory=t.source?.provider==='plaid'&&
  (['expense','refund'].includes(t.type)||legacyMortgage)?
  Categorization.classify(t):null;
 const inferred=original==='Other'&&bankCategory?.category&&bankCategory.category!=='Other'?bankCategory.category:original;
 const origin=original!=='Other'&&t.source?.provider==='plaid'?
  t.source?.categoryOrigin||'plaid-category':bankCategory?.method||'source';
 const originLabel=origin==='plaid-category'?'Plaid category':
  origin==='merchant-match'?'Merchant match':'Source';
 if(removedCategory(state,inferred)||removedCategory(state,kindDisplayCategory(t,inferred)))
  return {category:'Uncategorized',method:'unassigned',confidence:'Needs review',ruleKey:null};
 const key=categoryRuleKey(t),rule=state.learning?.categoryRules?.[key];
 if(!rule||t.type!=='expense'||removedCategory(state,rule.category))return {category:inferred,method:origin,
  confidence:originLabel,ruleKey:null};
 const safety=categoryRuleSafety(state,t,index);
 const applicable=original==='Other'||(numericCategoryConfidence(t)!==null&&numericCategoryConfidence(t)<.7);
 const safe=rule.mode==='auto'&&!safety.mixed&&applicable;
 // Never overwrite a specific provider category with high/unknown confidence.
 if(safe)return {category:rule.category,method:'learned',confidence:'User rule',ruleKey:key,
  explanation:'Learned from your review of '+rule.merchant};
 return {category:inferred,method:rule.mode==='suggest'||safety.mixed?'suggested':origin,
  confidence:rule.mode==='suggest'?'Review recommended':originLabel,ruleKey:key,
  suggested:rule.category,conflict:inferred!=='Other'&&inferred!==rule.category,
  explanation:safety.mixed?safety.cause:inferred!=='Other'?'Original category preserved':'Rule awaiting review'};
}
function records(state){
 const learned=state.learning?.categoryRules||{};
 const index=Object.keys(learned).length?categorySafetyIndex(state):null;
 return Accounting.reconcile(state).transactions.map(t=>({...t,...resolution(state,t,index),originalCategory:t.category||'Other'}));
}
// The same category registry and manual overrides serve Bank History and Review.
// A category that only came from low-confidence provider/merchant evidence stays
// reviewable until its specific choice is explicitly saved. No bank row is edited.
const missingCategory=c=>!c||['Other','Uncategorized'].includes(String(c));
const confidenceScore=t=>{
 const raw=t?.categoryConfidence??t?.category_confidence??t?.source?.categoryConfidence;
 if(raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(Number(raw)))return Number(raw);
 const p=t?.personal_finance_category||t?.personalFinanceCategory||
  t?.source?.personalFinanceCategory||t?.source?.personal_finance_category||{};
 const level=String(p.confidence_level||p.confidenceLevel||'').toUpperCase();
 return ({VERY_HIGH:.99,HIGH:.93,MEDIUM:.75,LOW:.4,UNKNOWN:0})[level]??null;
};
function categoryReviewQueue(state){
 const tx=records(state).filter(t=>!t.pending&&t.id!==null&&t.id!==undefined)
  .map(t=>{
   // Known income/transfer kinds are safe to label in reporting without
   // changing the authoritative bank-derived record used for forecasting.
   const knownKind=(t.type==='income'||t.type==='transfer')&&t.method!=='unassigned',
    category=knownKind&&missingCategory(t.category)?
     (t.type==='income'?'Income':'Transfer'):
     String(t.category||'Other'),
    manual=knownKind||Boolean(state.categoryOverrides?.[t.id]&&state.categoryOverrides[t.id]!=='Uncategorized')||
     ['manual','learned'].includes(t.method),
    // An explicitly saved Other category is a reviewed choice, not a gap.
    missing=missingCategory(category)&&!manual,
    score=confidenceScore(t),
    low=!manual&&(score!==null&&score<.7||
     ['merchant-match','suggested','unclassified'].includes(t.method)||
     ['merchant-match','unclassified'].includes(t.source?.categoryOrigin));
   if(!missing&&!low)return null;
   return {kind:'transaction',id:String(t.id),category,reason:missing?'Missing category':'Low-confidence automatic category',
    merchant:String(t.merchant||t.description||'Transaction'),date:String(t.date||''),
    amount:Number(t.amount)||0,accountId:String(t.accountId||t.account||''),
     suggested:t.suggested&&t.suggested!==category?String(t.suggested):null};
  }).filter(Boolean).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 const prefs=state.predictions||{},plans=[];
 const add=(rows,kind)=>{
  for(const row of rows||[]){
   if(!row||row.id===undefined||row.id===null||row.enabled===false)continue;
   const category=String(row.category||'Uncategorized'),
    missing=missingCategory(category)&&!row.categoryReviewed,
    low=!row.categoryReviewed&&Number.isFinite(Number(row.categoryConfidence))&&
     row.categoryConfidence!==null&&row.categoryConfidence!==''&&Number(row.categoryConfidence)<.7;
   if(!missing&&!low)continue;
   plans.push({kind,id:String(row.id),category,reason:missing?'Missing category':'Low-confidence automatic category',
    merchant:String(row.scheduleLabel||row.merchant||row.name||'Planned payment'),
    date:String(row.anchorDate||row.date||''),amount:Number(row.amount)||0});
  }
 };
 add(prefs.futureRecurringRules,'schedule');
 add(prefs.futureTransactionAdds,'oneoff');
 add(prefs.paymentBills,'bill');
 return {transactions:tx,plans};
}
function categoryFor(state,id){
 const t=(state.transactions||[]).find(x=>x.id===id);
 return t?resolution(state,t).category:null;
}
function learnCategory(state,id,category,remember=true){
 const t=(state.transactions||[]).find(x=>x.id===id);
 if(!t||t.type!=='expense')throw Error('Unknown expense transaction');
 if(!isCategory(state,category)||category==='Other')throw Error('Choose a specific category before learning a rule');
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
function setCategory(state,id,category,confirm=false){
 if(!(state.transactions||[]).some(t=>t.id===id))throw Error('Unknown transaction');
 const value=canonicalCategory(state,category);
 if(!value)throw Error('Invalid category');
 state.categoryOverrides??={};
 const original=canonicalCategory(state,state.transactions.find(t=>t.id===id).category||'Other');
 if(value===original&&!confirm&&value!=='Uncategorized')delete state.categoryOverrides[id];
 else state.categoryOverrides[id]=value;
}
function setMonthlyBudget(state,category,amount){
 if(!isCategory(state,category)||!Number.isFinite(Number(amount))||Number(amount)<0)throw Error('Invalid budget');
 state.predictions.monthlyBudgets[category]=round(amount);
}
function setCategoryForecast(state,month,category,additional){
 if(!/^\d{4}-\d{2}$/.test(String(month))||!isCategory(state,category))throw Error('Invalid forecast selection');
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
 if(!item||!isCategory(state,item.category)||!validDate(item.date)||!String(item.merchant||'').trim()||!Number.isFinite(Number(item.amount))||Number(item.amount)<0)
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
 const automatic=(detected||[]).map(x=>{
  const o=overrides[x.id];
  return {...x,date:o?.date||x.date,amount:o?.amount??x.amount,enabled:o?.enabled!==false,adjusted:Boolean(o)};
 });
 const manual=(state.predictions.manualExpectedTransactions||[])
  .filter(x=>x.category===category&&x.date>=limit&&x.date<=cutoff).map(x=>({...x}));
 // Existing manually scheduled bills must not start counting twice merely
 // because enough new bank history now supports an automatic recurrence.
 // Suppress only an unambiguous same-merchant / same-mortgage match.
 const normalized=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const mortgage=s=>/\b(?:mortgage|mtg|home\s+loan|pennymac|loandepot|newrez|shellpoint|mr\s+cooper)\b/i.test(String(s||''));
 for(const owner of manual.filter(x=>x.enabled!==false)){
  const candidates=automatic.filter(x=>x.enabled!==false&&validDate(x.date)&&
   Math.abs(Date.parse(x.date)-Date.parse(owner.date))<=6*86400000&&
   (normalized(x.merchant)===normalized(owner.merchant)||
     category==='Housing'&&mortgage(x.merchant)&&mortgage(owner.merchant)));
  if(candidates.length===1){
   candidates[0].enabled=false;
   candidates[0].suppressedBy=owner.id;
   candidates[0].suppressionReason='An existing manual prediction already covers this recurring bill';
  }
 }
 const rows=[...automatic,...manual];
 // A disabled or automatically suppressed item remains visible for review,
 // but never inflates Budget or the account cash forecast.
 // An edited historical prediction moved to another month stays attached to
 // its original month; the user can reset it or make a new forecast event.
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.merchant.localeCompare(b.merchant));
}

/* A recurrence belongs to the account and merchant, not to a calendar month
 * or the historical spending category. Preserve existing four-part keys while
 * resolving an older category to the one saved schedule. */
function recurringRuleKey(state,type,category,account,merchant){
 const clean=String(merchant||'').toLowerCase().replace(/\s+/g,' ').replace(/(?:\s*[-#*]\s*\d{3,})$/,'').trim();
 const key=[type,category,account,clean].map(encodeURIComponent).join('|');
 const sibling=Object.keys(state?.predictions?.patternRules||{}).filter(candidate=>{
  const parts=candidate.split('|');
  return parts.length===4&&parts[0]===encodeURIComponent(type)&&
   parts[2]===encodeURIComponent(account)&&parts[3]===encodeURIComponent(clean);
 });
 return sibling.includes(key)?key:sibling.at(-1)||key;
}
function setPatternRule(state,key,rule){
 if(typeof key!=='string'||!key||key.length>600)throw Error('Invalid pattern key');
 state.predictions.patternRules??={};
 // Merge legacy rules created under different categories for the same
 // account/merchant. Exactly one forecast instruction can survive.
 const parts=key.split('|');
 const siblings=parts.length===4?Object.keys(state.predictions.patternRules).filter(other=>{
  const p=other.split('|');
  return p.length===4&&p[0]===parts[0]&&p[2]===parts[2]&&p[3]===parts[3];
 }):[];
 const clearForecastEdits=()=>{
  const parts=key.split('|');
  if(parts.length!==4)return;
  for(const id of Object.keys(state.predictions.expectedTransactionOverrides||{})){
   const p=id.split('|');
   // Historical forecast IDs include the month and category; clear edits
   // made under any former category for this same recurrence identity.
   if(p[0]==='hist'&&p.length>=6&&p[3]===parts[2]&&p[4]===parts[3])
    delete state.predictions.expectedTransactionOverrides[id];
  }
 };
 const mergeSiblingRules=()=>{for(const other of siblings)if(other!==key)delete state.predictions.patternRules[other]};
 if(rule===null){clearForecastEdits();for(const other of new Set([key,...siblings]))delete state.predictions.patternRules[other];return}
 if(!rule||!['none','monthly','trust','schedule'].includes(rule.mode))throw Error('Invalid recurrence decision');
 if(rule.mode==='none'){clearForecastEdits();mergeSiblingRules();state.predictions.patternRules[key]={mode:'none'};return}
 if(rule.mode==='schedule'){
  const allowed=['weekly','biweekly','monthly','quarterly','semiannual','annual'];
  const anchorDate=String(rule.anchorDate||'');
  const day=Number(rule.day),amount=Number(rule.amount);
  if(!allowed.includes(rule.frequency)||!validDate(anchorDate)||
     !Number.isInteger(day)||day<1||day>31||
     !Number.isFinite(amount)||amount<=0||amount>999999999)
    throw Error('Choose a valid recurring frequency, starting date, day and amount');
  clearForecastEdits();mergeSiblingRules();
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
  mergeSiblingRules();state.predictions.patternRules[key]={mode:'trust',cadence:rule.cadence,day:Number(rule.day),
    amount:round(rule.amount),confirmedAt:new Date().toISOString(),source:'review'};
  return;
 }
 if(!Number.isInteger(Number(rule.day))||Number(rule.day)<1||Number(rule.day)>31||
   !Number.isFinite(Number(rule.amount))||Number(rule.amount)<=0)throw Error('Invalid recurring amount or date');
 clearForecastEdits();mergeSiblingRules();
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
 const seenBatch=new Map();
 const providerId=id=>'plaid:'+(itemId?itemId+':':'')+String(id);
 const read=t=>{
  if(!t||!t.transaction_id||!t.account_id||!validDate(t.date)||
   t.amount===null||t.amount===undefined||!Number.isFinite(Number(t.amount)))
   throw Error('Invalid provider transaction');
  const amount=Number(t.amount),id=providerId(t.transaction_id);
  const signature=JSON.stringify([String(t.account_id),amount,t.date,String(t.merchant_name||t.name||''),Boolean(t.pending)]);
  if(seenBatch.has(id)&&seenBatch.get(id)!==signature)throw Error('Conflicting repeated provider transaction ID in sync batch');
  seenBatch.set(id,signature);
  const foreign=itemId?(staged.transactions||[]).find(row=>row.source?.provider==='plaid'&&row.source?.providerTransactionId===String(t.transaction_id)&&row.source?.itemId&&row.source.itemId!==itemId&&row.source?.accountId===String(t.account_id)):null;
  if(foreign)throw Error('Same bank transaction appears under multiple Plaid Items; review duplicate connection');
  const current=byId.get(id);
  const classified=Categorization.classify(t);
  const defaultCategory=classified.category!=='Other'?classified.category:current?.category||'Other';
  const pfc=t.personal_finance_category&&typeof t.personal_finance_category==='object'?
   {primary:String(t.personal_finance_category.primary||'').slice(0,90),
    detailed:String(t.personal_finance_category.detailed||'').slice(0,140),
    confidence_level:String(t.personal_finance_category.confidence_level||'UNKNOWN').slice(0,30)}:
   current?.source?.personalFinanceCategory||null;
  const meta=(staged.accounts||[]).find(a=>a.id===String(t.account_id));
  if(itemId&&meta?.itemId&&meta.itemId!==itemId)
   throw Error('Account belongs to a different Plaid Item');
  const next={id,date:t.date,merchant:String(t.merchant_name||t.name||'Unknown'),
   description:String(t.name||''),amount:round(Math.abs(amount)),
   type:amount>=0?'expense':'income',category:defaultCategory,
   accountId:String(t.account_id),account:String(meta?.name||t.account_name||t.account_id),
   pending:Boolean(t.pending),source:{provider:'plaid',providerTransactionId:String(t.transaction_id),
    accountId:String(t.account_id),itemId:itemId||null,plaidAmount:amount,simulated:change.simulated===true,
    pendingTransactionId:t.pending_transaction_id||null,verified:true,
    categoryOrigin:classified.category!=='Other'?classified.method:current?.source?.categoryOrigin||'unclassified',
    categoryConfidence:classified.category!=='Other'?classified.confidence:current?.source?.categoryConfidence??0,
    ...(pfc?{personalFinanceCategory:pfc}:{})}};
  const previous=t.pending_transaction_id?providerId(t.pending_transaction_id):null;
  if(previous&&staged.categoryOverrides?.[previous]&&!staged.categoryOverrides[id])
   staged.categoryOverrides[id]=staged.categoryOverrides[previous];
  if(previous){
   const old=byId.get(previous);
   if(old&&old.accountId!==String(t.account_id))throw Error('Pending predecessor belongs to another account');
   if(old)byId.delete(previous);
  }
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
function setCardPaymentRule(state,accountId,rule){
 const id=String(accountId||'');
 if(!id||!rule||typeof rule!=='object')throw Error('Select a credit card');
 const dateOK=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&
  Number.isFinite(Date.parse(s+'T12:00:00Z'))&&
  new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 const days=(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);
 const due=String(rule.nextPaymentDate||''),paymentDue=String(rule.nextDueDate||due);
 const isCycle=Boolean(rule.billingStartDate||rule.billingEndDate);
 const beginning=String(rule.billingStartDate||''),end=String(rule.billingEndDate||rule.lastStatementClose||'');
 const closed=isCycle?end:String(rule.lastStatementClose||'');
 const closingDay=Number(isCycle?end.slice(8,10):rule.closingDay);
 const method=String(rule.method||'statement');
 const hasIssued=rule.lastStatementBalance!==''&&rule.lastStatementBalance!=null;
 const last=hasIssued?Number(rule.lastStatementBalance):null;
 const autopayEnabled=rule.autopayEnabled===undefined?true:
  rule.autopayEnabled===true||rule.autopayEnabled==='yes';
 if(!dateOK(due)||!dateOK(paymentDue)||!dateOK(closed)||
  due<=closed||paymentDue<=closed||due>paymentDue||
  !Number.isInteger(closingDay)||closingDay<1||closingDay>31||
  !['statement','full','minimum','fixed'].includes(method)||
  (hasIssued&&(!Number.isFinite(last)||last<0||last>999999999))||
  (!isCycle&&!hasIssued)||
  (isCycle&&(!dateOK(beginning)||beginning>end||
   days(beginning,end)<20||days(beginning,end)>35))||
  (autopayEnabled&&!String(rule.fromAccountId||'')))
  throw Error('Enter a valid billing period, payment date, paying account and amount');
 const minimum=Number(rule.minimumAmount),fixed=Number(rule.fixedAmount);
 if(method==='minimum'&&(!Number.isFinite(minimum)||minimum<0)||
  method==='fixed'&&(!Number.isFinite(fixed)||fixed<0))
  throw Error('Enter a valid autopay amount');
 state.predictions.paymentRules??={};
 state.predictions.paymentRules[id]={
  fromAccountId:String(rule.fromAccountId||''),autopayEnabled,closingDay,
  ...(isCycle?{billingStartDate:beginning,billingEndDate:end}:{}),
  lastStatementClose:closed,nextPaymentDate:due,nextDueDate:paymentDue,
  lastStatementBalance:hasIssued?round(last):null,method,
  minimumAmount:Number.isFinite(minimum)?round(minimum):0,
  fixedAmount:Number.isFinite(fixed)?round(fixed):0
 };
}
function removeCardPaymentRule(state,id){delete(state.predictions.paymentRules||{})[String(id)]}
function savePaymentBill(state,bill){
 const dateOK=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
 if(!bill||!bill.fromAccountId||!String(bill.name||'').trim()||!dateOK(bill.date)||
  !['once','monthly'].includes(bill.frequency)||!Number.isFinite(Number(bill.amount))||
  Number(bill.amount)<=0||Number(bill.amount)>999999999)throw Error('Complete the payment account, name, amount and due date');
 state.predictions.paymentBills??=[];
 const id=bill.id||'bill-'+Date.now().toString(36)+Math.random().toString(36).slice(2);
 if(String(id).length>120)throw Error('Invalid payment ID');
 const entry={id:String(id),fromAccountId:String(bill.fromAccountId),name:String(bill.name).trim().slice(0,130),
  date:String(bill.date),amount:round(bill.amount),category:String(bill.category||'Housing'),
  frequency:bill.frequency,enabled:bill.enabled!==false};
 const pos=state.predictions.paymentBills.findIndex(x=>x.id===id);
 if(pos<0)state.predictions.paymentBills.push(entry);else state.predictions.paymentBills[pos]=entry;
 return id;
}
function removePaymentBill(state,id){state.predictions.paymentBills=(state.predictions.paymentBills||[]).filter(x=>x.id!==id)}
function setCashCushion(state,amount){
 if(!Number.isFinite(Number(amount))||Number(amount)<0||Number(amount)>999999999)throw Error('Invalid cash cushion');
 state.predictions.cashCushion=round(amount);
}
const api={VERSION,migrate,records,categories,canonicalCategory,addCategory,removeCategory,removedCategory,accountsFor:Accounting.accountsFor,registerAccounts:Accounting.registerAccounts,accountingView:Accounting.reconcile,categoryFor,resolution,categoryReviewQueue,categoryRuleKey,categoryRuleSafety,learnCategory,removeCategoryRule,setCategory,setMonthlyBudget,setCategoryForecast,setPatternRule,recurringRuleKey,updateExpectedTransaction,saveManualExpected,removeManualExpected,expectedForCategory,setStreamOverride,setDailyVariable,saveEvent,removeEvent,saveAccountMovement,removeAccountMovement,setCardPaymentRule,removeCardPaymentRule,savePaymentBill,removePaymentBill,setCashCushion,applyPlaidSync,applyPlaidSyncPages};
root.HouseholdLedgerData=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
