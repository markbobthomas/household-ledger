'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html'),script=read('planner.js'),
 privateServer=read('pilot/server.cjs'),sandbox=read('sandbox/server.cjs');
assert.ok(html.includes('Know your balance before the bill.'));
assert.ok(html.includes('id="ledger-mode-switch"'));
assert.ok(html.includes('id="planner-main"'));
assert.ok(html.includes('planner-core.js'),'Only one forecasting engine is loaded');
for(const obsolete of ['forecast.js','forecast-ledger.js','account-forecast.js',
 'planner-intelligence.js','planner-recurrence.js','planner-backtest.js'])
 assert.ok(!html.includes('src="'+obsolete),
  'Legacy parallel forecasting engine is not loaded: '+obsolete);
for(const dependency of ['bank-feed.js','ledger-data.js','accounting.js',
 'payment-obligations.js','planner-transactions.js','planner-history.js','planner-core.js'])
 assert.ok(html.includes(dependency),'Missing shared UI asset '+dependency);
assert.ok(script.includes('HouseholdFutureLedger.materialize')&&
 !script.includes('HouseholdForecastLedger.build'),
 'All balances must derive from one canonical future ledger');
assert.ok(script.includes('HouseholdLiveSource.bind')&&script.includes('getSnapshot'),
 'Demo and real read separate bank sources but share one planner');
assert.ok(privateServer.includes('planner-core|bank-feed')&&
 sandbox.includes('planner-core|bank-feed'),
 'Private and Sandbox hosts must serve the unified planning module');
assert.ok(script.includes('enterUnavailable()'),
 'A failed private bank connection must not silently show fictional accounts');
const M=require('../ledger-data.js'),C=require('../planner-core.js'),
 T=require('../planner-transactions.js'),P=require('../payment-obligations.js');
const entries=[
 {id:'pay-1',date:'2026-08-01',merchant:'Employer Payroll',type:'income',category:'Other',
  accountId:'checking',amount:2500,pending:false},
 {id:'pay-2',date:'2026-09-01',merchant:'Employer Payroll',type:'income',category:'Other',
  accountId:'checking',amount:2500,pending:false},
 {id:'rent-1',date:'2026-08-05',merchant:'Mortgage',type:'expense',category:'Housing',
  accountId:'checking',amount:1800,pending:false},
 {id:'rent-2',date:'2026-09-05',merchant:'Mortgage',type:'expense',category:'Housing',
  accountId:'checking',amount:1800,pending:false}
];
const data=M.migrate({transactions:entries}),rows=M.records(data),asOf='2026-10-19',
 account={id:'checking',name:'Checking',accountType:'checking',
  current:7000,available:6900,transactionAccount:'Checking'};
const demo=C.materialize({asOf,mode:'demo',accounts:[{...account,simulated:true}]},
 rows,data.predictions,T,P,90);
const real=C.materialize({asOf,mode:'plaid',connected:true,
 accounts:[{...account,balanceAsOf:'2026-10-19T09:00:00Z',simulated:false}]},
 rows,data.predictions,T,P,90);
assert.deepEqual(real.ledger.map(e=>[e.id,e.date,e.amount]),
 demo.ledger.map(e=>[e.id,e.date,e.amount]));
assert.deepEqual(real.projection.accounts[0].series.map(x=>x.balance),
 demo.projection.accounts[0].series.map(x=>x.balance),
 'Same future ledger generates exactly the same Demo and Real balances');
assert.equal(real.projection.accounts[0].balanceStatus,'fresh');
assert.equal(demo.projection.accounts[0].balanceStatus,'simulated');
console.log('PASS one future ledger powers Demo and Real; legacy engines are not loaded; private Plaid adapter and bank protection retained');
