'use strict';
const assert=require('node:assert/strict');
const {inspect,keyContains}=require('../pilot/account-forecast-links.cjs');
const ids=['account-100','account-200','account-300'];
const esc=encodeURIComponent;
const state={
 accounts:ids.map(id=>({id,name:'Same checking',mask:'1234',type:'depository'})),
 transactions:{
  'original-bank-1':{accountId:'account-100'},
  'bank-2':{accountId:'account-200'}
 },
 ledgerAdjustments:{
  categoryOverrides:{'original-bank-1':'Groceries'},
  predictions:{
   primaryAccountId:'account-100',
   futureRecurringRules:[
    {id:'manual|event|account-100|expense|rent',accountId:'account-100',
     originalAccountId:'account-100',merchant:'Housing'},
    {id:'manual|movement|account-200|account-100',fromAccountId:'account-200',
     toAccountId:'account-100',merchant:'Transfer'}
   ],
   futureTransactionAdds:[{id:'future|1',accountId:'account-200',merchant:'Paycheck'}],
   futureTransactionEdits:{
    ['event|'+esc('automated|series|expense|'+esc('account-100')+'|rent|2026-12-01')+'|'+esc('account-100')]:
     {date:'2026-12-01',amount:2900,accountId:'account-100'},
    ['movement|'+esc('autopay|'+esc('account-200')+'|2026-12-07')]:
     {fromAccountId:'account-100',toAccountId:'account-200',amount:100}
   },
   futureSeriesEdits:{
    ['recurring|expense|'+esc('account-100')+'|rent']:{amount:3000},
    ['series|'+esc('account-200')+'|refund|merchant|period']:{startsOn:'2026-10-01',amount:14},
    ['user-series|'+esc('manual|event|account-100|expense|rent')]:{amount:3200}
   },
   paymentRules:{
    'account-200':{fromAccountId:'account-100',autopayEnabled:true,method:'statement'}
   },
   paymentBills:[{id:'bill1',fromAccountId:'account-100',name:'Insurance',amount:200}],
   futureRecurrenceExclusions:{
    ['auto-series|'+esc('series|income|account-200|employer|phase14')]:
     {accountId:'account-200',merchant:'Employer',type:'income'}
   },
   historyPatternDecisions:{['account-100|expense|utility']: 'dismissed'},
   plannerRoutineDecisions:{['income|account-200|employer']:'confirmed'},
   mortgageReviewDismissals:['mortgage|'+esc('account-100')+'|loan|1200'],
   cashCushion:900,
   monthlyBudgets:{'account-300':100},
   cashFlowStreams:{'stream-3':{accountId:'account-200',amount:90}}
  }
 }};
const copy=JSON.stringify(state),usage=inspect(state),byId=Object.fromEntries(usage.map(x=>[x.id,x]));
assert.equal(byId['account-300'].forecastLinks,0,
 'Globally named budget category must not be mistaken for an account-specific saved forecast');
assert.equal(byId['account-300'].protected,false);
assert.equal(byId['account-100'].categoryEdits,1);
assert.equal(byId['account-100'].primary,true);
assert.ok(byId['account-100'].forecastLinks>=7);
assert.ok(byId['account-200'].forecastLinks>=6);
assert.equal(byId['account-100'].protected,true);
assert.equal(byId['account-200'].protected,true);
assert.equal(byId['account-100'].counts.futureTransactionEdits,2,
 'Linked transfers and per-event edits count as account references');
assert.equal(byId['account-200'].counts.futureSeriesEdits,1);
assert.equal(byId['account-100'].counts.futureSeriesEdits,2);
assert.equal(byId['account-200'].counts.paymentRules,1,
 'The card itself and its funding account both have an account-specific link');
assert.equal(keyContains('recurring|income|'+esc('account-100')+'|employer','account-100'),true);
assert.equal(keyContains('recurring|income|'+esc('account-100')+'|employer','account-200'),false);
assert.equal(JSON.stringify(state),copy,'Inspection is strictly read-only');
const categoryOnly={
 accounts:[{id:'account-200'}],transactions:{'bank-2':{accountId:'account-200'}},
 ledgerAdjustments:{categoryOverrides:{'bank-2':'Other'},predictions:{}}
};
assert.equal(inspect(categoryOnly)[0].forecastLinks,0);
assert.equal(inspect(categoryOnly)[0].categoryEdits,1);
assert.equal(inspect(categoryOnly)[0].protected,true,
 'Do not drop user-selected categories as collateral deletion');
console.log('PASS exact account ID audit: primary account, individual and series edits, recurring schedules, linked transfers, card payments, opt-outs, category decisions, read-only inspection');
