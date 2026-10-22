'use strict';
const assert=require('node:assert/strict'),T=require('../planner-transactions.js'),
 C=require('../planner-core.js'),P=require('../payment-obligations.js');
const asOf='2026-10-21',accounts=[
 {id:'checking',name:'Checking',type:'depository',accountType:'checking',current:8000,available:7900,simulated:true},
 {id:'savings',name:'Savings',type:'depository',accountType:'savings',current:1000,available:1000,simulated:true}
],snapshot={asOf,accounts,mode:'demo'},history=[];
for(const [month,one,two] of [['2026-07',110,205],['2026-08',135,180],['2026-09',125,215],['2026-10',145,190]]){
 history.push({id:month+'a',date:month+'-10',merchant:'River Water Utility',
  amount:one,type:'expense',accountId:'checking',pending:false});
 history.push({id:month+'b',date:month+'-10',merchant:'River Water Utility',
  amount:two,type:'expense',accountId:'checking',pending:false});
}
const immutable=JSON.stringify(history),state={predictions:{}};
const base={date:'2026-11-10',type:'expense',accountId:'checking',frequency:'monthly',
 merchant:'River Water Utility',amountBasis:'estimate',separateSchedule:'on'};
const house=T.defineRecurring(state,{...base,scheduleLabel:'Water — House',amount:150},accounts,asOf,
 null,history,['2026-10a']);
const garden=T.defineRecurring(state,{...base,scheduleLabel:'Water — Garden',amount:220},accounts,asOf,
 null,history,['2026-10b']);
assert.notEqual(house.id,garden.id,'Two bills of same merchant and date have different stable IDs');
assert.deepEqual(house.exampleIds,['2026-10a'],'Bank examples are linked to one selected stream');
assert.deepEqual(garden.exampleIds,['2026-10b'],'Second bill has its own bank evidence');
let b=C.materialize(snapshot,history,state.predictions,T,P,90);
let nov=b.ledger.filter(e=>e.date==='2026-11-10'&&e.accountId==='checking');
assert.equal(nov.length,2,'Both future bills must appear on one date');
assert.deepEqual(nov.map(e=>e.amount).sort((a,b)=>a-b),[150,220]);
assert.ok(nov.every(e=>e.amountEstimate),'Variable bills should identify amounts as estimates');
assert.ok(b.ledger.filter(e=>e.date==='2026-12-10'&&e.accountId==='checking').length===2);
assert.equal(b.projection.household.conservationDifference,0);
const ranges=T.setScheduleEstimate(state,house.id,
 {scope:'range',amount:175,from:'2026-12-01',through:'2026-12-31'},asOf);
assert.equal(ranges.amount,150,'Dated estimates do not rewrite the usual amount');
assert.equal(T.scheduleAmount(ranges,'2026-11-10').amount,150);
assert.equal(T.scheduleAmount(ranges,'2026-12-10').amount,175);
assert.equal(T.scheduleAmount(garden,'2026-12-10').amount,220,'Other bills are unchanged');
b=C.materialize(snapshot,history,state.predictions,T,P,90);
assert.deepEqual(b.ledger.filter(e=>e.date==='2026-12-10').map(e=>e.amount).sort((a,b)=>a-b),[175,220]);
T.setScheduleEstimate(state,house.id,{scope:'all',amount:160},asOf);
assert.equal(T.scheduleAmount(house,'2026-11-10').amount,160);
assert.equal(T.scheduleAmount(house,'2026-12-10').amount,175,'Specific range overrides all-future estimate');
assert.throws(()=>T.setScheduleEstimate(state,house.id,
 {scope:'range',amount:50,from:'2026-10-01',through:'2026-12-31'},asOf),/future date range/);
const next=T.defineRecurring(state,{...base,merchant:'River Water Utility',scheduleLabel:'Water — House',
 amount:160,amountBasis:'estimate',date:'2026-11-10'},accounts,asOf,
 {kind:'event',accountId:'checking',sourceAccountId:'checking',recurringRuleId:house.id,
  originalMerchant:'River Water Utility',type:'expense',date:'2026-11-10'},history,[]);
assert.equal(next.id,house.id);
assert.equal(next.amountWindows.length,1,'Editing a schedule retains its dated estimates');
assert.equal(state.predictions.futureRecurringRules.length,2);
const added=T.add(state,{date:'2026-11-10',merchant:'Water — House',type:'expense',
 amount:10,accountId:'checking'},accounts,asOf);
b=C.materialize(snapshot,history,state.predictions,T,P,90);
assert.equal(b.ledger.filter(e=>e.date==='2026-11-10'&&e.accountId==='checking').length,3,
 'An explicitly entered one-off with the same payee/date is still counted separately');
T.removeAdded(state,added.id);
const postedOne=[...history,{id:'nov-only',date:'2026-11-08',merchant:'River Water Utility',
 amount:161,type:'expense',accountId:'checking',pending:false}];
const later={...snapshot,asOf:'2026-11-09'};
b=C.materialize(later,postedOne,state.predictions,T,P,90);
assert.equal(b.ledger.filter(e=>e.date==='2026-11-10').length,1,
 'One real payment may reconcile one schedule; the other obligation stays forecast');
const postedBoth=[...postedOne,{id:'nov-second',date:'2026-11-09',merchant:'River Water Utility',
 amount:218,type:'expense',accountId:'checking',pending:false}];
b=C.materialize(later,postedBoth,state.predictions,T,P,90);
assert.equal(b.ledger.filter(e=>e.date==='2026-11-10').length,0,
 'Two actual bank payments reconcile two separate occurrences exactly once');
assert.equal(b.ledger.filter(e=>e.date==='2026-12-10').length,2,
 'December bills remain predicted after both November payments post');
T.removeScheduleEstimate(state,house.id,0);
assert.equal(T.scheduleAmount(house,'2026-12-10').amount,160);
T.removeRecurring(state,house.id);
assert.equal(state.predictions.futureRecurringRules.length,1);
assert.equal(state.predictions.futureRecurringRules[0].id,garden.id,
 'Removing one independent water bill preserves its sibling');
assert.equal(JSON.stringify(history),immutable,'All posted bank records stay untouched');
console.log('PASS independent same-payee/same-day variable bills, calendar amounts, scoped estimates, real posting, immutable bank history');
