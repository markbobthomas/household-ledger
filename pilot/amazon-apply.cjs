'use strict';
// Pure import proposal: only existing private category overrides and
// account-qualified transaction Note preferences can change. No bank edits.
const {keyFor}=require('./amazon-pairing.cjs');
function prepare(result,before={}){
 const priorNotes=before.predictions?.transactionNotes||{},
  nextNotes={...priorNotes},
  allocations={...(before.amazonAllocations||{})},
  overrides={...(before.categoryOverrides||{})},
  addedNotes=new Set(),revisedCategories=new Set(),likelyCategories=new Set();
 const entries=[...(result.matches||[]),...(result.suggestions||[])];
 for(const proposal of entries){
  const key=keyFor({accountId:proposal.accountId,id:proposal.transactionId});
  if(typeof priorNotes[key]==='string'&&priorNotes[key].trim())continue;
  if(!proposal.note||proposal.note.length>160)continue;
  nextNotes[key]=proposal.note;
  addedNotes.add(proposal.transactionId);
 }
 for(const proposal of result.matches||[]){
  if(proposal.notesOnly)continue;
  const id=proposal.transactionId,prior=allocations[id];
  const changed=!prior||prior.orderId!==proposal.orderId||
   JSON.stringify(prior.lines)!==JSON.stringify(proposal.lines);
  if(!changed)continue;
  const chosen=proposal.categories.find(c=>c!=='Uncategorized')||'Uncategorized';
  overrides[id]=proposal.needsReview?'Uncategorized':chosen;
  allocations[id]={orderId:proposal.orderId,amountCents:proposal.amountCents,
   lines:proposal.lines};
  revisedCategories.add(id);
 }
 // A product whose amount/date is uniquely close AND whose items all share
 // one recognizable category can fill an empty category. Its Note remains
 // explicitly Possible, and no cent allocations are invented.
 for(const proposal of result.suggestions||[]){
  if(!proposal.suggestedCategory)continue;
  const id=proposal.transactionId;
  if(allocations[id])continue;
  if(overrides[id]!==undefined&&overrides[id]!=='Uncategorized')continue;
  if(overrides[id]===proposal.suggestedCategory)continue;
  overrides[id]=proposal.suggestedCategory;
  revisedCategories.add(id);
  likelyCategories.add(id);
 }
 const changedIds=new Set([...addedNotes,...revisedCategories]),
  hasNotes=addedNotes.size>0,
  nextPredictions=hasNotes?{...(before.predictions||{}),transactionNotes:nextNotes}:
   before.predictions||{},
  next={...before,categoryOverrides:overrides,amazonAllocations:allocations,
   predictions:nextPredictions},
  report={
   importedItems:result.importedItems,orderGroups:result.orderGroups,
   matches:result.matches.length,ready:changedIds.size,
   needsReview:result.matches.filter(m=>m.needsReview).length,
   alreadyImported:result.matches.filter(m=>m.alreadyImported).length,
   ambiguousOrders:result.ambiguousOrders,unmatchedOrders:result.unmatchedOrders,
   bankCharges:result.bankCharges,verifiedBankCharges:result.verifiedBankCharges,
   possibleBankCharges:result.possibleBankCharges,
   unmatchedBankCharges:result.unmatchedBankCharges,
   notesReady:addedNotes.size,
   confidentCategories:[...revisedCategories].filter(id=>overrides[id]!=='Uncategorized').length,
   likelyCategories:likelyCategories.size,
   exactCategories:[...revisedCategories].filter(id=>!likelyCategories.has(id)&&
    overrides[id]!=='Uncategorized').length,
   examples:result.matches.slice(0,35).map(m=>({
    date:m.date,amountCents:m.amountCents,orderId:m.orderId,
    categories:m.categories,needsReview:m.needsReview,
    note:m.note,confidence:m.confidence,notesOnly:m.notesOnly
   })),
   suggestions:result.suggestions.slice(0,35).map(m=>({
    date:m.date,amountCents:m.amountCents,note:m.note,confidence:m.confidence,
    suggestedCategory:m.suggestedCategory||null
   })),
   applied:0
  };
 return {next,nextPredictions,hasNotes,categoryChanged:revisedCategories.size>0,
  ready:changedIds.size,report};
}
module.exports={prepare};
