'use strict';
const assert=require('node:assert/strict');
const {financialContext}=require('../pilot/ai-financial-report.cjs');
const {createComparison,historicalStreams}=require('../pilot/ai-independent-forecast.cjs');
const asOf='2026-11-19',day=n=>{
 const d=new Date(asOf+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);
 return d.toISOString().slice(0,10);
};
const checking='fictional-checking-id-private',card='fictional-credit-id-private';
const income=Array.from({length:6},(_,i)=>({
 accountId:checking,date:day(-84+14*i),type:'income',
 amount:i%2?3100:2500,merchant:'Fictional Employer',
 id:'secret-payroll-'+i,pending:false,token:'never-share'
}));
const stable=Array.from({length:5},(_,i)=>({
 accountId:checking,date:day(-112+28*i),type:'expense',amount:210,
 merchant:'Fictional Insurance',category:'Insurance',pending:false
}));
const grocery=Array.from({length:5},(_,i)=>({
 accountId:checking,date:day(-35+7*i),type:'expense',amount:100,
 merchant:'Fictional Grocer',category:'Groceries',pending:false
}));
const historical=[...income,...stable,...grocery,
 {accountId:checking,date:day(-7),type:'transfer',amount:6800,
  merchant:'Internal household transfer',cashDirection:'in',pairedTransactionId:'linked-personal-savings',pending:false},
 ...Array.from({length:4},(_,i)=>({accountId:checking,
  date:day(-84+28*i),type:'transfer',cashDirection:'in',amount:600,
  merchant:'Possible payroll ACH',pending:false})),
 {accountId:card,date:day(-14),type:'expense',amount:3500,
  merchant:'Credit card purchase',pending:false},
 {accountId:checking,date:day(-14),type:'income',amount:8800,
  merchant:'One time refund',pending:false},
 {accountId:checking,date:day(-1),type:'income',amount:4100,
  merchant:'Fictional Employer',pending:true}];
const scheduled=[14,28,56,70,84].map(n=>({
 accountId:checking,date:day(n+(n===14?-2:0)),
 kind:'income',amount:n===56?4100:n%28===0?3100:2500,
 merchant:'Fictional Employer',recurringRuleId:'never-share-schedule-id'
})); 
scheduled.push({accountId:checking,date:day(21),kind:'income',
 amount:7777,merchant:'Confirmed new salary',recurringRuleId:'private-flag'});
scheduled.push({accountId:checking,date:day(25),kind:'transfer_out',
 amount:890,merchant:'Card autopay',transferGroupId:'never-share-transfer'});
const prepared={bundle:{
 projection:{asOf,days:1095,accounts:[
 {id:checking,valid:true,type:'cash',openingCurrent:9000,openingAvailable:8990,balanceStatus:'fresh',
  source:{accountType:'checking'},series:Array.from({length:92},(_,i)=>({
   date:day(i),balance:8990+i*4,income:0,outflow:0}))},
 {id:card,valid:true,type:'credit',openingCurrent:2500,balanceStatus:'fresh',
  source:{accountType:'credit'},series:[]}],
  series:[],events:scheduled,household:{conservationDifference:0},diagnostics:{balanceMismatches:[]}},
 rows:historical,ledger:[],payments:{statements:[]},paymentReconciliations:[],
 overduePayments:[],duplicateChecks:[],postedMatchReview:[]}};
const context=financialContext(prepared,{lastSync:asOf});
const independ=historicalStreams(context);
const incomes=independ.streams.filter(s=>s.kind==='income');
const outflows=independ.streams.filter(s=>s.kind==='expense');
assert.equal(incomes.length,2,'bank-classified income and unpaired ACH credits are separate streams');
assert(incomes.some(s=>s.classification==='unconfirmed-unpaired-incoming-transfer'),
 'unpaired incoming transfer should be examined as POSSIBLE payroll, not silently omitted');
const payroll=incomes.find(s=>s.merchant.includes('Employer'));
assert.equal(payroll.alternating,true);
assert.deepEqual(payroll.amountPattern,[2500,3100]);
assert.equal(outflows.length,1,'stable checking insurance is a distinct recurring outflow');
assert.equal(independ.streams.some(x=>/Grocer/.test(x.merchant)),false,
 'everyday grocery purchases must not become recurring forecast obligations');
assert.equal(independ.streams.some(x=>/transfer|card purchase/i.test(x.merchant)),false,
 'transfers and credit-card purchases are not earned income/primary checking outflows');
const c=createComparison(context);
assert.equal(c.horizon,90);
assert.equal(c.totals.incomeInferredOccurrences,9);
assert.equal(c.totals.unconfirmedIncomeStreams,1);
assert.equal(c.totals.matchedIncome,5);
assert.equal(c.totals.uncoveredIncome,4,'one absent paycheck plus three provisional ACH credits are flagged');
assert.equal(c.totals.differingAmounts,1,'different Ledger pay amount is separate from no income');
assert.equal(c.totals.ledgerOnlyIncome,1,'Ledger-only confirmed income must be considered possibly correct');
assert(c.matched.some(x=>x.shiftDays===2),'weekday/payday shift is not falsely missing income');
assert(c.differences.some(x=>x.kind==='ledger-only-income'&&/may be correct/.test(x.reason)),
 'explain why Ledger can be right without matching historical evidence');
assert.equal(c.modelStatus,'limited-historical-recurrence');
assert.equal(c.dataPoints.length>30,true);
assert.equal(typeof c.dataPoints[0].value,'number');
assert.equal(typeof c.dataPoints[0].alternateValue,'number');
assert.equal(c.facts.some(x=>x.text.includes('Credit card purchases')),true);
assert(!JSON.stringify(c).includes(checking),'no original account ID in output');
assert(!JSON.stringify(c).includes('secret-payroll'),'no raw source transaction ID in output');
assert(!JSON.stringify(c).includes('never-share-schedule'),'no recurring rule key in output');
const noIncome=financialContext({...prepared,bundle:{...prepared.bundle,
 rows:historical.filter(r=>r.type!=='income')}});
const c2=createComparison(noIncome);
assert.equal(c2.modelStatus,'insufficient-independent-income-evidence');
assert.equal(c2.totals.uncoveredIncome,0,'insufficient sample cannot fabricate missing income');
console.log('Independent forecast comparison: alternating income, missing pay, saved Ledger income, weekday shift, cards and privacy passed');
