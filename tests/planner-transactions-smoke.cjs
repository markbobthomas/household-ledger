'use strict';
const assert=require('node:assert/strict');
const accounts=[
 {id:'checking',name:'Checking',type:'depository',subtype:'checking',current:1000,available:1000,simulated:true},
 {id:'card',name:'Visa',type:'credit',subtype:'credit card',current:200,simulated:true}
];
const snapshot={asOf:'2026-10-19',mode:'demo',accounts};
const A=require('../account-forecast.js'),T=require('../planner-transactions.js');
const events=[
 {id:'mortgage',date:'2026-11-02',type:'expense',amount:250,merchant:'Mortgage',accountId:'checking'},
 {id:'subscription',date:'2026-11-03',type:'expense',amount:30,merchant:'Subscription',accountId:'card'}
];
const plans=[{id:'autopay|card|2026-11-10',fromAccountId:'checking',toAccountId:'card',
 anchorDate:'2026-11-10',amount:200,frequency:'once'}];
const state={predictions:{}};T.ensure(state);
const build=()=>A.build(snapshot,events,plans,{days:40,
 futureTransactionEdits:state.predictions.futureTransactionEdits,
 futureTransactionAdds:state.predictions.futureTransactionAdds});
const balance=(r,id)=>r.accounts.find(a=>a.id===id).closing;
const orig=JSON.stringify(events);
assert.equal(balance(build(),'checking'),550);
assert.equal(balance(build(),'card'),30);
const mortgage=T.keyEvent('mortgage','checking');
T.saveEdit(state,mortgage,{date:'2026-11-04',merchant:'Mortgage revision',
 type:'expense',accountId:'checking',amount:'270'},accounts,snapshot.asOf);
assert.equal(balance(build(),'checking'),530);
const modified=build().events.find(e=>e.merchant==='Mortgage revision');
assert.equal(modified.date,'2026-11-04');
assert.equal(modified.predictionKey,mortgage,'Stable editable identity survives amended date');
T.add(state,{date:'2026-11-08',merchant:'Extra paycheck',type:'income',
 accountId:'checking',amount:'450'},accounts,snapshot.asOf);
assert.equal(balance(build(),'checking'),980);
const extra=T.add(state,{date:'2026-11-09',merchant:'Savings sweep',
 type:'transfer',fromAccountId:'checking',toAccountId:'card',amount:'40'},accounts,snapshot.asOf);
assert.equal(balance(build(),'checking'),940);
assert.equal(balance(build(),'card'),-10);
const originalPlan=build().plans.find(p=>p.id==='plan|autopay|card|2026-11-10|2026-11-10');
assert.ok(originalPlan,'Full-statement card autopay remains a paired planned transfer');
const cardKey=T.keyMovement(originalPlan.id);
T.saveEdit(state,cardKey,{date:'2026-11-12',amount:'150',fromAccountId:'checking',
 toAccountId:'card',merchant:'November Visa payment'},accounts,snapshot.asOf);
assert.equal(balance(build(),'checking'),990,'Updated card autopay debits checking once');
assert.equal(balance(build(),'card'),40,'Updated card autopay credits liability once');
assert.equal(build().plans.find(p=>p.id===originalPlan.id).date,'2026-11-12');
T.skip(state,mortgage,{label:'Mortgage revision',date:'2026-11-04',accountId:'checking'});
assert.equal(balance(build(),'checking'),1260,'Skipped occurrence no longer debits checking');
T.restore(state,mortgage);
assert.equal(balance(build(),'checking'),1010,'Restored recurring prediction uses original bank-derived amount');
T.removeAdded(state,extra.id);
assert.equal(balance(build(),'checking'),1050,'Removing a manual paired transfer reverses both account legs');
assert.equal(balance(build(),'card'),80);
assert.equal(JSON.stringify(events),orig,'Immutable forecast input events are unchanged');
assert.throws(()=>T.add(state,{date:'2026-11-20',merchant:'Invalid',type:'transfer',
 fromAccountId:'checking',toAccountId:'checking',amount:15},accounts,snapshot.asOf),/different/);
assert.throws(()=>T.saveEdit(state,cardKey,{date:'2026-11-21',amount:-4,
 fromAccountId:'checking',toAccountId:'card'},accounts,snapshot.asOf),/positive/);
assert.throws(()=>T.add(state,{date:'2026-10-10',merchant:'Backdated',type:'expense',
 accountId:'checking',amount:10},accounts,snapshot.asOf),/future date/);
// History can suppress future automatic suggestions without inventing a
// schedule or affecting any actual/source transactions.
const historyOnly={predictions:{}};
const suppressed=T.excludeHistorySuggestions(historyOnly,{
 accountId:'checking',type:'expense',merchant:'Occasional Vendor'});
assert.equal(T.isNotRecurring(historyOnly.predictions,'checking','expense','Occasional Vendor'),true,
 'An unscheduled bank-history payee can be marked as excluded');
assert.equal(T.isNotRecurring(historyOnly.predictions,'card','expense','Occasional Vendor'),false,
 'History exclusions remain account-specific');
assert.equal(T.isNotRecurring(historyOnly.predictions,'checking','income','Occasional Vendor'),false,
 'History exclusions remain cash-direction-specific');
assert.equal(historyOnly.predictions.futureRecurringRules.length,0,
 'Excluding an unscheduled payee never adds or removes a schedule');
T.restoreRecurrence(historyOnly,suppressed.key);
assert.equal(T.isNotRecurring(historyOnly.predictions,'checking','expense','Occasional Vendor'),false,
 'Allow predictions restores an unscheduled payee');
const protectedHistory={predictions:{futureRecurringRules:[
 {id:'salary-A',kind:'event',accountId:'checking',originalAccountId:'checking',
  type:'income',merchant:'Employer Monthly',originalMerchant:'Employer Monthly'},
 {id:'salary-B',kind:'event',accountId:'checking',originalAccountId:'checking',
  type:'income',merchant:'Separate paycheck',originalMerchant:'Other Payroll',
  matchNames:['employer monthly']}
]}};
const protectedBefore=JSON.stringify(protectedHistory);
assert.throws(()=>T.excludeHistorySuggestions(protectedHistory,{
 accountId:'checking',type:'income',merchant:'Employer Monthly'}),/saved repeating plan/i,
 'Do not apply a broad history exclusion across independently confirmed income streams');
assert.equal(JSON.stringify(protectedHistory),protectedBefore,
 'Rejected broad history exclusions cannot alter financial schedules or preferences');
assert.deepEqual(state.transactions,undefined,'No edits to any source bank transaction property');
console.log('PASS editable mortgage, added income, linked transfer, edited card autopay, skipped/restored payment, deleted manual transfer, validations and immutable inputs');
