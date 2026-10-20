'use strict';
const assert=require('node:assert/strict');
const R=require('../planner-recurrence.js');
const accounts=[
 {id:'checking',name:'Household Checking',accountType:'checking',transactionAccount:'Checking'},
 {id:'savings',name:'Savings',accountType:'savings'},
 {id:'visa',name:'Visa',accountType:'credit'}
],s={asOf:'2026-10-20',accounts};
const row=(id,date,merchant,amount,other={})=>({
 id,date,merchant,amount,accountId:'checking',type:'expense',pending:false,...other});
const obligation=row('mort-9','2026-09-15','HOME MORTGAGE ACH',2000);
const first=R.infer([obligation],s,{},{days:90});
assert.deepEqual(first.events.map(e=>e.date),['2026-11-15','2026-12-15','2027-01-15']);
assert.ok(first.events.every(e=>e.amount===2000&&e.accountId==='checking'));
assert.equal(first.review.length,0,'A recognizable recently posted mortgage can be auto-planned');
const bankTransfer={...obligation,id:'ach-transfer',type:'transfer',cashDirection:'out',
 accountingKind:'internal_transfer'};
assert.equal(R.infer([bankTransfer],s,{},{days:90}).events.length,3,
 'A mortgage imported as an unpaired ACH transfer is still a checking withdrawal');
const trueTransfer={...bankTransfer,pairedTransactionId:'counterpart'};
assert.equal(R.infer([trueTransfer],s,{},{days:90}).events.length,0,
 'Do not predict a loan expense if the transfer has an actual linked other account');
const pending={...obligation,pending:true};
assert.equal(R.infer([pending],s,{},{days:90}).events.length,0);
const stale={...obligation,date:'2026-02-15'};
assert.equal(R.infer([stale],s,{},{days:90}).events.length,0);
const insurance=[
 row('i1','2026-08-08','Home Insurance',175),
 row('i2','2026-09-09','Home Insurance',175)];
assert.equal(R.infer(insurance,s,{},{days:90}).events.length,3,
 'Two well-matched monthly insurance bills are sufficient for automatic dated predictions');
const groceries=[row('g1','2026-08-08','Safeway',175),row('g2','2026-09-09','Safeway',175)];
const grocery=R.infer(groceries,s,{},{days:90});
assert.equal(grocery.events.length,0);
assert.equal(grocery.review.length,1,'A low-confidence repeating store purchase goes to Reviews');
assert.equal(R.infer([groceries[0]],s,{},{days:90}).events.length,0,
 'One ordinary store visit is not a future payment');
const payroll=[row('p1','2026-08-05','Employer Payroll',3100,{type:'income'}),
 row('p2','2026-09-05','Employer Payroll',3100,{type:'income'})];
assert.equal(R.infer(payroll,s,{},{days:90}).events.length,3,
 'A pair of same-dollar payroll deposits can be recognized as regular income');
const card=[
 row('c1','2026-08-13','Netflix',18,{accountId:'visa'}),
 row('c2','2026-09-13','Netflix',18,{accountId:'visa'})];
const cardForecast=R.infer(card,s,{},{days:90});
assert.ok(cardForecast.events.length>0);
assert.ok(cardForecast.events.every(x=>x.accountId==='visa'),
 'Subscription purchase stays on Visa rather than debiting checking again');
const excluded={plannerRoutineDecisions:{'expense|checking|home mortgage ach':
 {status:'excluded',amount:2000,frequency:'monthly'}}};
assert.equal(R.infer([obligation],s,excluded,{days:90}).events.length,0,
 'User exclusion is authoritative');
const historyKey=['checking','expense','home mortgage ach','200000'].map(encodeURIComponent).join('|');
assert.equal(R.infer([obligation],s,{historyPatternDecisions:{[historyKey]:'dismissed'}},{days:90}).events.length,0,
 'A not-recurring decision from Reviews is respected');
const confirmed={futureRecurringRules:[{kind:'event',accountId:'checking',originalAccountId:'checking',
 originalType:'expense',matchAmount:2000,matchNames:['home mortgage ach'],
 merchant:'HOME MORTGAGE ACH',amount:2000,frequency:'monthly',anchorDate:'2026-11-25'}]};
assert.equal(R.infer([obligation],s,confirmed,{days:90}).events.length,0,
 'Owner-defined monthly mortgage is the authoritative schedule, even on a new due date');
const inferred={id:'auto',source:'early-bank-inference',merchant:'HOME MORTGAGE ACH',
 amount:2000,type:'expense',accountId:'checking',date:'2026-11-15'};
const manual={...inferred,id:'owner',source:'user-recurring',date:'2026-11-25'};
const overlapping=R.dedupeEvents([inferred,manual],accounts);
assert.equal(overlapping.events.length,1);
assert.equal(overlapping.events[0].id,'owner');
assert.equal(overlapping.removed.length,1);
const otherAccount={...inferred,accountId:'savings',id:'different-account'};
assert.equal(R.dedupeEvents([inferred,otherAccount],accounts).events.length,2,
 'Same-dollar bills on different bank accounts are not duplicates');
const otherMonth={...inferred,date:'2026-12-15',id:'different-month'};
assert.equal(R.dedupeEvents([inferred,otherMonth],accounts).events.length,2,
 'Each monthly occurrence remains present');
const credit={...inferred,accountId:'visa',id:'credit-account'};
assert.equal(R.dedupeEvents([inferred,credit],accounts).events.length,2,
 'An expense on the card never becomes a second checking debit');
const oldHistorical={...inferred,id:'legacy',source:'historical',date:'2026-11-17'};
assert.equal(R.dedupeEvents([inferred,oldHistorical,manual],accounts).events.length,1,
 'Mortgage from historical, new auto and owner-confirmed schedules is one bill');
const differentAmount={...inferred,id:'separate',merchant:'Mortgage Servicer Z',amount:1000};
assert.equal(R.dedupeEvents([inferred,differentAmount],accounts).events.length,2,
 'Separate mortgage payments with very different amounts cannot merge');
const before=JSON.stringify([inferred,manual]);
R.dedupeEvents([inferred,manual],accounts);
assert.equal(JSON.stringify([inferred,manual]),before,'Inputs and bank facts remain immutable');
console.log('PASS early mortgage and 2-payment fixed bill inference, low-confidence review, real transfers, card isolation, owner exclusions, and cross-source deduplication');
