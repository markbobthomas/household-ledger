'use strict';
const assert=require('node:assert/strict');
const Model=require('../ledger-data.js'),C=require('../planner-core.js');
const T=require('../planner-transactions.js'),P=require('../payment-obligations.js');
const accounts=[
 {id:'checking',name:'Main Checking',type:'depository',accountType:'checking',
  current:4000,available:4000,simulated:true},
 {id:'visa',name:'Rewards Visa',type:'credit',accountType:'credit',current:500,simulated:true}
],snapshot={asOf:'2026-10-20',mode:'demo',accounts};
const row=(id,date,merchant,type,amount,accountId='visa')=>
 ({id,date,merchant,type,amount,accountId,pending:false});
const history=[
 row('p1','2026-08-05','Card Membership','expense',30),
 row('p2','2026-09-05','Card Membership','expense',30),
 row('p3','2026-10-05','Card Membership','expense',30),
 row('r1','2026-09-22','Refund','refund',10),
 row('g1','2026-09-24','Groceries','expense',60),
 row('g2','2026-10-19','Gas','expense',20)
],unmodified=JSON.stringify(history);
const materialize=p=>C.materialize(snapshot,history,p,T,P,90);
const unconfigured=materialize({});
assert.equal(unconfigured.payments.plans.length,0,'No credit-card debit before required setup');
assert.equal(unconfigured.ledger.filter(e=>e.accountId==='visa').length,0,
 'No inferred card spending enters forecasts before setup');
assert.ok(unconfigured.payments.warnings.some(w=>w.includes('setup required')));
assert.ok(!P.ready(undefined,accounts[1],accounts));
const choices={billingStartDate:'2026-10-19',billingEndDate:'2026-11-18',
 nextPaymentDate:'2026-12-12',nextDueDate:'2026-12-13',
 fromAccountId:'checking',autopayEnabled:'yes',method:'statement'};
const state=Model.migrate({});
Model.setCardPaymentRule(state,'visa',choices);
assert.ok(P.ready(state.predictions.paymentRules.visa,accounts[1],accounts));
const configured=materialize(state.predictions);
assert.ok(configured.ledger.some(e=>e.accountId==='visa'&&e.merchant==='Card Membership'),
 'Future card purchases are considered only after valid setup');
assert.ok(configured.payments.plans.some(p=>p.fromAccountId==='checking'&&p.toAccountId==='visa'),
 'Card statement payment becomes one linked checking withdrawal');
const past=configured.payments.historyStatements.filter(x=>x.cardId==='visa');
assert.ok(past.some(x=>x.periodStart==='2026-09-19'&&x.periodEnd==='2026-10-18'&&x.netActivity===80),
 'Past billing periods reflect posted card purchases net of refunds');
assert.ok(past.every(x=>x.source.includes('Reconstructed')),
 'Transaction reconstruction never claims to be bank-issued statements');
const first=configured.payments.statements.find(x=>x.cardId==='visa');
assert.equal(first.estimated,true);
assert.ok(first.amount>=20,'Current cycle includes actual card activity');
assert.equal(JSON.stringify(history),unmodified,'Actual bank transactions stay immutable');

const full=Model.migrate({});
Model.setCardPaymentRule(full,'visa',{...choices,method:'full'});
const expected=[{id:'future-subscription',date:'2026-11-05',type:'expense',amount:30,
 merchant:'Card Membership',accountId:'visa'}];
const fullPlan=P.build(snapshot,history,expected,full.predictions,{days:90});
assert.equal(fullPlan.statements[0].amount,530,
 'Pay full outstanding = bank-reported debt plus expected purchases before due date');
assert.equal(fullPlan.plans[0].amount,530);
assert.ok(fullPlan.plans.every(p=>p.fromAccountId==='checking'&&p.toAccountId==='visa'));
assert.ok(!fullPlan.warnings.some(x=>x.includes('setup required')));

const min=Model.migrate({});
Model.setCardPaymentRule(min,'visa',{...choices,method:'minimum',minimumAmount:45});
assert.equal(P.build(snapshot,history,expected,min.predictions,{days:90}).plans[0].amount,45);
const fixed=Model.migrate({});
Model.setCardPaymentRule(fixed,'visa',{...choices,method:'fixed',fixedAmount:75});
assert.equal(P.build(snapshot,history,expected,fixed.predictions,{days:90}).plans[0].amount,75);
const noAuto=Model.migrate({});
Model.setCardPaymentRule(noAuto,'visa',{...choices,method:'statement',
 fromAccountId:'',autopayEnabled:'no'});
const noAutoBill=P.build(snapshot,history,expected,noAuto.predictions,{days:90});
assert.ok(noAutoBill.statements.length>0);
assert.equal(noAutoBill.plans.length,0,
 'Without autopay, never invent a payment from checking');
assert.ok(P.ready(noAuto.predictions.paymentRules.visa,accounts[1],accounts));

assert.throws(()=>Model.setCardPaymentRule(Model.migrate({}),'visa',
 {...choices,method:'debt-mystery'}),/valid billing period/);
assert.throws(()=>Model.setCardPaymentRule(Model.migrate({}),'visa',
 {...choices,method:'minimum',minimumAmount:-1}),/valid autopay amount/);
assert.throws(()=>Model.setCardPaymentRule(Model.migrate({}),'visa',
 {...choices,nextDueDate:'2026-11-02'}),/valid billing period/);
assert.equal(JSON.stringify(history),unmodified,'Forecast never modifies posted card history');
console.log('PASS card setup gate, historical reconstructed periods, statement/full/minimum/fixed/no-autopay, single checking transfer, immutable source history');
