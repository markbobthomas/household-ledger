'use strict';
const assert=require('node:assert/strict');
const Core=require('../planner-core.js'),Tools=require('../planner-transactions.js');
const Payments=require('../payment-obligations.js');
const accounts=[
 {id:'checking',name:'Main Checking',accountType:'checking',current:5000,available:5000,simulated:true},
 {id:'visa',name:'Visa',accountType:'credit',current:300,simulated:true}
];
const snapshot={mode:'demo',asOf:'2026-10-19',accounts};
const posted=[{id:'posted-weekend',date:'2026-10-18',accountId:'checking',
 amount:50,type:'expense',merchant:'Real posted Sunday',pending:false}];
const immutable=JSON.stringify(posted);
const extras=[
 {id:'sat-income',date:'2026-10-24',accountId:'checking',type:'income',amount:200,merchant:'Saturday income'},
 {id:'sun-out',date:'2026-10-25',accountId:'checking',type:'expense',amount:75,merchant:'Sunday bill'},
 {id:'card-sat',date:'2026-10-31',accountId:'visa',type:'expense',amount:100,merchant:'Card Saturday'},
 {id:'card-sun',date:'2026-11-01',accountId:'visa',type:'expense',amount:200,merchant:'Card Sunday'}
];
const prefs={
 futureTransactionAdds:extras,
 futureRecurringRules:[
  {id:'payroll',kind:'event',anchorDate:'2026-10-24',accountId:'checking',
   type:'income',frequency:'weekly',amount:150,merchant:'Weekly payroll',scheduleLabel:'Weekly payroll'},
  {id:'utility',kind:'event',anchorDate:'2026-11-01',accountId:'checking',
   type:'expense',frequency:'monthly',amount:50,merchant:'Monthly utility',scheduleLabel:'Monthly utility'}
 ],
 paymentRules:{visa:{
  billingStartDate:'2026-10-01',billingEndDate:'2026-10-31',closingDay:31,
  nextPaymentDate:'2026-11-22',nextDueDate:'2026-11-23',
  fromAccountId:'checking',autopayEnabled:true,method:'statement'
 }}
};
const business=Core.materialize(snapshot,posted,prefs,Tools,Payments,80,{weekendPolicy:'friday'});
const calendarDay=Core.materialize(snapshot,posted,prefs,Tools,Payments,80);
const where=(bundle,name)=>bundle.ledger.filter(e=>e.merchant===name).map(e=>e.date);
assert.deepEqual(where(business,'Saturday income'),['2026-10-23']);
assert.deepEqual(where(business,'Sunday bill'),['2026-10-23']);
assert.deepEqual(where(calendarDay,'Saturday income'),['2026-10-24'],
 'The frozen legacy model still retains its original fixture cadence');
assert.deepEqual(where(business,'Weekly payroll').slice(0,4),
 ['2026-10-23','2026-10-30','2026-11-06','2026-11-13'],
 'Each weekly anchor moves independently to its Friday; no accumulating drift');
assert.deepEqual(where(business,'Monthly utility').slice(0,2),
 ['2026-10-30','2026-12-01'],
 'A monthly first-of-month Sunday moves into prior Friday, but December stays December 1');
assert.deepEqual(where(business,'Card Saturday'),['2026-10-30']);
assert.deepEqual(where(business,'Card Sunday'),['2026-10-30']);
assert.equal(business.ledger.filter(e=>[0,6].includes(new Date(e.date+'T12:00:00Z').getUTCDay())).length,0,
 'No modeled future event or linked transfer posts on a weekend');
const statement=business.payments.statements.find(s=>s.cardId==='visa');
assert.ok(statement,'Card statement is calculated');
assert.equal(statement.statementBalance,300,
 'The statement includes Sunday charges moved into the preceding Friday billing cycle');
assert.deepEqual(statement.predictedTransactions.map(t=>[t.merchant,t.date]),
 [['Card Saturday','2026-10-30'],['Card Sunday','2026-10-30']]);
assert.equal(statement.dueDate,'2026-11-23','Issuer due date must not be rewritten');
assert.equal(statement.withdrawalDate,'2026-11-20','Predicted withdrawal is on preceding Friday');
const linked=business.ledger.filter(x=>x.kind==='movement'&&x.toAccountId==='visa');
assert.equal(linked.length,1);
assert.equal(linked[0].date,'2026-11-20');
const friday=business.projection.accounts.find(a=>a.id==='checking').series.find(p=>p.date==='2026-10-23');
assert.ok(friday.events.some(x=>x.merchant==='Sunday bill'),'Friday actual forecast cash has the shifted debit');
const sat=business.projection.accounts.find(a=>a.id==='checking').series.find(p=>p.date==='2026-10-24');
assert.equal(sat.events.length,0);
assert.equal(friday.balance,sat.balance,'Weekend has no new predicted cash changes');
assert.equal(Core.auditProjection(business.projection).ok,true,'Canonical accounts reconcile');
assert.equal(JSON.stringify(posted),immutable,'Actual Sunday bank transactions stay unchanged');
assert.deepEqual(prefs.futureTransactionAdds,extras,'Saved predicted dates remain unmodified');
assert.equal(Tools.forecastBusinessDate('2026-10-24','2026-10-23'),'2026-10-26',
 'If Friday is already included in an actual bank snapshot, do not retroactively debit or drop it');
console.log('PASS Friday forecast posting: independent anchors, Monday cutoff safeguard, 5-day events, credit statement and linked payment, immutable real history');
