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
const previousBigBills=[
 {id:'prior-aug',date:'2026-08-22',accountId:'visa',type:'expense',amount:1400,merchant:'Prior spending'},
 {id:'prior-sep',date:'2026-09-22',accountId:'visa',type:'expense',amount:1200,merchant:'Prior spending'}
];
const plan=Payments.build(snapshot,[...posted,...previousBigBills],forecast,state.predictions,{days:90});
const visa=plan.statements.filter(x=>x.cardId==='visa'),amex=plan.statements.filter(x=>x.cardId==='amex');
assert.equal(visa.length,2,'Each configured card has future statement cycles within 90 days');
assert.equal(visa[0].periodStart,'2026-10-19');
assert.equal(visa[0].periodEnd,'2026-11-18');
assert.equal(visa[0].statementBalance,200,
 'Card-only posted charges minus refunds plus known future card expenses');
assert.equal(visa[0].purchases,155);
assert.equal(visa[0].refunds,5);
assert.equal(visa[0].bankPurchases,150);
assert.equal(visa[0].actualPeriodNet,150,'Actual spending excludes future estimates');
assert.equal(visa[0].postedTransactions.length,3,'Every settled charge and refund is auditable');
assert.equal(visa[0].postedTransactions.reduce((sum,x)=>sum+(x.type==='refund'?-x.amount:x.amount),0),150);
assert.equal(visa[0].periodComplete,false,'Open statement cycle has not finished');
assert.equal(visa[0].historicalAverage,null,
 'No average monthly spending is added to a statement estimate');
assert.deepEqual(visa[0].predictedTransactions.map(x=>x.merchant),['Subscription','Service']);
const detail=plan.paymentDetails.find(x=>x.cardId==='visa'&&x.withdrawalDate==='2026-12-12');
assert.equal(detail.calculated,200);
assert.deepEqual(detail.postedTransactions.map(x=>x.id),['visa-grocery','visa-gas','visa-refund']);
assert.deepEqual(detail.predictedTransactions.map(x=>x.amount),[20,30]);
assert.equal(detail.calculated,detail.postedTransactions.reduce((v,t)=>v+(t.type==='refund'?-t.amount:t.amount),0)+
 detail.predictedTransactions.reduce((v,t)=>v+(t.type==='refund'?-t.amount:t.amount),0));

assert.equal(amex[0].postedTransactions.length,1,'Expenses are isolated to each card');
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
// After the prior statement closes but before it is paid, the FOLLOWING cycle
// can contain real posted activity and still-future confirmed predictions.
// The Calendar's third figure must reuse this independently calculated cycle.
const midCycleSnapshot={...snapshot,asOf:'2026-11-03'};
const secondCycle=Payments.build(midCycleSnapshot,[
 {id:'current-cycle-actual',date:'2026-10-25',accountId:'visa',type:'expense',amount:40,merchant:'Already posted'},
 {id:'current-cycle-refund',date:'2026-11-02',accountId:'visa',type:'refund',amount:5,merchant:'Refund'},
 {id:'current-cycle-pending',date:'2026-11-02',accountId:'visa',type:'expense',amount:200,merchant:'Pending',pending:true},
 {id:'prior-cycle-posted',date:'2026-10-18',accountId:'visa',type:'expense',amount:500,merchant:'Prior statement'}
],[
 {id:'current-cycle-scheduled',date:'2026-11-09',accountId:'visa',type:'expense',amount:30,merchant:'Planned subscription'},
 {id:'after-statement-close',date:'2026-11-19',accountId:'visa',type:'expense',amount:99,merchant:'Later period'}
],issued.predictions,{days:90});
const followingStatement=secondCycle.statements.filter(x=>x.cardId==='visa')[1];
assert.ok(followingStatement,'The following cycle is available to the Calendar');
assert.equal(followingStatement.periodStart,'2026-10-19');
assert.equal(followingStatement.periodEnd,'2026-11-18');
assert.equal(followingStatement.bankPurchases,35,'Actual spending in this cycle nets out refunds');
assert.equal(followingStatement.estimatedCharges,30,'Future approved card charges belong in the same cycle');
assert.equal(followingStatement.statementBalance,65,
 'Next statement estimate combines real posted 40 minus refund 5 plus scheduled 30');
assert.equal(followingStatement.observedCount,2);
assert.equal(followingStatement.scheduledCount,1);
assert.equal(followingStatement.pendingExcluded,1);
assert.equal(followingStatement.confirmed,false,
 'Only the already-issued prior statement may be labeled confirmed');
assert.equal(secondCycle.statements[0].statementBalance,700,
 'Following cycle never replaces or double-counts the issued first statement');
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
// If bank history shows an early completed, paired card payment, the bank
// opening balances already include it: never schedule the same autopay twice.
const earlySnapshot={...snapshot,asOf:'2026-11-10'};
const postedPayment=[
 {id:'checking-paid',date:'2026-11-09',type:'transfer',accountingKind:'card_payment',
  cashDirection:'out',accountId:'checking',amount:700,pairedTransactionId:'visa-paid'},
 {id:'visa-paid',date:'2026-11-09',type:'transfer',accountingKind:'card_payment',
  cashDirection:'in',accountId:'visa',amount:700,pairedTransactionId:'checking-paid'}
];
const actual=Payments.build(earlySnapshot,postedPayment,[],issued.predictions,{days:30});
assert.equal(actual.statements[0].alreadyPaid,true,'Confirmed posted payment recognized before scheduled date');
assert.equal(actual.statements[0].actualPaymentDate,'2026-11-09','Use actual posted bank date, not scheduled November 11');
assert.equal(actual.statements[0].actualPaymentAmount,700);
assert.equal(actual.statements[0].lastPostedPayment.date,'2026-11-09');
assert.equal(actual.plans.length,0,'No second checking withdrawal after posted card autopay');
const wrongAccount=Payments.build(earlySnapshot,postedPayment.map(t=>
 ({...t,accountId:t.accountId==='checking'?'savings':t.accountId})),[],
 issued.predictions,{days:30});
assert.ok(wrongAccount.plans.some(x=>x.amount===700),
 'Do not suppress a card bill when source checking account does not match');
// The bank's actual settled transfer is authoritative even if it differs
// from the estimated full-statement amount; never debit checking twice.
const uncertain=Payments.build(earlySnapshot,postedPayment.map(p=>({...p,amount:640})),[],
 issued.predictions,{days:30});
assert.equal(uncertain.statements[0].actualPaymentDate,'2026-11-09');
assert.equal(uncertain.statements[0].actualPaymentAmount,640);
assert.equal(uncertain.plans.length,0,'Actual $640 payment suppresses stale estimated $700 autopay');
assert.ok(uncertain.warnings.some(w=>w.includes('differs from planned')),
 'A partial or different amount requires reconciliation, not silent full-payment claim');
const paymentMismatch=uncertain.warningActions.find(a=>
 a.kind==='card-payment-difference');
assert.ok(paymentMismatch,'Actual-versus-estimate mismatch must have a review destination');
assert.equal(paymentMismatch.cardId,'visa',
 'Review destination uses the exact credit-card identity, not a merchant search');
assert.equal(paymentMismatch.periodEnd,uncertain.statements[0].periodEnd,
 'Review destination opens the statement cycle that generated the warning');
assert.ok(uncertain.warnings.includes(paymentMismatch.message),
 'Clickable warning metadata must reference the original visible warning');
assert.equal(actual.warningActions.length,0,
 'Matching full payment must not create a false review action');
// Candidate reconciliation is advisory: a separate exact payment, two
// checking withdrawals or an issuer-only credit can explain a difference,
// but none may mutate bank records or be called a confirmed settlement.
const differingPaid=postedPayment.map(p=>({...p,amount:640}));
const postedExtra={id:'additional-cash-payment',date:'2026-11-10',
 accountId:'checking',type:'transfer',accountingKind:'card_payment',
 cashDirection:'out',amount:60,merchant:'Credit Card Payment',pending:true};
const possible=Payments.build(earlySnapshot,[...differingPaid,postedExtra],[],
 issued.predictions,{days:30});
const suggested=possible.warningActions.find(a=>a.kind==='card-payment-difference');
assert.ok(suggested);
assert.equal(suggested.difference,60);
assert.equal(suggested.suggestions[0].amount,60);
assert.equal(suggested.suggestions[0].pending,true,
 'Pending payment is only a possible match, never posted proof');
assert.equal(possible.statements[0].actualPaymentAmount,640,
 'The candidate never adds an unverified payment to the actual total');
assert.equal(possible.plans.length,0,
 'Already recognized posted payment still prevents a second full autopay');
assert.ok(suggested.signature.includes('640.00'));
const differenceSplitRows=[20,40].map((amount,i)=>({...postedExtra,
 id:'split-cash-'+i,amount,pending:false}));
const differenceSplit=Payments.build(earlySnapshot,[...differingPaid,...differenceSplitRows],[],
 issued.predictions,{days:30}).warningActions.find(a=>a.kind==='card-payment-difference');
assert.ok(differenceSplit.suggestions.some(c=>c.kind==='split'&&c.amount===60),
 'Two distinct bank-side payment-like debits may explain the gap');
const issuerCredit=Payments.build(earlySnapshot,[...differingPaid,{
 id:'unpaired-issuer-credit',date:'2026-11-10',accountId:'visa',
 type:'transfer',accountingKind:'card_payment',cashDirection:'in',
 amount:60,merchant:'Payment Received',pending:false
}],[],issued.predictions,{days:30}).warningActions.find(a=>a.kind==='card-payment-difference');
assert.ok(issuerCredit.suggestions.some(c=>c.side==='Credit card'&&c.amount===60),
 'Unpaired issuer-side credit is shown as a possible match, not a checked debit');
const unrelated=Payments.build(earlySnapshot,[...differingPaid,{
 ...postedExtra,id:'groceries',type:'expense',accountingKind:'purchase',
 merchant:'Grocery Store',pending:false
}],[],issued.predictions,{days:30}).warningActions.find(a=>a.kind==='card-payment-difference');
assert.deepEqual(unrelated.suggestions,[],
 'An unrelated equal-amount purchase must not become a candidate payment');
// The checking debit can settle before the card issuer reports its credit.
const checkingOnly=[{id:'checking-posted-first',date:'2026-11-09',accountId:'checking',
 type:'transfer',accountingKind:'card_payment',cashDirection:'out',amount:700,
 merchant:'Credit Card Autopay',pending:false}];
const checkingOnlyOriginal=JSON.stringify(checkingOnly);
const oneSided=Payments.build(earlySnapshot,checkingOnly,[],issued.predictions,{days:30});
assert.equal(oneSided.plans.length,0,'Posted checking-side card debit is not forecast twice');
assert.equal(oneSided.statements[0].alreadyPaid,true);
assert.equal(oneSided.statements[0].actualPaymentDate,'2026-11-09');
assert.equal(oneSided.statements[0].actualPaymentAmount,700);
assert.ok(oneSided.warnings.some(w=>w.includes('card credit is not yet matched')),
 'Warn when the matching card credit has not yet posted');
assert.equal(JSON.stringify(checkingOnly),checkingOnlyOriginal,'Source bank facts are immutable');
assert.equal(Payments.build(earlySnapshot,[{...checkingOnly[0],pending:true}],[],
 issued.predictions,{days:30}).plans.length,1,'Pending debit cannot prove posted settlement');
assert.equal(Payments.build(earlySnapshot,[{...checkingOnly[0],accountId:'savings'}],[],
 issued.predictions,{days:30}).plans.length,1,'Wrong funding account cannot settle');
assert.equal(Payments.build(earlySnapshot,[{...checkingOnly[0],
 type:'expense',accountingKind:'purchase',merchant:'Unrelated grocery purchase'}],[],
 issued.predictions,{days:30}).plans.length,1,'Unrelated purchase cannot settle');
assert.equal(Payments.build(earlySnapshot,[{...checkingOnly[0],amount:75}],[],
 issued.predictions,{days:30}).plans.length,1,
 'A wrong-amount generic debit cannot erase a much larger card obligation');
assert.equal(Payments.build(earlySnapshot,[checkingOnly[0],{...checkingOnly[0],
 id:'second-ambiguous-debit'}],[],issued.predictions,{days:30}).plans.length,1,
 'Two unpaired debits competing for a cycle must not be guessed');
const twoCards={paymentRules:{...issued.predictions.paymentRules,amex:{
 billingStartDate:'2026-09-19',billingEndDate:'2026-10-18',closingDay:18,
 nextPaymentDate:'2026-11-11',nextDueDate:'2026-11-12',fromAccountId:'checking',
 method:'fixed',fixedAmount:500,autopayEnabled:true
}}};
assert.equal(Payments.build(earlySnapshot,checkingOnly,[],twoCards,{days:30}).plans.length,2,
 'Shared funding source and same due dates are ambiguous');
const named=Payments.build(earlySnapshot,[{...checkingOnly[0],
 merchant:'Amex Card Autopay'}],[],twoCards,{days:30});
assert.equal(named.plans.length,1,'Issuer name can disambiguate a single card');
assert.equal(named.plans[0].toAccountId,'visa','Unrelated card remains forecast');
assert.equal(Payments.build(earlySnapshot,[{...checkingOnly[0],
 merchant:'Amex Card Autopay'}],[],issued.predictions,{days:30}).plans.length,1,
 'Named debit for another connected card cannot settle Visa');
// Real bank ACH card-payment descriptions sometimes use PMT/EPAY, leaving
// the posted checking withdrawal classified as an expense until issuer credit
// arrives. Never forecast the same checking debit a second time.
const Adapter=require('../pilot/data-source.js');
const Accounting=require('../accounting.js');
const imported=Adapter.record({
 id:'plaid-amex-ach',date:'2026-11-09',amount:500,
 name:'AMEX ACH PMT',accountId:'checking',pending:false
},{id:'checking',name:'Main Checking',type:'depository'});
const cleaned=Accounting.reconcile({
 accounts:earlySnapshot.accounts.map(a=>({id:a.id,name:a.name,type:a.type})),
 transactions:[imported]
}).transactions;
assert.equal(cleaned[0].type,'expense','Unusual ACH PMT is still an expense before card-side pairing');
assert.equal(cleaned[0].accountingKind,'purchase','This reproduces missing one-sided payment classification');
const issuerAch=Payments.build(earlySnapshot,cleaned,[],twoCards,{days:30});
assert.deepEqual(issuerAch.plans.map(p=>p.toAccountId),['visa'],
 'A posted AMEX ACH PMT debit clears only the unambiguously named Amex payment');
assert.equal(issuerAch.statements.find(s=>s.cardId==='amex').alreadyPaid,true);
assert.equal(issuerAch.statements.find(s=>s.cardId==='amex').actualPaymentAmount,500);
assert.equal(Payments.build(earlySnapshot,cleaned.map(t=>({...t,pending:true})),[],
 twoCards,{days:30}).plans.length,2,'A pending PMT descriptor cannot prove settlement');
const genericCardPmt=Payments.build(earlySnapshot,[{
 id:'generic-cc-pmt',date:'2026-11-09',accountId:'checking',
 type:'expense',accountingKind:'purchase',cashDirection:'out',amount:700,
 merchant:'CREDIT CARD ACH PMT',pending:false
}],[],issued.predictions,{days:30});
assert.equal(genericCardPmt.plans.length,0,
 'A unique matching posted credit-card ACH PMT is not double forecast');
assert.equal(Payments.build(earlySnapshot,[{
 id:'unrelated-merchant',date:'2026-11-09',accountId:'checking',
 type:'expense',accountingKind:'purchase',cashDirection:'out',amount:700,
 merchant:'Coffee Shop Payment',pending:false
}],[],issued.predictions,{days:30}).plans.length,1,
 'Merchant payments without explicit card evidence are not auto-reconciled');
assert.equal(Payments.build(earlySnapshot,[{
 id:'loan-pmt',date:'2026-11-09',accountId:'checking',
 type:'expense',accountingKind:'loan_payment',cashDirection:'out',amount:500,
 merchant:'AMEX Personal Loan PMT',pending:false
}],[],twoCards,{days:30}).plans.length,2,
 'Issuer names on loan payments cannot settle credit-card bills');
assert.equal(Payments.build(earlySnapshot,[{
 id:'ambiguous-cc-pmt',date:'2026-11-09',accountId:'checking',
 type:'expense',accountingKind:'purchase',cashDirection:'out',amount:700,
 merchant:'CREDIT CARD ACH PMT',pending:false
}],[],twoCards,{days:30}).plans.length,2,
 'Generic PMT labels cannot settle one of two competing cards');

// Plaid's original payment name must survive a different merchant label.
const splitPayment=Adapter.record({
 id:'split-desc',date:'2026-11-09',accountId:'checking',
 merchant:'American Express',name:'AMEX ACH PMT',amount:500,pending:false
},{id:'checking',name:'Main Checking',type:'depository'});
assert.equal(splitPayment.merchant,'American Express');
assert.equal(splitPayment.description,'AMEX ACH PMT');
const splitRows=Accounting.reconcile({
 accounts:earlySnapshot.accounts.map(a=>({id:a.id,name:a.name,type:a.type})),
 transactions:[splitPayment]
}).transactions;
assert.deepEqual(Payments.build(earlySnapshot,splitRows,[],twoCards,{days:30})
 .plans.map(p=>p.toAccountId),['visa'],
 'Original ACH descriptor settles only matching issuer in two-card case');
assert.equal(Payments.build(earlySnapshot,[{...splitRows[0],
 description:'Bank-imported transaction'}],[],twoCards,{days:30}).plans.length,2,
 'Dropping the original ACH descriptor would leave both payments unmatched');

// Once the billing period is closed, no hypothetical future purchases
// contribute to its total; the posted ledger is the actual cash ledger.
const closedNoIssuer=Model.migrate({});
Model.setCardPaymentRule(closedNoIssuer,'visa',{
 billingStartDate:'2026-09-19',billingEndDate:'2026-10-18',
 nextPaymentDate:'2026-11-11',nextDueDate:'2026-11-12',
 fromAccountId:'checking',lastStatementBalance:'',method:'statement'
});
const allPosted=[
 {id:'old-groceries',date:'2026-09-19',amount:110,accountId:'visa',type:'expense',merchant:'Grocery'},
 {id:'old-service',date:'2026-10-18',amount:210,accountId:'visa',type:'expense',merchant:'Service'},
 {id:'old-refund',date:'2026-10-16',amount:20,accountId:'visa',type:'refund',merchant:'Refund'},
 {id:'outside-cycle',date:'2026-10-19',amount:999,accountId:'visa',type:'expense',merchant:'Later'}
];
const closedPlan=Payments.build(snapshot,allPosted,
 [{id:'hypothetical',accountId:'visa',date:'2026-10-25',type:'expense',amount:999}],
 closedNoIssuer.predictions,{days:90});
assert.equal(closedPlan.statements[0].periodComplete,true);
assert.equal(closedPlan.statements[0].purchases,320);
assert.equal(closedPlan.statements[0].refunds,20);
assert.equal(closedPlan.statements[0].actualPeriodNet,300);
assert.equal(closedPlan.statements[0].estimatedCharges,0);
assert.equal(closedPlan.statements[0].amount,300,'Closed period plans for all actual net purchases');
assert.equal(closedPlan.statements[0].confirmed,false,
 'Posted charges alone do not prove bank-issued statement equals $300 (prior balance, fees)');
// Regression: the historical missed-payment safety net must cover card
// autopay as well as ordinary checking bills. No live bank data is used.
const Core=require('../planner-core.js'),T=require('../planner-transactions.js');
const dueAccounts=[
 {id:'checking-due',name:'Fictional Checking',accountType:'checking',
  current:2000,available:2000,simulated:true},
 {id:'card-due',name:'Fictional Visa',accountType:'credit',current:700,simulated:true}
];
const dueRule={billingStartDate:'2026-09-19',billingEndDate:'2026-10-18',
 closingDay:18,nextPaymentDate:'2026-11-02',nextDueDate:'2026-11-03',
 fromAccountId:'checking-due',method:'fixed',fixedAmount:700,autopayEnabled:true};
const duePrefs={paymentRules:{'card-due':dueRule}};
const dueSnapshot=(asOf,accounts=dueAccounts)=>({asOf,accounts,mode:'demo'});
const calculate=(asOf,bank=[],prefs=duePrefs,accounts=dueAccounts)=>
 Core.materialize(dueSnapshot(asOf,accounts),bank,prefs,T,Payments,60,{weekendPolicy:'friday'});
const cardMoves=b=>b.ledger.filter(x=>x.kind==='movement'&&x.toAccountId==='card-due');
const firstCard=b=>cardMoves(b).filter(p=>p.id==='autopay|card-due|2026-11-02');
const todayUnposted=calculate('2026-11-02');
assert.equal(firstCard(todayUnposted).length,1,'Due-today card autopay is not discarded');
assert.equal(firstCard(todayUnposted)[0].date,'2026-11-03','Unposted payment reserves next business day');
assert.equal(firstCard(todayUnposted)[0].originalDueDate,'2026-11-02','Stable original statement date retained');
assert.equal(todayUnposted.overduePayments.length,1,'Due-today unpaid autopay appears in Review');
assert.equal(todayUnposted.overduePayments[0].kind,'movement','Overdue card item uses linked-transfer editing');
assert.equal(todayUnposted.projection.accounts.find(a=>a.id==='checking-due')
 .series.find(p=>p.date==='2026-11-03').balance,1300,
 'The projected checking balance must reserve the unposted card payment');
const nextDay=calculate('2026-11-03');
assert.equal(firstCard(nextDay).length,1,'Missing bank posting still has exactly one debit');
assert.equal(firstCard(nextDay)[0].date,'2026-11-04','Unpaid card is carried forward again');
assert.equal(firstCard(calculate('2026-11-12')).filter(x=>x.originalDueDate==='2026-11-02').length,1,
 'Missing card payment survives more than a week of bank posting delay');
const paidBank=[
 {id:'actual-checking',date:'2026-11-02',accountId:'checking-due',
  type:'transfer',accountingKind:'card_payment',cashDirection:'out',amount:700,
  pairedTransactionId:'actual-card',pending:false},
 {id:'actual-card',date:'2026-11-02',accountId:'card-due',
  type:'transfer',accountingKind:'card_payment',cashDirection:'in',amount:700,
  pairedTransactionId:'actual-checking',pending:false}
];
const paid=calculate('2026-11-03',paidBank);
assert.equal(firstCard(paid).length,0,'Actual paired bank posting settles due installment once');
assert.equal(paid.overduePayments.length,0,'Posted autopay clears the missed-payment alert');
const postedCheckingOnly=calculate('2026-11-03',[{
 id:'posted-cash-without-card-credit',date:'2026-11-02',accountId:'checking-due',
 type:'transfer',accountingKind:'card_payment',cashDirection:'out',amount:700,
 merchant:'Credit Card Autopay',pending:false
}]);
assert.equal(firstCard(postedCheckingOnly).length,0,
 'The canonical balance calendar cannot deduct a completed one-sided card payment twice');
assert.equal(postedCheckingOnly.overduePayments.length,0,
 'Confirmed checking debit resolves the missed-payment review');
assert.deepEqual(postedCheckingOnly.projection.diagnostics.balanceMismatches,[],
 'Single-sided posted settlement preserves cashflow balance integrity');
const wrongBank=calculate('2026-11-03',paidBank.map(x=>({...x,accountId:
 x.accountId==='checking-due'?'other-account':x.accountId})));
assert.equal(firstCard(wrongBank).length,1,'Another account cannot settle the planned checking withdrawal');
const pendingBank=[{id:'pending-checking',date:'2026-11-02',
 accountId:'checking-due',type:'transfer',accountingKind:'card_payment',
 cashDirection:'out',amount:700,pending:true}];
const pendingAccounts=[{...dueAccounts[0],available:1300},dueAccounts[1]];
const pending=calculate('2026-11-03',pendingBank,duePrefs,pendingAccounts);
assert.equal(firstCard(pending).length,0,'Available-balance reserved pending card debit is not deducted twice');
assert.equal(pending.pendingPaymentMatches.length,1,'Pending debit is provisional, never reported as posted');
assert.equal(pending.payments.statements[0].alreadyPaid,false);
const unreserved=calculate('2026-11-03',pendingBank);
assert.equal(firstCard(unreserved).length,1,'Pending debit without a bank available hold still needs a reserve');
assert.equal(firstCard(calculate('2026-11-03',[])).length,1,
 'If pending debit disappears without posting, card prediction returns');
const ignored={...duePrefs,overdueReviewDismissals:{
 [T.keyMovement('autopay|card-due|2026-11-02')]:'2026-11-02'}};
assert.equal(firstCard(calculate('2026-11-03',[],ignored)).length,1,
 'Dismissal of overdue review cannot silently erase the forecast reserve');
const skipped={...duePrefs,futureTransactionEdits:{
 [T.keyMovement('autopay|card-due|2026-11-02')]:{skipped:true}}};
assert.equal(firstCard(calculate('2026-11-03',[],skipped)).length,0,
 'Intentional skip removes only the chosen outstanding autopay');
const twoCycles=calculate('2026-12-03');
const carried=cardMoves(twoCycles).filter(p=>['2026-11-02','2026-12-02'].includes(p.originalDueDate));
assert.equal(carried.length,2,'Independent overdue statement cycles must not collapse as duplicates');
assert.deepEqual(carried.map(p=>p.date),['2026-12-04','2026-12-04'],
 'Both unconfirmed card cycles reserve the next business day');
const postedBeforeDue=calculate('2026-11-02',paidBank);
assert.equal(firstCard(postedBeforeDue).length,0,'Bank posting on the due date prevents a second forecast debit');
assert.deepEqual(paid.projection.diagnostics.balanceMismatches,[],
 'Card reconciliation must preserve full daily balance integrity');
// Shared payment reconciliation: bank pending amounts are facts, estimates
// are only planned amounts. An unmatched pending card debit must not produce
// a second cash withdrawal solely because an estimate differs by >2%.
const universalAccounts=[
 {id:'cash-main',name:'Fictional Checking',accountType:'checking',
  current:5490,available:2500,simulated:true},
 {id:'card-a',name:'Credit Card ••1111',accountType:'credit',
  current:3300,simulated:true},
 {id:'card-b',name:'Credit Card ••2222',accountType:'credit',
  current:2600,simulated:true},
 {id:'cash-other',name:'Other Savings',accountType:'savings',
  current:800,available:800,simulated:true}
];
const paymentRule=(when,amount)=>({
 billingStartDate:'2026-09-19',billingEndDate:'2026-10-18',
 closingDay:18,nextPaymentDate:when,nextDueDate:when,
 fromAccountId:'cash-main',method:'fixed',fixedAmount:amount,autopayEnabled:true
});
const universalPrefs={paymentRules:{
 'card-a':paymentRule('2026-11-06',3300),
 'card-b':paymentRule('2026-11-10',2600)
}};
const universalPending={
 id:'pending-card-ach',date:'2026-11-04',accountId:'cash-main',
 type:'transfer',accountingKind:'card_payment',cashDirection:'out',
 merchant:'ISSUER CREDIT CRD AUTOPAY',amount:2990,pending:true
};
const universal=(records,accounts=universalAccounts,prefs=universalPrefs)=>Core.materialize(
 {asOf:'2026-11-05',accounts,mode:'demo'},records,prefs,T,Payments,30,
 {weekendPolicy:'friday'});
const byCard=(b,id)=>b.ledger.filter(x=>x.kind==='movement'&&
 String(x.toAccountId)===id);
const reservedPayment=universal([universalPending]);
assert.equal(byCard(reservedPayment,'card-a').length,0,
 'Bank-available reserved pending card debit must suppress its duplicate larger estimate');
assert.equal(byCard(reservedPayment,'card-b').length,1,
 'Another card with a distinct due date keeps its independent forecast');
assert.equal(reservedPayment.pendingPaymentMatches.filter(x=>
 x.bankId===universalPending.id).length,1,
 'One pending bank debit can reserve at most one forecast');
assert.equal(reservedPayment.pendingPaymentMatches.find(x=>
 x.bankId===universalPending.id).reservedInAvailable,true);
assert.equal(reservedPayment.payments.statements.find(s=>s.cardId==='card-a').alreadyPaid,false,
 'Pending withdrawal must never be labeled posted');
assert.equal(reservedPayment.payments.statements.find(s=>s.cardId==='card-a').pendingReserved,true);
assert.ok(!reservedPayment.payments.warnings.some(w=>w.includes('A pending bank withdrawal matches')),
 'Automatically matched pending payment must not appear as a manual Forecast requires review warning');
assert.equal(reservedPayment.paymentReconciliations.find(m=>m.bankId===universalPending.id).status,'pending',
 'Pending bank payment remains inspectable as provisional, never posted');
assert.deepEqual(reservedPayment.projection.diagnostics.balanceMismatches,[]);
const notHeld=universal([universalPending],universalAccounts.map(a=>
 a.id==='cash-main'?{...a,available:5490}:a));
assert.deepEqual(byCard(notHeld,'card-a').map(x=>x.amount),[2990],
 'Without bank available hold, use the observed pending amount ONCE, not the forecast amount');
assert.equal(notHeld.pendingPaymentMatches.length,0,
 'Unreserved bank pending is a future cash reserve, not a bank available hold');
assert.equal(notHeld.paymentReconciliations.find(x=>
 x.bankId===universalPending.id).reservedInAvailable,false);
assert.equal(byCard(notHeld,'card-b').length,1);
assert.deepEqual(notHeld.projection.diagnostics.balanceMismatches,[]);
const settled=universal([{...universalPending,pending:false}],
 universalAccounts.map(a=>a.id==='cash-main'?{...a,current:2500,available:2500}:a));
assert.equal(byCard(settled,'card-a').length,0,
 'When that debit posts it remains reconciled, despite the forecast amount difference');
assert.equal(byCard(settled,'card-b').length,1);
assert.equal(settled.payments.statements.find(s=>s.cardId==='card-a').alreadyPaid,true,
 'Posted debit is accurately distinguished from pending');
assert.deepEqual(settled.projection.diagnostics.balanceMismatches,[]);
assert.equal(byCard(universal([]),'card-a').length,1,
 'If the pending bank payment vanishes before posting, the forecast must return');
assert.equal(byCard(universal([{
 ...universalPending,accountId:'cash-other'
}]),'card-a').length,1,'Payment from unrelated account does not settle checking');
assert.equal(byCard(universal([{
 ...universalPending,merchant:'Fictional Grocery Market',
 accountingKind:'purchase',type:'expense'
}]),'card-a').length,1,'Ordinary merchant expense never settles a credit card');
assert.equal(byCard(universal([universalPending,{...universalPending,
 id:'another-pending-card'}]),'card-a').length,1,
 'Two competing pending bank debits cannot settle a single forecast by guess');
const competingCards={paymentRules:{
 'card-a':paymentRule('2026-11-06',3300),
 'card-b':paymentRule('2026-11-07',2600)
}};
const ambiguous=universal([universalPending],universalAccounts,competingCards);
assert.equal(byCard(ambiguous,'card-a').length,1);
assert.equal(byCard(ambiguous,'card-b').length,1,
 'Overlapping card due windows must not pick a recipient from date alone');
// Same final reconciliation also applies to generic one-off bill expenses.
const utilityAccounts=[{id:'cash-main',name:'Fictional Checking',
 accountType:'checking',current:1000,available:655,simulated:true}];
const utilityPrefs={futureTransactionAdds:[{
 id:'utility-due',accountId:'cash-main',date:'2026-11-06',
 merchant:'Fictional Power Utility',type:'expense',amount:300
}],paymentRules:{}};
const utilityPending={
 id:'utility-ach',date:'2026-11-04',accountId:'cash-main',
 merchant:'Fictional Power Utility',type:'expense',
 accountingKind:'loan_payment',cashDirection:'out',amount:345,pending:true
};
const utility=universal([utilityPending],utilityAccounts,utilityPrefs);
assert.equal(utility.ledger.filter(x=>x.kind==='event'&&
 x.merchant==='Fictional Power Utility').length,0,
 'A unique pending generic bill with different amount must not be double predicted');
assert.equal(utility.pendingPaymentMatches.length,1);
assert.deepEqual(utility.projection.diagnostics.balanceMismatches,[]);
console.log('PASS two-card billing cycles, purchase/refund/forecast sums, pending exclusion, linked checking autodebits, future cycles, opt-out, issued statement override and immutable sources');
