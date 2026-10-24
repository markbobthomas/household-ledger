'use strict';
const assert=require('node:assert/strict');
const H=require('../planner-history.js');
const I=require('../planner-intelligence.js');
const T=require('../planner-transactions.js');
const accounts=[
 {id:'checking',name:'Primary Checking',accountType:'checking',transactionAccount:'Checking'},
 {id:'savings',name:'Reserve',accountType:'savings'},
 {id:'card',name:'Visa',accountType:'credit',transactionAccount:'Visa'}
],asOf='2026-10-20',store={predictions:{}};
const tx=(id,date,merchant,amount,accountId='checking',type='expense',other={})=>
 ({id,date,merchant,amount,accountId,type,pending:false,...other});
const mortgage=[tx('m1','2026-08-03','Home Mortgage ACH',2000),
 tx('m2','2026-09-03','Home Mortgage ACH',2000)];
const two=H.candidates(mortgage,accounts,asOf,store.predictions,[]);
assert.equal(two.length,1,'Two historical payments are sufficient for the Reviews queue');
assert.equal(two[0].amount,2000);
assert.equal(two[0].frequency,'monthly');
assert.equal(two[0].nextDate,'2026-11-03');
assert.equal(two[0].confidence,'Low');
assert.equal(two[0].examples.length,2);
assert.equal(store.predictions.futureRecurringRules,undefined,'Review candidate does not create a debit');
assert.equal(H.candidates([mortgage[0]],accounts,'2026-08-20',{},[]).length,1,
 'A single clear mortgage payment triggers review, not automatic debit');
const obscure=tx('pfc1','2026-09-16','XYZ FINANCE',2000,'checking','expense',{
 personal_finance_category:{primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_MORTGAGE_PAYMENT'}
});
assert.equal(H.candidates([obscure],accounts,asOf,{},[]).length,1,
 'Plaid loan mortgage detail raises even opaque bank descriptions for review');
const irregular=H.candidates([
 tx('ins1','2026-08-03','Monthly Insurance',123),
 tx('ins2','2026-09-24','Monthly Insurance',123)
],accounts,asOf,{},[]);
assert.equal(irregular.length,1,'Two bill payments still enter Reviews even when dates drift substantially');
assert.equal(irregular[0].confidence,'Low');
assert.match(irregular[0].reason,/calendar timing varies/);
const singleGrocery=H.candidates([tx('g1','2026-09-17','Safeway',84)],accounts,asOf,{},[]);
assert.equal(singleGrocery.length,1,
 'Every recent payment, including an ordinary purchase, may be proposed for review');
assert.equal(singleGrocery[0].confidence,'Needs confirmation',
 'A lone grocery purchase must never be presented as a confirmed recurring bill');
assert.equal(H.candidates([tx('g1','2026-09-17','Safeway',84),tx('g2','2026-10-17','Safeway',84)],
 accounts,asOf,{},[]).length,1,'Two identical expenses at monthly spacing are low confidence');
assert.equal(H.candidates([tx('old1','2025-01-02','Mortgage',2000),
 tx('old2','2025-02-02','Mortgage',2000)],accounts,asOf,{},[]).length,0,
 'Old inactive bill is not a current review candidate');
assert.equal(H.candidates(mortgage,accounts,asOf,{},[{
 date:'2026-11-03',accountId:'checking',merchant:'Home Mortgage ACH',amount:2000
 }]).length,0,'Already predicted recurring charge does not generate another review');
assert.equal(H.candidates(mortgage,accounts,asOf,{
 historyPatternDecisions:{[two[0].key]:'dismissed'}},[]).length,0,
 'Dismissed recurring candidate stays dismissed');
assert.equal(H.candidates([tx('wrong','2026-09-03','Home Mortgage ACH',2000,'savings')],
 accounts,asOf,{},[]).length,1,'Separate bank accounts are never merged');
assert.equal(H.candidates([{...mortgage[0],pending:true}],accounts,asOf,{},[]).length,0,
 'Pending payments do not establish repeating evidence');
assert.equal(H.canPlan(tx('refund','2026-10-11','Tax refund',2000,'checking','refund')),true,
 'Every historical refund offers a manual Make recurring action');
const chosen=two[0];
const rule=T.defineRecurring(store,{
 date:chosen.nextDate,merchant:chosen.merchant,amount:chosen.amount,type:'expense',
 accountId:chosen.accountId,frequency:chosen.frequency
},accounts,asOf,{
 kind:'event',accountId:chosen.accountId,merchant:chosen.merchant,type:'expense',
 amount:chosen.amount,date:chosen.examples.at(-1).date
},mortgage,mortgage.map(t=>t.id));
assert.equal(store.predictions.futureRecurringRules.length,1);
assert.equal(T.generatedRecurring([rule],asOf,'2027-01-30').events.length,3,
 'Confirming a low-confidence candidate creates future months');
assert.equal(H.candidates(mortgage,accounts,asOf,store.predictions,[]).length,0,
 'Confirmed source recurring bill disappears from Reviews');
assert.ok(H.recommendedRepeating(mortgage,accounts,asOf,store.predictions).some(x=>x.merchant==='Home Mortgage ACH'),
 'The permanent review catalog retains candidates after saving a repeating schedule');
assert.ok(H.recommendedRepeating(mortgage,accounts,asOf,{
 historyPatternDecisions:{[two[0].key]:'dismissed'},
 futureRecurrenceExclusions:{[T.recurrenceKey('checking','expense','Home Mortgage ACH')]:{
  accountId:'checking',type:'expense',merchant:'Home Mortgage ACH',historyOptOut:true}}
}).some(x=>x.key===two[0].key),
 'Ignored/excluded bank payments remain discoverable in Recommended repeating');
assert.equal(H.recommendedRepeating([tx('old1','2025-01-02','Mortgage',2000),
 tx('old2','2025-02-02','Mortgage',2000)],accounts,asOf,{}).length,1,
 'Historically observed recurring bills stay recommended even when not recent');

assert.ok(I.missingMortgages(mortgage,{},accounts,asOf).length>0,
 'Missing mortgage helper remains available independently');
const obscureSingle=H.candidates([
 tx('unknown-one','2026-10-10','Bluebird Services',157.42)
],accounts,asOf,{},[]);
assert.equal(obscureSingle.length,1,'Every recent generic merchant is considered for Reviews');
assert.equal(obscureSingle[0].type,'expense');
assert.equal(obscureSingle[0].frequency,'monthly',
 'With no cadence evidence, the proposed date is editable, not assumed certain');
const unpairedACH=H.candidates([
 tx('ach-first','2026-09-09','Bluebird ACH',157.42,'checking','transfer',{cashDirection:'out'}),
 tx('ach-second','2026-10-09','Bluebird ACH',157.42,'checking','transfer',{cashDirection:'out'})
],accounts,asOf,{},[]);
assert.equal(unpairedACH.length,1,
 'Outgoing ACH transfers get the same recurring review logic as expenses');
assert.equal(unpairedACH[0].type,'expense','Unpaired ACH debit is suggested as an expense');
const matchedHousehold=H.candidates([
 tx('paired','2026-10-09','Transfer to Savings',300,'checking','transfer',
  {cashDirection:'out',pairedTransactionId:'bank-other'})
],accounts,asOf,{},[]);
assert.equal(matchedHousehold.length,0,'Verified linked transfers cannot become double counted bills');
const noDouble=H.candidates([
 tx('a','2026-09-09','Bluebird Services',157.42),
 tx('b','2026-10-09','Bluebird Services',157.42)
],accounts,asOf,{futureRecurringRules:[{
 kind:'event',type:'expense',originalAccountId:'checking',originalMerchant:'Bluebird Services',
 merchant:'Bluebird Services',matchNames:['bluebird services'],
 matchAmount:157.42,amount:160,frequency:'monthly',date:'2026-11-24'
}]},[]);
assert.equal(noDouble.length,0,
 'User-confirmed generic schedule excludes old automatic/review variants after date and amount edits');
const changedConfirmed=H.candidates([
 tx('prior-amount','2026-09-09','Bluebird Services',157.42),
 tx('new-amount','2026-10-09','Bluebird Services',188)
],accounts,asOf,{futureRecurringRules:[{
 kind:'event',originalAccountId:'checking',originalMerchant:'Bluebird Services',
 merchant:'Bluebird Services',matchNames:['bluebird services'],
 matchAmount:157.42,amount:157.42,frequency:'monthly',date:'2026-11-09'
}]},[]);
assert.equal(changedConfirmed.length,0,
 'A variable bill with a new posted amount remains one confirmed recurring stream, not another reviewable bill');
const ranked=H.candidates([
 tx('known1','2026-09-06','Storage Payment',82),
 tx('known2','2026-10-06','Storage Payment',82),
 tx('oneoff','2026-10-18','Snack Stop',13.5)
],accounts,asOf,{},[]);
assert.equal(ranked[0].merchant,'Storage Payment',
 'Evidence-backed repeating payments appear ahead of speculative one-offs');

console.log('PASS History/Reviews: two-payment discovery, single obvious bill, conservative queue, account isolation, no false debit, manual confirmation, persistence and deduplication');
