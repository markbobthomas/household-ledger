'use strict';
const assert=require('node:assert/strict');
const F=require('../account-forecast.js');
const asOf='2026-10-19';
const account=(current,available,balanceAsOf='2026-10-19')=>({id:'bank-check',type:'checking',current,available,balanceAsOf,provider:'plaid'});
function build(a){return F.build({asOf,mode:'plaid',connected:true,accounts:[a]},[],[],{days:2})}
const fresh=build(account(1234.56,900));
assert.equal(fresh.accounts[0].openingCurrent,1234.56);
assert.equal(fresh.accounts[0].opening,1234.56,'Current bank balance is authoritative');
assert.equal(fresh.accounts[0].balanceStatus,'fresh');
const missing=build(account(null,1500));
assert.equal(missing.accounts[0].opening,null,'Available must never be substituted for missing current');
assert.equal(missing.accounts[0].balanceStatus,'unavailable');
assert.equal(missing.accounts[0].valid,false);
const stale=build(account(800,600,'2026-10-01'));
assert.equal(stale.accounts[0].balanceStatus,'stale');
assert.equal(stale.accounts[0].openingCurrent,800,'Retain last actual bank-reported figure with stale label');
const noTimestamp=build(account(800,600,null));
assert.equal(noTimestamp.accounts[0].balanceStatus,'unknown-age');
const disconnected=build({...account(800,600),disconnected:true});
assert.equal(disconnected.accounts[0].balanceStatus,'disconnected');
const simulated=F.build({asOf,mode:'demo',connected:false,accounts:[{...account(50,40),simulated:true}]},[],[],{days:2});
assert.equal(simulated.accounts[0].balanceStatus,'simulated');
// Date alignment is validated by the canonical projection tests.
const pacificEvening='2026-11-01T02:40:00Z';
const pacificSnapshot={asOf:'2026-10-31',mode:'plaid',connected:true,
 accounts:[account(800,600,pacificEvening)]};
assert.equal(F.build(pacificSnapshot,[],[],{days:2}).accounts[0].balanceStatus,'fresh');
assert.equal(require('../planner-core.js').project(pacificSnapshot,[],2).accounts[0].balanceStatus,'fresh');
console.log('PASS: actual current balance authority, missing/stale/disconnected flags, simulation isolation');
