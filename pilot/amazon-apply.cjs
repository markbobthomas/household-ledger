'use strict';
// Pure import proposal: only existing private category overrides and
// account-qualified transaction Note preferences can change. No bank edits.
const {keyFor}=require('./amazon-pairing.cjs');
function prepare(result,before={},context={}){
 const priorNotes=before.predictions?.transactionNotes||{},
  nextNotes={...priorNotes},
  allocations={...(before.amazonAllocations||{})},
  overrides={...(before.categoryOverrides||{})},
  addedNotes=new Set(),revisedCategories=new Set(),likelyCategories=new Set(),
  noteCategories=new Set();
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
 // Independent second pass: classify item names in saved (or newly written)
 // importer Notes. A ZIP amount mismatch must not block a clear product
 // category. Do not overwrite a user category, an imported allocation or a
 // handwritten Note. Uncertain product identity remains labeled Possible.
 const noteAnalysis=context.transactions?
  require('./amazon-note-categories.cjs').analyze(context.transactions,{
   ...before,
   predictions:{...(before.predictions||{}),transactionNotes:nextNotes},
   categoryOverrides:overrides,amazonAllocations:allocations
  },context.categories||[]):{proposals:[],stats:{}};
 for(const candidate of noteAnalysis.proposals){
  const id=candidate.transactionId;
  if(allocations[id]||(overrides[id]!==undefined&&overrides[id]!=='Uncategorized'))
   continue;
  overrides[id]=candidate.category;
  revisedCategories.add(id);
  noteCategories.add(id);
 }
 const changedIds=new Set([...addedNotes,...revisedCategories]),
  hasNotes=addedNotes.size>0,
  nextPredictions=hasNotes?{...(before.predictions||{}),transactionNotes:nextNotes}:
   before.predictions||{},
  next={...before,categoryOverrides:overrides,amazonAllocations:allocations,
   predictions:nextPredictions},
  report={
   importedItems:result.importedItems||0,orderGroups:result.orderGroups||0,
   matches:(result.matches||[]).length,ready:changedIds.size,
   needsReview:(result.matches||[]).filter(m=>m.needsReview).length,
   alreadyImported:(result.matches||[]).filter(m=>m.alreadyImported).length,
   ambiguousOrders:result.ambiguousOrders,unmatchedOrders:result.unmatchedOrders,
   bankCharges:result.bankCharges??noteAnalysis.stats.amazonCharges??0,
   verifiedBankCharges:result.verifiedBankCharges||0,
   possibleBankCharges:result.possibleBankCharges||0,
   unmatchedBankCharges:result.unmatchedBankCharges||0,
   notesReady:addedNotes.size,
   confidentCategories:[...revisedCategories].filter(id=>overrides[id]!=='Uncategorized').length,
   savedNoteCategories:noteCategories.size,
   savedNoteStats:noteAnalysis.stats,
   likelyCategories:likelyCategories.size,
   exactCategories:[...revisedCategories].filter(id=>!likelyCategories.has(id)&&
    !noteCategories.has(id)&&
    overrides[id]!=='Uncategorized').length,
   examples:(result.matches||[]).slice(0,35).map(m=>({
    date:m.date,amountCents:m.amountCents,orderId:m.orderId,
    categories:m.categories,needsReview:m.needsReview,
    note:m.note,confidence:m.confidence,notesOnly:m.notesOnly
   })),
   suggestions:(result.suggestions||[]).slice(0,35).map(m=>({
    date:m.date,amountCents:m.amountCents,note:m.note,confidence:m.confidence,
    suggestedCategory:m.suggestedCategory||null
   })),
   savedNoteExamples:noteAnalysis.proposals.slice(0,35).map(m=>({
    date:m.date,amountCents:m.amountCents,category:m.category,
    note:m.note,confidence:m.confidence
   })),
   applied:0
  };
 return {next,nextPredictions,hasNotes,categoryChanged:revisedCategories.size>0,
  ready:changedIds.size,report};
}
module.exports={prepare};
