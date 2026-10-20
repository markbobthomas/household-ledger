'use strict';
const assert=require('node:assert/strict');
const M=require('../ledger-data.js'),F=require('../forecast.js'),L=require('../forecast-ledger.js');
const P=require('../payment-obligations.js'),A=require('../account-forecast.js');
const C=require('../categorization.js');
const mortgagePfc={primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_MORTGAGE_PAYMENT',confidence_level:'HIGH'};
const cardPfc={primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',confidence_level:'HIGH'};
const dates=['2026-06-02','2026-07-03','2026-08-02','2026-09-02','2026-10-02'];
const rawMortgage=dates.map((date,i)=>({
 id:'bank-mortgage-'+i,accountId:'checking',account:'Checking',date,merchant:'Home Mortgage ACH',
 amount:2590,type:'transfer',category:'Other',
 personal_finance_category:mortgagePfc,source:{provider:'plaid',plaidAmount:2590,personalFinanceCategory:mortgagePfc,verified:true}
}));
const cardPayment={id:'bank-card',accountId:'checking',account:'Checking',date:'2026-10-06',
 merchant:'Visa Credit Card Payment',amount:500,type:'transfer',category:'Other',
 personal_finance_category:cardPfc,source:{provider:'plaid',plaidAmount:500,personalFinanceCategory:cardPfc}};
const state=M.migrate({accounts:[{id:'checking',name:'Checking',type:'depository',subtype:'checking'}],
 transactions:[...rawMortgage,cardPayment,
  {id:'internal',accountId:'checking',account:'Checking',date:'2026-10-07',merchant:'Transfer to Savings',
   amount:200,type:'transfer',category:'Other',cashDirection:'out',
   source:{provider:'plaid',plaidAmount:200,personalFinanceCategory:{primary:'TRANSFER_OUT'}}}]});
const immutable=JSON.stringify(state.transactions),asOf='2026-10-19';
assert.equal(C.loanBill(rawMortgage[0]).isMortgage,true,'Mortgage PFC must be recognized despite transfer import');
assert.equal(C.loanBill(cardPayment).isBill,false,'Credit card payments are never loan bills');
const rows=M.records(state);
assert.equal(rows.filter(x=>x.accountingKind==='loan_payment').length,5,'Historical mortgage source rows are reinterpreted as external installments');
assert.ok(rows.filter(x=>x.accountingKind==='loan_payment').every(x=>x.type==='expense'&&x.category==='Housing'));
assert.equal(M.categoryFor(state,'bank-mortgage-2'),'Housing','Historical transfer category is corrected without rewriting source');
assert.equal(rows.find(x=>x.id==='bank-card').type,'transfer','Card payment is not new spending');
assert.equal(rows.find(x=>x.id==='internal').type,'transfer','Own-account transfer excluded');
assert.equal(F.forecast(rows,'2026-10','Housing',asOf).actual,2590,'Already-posted current mortgage is recorded once');
assert.equal(F.forecast(rows,'2026-10','Housing',asOf).expected.length,0,'Do not forecast an already-posted mortgage again');
const nov=F.forecast(rows,'2026-11','Housing',asOf);
assert.equal(nov.expected.length,1,'One repeated mortgage creates exactly one November forecast');
assert.equal(nov.expected[0].amount,2590);
assert.equal(nov.expected[0].date,'2026-11-02');
const forecast=()=>L.build(state,M.records(state),asOf,90,F,M);
const first=forecast();
const expected=first.events.filter(x=>/mortgage/i.test(x.merchant)&&x.type==='expense');
assert.deepEqual(expected.map(x=>x.date),['2026-11-02','2026-12-02','2027-01-02'],
 'Three future months have exactly one dated mortgage apiece');
assert.ok(expected.every(x=>x.category==='Housing'));
assert.equal(expected.reduce((n,x)=>n+x.amount,0),2590*3);
assert.equal(first.categoryViews['2026-11|Housing'].projectedTotal,2590,
 'Future monthly Budget sees the same mortgage as the cash forecast');
assert.equal(first.categoryViews['2026-10|Housing'].projectedTotal,2590,
 'Current month posted mortgage must not be booked again');
const august=M.recurringRuleKey(state,'expense','Housing','checking','Home Mortgage ACH');
M.setPatternRule(state,august,{mode:'schedule',frequency:'monthly',anchorDate:'2026-08-02',day:2,amount:2590});
const september=M.recurringRuleKey(state,'expense','Other','checking','Home Mortgage ACH');
M.setPatternRule(state,september,{mode:'schedule',frequency:'monthly',anchorDate:'2026-09-02',day:2,amount:2590});
assert.equal(Object.keys(state.predictions.patternRules).length,1,
 'Marking August and September recurring creates one merchant/account rule, not two');
const afterRules=forecast().events.filter(x=>/mortgage/i.test(x.merchant));
assert.deepEqual(afterRules.map(x=>x.date),expected.map(x=>x.date),
 'Repeated recurrence decisions across months do not duplicate the future ledger');
const snapshot={asOf,mode:'demo',accounts:[
 {id:'checking',name:'Checking',accountType:'checking',current:12000,available:11500,simulated:true}
]};
const configured={paymentBills:[{id:'owner-mortgage',name:'Mortgage',fromAccountId:'checking',
 date:'2026-11-01',amount:2590,frequency:'monthly',category:'Housing'}]};
const payment=P.build(snapshot,rows,first.events,configured);
assert.equal(payment.billEvents.length,0,'Bank-derived Home Mortgage ACH reconciles with manually scheduled Mortgage');
assert.equal(payment.suppressedExpectedIds.length,0,'Matching paid amount suppresses manual duplicate without editing bank rows');
const multi=A.build(snapshot,first.events,payment.plans,{days:90,records:rows});
assert.equal(multi.accounts[0].series.find(x=>x.date==='2026-11-02').balance,11500-2590,
 'November checking cash is debited exactly once');
const edited=P.build(snapshot,rows,first.events,{paymentBills:[{...configured.paymentBills[0],amount:2630}]});
assert.equal(edited.billEvents.length,3,'An owner-adjusted mortgage amount has one planned withdrawal per future month');
assert.equal(edited.suppressedExpectedIds.length,3,'Old prediction is suppressed rather than double-counting the edited amount');
assert.ok(edited.warnings.length>=1,'Changing the expected mortgage amount demands review');
const reduced=first.events.filter(x=>!edited.suppressedExpectedIds.includes(x.id));
const revised=A.build(snapshot,[...reduced,...edited.billEvents],[],{days:90,records:rows});
assert.equal(revised.accounts[0].series.find(x=>x.date==='2026-11-01').balance,11500-2630);
assert.equal(revised.accounts[0].series.find(x=>x.date==='2026-11-02').balance,11500-2630,
 'Bank-estimated mortgage is not charged on the following day');
assert.equal(JSON.stringify(state.transactions),immutable,'No bank record changed from all classification, rule, or forecast operations');
// A bank may post November's mortgage on October 30. That cash has already
// left checking and must not be deducted again on the expected November date.
const early=M.migrate({accounts:state.accounts,transactions:[...state.transactions,
 {...rawMortgage[4],id:'nov-paid-early',date:'2026-10-30'}]});
M.setPatternRule(early,august,{mode:'schedule',frequency:'monthly',anchorDate:'2026-07-02',day:2,amount:2590});
const earlyRows=M.records(early),earlyRules=early.predictions.patternRules;
assert.equal(F.forecast(earlyRows,'2026-11','Housing','2026-10-31',earlyRules).expected.length,0,
 'A mortgage already withdrawn just before the new month is not projected twice');
assert.equal(F.forecast(earlyRows,'2026-12','Housing','2026-10-31',earlyRules).expected.length,1,
 'Suppressing the prepaid installment does not erase following months');
console.log('PASS external mortgage LOAN_PAYMENTS classification, historical recovery, 3 monthly predictions, posted suppression, card/transfer exclusions, duplicate recurrence and manual mortgage reconciliation');
