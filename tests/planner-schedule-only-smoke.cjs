'use strict';
const assert=require('node:assert/strict');
const C=require('../planner-core.js'),T=require('../planner-transactions.js'),
 H=require('../planner-history.js'),P=require('../payment-obligations.js');
const accounts=[
 {id:'checking',name:'Checking',accountType:'checking',current:7000,available:7000,simulated:true},
 {id:'savings',name:'Savings',accountType:'savings',current:2500,available:2500,simulated:true},
 {id:'visa',name:'Visa',accountType:'credit',current:400,simulated:true}
],asOf='2026-10-20',snapshot={asOf,mode:'demo',accounts};
const record=(id,date,merchant,amount,type='expense',extra={})=>
 ({id,date,merchant,amount,type,accountId:'checking',pending:false,...extra});
const payroll=(id,date,amount)=>record(id,date,'North Coast Payroll',amount,'income',{
 personal_finance_category:{detailed:'INCOME_WAGES'}});
const history=[
 record('mort-1','2026-09-15','Mortgage ACH',2000,'transfer',{cashDirection:'out'}),
 record('mort-2','2026-10-15','Mortgage ACH',2000,'transfer',{cashDirection:'out'}),
 record('u1','2026-08-09','Electric Utility',115),
 record('u2','2026-09-09','Electric Utility',155),
 record('u3','2026-10-09','Electric Utility',125),
 payroll('a1','2026-08-14',3020),payroll('b1','2026-08-28',3075),
 payroll('a2','2026-09-11',3020),payroll('b2','2026-09-25',3075),
 payroll('a3','2026-10-09',3020),
 record('grocer','2026-10-01','Safeway',85),
 record('paired','2026-10-12','Transfer to Savings',200,'transfer',{
 cashDirection:'out',pairedTransactionId:'pair-2'})
],original=JSON.stringify(history);
const forecast=prefs=>C.materialize(snapshot,history,prefs,T,P,90);
const legacy=forecast({});
assert.ok(legacy.ledger.some(e=>e.source==='historical'&&e.merchant==='Mortgage ACH'));
assert.ok(legacy.ledger.some(e=>e.source==='historical'&&e.merchant==='Electric Utility'));
assert.equal(legacy.recurrenceMigration.approvedOnly,false);
const income=legacy.recurrenceMigration.legacySeries.filter(x=>x.type==='income');
assert.equal(income.length,2,'Alternating pay phases are independently inventoried');
assert.equal(new Set(income.map(x=>x.seriesKey)).size,2);
assert.ok(income.every(x=>x.historicalIds.length>0),
 'Bank evidence is carried for each phase and can be matched to Review recommendations');
const savedOnly=forecast({recurringForecastMode:'approved-only'});
assert.equal(savedOnly.recurrenceMigration.approvedOnly,true);
assert.equal(savedOnly.recurrenceMigration.legacySeries.length,0);
assert.equal(savedOnly.ledger.filter(e=>e.source==='historical').length,0,
 'History patterns remain evidence only, not a source of future debits or income');
assert.ok(savedOnly.automaticRecurrence.events.length>0,
 'The scanner continues to find recommendations after cutover');
assert.equal(JSON.stringify(history),original,'Immutable bank facts survive mode changes');
assert.ok(H.recommendedRepeating(history,accounts,asOf).some(r=>r.merchant==='Mortgage ACH'),
 'Former automatic mortgage is still eligible for owner review');
const state={predictions:{recurringForecastMode:'approved-only'}};
const base={accountId:'checking',merchant:'North Coast Payroll',type:'income',
 frequency:'every-4-weeks'};
const first=T.defineRecurring(state,{...base,date:'2026-11-06',amount:3020},
 accounts,asOf,history.find(r=>r.id==='a3'),history,['a1','a2','a3']);
let events=forecast(state.predictions).ledger.filter(e=>e.type==='income'&&e.merchant===base.merchant);
assert.deepEqual(events.map(e=>e.date),['2026-11-06','2026-12-04','2027-01-01'],
 'Saving only paycheck A does not automatically inject paycheck B in schedule-only mode');
const second=T.defineRecurring(state,{...base,date:'2026-10-23',amount:3075},
 accounts,asOf,history.find(r=>r.id==='b2'),history,['b1','b2']);
assert.notEqual(first.id,second.id);
events=forecast(state.predictions).ledger.filter(e=>e.type==='income'&&e.merchant===base.merchant);
assert.deepEqual(events.map(e=>e.amount),[3075,3020,3075,3020,3075,3020,3075],
 'Two independent confirmed phases restore fourteen-day income without duplicating it');
T.defineRecurring(state,{date:'2026-11-15',merchant:'Mortgage ACH',amount:2200,
 type:'expense',accountId:'checking',frequency:'monthly'},accounts,asOf,
 history[1],history,['mort-1','mort-2']);
const future=forecast(state.predictions);
assert.equal(future.ledger.filter(e=>e.merchant==='Mortgage ACH').length,3);
assert.equal(future.ledger.filter(e=>e.merchant==='Mortgage ACH').every(e=>e.source==='user-recurring'),true);
assert.equal(future.ledger.some(e=>e.merchant==='Electric Utility'),false,
 'Variable bills require owner approval in schedule-only mode');
state.predictions.futureTransactionAdds=[{
 id:'oneoff',merchant:'Plumber',date:'2026-11-25',accountId:'checking',type:'expense',amount:175
},{
 id:'move',merchant:'Savings transfer',date:'2026-11-25',fromAccountId:'checking',
 toAccountId:'savings',type:'transfer',amount:300
}];
const final=forecast(state.predictions);
assert.equal(final.ledger.filter(e=>e.merchant==='Plumber').length,1,
 'Explicit one-off expenses are preserved after migration');
assert.equal(final.ledger.filter(e=>e.kind==='movement'&&e.merchant==='Savings transfer').length,1,
 'A manually planned transfer remains one linked transaction');
assert.equal(final.projection.household.conservationDifference,0);
assert.equal(JSON.stringify(history),original);
console.log('PASS schedule-only migration, old forecasts, independent payroll, confirmed plans, transfers, and bank safety');
