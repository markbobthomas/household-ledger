'use strict';
// One reviewed category decision. Edit the smallest possible unit: an item
// within a verified allocation, or the whole charge when no split is proposed.
// Bank history, payment amounts and all sibling allocations remain immutable.
const Evidence=require('./amazon-evidence.cjs');
const {keyFor}=require('./amazon-pairing.cjs');
function reject(message,status=409){
 const e=Error(message);e.httpStatus=status;throw e;
}
function change(transactions,adjustments={},body,categories=[]){
 if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).sort().join(',')!=='category,lineIndex,transactionId,verified'||
    typeof body.transactionId!=='string'||!body.transactionId||
    typeof body.category!=='string'||typeof body.verified!=='boolean'||
    !(body.lineIndex===null||Number.isSafeInteger(body.lineIndex)&&body.lineIndex>=0))
  reject('Choose a valid Amazon purchase category',400);
 const tx=transactions[body.transactionId];
 if(!Evidence.isAmazon(tx))reject('Unknown posted Amazon charge',400);
 const category=categories.find(c=>c.toLowerCase()===body.category.toLowerCase());
 if(!category||['Uncategorized','Income','Transfer','Savings'].includes(category))
  reject('Invalid spending category',400);
 const e=adjustments.amazonEvidence?.[tx.id],
  note=adjustments.predictions?.transactionNotes?.[keyFor(tx)]||'',
  possible=Evidence.valid(e,tx)?e.match==='possible':
   String(note).startsWith('Possible Amazon');
 if(possible&&!body.verified)reject('Verify the possible product against the charge',400);
 const allocations={...(adjustments.amazonAllocations||{})},
  overrides={...(adjustments.categoryOverrides||{})},
  origins={...(adjustments.categoryProvenance||{})};
 if(body.lineIndex!==null){
  const allocation=allocations[tx.id],lines=allocation?.lines;
  if(!Array.isArray(lines)||!lines.length||
     allocation.amountCents!==Evidence.amount(tx)||
     lines.reduce((n,l)=>n+Number(l.cents||0),0)!==Evidence.amount(tx)||
     !lines.every(l=>typeof l.title==='string'&&
      Number.isSafeInteger(l.cents)&&l.cents>0)||
     body.lineIndex>=lines.length||
     !['Other','Uncategorized'].includes(lines[body.lineIndex].category))
   reject('Item allocations changed. Reload the review.');
  if(origins[tx.id]?.lines?.[body.lineIndex]?.source==='manual')
   reject('This Amazon item was already reviewed');
  const nextLines=lines.map((line,i)=>i===body.lineIndex?
   {...line,category}:line);
  allocations[tx.id]={...allocation,lines:nextLines};
  overrides[tx.id]=nextLines.some(l=>l.category==='Uncategorized')?
   'Uncategorized':nextLines[0].category;
  origins[tx.id]={source:'manual-item',category:overrides[tx.id],
   lines:{...(origins[tx.id]?.lines||{}),
    [body.lineIndex]:{source:'manual',category}}};
 }else{
  if(!Evidence.review({[tx.id]:tx},adjustments,categories).items
    .some(item=>item.id===tx.id&&item.lineIndex===undefined))
   reject('This charge no longer needs a whole-category review');
  delete allocations[tx.id]; // Explicit user choice only, never an import.
  overrides[tx.id]=category;
  origins[tx.id]={source:'manual',category};
 }
 return {next:{...adjustments,amazonAllocations:allocations,
  categoryOverrides:overrides,categoryProvenance:origins},
  scope:body.lineIndex===null?'amazon-charge':'amazon-item'};
}
module.exports={change};
