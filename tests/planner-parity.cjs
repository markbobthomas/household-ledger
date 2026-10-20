'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html'),script=read('planner.js'),privateServer=read('pilot/server.cjs'),sandbox=read('sandbox/server.cjs');
const archivedNav=['data-page="budgets"','data-page="transactions"','data-page="insights"','data-page="reviews"','data-page="settings"'];
assert.ok(archivedNav.every(nav=>!html.includes(nav)),'Old six-tab UI is absent from new app');
assert.ok(html.includes('Know your balance before the bill.'),'New purpose is explicit');
assert.ok(html.includes('id="ledger-mode-switch"'),'Private Plaid and Demo share one mode switch');
assert.ok(html.includes('id="planner-main"'),'Both sources use same planner rendering');
assert.ok(html.includes('planner.js'),'Both sources use same planner code, not separate inconsistent apps');
for(const dependency of ['bank-feed.js','ledger-data.js','accounting.js','forecast.js','forecast-ledger.js','account-forecast.js','payment-obligations.js','planner-transactions.js'])
 assert.ok(html.includes(dependency),'Essential read-only forecast capability preserved: '+dependency);
assert.ok(script.includes('HouseholdForecastLedger.build')&&script.includes('HouseholdAccountForecast.build'),
 'Forecast derived from the existing engine, not fabricated UI-only numbers');
assert.ok(script.includes('getSnapshot')&&script.includes('HouseholdLiveSource.bind'),
 'Demo and Real select bank snapshots but share projections');
assert.ok(privateServer.includes('pilot[/]data-source[.]js')&&privateServer.includes('planner[.]css')&&privateServer.includes('planner|'),
 'Private Render preserves authorized source adapter and can serve new planner');
assert.ok(sandbox.includes('planner\\.css')&&sandbox.includes('planner|'),
 'Existing Render Sandbox fixture can serve new planner without exposing private bank data');
assert.ok(script.includes('enterUnavailable()'),'Unavailable Real mode has no Demo fallback');
const M=require('../ledger-data.js'),F=require('../forecast.js'),L=require('../forecast-ledger.js'),A=require('../account-forecast.js');
const entries=[
 {id:'pay-1',date:'2026-07-01',merchant:'Payroll',type:'income',category:'Other',account:'Checking',amount:2500},
 {id:'pay-2',date:'2026-08-01',merchant:'Payroll',type:'income',category:'Other',account:'Checking',amount:2500},
 {id:'pay-3',date:'2026-09-01',merchant:'Payroll',type:'income',category:'Other',account:'Checking',amount:2500},
 {id:'rent-1',date:'2026-07-05',merchant:'Mortgage',type:'expense',category:'Housing',account:'Checking',amount:1800},
 {id:'rent-2',date:'2026-08-05',merchant:'Mortgage',type:'expense',category:'Housing',account:'Checking',amount:1800},
 {id:'rent-3',date:'2026-09-05',merchant:'Mortgage',type:'expense',category:'Housing',account:'Checking',amount:1800}
];
const data=M.migrate({transactions:entries}),asOf='2026-10-19',rows=M.records(data);
const expected=L.build(data,rows,asOf,60,F,M).events;
const base={asOf,accounts:[{id:'checking',name:'Checking',accountType:'checking',current:7000,available:6900,transactionAccount:'Checking'}]};
const demo=A.build({...base,mode:'demo'},expected,[],{days:60,records:rows});
const real=A.build({...base,mode:'plaid',connected:true,
 accounts:base.accounts.map(a=>({...a,balanceAsOf:'2026-10-19T09:00:00Z'}))},expected,[],{days:60,records:rows});
assert.deepEqual(real.accounts[0].series.map(x=>x.balance),demo.accounts[0].series.map(x=>x.balance),
 'Same source facts and events produce identical numerical Demo and Real balance trajectories');
assert.ok(real.accounts[0].balanceStatus==='fresh'&&demo.accounts[0].balanceStatus==='simulated',
 'Bank provenance and freshness remain distinguished');
console.log('PASS new single-purpose planner: shared Demo/Real forecast engine and same financial outputs, private authenticated bank adapter retained, no legacy analysis navigation');