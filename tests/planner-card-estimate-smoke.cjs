'use strict';
const assert=require('node:assert/strict'),C=require('../planner-core.js'),
 P=require('../payment-obligations.js'),T=require('../planner-transactions.js');
const accounts=[
 {id:'checking',name:'Main Checking',type:'depository',accountType:'checking',current:5500,available:5400,simulated:true},
 {id:'card',name:'Rewards Visa',type:'credit',accountType:'credit',current:1100,simulated:true}
],asOf='2026-10-21',snapshot={accounts,asOf,mode:'demo'};
const linked=(month,amount)=>{
 const d=month+'-11',a='pay-'+month;
 return [{id:a,date:d,merchant:'Visa payment',type:'transfer',cashDirection:'out',
  accountingKind:'card_payment',pairedTransactionId:a+'-card',accountId:'checking',amount,pending:false},
 {id:a+'-card',date:d,merchant:'Visa payment',type:'transfer',cashDirection:'in',
  accountingKind:'card_payment',pairedTransactionId:a,accountId:'card',amount,pending:false}];
};
const history=[...linked('2026-08',360),...linked('2026-09',380),...linked('2026-10',410),
 {id:'food',date:'2026-10-16',accountId:'card',merchant:'Groceries',amount:310,type:'expense',pending:false},
 {id:'gas',date:'2026-10-18',accountId:'card',merchant:'Fuel',amount:90,type:'expense',pending:false},
 {id:'refund',date:'2026-10-20',accountId:'card',merchant:'Refund',amount:40,type:'refund',pending:false}];
const original=JSON.stringify(history);
const inferred=P.inferPayment(accounts[1],accounts,history,asOf);
assert.equal(inferred.eligible,true);
assert.equal(inferred.fromAccountId,'checking');
assert.equal(inferred.nextPaymentDate,'2026-11-11');
assert.equal(inferred.estimatedAmount,undefined,'Historical payment amounts are not used to estimate future withdrawals');
const result=C.materialize(snapshot,history,{},T,P,90);
const first=result.ledger.filter(e=>e.kind==='movement'&&e.date==='2026-11-11');
assert.equal(first.length,1,'One November checking debit to the linked card');
assert.equal(first[0].amount,360);
assert.equal(first[0].origin,'card-history-estimate');
assert.equal(result.ledger.filter(e=>e.kind==='movement'&&e.date==='2026-12-11').length,0,
 'No December debit without actual or confirmed dated card purchases');
assert.equal(result.ledger.filter(e=>e.kind==='event'&&e.source==='card-history-estimate').length,0,
 'No synthetic future card purchases ever appear');
const detail=result.payments.paymentDetails.find(d=>d.id===first[0].id);
assert.equal(detail.postedTransactions.length,3);
assert.equal(detail.predictedTransactions.length,0);
assert.equal(detail.calculated,360);
assert.equal(detail.periodSource,'inferred-payment-window');
const scheduled={futureTransactionAdds:[{
 id:'future-expense-card',date:'2026-11-04',type:'expense',accountId:'card',amount:29,
 merchant:'Known subscription'
}]};
const withSubscription=C.materialize(snapshot,history,scheduled,T,P,90);
const included=withSubscription.payments.paymentDetails.find(d=>d.withdrawalDate==='2026-11-11');
assert.equal(included.calculated,389,'Posted 360 plus known subscription 29, never a spend average');
assert.deepEqual(included.predictedTransactions.map(x=>x.merchant),['Known subscription']);
assert.equal(withSubscription.ledger.filter(e=>e.date==='2026-11-11'&&e.kind==='movement')[0].amount,389);
const nextKnown={futureRecurringRules:[{id:'monthly-card-sub',kind:'event',frequency:'monthly',
 anchorDate:'2026-11-05',date:'2026-11-05',amount:25,type:'expense',accountId:'card',
 merchant:'Streaming',originalMerchant:'Streaming',originalAccountId:'card',
 matchNames:['streaming'],exampleIds:[]}]};
const withRecurring=C.materialize(snapshot,history,nextKnown,T,P,90);
assert.ok(withRecurring.payments.paymentDetails.some(x=>x.withdrawalDate==='2026-12-11'&&
 x.predictedTransactions.some(t=>t.merchant==='Streaming')),
 'Confirmed recurring card expense contributes to next month rather than an invented generic charge');
assert.ok(withRecurring.ledger.some(e=>e.date==='2026-12-11'&&e.kind==='movement'),
 'A future card payment is created only from an actual scheduled card transaction');
assert.equal(result.projection.household.conservationDifference,0);
assert.equal(JSON.stringify(history),original,'Plaid records remain immutable');
const noPairs=history.filter(t=>!t.pairedTransactionId);
assert.equal(P.inferPayment(accounts[1],accounts,noPairs,asOf).eligible,false,
 'Card spending alone cannot invent a funding account/payment date');
assert.equal(P.build(snapshot,noPairs,[],{},{}).plans.length,0,
 'No guessed checking withdrawal without consistent linked payment evidence');
const settings={paymentRules:{card:{billingStartDate:'2026-10-01',
 billingEndDate:'2026-10-31',nextPaymentDate:'2026-11-11',
 nextDueDate:'2026-11-12',fromAccountId:'checking',autopayEnabled:false,method:'statement',
 closingDay:31}}};
assert.equal(P.build(snapshot,history,[],settings,{days:90}).plans.length,0,
 'Confirmed manual card payments / no-autopay intent supersede auto inference');
const edited={futureTransactionAdds:[{
 id:'future-add|card-manual',date:'2026-11-10',amount:470,
 merchant:'Card payment override',type:'transfer',fromAccountId:'checking',toAccountId:'card'
}]};
const override=C.materialize(snapshot,history,edited,T,P,90);
assert.equal(override.ledger.filter(e=>e.kind==='movement'&&e.date.startsWith('2026-11')).length,1,
 'User supplied transfer replaces provisional card withdrawal within November');
console.log('PASS inferred card payment uses paired bank history, no unconfirmed date guessing, independent card charges, no double debit, immutable Plaid records');
