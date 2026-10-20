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
T.defineRecurring(existingRule,{...data,accountId:'savings'},accounts,asOf,null,[],[]);
assert.equal(existingRule.predictions.futureRecurringRules.length,2,
 'Mortgage on another paying account is not mistakenly folded into the first');
console.log('PASS direct early-mortgage / two-fixed-bill detection, low-confidence shopping exclusion, blocked/paired cases, manual-date override and cross-source dedupe safety');
