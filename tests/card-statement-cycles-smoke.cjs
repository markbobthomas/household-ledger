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
 type:'expense',accountingKind:'purchase'}],[],
 issued.predictions,{days:30}).plans.length,1,'Unrelated purchase cannot settle');
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
console.log('PASS two-card billing cycles, purchase/refund/forecast sums, pending exclusion, linked checking autodebits, future cycles, opt-out, issued statement override and immutable sources');
