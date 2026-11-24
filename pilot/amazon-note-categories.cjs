'use strict';
// Categorize existing imported Amazon item Notes without rereading an order ZIP.
// Notes and source bank records are immutable inputs. Never classify handwritten
// Notes, date-only guesses, truncated lists, or conflicting product categories.
const {classify}=require('./amazon-import.cjs');
const {keyFor}=require('./amazon-pairing.cjs');
const amazon=t=>t&&t.pending!==true&&Number(t.amount)>0&&
 (/(?:^|\W)(?:amazon|amzn|amz)(?:\W|$)/i.test(String(t.merchant||''))||
  /(?:^|\W)(?:amazon|amzn|amz)(?:\W|$)/i.test(String(t.name||'')));
function categoryForNote(value,categories){
 const note=String(value||'').trim();
 let body='',kind='';
 if(note.startsWith('Amazon: ')){body=note.slice(8);kind='confirmed'}
 else if(note.startsWith('Possible Amazon: ')){body=note.slice(17);kind='possible'}
 else if(note.startsWith('Possible Amazon (verify): ')){
  body=note.slice(26);kind='alternatives';
 }else if(note.startsWith('Possible Amazon (date only): ')){
  return {status:'date-only'};
 }else return {status:'not-imported'};
 if(!body.trim()||/;\s*\+\d+\s+more\s*$/i.test(body))
  return {status:'incomplete'};
 // Truncated multi-item notes may hide a conflicting category. A single
 // truncated title remains usable only when an unambiguous keyword survived.
 if(body.includes('…')&&(body.includes(';')||body.includes(' OR ')||body.includes(' + ')))
  return {status:'incomplete'};
 const alternatives=kind==='alternatives'?body.split(/\s+OR\s+/):[body];
 if(!alternatives.length||alternatives.some(x=>!x.trim()))
  return {status:'ambiguous'};
 const outcomes=[];
 for(const alternative of alternatives){
  const items=alternative.split(/;\s*|\s+\+\s+/).map(x=>x.trim()).filter(Boolean);
  if(!items.length)return {status:'ambiguous'};
  const distinct=[...new Set(items.map(title=>classify(title,categories)))];
  if(distinct.length!==1||distinct[0]==='Uncategorized')
   return {status:distinct.includes('Uncategorized')?'unrecognized':'mixed'};
  outcomes.push(distinct[0]);
 }
 if(new Set(outcomes).size!==1)return {status:'mixed'};
 return {status:'ready',category:outcomes[0],confidence:kind};
}
// Import status must be reported separately from the user's explicit category
// choice. Ledger stores all explicit choices as categoryOverrides, including
// "Other"; it cannot infer why the user chose them or safely overwrite them.
function analyze(transactions,adjustments={},categories=[],options={}){
 const notes=adjustments.predictions?.transactionNotes||{},
  overrides=adjustments.categoryOverrides||{},
  allocations=adjustments.amazonAllocations||{},
  replaceOther=options.replaceOther===true;
 const stats={amazonCharges:0,itemNotes:0,missingNotes:0,
  unrecognized:0,mixed:0,dateOnly:0,incomplete:0,notImported:0,
  alreadyCategorized:0,alreadyAllocated:0,
  existingOther:0,existingSpecific:0,
  recognizable:0,eligibleNotes:0,replaceableOther:0,
  protectedSpecific:0};
 const proposals=[],review=[],skipped=[];
 for(const t of Object.values(transactions||{})){
  if(!amazon(t))continue;
  stats.amazonCharges++;
  const note=notes[keyFor(t)];
  if(typeof note!=='string'||!note.trim()){
   stats.missingNotes++;
   continue;
  }
  const outcome=categoryForNote(note,categories);
  if(outcome.status==='not-imported'){
   stats.notImported++;
   continue;
  }
  stats.itemNotes++;
  const existing=overrides[t.id],hasExisting=
   typeof existing==='string'&&existing.trim()&&existing!=='Uncategorized';
  if(hasExisting){
   stats.alreadyCategorized++;
   if(existing==='Other')stats.existingOther++;
   else stats.existingSpecific++;
  }
  const example={transactionId:t.id,date:t.date,
   amountCents:Math.round(Number(t.amount)*100),note:note.slice(0,160),
   existingCategory:hasExisting?existing:null,
   suggestedCategory:outcome.status==='ready'?outcome.category:null,
   reason:''};
  if(allocations[t.id]){
   stats.alreadyAllocated++;
   example.reason='existing-item-allocation';
  }else if(outcome.status==='date-only'){
   stats.dateOnly++;example.reason='date-only';
  }else if(outcome.status==='incomplete'){
   stats.incomplete++;example.reason='incomplete';
  }else if(outcome.status==='mixed'||outcome.status==='ambiguous'){
   stats.mixed++;example.reason='mixed';
  }else if(outcome.status!=='ready'){
   stats.unrecognized++;example.reason='unrecognized';
  }else{
   stats.recognizable++;
   if(hasExisting&&existing!=='Other'){
    stats.protectedSpecific++;example.reason='protected-specific';
   }else if(existing==='Other'){
    stats.replaceableOther++;
    if(!replaceOther)example.reason='protected-other';
   }
   if(!example.reason){
    stats.eligibleNotes++;
    proposals.push({transactionId:t.id,accountId:t.accountId,
     date:t.date,amountCents:example.amountCents,
     category:outcome.category,confidence:outcome.confidence,
     note:example.note,replaceOther:existing==='Other'});
    continue;
   }
  }
  if(example.reason==='protected-other'){
   // These are actual recognized item names, but the stored category
   // was an explicit "Other" override. Only a separate opt-in may change it.
   review.push(example);
  }else if(skipped.length<35){
   skipped.push(example);
  }
 }
 return {proposals,stats,review:review.slice(0,35),skipped};
}
module.exports={categoryForNote,analyze};
