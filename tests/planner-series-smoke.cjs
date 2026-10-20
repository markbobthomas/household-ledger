'use strict';
const assert=require('node:assert/strict');
const T=require('../planner-transactions.js'),A=require('../account-forecast.js');
const accounts=[
 {id:'checking',name:'Checking',type:'depository',current:12000,available:12000,simulated:true},
 {id:'credit',name:'Visa',type:'credit',current:1100,simulated:true}
];
const asOf='2026-10-19',snapshot={asOf,mode:'demo',accounts},state={predictions:{}};
const mortgage=(date)=>({id:'hist|'+date.slice(0,7)+'|mortgage',
 source:'historical',type:'expense',accountId:'checking',account:'Checking',merchant:'Mortgage',
 cadence:'monthly',date,amount:2400});
const dates=['2026-11-02','2026-12-02','2027-01-02'],base=dates.map(mortgage);
const key=T.seriesEvent(base[0],'checking');
assert.ok(key.includes('mortgage'),'Series key identifies original merchant/account');
assert.equal(new Set(base.map(e=>T.seriesEvent(e,'checking'))).size,1,'Three months share one stable series');
assert.notEqual(T.seriesEvent({...base[0],accountId:'credit'},'credit'),key,'Accounts remain isolated');
const edit=T.saveSeriesEdit(state,key,'2026-11-02',{
 merchant:'Home mortgage',accountId:'checking',type:'expense',amount:'2530',date:'2026-11-05'
},accounts,asOf,'monthly','event');
assert.equal(edit.startsOn,'2026-11-02');
assert.equal(edit.calendarDay,5);
function projectedEvents(items){
 return items.map(e=>{const k=T.seriesEvent(e,'checking');
  return {...T.applySeries(e,e.date,k,state.predictions.futureSeriesEdits),
   _seriesKey:k,_seriesDate:e.date,_forecastOriginalAccountId:'checking'};
 });
}
let forecast=A.build(snapshot,projectedEvents(base),[],{days:90});
assert.deepEqual(forecast.accounts[0].events.filter(e=>e.kind==='expense').map(e=>[e.date,e.amount]),
 [['2026-11-05',2530],['2026-12-05',2530],['2027-01-05',2530]],
 'All future monthly mortgage forecasts update');
assert.equal(forecast.accounts[0].closing,4410,'Edited mortgage affects balance three times');
assert.equal(forecast.accounts[1].closing,1100,'Mortgage never affects the credit card');
assert.deepEqual(base.map(e=>e.amount),[2400,2400,2400],'Source forecast objects remain unmodified');
const future=mortgage('2027-02-02');
assert.equal(T.applySeries(future,future.date,T.seriesEvent(future,'checking'),state.predictions.futureSeriesEdits).amount,
 2530,'Same saved rule applies to an additional month generated later');
const earlier=mortgage('2026-10-22');
assert.equal(T.applySeries(earlier,earlier.date,T.seriesEvent(earlier,'checking'),state.predictions.futureSeriesEdits).amount,
 2400,'Past start-date occurrence remains unchanged');
T.resetSeries(state,key);
assert.equal(T.applySeries(base[1],base[1].date,key,state.predictions.futureSeriesEdits).amount,2400,'Reset restores inferred amount');
// Payroll twice-monthly shifts both days rather than collapsing them.
const payday={source:'historical',type:'income',merchant:'Employer Payroll',accountId:'checking',cadence:'twice monthly'};
const wageKey=T.seriesEvent(payday,'checking');
T.saveSeriesEdit(state,wageKey,'2026-11-01',{merchant:'Employer Payroll',accountId:'checking',
 type:'income',date:'2026-11-03',amount:3000},accounts,asOf,'twice monthly','event');
for(const [original,expected] of [['2026-11-01','2026-11-03'],['2026-11-15','2026-11-17'],
 ['2026-12-01','2026-12-03'],['2026-12-15','2026-12-17']]){
 assert.equal(T.applySeries({...payday,date:original},original,wageKey,state.predictions.futureSeriesEdits).date,
 expected,'Twice-monthly income spacing preserved');
}
// A recurring card autopay has a different generated plan ID each month,
// but shares the destination card as its series identity.
const cardPlans=dates.slice(0,2).map(d=>({id:'autopay|credit|'+d,origin:'card-autopay',
 fromAccountId:'checking',toAccountId:'credit',amount:320,anchorDate:d,frequency:'once'}));
const cardKey=T.seriesPlan(cardPlans[0]);
assert.equal(T.seriesPlan(cardPlans[1]),cardKey,'All card statement cycles share the same rule');
T.saveSeriesEdit(state,cardKey,'2026-11-02',{
 fromAccountId:'checking',toAccountId:'credit',merchant:'Credit card payment',date:'2026-11-04',amount:340
},accounts,asOf,'monthly','movement');
forecast=A.build(snapshot,[],cardPlans,{days:90,seriesTools:T,
 futureSeriesEdits:state.predictions.futureSeriesEdits});
assert.deepEqual(forecast.plans.map(p=>[p.date,p.amount,p.seriesKey]),
 [['2026-11-04',340,cardKey],['2026-12-04',340,cardKey]]);
assert.equal(forecast.accounts[0].closing,11320,'Checking debited for both card payments once');
assert.equal(forecast.accounts[1].closing,420,'Card liability falls for both payments once');
assert.equal(forecast.diagnostics.pairedMovements.length,2,'No duplicate payment pairs');
// Frequency validation, bad account and invalid dates are rejected without storing a new rule.
assert.throws(()=>T.saveSeriesEdit(state,'', '2026-11-02',{date:'2026-11-03',amount:5,
 merchant:'Invalid',accountId:'checking',type:'expense'},accounts,asOf,'monthly','event'),/editable/);
assert.throws(()=>T.saveSeriesEdit(state,key,'2026-11-02',{date:'2026-11-03',amount:5,
 merchant:'Invalid',accountId:'checking',type:'expense'},accounts,asOf,'irregular','event'),/frequency/);
console.log('PASS recurring mortgage, all future months, 2 payday slots, linked card payments, future persistence, reset, account isolation and validation');
