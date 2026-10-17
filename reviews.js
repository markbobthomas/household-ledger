/* Reviews / uncertainty triage. Read-only source facts and future forecast candidates.
   Confirmation/edit dispositions live under state.reviews, never transactions[]. */
(function(root){
'use strict';
const categoryNames=['Groceries','Shopping','Housing','Utilities','Transportation','Dining','Health','Entertainment','Kids & Family','Insurance','Subscriptions','Other'];
const isoValid=s=>/^\d{4}-\d\d-\d\d$/.test(String(s||''));
const merchantKey=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
const categoryFingerprint=t=>[t.id,t.merchant,t.date,t.amount,t.category,t.type].join('|');
const predictionFingerprint=t=>[t.id,t.merchant,t.date,t.amount,t.confidence,t.evidence,t.account].join('|');
function ensure(state){
 if(!state.reviews||typeof state.reviews!=='object'||Array.isArray(state.reviews))state.reviews={};
 if(!state.reviews.categoryConfirmed||typeof state.reviews.categoryConfirmed!=='object')state.reviews.categoryConfirmed={};
 if(!state.reviews.predictionConfirmed||typeof state.reviews.predictionConfirmed!=='object')state.reviews.predictionConfirmed={};
 return state.reviews;
}
function categoryReason(t,distribution){
 if(t.category==='Other'||!t.category)return {reason:'No specific category assigned',priority:0,suggested:null,confidence:'None'};
 const n=Number(t.categoryConfidence??t.category_confidence??t.source?.categoryConfidence);
 if(Number.isFinite(n)&&n>=0&&n<0.7)return {reason:'Imported category marked low confidence ('+Math.round(n*100)+'%)',priority:1,suggested:null,confidence:'Low'};
 const key=merchantKey(t.merchant);
 // The same merchant being categorized multiple ways is a useful, objective
 // ambiguity signal, without imposing a blanket category on every Amazon buy.
 const options=distribution.get(key);
 if(options?.size>1)return {reason:'This merchant appears under multiple categories',priority:1,suggested:null,confidence:'Low'};
 // Explicit transparent demo fixture: Home Depot purchases can reasonably be
 // either household repair (Housing) or goods (Shopping).
 if(t.source?.provider==='demo'&&key.includes('home depot'))
  return {reason:'Sample review: home improvement or shopping?',priority:1,suggested:'Shopping',confidence:'Low'};
 return null;
}
function build(state,forecast,asOf,shared){
 ensure(state);
 const current=String(asOf||new Date().toLocaleDateString('en-CA')).slice(0,10);
 const cutoffDate=new Date(current+'T12:00:00Z');cutoffDate.setUTCDate(cutoffDate.getUTCDate()-90);
 const cutoff=cutoffDate.toISOString().slice(0,10);
 const source=Array.isArray(state.transactions)?state.transactions:[];
 const model=root.HouseholdLedgerData;
 const effective=model?.records?model.records(state):
   source.map(t=>({...t,category:state.categoryOverrides?.[t.id]||t.category||'Other'}));
 const distribution=new Map();
 for(const t of effective.filter(t=>t.type==='expense')){
  const key=merchantKey(t.merchant);if(!distribution.has(key))distribution.set(key,new Set());
  distribution.get(key).add(t.category);
 }
 const tasks=[];
 for(const t of effective){
  if(t.type!=='expense'||!isoValid(t.date)||t.date<cutoff||t.date>current||state.categoryOverrides?.[t.id])continue;
  let assessment=categoryReason(t,distribution);
  // A reused rule never overwrites a confident bank classification. Instead
  // its disagreement becomes an explainable review task.
  if(t.suggested&&t.suggested!==t.category){
    assessment={reason:'Saved merchant rule suggests '+t.suggested+'; verify this category',priority:1,
      suggested:t.suggested,confidence:'Low'};
  }
  if(t.method==='learned')continue;
  if(!assessment)continue;
  const fingerprint=categoryFingerprint(t);
  if(state.reviews.categoryConfirmed[t.id]?.fingerprint===fingerprint)continue;
  tasks.push({id:'category|'+t.id,kind:'category',targetId:t.id,merchant:t.merchant,amount:Number(t.amount)||0,date:t.date,category:t.category,
    priority:assessment.priority,reason:assessment.reason,confidence:assessment.confidence,suggested:assessment.suggested,learnedRuleKey:t.ruleKey||null,learnedReason:t.explanation||null,
    demo:t.source?.provider==='demo',fingerprint,account:t.account||t.accountId||''});
 }
 const month=current.slice(0,7);
 if(forecast&&typeof forecast.forecast==='function'){
  for(const category of categoryNames){
   const prediction=shared?.categoryViews?.[month+'|'+category]||forecast.forecast(effective,month,category,current,state.predictions?.patternRules);
   for(const item of prediction.expected||[]){
    if((['High','Confirmed'].includes(item.confidence)&&!item.ruleChanged)||item.source==='manual'||item.date<=current||state.predictions?.expectedTransactionOverrides?.[item.id])continue;
    if(state.reviews.predictionConfirmed[item.id]?.fingerprint===predictionFingerprint(item))continue;
    tasks.push({id:'prediction|'+item.id,kind:'prediction',targetId:item.id,merchant:item.merchant,
      date:item.date,amount:Number(item.amount),category,confidence:item.confidence||'Low',cadence:item.cadence||null,ruleChanged:Boolean(item.ruleChanged),
      priority:1,reason:(item.warning|| (item.ruleChanged?'Confirmed repeating payment changed':item.confidence==='Medium'?'Limited historical evidence':'Transaction pattern needs confirmation'))+' · '+item.evidence+' historical months',
      evidence:item.evidence,account:item.account||'',fingerprint:predictionFingerprint(item),
      demo:source.some(t=>t.source?.provider==='demo'&&merchantKey(t.merchant)===merchantKey(item.merchant))});
   }
  }
 }
 tasks.sort((a,b)=>a.priority-b.priority||(a.kind===b.kind?0:a.kind==='category'?-1:1)||b.date.localeCompare(a.date)||a.merchant.localeCompare(b.merchant));
 return {tasks,categoryCount:tasks.filter(t=>t.kind==='category').length,predictionCount:tasks.filter(t=>t.kind==='prediction').length,
   demoCount:tasks.filter(t=>t.demo).length,asOf:current};
}
function confirm(state,task){
 const review=ensure(state);
 if(!task||!task.fingerprint)throw Error('Invalid review task');
 const entry={fingerprint:task.fingerprint,confirmedAt:new Date().toISOString()};
 if(task.kind==='category')review.categoryConfirmed[task.targetId]=entry;
 else if(task.kind==='prediction')review.predictionConfirmed[task.targetId]=entry;
 else throw Error('Unknown review type');
}
const api={build,ensure,confirm,categoryFingerprint,predictionFingerprint};
root.HouseholdReviews=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
