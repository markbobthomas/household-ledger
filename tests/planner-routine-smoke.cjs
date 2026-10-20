'use strict';
const assert=require('node:assert/strict');
const I=require('../planner-intelligence.js');
const A=require('../account-forecast.js'),P=require('../payment-obligations.js'),M=require('../ledger-data.js');
const asOf='2026-10-19',months=['2026-07-02','2026-08-02','2026-09-02','2026-10-02'];
function tx(type,merchant,account,category,amount,date,primary){
 return {id:type+merchant+date,merchant,account,category,amount,date,type,pending:false,
  source:{provider:'plaid',personalFinanceCategory:primary?{primary}:undefined}};
}
const records=months.flatMap((date,i)=>[
 tx('expense','Mortgage','Checking','Housing',2500,date,'LOAN_PAYMENTS'),
 tx('expense','Netflix','Visa','Subscriptions',18,date,'SUBSCRIPTIONS'),
 tx('expense','Costco','Checking','Groceries',120,date,'GENERAL_MERCHANDISE'),
 tx('expense','Electric Utility','Checking','Utilities',[71,84,66,93][i],date,'RENT_AND_UTILITIES'),
 tx('income','Employer Payroll','Checking','Other',3000,date,'INCOME')
]);
const estimate=(merchant,type,account,category,amount,id=merchant)=>({
 id,merchant,type,account,category,amount,date:'2026-11-02',cadence:'monthly',slot:0,source:'historical'});
const predicted=[
 estimate('Mortgage','expense','Checking','Housing',2500),
 estimate('Netflix','expense','Visa','Subscriptions',18),
 estimate('Costco','expense','Checking','Groceries',120),
 estimate('Electric Utility','expense','Checking','Utilities',84),
 estimate('Employer Payroll','income','Checking','Other',3000)
];
const state=M.migrate({});
const first=I.project(state,records,predicted,asOf);
assert.deepEqual(first.events.map(e=>e.merchant),['Mortgage','Netflix','Employer Payroll'],
 'Only repeating fixed bills and stable paychecks; no store or variable utility guesses');
assert.equal(first.review.length,3,'Detect each stable merchant/account once, not each future month');
assert.equal(first.counts.suggested,3);
I.saveDecision(state,first.review.find(x=>x.merchant==='Mortgage'),'confirmed');
const after=I.project(state,records,predicted,asOf);
assert.equal(after.events.find(e=>e.merchant==='Mortgage').planConfidence,'confirmed');
assert.equal(after.review.filter(x=>x.merchant==='Mortgage').length,0,
 'Confirmation carries forward instead of asking every month');
I.saveDecision(state,after.review.find(x=>x.merchant==='Netflix'),'excluded');
const denied=I.project(state,records,predicted,asOf);
assert.equal(denied.events.some(e=>e.merchant==='Netflix'),false,'Explicit rejection removes future card charge');
assert.equal(denied.review.some(e=>e.merchant==='Netflix'),false,'Rejected subscription does not nag again');
assert.equal(denied.events.some(e=>e.merchant==='Employer Payroll'),true);
const futureMonths=['2026-11-02','2026-12-02','2027-01-02'];
const changedHistory=[...records,...futureMonths.map(d=>tx('expense','Mortgage','Checking','Housing',2630,d,'LOAN_PAYMENTS'))];
const reconsider=I.project(state,changedHistory,[{...predicted[0],amount:2630,date:'2027-02-02'}],'2027-01-01');
assert.equal(reconsider.review.length,0,'Future-dated transactions do not count as already posted');
const changed=I.project(state,changedHistory,[{...predicted[0],amount:2630,date:'2027-02-02'}],'2027-01-22');
assert.equal(changed.review.length,1,'Changed stable price reopens confirmation');
assert.equal(changed.review[0].amount,2630);
assert.throws(()=>I.saveDecision(state,{...first.review[0],key:'invalid'},'confirmed'),/Invalid/);
assert.ok(first.suppressed.some(x=>x.merchant==='Costco'&&x.reason==='not a routine bill'));
assert.ok(first.suppressed.some(x=>x.merchant==='Electric Utility'&&x.reason==='amount has changed'));

const incomeHistory=[];
for(const month of ['2026-07','2026-08','2026-09','2026-10']){
 for(const day of ['01','15'])incomeHistory.push(tx('income','Bi-monthly payroll','Checking','Other',1825,month+'-'+day,'INCOME'));
}
const payday=[
 {...estimate('Bi-monthly payroll','income','Checking','Other',1825,'pay1'),
  cadence:'twice monthly',slot:0,date:'2026-11-01'},
 {...estimate('Bi-monthly payroll','income','Checking','Other',1825,'pay2'),
  cadence:'twice monthly',slot:1,date:'2026-11-15'}
];
const twice=I.project(M.migrate({}),incomeHistory,payday,asOf);
assert.equal(twice.events.length,2,'Both first and fifteenth payroll transfers are detected');
assert.equal(twice.review.length,2,'Separate deposits are independently confirmable schedules');

const snapshot={mode:'demo',asOf,accounts:[
 {id:'checking',name:'Checking',accountType:'checking',current:5200,available:5000,simulated:true,transactionAccount:'Checking'},
 {id:'visa',name:'Visa',accountType:'credit',current:1200,available:null,simulated:true,transactionAccount:'Visa'}
]};
const forForecast=first.events.filter(e=>['Mortgage','Netflix'].includes(e.merchant));
const beforeAutopay=A.build(snapshot,forForecast,[],{days:90,records});
const checking=beforeAutopay.accounts.find(a=>a.id==='checking');
const card=beforeAutopay.accounts.find(a=>a.id==='visa');
assert.equal(checking.series.find(d=>d.date==='2026-11-02').balance,2500,'Only mortgage debits checking; Netflix does not');
assert.equal(card.series.find(d=>d.date==='2026-11-02').balance,1218,'Netflix increases Visa liability');
const settings=M.migrate({});
M.setCardPaymentRule(settings,'visa',{fromAccountId:'checking',method:'statement',closingDay:18,
 lastStatementClose:'2026-10-18',nextPaymentDate:'2026-11-11',nextDueDate:'2026-11-12',lastStatementBalance:1200});
const autopay=P.build(snapshot,records,forForecast,settings.predictions,{days:90});
assert.equal(autopay.plans[0].amount,1200,'Next payment uses owner-entered full statement amount');
assert.equal(autopay.plans[0].fromAccountId,'checking');
assert.equal(autopay.plans[0].toAccountId,'visa');
const afterAutopay=A.build(snapshot,forForecast,autopay.plans,{days:90,records});
assert.equal(afterAutopay.accounts.find(a=>a.id==='checking').series.find(d=>d.date==='2026-11-11').balance,1300,
 'One Visa autopay lowers checking after the mortgage, never when card purchased');
assert.equal(afterAutopay.accounts.find(a=>a.id==='visa').series.find(d=>d.date==='2026-11-11').balance,18,
 'Credit card payment reduces debt without a second expense');
assert.equal(afterAutopay.diagnostics.pairedMovements.filter(x=>x.date==='2026-11-11').length,1,
 'Exactly one two-sided card settlement');
assert.equal(afterAutopay.household.conservationDifference,0,'Transfer preserves household net worth');


function projected(merchant,cadence,amount,date,account='Checking'){
 return {id:'test-'+merchant,merchant,type:'expense',account,category:'Housing',
  amount,date,cadence,source:'historical'};
}
function evidenceFor(merchant,dates,amount){
 return dates.map(d=>tx('expense',merchant,'Checking','Housing',amount,d,'LOAN_PAYMENTS'));
}
const quarterlyName='Quarterly home insurance';
const quarterlyHistory=evidenceFor(quarterlyName,['2026-01-15','2026-04-15','2026-07-15'],400);
const quarter=I.project(M.migrate({}),quarterlyHistory,
 [projected(quarterlyName,'quarterly',400,'2026-10-15')],'2026-10-01');
assert.equal(quarter.events.length,1,
 'Three matching payments every three months are a valid quarterly routine');
assert.equal(I.project(M.migrate({}),quarterlyHistory,
 [projected(quarterlyName,'monthly',400,'2026-10-15')],'2026-10-01').events.length,0,
 'Quarterly charges never masquerade as monthly expenses');
const skippedMonths=evidenceFor('Unreliable mortgage',['2026-03-03','2026-05-03','2026-07-03'],2000);
assert.equal(I.project(M.migrate({}),skippedMonths,
 [projected('Unreliable mortgage','monthly',2000,'2026-10-03')],'2026-10-01').events.length,0,
 'A matching payment on alternating months is not a monthly pattern');
const annualName='Annual home insurance';
const annualHistory=evidenceFor(annualName,['2023-11-11','2024-11-11','2025-11-11'],900);
assert.equal(I.project(M.migrate({}),annualHistory,
 [projected(annualName,'annual',900,'2026-11-11')],'2026-10-19').events.length,1,
 'Annual bills remain eligible when their most recent payment is over 90 days old');
const oldHistory=evidenceFor('Old mortgage',['2025-01-02','2025-02-02','2025-03-02'],2500);
assert.equal(I.project(M.migrate({}),oldHistory,
 [projected('Old mortgage','monthly',2500,'2026-11-02')],'2026-10-19').events.length,0,
 'A lapsed mortgage-like debit is not forecast indefinitely');
assert.equal(I.project(M.migrate({}),records,
 [projected('Mortgage','monthly',2500,'2026-11-18')],asOf).events.length,0,
 'A forecast on a different calendar day cannot borrow another schedule\'s evidence');
const offsetHistory=evidenceFor('Twice in one month',['2026-08-02','2026-08-16','2026-09-02'],800);
assert.equal(I.project(M.migrate({}),offsetHistory,
 [projected('Twice in one month','monthly',800,'2026-11-02')],asOf).events.length,0,
 'Three payments are insufficient when they span only two calendar months');

console.log('PASS fixed recurring commitments only; account/merchant confirm once; changed amounts prompt again; excluded subscriptions; bi-monthly payroll; card purchases do not debit checking; full-statement autopay debits once');