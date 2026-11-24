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
  if(!Number.isSafeInteger(amount)||amount<=0||!nearby(amount)||candidates.length>=MAX_GROUPS)return;
  const ids=items.map(i=>i._id).sort();
  const sig=ids.join('|')+'|'+amount;
  if(signatures.has(sig))return;signatures.add(sig);
  const dates=items.map(i=>i.shipmentDate||i.date).filter(Boolean).sort();
  if(!dates.length)return;
  candidates.push({id,items,ids,amount,source,date:dates.at(-1)});
 };
 const perItem=[];
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
   perItem.push({orderId,item,date});
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
 // Suggestions are useful context, not proof. Never write a category for
 // these and mark the note itself as unverified for manual review.
 for(const t of txs){
  if(selection.has(t.id)||ambiguous.has(t.id)||typeof notes[keyFor(t)]==='string'&&notes[keyFor(t)].trim())continue;
  const possible=candidates.filter(c=>
   c.ids.every(id=>!usedItems.has(id))&&
   dayGap(t.date,c.date)>=-1&&dayGap(t.date,c.date)<=10&&
   c.amount!==cents(t)&&
   Math.abs(c.amount-cents(t))<=Math.min(500,Math.max(75,Math.round(cents(t)*.03))));
  possible.sort((a,b)=>{
   const score=c=>Math.abs(c.amount-cents(t))/Math.max(1,cents(t))+
    Math.abs(dayGap(t.date,c.date)-2)*.012;
   return score(a)-score(b);
  });
  let picked=null;
  if(possible.length===1)picked=possible[0];
  else if(possible.length>1){
   const score=c=>Math.abs(c.amount-cents(t))/Math.max(1,cents(t))+
    Math.abs(dayGap(t.date,c.date)-2)*.012;
   if(score(possible[1])-score(possible[0])>=.06)picked=possible[0];
  }
  // Date-only fallback: a lone purchased item near the charge. It is still
  // "Possible" and must never drive an automatic category override.
  if(!picked&&!possible.length){
   const adjacent=perItem.filter(x=>!usedItems.has(x.item._id)&&
    dayGap(t.date,x.date)>=0&&dayGap(t.date,x.date)<=5);
   if(adjacent.length===1)picked={id:adjacent[0].orderId,
    items:[adjacent[0].item],ids:[adjacent[0].item._id],
    source:'date-only'};
  }
  if(picked)suggestions.push({transactionId:t.id,accountId:t.accountId,
   date:t.date,amountCents:cents(t),orderId:picked.id,
   note:itemNote(picked.items,'Possible Amazon: '),
   confidence:'possible',source:picked.source});
 }
 // Avoid assigning the same exported product to two different speculative
 // notes. Suggestions are never verified charge allocations.
 const seenSuggested=new Map(),contested=new Set();
 for(const entry of suggestions){
  const candidate=candidates.find(c=>c.id===entry.orderId&&
   itemNote(c.items,'Possible Amazon: ')===entry.note);
  if(!candidate)continue;
  for(const item of candidate.ids){
   const prior=seenSuggested.get(item);
   if(prior&&prior!==entry.transactionId){
    contested.add(prior);contested.add(entry.transactionId);
   }else seenSuggested.set(item,entry.transactionId);
  }
 }
 const uniqueSuggestions=suggestions.filter(x=>!contested.has(x.transactionId));
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
