'use strict';
// Regression replacement for the retired inference / backtest laboratories.
// All data are fictional and all assertions execute the active canonical engine.
const assert=require('node:assert/strict');
const Core=require('../planner-core.js');
const Transactions=require('../planner-transactions.js');
const Payments=require('../payment-obligations.js');
const accounts=[
 {id:'checking',name:'Fictional Checking',accountType:'checking',current:9000,available:9000,simulated:true},
 {id:'savings',name:'Fictional Savings',accountType:'savings',current:1200,available:1200,simulated:true},
 {id:'visa',name:'Fictional Visa',accountType:'credit',current:300,simulated:true}
];
const snapshot={asOf:'2026-10-20',mode:'demo',accounts};
const tx=(id,date,merchant,amount,type='expense',accountId='checking',extra={})=>
 ({id,date,merchant,amount,type,accountId,pending:false,...extra});
const history=[
 tx('mortgage-one','2026-09-15','Home Mortgage ACH',2000,'transfer','checking',{cashDirection:'out'}),
 tx('insurance-aug','2026-08-08','Home Insurance',175),
 tx('insurance-sep','2026-09-09','Home Insurance',175),
 tx('grocery-aug','2026-08-08','Safeway',175),
 tx('grocery-sep','2026-09-09','Safeway',175),
 tx('wages-aug','2026-08-05','Employer Payroll',3100,'income'),
 tx('wages-sep','2026-09-05','Employer Payroll',3100,'income'),
 tx('subscription-aug','2026-08-13','Netflix',18,'expense','visa'),
 tx('subscription-sep','2026-09-13','Netflix',18,'expense','visa'),
 tx('paired-transfer','2026-10-04','Transfer to Savings',150,'transfer','checking',
  {cashDirection:'out',pairedTransactionId:'paired-other'}),
 tx('pending','2026-10-15','Pending Bill',200,'expense','checking',{pending:true})
];
const immutable=JSON.stringify(history);
const bundle=Core.materialize(snapshot,history,{},Transactions,Payments,90);
const events=name=>bundle.ledger.filter(e=>e.merchant===name);
assert.deepEqual(events('Home Mortgage ACH').map(e=>e.date),
 ['2026-11-15','2026-12-15','2027-01-15'],
 'One recent mortgage installment yields one payment per subsequent due month');
assert.ok(events('Home Mortgage ACH').every(e=>e.amount===2000&&e.accountId==='checking'));
assert.equal(events('Home Insurance').length,3,
 'Two stable insurance payments support a fixed monthly schedule');
assert.equal(events('Safeway').length,0,
 'Repeated ordinary shopping must not silently become a bill');
assert.equal(events('Transfer to Savings').length,0,
 'Paired household transfers cannot create a second expense');
assert.equal(events('Pending Bill').length,0,'Pending facts cannot prove recurring obligations');
assert.equal(events('Netflix').every(e=>e.accountId==='visa'),true,
 'Recurring card purchases stay attached to their card');
assert.ok(bundle.historyCandidates.some(e=>e.merchant==='Safeway'),
 'Uncertain shopping recurrence remains a review candidate');
const optOut={predictions:{}};
Transactions.setHistoryAutoPrediction(optOut,{
 accountId:'checking',type:'expense',merchant:'Home Insurance'},false);
const excluded=Core.materialize(snapshot,history,optOut.predictions,Transactions,Payments,90);
assert.equal(excluded.ledger.filter(e=>e.merchant==='Home Insurance').length,0,
 'An explicit recurring opt-out suppresses estimated future debits');
assert.equal(JSON.stringify(history),immutable,
 'Forecast construction and exclusions never rewrite posted bank records');

// Walk-forward history uses the live backtest implementation. Card transfers,
// card purchases and ordinary shopping are not counted as checking expenses.
const past=[];
for(let m=1;m<=12;m++){
 const mon='2025-'+String(m).padStart(2,'0');
 past.push(tx('mort-'+m,mon+'-02','Home Mortgage ACH',2000),
  tx('wage-'+m,mon+'-15','Employer Payroll',3000,'income'),
  tx('shop-'+m,mon+'-12','Safeway',90),
  tx('card-payment-'+m,mon+'-13','Visa Credit Card Payment',400,'transfer'),
  tx('card-purchase-'+m,mon+'-14','Netflix',18,'expense','visa'));
}
const asOf='2026-01-15';
const baseline=Core.backtest(past,accounts,asOf,'checking',6);
assert.equal(baseline.status,'evaluated');
assert.deepEqual(baseline.periods,
 ['2025-07','2025-08','2025-09','2025-10','2025-11','2025-12']);
assert.ok(baseline.totals.matched>0,
 'Recent completed mortgage and wage history must produce matched predictions');
assert.equal(baseline.totals.duplicates,0);
assert.ok(baseline.cardSettlements>0,
 'Card settlement is tracked separately from recurring spending');
assert.ok(baseline.totals.eligible<=24,
 'Groceries, card purchases and transfers must not inflate eligible checking bills');
const changed=past.map(row=>row.id==='mort-10'?{...row,amount:2200}:row);
const changedAudit=Core.backtest(changed,accounts,asOf,'checking',6);
assert.ok(changedAudit.issues.some(i=>i.kind==='amount changed'&&i.date==='2025-10-02'),
 'A changed mortgage payment must be recognized without rewriting bank facts');
const missing=past.filter(row=>row.id!=='mort-11');
const missingAudit=Core.backtest(missing,accounts,asOf,'checking',6);
assert.ok(missingAudit.issues.some(i=>i.kind==='unmatched forecast'&&i.merchant==='Home Mortgage ACH'),
 'A missing scheduled mortgage must be exposed by canonical backtesting');
assert.equal(JSON.stringify(past.find(r=>r.id==='mort-10')),
 JSON.stringify(tx('mort-10','2025-10-02','Home Mortgage ACH',2000)),
 'Historical test evidence is never modified by scoring');
console.log('PASS canonical inference/backtest: mortgage, insurance, payroll, card, transfer, opt-out, missed and changed payments, source immutability');
