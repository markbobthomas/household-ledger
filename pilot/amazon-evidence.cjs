'use strict';
// Private, bounded, per-transaction Amazon evidence. Bank history is never edited.
// The display Note is derived from full titles; the Note is NOT the source record.
const {classify}=require('./amazon-import.cjs');
const {keyFor,itemNote}=require('./amazon-pairing.cjs');
const isAmazon=t=>t&&t.pending!==true&&Number(t.amount)>0&&
 /(?:^|\W)(?:amazon|amzn|amz)(?:\W|$)/i.test(String(t.merchant||'')+' '+String(t.name||''))&&
 /^\d{4}-\d{2}-\d{2}$/.test(String(t.date||''));
const amount=t=>Math.round(Number(t.amount)*100);
function lines(items){
 if(!Array.isArray(items))return [];
 return items.slice(0,150).filter(i=>i&&typeof i.title==='string'&&i.title.trim())
 .map(i=>({title:i.title.slice(0,240),cents:Number.isSafeInteger(i.cents)&&i.cents>0?i.cents:null}));
}
function fromMatch(m){
 const candidate=String(m.confidence||'')==='exact';
 const choices=candidate?[{orderId:m.orderId,items:lines(m.items),date:m.date}]:
  (m.choices||[]).slice(0,3).map(c=>({orderId:String(c.orderId||'').slice(0,100),
    date:String(c.date||''),items:lines(c.items)}));
 if(!choices.length||choices.every(c=>!c.items.length))return null;
 return {version:1,source:'amazon-import',accountId:String(m.accountId||''),
  amountCents:m.amountCents,orderId:String(m.orderId||'').slice(0,100),
  match:candidate?'exact':'possible',uncertainty:m.source||null,
  choices,updatedAt:new Date().toISOString()};
}
function valid(record,tx){
 return record&&record.version===1&&
  String(record.accountId||'')===String(tx.accountId||'')&&
  record.amountCents===amount(tx)&&
  ['exact','possible'].includes(record.match)&&
  Array.isArray(record.choices)&&record.choices.length>0&&record.choices.length<=3;
}
function category(record,categories=[]){
 if(!record||!Array.isArray(record.choices)||!record.choices.length||
    record.uncertainty==='date-only'||
    record.uncertainty==='order-total-no-item-price'||
    record.uncertainty==='owner-selected-no-amount-reconciliation'||
    record.uncertainty==='cloud-unverified-settlement'||
    record.uncertainty==='payment-transaction-no-item-prices'||
    record.uncertainty==='payment-order-products-not-shipment-verified')return null;
 let chosen=null;
 for(const choice of record.choices){
  if(!Array.isArray(choice.items)||!choice.items.length)return null;
  const all=new Set(choice.items.map(i=>classify(i.title,categories)));
  if(all.size!==1||all.has('Uncategorized'))return null;
  const current=[...all][0];
  if(chosen&&chosen!==current)return null;
  chosen=current;
 }
 return chosen;
}
function note(record){
 if(!record?.choices?.length)return '';
 if(record.match==='exact')return itemNote(record.choices[0].items);
 if(record.uncertainty==='date-only')return itemNote(record.choices[0].items,'Possible Amazon (date only): ');
 if(record.choices.length===1)return itemNote(record.choices[0].items,'Possible Amazon: ');
 return ('Possible Amazon (verify): '+record.choices.map(c=>
   c.items.map(i=>i.title).join(' + ')).join(' OR ')).slice(0,160);
}

/* Aggregate diagnostics only. Count actual posted Amazon charges once, not
 * repeated item lines as extra spending. Keep merchant names, titles, amounts,
 * IDs, and owner choices inside the existing authenticated review only. */
function quality(transactions={},adjustments={}){
 const out={exactEvidence:0,possibleEvidence:0,legacyItemNotes:0,
  staleEvidence:0,unidentifiedCharges:0,specificCategoryCharges:0,
  splitCharges:0,splitItemLines:0,unclassifiedItemLines:0,
  manuallyReviewedCharges:0,aiReviewedCharges:0};
 const evidence=adjustments.amazonEvidence||{},
  allocations=adjustments.amazonAllocations||{},
  notes=adjustments.predictions?.transactionNotes||{},
  categories=adjustments.categoryOverrides||{},
  provenance=adjustments.categoryProvenance||{};
 const specific=value=>typeof value==='string'&&value.trim()&&
  !['Uncategorized','Other','Unassigned'].includes(value.trim());
 for(const tx of Object.values(transactions||{})){
  if(!isAmazon(tx))continue;
  const e=evidence[tx.id],validEvidence=valid(e,tx),
   note=String(notes[keyFor(tx)]||''),
   imported=/^(?:Amazon: |Possible Amazon(?:: | \())/.test(note),
   allocation=allocations[tx.id],lines=allocation?.lines,
   safeSplit=Array.isArray(lines)&&lines.length>0&&
    allocation.amountCents===amount(tx)&&
    lines.every(line=>line&&typeof line.title==='string'&&
     Number.isSafeInteger(line.cents)&&line.cents>0)&&
    lines.reduce((sum,line)=>sum+line.cents,0)===amount(tx);
  if(e&&!validEvidence)out.staleEvidence++;
  if(validEvidence){
   if(e.match==='exact')out.exactEvidence++;
   else out.possibleEvidence++;
  }else if(imported)out.legacyItemNotes++;
  else out.unidentifiedCharges++;
  if(safeSplit){
   out.splitCharges++;
   out.splitItemLines+=lines.length;
   out.unclassifiedItemLines+=lines.filter(line=>!specific(line.category)).length;
  }
  const origin=provenance[tx.id];
  // A mismatched item allocation is NOT proof of a fully categorized
  // new bank amount. Retain a separately confirmed whole-charge manual
  // override, but do not count old imported split categories as valid.
  const categorized=safeSplit?lines.every(line=>specific(line.category)):
   allocation?origin?.source==='manual'&&specific(categories[tx.id]):
    specific(categories[tx.id]);
  if(categorized)out.specificCategoryCharges++;
  const sources=[origin?.source,...Object.values(origin?.lines||{}).map(x=>x?.source)];
  if(sources.some(x=>x==='manual'||x==='manual-item'))out.manuallyReviewedCharges++;
  if(sources.some(x=>x==='amazon-ai-reviewed'||x==='amazon-ai-reviewed-item'))
   out.aiReviewedCharges++;
 }
 return out;
}
function review(transactions={},adjustments={},categories=[]){
 const evidence=adjustments.amazonEvidence||{},overrides=adjustments.categoryOverrides||{},
  provenance=adjustments.categoryProvenance||{},
  notes=adjustments.predictions?.transactionNotes||{};
 const items=[];let total=0,confirmed=0,possible=0,unmatched=0,hasNotes=0;
 for(const tx of Object.values(transactions||{})){
  if(!isAmazon(tx))continue;
  total++;
  const e=evidence[tx.id],good=valid(e,tx),saved=notes[keyFor(tx)]||'';
  const imported=/^(?:Amazon: |Possible Amazon(?:: | \())/.test(saved);
  if(imported)hasNotes++;
  if(good){if(e.match==='exact')confirmed++;else possible++}
  else if(imported){if(saved.startsWith('Amazon: '))confirmed++;else possible++}
  else unmatched++;
  const existing=overrides[tx.id]||null,origin=provenance[tx.id];
  const allocation=adjustments.amazonAllocations?.[tx.id];
  const splitLines=Array.isArray(allocation?.lines)?allocation.lines:null;
  const safeSplit=splitLines&&splitLines.length&&allocation.amountCents===amount(tx)&&
   splitLines.every(line=>line&&typeof line.title==='string'&&
    Number.isSafeInteger(line.cents)&&line.cents>0)&&
   splitLines.reduce((n,line)=>n+line.cents,0)===amount(tx);
  if(safeSplit){
   // Review ONLY unknown product lines; never collapse a mixed Amazon purchase
   // into one transaction-level category and silently discard its split.
   if(origin?.source==='manual')continue;
   for(let lineIndex=0;lineIndex<splitLines.length;lineIndex++){
    const line=splitLines[lineIndex];
    if(!['Uncategorized','Other'].includes(line.category)||items.length>=500||
       origin?.lines?.[lineIndex]?.source==='manual')continue;
    const proposed=classify(line.title,categories);
    items.push({id:String(tx.id),lineIndex,date:String(tx.date),
     amountCents:line.cents,merchant:String(tx.merchant||tx.name||'Amazon').slice(0,100),
     note:'Amazon: '+line.title.slice(0,150),match:'exact',
     currentCategory:line.category,suggestedCategory:proposed==='Uncategorized'?null:proposed,
     requiresVerification:false,protectedOther:false});
   }
   continue;
  }
  // An explicitly chosen specific category is never offered for replacement.
  if(existing&&existing!=='Other'&&existing!=='Uncategorized')continue;
  if(existing==='Other'&&origin?.source==='manual')continue;
  let suggested=good?category(e,categories):null;
  if(!suggested&&saved){
   // Legacy imported Notes, predating structured evidence, remain usable.
   const out=require('./amazon-note-categories.cjs').categoryForNote(saved,categories);
   if(out.status==='ready')suggested=out.category;
  }
  // A confirmed "Other" is reviewable only where a concrete product proposal
  // gives a useful improvement. Avoid a backlog of unrelated retailer charges.
  if(existing==='Other'&&!suggested)continue;
  if(items.length>=500)continue;
  items.push({id:String(tx.id),date:String(tx.date),amountCents:amount(tx),
   merchant:String(tx.merchant||tx.name||'Amazon').slice(0,100),
   note:String(saved|| (good?note(e):'')).slice(0,160),
   match:good?e.match:saved.startsWith('Amazon: ')?'legacy':
     saved.startsWith('Possible Amazon')?'possible':'unmatched',
   currentCategory:existing||'Uncategorized',
   suggestedCategory:suggested,
   requiresVerification:good?e.match!=='exact':
     saved.startsWith('Possible Amazon'),
   protectedOther:existing==='Other'});
 }
 items.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 return {items,categories:categories.filter(c=>!['Uncategorized','Income','Transfer','Savings'].includes(c)),
  stats:{amazonCharges:total,confirmed,possible,unmatched,notes:hasNotes,review:items.length,
   ...quality(transactions,adjustments)}};
}
module.exports={isAmazon,amount,lines,fromMatch,valid,category,note,review,quality};
