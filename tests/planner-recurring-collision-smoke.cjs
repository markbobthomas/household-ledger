'use strict';
const assert=require('node:assert/strict');
const T=require('../planner-transactions.js'),C=require('../planner-core.js'),
 P=require('../payment-obligations.js');
const accounts=[{id:'checking',name:'Checking',type:'depository',accountType:'checking',
 current:6500,available:6500,simulated:true}];
const asOf='2026-10-21';
const history=[
 {id:'a1',date:'2026-09-05',merchant:'CITY PAYROLL',type:'income',amount:3000,accountId:'checking'},
 {id:'a2',date:'2026-10-03',merchant:'CITY PAYROLL',type:'income',amount:3070,accountId:'checking'},
 {id:'b1',date:'2026-09-19',merchant:'CITY PAYROLL',type:'income',amount:3300,accountId:'checking'},
 {id:'b2',date:'2026-10-17',merchant:'CITY PAYROLL',type:'income',amount:3350,accountId:'checking'}
];
const historyBefore=JSON.stringify(history);
const st={predictions:{}};
const fields=(date,amount)=>({date,merchant:'CITY PAYROLL',amount,type:'income',
 accountId:'checking',frequency:'every-4-weeks'});
const A=T.defineRecurring(st,fields('2026-10-31',3000),accounts,asOf,null,history,['a1','a2']);
const B=T.defineRecurring(st,fields('2026-11-14',3300),accounts,asOf,null,history,['b1','b2']);
assert.notEqual(A.id,B.id,'Different 28-day phases have independent identities');
assert.equal(st.predictions.futureRecurringRules.length,2);
const near=T.defineRecurring(st,fields('2026-11-28',3110),accounts,asOf,null,history,['a2']);
assert.equal(near.id,A.id,'Existing paycheck A is updated by phase and history evidence');
assert.equal(st.predictions.futureRecurringRules.length,2);
assert.equal(st.predictions.futureRecurringRules.find(r=>r.id===B.id).amount,3300);
const seeded=structuredClone(st);
const duplicate=structuredClone(B);
duplicate.id='legacy-payroll-copy';
duplicate.anchorDate='2026-12-12';
duplicate.date='2026-12-12';
duplicate.sourceAnchorDate='2026-10-17';
duplicate.exampleIds=['b2'];
seeded.predictions.futureRecurringRules.push(duplicate);
const error=assert.throws(()=>T.defineRecurring(seeded,fields('2026-12-12',3400),
 accounts,asOf,null,history,[]));
assert.equal(error,undefined);
let offered;
try{T.defineRecurring(seeded,fields('2026-12-12',3400),accounts,asOf,null,history,[])}
catch(e){offered=e}
assert.equal(offered?.code,'RECURRING_SCHEDULE_CHOICE');
assert.equal(offered.options.length,2,'Show which of two saved schedules would change');
assert.equal(seeded.predictions.futureRecurringRules.length,3,'Collision alone writes nothing');
const untouched=JSON.stringify(seeded.predictions.futureRecurringRules.find(r=>r.id===B.id));
const selected=T.defineRecurring(seeded,{...fields('2026-12-12',3450),existingRuleId:duplicate.id},
 accounts,asOf,null,history,[]);
assert.equal(selected.id,duplicate.id);
assert.equal(seeded.predictions.futureRecurringRules.length,3,'Explicit choice updates, never adds a fourth payment');
assert.equal(JSON.stringify(seeded.predictions.futureRecurringRules.find(r=>r.id===B.id)),untouched);
assert.throws(()=>T.defineRecurring(seeded,{...fields('2026-12-12',3450),
 existingRuleId:'unrelated-rule'},accounts,asOf,null,history,[]),
 /no longer a match/);
const month={predictions:{futureRecurringRules:[
 {...A,id:'a-month',frequency:'monthly',anchorDate:'2026-11-05',date:'2026-11-05',exampleIds:['a1'],sourceFrequency:'monthly'},
 {...B,id:'b-month',frequency:'monthly',anchorDate:'2026-11-19',date:'2026-11-19',exampleIds:['b1'],sourceFrequency:'monthly'}
]}};
const source=JSON.stringify(month.predictions.futureRecurringRules);
const chosen=T.defineRecurring(month,{date:'2026-12-05',merchant:'CITY PAYROLL',amount:3050,
 type:'income',frequency:'monthly',accountId:'checking'},accounts,asOf,null,history,['a1']);
assert.equal(chosen.id,'a-month','Exact linked posted record disambiguates same-merchant monthly schedules');
assert.equal(month.predictions.futureRecurringRules.length,2);
assert.equal(month.predictions.futureRecurringRules.find(r=>r.id==='b-month').amount,3300);
const safe=JSON.parse(JSON.stringify(month.predictions));
const projected=C.materialize({asOf,mode:'demo',accounts},history,safe,T,P,90);
assert.equal(projected.projection.household.conservationDifference,0);
assert.equal(JSON.stringify(history),historyBefore,'No posted Plaid records changed');
assert.ok(source.includes('b-month'));
console.log('PASS recurring collision resolution: explicit selection, posted evidence, independent payroll phases and immutable history');
