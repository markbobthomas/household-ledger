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
  'customCategories','amazonAllocations','categoryAutomation'].filter(k=>adjustments[k]!==undefined)
  .map(k=>[k,adjustments[k]])),
  humanConfirmedCategoryIds:Object.keys(adjustments.categoryOverrides||{}).filter(id=>
   require('./category-ai-automation.cjs').confirmed(adjustments,id))});
 const candidates=model.categoryReviewQueue(ledger);
 const source=new Map(rows.map(t=>[String(t.id),t]));
 const notes=adjustments.predictions?.transactionNotes||{};
 const evidence=require('./amazon-evidence.cjs');
 // Only annotations for the decision currently shared. Owner notes and
 // separately imported Amazon product evidence can both be useful.
 const annotations=(...entries)=>{
  const found=[],seen=new Set();
  for(const [label,value] of entries){
   if(typeof value!=='string'||!value.trim())continue;
   const text=value.trim().slice(0,160);
   if(seen.has(text))continue;
   seen.add(text);found.push({label,text});
  }
  return found;
 };
 const chargeNotes=id=>{
  const raw=state.transactions?.[id],saved=raw?notes[keyFor(raw)]:null,
   imported=raw&&adjustments.amazonEvidence?.[id],
   product=imported&&evidence.valid(imported,raw)?evidence.note(imported):'';
  const check=raw&&adjustments.categoryAiChecks?.[keyFor(raw)],
   aiText=check?.status==='unable'?'AI checked — unable to categorize':
    ['interrupted','pending'].includes(check?.status)?'AI attempt interrupted — not retried automatically':
    check?.status==='suggested'?'AI suggested '+check.category+' (not yet confirmed)':null;
  return annotations(['Saved note',saved],['Transaction note',raw?.note],
   ['Amazon product details',product],['AI review',aiText]);
 };
 const withNotes=(item,entries,editableNote='')=>({...item,notes:entries,
  note:entries[0]?.text||'',editableNote});
 // A deliberately chosen Other is a final decision, including legacy manual
 // overrides predating categoryProvenance. Automated Other remains reviewable.
 const ownerChosenOther=new Set(Object.entries(adjustments.categoryOverrides||{})
  .filter(([id,category])=>category==='Other'&&
   (!adjustments.categoryProvenance?.[id]?.source||
    adjustments.categoryProvenance[id].source==='manual'))
  .map(([id])=>String(id)));
 // Never display a whole-charge action for an itemized Amazon charge with
 // unknown lines: overwriting its allocation would misclassify known items.
 const itemizedNeedsReview=new Set();
 for(const [id,allocation] of Object.entries(adjustments.amazonAllocations||{})){
  const lines=allocation?.lines;
  if(Array.isArray(lines)&&lines.length&&Number.isSafeInteger(allocation?.amountCents))
   itemizedNeedsReview.add(String(id));
 }
 const transactions=candidates.transactions.filter(t=>!t.creditKind&&
  source.has(t.id)&&!itemizedNeedsReview.has(String(t.id))&&
  !ownerChosenOther.has(String(t.id)))
  .map(t=>{
   const original=source.get(t.id);
   return withNotes({kind:'transaction',id:t.id,merchant:t.merchant.slice(0,140),
    amount:t.amount,date:t.date,reason:t.reason,category:t.category,
    suggested:adjustments.categoryAiChecks?.[keyFor(state.transactions[original.id])]?.category||t.suggested||null},chargeNotes(original.id),
    notes[keyFor(state.transactions[original.id])]||'');
  });
 // Include identifiable Amazon products still parked in a broad "Other"
 // category. These are review choices, never automatic overrides; specific
 // manual categories and item allocations remain protected by the model.
 const known=new Set(transactions.map(t=>t.id));
 const amazon=require('./amazon-evidence.cjs').review(
  state.transactions,adjustments,model.categories(ledger));
 for(const item of amazon.items){
  // Amazon's secondary review path must not reopen an owner-approved Other.
  if(ownerChosenOther.has(String(item.id)))continue;
  // A mixed order is a set of separately priced category decisions.
  // Keep the original posted bank amount as one transaction.
  if(Number.isSafeInteger(item.lineIndex)){
   const id='amazon-item:'+JSON.stringify([item.id,item.lineIndex]);
   transactions.push(withNotes({kind:'amazon-item',id,
    merchant:item.note.startsWith('Amazon: ')?item.note.slice(8):item.merchant,
    amount:item.amountCents/100,date:item.date,
    reason:'Review one Amazon product',category:item.currentCategory,
    suggested:item.suggestedCategory},
    annotations(...chargeNotes(item.id).map(n=>[n.label,n.text]),
     ['Amazon item',item.note]),notes[keyFor(state.transactions[item.id])]||''));
   continue;
  }
  if(known.has(item.id)||item.currentCategory!=='Other'||
     !item.suggestedCategory)continue;
  known.add(item.id);
  transactions.push(withNotes({kind:'transaction',id:item.id,merchant:item.merchant,
   amount:item.amountCents/100,date:item.date,
   reason:'Review Amazon product category',category:'Other',
   suggested:item.suggestedCategory},
   annotations(...chargeNotes(item.id).map(n=>[n.label,n.text]),
    ['Amazon item',item.note]),notes[keyFor(state.transactions[item.id])]||''));
 }
 const planLists={schedule:'futureRecurringRules',oneoff:'futureTransactionAdds',
  bill:'paymentBills'};
 const plans=candidates.plans.map(p=>{
  const row=(adjustments.predictions?.[planLists[p.kind]]||[])
   .find(x=>String(x?.id)===p.id);
  return withNotes({kind:p.kind,id:p.id,merchant:p.merchant.slice(0,140),
   amount:p.amount,date:p.date,reason:p.reason,category:p.category,
   suggested:null},
   annotations(['Saved note',notes['forecast:'+p.id]],
    ['Payment note',row?.note],['Payment note',row?.memo]),
   notes['forecast:'+p.id]||'');
 });
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
  typeof selection.kind==='string'&&['transaction','amazon-item','schedule','oneoff','bill'].includes(selection.kind)&&
  typeof selection.category==='string'&&
  view.categories.includes(selection.category)&&
  view.items.some(i=>i.id===selection.id&&i.kind===selection.kind);
}
function change(state,choice,allowedCategories){
 const before=state.ledgerAdjustments||{};
 if(choice.kind==='amazon-item'){
  // selectionIsValid was checked against a fresh server-side queue.
  let pair;
  try{pair=JSON.parse(choice.id.slice('amazon-item:'.length))}catch{}
  if(!Array.isArray(pair)||pair.length!==2||
     typeof pair[0]!=='string'||!Number.isSafeInteger(pair[1]))
   throw Error('Invalid Amazon item review');
  const result=require('./amazon-review-choice.cjs').change(
   state.transactions,before,{transactionId:pair[0],lineIndex:pair[1],
    category:choice.category,verified:true},
   Array.isArray(allowedCategories)?allowedCategories:snapshot(state).categories);
  return result.next;
 }
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

// The share token can edit only the personal note for an item still in the
// live category queue. Imported Amazon evidence and read-only bank facts are
// never writable through this endpoint.
function noteSelectionIsValid(view,choice){
 return !!choice&&typeof choice==='object'&&!Array.isArray(choice)&&
  Object.keys(choice).sort().join(',')==='id,kind,note'&&
  typeof choice.id==='string'&&typeof choice.kind==='string'&&
  typeof choice.note==='string'&&choice.note.length<=1000&&
  view.items.some(i=>i.id===choice.id&&i.kind===choice.kind);
}
function noteKeyFor(state,choice){
 if(['schedule','oneoff','bill'].includes(choice.kind))
  return 'forecast:'+choice.id;
 let id=choice.id;
 if(choice.kind==='amazon-item'){
  let parsed;
  try{parsed=JSON.parse(id.slice('amazon-item:'.length))}catch{}
  if(!id.startsWith('amazon-item:')||!Array.isArray(parsed)||
     typeof parsed[0]!=='string'||!Number.isSafeInteger(parsed[1]))return null;
  id=parsed[0];
 }
 const transaction=state.transactions?.[id];
 return transaction?keyFor(transaction):null;
}
function changeNote(state,choice){
 const key=noteKeyFor(state,choice);
 if(!key)throw Error('Category task changed; refresh the page');
 const before=state.ledgerAdjustments||{},predictions=before.predictions||{},
  transactionNotes={...(predictions.transactionNotes||{})};
 const value=choice.note.trim();
 if(value)transactionNotes[key]=value;
 else delete transactionNotes[key];
 return {...predictions,transactionNotes};
}
module.exports={snapshot,selectionIsValid,change,noteSelectionIsValid,changeNote};
