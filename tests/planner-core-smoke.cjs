'use strict';
const assert=require('node:assert/strict');
const C=require('../planner-core.js'),T=require('../planner-transactions.js');
const P=require('../payment-obligations.js');
const accounts=[
 {id:'checking',name:'Main Checking',accountType:'checking',current:5000,available:4800,simulated:true},
 {id:'savings',name:'Savings',accountType:'savings',current:2500,available:2500,simulated:true},
 {id:'visa',name:'Visa',accountType:'credit',current:600,available:null,simulated:true}
],snapshot={accounts,mode:'demo',asOf:'2026-10-20'};
const tx=(id,date,merchant,amount,type='expense',accountId='checking',extra={})=>
 ({id,date,merchant,amount,type,accountId,pending:false,...extra});
const history=[
 tx('m1','2026-09-15','Mortgage ACH',2000,'transfer','checking',{cashDirection:'out'}),
 tx('generic1','2026-09-09','ABC Draft 984',82.35),
 tx('generic2','2026-10-09','ABC Draft 984',82.35),
 tx('pay1','2026-09-01','ACME Payroll',3000,'income'),
 tx('pay2','2026-10-01','ACME Payroll',3000,'income'),
 tx('visa1','2026-09-05','Netflix',18,'expense','visa'),
 tx('visa2','2026-10-05','Netflix',18,'expense','visa'),
 tx('grocer1','2026-09-08','Safeway',97),
 tx('grocer2','2026-10-08','Safeway',97),
 tx('transfer','2026-10-04','Transfer to Savings',100,'transfer','checking',
  {cashDirection:'out',pairedTransactionId:'counterpart'}),
 tx('pending','2026-10-16','Mystery Payment',350,'expense','checking',{pending:true})
];
const find=(bundle,merchant)=>bundle.ledger.filter(e=>e.merchant===merchant);
let b=C.materialize(snapshot,history,{},T,P,90);
assert.deepEqual(find(b,'Mortgage ACH').map(x=>x.date),
 ['2026-11-15','2026-12-15','2027-01-15']);
assert.deepEqual(find(b,'ABC Draft 984').map(x=>x.date),
 ['2026-11-09','2026-12-09','2027-01-09']);
assert.equal(find(b,'Safeway').length,0,
 'Shopping with just two monthly repeats must not automatically debit checking');
assert.equal(find(b,'Transfer to Savings').length,0,
 'Paired internal bank movement must never generate an additional expense');
assert.equal(find(b,'Mystery Payment').length,0,'Pending entries are not evidence');
assert.equal(find(b,'Netflix').every(x=>x.accountId==='visa'),true,
 'Credit-card purchases remain attached to their card');
assert.equal(b.projection.accounts.find(a=>a.id==='checking').openingAvailable,4800);
assert.equal(b.projection.accounts.find(a=>a.id==='visa').closing,654,
 'Card purchases increase card liability without debiting checking again');
assert.ok(b.historyCandidates.some(x=>x.merchant==='Safeway'),
 'Low-confidence patterns go to Reviews');
const source=JSON.stringify(history);
const bankCount=history.length;
const state={predictions:{}};
T.defineRecurring(state,{
 date:'2026-11-25',merchant:'Mortgage ACH',amount:2100,type:'expense',
 accountId:'checking',frequency:'monthly'
},accounts,snapshot.asOf,{
 kind:'event',accountId:'checking',type:'transfer',merchant:'Mortgage ACH',
 amount:2000,date:'2026-09-15'
},history,['m1']);
b=C.materialize(snapshot,history,state.predictions,T,P,90);
assert.equal(find(b,'Mortgage ACH').length,2,
 'Owner mortgage schedule replaces auto without two debits in one month');
assert.equal(find(b,'Mortgage ACH')[0].date,'2026-11-25');
assert.equal(find(b,'Mortgage ACH')[0].amount,2100);
T.defineRecurring(state,{
 date:'2026-11-27',merchant:'Mortgage ACH',amount:2100,type:'expense',
 accountId:'checking',frequency:'monthly'
},accounts,snapshot.asOf,{
 kind:'event',accountId:'checking',type:'transfer',merchant:'Mortgage ACH',
 amount:2000,date:'2026-09-15'
},history,['m1']);
assert.equal(state.predictions.futureRecurringRules.length,1,
 'Confirming another source row updates one rule instead of making duplicates');
b=C.materialize(snapshot,history,state.predictions,T,P,90);
assert.equal(find(b,'Mortgage ACH').length,2);
const generic=find(b,'ABC Draft 984')[0];
T.saveEdit(state,T.keyEvent(generic.id,generic.accountId),{
 date:'2026-11-13',merchant:'ABC Draft 984',amount:88,type:'expense',
 accountId:'checking'
},accounts,snapshot.asOf);
b=C.materialize(snapshot,history,state.predictions,T,P,90);
assert.equal(find(b,'ABC Draft 984')[0].date,'2026-11-13');
assert.equal(find(b,'ABC Draft 984')[0].amount,88);
assert.equal(find(b,'ABC Draft 984').length,3);
const firstKey=find(b,'ABC Draft 984')[0];
T.skip(state,T.keyEvent(firstKey.id,firstKey.accountId));
b=C.materialize(snapshot,history,state.predictions,T,P,90);
assert.equal(find(b,'ABC Draft 984').length,2,
 'Skipping one occurrence does not cancel the recurring series');
T.restore(state,T.keyEvent(firstKey.id,firstKey.accountId));
T.add(state,{date:'2026-11-19',merchant:'Unexpected fee',type:'expense',amount:75,accountId:'checking'},accounts,snapshot.asOf);
b=C.materialize(snapshot,history,state.predictions,T,P,90);
assert.equal(find(b,'Unexpected fee').length,1);
assert.equal(JSON.stringify(history),source,'Building projections must never mutate Plaid rows');
assert.equal(history.length,bankCount);
assert.equal(b.projection.household.conservationDifference,0,
 'Expenses and incomes reconcile with change in household net worth');
const transferState={predictions:{}};
T.add(transferState,{date:'2026-11-10',type:'transfer',merchant:'Move to savings',
 amount:150,fromAccountId:'checking',toAccountId:'savings'},accounts,snapshot.asOf);
const transferred=C.materialize(snapshot,[],transferState.predictions,T,P,90);
assert.equal(transferred.projection.plans.length,1,
 'One linked transfer, not two independent charges');
assert.equal(transferred.projection.accounts.find(a=>a.id==='checking').closing,4850);
assert.equal(transferred.projection.accounts.find(a=>a.id==='savings').closing,2650);
assert.equal(transferred.projection.household.conservationDifference,0);
const uncertain=C.analyze([tx('ordinary','2026-10-18','Restaurant 94',35)],accounts,snapshot.asOf);
assert.equal(uncertain.automatic.length,0);
assert.equal(uncertain.review.length,0,'A one-off restaurant purchase does not clutter Reviews');
const repeatGrocery=[
 tx('s1','2026-09-08','Safeway',97),
 tx('s2','2026-10-08','Safeway',97)];
const repeatReview=C.analyze(repeatGrocery,accounts,snapshot.asOf);
assert.equal(repeatReview.review.length,1);
const dismissed={historyPatternDecisions:{[repeatReview.review[0].key]:'dismissed'}};
assert.equal(C.analyze(repeatGrocery,accounts,snapshot.asOf,dismissed).review.length,0,
 'Dismissed patterns stay dismissed');
const twiceMonthly=[
 tx('t1','2026-09-01','Employer Payroll',1400,'income'),
 tx('t2','2026-09-15','Employer Payroll',1400,'income'),
 tx('t3','2026-10-01','Employer Payroll',1400,'income'),
 tx('t4','2026-10-15','Employer Payroll',1400,'income')
];
const twice=C.materialize(snapshot,twiceMonthly,{},T,P,90);
assert.deepEqual(find(twice,'Employer Payroll').slice(0,4).map(x=>x.date),
 ['2026-11-01','2026-11-15','2026-12-01','2026-12-15'],
 'Twice-monthly payroll retains two calendar dates, never drifts biweekly');
const historicalCardSettlements=[
 tx('cardpaid1','2026-09-10','Credit card payment',600),
 tx('cardpaid2','2026-10-10','Credit card payment',600)
];
const unpairedCard=C.analyze(historicalCardSettlements,accounts,snapshot.asOf);
assert.equal(unpairedCard.automatic.length,0,
 'A payment to a linked card is never fabricated as an additional ordinary expense');
assert.equal(unpairedCard.review.length,1,
 'Ambiguous historical card payments may be reviewed but not charged twice');
const cardState={predictions:{paymentRules:{visa:{
 fromAccountId:'checking',method:'statement',closingDay:18,
 billingStartDate:'2026-09-19',billingEndDate:'2026-10-18',
 nextPaymentDate:'2026-11-12',nextDueDate:'2026-11-14',
 lastStatementBalance:600,autopayEnabled:true
}}}};
const card=C.materialize(snapshot,history,cardState.predictions,T,P,90);
assert.equal(card.projection.plans.filter(p=>p.toAccountId==='visa').length>0,true);
assert.equal(card.projection.events.filter(e=>e.transferGroupId&&e.accountId==='checking').length,
 card.projection.plans.filter(p=>p.toAccountId==='visa').length,
 'Checking pays the card once per planned autopay');
const autopays=card.projection.plans.filter(p=>p.toAccountId==='visa');
assert.ok(autopays.every(p=>p.cadence==='monthly'&&p.seriesKey==='autopay|visa'),
 'Card payment occurrences retain one monthly recurring series key');
const revisedCard={predictions:structuredClone(cardState.predictions)};
T.saveSeriesEdit(revisedCard,autopays[0].seriesKey,autopays[0].baseDate,{
 date:autopays[0].date,amount:675,merchant:'Visa autopay',
 fromAccountId:'checking',toAccountId:'visa'
},accounts,snapshot.asOf,'monthly','movement');
const adjustedCard=C.materialize(snapshot,history,revisedCard.predictions,T,P,90);
assert.ok(adjustedCard.projection.plans.filter(p=>p.toAccountId==='visa')
 .every(p=>p.amount===675),
 'Editing card autopay for all future dates replaces each linked payment amount once');
console.log('PASS unified future ledger: automatic recurrence, reviews, immutable Plaid, owner overrides, one-time edits, linked transfers, cash/card balances, and autopay');
