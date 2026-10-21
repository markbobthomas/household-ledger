'use strict';
// Payroll safety regressions: inferred schedules may never invent averaged
// net pay or delete independent owner-confirmed employer paydays.
const assert=require('node:assert/strict');
const T=require('../planner-transactions.js');
const C=require('../planner-core.js');
const P=require('../payment-obligations.js');
const accounts=[{id:'checking',name:'Main Checking',type:'depository',
 accountType:'checking',current:4000,available:4000,simulated:true}];
const asOf='2026-10-20',snapshot={asOf,mode:'demo',accounts};
const check=(id,date,amount,merchant='North Coast Payroll')=>({
 id,date,amount,merchant,accountId:'checking',type:'income',pending:false,
 personal_finance_category:{detailed:'INCOME_WAGES'}});
const bank=[
 check('a1','2026-09-03',3020),check('b1','2026-09-17',3075),
 check('a2','2026-10-01',3020),check('b2','2026-10-15',3075)
];
const frozen=JSON.stringify(bank);
const build=(rows,prefs={})=>C.materialize(snapshot,rows,prefs,T,P,90);
const incomes=(rows,prefs={})=>build(rows,prefs).ledger.filter(e=>
 e.type==='income'&&e.merchant==='North Coast Payroll');
const inferred=incomes(bank);
assert.deepEqual(inferred.slice(0,4).map(e=>e.date),
 ['2026-10-29','2026-11-12','2026-11-26','2026-12-10'],
 'A 14-day payroll crossing two months is not a twice-monthly calendar recurrence');
assert.deepEqual(inferred.slice(0,4).map(e=>e.amount),[3020,3075,3020,3075],
 'Each paycheck uses the exact historical A/B amount, never a blended artifact');
assert.equal(new Set(inferred.map(e=>e._seriesKey)).size,2);
assert.ok(inferred.every(e=>e.cadence==='every-4-weeks'));
assert.ok(!inferred.some(e=>!new Set([3020,3075]).has(e.amount)),
 'No never-posted payroll amount is generated');

const state={predictions:{}},base={type:'income',accountId:'checking',
 merchant:'North Coast Payroll',frequency:'every-4-weeks'};
const savedB=T.defineRecurring(state,{...base,date:'2026-11-12',amount:3075},
 accounts,asOf,bank[3],bank);
assert.equal(incomes(bank,state.predictions).filter(e=>e.date==='2026-11-12').length,1,
 'Confirmed B paycheck replaces only the inferred B phase');
const autoA=incomes(bank,state.predictions).find(e=>e.date==='2026-10-29');
assert.ok(autoA&&autoA._seriesKey,'The unconfirmed A stream is separately identifiable');
const removed=T.stopRecurrence(state,{...autoA,kind:'event',
 sourceAccountId:'checking',sourceMerchant:'North Coast Payroll',
 sourceType:'income',seriesKey:autoA._seriesKey,baseDate:autoA.date});
assert.equal(removed.autoSeries,true);
assert.equal(removed.removedRules,0);
assert.equal(state.predictions.futureRecurringRules.length,1);
assert.equal(state.predictions.futureRecurringRules[0].id,savedB.id);
assert.deepEqual(incomes(bank,state.predictions).map(e=>e.amount),[3075,3075,3075],
 'Removing inferred A never removes confirmed B');
assert.equal(Object.keys(state.predictions.futureRecurrenceExclusions).length,1);
T.restoreRecurrence(state,removed.key);
assert.deepEqual(incomes(bank,state.predictions).slice(0,4).map(e=>e.amount),
 [3020,3075,3020,3075],'Restoring inferred A leaves confirmed B unchanged');

const savedA=T.defineRecurring(state,{...base,date:'2026-10-29',amount:3020},
 accounts,asOf,bank[2],bank);
assert.equal(state.predictions.futureRecurringRules.length,2);
const untrustedArtifact={
 kind:'event',type:'income',accountId:'checking',merchant:'North Coast Payroll',
 sourceMerchant:'North Coast Payroll',seriesKey:'series|checking|income|north%20coast%20payroll|twice-monthly',
 cadence:'twice-monthly',date:'2026-11-15'
};
const artifact=T.stopRecurrence(state,untrustedArtifact);
assert.equal(artifact.autoSeries,true);
assert.equal(state.predictions.futureRecurringRules.length,2,
 'Deleting a fabricated auto pay schedule never deletes either confirmed paycheck');
assert.deepEqual(incomes(bank,state.predictions).slice(0,4).map(e=>e.amount),
 [3020,3075,3020,3075]);
assert.throws(()=>T.stopRecurrence(state,{
 kind:'event',type:'income',accountId:'checking',merchant:'North Coast Payroll'}),
 /exact paycheck/i,'Ambiguous history-level removal must not delete all employer schedules');
assert.equal(state.predictions.futureRecurringRules.length,2);
T.stopRecurrence(state,{kind:'event',type:'income',accountId:'checking',
 merchant:'North Coast Payroll',recurringRuleId:savedA.id,sourceMerchant:'North Coast Payroll'});
assert.deepEqual(incomes(bank,state.predictions).map(e=>e.amount),
 [3075,3075,3075],'Stopping explicit A preserves explicit B');

// True 1st/15th paydays are possible, but four points alone are insufficient
// to infer the future dates AND amounts without owner confirmation.
const semimonth=[
 check('s1','2026-09-01',3020,'Monthly Payroll'),
 check('s2','2026-09-15',3075,'Monthly Payroll'),
 check('s3','2026-10-01',3020,'Monthly Payroll'),
 check('s4','2026-10-15',3075,'Monthly Payroll')
];
assert.equal(C.analyze(semimonth,accounts,asOf).automatic.length,0,
 'Ambiguous twice-monthly income is review-only, not a fabricated predicted deposit');
assert.ok(C.analyze(semimonth,accounts,asOf).review.length>0);
const irregular=[
 check('i1','2026-08-27',3000,'Variable Payroll'),
 check('i2','2026-09-10',2600,'Variable Payroll'),
 check('i3','2026-09-24',3100,'Variable Payroll'),
 check('i4','2026-10-08',2600,'Variable Payroll')
];
assert.equal(C.analyze(irregular,accounts,asOf).automatic.length,0,
 'Unstable alternating income goes to review instead of inventing an average');
assert.equal(JSON.stringify(bank),frozen,'Posted bank history remains immutable');
console.log('PASS payroll inference and deletion safety: exact income, 14-day calendar lookalikes, independent saved phases, ambiguous removal, review only');
