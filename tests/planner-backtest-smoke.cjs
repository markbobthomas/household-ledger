'use strict';
const assert=require('node:assert/strict');
const M=require('../ledger-data.js'),F=require('../forecast.js');
const L=require('../forecast-ledger.js'),I=require('../planner-intelligence.js');
const B=require('../planner-backtest.js');
const accounts=[{id:'checking',name:'Checking',type:'depository',subtype:'checking'},
 {id:'visa',name:'Visa',type:'credit',subtype:'credit card'}];
const bank=(month,day,name,type,amount,category,accountId='checking')=>({
 id:accountId+'-'+month+'-'+name,accountId,account:accountId==='checking'?'Checking':'Visa',
 date:month+'-'+String(day).padStart(2,'0'),merchant:name,type,amount,category,pending:false,
 source:{provider:'plaid',verified:true,personalFinanceCategory:category==='Housing'?
  {primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_MORTGAGE_PAYMENT'}:undefined}
});
function fixture(){
 const rows=[];
 for(let m=1;m<=9;m++){
  const month='2026-'+String(m).padStart(2,'0');
  rows.push(bank(month,2,'Home Mortgage ACH','expense',2500,'Housing'),
   bank(month,15,'Employer Payroll','income',3000,'Other'),
   bank(month,10,'Netflix','expense',18,'Subscriptions'),
   bank(month,12,'Costco','expense',90,'Groceries'),
   bank(month,13,'Visa Credit Card Payment','transfer',200+m*25,'Other'),
   bank(month,14,'Netflix','expense',18,'Subscriptions','visa'));
 }
 return rows;
}
const engine={model:M,forecast:F,ledger:L,planner:I};
const input=rows=>M.migrate({accounts,transactions:rows});
const evaluate=rows=>B.build(input(rows),'2026-10-19','checking',engine,{months:6,accounts});
const baseline=evaluate(fixture());
assert.equal(baseline.status,'evaluated');
assert.deepEqual(baseline.periods,['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09']);
assert.equal(baseline.totals.matched,18,'3 stable checking events across 6 completed months');
assert.equal(baseline.totals.eligible,18,'Groceries, card purchases and settlements excluded');
assert.equal(baseline.totals.extra,0);
assert.equal(baseline.totals.missed,0);
assert.equal(baseline.matchRate,100);
assert.equal(baseline.coverageRate,100);
assert.equal(baseline.cardSettlements,6,'Historical card transfers counted but not scored as statements');
const revised=fixture();
revised.find(t=>t.id==='checking-2026-06-Home Mortgage ACH').amount=2680;
const changed=evaluate(revised);
assert.ok(changed.issues.some(x=>x.kind==='amount changed'&&x.date==='2026-06-02'&&
 x.expected===2500&&x.actual===2680),'Changed mortgage amount flagged without altering posted bank source');
assert.equal(changed.issues.some(x=>x.kind==='missed'&&x.date==='2026-06-02'),false,
 'One amount change does not become an unrelated missing payment');
const omitted=evaluate(fixture().filter(t=>t.id!=='checking-2026-06-Home Mortgage ACH'));
assert.ok(omitted.issues.some(x=>x.kind==='unmatched forecast'&&x.merchant==='Home Mortgage ACH'&&
 x.date==='2026-06-02'),'An expected mortgage missing from held-out history is identified');
const state=input(fixture());
state.predictions.patternRules={'expense|Housing|checking|home mortgage ach':
 {mode:'none'}};
state.predictions.plannerRoutineDecisions={'expense|checking|home mortgage ach':
 {status:'excluded',amount:2500,frequency:'monthly'}};
const noLeak=B.build(state,'2026-10-19','checking',engine,{months:6,accounts});
assert.deepEqual(noLeak.totals,baseline.totals,
 'Current manual decisions must NOT be applied retroactively to backtests');
const noCompleteMonth=B.build(state,'2026-09-15','checking',engine,{months:6,accounts});
assert.equal(noCompleteMonth.periods.includes('2026-09'),false,
 'Open current months cannot be scored as if all bills posted');
const onlyTwo=fixture().filter(t=>t.date<'2026-03-01');
assert.equal(evaluate(onlyTwo).status,'insufficient-history');
const resolve=B.accountResolver(accounts);
const predicted=[{id:'a',accountId:'checking',merchant:'Home Mortgage ACH',type:'expense',
 date:'2026-08-02',amount:2500},
 {id:'b',accountId:'checking',merchant:'Home Mortgage ACH',type:'expense',
 date:'2026-08-02',amount:2500}];
const actual=[bank('2026-08',2,'Home Mortgage ACH','expense',2500,'Housing')];
const past=['2026-05','2026-06','2026-07'].map(m=>bank(m,2,'Home Mortgage ACH','expense',2500,'Housing'));
const duplicated=B.compare(predicted,actual,past,resolve,I,'2026-08');
assert.equal(duplicated.matched,1);
assert.equal(duplicated.duplicates,1,'Second predicted debit is flagged, not counted as a second payment');
const noCardDebit=B.compare([{
 id:'c',accountId:'visa',merchant:'Netflix',type:'expense',date:'2026-08-14',amount:18
}],actual,past,resolve,I,'2026-08');
assert.equal(noCardDebit.matched,0,'Credit-card expenses are not matching-account checking payments');
console.log('PASS 6 walk-forward months, 18/18 exact recurring payments, mortgage amount change/miss, duplicates, card-settlement exclusion, account isolation, open-month and decision lookahead protection');
