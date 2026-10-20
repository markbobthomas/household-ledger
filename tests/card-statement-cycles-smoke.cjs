'use strict';
const assert=require('node:assert/strict');
const Model=require('../ledger-data.js');
const Payments=require('../payment-obligations.js');
const Forecast=require('../account-forecast.js');
const snapshot={mode:'demo',asOf:'2026-10-20',accounts:[
 {id:'checking',name:'Main Checking',type:'depository',current:4000,available:3900,simulated:true},
 {id:'savings',name:'Savings',type:'depository',current:900,available:900,simulated:true},
 {id:'visa',name:'Rewards Visa',type:'credit',current:300,simulated:true},
 {id:'amex',name:'Travel Amex',type:'credit',current:500,simulated:true}
]};
const state=Model.migrate({});
Model.setCardPaymentRule(state,'visa',{
 billingStartDate:'2026-10-19',billingEndDate:'2026-11-18',
 nextPaymentDate:'2026-12-12',nextDueDate:'2026-12-13',
 fromAccountId:'checking',autopayEnabled:'yes',lastStatementBalance:'',method:'statement'
});
Model.setCardPaymentRule(state,'amex',{
 billingStartDate:'2026-10-01',billingEndDate:'2026-10-31',
 nextPaymentDate:'2026-11-22',nextDueDate:'2026-11-23',
 fromAccountId:'savings',autopayEnabled:true,method:'statement'
});
const posted=[
 {id:'visa-grocery',date:'2026-10-19',accountId:'visa',type:'expense',amount:100,merchant:'Store'},
 {id:'visa-gas',date:'2026-10-20',accountId:'visa',type:'expense',amount:55,merchant:'Gas'},
 {id:'visa-refund',date:'2026-10-20',accountId:'visa',type:'refund',amount:5,merchant:'Refund'},
 {id:'visa-pending',date:'2026-10-20',accountId:'visa',type:'expense',amount:70,merchant:'Pending',pending:true},
 {id:'amex-dinner',date:'2026-10-04',accountId:'amex',type:'expense',amount:90,merchant:'Restaurant'},
 {id:'checking-grocery',date:'2026-10-19',accountId:'checking',type:'expense',amount:999,merchant:'No card'}
];
const forecast=[
 {id:'visa-sub',date:'2026-11-02',accountId:'visa',type:'expense',amount:20,merchant:'Subscription'},
 {id:'visa-service',date:'2026-11-12',accountId:'visa',type:'expense',amount:30,merchant:'Service'},
 {id:'visa-next-sub',date:'2026-12-02',accountId:'visa',type:'expense',amount:20,merchant:'Subscription'},
 {id:'amex-future',date:'2026-10-22',accountId:'amex',type:'expense',amount:50,merchant:'Hotel'},
 {id:'bank-charge',date:'2026-10-23',accountId:'checking',type:'expense',amount:700,merchant:'Not card'}
];
const before=JSON.stringify(posted),beforeState=JSON.stringify(state.transactions);
const plan=Payments.build(snapshot,posted,forecast,state.predictions,{days:90});
const visa=plan.statements.filter(x=>x.cardId==='visa'),amex=plan.statements.filter(x=>x.cardId==='amex');
assert.equal(visa.length,2,'Each configured card has future statement cycles within 90 days');
assert.equal(visa[0].periodStart,'2026-10-19');
assert.equal(visa[0].periodEnd,'2026-11-18');
assert.equal(visa[0].statementBalance,200,
 'Card-only posted charges minus refunds plus known future card expenses');
assert.equal(visa[0].purchases,155);
assert.equal(visa[0].refunds,5);
assert.equal(visa[0].bankPurchases,150);
assert.equal(visa[0].estimatedCharges,50);
assert.equal(visa[0].pendingExcluded,1,'Pending charges are not silently presented as posted');
assert.equal(visa[0].estimated,true);
assert.equal(visa[0].confirmed,false);
assert.equal(visa[0].dueDate,'2026-12-13');
assert.equal(visa[0].withdrawalDate,'2026-12-12');
assert.equal(visa[1].periodStart,'2026-11-19','Following cycle starts the day after prior close');
assert.equal(visa[1].periodEnd,'2026-12-18');
assert.equal(visa[1].statementBalance,20,'Next cycle does not repeat prior card purchases');
assert.equal(visa[1].withdrawalDate,'2027-01-12');
assert.equal(amex[0].statementBalance,140);
assert.equal(amex[0].fromAccountId,'savings','Each card has a separate chosen payment account');
assert.equal(amex[0].withdrawalDate,'2026-11-22');
assert.equal(plan.plans.length,3,'Two Visa cycles and one Amex cycle produce distinct transfers');
assert.deepEqual(plan.plans.map(x=>[x.fromAccountId,x.toAccountId,x.amount]).sort(),
 [['checking','visa',20],['checking','visa',200],['savings','amex',140]].sort());
const projection=Forecast.build(snapshot,forecast,plan.plans,{days:90,records:posted});
assert.equal(projection.diagnostics.pairedMovements.length,3,'Each autopay is a single two-sided transfer');
const byId=Object.fromEntries(projection.accounts.map(x=>[x.id,x]));
assert.equal(byId.checking.closing,3080,'Other forecast checking expenses are included once, separately from credit card bills');
assert.equal(byId.savings.closing,760);
assert.equal(byId.visa.closing,150,'Card debt includes future purchases and decreases on actual autopay day');
assert.equal(byId.amex.closing,410);
assert.equal(JSON.stringify(posted),before,'Bank history never changed');
assert.equal(JSON.stringify(state.transactions),beforeState,'Source ledger unchanged');
// A card without autopay still displays its estimated bill, with NO checking debit.
const noAuto=Model.migrate({});
Model.setCardPaymentRule(noAuto,'visa',{
 billingStartDate:'2026-10-19',billingEndDate:'2026-11-18',
 nextPaymentDate:'2026-12-12',nextDueDate:'2026-12-13',
 autopayEnabled:'no',fromAccountId:'',method:'statement'
});
const optional=Payments.build(snapshot,posted,forecast,noAuto.predictions,{days:90});
assert.equal(optional.statements[0].statementBalance,200);
assert.equal(optional.statements[0].autopayEnabled,false);
assert.equal(optional.plans.length,0,'No autopay transfer is fabricated if disabled');
// User-entered issued statement is authoritative ONLY after cycle close.
const issued=Model.migrate({});
Model.setCardPaymentRule(issued,'visa',{
 billingStartDate:'2026-09-19',billingEndDate:'2026-10-18',
 nextPaymentDate:'2026-11-11',nextDueDate:'2026-11-12',
 fromAccountId:'checking',lastStatementBalance:700,method:'statement'
});
const statement=Payments.build(snapshot,posted,forecast,issued.predictions,{days:90});
assert.equal(statement.statements[0].statementBalance,700);
assert.equal(statement.statements[0].confirmed,true);
const unissued=Model.migrate({});
Model.setCardPaymentRule(unissued,'visa',{
 billingStartDate:'2026-10-19',billingEndDate:'2026-11-18',
 nextPaymentDate:'2026-12-12',nextDueDate:'2026-12-13',
 fromAccountId:'checking',lastStatementBalance:1200,method:'statement'
});
assert.equal(Payments.build(snapshot,posted,forecast,unissued.predictions,{days:90}).statements[0].confirmed,false,
 'A future period is never called an issued bank statement');
assert.throws(()=>Model.setCardPaymentRule(state,'visa',{
 billingStartDate:'2026-11-18',billingEndDate:'2026-11-18',
 nextPaymentDate:'2026-12-12',fromAccountId:'checking'
}),/valid billing period/);
assert.throws(()=>Model.setCardPaymentRule(state,'visa',{
 billingStartDate:'2026-10-19',billingEndDate:'2026-11-18',
 nextPaymentDate:'2026-12-18',nextDueDate:'2026-12-13',fromAccountId:'checking'
}),/valid billing period/);
console.log('PASS two-card billing cycles, purchase/refund/forecast sums, pending exclusion, linked checking autodebits, future cycles, opt-out, issued statement override and immutable sources');
