'use strict';
const assert=require('node:assert/strict');
const R=require('../planner-recurrence.js');
const T=require('../planner-transactions.js');
const accounts=[
 {id:'checking',name:'Household Checking',accountType:'checking',transactionAccount:'Checking'},
 {id:'savings',name:'Savings',accountType:'savings'},
 {id:'credit',name:'Visa',accountType:'credit'}
],asOf='2026-10-20',snapshot={accounts,asOf};
const tx=(id,date,merchant,amount,type='expense',other={})=>({
 id,date,merchant,amount,accountId:'checking',type,pending:false,...other});
const mortgage=tx('actual-mortgage','2026-09-15','Home Mortgage ACH',2000,'transfer',{
 cashDirection:'out',accountingKind:'internal_transfer',
 personal_finance_category:{primary:'TRANSFER_OUT',detailed:'TRANSFER_OUT_OTHER_TRANSFER_OUT'}
});
const inferred=R.infer([mortgage],snapshot);
assert.deepEqual(inferred.events.map(e=>e.date),['2026-11-15','2026-12-15','2027-01-15'],
 'Only one posted mortgage can establish future dates, even across skipped current month');
assert.equal(inferred.events[0].amount,2000);
assert.equal(inferred.events[0].type,'expense');
assert.equal(inferred.events[0].accountId,'checking');
assert.equal(inferred.events[0].planConfidence,'strong-mortgage-evidence');
assert.equal(mortgage.type,'transfer','Bank row source remains unchanged');
const two=[tx('x1','2026-09-05','Netflix subscription',20),tx('x2','2026-10-05','Netflix subscription',20)];
assert.equal(R.infer(two,snapshot).events.length,3,
 'Two exact recent monthly subscription bills enter the forecast without waiting for third month');
const cardBills=two.map((t,i)=>({...t,id:'card-'+i,accountId:'credit'}));
assert.equal(R.infer(cardBills,snapshot).events.length,3,
 'Two card subscriptions enter the credit-card forecast without debiting checking at purchase time');
const wages=[
 tx('income-1','2026-09-12','ACME Payroll',3100,'income'),
 tx('income-2','2026-10-12','ACME Payroll',3100,'income')
];
assert.equal(R.infer(wages,snapshot).events.length,3,
 'Two identical genuine paychecks qualify for early fixed recurring deposits');
assert.equal(R.infer([mortgage],snapshot,{futureRecurringRules:[{
 kind:'event',originalAccountId:'checking',matchNames:['home mortgage ach'],matchAmount:2000,
 frequency:'monthly',anchorDate:'2026-12-15',merchant:'Home Mortgage ACH',amount:2000
}]}).events.length,0,'Owner recurring schedule suppresses auto version even when next date moved to December');
assert.equal(R.infer([
 tx('g1','2026-09-08','Safeway',97),tx('g2','2026-10-08','Safeway',97)
],snapshot).events.length,0,
 'Two repeating grocery trips are not automatically called a fixed bill');
assert.equal(R.infer([
 tx('x1','2026-09-05','Netflix subscription',20),
 tx('x2','2026-10-05','Netflix subscription',23)
],snapshot).events.length,0,
 'Two differently priced bills do not become an exact recurring payment');
assert.equal(R.infer([tx('stale','2026-06-15','Home Mortgage ACH',2000)],snapshot).events.length,0,
 'Single mortgage older than one cycle is not silently scheduled');
assert.equal(R.infer([{
 ...mortgage,pairedTransactionId:'another-account-side'
}],snapshot).events.length,0,
 'A verified internal transfer is never recast as mortgage expense');
assert.equal(R.infer([{...mortgage,pending:true}],snapshot).events.length,0,
 'Unposted activity is never sufficient alone to auto debit');
const rejectKey='expense|checking|home mortgage ach';
assert.equal(R.infer([{...mortgage,type:'expense'}],snapshot,{
 plannerRoutineDecisions:{[rejectKey]:{status:'excluded',amount:2000,frequency:'monthly'}}
}).events.length,0,'Explicit rejection blocks automatic renewal');
const scheduled=inferred.events[0],autoMore=inferred.events[1];
const manual={id:'user|mortgage',date:'2026-11-18',merchant:'Home Mortgage ACH',
 accountId:'checking',type:'expense',amount:2000,source:'user-recurring'};
const prior={...scheduled,id:'legacy',date:'2026-11-15',
 source:'historical',account:'Checking'};
const single=R.dedupeEvents([scheduled,manual,prior,autoMore],accounts);
assert.equal(single.events.length,2,'One monthly mortgage plus December, not three for November');
assert.equal(single.events[0].id,'user|mortgage',
 'Owner-scheduled date takes precedence over inferred mortgage due date');
assert.equal(single.removed.length,2);
const moved={...manual,date:'2026-11-25'};
const movedResults=R.dedupeEvents([scheduled,moved],accounts);
assert.equal(movedResults.events.length,1,
 'Owner can deliberately move mortgage more than 5 days while replacing the same monthly debit');
assert.equal(movedResults.events[0].date,'2026-11-25');
const changedPrice={...manual,id:'owner-new-amount',date:'2026-11-27',amount:2600};
const changedResult=R.dedupeEvents([scheduled,changedPrice],accounts);
assert.equal(changedResult.events.length,1,
 'When owner changes both mortgage payment amount and due date, the old auto estimate is removed');
assert.equal(changedResult.events[0].amount,2600,
 'Forecast uses owner-confirmed revised amount, never stale $2,000 auto amount');
const distinctMortgage={...scheduled,id:'other-loan',merchant:'Home mortgage SECOND',
 amount:3500};
const distinct=R.dedupeEvents([scheduled,distinctMortgage],accounts);
assert.equal(distinct.events.length,2,'Two unrelated home loans with different amounts must never collapse');
const sameLenderOtherMortgage={...scheduled,id:'second-mortgage',
 merchant:'Mortgage Second Property',amount:2000};
const otherLoan=R.dedupeEvents([scheduled,sameLenderOtherMortgage],accounts);
assert.equal(otherLoan.events.length,2,
 'Two $2,000 mortgages with distinct lender descriptions must remain two bills');
const separateSameMerchant=[
 {id:'first-post',date:'2026-11-10',accountId:'checking',merchant:'School Tuition',
  type:'expense',amount:500,source:'historical'},
 {id:'second-post',date:'2026-11-13',accountId:'checking',merchant:'School Tuition',
  type:'expense',amount:500,source:'historical'}
];
const uncertainSameSource=R.dedupeEvents(separateSameMerchant,accounts);
assert.equal(uncertainSameSource.events.length,2,
 'Two close, distinct posted tuition bills cannot silently be erased');
assert.equal(uncertainSameSource.conflicts.length,1,
 'Close same-source expenses get an explicit Reviews warning');
const renamed={...scheduled,id:'renamed-mortgage',merchant:'ACH HOME NOTE',
 originalMerchant:'Home Mortgage ACH',date:'2026-11-15',source:'historical'};
const renameResult=R.dedupeEvents([scheduled,renamed],accounts);
assert.equal(renameResult.events.length,1,
 'Explicitly linked former merchant name still consolidates duplicated mortgage predictions');
const differentAccount={...scheduled,id:'checking-two',accountId:'savings'};
assert.equal(R.dedupeEvents([scheduled,differentAccount],accounts).events.length,2,
 'Mortgage debit in separate account cannot be merged');
const twiceMonthly=[
 {id:'jan1',date:'2026-11-01',accountId:'checking',merchant:'Employer',amount:1000,type:'income'},
 {id:'jan15',date:'2026-11-15',accountId:'checking',merchant:'Employer',amount:1000,type:'income'}
];
assert.equal(R.dedupeEvents(twiceMonthly,accounts).events.length,2,
 'Two legitimate twice-monthly wages remain separate');
const explicit={id:'future-add|mortgage',date:'2026-11-16',merchant:'Home Mortgage ACH',
 accountId:'checking',type:'expense',amount:2000,_forecastExtra:true};
assert.equal(R.dedupeEvents([scheduled,explicit],accounts).events[0].id,explicit.id,
 'Explicit owner-added one-off debit replaces duplicate inferred monthly charge');
const existingRule={predictions:{}};
const data={date:'2026-11-15',amount:2000,accountId:'checking',
 merchant:'Home Mortgage ACH',frequency:'monthly',type:'expense'};
const firstRule=T.defineRecurring(existingRule,data,accounts,asOf,{
 kind:'event',accountId:'checking',type:'transfer',merchant:'Home Mortgage ACH',
 amount:2000,date:'2026-09-15'
},[mortgage],['actual-mortgage']);
const replay=T.defineRecurring(existingRule,{...data,date:'2026-11-25'},accounts,asOf,{
 kind:'event',accountId:'checking',type:'expense',merchant:'Home Mortgage ACH',
 amount:2000,date:'2026-10-15'
},[tx('second-bank-row','2026-10-15','Home Mortgage ACH',2000)],['second-bank-row']);
assert.equal(existingRule.predictions.futureRecurringRules.length,1,
 'Same mortgage selected again as a differently classified bank entry updates existing rule');
assert.equal(firstRule.id,replay.id,'Rule retains its stable ID for future edits and overrides');
assert.equal(replay.date,'2026-11-25','Reconfirmation can update future due date');
assert.equal(R.infer([mortgage],snapshot,existingRule.predictions).events.length,0,
 'The saved rule completely blocks bank auto-inference even after date change');
const changedSource={...data,amount:2180,date:'2026-11-29'};
const changedBank=tx('mortgage-new-price','2026-10-15','Home Mortgage ACH',2180);
const updated=T.defineRecurring(existingRule,changedSource,accounts,asOf,{
 kind:'event',accountId:'checking',type:'expense',merchant:'Home Mortgage ACH',
 amount:2180,date:'2026-10-15'
},[changedBank],['mortgage-new-price']);
assert.equal(existingRule.predictions.futureRecurringRules.length,1,
 'Modest rate change updates same recurring mortgage rather than saving another debit');
assert.equal(updated.id,firstRule.id,'Revised amount retains same rule identity');
assert.equal(updated.matchAmount,2180,'The original bank evidence fingerprint follows the newest amount');
const largeChange=T.defineRecurring(existingRule,{...data,amount:3100},accounts,asOf,null,[],[]);
assert.equal(largeChange.id,firstRule.id,
 'A larger variable monthly amount updates the existing recurring merchant instead of creating another stream');
assert.equal(existingRule.predictions.futureRecurringRules.length,1,
 'Only one mortgage rule survives even after a substantial amount correction');
T.defineRecurring(existingRule,{...data,accountId:'savings'},accounts,asOf,null,[],[]);
assert.equal(existingRule.predictions.futureRecurringRules.length,2,
 'Mortgage on another paying account is not mistakenly folded into the first');
// Every payment is considered, not merely mortgage/insurance/brand keywords.
const rent=tx('rent-one','2026-10-02','Apartment Rent',1450);
assert.deepEqual(R.infer([rent],snapshot).events.map(e=>e.date).slice(0,2),
 ['2026-11-02','2026-12-02'],
 'One clearly recurring rent payment is eligible without mortgage-specific naming');
const plaidLoan=tx('auto-loan','2026-10-07','XYZ SERVICER 321',425,'transfer',{
 cashDirection:'out',personal_finance_category:{
  primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_AUTO_LOAN'
 }
});
assert.equal(R.infer([plaidLoan],snapshot).events.length,3,
 'Plaid-identified car loan forecasts after one posting even if merchant name is opaque');
const obscureBill=[
 tx('obscure-1','2026-09-09','ABC Draft 984',82.35),
 tx('obscure-2','2026-10-09','ABC Draft 984',82.35)
];
assert.deepEqual(R.infer(obscureBill,snapshot).events.map(e=>e.date),
 ['2026-11-09','2026-12-09','2027-01-09'],
 'Any same-amount monthly merchant can be forecast after two consistent posted payments');
const irregularThree=[
 tx('gro1','2026-08-08','Safeway',97),
 tx('gro2','2026-09-08','Safeway',97),
 tx('gro3','2026-10-08','Safeway',97)
];
assert.equal(R.infer(irregularThree,snapshot).events.length,3,
 'Even a normally irregular merchant may qualify if THREE exact calendar cycles are observed');
const ordinarySingle=R.infer([tx('coffee1','2026-10-04','Local Coffee',12.5)],snapshot);
assert.equal(ordinarySingle.events.length,0,
 'One unrecognized merchant must not become a fictional forecast automatically');
const weekly=[
 tx('w1','2026-10-06','Weekly Parking Pass',25),
 tx('w2','2026-10-13','Weekly Parking Pass',25)
];
assert.deepEqual(R.infer(weekly,snapshot).events.slice(0,3).map(e=>e.date),
 ['2026-10-27','2026-11-03','2026-11-10'],
 'A two-payment weekly pattern advances weekly, not monthly');
const fortnight=[
 tx('b1','2026-09-28','Housekeeper',80),
 tx('b2','2026-10-12','Housekeeper',80)
];
assert.deepEqual(R.infer(fortnight,snapshot).events.slice(0,2).map(e=>e.date),
 ['2026-10-26','2026-11-09'],
 'Biweekly generic merchant payments are not made monthly');
const quarterly=[
 tx('q1','2026-07-03','Town Fees',75),
 tx('q2','2026-10-03','Town Fees',75)
];
assert.deepEqual(R.infer(quarterly,snapshot).events.map(e=>e.date),['2027-01-03'],
 'Quarterly evidence cannot create three extra monthly charges');
const annual=[
 tx('a1','2025-01-08','Membership Annual',99),
 tx('a2','2026-01-08','Membership Annual',99)
];
assert.deepEqual(R.infer(annual,{accounts,asOf:'2026-11-20'}).events.map(e=>e.date),
 ['2027-01-08'],
 'An annual obligation lands exactly once when its next renewal enters the 90-day forecast');
const genericAch=[
 tx('ach1','2026-09-15','GENERIC ACH PAYEE',160,'transfer',{cashDirection:'out'}),
 tx('ach2','2026-10-15','GENERIC ACH PAYEE',160,'transfer',{cashDirection:'out'})
];
assert.equal(R.infer(genericAch,snapshot).events.length,3,
 'Two unpaired same-dollar ACH debits qualify even when bank calls them transfers');
const suspectedSavings=[
 tx('sv1','2026-09-15','Transfer to Savings',350,'transfer',{cashDirection:'out'}),
 tx('sv2','2026-10-15','Transfer to Savings',350,'transfer',{cashDirection:'out'})
];
assert.equal(R.infer(suspectedSavings,snapshot).events.length,0,
 'Unverified transfers to another household account cannot be confidently charged as bills');
assert.equal(R.infer(suspectedSavings,snapshot).review.length,1,
 'Possible account movements must reach Reviews for clarification');
const manualGeneric={kind:'event',originalAccountId:'checking',
 matchNames:['abc draft 984'],matchAmount:82.35,merchant:'ABC Draft 984',
 accountId:'checking',amount:85,frequency:'monthly',anchorDate:'2026-11-25'};
assert.equal(R.infer(obscureBill,snapshot,{futureRecurringRules:[manualGeneric]}).events.length,0,
 'A user-adjusted ordinary payment overrides bank inference even with changed date and amount');
const autoGeneric=R.infer(obscureBill,snapshot).events[0];
const changedGeneric={...autoGeneric,id:'owner-generic',source:'user-recurring',
 amount:85,date:'2026-11-25'};
const resolvedGeneric=R.dedupeEvents([autoGeneric,changedGeneric],accounts);
assert.equal(resolvedGeneric.events.length,1,'Generic payments also get duplicate protection');
assert.equal(resolvedGeneric.events[0].id,'owner-generic',
 'The owner-defined nonmortgage bill takes precedence after a date and amount edit');
const unrelatedPrices=R.dedupeEvents([
 {id:'a',source:'historical',date:'2026-11-10',merchant:'ABC Utility',
  amount:40,type:'expense',accountId:'checking'},
 {id:'b',source:'early-bank-inference',date:'2026-11-10',merchant:'ABC Utility',
  amount:85,type:'expense',accountId:'checking'}
],accounts);
assert.equal(unrelatedPrices.events.length,2,
 'Different amounts of a generic merchant cannot be erased as duplicate bills');

console.log('PASS direct early-mortgage / two-fixed-bill detection, low-confidence shopping exclusion, blocked/paired cases, manual-date override and cross-source dedupe safety');
