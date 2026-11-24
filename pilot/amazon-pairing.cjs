'use strict';
// Conservative high-recall Amazon-to-posted-bank linker. No AI or raw-bank writes.
// Exact individual, same-shipment and small shipment-subset sums are supported;
// fuzzy/date-only links are explicitly marked possible and NEVER categorized.
const DAY=86400000,MAX_SUBSET_ITEMS=10,MAX_GROUPS=250000;
const amazon=t=>t&&t.pending!==true&&Number(t.amount)>0&&
 (/(?:^|\W)(?:amazon|amzn|amz)(?:\W|$)/i.test(String(t.merchant||''))||
 /(?:^|\W)(?:amazon|amzn|amz)(?:\W|$)/i.test(String(t.name||'')))&&
 /^\d{4}-\d{2}-\d{2}$/.test(String(t.date||''))&&
 Number.isSafeInteger(Math.round(Number(t.amount)*100));
const cents=t=>Math.round(Number(t.amount)*100);
const dayGap=(posted,ship)=>
 Math.round((Date.parse(posted+'T12:00:00Z')-Date.parse(ship+'T12:00:00Z'))/DAY);
const keyFor=t=>'bank:'+JSON.stringify([String(t.accountId||''),String(t.id)]);
const compact=s=>String(s||'').replace(/\s+/g,' ').trim();
function itemNote(items,prefix='Amazon: '){
 const titles=[...new Set(items.map(i=>compact(i.title)).filter(Boolean))];
 if(!titles.length)return '';
 let note=prefix;
 for(let i=0;i<titles.length;i++){
  const separator=i?'; ':'',remaining=titles.length-i-1;
  const reserve=remaining?'; +'+remaining+' more':'';
  if(note.length+separator.length+titles[i].length+reserve.length<=160){
   note+=separator+titles[i];continue;
  }
  const space=160-note.length-separator.length-reserve.length;
  if(space>4)note+=separator+titles[i].slice(0,space-1).trimEnd()+'…'+reserve;
  else if(remaining)note=note.slice(0,160-reserve.length)+reserve;
  return note.slice(0,160);
 }
 return note.slice(0,160);
}
// If two purchases are both plausible, the Note must say OR rather than
// falsely claiming they were both paid for by one bank charge.
function choiceNote(choices){
 const titles=[...new Set(choices.map(c=>c.items.map(i=>compact(i.title)).filter(Boolean).join(' + ')).filter(Boolean))].slice(0,3);
 return ('Possible Amazon (verify): '+titles.join(' OR ')).slice(0,160);
}
function match(rows,transactions,adjustments,validCategories,allocate){
 const notes=adjustments?.predictions?.transactionNotes||{},
  overrides=adjustments?.categoryOverrides||{},
  existing=adjustments?.amazonAllocations||{};
 // Only count charges where an item Note or a category is still useful.
 // Already completed manual notes/categories must not consume an order match.
 const txs=Object.values(transactions||{}).filter(amazon).filter(t=>
  !String(notes[keyFor(t)]||'').trim()||
  overrides[t.id]===undefined||overrides[t.id]==='Uncategorized');
 const needed=[...new Set(txs.map(cents))].sort((a,b)=>a-b);
 const nearby=(amount)=>{
  if(needed.includes(amount))return true;
  let low=0,high=needed.length;
  while(low<high){const m=(low+high)>>1;if(needed[m]<amount)low=m+1;else high=m}
  for(const n of [needed[low-1],needed[low]]){
   if(n!==undefined&&Math.abs(n-amount)<=Math.min(500,Math.max(75,Math.round(n*.03))))return true;
  }
  return false;
 };
 const orders=new Map();
 for(const row of rows){
  if(!row||!row.orderId||!row.title||!Number.isSafeInteger(row.cents)||row.cents<=0)continue;
  if(!orders.has(row.orderId))orders.set(row.orderId,[]);
  const items=orders.get(row.orderId);
  if(items.length<150)items.push({...row,_id:row.orderId+'#'+items.length});
 }
 const candidates=[],signatures=new Set();
 const add=(id,items,amount,source)=>{
  if(!Number.isSafeInteger(amount)||amount<=0||candidates.length>=MAX_GROUPS)return;
  const ids=items.map(i=>i._id).sort();
  const sig=ids.join('|')+'|'+amount;
  if(signatures.has(sig))return;signatures.add(sig);
  const dates=items.map(i=>i.shipmentDate||i.date).filter(Boolean).sort();
  if(!dates.length)return;
  candidates.push({id,items,ids,amount,source,date:dates.at(-1)});
 };
 for(const [orderId,items] of orders){
  if(!items.length)continue;
  const total=items.reduce((n,i)=>n+i.cents,0);
  const charged=[...new Set(items.map(i=>i.charged).filter(n=>n!==null&&n!==undefined))];
  // The order-level total is valid only when all lines agree. Otherwise
  // sum per-line totals, which include tax/shipping/discounts if supplied.
  if(charged.length===1&&items.every(i=>i.charged===charged[0]))
   add(orderId,items,charged[0],'order-total');
  add(orderId,items,total,'order-sum');
  const shipGroups=new Map();
  for(const item of items){
   const date=item.shipmentDate||item.date;
   if(!shipGroups.has(date))shipGroups.set(date,[]);
   shipGroups.get(date).push(item);
   add(orderId,[item],item.cents,'item');
  }
  for(const [date,ship] of shipGroups){
   add(orderId+' · '+date,ship,ship.reduce((n,i)=>n+i.cents,0),'shipment');
   // Amazon can settle multiple shipments on the same date. Test exact
   // smaller combinations, without combining unrelated shipment dates.
   if(ship.length>1&&ship.length<=MAX_SUBSET_ITEMS&&candidates.length<MAX_GROUPS){
    const count=1<<ship.length;
    for(let mask=1;mask<count-1;mask++){
     if((mask&(mask-1))===0)continue;
     let sum=0;const selected=[];
     for(let k=0;k<ship.length;k++)if(mask&(1<<k)){
      sum+=ship[k].cents;selected.push(ship[k]);
     }
     if(nearby(sum))add(orderId+' · '+date,selected,sum,'shipment-part');
    }
   }
  }
 }
 const byAmount=new Map();
 for(const c of candidates){
  if(!byAmount.has(c.amount))byAmount.set(c.amount,[]);
  byAmount.get(c.amount).push(c);
 }
 const selection=new Map(),ambiguous=new Set();
 const validDate=(t,c)=>{const days=dayGap(t.date,c.date);return days>=-2&&days<=21};
 const proximity=(t,c)=>{const days=dayGap(t.date,c.date);return Math.abs(days-2)};
 for(const t of txs){
  const options=(byAmount.get(cents(t))||[]).filter(c=>validDate(t,c));
  if(!options.length)continue;
  options.sort((a,b)=>proximity(t,a)-proximity(t,b)||a.id.localeCompare(b.id));
  if(options.length>1&&proximity(t,options[1])-proximity(t,options[0])<5){
   ambiguous.add(t.id);continue;
  }
  selection.set(t.id,{tx:t,group:options[0]});
 }
 // A physical product-line must not be attributed to two distinct bank
 // charges (including an order-level match overlapping an item match).
 const ownership=new Map();
 for(const [id,{group}] of selection){
  for(const item of group.ids){
   if(!ownership.has(item))ownership.set(item,[]);
   ownership.get(item).push(id);
  }
 }
 for(const [id,{group}] of selection){
  if(group.ids.some(item=>ownership.get(item).length>1)){
   ambiguous.add(id);
   selection.delete(id);
  }
 }
 const matches=[],suggestions=[],usedItems=new Set();
 for(const {tx,group} of selection.values()){
  const lines=allocate(group.items,cents(tx),validCategories);
  if(!lines||lines.reduce((n,line)=>n+line.cents,0)!==cents(tx))continue;
  const categories=[...new Set(lines.map(l=>l.category))];
  const manual=overrides[tx.id]!==undefined&&overrides[tx.id]!=='Uncategorized'&&!existing[tx.id];
  for(const id of group.ids)usedItems.add(id);
  matches.push({transactionId:tx.id,orderId:group.id,date:tx.date,accountId:tx.accountId,
   amountCents:cents(tx),lines,categories,note:itemNote(group.items),
   needsReview:categories.includes('Uncategorized'),notesOnly:manual,
   alreadyImported:Boolean(existing[tx.id]),confidence:'exact'});
 }
 // Date and price independently rank possible Amazon products. Amazon can
 // split one order into separate charges, settle it later, and apply tax or
 // credits so that a product-line total is NOT identical to the bank debit.
 // An unverified suggestion is a helpful Note, not a categorical assertion.
 // Index by shipment day rather than scanning every imported row for every
 // bank charge (large ZIPs can contain tens of thousands of item lines).
 const byDay=new Map();
 for(const c of candidates){
  if(!byDay.has(c.date))byDay.set(c.date,[]);
  byDay.get(c.date).push(c);
 }
 const shift=(iso,n)=>{
  const date=new Date(iso+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()+n);
  return date.toISOString().slice(0,10);
 };
 const rank=(t,c)=>{
  const gap=dayGap(t.date,c.date),
   diff=Math.abs(c.amount-cents(t))/Math.max(c.amount,cents(t));
  return diff+Math.abs(gap-2)*.035+
   (c.source==='shipment-part'?.015:0);
 };
 for(const t of txs){
  // Existing imported Possible Notes may be upgraded to a category on reimport.
  // Never overwrite their text; that protection is enforced when applying.
  if(selection.has(t.id))continue;
  const alternatives=[];
  for(let days=-1;days<=14;days++){
   // Bank charge is expected to follow order/shipment date; tolerate one
   // day before for posting/date-zone differences.
   const date=shift(t.date,-days);
   for(const c of byDay.get(date)||[]){
    if(c.ids.some(id=>usedItems.has(id)))continue;
    const ratio=Math.abs(c.amount-cents(t))/Math.max(c.amount,cents(t));
    // A little price divergence is common. A large discrepancy can only
    // be suggested when the dates are close, and is ALWAYS unverified.
    const limit=days<=4?.45:days<=10?.30:.12;
    if(ratio>limit)continue;
    alternatives.push({c,score:rank(t,c)});
   }
  }
  alternatives.sort((a,b)=>a.score-b.score||a.c.id.localeCompare(b.c.id));
  // Same item set can appear as a shipment and an order candidate; they
  // must not create a false tie or a duplicate in the displayed Note.
  const unique=[],signatures=new Set();
  for(const suggestion of alternatives){
   const key=suggestion.c.ids.join('|');
   if(signatures.has(key))continue;
   signatures.add(key);unique.push(suggestion);
   if(unique.length>=4)break;
  }
  if(unique.length){
   const [best,second]=unique;
   // A uniquely strong price+date fit receives a singular Possible Note.
   // Otherwise list actual alternatives with explicit OR, not two bought
   // items attributed to the same charge as fact.
   const alone=!second||second.score-best.score>=.17;
   const options=alone?[best.c]:unique.slice(0,3).map(x=>x.c);
   const note=alone?itemNote(options[0].items,'Possible Amazon: '):
    choiceNote(options);
   // Even without cent-for-cent reconciliation, a uniquely close product
   // can reliably indicate a broad spending category. Keep the purchase
   // identity in the Note marked Possible. Do not allocate item-level cents,
   // label ambiguous choices or assign a category from a date-only hint.
   let suggestedCategory=null;
   const gap=dayGap(t.date,best.c.date);
   const priceDifference=Math.abs(best.c.amount-cents(t))/
    Math.max(best.c.amount,cents(t));
   if(alone&&!ambiguous.has(t.id)&&gap>=0&&gap<=7&&priceDifference<=.13&&
      !existing[t.id]){
    const lines=allocate(best.c.items,cents(t),validCategories);
    const cats=[...new Set((lines||[]).map(l=>l.category))];
    if(cats.length===1&&cats[0]!=='Uncategorized')
     suggestedCategory=cats[0];
   }
   if(note)suggestions.push({transactionId:t.id,accountId:t.accountId,
    date:t.date,amountCents:cents(t),orderId:best.c.id,note,
    confidence:'possible',source:alone?best.c.source:'alternatives',
    suggestedCategory,_candidateIds:options.flatMap(c=>c.ids)});
   continue;
  }
  // Amounts can diverge radically with gift cards, partial refunds or
  // settlement splits. Only use a date-only hint if a SINGLE order exists
  // around the charge; otherwise the source does not establish an item.
  const around=[];
  for(const [orderId,items] of orders){
   const dates=items.map(i=>i.shipmentDate||i.date).filter(Boolean).sort();
   if(!dates.length)continue;
   const date=dates.at(-1),gap=dayGap(t.date,date);
   if(gap<0||gap>5||items.some(i=>usedItems.has(i._id)))continue;
   around.push({id:orderId,items,date});
   if(around.length>1)break;
  }
  if(around.length===1)suggestions.push({transactionId:t.id,
   accountId:t.accountId,date:t.date,amountCents:cents(t),
   orderId:around[0].id,
   note:itemNote(around[0].items,'Possible Amazon (date only): '),
   confidence:'possible',source:'date-only'});
 }
 // If two posted charges claim the same physical product, a match may be
 // useful as a Note, but assigning either category would be unjustified.
 // Include ALL suggestions here, not only the ones eligible for categories.
 const potentialOwners=new Map();
 for(const suggestion of suggestions){
  for(const id of suggestion._candidateIds||[]){
   if(!potentialOwners.has(id))potentialOwners.set(id,new Set());
   potentialOwners.get(id).add(suggestion.transactionId);
  }
 }
 for(const suggestion of suggestions){
  if((suggestion._candidateIds||[]).some(id=>potentialOwners.get(id).size>1))
   suggestion.suggestedCategory=null;
  delete suggestion._candidateIds;
 }
 const uniqueSuggestions=suggestions;
 const matchedBank=new Set(matches.map(m=>m.transactionId));
 const suggestedBank=new Set(uniqueSuggestions.map(m=>m.transactionId));
 return {matches,suggestions:uniqueSuggestions,importedItems:rows.length,orderGroups:orders.size,
  ambiguousOrders:ambiguous.size,unmatchedOrders:orders.size-
   new Set(matches.map(m=>m.orderId.split(' · ')[0])).size,
  bankCharges:txs.length,verifiedBankCharges:matchedBank.size,
  possibleBankCharges:suggestedBank.size,
  unmatchedBankCharges:txs.filter(t=>!matchedBank.has(t.id)&&!suggestedBank.has(t.id)).length};
}
module.exports={match,itemNote,keyFor};
