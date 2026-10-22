'use strict';
const assert=require('node:assert/strict');
const C=require('../planner-core.js');
const snapshot={asOf:'2026-10-21',mode:'demo',accounts:[
 {id:'checking',name:'Checking',accountType:'checking',current:6000,available:5900,simulated:true},
 {id:'card',name:'Card',accountType:'credit',current:350,simulated:true}
]};
const ledger=[
 {id:'income-A',kind:'event',type:'income',accountId:'checking',date:'2026-10-22',amount:2100,merchant:'Employer'},
 {id:'income-B',kind:'event',type:'income',accountId:'checking',date:'2026-10-23',amount:2800,merchant:'Employer'},
 {id:'mortgage',kind:'event',type:'expense',accountId:'checking',date:'2026-10-24',amount:2200,merchant:'Mortgage'},
 {id:'card-payment',kind:'movement',type:'transfer',fromAccountId:'checking',toAccountId:'card',
  date:'2026-10-25',amount:300,merchant:'Card payment'}
];
const original=JSON.stringify(ledger),projection=C.project(snapshot,ledger,30);
const audit=C.auditProjection(projection);
assert.equal(audit.ok,true,'Every day reconciles with the canonical event list');
assert.equal(audit.daysChecked,31);
assert.equal(projection.accounts[0].series[2].events.length,1,
 'Independent paychecks from the same employer have distinct dates');
const compromised=structuredClone(projection);
compromised.accounts[0].series[2].balance+=0.01;
assert.equal(C.auditProjection(compromised).ok,false,
 'A one-cent disagreement must be detected');
assert.equal(JSON.stringify(ledger),original,'An audit never alters bank or predicted records');
console.log('PASS forecast arithmetic integrity and one-cent discrepancy detection');
