'use strict';
const assert=require('node:assert/strict');
const Accounting=require('../accounting.js');
const Categorization=require('../categorization.js');
const Model=require('../ledger-data.js');
const Forecast=require('../forecast.js');
const Ledger=require('../forecast-ledger.js');
const Planner=require('../planner-intelligence.js');
const Adapter=require('../pilot/data-source.js');
const account={id:'checking',name:'Main Checking',type:'depository',subtype:'checking'};
const card={id:'visa',name:'Visa',type:'credit',subtype:'credit card'};
function bank(month,day,merchant,amount,pfc={primary:'TRANSFER_IN',detailed:'TRANSFER_IN_OTHER_TRANSFER_IN'},id='checking'){
 return {id:id+'|'+month+'|'+day+'|'+merchant,accountId:id,date:month+'-'+String(day).padStart(2,'0'),
  merchant,name:merchant,amount,category:pfc,pending:false};
}
function run(rows,asOf='2026-10-19',month='2026-11'){
 const input=Model.migrate({accounts:[account,card],transactions:rows.map(r=>Adapter.record(r,r.accountId==='visa'?card:account))});
 const normalized=Model.records(input);
 const expected=Forecast.forecastIncome(normalized,month,asOf,input.predictions.patternRules);
 const ledger=Ledger.build(input,normalized,asOf,70,Forecast,Model);
 const result=Planner.project(input,normalized,ledger.events,asOf);
 return {input,normalized,expected,result};
}
const originalMonths=['2026-07','2026-08','2026-09'];
const fixed=originalMonths.map(m=>bank(m,12,'ACME Employer Payroll',-3000));
const baseline=run(fixed);
assert.ok(baseline.normalized.every(t=>t.type==='income'),
 'Incoming employer payroll must not stay TRANSFER_IN');
assert.ok(baseline.expected.expected.some(x=>x.type==='income'&&x.date==='2026-11-12'),
 'Monthly payroll inferred in a future month');
assert.ok(baseline.result.events.some(x=>x.type==='income'&&x.date==='2026-11-12'&&x.amount===3000),
 'Validated monthly payroll reaches final balance plan');
const variable=originalMonths.map((m,i)=>bank(m,12,'ACME Employer Payroll',-[3000,3050,2990][i]));
const changed=run(variable);
assert.ok(changed.result.events.some(x=>x.type==='income'&&x.date==='2026-11-12'&&x.amount===2990),
 'Slightly variable payroll uses lowest recent net amount');
const tooVariable=originalMonths.map((m,i)=>bank(m,12,'ACME Employer Payroll',-[3000,3500,2700][i]));
const rejected=run(tooVariable);
assert.equal(rejected.result.events.filter(x=>x.type==='income').length,0,
 'Highly variable incoming amount is not treated as safe precise payroll');
const ownTransfer=originalMonths.map(m=>bank(m,12,'Transfer from my savings',-3000));
const internal=run(ownTransfer);
assert.ok(internal.normalized.every(x=>x.type==='transfer'));
assert.equal(internal.result.events.filter(x=>x.type==='income').length,0,
 'Recurring movements between owned accounts are never fabricated earnings');
const generic=run(originalMonths.map(m=>bank(m,12,'Unidentified ACH Credit',-3000)));
assert.equal(generic.result.events.filter(x=>x.type==='income').length,0,
 'Unknown ACH credits are not confidently inferred as earnings');
const pfcIncome=run(originalMonths.map(m=>bank(m,12,'ACH Credit 4752',-3000,
 {primary:'INCOME',detailed:'INCOME_WAGES'})));
assert.equal(pfcIncome.result.events.filter(x=>x.type==='income').length,1,
 'Bank income-wage category identifies payroll even without merchant name');
const cardCredit=Adapter.record(bank('2026-09',12,'Payment Received',-1000,
 {primary:'TRANSFER_IN',detailed:'TRANSFER_IN_OTHER_TRANSFER_IN'},'visa'),card);
assert.notEqual(cardCredit.type,'income','Credit-card payment is not earned income');
const twice=[];
for(const m of originalMonths)for(const day of [1,15])twice.push(bank(m,day,'ACME Employer Payroll',-1800));
const semimonthly=run(twice);
assert.deepEqual(semimonthly.result.events.filter(x=>x.type==='income'&&x.date.startsWith('2026-11-'))
 .map(x=>x.date).sort(),['2026-11-01','2026-11-15'],'Both calendar-anchored paydays included');
const biweeks=['2026-07-03','2026-07-17','2026-07-31','2026-08-14','2026-08-28',
 '2026-09-11','2026-09-25','2026-10-09'].map(d=>bank(d.slice(0,7),Number(d.slice(-2)),'ACME Employer Payroll',-2100));
const biweekly=run(biweeks,'2026-10-19','2026-10');
assert.ok(biweekly.result.events.some(x=>x.type==='income'&&x.date==='2026-10-23'),
 'Biweekly payroll should yield the next paycheck');
console.log('PASS income detection: monthly, 1st/15th, biweekly, variable-net conservative, payroll tagged TRANSFER_IN, INCOME_WAGES, and internal/card exclusions');
