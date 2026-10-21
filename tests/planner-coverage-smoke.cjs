'use strict';
const assert=require('node:assert/strict');
global.document={addEventListener(){}};
const C=require('../planner-coverage.js');
const date='2026-10-21',accounts=[
 {id:'checking',name:'Checking',type:'depository'},
 {id:'other',name:'Savings',type:'depository'},
 {id:'visa',name:'Household Visa',mask:'4321',type:'credit'}
];
const day=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const historic=[];
for(const m of ['2026-07','2026-08','2026-09','2026-10'])
 historic.push({date:m+'-02',type:'expense',amount:2590,merchant:'Home Mortgage ACH',accountId:'checking'});
for(const d of ['2026-08-07','2026-08-21','2026-09-04','2026-09-18','2026-10-02','2026-10-16'])
 historic.push({date:d,type:'income',amount:3100,merchant:'ACME Employer',accountId:'checking'});
for(const m of ['2026-07','2026-08','2026-09'])
 historic.push({date:m+'-09',type:'expense',amount:650,merchant:'Auto Insurance',accountId:'checking'});
const ledger=[
 {kind:'event',type:'expense',date:'2026-11-02',merchant:'Home Mortgage ACH',accountId:'checking',amount:2590},
 {kind:'event',type:'expense',date:'2026-12-02',merchant:'Home Mortgage ACH',accountId:'checking',amount:2590},
 {kind:'event',type:'income',date:'2026-10-30',merchant:'ACME Employer',accountId:'checking',amount:3100},
 {kind:'event',type:'income',date:'2026-11-13',merchant:'ACME Employer',accountId:'checking',amount:3100},
 {kind:'event',type:'income',date:'2026-11-27',merchant:'ACME Employer',accountId:'checking',amount:3200},
 {kind:'event',type:'income',date:'2026-12-11',merchant:'ACME Employer',accountId:'checking',amount:3100},
 {kind:'movement',date:'2026-11-05',fromAccountId:'checking',toAccountId:'visa',
  amount:900,merchant:'Household Visa autopay',origin:'card-autopay'},
 {kind:'movement',date:'2026-12-05',fromAccountId:'checking',toAccountId:'visa',
  amount:800,merchant:'Household Visa autopay',origin:'card-autopay'},
 {kind:'event',type:'expense',date:'2026-11-09',merchant:'Auto Insurance',accountId:'checking',amount:650},
 {kind:'event',type:'expense',date:'2026-12-09',merchant:'Auto Insurance',accountId:'checking',amount:650}
];
const rule={billingStartDate:'2026-09-01',billingEndDate:'2026-09-30',
 nextPaymentDate:'2026-11-05',nextDueDate:'2026-11-05',method:'statement',
 fromAccountId:'checking',autopayEnabled:true};
const opts={snapshot:{asOf:date},chosen:accounts[0],accounts,days:60,
 prefs:{paymentRules:{visa:rule}},ready:()=>true,bundle:{
 ledger,rows:historic,payments:{statements:[]}
}};
const get=(result,id,key)=>result.rows.find(r=>r.id===id).cells.find(c=>c.month===key);
const normal=C.analyze(opts);
assert.equal(normal.months.length,3,'60 days spans partial October, all November, part of December');
assert.deepEqual(normal.months.map(m=>m.full),[false,true,false]);
for(const month of ['2026-11','2026-12']){
 for(const row of ['mortgage','income','card|visa','other-bills'])
  assert.equal(get(normal,row,month).status,'covered',row+' must be predicted in '+month);
}
assert.equal(get(normal,'mortgage','2026-10').status,'na',
 'A payment due October 2 is not missing from an October 22 onward forecast');
assert.equal(get(normal,'card|visa','2026-10').status,'na');
assert.equal(get(normal,'income','2026-10').status,'covered',
 'Existing biweekly payroll correctly projects one upcoming October paycheck');
assert.ok(C.render(normal).includes('Household Visa ••4321'));
assert.match(C.render(normal),/Major payments/);
const withoutCard=C.analyze({...opts,bundle:{...opts.bundle,
 ledger:ledger.filter(x=>x.date!=='2026-12-05')}});
assert.equal(get(withoutCard,'card|visa','2026-11').status,'covered');
assert.equal(get(withoutCard,'card|visa','2026-12').status,'missing',
 'A valid statement preview is not enough if the future debit is missing');
const withoutMortgage=C.analyze({...opts,bundle:{...opts.bundle,
 ledger:ledger.filter(x=>!(x.type==='expense'&&x.date==='2026-12-02'))}});
assert.equal(get(withoutMortgage,'mortgage','2026-12').status,'missing',
 'When historical mortgage recurs monthly, one skipped future month must be exposed');
const withoutIncome=C.analyze({...opts,bundle:{...opts.bundle,
 ledger:ledger.filter(x=>x.date!=='2026-11-27')}});
assert.equal(get(withoutIncome,'income','2026-11').status,'missing',
 'A second biweekly paycheck missing in a month must not be passed by one paycheck');
const withoutInsurance=C.analyze({...opts,bundle:{...opts.bundle,
 ledger:ledger.filter(x=>x.date!=='2026-11-09')}});
assert.equal(get(withoutInsurance,'other-bills','2026-11').status,'missing',
 'Known non-mortgage major repeating bills are checked as well');
const duplicateMortgage=C.analyze({...opts,bundle:{...opts.bundle,
 ledger:ledger.concat([{kind:'event',type:'expense',date:'2026-11-03',
 merchant:'Home Mortgage ACH',accountId:'checking',amount:2590}])}});
assert.equal(get(duplicateMortgage,'mortgage','2026-11').status,'review',
 'Duplicate mortgage predicted in one month should be flagged');
const notConfigured=C.analyze({...opts,prefs:{paymentRules:{}},ready:()=>false});
assert.equal(get(notConfigured,'card|visa','2026-11').status,'setup');
const autopayOff=C.analyze({...opts,prefs:{paymentRules:{visa:{...rule,autopayEnabled:false}}},
 bundle:{...opts.bundle,ledger:ledger.filter(x=>x.toAccountId!=='visa')},
 ready:()=>true});
assert.equal(get(autopayOff,'card|visa','2026-11').status,'setup',
 'Autopay off with no future manual movement cannot be counted as a checking debit');
const manualPlan=C.analyze({...opts,prefs:{paymentRules:{visa:{...rule,autopayEnabled:false}}},
 ready:()=>true});
assert.equal(get(manualPlan,'card|visa','2026-11').status,'covered',
 'A real manually entered linked card withdrawal still counts as a projected payment');
assert.match(C.render(manualPlan),/Household Visa/);
assert.equal(get(normal,'card|visa','2026-11').items[0].merchant,'Household Visa autopay',
 'Card receipt detail identifies the exact payment source, not a generic Payment label');
const otherSource=C.analyze({...opts,prefs:{paymentRules:{visa:{...rule,fromAccountId:'other'}}},
 bundle:{...opts.bundle,ledger:ledger.map(x=>x.toAccountId==='visa'?{...x,fromAccountId:'other'}:x)}});
assert.equal(get(otherSource,'card|visa','2026-11').status,'external',
 'Payment from savings is real but not included in selected checking curve');
const paidAlready=C.analyze({...opts,bundle:{...opts.bundle,
 ledger:ledger.filter(x=>x.date!=='2026-11-05'),
 payments:{statements:[{cardId:'visa',withdrawalDate:'2026-11-05',alreadyPaid:true,
  actualPaymentAmount:900,actualPaymentDate:'2026-10-20'}]}}});
assert.equal(get(paidAlready,'card|visa','2026-11').status,'posted',
 'Do not schedule a duplicate withdrawal for a reconciled posted card payment');
const unknownMortgage=C.analyze({...opts,bundle:{...opts.bundle,rows:historic.filter(r=>!r.merchant.includes('Mortgage')),
 ledger:ledger.filter(r=>!r.merchant.includes('Mortgage'))}});
assert.equal(get(unknownMortgage,'mortgage','2026-11').status,'unknown',
 'No evidence must not turn an unknown mortgage into a confident check mark');
for(const n of [30,60,90,120,180,360]){
 const m=C.months(date,n);
 assert.ok(m.length>=1&&m.length<=13);
 assert.equal(m[0].start,'2026-10-22');
 assert.equal(m.at(-1).end,day(date,n));
}
assert.equal(JSON.stringify(opts.bundle.ledger),JSON.stringify(ledger),
 'Coverage audit never mutates bank facts or future ledger');
console.log('PASS month-by-month income, mortgage, credit card and major bill forecast coverage: missing, duplicated, paid, unconfigured, partial and external-account cases');
