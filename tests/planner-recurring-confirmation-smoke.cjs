'use strict';
const assert=require('node:assert/strict');
const T=require('../planner-transactions.js'),A=require('../account-forecast.js');
const checking={id:'checking',name:'Checking',accountType:'checking',current:10000,available:10000,simulated:true};
const card={id:'credit',name:'Visa',accountType:'credit',current:1200,simulated:true};
const accounts=[checking,card],asOf='2026-10-19',snapshot={asOf,mode:'demo',accounts},state={predictions:{}};
const reference={key:'event|custom|checking',id:'custom',kind:'event',accountId:'checking',
 type:'expense',merchant:'Home Insurance',amount:200,date:'2026-11-02',baseDate:'2026-11-02'};
const examples=[
 {id:'posted-1',date:'2026-08-02',merchant:'Home Insurance',amount:200,accountId:'checking',type:'expense'},
 {id:'posted-2',date:'2026-09-02',merchant:'Home Insurance',amount:200,accountId:'checking',type:'expense'},
 {id:'other-account',date:'2026-09-02',merchant:'Home Insurance',amount:200,accountId:'credit',type:'expense'},
 {id:'wrong-amount',date:'2026-07-02',merchant:'Home Insurance',amount:400,accountId:'checking',type:'expense'}
];
const suggested=T.findExamples(examples,reference,accounts);
assert.deepEqual(suggested.map(e=>e.id),['posted-2','posted-1'],'Offer only matching merchant, exact amount, original account');
const saved=T.defineRecurring(state,{date:'2026-11-20',merchant:'Home Insurance',amount:250,
 type:'expense',accountId:'checking',frequency:'monthly'},accounts,asOf,reference,examples,['posted-1','posted-2']);
assert.equal(saved.matchAmount,200,'Match old charges even though updated future charge is $250');
assert.equal(saved.sourceAnchorDate,'2026-11-02','Keep original expected schedule as deduplication anchor');
assert.deepEqual(T.recurrenceDates(saved,asOf,'2027-01-17'),['2026-11-20','2026-12-20']);
const oldDec={type:'expense',merchant:'Home Insurance',accountId:'checking',amount:200,date:'2026-12-02',kind:'event'};
assert.ok(T.matchesRecurring(saved,oldDec,accounts),'Suppress old November/December predicted charges after date shift');
assert.ok(!T.matchesRecurring(saved,{...oldDec,amount:400},accounts),'Do not suppress a distinct recurring amount at same merchant');
assert.ok(!T.matchesRecurring(saved,{...oldDec,accountId:'credit'},accounts),'Do not suppress other account');
const generated=T.generatedRecurring(state.predictions.futureRecurringRules,asOf,'2027-01-27');
assert.deepEqual(generated.events.map(e=>e.date),['2026-11-20','2026-12-20','2027-01-20']);
const projection=A.build(snapshot,generated.events,generated.plans,{days:100,seriesTools:T,futureRecurringRules:state.predictions.futureRecurringRules});
assert.deepEqual(projection.events.filter(e=>e.kind==='expense').map(e=>e.amount),[250,250,250],
 'Generates three payments within 90 days');
assert.equal(projection.accounts[0].closing,9250);
assert.ok(projection.events.every(e=>e.recurringRuleId===saved.id),'Generated events retain editor link to recurrence');
const more={...reference,recurringRuleId:saved.id};
T.defineRecurring(state,{date:'2026-11-21',merchant:'Home Insurance Plus',amount:275,
 type:'expense',accountId:'checking',frequency:'monthly'},accounts,asOf,more,examples,[]);
assert.equal(state.predictions.futureRecurringRules.length,1,'Editing confirmed recurrence replaces rather than duplicates');
assert.equal(T.generatedRecurring(state.predictions.futureRecurringRules,asOf,'2027-01-25').events.length,3);
T.removeRecurring(state,saved.id);
assert.equal(state.predictions.futureRecurringRules.length,0,'Stop repeating removes forecast-only rule');
const newTransfer=T.defineRecurring(state,{date:'2026-11-10',merchant:'Savings transfer',
 amount:100,fromAccountId:'checking',toAccountId:'credit',type:'transfer',frequency:'monthly'},accounts,asOf);
assert.equal(newTransfer.kind,'movement');
const paired=T.generatedRecurring(state.predictions.futureRecurringRules,asOf,'2026-12-19');
assert.equal(paired.plans.length,2);
const balances=A.build(snapshot,paired.events,paired.plans,{days:60,seriesTools:T,futureRecurringRules:state.predictions.futureRecurringRules});
assert.equal(balances.accounts[0].closing,9800,'Recurring checking transfers reduce cash exactly once');
assert.equal(balances.accounts[1].closing,1000,'Linked card liability credits exactly once');
const pay=T.defineRecurring(state,{date:'2026-11-01',merchant:'Employer Payroll',amount:1500,
 accountId:'checking',type:'income',frequency:'twice-monthly',secondDay:15},accounts,asOf);
assert.deepEqual(T.recurrenceDates(pay,asOf,'2026-12-31'),['2026-11-01','2026-11-15','2026-12-01','2026-12-15']);
assert.throws(()=>T.defineRecurring(state,{date:'2026-11-10',merchant:'Bad',amount:4,
 type:'expense',accountId:'checking',frequency:'twice-monthly',secondDay:10},accounts,asOf),
 /second payday/);
assert.throws(()=>T.defineRecurring(state,{date:'2026-11-10',merchant:'Bad',amount:4,
 type:'expense',accountId:'checking',frequency:'fortnightly'},accounts,asOf),/Choose how often/);
assert.throws(()=>T.defineRecurring(state,{date:'2026-11-10',merchant:'Bad',amount:4,
 type:'expense',accountId:'checking',frequency:'monthly'},accounts,asOf,reference,
 examples,['wrong-amount']),/same amount/);
const earlyRule=T.defineRecurring(state,{date:'2026-11-02',merchant:'Early Posted Mortgage',
 amount:2000,accountId:'checking',type:'expense',frequency:'monthly'},accounts,asOf);
const earlyGenerated=T.generatedRecurring([earlyRule],'2026-10-30','2026-12-12');
const afterBankPosting=T.postedCoverage(earlyGenerated,[earlyRule],[
 {id:'actual-mortgage',date:'2026-10-29',amount:2000,merchant:'Early Posted Mortgage',
  accountId:'checking',type:'expense',pending:false}
],accounts,'2026-10-30');
assert.equal(afterBankPosting.events.some(e=>e.date==='2026-11-02'),false,
 'A posted debit within 6 days of the forecast must not be debited again');
assert.equal(afterBankPosting.events.some(e=>e.date==='2026-12-02'),true,
 'A posted November payment must not cancel December mortgage');
const otherAccountPosted=T.postedCoverage(earlyGenerated,[earlyRule],[
 {id:'other-card',date:'2026-10-29',amount:2000,merchant:'Early Posted Mortgage',
  accountId:'credit',type:'expense',pending:false}
],accounts,'2026-10-30');
assert.equal(otherAccountPosted.events.some(e=>e.date==='2026-11-02'),true,
 'Posted payments from another account must never cover checking forecasts');
console.log('PASS explicitly confirmed recurring schedule: exact account/merchant/amount examples, moved-date dedupe, generated months, edit/stop, twice-monthly pay, linked transfers, validation');
