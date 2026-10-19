'use strict';
// Regression: posted bank expenses must appear under a reviewed category even when
// that category has no monthly cap. Same source powers Budget, Insights and Activity.
const assert=require('node:assert/strict');
require('../accounting.js');require('../categorization.js');
const Model=require('../ledger-data.js'),Forecast=require('../forecast.js'),Shared=require('../forecast-ledger.js');
const month='2026-10',asOf='2026-10-19';
const state=Model.migrate({accounts:[{id:'acct',name:'Test Checking',type:'depository',subtype:'checking',itemId:'item1'}],transactions:[
 {id:'plaid:a',date:'2026-10-14',merchant:'Unknown Hobby Merchant',type:'expense',amount:19,category:'Other',pending:false,account:'Test Checking',accountId:'acct',source:{provider:'plaid',itemId:'item1',providerTransactionId:'a',accountId:'acct'}},
 {id:'plaid:b',date:'2026-10-15',merchant:'Shop For Fun',type:'expense',amount:31,category:'Other',pending:false,account:'Test Checking',accountId:'acct',source:{provider:'plaid',itemId:'item1',providerTransactionId:'b',accountId:'acct'}}
 ]});
const original=JSON.stringify(state.transactions);
Model.addCategory(state,'Hobbies');
Model.setCategory(state,'plaid:a','Hobbies');
Model.setCategory(state,'plaid:b','Health');
let entries=Model.records(state);
assert.equal(entries.find(t=>t.id==='plaid:a').category,'Hobbies');
assert.equal(entries.find(t=>t.id==='plaid:b').category,'Health');
const monthly=()=>Shared.build(state,Model.records(state),asOf,90,Forecast,Model);
const before=monthly();
assert.ok(before.categoryViews[month+'|Hobbies'],'Custom category must be in shared projection without a cap');
assert.equal(before.categoryViews[month+'|Hobbies'].actual,19,'Actual spending belongs to uncapped custom category');
assert.equal(before.categoryViews[month+'|Health'].actual,31,'Actual spending belongs to uncapped standard category');
assert.equal(state.predictions.monthlyBudgets.Hobbies,undefined);
Model.setMonthlyBudget(state,'Hobbies',100);
Model.setMonthlyBudget(state,'Health',200);
const after=monthly();
assert.equal(after.categoryViews[month+'|Hobbies'].actual,19,'Setting cap must not change categorized spending');
assert.equal(after.categoryViews[month+'|Health'].actual,31,'Setting built-in cap must not change categorized spending');
assert.equal(JSON.stringify(state.transactions),original,'Bank source facts are immutable through edits');
console.log('PASS uncapped and capped categories share reviewed bank spending, including custom categories');
