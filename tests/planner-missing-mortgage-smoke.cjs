'use strict';
const assert=require('node:assert/strict');
const Planner=require('../planner-intelligence.js');
const Model=require('../ledger-data.js');
const accounts=[
 {id:'checking',name:'Checking',accountType:'checking',transactionAccount:'Checking'},
 {id:'savings',name:'Savings',accountType:'savings'},
 {id:'card',name:'Visa',accountType:'credit'}
];
const asOf='2026-10-20',actual={
 id:'mort-9',date:'2026-09-03',accountId:'checking',account:'Checking',
 merchant:'Home Mortgage ACH',amount:2000,type:'expense',pending:false
};
const all=[actual,{...actual,id:'mort-8',date:'2026-08-03'},
 {...actual,id:'mort-7',date:'2026-07-03'}];
const empty={events:[]};
const result=Planner.missingMortgages([actual],empty,accounts,asOf);
assert.equal(result.length,1,'Mortgage with only one bank transaction is still flagged, even without 3 months');
assert.equal(result[0].amount,2000,'Actual $2,000 is preserved');
assert.equal(result[0].nextDate,'2026-11-03','Next date proposed from last actual posting day');
assert.equal(result[0].accountId,'checking','The paying account is explicit');
assert.equal(result[0].observed,1);
assert.equal(Planner.missingMortgages(all,empty,accounts,asOf)[0].observed,3,
 'Actual recurring examples are available for review');
assert.equal(Planner.missingMortgages(all,{
 events:[{date:'2026-11-03',kind:'expense',accountId:'checking',
 merchant:'Home Mortgage ACH',amount:2000}]},accounts,asOf).length,0,
 'Do not alert when the real mortgage is already in the forecast');
assert.equal(Planner.missingMortgages(all,{
 events:[{date:'2026-11-03',kind:'expense',accountId:'savings',
 merchant:'Home Mortgage ACH',amount:2000}]},accounts,asOf).length,1,
 'A different paying account must not hide the missing checking mortgage');
assert.equal(Planner.missingMortgages(all,empty,accounts,asOf,{dismissed:[result[0].id]}).length,0,
 'Explicit owner dismissal persists');
assert.equal(Planner.missingMortgages([{
 ...actual,accountId:'card',account:'Visa'}],empty,accounts,asOf).length,0,
 'A credit card charge is never called a mortgage debit from checking');
assert.equal(Planner.missingMortgages([{
 ...actual,id:'stale',date:'2026-01-03'}],empty,accounts,asOf).length,0,
 'Long inactive mortgages are not scheduled without review');
const pfc={primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_MORTGAGE_PAYMENT'};
const legacy={
 ...actual,id:'opaque',merchant:'ABC SERVICING LLC',category:'Other',
 source:{provider:'plaid',verified:true,plaidAmount:2000,personalFinanceCategory:pfc},
 personal_finance_category:pfc,type:'transfer'
};
const state=Model.migrate({accounts:[{id:'checking',name:'Checking',type:'depository'}],
 transactions:[legacy]});
const rows=Model.records(state);
assert.equal(rows[0].type,'expense','Read-only bank mortgage loan payment is recovered as an expense');
const uncertain=Planner.missingMortgages(rows,empty,accounts,asOf);
assert.equal(uncertain.length,1,'Plaid mortgage code identifies lender with an opaque merchant description');
assert.equal(uncertain[0].merchant,'ABC SERVICING LLC');
assert.equal(uncertain[0].amount,2000);
assert.equal(JSON.stringify(state.transactions[0]),JSON.stringify(state.transactions.find(x=>x.id==='opaque')),
 'No bank source mutation is introduced during review');
console.log('PASS missing $2,000 mortgage discovery, one-month fallback, examples, source PFC, account isolation, no duplicate, dismissal and stale filtering');
