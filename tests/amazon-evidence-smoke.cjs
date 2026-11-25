'use strict';
const assert=require('node:assert/strict');
const Import=require('../pilot/amazon-import.cjs');
const Pair=require('../pilot/amazon-pairing.cjs');
const Apply=require('../pilot/amazon-apply.cjs');
const Evidence=require('../pilot/amazon-evidence.cjs');
const AI=require('../pilot/amazon-ai-categories.cjs');
const Tax=require('../pilot/amazon-taxonomy.cjs');
const cats=['Other','Uncategorized','Shopping','Groceries','Insurance','Healthcare',
 'Kids & Family','Home & Maintenance','Dining','Subscriptions'];
for(const [product,category] of [
 ['Accident protection plan for kids toy','Insurance'],
 ['Health insurance premium','Healthcare'],
 ['Annual digital software subscription','Subscriptions'],
 ['Grocery store prepared meal','Groceries'],
 ['Coffee shop latte','Dining'],['Infant formula','Groceries'],
 ['Coffee beans subscription delivery','Groceries'],
 ['Car seat travel bag','Kids & Family']]){
 assert.equal(Import.classify(product,cats),category,product+' local');
 assert.equal(Tax.refineCategory(product,'Shopping',cats),category,product+' AI');
}
assert.equal(Tax.refineCategory('Generic club membership','Subscriptions',cats),null);
const tx={id:'fictional-1',accountId:'card-1',name:'Amazon Marketplace',
 date:'2026-11-24',amount:54.5,pending:false};
const lines=[
 {orderId:'fake-order',date:'2026-11-20',shipmentDate:'2026-11-22',
 title:'Packaged coffee beans',cents:2500},
 {orderId:'fake-order',date:'2026-11-20',shipmentDate:'2026-11-22',
 title:'Laundry detergent',cents:2950}];
const matched=Import.match(lines,{[tx.id]:tx},{},cats);
assert.equal(matched.matches.length,1);
const saved=Apply.prepare(matched,{}, {transactions:{[tx.id]:tx},categories:cats});
assert.equal(saved.report.evidenceSaved,1);
assert(Evidence.valid(saved.next.amazonEvidence[tx.id],tx));
assert.equal(saved.next.amazonEvidence[tx.id].choices[0].items.length,2);
assert.equal(saved.next.amazonAllocations[tx.id].lines.reduce((a,b)=>a+b.cents,0),5450,
 'Mixed products allocate the ONE original posted charge');
assert.equal(saved.next.categoryProvenance[tx.id].source,'amazon-rule');
assert.equal(Apply.prepare(matched,saved.next,{transactions:{[tx.id]:tx},categories:cats}).ready,0,
 'Repeating the same import must not rewrite saved evidence or add expenses');
const longTitle='Mysterious ZX-998 '+('extra detailed unknown product '.repeat(7));
const unknown={...tx,id:'unknown',amount:17};
const source=[{orderId:'fake-unknown',date:'2026-11-20',shipmentDate:'2026-11-22',
 title:longTitle,cents:1700}];
const matchedUnknown=Import.match(source,{unknown},{},cats);
const savedUnknown=Apply.prepare(matchedUnknown,{}, {transactions:{unknown},categories:cats}).next;
assert(savedUnknown.predictions.transactionNotes[Pair.keyFor(unknown)].length<=160);
assert(savedUnknown.amazonEvidence.unknown.choices[0].items[0].title.length>160,
 'Full title retained even though visible Note is truncated');
const ai=AI.eligible({unknown},savedUnknown,cats,false);
assert.equal(ai.candidates.length,1);
assert.equal(ai.candidates[0].product,savedUnknown.amazonEvidence.unknown.choices[0].items[0].title,
 'AI uses original product evidence rather than truncated Note');
assert.equal(Evidence.review({unknown},savedUnknown,cats).items.length,1);
const manual={categoryOverrides:{unknown:'Shopping'},
 categoryProvenance:{unknown:{source:'manual',category:'Shopping'}},
 predictions:{transactionNotes:{[Pair.keyFor(unknown)]:'My personal Note'}}};
const protectedPlan=Apply.prepare(Import.match(source,{unknown},manual,cats),manual,
 {transactions:{unknown},categories:cats});
assert.equal(protectedPlan.next.categoryOverrides.unknown,'Shopping');
assert.equal(protectedPlan.next.predictions.transactionNotes[Pair.keyFor(unknown)],'My personal Note');
assert.equal(protectedPlan.next.amazonAllocations.unknown,undefined);
assert.equal(Evidence.review({unknown},protectedPlan.next,cats).items.length,0);
const possible=Import.match([{...source[0],cents:1699}],{unknown},{},cats);
const inferred=Apply.prepare(possible,{}, {transactions:{unknown},categories:cats});
assert.equal(inferred.next.amazonAllocations.unknown,undefined);
assert.equal(inferred.next.amazonEvidence.unknown.match,'possible');
assert.equal(Evidence.review({unknown},inferred.next,cats).items[0].requiresVerification,true);
assert.deepEqual(tx,{id:'fictional-1',accountId:'card-1',name:'Amazon Marketplace',
 date:'2026-11-24',amount:54.5,pending:false},'Bank source is unchanged');

const ReviewChoice=require('../pilot/amazon-review-choice.cjs');
const mixed={...tx,id:'mixed',amount:40};
const mixProducts=[
 {orderId:'mixed-order',date:'2026-11-20',shipmentDate:'2026-11-22',
  title:'Packaged coffee beans',cents:2000},
 {orderId:'mixed-order',date:'2026-11-20',shipmentDate:'2026-11-22',
  title:'Unrecognized ZZ-941 object',cents:2000}
];
const mixMatch=Import.match(mixProducts,{mixed},{},cats);
const mixState=Apply.prepare(mixMatch,{}, {transactions:{mixed},categories:cats}).next;
assert.equal(mixState.amazonAllocations.mixed.lines.length,2);
assert.deepEqual(mixState.amazonAllocations.mixed.lines.map(x=>x.category),
 ['Groceries','Uncategorized']);
const mixReview=Evidence.review({mixed},mixState,cats);
assert.equal(mixReview.items.length,1);
const initialQuality=Evidence.quality({mixed},mixState);
assert.equal(initialQuality.exactEvidence,1,'Evidence quality distinguishes verified structured matches');
assert.equal(initialQuality.splitCharges,1);
assert.equal(initialQuality.splitItemLines,2,'Item lines are counted without double-counting bank charges');
assert.equal(initialQuality.unclassifiedItemLines,1);
assert.equal(initialQuality.specificCategoryCharges,0,'Mixed unknown basket is not fully categorized');
assert.equal(initialQuality.manuallyReviewedCharges,0);
assert.equal(mixReview.items[0].lineIndex,1,
 'Only unknown item in a mixed Amazon charge needs review');
assert.equal(AI.eligible({mixed},mixState,cats,false).candidates[0].lineIndex,1,
 'AI fallback sees unknown original product line, not the whole basket');
const decision={transactionId:'mixed',category:'Shopping',lineIndex:1,verified:true};
const improved=ReviewChoice.change({mixed},mixState,decision,cats).next;
assert.deepEqual(improved.amazonAllocations.mixed.lines.map(x=>x.category),
 ['Groceries','Shopping']);
assert.equal(improved.amazonAllocations.mixed.lines.reduce((n,x)=>n+x.cents,0),4000,
 'Manual correction must preserve per-item cents and bank-charge sum');
assert.equal(improved.categoryProvenance.mixed.lines[1].source,'manual');
assert.equal(Evidence.review({mixed},improved,cats).items.length,0);
const approvedQuality=Evidence.quality({mixed},improved);
assert.equal(approvedQuality.specificCategoryCharges,1,'All split lines now have specific categories');
assert.equal(approvedQuality.manuallyReviewedCharges,1,'Approved per-item manual choice is tracked');
assert.equal(approvedQuality.unclassifiedItemLines,0);
assert.equal(Evidence.review({mixed},improved,cats).stats.specificCategoryCharges,1,
 'Private review exposes aggregate quality in its existing response');
const mismatchedEvidence=Evidence.quality({mixed:{...mixed,amount:41}},improved);
assert.equal(mismatchedEvidence.staleEvidence,1,'Bank amount changes invalidate old item evidence');
assert.equal(mismatchedEvidence.specificCategoryCharges,0,'Stale split is never counted as fully categorized');
assert.equal(JSON.stringify(approvedQuality).includes('mixed-order'),false,
 'Aggregate quality does not expose order IDs or product names');

assert.throws(()=>ReviewChoice.change({mixed},mixState,
 {...decision,lineIndex:null},cats),/no longer needs|no longer/);
assert.throws(()=>ReviewChoice.change({mixed},mixState,
 {...decision,lineIndex:0},cats),/allocations changed/i);

console.log('Amazon full evidence, AI fallback, shared taxonomy, provenance and no-double-counting PASS');
