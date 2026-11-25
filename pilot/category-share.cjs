'use strict';
// The spouse queue reuses the exact private Ledger category-review model.
// It exposes only spending decisions; transfers and income classification stay owner-only.
const {keyFor}=require('./amazon-pairing.cjs');
const model=require('../ledger-data.js');
const feed=require('./data-source.js');
const first=['Groceries','Dining','Shopping','Kids & Family','Childcare','Home & Maintenance',
 'Healthcare','Health','Insurance','Subscriptions','Gas','Transportation','Utilities',
 'Utility','Housing','Entertainment','Other'];
const excluded=new Set(['Uncategorized','Income','Transfer','Savings']);
function snapshot(state){
 const adjustments=state.ledgerAdjustments||{},accounts=Array.isArray(state.accounts)?state.accounts:[],
  byAccount=new Map(accounts.map(a=>[String(a.id),a]));
 const rows=Object.values(state.transactions||{}).map(t=>{
  const account=byAccount.get(String(t?.accountId));
  return account?feed.record(t,account):null;
 }).filter(Boolean);
 const ledger=model.migrate({transactions:rows,accounts:accounts.map(a=>({
  id:a.id,name:a.name,type:a.type,subtype:a.subtype,itemId:a.itemId
 })),...Object.fromEntries(['categoryOverrides','predictions','reviews','learning',
  'customCategories','amazonAllocations'].filter(k=>adjustments[k]!==undefined)
  .map(k=>[k,adjustments[k]]))});
 const candidates=model.categoryReviewQueue(ledger);
 const source=new Map(rows.map(t=>[String(t.id),t]));
 const notes=adjustments.predictions?.transactionNotes||{};
 const transactions=candidates.transactions.filter(t=>!t.creditKind&&source.has(t.id))
  .map(t=>{
   const original=source.get(t.id);
   const note=notes[keyFor(original)];
   return {kind:'transaction',id:t.id,merchant:t.merchant.slice(0,140),
    amount:t.amount,date:t.date,reason:t.reason,category:t.category,
    suggested:t.suggested||null,
    note:typeof note==='string'?note.slice(0,160):''};
  });
 const plans=candidates.plans.map(p=>({
  kind:p.kind,id:p.id,merchant:p.merchant.slice(0,140),
  amount:p.amount,date:p.date,reason:p.reason,category:p.category,
  suggested:null,note:''
 }));
 const names=model.categories(ledger).filter(c=>!excluded.has(c));
 const categories=[...names].sort((a,b)=>{
  const ai=first.indexOf(a),bi=first.indexOf(b);
  return (ai<0?100:ai)-(bi<0?100:bi)||a.localeCompare(b);
 });
 return {items:transactions.concat(plans),categories};
}
function selectionIsValid(view,selection){
 if(!selection||typeof selection!=='object'||Array.isArray(selection)||
    Object.keys(selection).sort().join(',')!=='category,id,kind')return false;
 return typeof selection.id==='string'&&selection.id.length>0&&
  typeof selection.kind==='string'&&['transaction','schedule','oneoff','bill'].includes(selection.kind)&&
  typeof selection.category==='string'&&
  view.categories.includes(selection.category)&&
  view.items.some(i=>i.id===selection.id&&i.kind===selection.kind);
}
function change(state,choice){
 const before=state.ledgerAdjustments||{};
 if(choice.kind==='transaction'){
  const overrides={...(before.categoryOverrides||{}),[choice.id]:choice.category};
  const amazonAllocations={...(before.amazonAllocations||{})};
  delete amazonAllocations[choice.id];
  const categoryProvenance={...(before.categoryProvenance||{}),
   [choice.id]:{source:'manual',category:choice.category}};
  return {...before,categoryOverrides:overrides,amazonAllocations,categoryProvenance};
 }
 const key={schedule:'futureRecurringRules',oneoff:'futureTransactionAdds',bill:'paymentBills'}[choice.kind];
 if(!key)throw Error('Invalid category task');
 const old=before.predictions||{},list=old[key];
 if(!Array.isArray(list)||!list.some(p=>String(p.id)===choice.id))
  throw Error('Category task changed; refresh the page');
 return {...before,predictions:{...old,[key]:list.map(p=>String(p.id)===choice.id?
  {...p,category:choice.category,categoryReviewed:true}:p)}};
}
module.exports={snapshot,selectionIsValid,change};
