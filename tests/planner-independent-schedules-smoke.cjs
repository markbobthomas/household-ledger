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
 null,history,['2026-10a','2026-10b']);
const garden=T.defineRecurring(state,{...base,scheduleLabel:'Water — Garden',amount:220},accounts,asOf,
 null,history,['2026-10b']);
assert.notEqual(house.id,garden.id,'Two bills of same merchant and date have different stable IDs');
assert.deepEqual(house.exampleIds,['2026-10a'],'New schedule takes ownership of its chosen posted transaction, without changing bank facts');
assert.deepEqual(garden.exampleIds,['2026-10b'],'Second bill has its own bank evidence');
let b=C.materialize(snapshot,history,state.predictions,T,P,90);
let nov=b.ledger.filter(e=>e.date==='2026-11-10'&&e.accountId==='checking');
assert.equal(nov.length,2,'Both future bills must appear on one date');
assert.deepEqual(nov.map(e=>e.amount).sort((a,b)=>a-b),[150,220]);
assert.ok(nov.every(e=>e.amountEstimate),'Variable bills should identify amounts as estimates');
assert.ok(b.ledger.filter(e=>e.date==='2026-12-10'&&e.accountId==='checking').length===2);
assert.equal(b.projection.household.conservationDifference,0);
// Previously saved date-range estimates are honored for compatibility,
 // but new grouped date-range changes are no longer allowed.
assert.throws(()=>T.setScheduleEstimate(state,house.id,
 {scope:'range',amount:175,from:'2026-12-01',through:'2026-12-31'},asOf),
 /Edit one dated payment/);
house.amountWindows=[{from:'2026-12-01',through:'2026-12-31',amount:175}];
const ranges=house;
assert.equal(ranges.amount,150,'Legacy estimates preserve the original schedule');
assert.equal(T.scheduleAmount(ranges,'2026-11-10').amount,150);
assert.equal(T.scheduleAmount(ranges,'2026-12-10').amount,175);
assert.equal(T.scheduleAmount(garden,'2026-12-10').amount,220,'Other bills are unchanged');
const edited={predictions:structuredClone(state.predictions)};
edited.predictions.futureSeriesEdits={
 [T.manualSeriesKey(house.id)]:{startsOn:'2026-11-10',amount:999,dayOffset:0}
};
let adjusted=C.materialize(snapshot,history,edited.predictions,T,P,90);
assert.ok(adjusted.ledger.some(e=>e.date==='2026-11-10'&&e.amount===999));
assert.ok(adjusted.ledger.some(e=>e.date==='2026-12-10'&&e.amount===175),
 'Specific estimate must win over an older recurring series amount edit');
T.setScheduleEstimate(edited,house.id,{scope:'all',amount:160},asOf);
adjusted=C.materialize(snapshot,history,edited.predictions,T,P,90);
assert.ok(adjusted.ledger.some(e=>e.date==='2026-11-10'&&e.amount===160),
 'An all-future schedule estimate replaces a stale global amount edit');
assert.ok(adjusted.ledger.some(e=>e.date==='2026-12-10'&&e.amount===160),
 'All future amount updates supersede legacy partial range amounts');

b=C.materialize(snapshot,history,state.predictions,T,P,90);
assert.deepEqual(b.ledger.filter(e=>e.date==='2026-12-10').map(e=>e.amount).sort((a,b)=>a-b),[175,220]);
// Existing stored legacy ranges stay intact until the owner explicitly
 // updates the repeating schedule amount (or clears an old rule).
house.amount=160;
assert.equal(T.scheduleAmount(house,'2026-11-10').amount,160);
assert.equal(T.scheduleAmount(house,'2026-12-10').amount,175);
assert.throws(()=>T.setScheduleEstimate(state,house.id,
 {scope:'range',amount:50,from:'2026-10-01',through:'2026-12-31'},asOf),
 /Edit one dated payment/);
const next=T.defineRecurring(state,{...base,separateSchedule:false,merchant:'River Water Utility',scheduleLabel:'Water — House',
 amount:160,amountBasis:'estimate',date:'2026-11-10'},accounts,asOf,
 {kind:'event',accountId:'checking',sourceAccountId:'checking',recurringRuleId:house.id,
  originalMerchant:'River Water Utility',type:'expense',date:'2026-11-10'},history,[]);
assert.equal(next.id,house.id);
assert.equal(next.amountWindows.length,1,'Unmodified legacy amounts are retained without silently changing the forecast');
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
assert.deepEqual(b.ledger.filter(e=>e.date==='2026-11-10').map(e=>e.amount),[220],
 'The matching paid bill disappears; the other same-payee bill remains forecast');
const postedBoth=[...postedOne,{id:'nov-second',date:'2026-11-09',merchant:'River Water Utility',
 amount:218,type:'expense',accountId:'checking',pending:false}];
b=C.materialize(later,postedBoth,state.predictions,T,P,90);
assert.equal(b.ledger.filter(e=>e.date==='2026-11-10').length,0,
 'Two actual bank payments reconcile two separate occurrences exactly once');
assert.equal(b.ledger.filter(e=>e.date==='2026-12-10').length,2,
 'December bills remain predicted after both November payments post');
const oneDifferent=[...history,{id:'nov-garden',date:'2026-11-09',
 merchant:'River Water Utility',amount:219,type:'expense',accountId:'checking',pending:false}];
const gardenPaid=C.materialize(later,oneDifferent,state.predictions,T,P,90);
assert.deepEqual(gardenPaid.ledger.filter(e=>e.date==='2026-11-10').map(e=>e.amount),[160],
 'The closest matching estimated bill is reconciled, not the first saved rule');
const equalValue=JSON.parse(JSON.stringify(state.predictions));
T.setScheduleEstimate({predictions:equalValue},garden.id,{scope:'all',amount:160},asOf);
const equalRows=C.materialize(snapshot,history,equalValue,T,P,90).ledger
 .filter(e=>e.date==='2026-11-10');
assert.deepEqual(equalRows.map(e=>e.amount),[160,160],
 'Two independent schedules still count twice even with identical amounts and dates');
const stopped={predictions:structuredClone(state.predictions)};
T.stopRecurrence(stopped,{kind:'event',recurringRuleId:house.id,accountId:'checking',
 type:'expense',merchant:'Water — House',date:'2026-11-10'});
assert.equal(stopped.predictions.futureRecurringRules.length,1,
 'Stop repeating affects exactly one confirmed same-payee bill');
assert.equal(stopped.predictions.futureRecurringRules[0].id,garden.id,
 'Stopping house water does not delete or exclude its separate garden payment');
assert.ok(Object.keys(stopped.predictions.futureRecurrenceExclusions||{}).some(key=>
 key.startsWith('manual-rule|')),
 'An independent same-payee bill gets a rule-specific exclusion, not a merchant-wide blacklist');
const siblingForecast=C.materialize(snapshot,history,stopped.predictions,T,P,90);
assert.ok(siblingForecast.ledger.some(e=>e.date==='2026-11-10'&&e.amount===220),
 'The second same-merchant bill still reduces the cash forecast');
T.removeScheduleEstimate(state,house.id,0);
assert.equal(T.scheduleAmount(state.predictions.futureRecurringRules.find(r=>r.id===house.id),'2026-12-10').amount,160);
assert.equal(next.amountWindows.length,0,'An old range can be explicitly cleared');
const allState={predictions:structuredClone(state.predictions)};
const allHouse=allState.predictions.futureRecurringRules.find(r=>r.id===house.id);
allHouse.amountWindows=[{from:'2026-12-01',through:'2026-12-31',amount:175}];
T.setScheduleEstimate(allState,house.id,{scope:'all',amount:180},asOf);
assert.equal(allHouse.amountWindows.length,0);
assert.equal(T.scheduleAmount(allHouse,'2026-12-10').amount,180,
 'All future amount updates really apply to every future date');
T.removeRecurring(state,house.id);
assert.equal(state.predictions.futureRecurringRules.length,1);
assert.equal(state.predictions.futureRecurringRules[0].id,garden.id,
 'Removing one independent water bill preserves its sibling');
const historic={...garden,anchorDate:'2023-02-10'};
assert.deepEqual(T.recurrenceDates(historic,'2026-10-21','2027-01-15'),
 ['2026-11-10','2026-12-10','2027-01-10'],
 'A schedule saved years ago must continue generating future monthly bills');
assert.equal(JSON.stringify(history),immutable,'All posted bank records stay untouched');
console.log('PASS independent same-payee/same-day bills, legacy compatibility, individual-or-all only, real posting, immutable bank history');
