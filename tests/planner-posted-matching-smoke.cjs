'use strict';
const assert=require('node:assert/strict');
const T=require('../planner-transactions.js'),Core=require('../planner-core.js');
const asOf='2026-10-22';
const accounts=[{id:'checking',name:'Fictional Checking',accountType:'checking',
 current:8000,available:8000,simulated:true},
 {id:'other',name:'Fictional Other',accountType:'checking',
 current:3000,available:3000,simulated:true}];
const snapshot={asOf,accounts,mode:'demo'};
const post=(id,merchant,amount,date='2026-10-21',accountId='checking')=>
 ({id,merchant,amount,date,accountId,type:'expense',pending:false});
function newRule(state,merchant,amount,date='2026-10-24'){
 return T.defineRecurring(state,{
   date,merchant,amount,type:'expense',accountId:'checking',frequency:'monthly',
   separateSchedule:'on',category:'Utility'
  },accounts,asOf);
}
function cover(state,records,through='2026-11-30'){
 const rules=state.predictions.futureRecurringRules;
 return T.postedCoverage(T.generatedRecurring(rules,asOf,through),
  rules,records,accounts,asOf);
}
const unique={predictions:{}};
const utility=newRule(unique,'Fictional Power',125);
const posted=post('posted-renamed','Unrecognizable Bank ACH',200);
const id=T.linkPostedToSchedule(unique,posted.id,utility.id,[posted],accounts);
assert.equal(id,utility.id);
assert.ok(unique.predictions.futureRecurringRules[0].exampleIds.includes(posted.id));
const covered=cover(unique,[posted]);
assert.ok(!covered.events.some(e=>e.date==='2026-10-24'),
 'Explicit bank transaction ID prevents double counting even if Plaid renamed the merchant and bill amount changed');
assert.ok(covered.events.some(e=>e.date==='2026-11-24'),
 'Only the matching future occurrence is suppressed; later utility bills remain');
const verified=Core.materialize(snapshot,[posted],unique.predictions,T,null,70);
assert.equal(verified.postedMatchReview.length,0);
assert.ok(!verified.ledger.some(e=>e.ruleId===utility.id&&e.date==='2026-10-24'));
assert.ok(verified.ledger.some(e=>e.ruleId===utility.id&&e.date==='2026-11-24'));
assert.ok(verified.projection.diagnostics.balanceMismatches.length===0);
const independent={predictions:{}},water=newRule(independent,'Fictional Water',100),
 irrigation=newRule(independent,'Fictional Water',200);
const uncertain=post('posted-uncertain','Fictional Water',150);
const before=cover(independent,[uncertain]);
assert.equal(before.review.length,1,'Competing similarly timed bills with uncertain amounts need one actionable review');
assert.deepEqual(new Set(before.review[0].candidates.map(c=>c.ruleId)),
 new Set([water.id,irrigation.id]));
assert.equal(before.events.filter(e=>e.date==='2026-10-24').length,2,
 'Uncertain posted bank payment does not silently erase an independent obligation');
const bankCopy=JSON.stringify(uncertain);
T.linkPostedToSchedule(independent,uncertain.id,irrigation.id,[uncertain],accounts);
assert.equal(JSON.stringify(uncertain),bankCopy,'Confirming a bank link never alters bank facts');
const decided=cover(independent,[uncertain]);
assert.equal(decided.review.length,0);
assert.ok(decided.events.some(e=>e.ruleId===water.id&&e.date==='2026-10-24'),
 'The unrelated independent bill remains due');
assert.ok(!decided.events.some(e=>e.ruleId===irrigation.id&&e.date==='2026-10-24'),
 'Confirmed posted payment suppresses exactly its intended schedule occurrence');
assert.equal(decided.events.filter(e=>e.date==='2026-11-24').length,2);
assert.equal(independent.predictions.futureRecurringRules.length,2,
 'Review choices link existing schedules, never create new ones');
const clear={predictions:{}},low=newRule(clear,'Fictional Water',100),
 high=newRule(clear,'Fictional Water',200);
const unambiguous=cover(clear,[post('clear','Fictional Water',100)]);
assert.equal(unambiguous.review.length,0,
 'Strong exact-amount evidence may disambiguate independent streams without adding a review');
assert.ok(!unambiguous.events.some(e=>e.ruleId===low.id&&e.date==='2026-10-24'));
assert.ok(unambiguous.events.some(e=>e.ruleId===high.id&&e.date==='2026-10-24'));
const otherAccount=cover(unique,[post('bad-account','Unrecognizable Bank ACH',200,'2026-10-21','other')]);
assert.ok(otherAccount.events.some(e=>e.date==='2026-10-24'),
 'A payment on another account never covers a checking schedule');
assert.throws(()=>T.linkPostedToSchedule(unique,'bad-account',utility.id,
 [post('bad-account','Unrecognizable Bank ACH',200,'2026-10-21','other')],accounts),/Bank account/);
const pending={...posted,pending:true};
assert.ok(cover(unique,[pending]).events.some(e=>e.date==='2026-10-24'),
 'Pending transactions do not prematurely suppress confirmed predictions');
const distant={predictions:{}};
newRule(distant,'Fictional Service',175,'2026-10-30');
assert.ok(cover(distant,[post('distant','Fictional Service',175,'2026-10-01')]).events
 .some(e=>e.date==='2026-10-30'),'A distant earlier payment in the same calendar month must not remove a later bill');
// Regression: the former seven-day rule silently dropped a payment that had
// aged thirteen days without being posted. Keep the debit in the same ledger,
// reserve it ONCE after the bank's actual current balance, and flag Review.
const reviewDate='2026-10-28',liveSnap={asOf:reviewDate,mode:'demo',accounts},
 lateRule={id:'fictional-monthly-overdue',kind:'event',
  originalAccountId:'checking',accountId:'checking',type:'expense',
  frequency:'monthly',anchorDate:'2026-10-15',merchant:'Fictional Housing ACH',
  originalMerchant:'Fictional Housing ACH',matchNames:['fictional housing ach'],
  amount:1200,exampleIds:[]},latePrefs={futureRecurringRules:[lateRule]},
 policy={weekendPolicy:'friday'};
const missed=Core.materialize(liveSnap,[],latePrefs,T,null,70,policy);
assert.equal(missed.overduePayments.length,1,'Thirteen-day-old missed bill remains actionable');
assert.equal(missed.overduePayments[0].expectedDate,'2026-10-15');
assert.deepEqual(missed.ledger.filter(e=>e.ruleId===lateRule.id).map(e=>e.date).slice(0,2),
 ['2026-10-29','2026-11-13'],
 'A missed withdrawal rolls forward once, while the next monthly anchor is intact');
assert.equal(missed.projection.accounts.find(a=>a.id==='checking').series
 .find(e=>e.date==='2026-10-29').balance,6800,
 'The previously missed debit reduces projected cash balance exactly once');
const stillPending=Core.materialize(liveSnap,[{...post('pending-housing',
 'Fictional Housing ACH',1275,'2026-10-18'),pending:true}],latePrefs,T,null,70,policy);
assert.equal(stillPending.overduePayments.length,1,'A pending withdrawal cannot clear the alert');
const paidLate=Core.materialize(liveSnap,[post('actual-late',
 'Fictional Housing ACH',1275,'2026-10-19')],latePrefs,T,null,70,policy);
assert.equal(paidLate.overduePayments.length,0,
 'Bank payment three business days late and slightly higher amount clears overdue');
assert.ok(!paidLate.ledger.some(e=>e.ruleId===lateRule.id&&e.date==='2026-10-29'),
 'Posting is already included in the actual balance: no double subtraction');
assert.ok(paidLate.ledger.some(e=>e.ruleId===lateRule.id&&e.date==='2026-11-13'),
 'The next monthly due remains in the forecast');

 // A manually moved late prediction remains THE SAME occurrence when it posts.
 // Match the immutable original due date OR the edited date. Do not debit it
 // again merely because the moved date is now in the future.
const moveDate=(date,rule=lateRule)=>({
 futureRecurringRules:[rule],futureTransactionEdits:{
  [T.keyEvent('user|'+rule.id+'|2026-10-15','checking')]:{
   date,merchant:rule.merchant,amount:1200,type:'expense',accountId:'checking'
  }
 }
});
const movedUnpaid=Core.materialize(liveSnap,[],moveDate('2026-11-04'),
 T,null,70,policy);
assert.deepEqual(movedUnpaid.ledger.filter(e=>e.ruleId===lateRule.id).map(e=>e.date).slice(0,2),
 ['2026-11-04','2026-11-13'],
 'Moving the unpaid current bill does not erase it or change the next monthly due');
const movedPaid=Core.materialize(liveSnap,[post('late-but-posted',
 'Fictional Housing ACH',1250,'2026-10-19')],moveDate('2026-11-04'),
 T,null,70,policy);
assert.equal(movedPaid.overduePayments.length,0,
 'Actual posted withdrawal resolves a predicted payment moved into the future');
assert.deepEqual(movedPaid.ledger.filter(e=>e.ruleId===lateRule.id).map(e=>e.date),
 ['2026-11-13','2026-12-15'],
 'Already-posted bill must not be subtracted again at its moved date');
const postedNearMoved=Core.materialize(liveSnap,[post('near-moved',
 'Fictional Housing ACH',1205,'2026-10-27')],moveDate('2026-10-30'),
 T,null,70,policy);
assert.equal(postedNearMoved.ledger.some(e=>e.ruleId===lateRule.id&&e.date==='2026-10-30'),false,
 'Bank posting near moved date covers the original obligation when original posting window has passed');
const movedPending=Core.materialize(liveSnap,[{...post('pending-moved',
 'Fictional Housing ACH',1200,'2026-10-19'),pending:true}],
 moveDate('2026-11-04'),T,null,70,policy);
assert.ok(movedPending.ledger.some(e=>e.ruleId===lateRule.id&&e.date==='2026-11-04'),
 'Pending bank records do not settle moved predictions');
const movedOtherAccount=Core.materialize(liveSnap,[post('wrong-account-moved',
 'Fictional Housing ACH',1200,'2026-10-19','other')],
 moveDate('2026-11-04'),T,null,70,policy);
assert.ok(movedOtherAccount.ledger.some(e=>e.ruleId===lateRule.id&&e.date==='2026-11-04'),
 'Posting from another account cannot settle a moved checking withdrawal');
const movedUnrelated=Core.materialize(liveSnap,[post('unrelated-old',
 'Fictional Housing ACH',1200,'2026-10-01')],
 moveDate('2026-11-04'),T,null,70,policy);
assert.ok(movedUnrelated.ledger.some(e=>e.ruleId===lateRule.id&&e.date==='2026-11-04'),
 'Distant posted debit does not erase a separately owed moved prediction');
const twin={...lateRule,id:'another-equal-bill'};
const movedAmbiguous=Core.materialize(liveSnap,[post('single-bank-payment',
 'Fictional Housing ACH',1200,'2026-10-19')],
 {futureRecurringRules:[lateRule,twin],futureTransactionEdits:{
   ...moveDate('2026-11-04',lateRule).futureTransactionEdits,
   ...moveDate('2026-11-04',twin).futureTransactionEdits
  }},T,null,70,policy);
assert.equal(movedAmbiguous.ledger.filter(e=>e.date==='2026-11-04').length,2,
 'One ambiguous posted payment must not erase two independent equal-amount bills');
assert.ok(movedPaid.projection.diagnostics.balanceMismatches.length===0,
 'Moved-posting reconciliation preserves daily balance integrity');

const wrongAccount=Core.materialize(liveSnap,[post('wrong-account',
 'Fictional Housing ACH',1275,'2026-10-19','other')],latePrefs,T,null,70,policy);
assert.equal(wrongAccount.overduePayments.length,1,'A payment from the wrong account cannot clear bill');
const wrongDay=Core.materialize(liveSnap,[post('wrong-day',
 'Fictional Housing ACH',1275,'2026-10-28')],latePrefs,T,null,70,policy);
assert.equal(wrongDay.overduePayments.length,1,
 'An unrelated later payment beyond the matching date tolerance cannot clear a bill');
const twice={futureRecurringRules:[{...lateRule,id:'twice-housing',anchorDate:'2026-09-15'}]};
const twoMissed=Core.materialize(liveSnap,[],twice,T,null,70,policy);
assert.equal(twoMissed.overduePayments.length,2,
 'Every missing monthly occurrence remains reserved, not only the last one');
assert.equal(twoMissed.ledger.filter(e=>e.ruleId==='twice-housing'&&e.date==='2026-10-29').length,2,
 'Two distinct missed installments are visible on the same next forecast day');
const separate={futureRecurringRules:[lateRule,{
 ...lateRule,id:'fictional-second-bill',amount:280}]};
const distinct=Core.materialize(liveSnap,[post('one-cleared',
 'Fictional Housing ACH',290,'2026-10-17')],separate,T,null,70,policy);
assert.equal(distinct.overduePayments.length,1,
 'Distinct independent same-payee bills are disambiguated by amount');
assert.equal(distinct.overduePayments[0].ruleId,lateRule.id);
const ambiguous={futureRecurringRules:[lateRule,{...lateRule,id:'other-same-value'}]};
const undecided=Core.materialize(liveSnap,[post('ambiguous-bank',
 'Fictional Housing ACH',1205,'2026-10-16')],ambiguous,T,null,70,policy);
assert.equal(undecided.overduePayments.length,2,
 'One ambiguous bank posting never clears two separately confirmed bills');

const changed={predictions:{futureRecurringRules:[{...lateRule,anchorDate:'2026-09-15'}]}},
 current=changed.predictions.futureRecurringRules[0],
 nextWhen=T.recurrenceDates(current,reviewDate,'2026-12-31')[0];
const reSaved=T.defineRecurring(changed,{
 date:nextWhen,merchant:current.merchant,accountId:'checking',
 type:'expense',amount:1200,frequency:'monthly',category:'Housing'
},accounts,reviewDate,{
 kind:'event',recurringRuleId:current.id,sourceAccountId:'checking',
 originalMerchant:current.merchant,originalType:'expense',
 sourceAmount:1200,date:current.anchorDate
});
assert.equal(reSaved.anchorDate,'2026-09-15',
 'Saving unchanged next-date settings keeps original recurrence anchor');
assert.equal(Core.materialize(liveSnap,[],changed.predictions,T,null,70,policy).overduePayments.length,2,
 'Both unpaid monthly payments survive ordinary edits with no manual windows');
const ach={futureRecurringRules:[{...lateRule,id:'fictional-ACH',type:'transfer',
 cashDirection:'out'}]};
assert.equal(Core.materialize(liveSnap,[],ach,T,null,70,policy).overduePayments.length,1,
 'External outgoing recurring bank transfers have an unposted payment alert');
assert.equal(Core.materialize(liveSnap,[{...post('ach-out',
 'Fictional Housing ACH',1210,'2026-10-17'),type:'transfer',
 cashDirection:'out'}],ach,T,null,70,policy).overduePayments.length,0,
 'A posted outgoing ACH transfer can clear its own expected withdrawal');
const oneOff={futureTransactionAdds:[{id:'future-add|fictional-utility',
 date:'2026-10-24',accountId:'checking',merchant:'Fictional Utility',
 type:'expense',amount:200}]};
const missedOne=Core.materialize(liveSnap,[],oneOff,T,null,60,policy);
assert.equal(missedOne.overduePayments.length,1,'One-off withdrawal cannot disappear after due date');
assert.equal(missedOne.ledger.filter(e=>e.id==='future-add|fictional-utility').length,1);
const postedOne=Core.materialize(liveSnap,[
 post('utility-posted','Fictional Utility',217,'2026-10-27')],oneOff,T,null,60,policy);
assert.equal(postedOne.overduePayments.length,0,'A slightly different posted amount clears one-off payment');
// Recurring transfer classified as external ACH remains a cash obligation.
const transferPost={...post('outgoing-cash','Fictional Housing ACH',1210,'2026-10-17'),
 type:'transfer',cashDirection:'out'};
assert.equal(T.historicalScheduleMatches(transferPost,accounts,
 ach.futureRecurringRules).length,1,
 'External outgoing ACH bank row must match user-confirmed cash-out transfer');
assert.equal(T.historicalScheduleMatches(transferPost,accounts,
 [{...lateRule,id:'classified-expense',type:'expense'}]).length,1,
 'The same outgoing Plaid transfer can settle an explicitly categorized expense');
const lateWithWindow={...lateRule,matchDaysAfter:14,matchDaysBefore:14};
const paidByWindow=Core.materialize(liveSnap,[post('late-window',
 'Fictional Housing ACH',1500,'2026-10-25')],{futureRecurringRules:[lateWithWindow]},
 T,null,70,policy);
assert.equal(paidByWindow.overduePayments.length,0,
 'User-confirmed matching window can settle a variable posted debit late');
const preserve={predictions:{futureRecurringRules:[{...lateRule,anchorDate:'2026-09-15',
 matchDaysBefore:5,matchDaysAfter:10}]}};
const currentRule=preserve.predictions.futureRecurringRules[0];
const unchangedDue=T.recurrenceDates(currentRule,reviewDate,'2026-12-31')[0];
const updatedRule=T.defineRecurring(preserve,{
 date:unchangedDue,merchant:currentRule.merchant,accountId:'checking',
 type:'expense',amount:1200,frequency:'monthly',category:'Housing',
 matchDaysBefore:4,matchDaysAfter:9
},accounts,reviewDate,{
 kind:'event',recurringRuleId:currentRule.id,sourceAccountId:'checking',
 originalMerchant:currentRule.merchant,originalType:'expense',
 sourceAmount:1200,date:currentRule.anchorDate
});
assert.equal(updatedRule.anchorDate,'2026-09-15',
 'Saving unchanged next payment date cannot erase older unpaid occurrences');
assert.equal(updatedRule.matchDaysAfter,9,'Only matching bounds change on save');
assert.equal(Core.materialize(liveSnap,[],preserve.predictions,T,null,70,policy)
 .overduePayments.length,2,'Prior due payments remain visible after non-date edits');
// Universal reconciliation across any confirmed monthly cash-out stream:
// a saved next-month anchor does not erase an expected prior-month payment
// when posted bank history proves the same phase. Nothing is persisted.
const recoveredRule={...lateRule,id:'synthetic-lost-anchor',
 anchorDate:'2026-11-26',sourceAnchorDate:'2026-11-26',
 merchant:'Fictional Monthly Provider',originalMerchant:'Fictional Monthly Provider',
 matchNames:['fictional monthly provider'],exampleIds:['prior-proof']};
const historicalEvidence=[post('prior-proof','Fictional Monthly Provider',1200,'2026-09-26')];
assert.equal(T.reconciliationAnchor(recoveredRule,historicalEvidence,accounts,reviewDate),
 '2026-09-26','Confirmed posted history restores the full prior monthly cycle');
const effective=T.reconciliationAnchor(recoveredRule,historicalEvidence,accounts,reviewDate);
assert.equal(recoveredRule.anchorDate,'2026-11-26','Historic recovery does not mutate saved rule');
const rolled=Core.materialize(liveSnap,historicalEvidence,
 {futureRecurringRules:[recoveredRule]},T,null,75,policy);
assert.equal(rolled.overduePayments.length,1,
 'The missed recurring October debit is recognized from historical evidence');
assert.equal(rolled.overduePayments[0].expectedDate,'2026-10-26');
assert.deepEqual(rolled.ledger.filter(e=>e.ruleId===recoveredRule.id).map(e=>e.date).slice(0,2),
 ['2026-10-29','2026-11-26'],
 'Missing cash debit reserved once, next month original date unchanged');
const paidRecovery=Core.materialize(liveSnap,[...historicalEvidence,
 post('paid-recovery','Fictional Monthly Provider',1210,'2026-10-27')],
 {futureRecurringRules:[recoveredRule]},T,null,75,policy);
assert.equal(paidRecovery.overduePayments.length,0,
 'A later matching posted bank transaction resolves the recovered occurrence');
const pendingRecovery=Core.materialize(liveSnap,[...historicalEvidence,
 {...post('pending-recovery','Fictional Monthly Provider',1200,'2026-10-27'),pending:true}],
 {futureRecurringRules:[recoveredRule]},T,null,75,policy);
assert.equal(pendingRecovery.overduePayments.length,1,
 'A pending bank record cannot clear missing cash');
const noProof={...recoveredRule,exampleIds:[]};
assert.equal(T.reconciliationAnchor(noProof,[],accounts,reviewDate),'2026-11-26',
 'A brand-new forward-only schedule is never backdated without bank evidence');
assert.equal(T.reconciliationAnchor(noProof,historicalEvidence,accounts,reviewDate),'2026-11-26',
 'One unrelated same-merchant posting is insufficient to backdate a new plan');
const sourceAnchorRule={...noProof,sourceAnchorDate:'2026-09-24',
 sourceFrequency:'monthly'};
assert.equal(T.reconciliationAnchor(sourceAnchorRule,[],accounts,reviewDate),
 '2026-09-26','Old source date reconstructs missing cycle without needing an exact posting day');
// Saving recurring amount/next date preserves its original audit anchor.
const sourceState={predictions:{futureRecurringRules:[{...lateRule,
 id:'persistent-original-date',anchorDate:'2026-09-26'}]}};
const sourceRef=sourceState.predictions.futureRecurringRules[0];
const nextForEdit=T.recurrenceDates(sourceRef,reviewDate,'2026-12-31')[0];
T.defineRecurring(sourceState,{date:nextForEdit,merchant:sourceRef.merchant,
 accountId:'checking',amount:1350,type:'expense',frequency:'monthly'},
 accounts,reviewDate,{kind:'event',recurringRuleId:sourceRef.id,
 sourceAccountId:'checking',originalMerchant:sourceRef.merchant,
 originalType:sourceRef.type,sourceAmount:1200,date:sourceRef.anchorDate});
assert.equal(sourceState.predictions.futureRecurringRules[0].reconciliationAnchorDate,
 '2026-09-26','Original audit anchor survives future schedule edits');
console.log('PASS posted matching: overdue per occurrence, one-off, pending, ACH, saved anchors, manual matching windows and immutable bank facts');
