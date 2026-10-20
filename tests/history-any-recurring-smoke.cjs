'use strict';
const assert=require('node:assert/strict');
const H=require('../planner-history.js');
const T=require('../planner-transactions.js');
const accounts=[
 {id:'checking',name:'Checking',accountType:'checking'},
 {id:'savings',name:'Savings',accountType:'savings'},
 {id:'visa',name:'Visa',accountType:'credit'}];
const asOf='2026-10-20';
const row=(id,date,merchant,amount,accountId,type,extra={})=>
 ({id,date,merchant,amount,accountId,type,pending:false,...extra});
const mortgage=row('loan','2026-09-14','HOME LOAN ACH',2000,'checking','transfer',
 {cashDirection:'out',accountingKind:'internal_transfer'});
const suggested=H.draftFor(mortgage,[mortgage],accounts,asOf);
assert.equal(H.canPlan(mortgage),true,'The mortgage transfer must offer Make recurring');
assert.equal(suggested.type,'expense','Unmatched mortgage debit becomes a suggested future checking expense');
assert.equal(suggested.originalType,'transfer');
assert.equal(suggested.accountId,'checking');
assert.equal(suggested.amount,2000);
assert.equal(suggested.nextDate,'2026-11-14');
const gift=row('gift','2026-09-18','Incoming wire',1200,'checking','transfer',
 {cashDirection:'in'});
assert.equal(H.draftFor(gift,[gift],accounts,asOf).type,'income',
 'Incoming unpaired transfers may be explicitly forecast as deposits');
const cardCredit=row('credit','2026-09-19','Statement credit',85,'visa','transfer',
 {cashDirection:'in'});
assert.equal(H.draftFor(cardCredit,[cardCredit],accounts,asOf).type,'refund');
const refund=row('refund','2026-09-20','Merchant return',25,'visa','refund');
assert.equal(H.draftFor(refund,[refund],accounts,asOf).type,'refund');
assert.equal(H.canPlan(refund),true);
assert.equal(H.candidates([refund],accounts,asOf,{},[]).length,0,
 'Choosing refunds manually should not automatically predict a recurring refund');
const out=row('x-out','2026-09-11','Account transfer',400,'checking','transfer',
 {cashDirection:'out',pairedTransactionId:'x-in'});
const incoming=row('x-in','2026-09-12','Account transfer',400,'savings','transfer',
 {cashDirection:'in',pairedTransactionId:'x-out'});
for(const d of [H.draftFor(out,[out,incoming],accounts,asOf),
 H.draftFor(incoming,[out,incoming],accounts,asOf)]){
 assert.equal(d.type,'transfer');
 assert.equal(d.fromAccountId,'checking');
 assert.equal(d.toAccountId,'savings');
}
const pending={...mortgage,id:'pending',pending:true};
assert.equal(H.canPlan(pending),true);
const pendingDraft=H.draftFor(pending,[pending],accounts,asOf);
assert.equal(pendingDraft.sourcePending,true);
assert.equal(pendingDraft.examples.length,0);
const zero=row('zero','2026-09-15','Zero-dollar correction',0,'checking','refund');
assert.equal(H.canPlan(zero),true);
assert.equal(H.draftFor(zero,[zero],accounts,asOf).examples.length,0);
const settings={predictions:{}};
const confirm=T.defineRecurring(settings,{
 date:suggested.nextDate,merchant:suggested.merchant,amount:2000,
 accountId:'checking',type:'expense',frequency:'monthly'
},accounts,asOf,{
 kind:'event',accountId:'checking',type:'transfer',amount:2000,
 merchant:mortgage.merchant,date:mortgage.date,sourceAmount:2000
},[mortgage],['loan']);
assert.equal(confirm.kind,'event');
assert.equal(confirm.type,'expense');
assert.equal(confirm.originalType,'transfer');
assert.equal(T.generatedRecurring([confirm],asOf,'2027-01-30').events.length,3);
const forecast=T.generatedRecurring([confirm],asOf,'2026-11-25').events;
const posted=[{...mortgage,date:'2026-11-11',id:'posted-early'}];
assert.equal(T.postedCoverage({events:forecast,plans:[]},[confirm],
 posted,accounts,'2026-11-12').events.length,0,
 'A posted ACH transfer covers the later confirmed mortgage expense without duplicating it');
const internal=T.defineRecurring({predictions:{}},{
 date:'2026-11-12',merchant:'Account transfer',amount:400,
 type:'transfer',frequency:'monthly',fromAccountId:'checking',toAccountId:'savings'
},accounts,asOf,{
 kind:'movement',fromAccountId:'checking',toAccountId:'savings',
 type:'transfer',merchant:'Account transfer',amount:400,date:'2026-09-11'
},[out,incoming],[]);
assert.equal(internal.kind,'movement');
const plans=T.generatedRecurring([internal],asOf,'2026-11-30').plans;
assert.equal(plans.length,1);
assert.equal(plans[0].fromAccountId,'checking');
assert.equal(plans[0].toAccountId,'savings');
console.log('PASS History allows every actual type; an ACH mortgage becomes expense, a paired transfer stays two-sided, refunds and pending remain manual, and posted mortgage coverage is deduplicated');
