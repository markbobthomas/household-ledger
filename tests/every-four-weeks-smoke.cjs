'use strict';
const assert=require('node:assert/strict');
const T=require('../planner-transactions.js'),C=require('../planner-core.js');
const P=require('../payment-obligations.js');
const accounts=[
 {id:'checking',name:'Checking',type:'depository',accountType:'checking',
  current:5000,available:5000,simulated:true},
 {id:'savings',name:'Savings',type:'depository',accountType:'savings',
  current:1000,available:1000,simulated:true}
],asOf='2026-10-20',snapshot={asOf,accounts,mode:'demo'};
const state={predictions:{}};
const rent=T.defineRecurring(state,{merchant:'Twenty Eight Day Bill',date:'2026-11-01',
 amount:'200',accountId:'checking',type:'expense',frequency:'every-4-weeks'},accounts,asOf);
assert.equal(rent.frequency,'every-4-weeks');
assert.deepEqual(T.recurrenceDates(rent,asOf,'2027-02-10'),
 ['2026-11-01','2026-11-29','2026-12-27','2027-01-24'],
 'Every four weeks means exactly 28 days, including through month/year boundaries');
assert.deepEqual(T.recurrenceDates({...rent,frequency:'monthly'},asOf,'2027-02-10'),
 ['2026-11-01','2026-12-01','2027-01-01','2027-02-01'],
 'Every four weeks is not the same as monthly');
assert.ok(!T.frequencies.has('once'),'One-time entries remain separate from recurring rules');
const initial=C.materialize(snapshot,[],state.predictions,T,P,90);
const bills=initial.ledger.filter(e=>e.merchant==='Twenty Eight Day Bill');
assert.deepEqual(bills.map(x=>x.date),['2026-11-01','2026-11-29','2026-12-27']);
assert.equal(initial.projection.accounts.find(a=>a.id==='checking').closing,4400,
 'Exactly three 28-day withdrawals reduce the projected balance within 90 days');
assert.equal(initial.projection.household.conservationDifference,0);
const key=T.manualSeriesKey(rent.id);
const edit=T.saveSeriesEdit(state,key,'2026-11-01',{
 merchant:'Twenty Eight Day Bill',date:'2026-11-03',
 amount:225,accountId:'checking',type:'expense'
},accounts,asOf,'every-4-weeks','event');
assert.equal(edit.calendarDay,null,
 'Editing a 28-day schedule must never replace it with a fixed calendar day');
const shifted=C.materialize(snapshot,[],state.predictions,T,P,90);
assert.deepEqual(shifted.ledger.filter(e=>e.merchant==='Twenty Eight Day Bill').map(e=>e.date),
 ['2026-11-03','2026-12-01','2026-12-29'],
 'Edit all future preserves 28-day spacing when the first payment is moved');
assert.equal(shifted.projection.accounts.find(a=>a.id==='checking').closing,4325);
T.resetSeries(state,key);
const reset=C.materialize(snapshot,[],state.predictions,T,P,90);
assert.deepEqual(reset.ledger.filter(e=>e.merchant==='Twenty Eight Day Bill').map(e=>e.date),
 bills.map(e=>e.date),'Reset restores the original 28-day schedule');
const transfers={predictions:{}};
const linked=T.defineRecurring(transfers,{merchant:'Regular Savings Transfer',date:'2026-11-05',
 amount:125,type:'transfer',fromAccountId:'checking',toAccountId:'savings',
 frequency:'every-4-weeks'},accounts,asOf);
assert.equal(linked.kind,'movement');
const moved=C.materialize(snapshot,[],transfers.predictions,T,P,90);
assert.deepEqual(moved.projection.plans.map(e=>e.date),
 ['2026-11-05','2026-12-03','2026-12-31'],
 'Every four weeks supports linked account-to-account transfers');
assert.equal(moved.projection.accounts.find(a=>a.id==='checking').closing,4625);
assert.equal(moved.projection.accounts.find(a=>a.id==='savings').closing,1375);
assert.equal(moved.projection.household.conservationDifference,0,
 'Linked transfers are never double charged');
const fromHistory={predictions:{}};
const bankRow={id:'old-rent',merchant:'Unusual Fixed Debit',date:'2026-10-04',amount:200,
 type:'expense',accountId:'checking',pending:false};
T.defineRecurring(fromHistory,{merchant:bankRow.merchant,date:'2026-11-01',
 amount:200,type:'expense',accountId:'checking',frequency:'every-4-weeks'},
 accounts,asOf,bankRow,[bankRow],['old-rent']);
const userForecast=C.materialize(snapshot,[bankRow],fromHistory.predictions,T,P,90);
assert.equal(userForecast.ledger.filter(e=>e.merchant==='Unusual Fixed Debit').length,3,
 'History confirmation saves the same every-four-weeks frequency');
assert.equal(fromHistory.predictions.futureRecurringRules.length,1,
 'Manual confirmation never creates multiple recurring rules');
assert.throws(()=>T.defineRecurring({predictions:{}},{
 merchant:'Invalid',date:'2026-11-01',amount:20,type:'expense',accountId:'checking',
 frequency:'every 4 weeks approximately'
},accounts,asOf),/how often/);
console.log('PASS every-four-weeks: exact 28-day schedule, separate from monthly, all-future edits, reset, bank History confirmation, linked transfers and projected balances');
