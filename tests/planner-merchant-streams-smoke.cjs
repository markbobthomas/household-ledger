'use strict';
const assert=require('node:assert/strict');
const T=require('../planner-transactions.js'),C=require('../planner-core.js'),
 H=require('../planner-history.js'),P=require('../payment-obligations.js');
const accounts=[
 {id:'checking',name:'Checking',type:'depository',accountType:'checking',
  current:6500,available:6500,simulated:true},
 {id:'savings',name:'Savings',type:'depository',accountType:'savings',
  current:1000,available:1000,simulated:true}
],asOf='2026-10-20',snapshot={asOf,mode:'demo',accounts};
const row=(id,date,merchant,amount,type='expense',accountId='checking',extra={})=>
 ({id,date,merchant,amount,type,accountId,pending:false,...extra});
const electric=[
 row('e1','2026-08-12','PSE ELECTRIC BILL',101.10),
 row('e2','2026-09-12','PSE ELECTRIC BILL',220.13),
 row('e3','2026-10-12','PSE ELECTRIC BILL',139.27)
],salary=[
 row('w1','2026-08-05','ACME PAYROLL DEPOSIT',2990.10,'income'),
 row('w2','2026-09-05','ACME PAYROLL DEPOSIT',3111.40,'income'),
 row('w3','2026-10-05','ACME PAYROLL DEPOSIT',3050.55,'income')
],other=[
 row('o0','2026-08-12','PSE ELECTRIC BILL',155,'expense','savings'),
 row('o1','2026-09-12','PSE ELECTRIC BILL',160,'expense','savings'),
 row('o2','2026-10-12','PSE ELECTRIC BILL',170,'expense','savings')];
const history=[...electric,...salary,...other],historyBefore=JSON.stringify(history);
const forecast=p=>C.materialize(snapshot,history,p,T,P,90);
const automatic=forecast({});
const electricAuto=automatic.ledger.filter(e=>e.merchant==='PSE ELECTRIC BILL'&&e.accountId==='checking');
assert.deepEqual(electricAuto.map(e=>e.date),['2026-11-12','2026-12-12','2027-01-12']);
assert.ok(electricAuto.every(e=>e.amount===153.5),
 'One rolling 3-payment estimate is used, not one separate recurring bill for each amount');
assert.deepEqual(automatic.ledger.filter(e=>e.merchant==='ACME PAYROLL DEPOSIT').map(e=>e.date),
 ['2026-11-05','2026-12-05','2027-01-05']);
assert.equal(T.findExamples(history,{kind:'event',accountId:'checking',
 merchant:'PSE ELECTRIC BILL',type:'expense'},accounts).length,3,
 'Utility statements link with different dollar values');
const paycheckMatches=T.findExamples(history,{kind:'event',accountId:'checking',
 merchant:'ACME PAYROLL DEPOSIT',type:'income'},accounts);
assert.deepEqual(paycheckMatches.map(x=>x.id),['w3','w2','w1'],
 'Different NET paycheck amounts still attach to the same income stream');
assert.equal(H.draftFor(salary[1],history,accounts,asOf).examples.length,3,
 'History-to-recurring connects payroll across changed deductions');
assert.equal(H.draftFor(electric[1],history,accounts,asOf).examples.length,3,
 'History-to-recurring connects utility months with changed rates');
const p={predictions:{}};
const utility=T.defineRecurring(p,{date:'2026-11-18',merchant:'Monthly Electricity',
 amount:155,type:'expense',accountId:'checking',frequency:'monthly'},
 accounts,asOf,null,history,['e1','e2','e3']);
assert.ok(utility.matchNames.includes('pse electric bill'));
assert.equal(utility.exampleIds.length,3);
const owned=forecast(p.predictions),utilityRows=owned.ledger.filter(e=>
 e.accountId==='checking'&&e.type==='expense'&&
 (e.merchant==='Monthly Electricity'||e.merchant==='PSE ELECTRIC BILL'));
assert.deepEqual(utilityRows.map(e=>e.date),['2026-11-18','2026-12-18','2027-01-18'],
 'Owner utility rule replaces auto estimates even with different name, date and price');
assert.deepEqual(utilityRows.map(e=>e.amount),[155,155,155]);
assert.equal(owned.ledger.filter(e=>e.accountId==='savings'&&e.merchant==='PSE ELECTRIC BILL').length>0,true,
 'Same merchant at a different account remains independent');
const second=T.defineRecurring(p,{date:'2026-11-20',merchant:'PSE ELECTRIC BILL',
 amount:185,type:'expense',accountId:'checking',frequency:'monthly'},
 accounts,asOf,electric[2],history,['e3']);
assert.equal(second.id,utility.id,'Confirming another historical dollar amount updates the same stream');
assert.equal(p.predictions.futureRecurringRules.length,1);
assert.equal(forecast(p.predictions).ledger.filter(e=>
 e.accountId==='checking'&&e.type==='expense'&&
 /PSE ELECTRIC BILL|Monthly Electricity/.test(e.merchant)).length,3,
 'Updating a utility estimate never results in two bill schedules');
const pay=T.defineRecurring(p,{date:'2026-11-06',merchant:'Salary',
 amount:3100,type:'income',accountId:'checking',frequency:'monthly'},
 accounts,asOf,null,history,['w1','w2','w3']);
assert.equal(pay.exampleIds.length,3);
assert.ok(pay.matchNames.includes('acme payroll deposit'));
const payEntries=forecast(p.predictions).ledger.filter(e=>
 e.accountId==='checking'&&e.type==='income'&&
 (e.merchant==='Salary'||e.merchant==='ACME PAYROLL DEPOSIT'));
assert.equal(payEntries.length,3,'Confirmed paycheck and auto-detected paycheck merge into one income stream');
assert.deepEqual(payEntries.map(e=>e.amount),[3100,3100,3100]);
const changed=[...history,row('e4','2026-11-03','PSE ELECTRIC BILL',237.69)];
const decAsOf='2026-11-10',decSnapshot={...snapshot,asOf:decAsOf};
const refreshed=C.materialize(decSnapshot,changed,p.predictions,T,P,90);
assert.equal(refreshed.ledger.filter(e=>e.merchant==='PSE ELECTRIC BILL'&&
 e.accountId==='checking'&&e.date==='2026-11-18').length,0);
assert.equal(refreshed.ledger.filter(e=>e.accountId==='checking'&&
 e.date==='2026-11-20'&&e.type==='expense').length,0,
 'Posted November bill with a changed amount replaces the future November prediction');
assert.ok(refreshed.ledger.some(e=>e.merchant==='PSE ELECTRIC BILL'&&
 e.date==='2026-12-20'),'December utility still predicted after November posting');
assert.equal(JSON.stringify(history),historyBefore,'Bank facts remain unmodified');
const aliasHistory=[
 row('a1','2026-09-02','UTILITY AUTOMATED EFT',112),
 row('a2','2026-10-02','CITY ELECTRIC PAY',129)
],aliases={predictions:{}};
const alias=T.defineRecurring(aliases,{date:'2026-11-15',merchant:'Electricity',
 amount:150,type:'expense',accountId:'checking',frequency:'monthly'},
 accounts,asOf,null,aliasHistory,['a1','a2']);
assert.ok(alias.matchNames.includes('utility automated eft'));
assert.ok(alias.matchNames.includes('city electric pay'));
assert.equal(T.findExamples(aliasHistory,{kind:'event',accountId:'checking',
 merchant:'Electricity',type:'expense'},accounts,'utility').length,1,
 'History search can find alternate payee names for explicit linking');
const sourceDifferent=[row('ach-pay1','2026-09-04','PAYROLL EFT',
 2900,'transfer','checking',{cashDirection:'in'}),
 row('ach-pay2','2026-10-04','PAYROLL EFT',
 3150,'transfer','checking',{cashDirection:'in'})];
const draft=H.draftFor(sourceDifferent[1],sourceDifferent,accounts,asOf);
assert.equal(draft.type,'income','Unpaired Plaid ACH deposits can be confirmed as income');
assert.deepEqual(draft.examples,['ach-pay1','ach-pay2']);
const transferIncome={predictions:{}};
T.defineRecurring(transferIncome,{date:'2026-11-04',merchant:'Paycheck',
 amount:3050,type:'income',accountId:'checking',frequency:'monthly'},
 accounts,asOf,{kind:'event',accountId:'checking',type:'transfer',
 originalType:'transfer',merchant:'PAYROLL EFT',date:'2026-10-04'},
 sourceDifferent,['ach-pay1','ach-pay2']);
const linked=C.materialize(snapshot,sourceDifferent,transferIncome.predictions,T,P,90);
assert.equal(linked.ledger.filter(e=>e.type==='income'&&e.accountId==='checking').length,3,
 'Incoming ACH deposit with variable amount produces only one confirmed paycheck series');
assert.equal(linked.ledger.some(e=>e.merchant==='PAYROLL EFT'),false);
const sanity=linked.projection.household.conservationDifference;
assert.equal(sanity,0,'Projected balance reconciles after payroll corrections');
console.log('PASS variable utility and income identity; 3-history averaging, owner precedence, bank alias matching, monthly paid-once logic and Plaid transfer income');
