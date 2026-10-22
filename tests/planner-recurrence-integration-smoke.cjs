'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),
 vm=require('node:vm');
const files=[
 'demo-data.js','bank-feed.js','accounting.js','categorization.js',
 'ledger-data.js','forecast.js','forecast-ledger.js','account-forecast.js',
 'payment-obligations.js','planner-intelligence.js','planner-backtest.js',
 'planner-transactions.js','planner-history.js','planner-recurrence.js','planner-core.js','planner.js'
];
const FixedDate=class extends Date{
 constructor(...args){super(...(args.length?args:['2026-10-20T12:00:00Z']))}
 static now(){return Date.parse('2026-10-20T12:00:00Z')}
};
const store={},handlers={},elements={};
const el=id=>elements[id]||(elements[id]={id,innerHTML:'',textContent:'',value:'',
 hidden:false,disabled:false,setAttribute(){},removeAttribute(){},
 classList:{toggle(){}},scrollIntoView(){},querySelector(){return{disabled:false}}});
const document={getElementById:el,querySelector(){return null},querySelectorAll(){return[]},
 addEventListener(type,fn){(handlers[type]??=[]).push(fn)},
 createElement(){return el('test-error')}};
const localStorage={getItem:key=>store[key]??null,
 setItem:(key,val)=>{store[key]=String(val)}};
class MockFormData{
 constructor(form){this.values=Object.entries(form.fields||{})}
 *[Symbol.iterator](){yield*this.values}
 getAll(){return[]}
}
const sandbox={document,localStorage,FormData:MockFormData,
 Date:FixedDate,console,setTimeout(){},scrollTo(){}};
sandbox.window=sandbox;
const context=vm.createContext(sandbox);
for(const file of files.slice(0,-1))vm.runInContext(
 fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'),context,{filename:file});
const create=sandbox.createHouseholdLedgerDemo;
assert.equal(typeof create,'function');
sandbox.createHouseholdLedgerDemo=()=>{
 const original=create();
 // Use a single bank-paid mortgage that the old three-month detector cannot
 // possibly learn, with the actual bank transaction mislabeled 'transfer'.
 original.transactions=[{
  id:'solo-bank-mortgage',date:'2026-09-15',
  merchant:'Home Mortgage ACH',accountId:'demo-checking',account:'Checking',
  amount:2000,type:'transfer',cashDirection:'out',
  category:'Other',pending:false,demo:true
 },{
  id:'generic-bank-first',date:'2026-09-09',merchant:'ABC Draft 984',
  accountId:'demo-checking',account:'Checking',amount:82.35,
  type:'expense',category:'Other',pending:false,demo:true
 },{
  id:'generic-bank-second',date:'2026-10-09',merchant:'ABC Draft 984',
  accountId:'demo-checking',account:'Checking',amount:82.35,
  type:'expense',category:'Other',pending:false,demo:true
 }];
 return original;
};
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../planner.js'),'utf8'),
 context,{filename:'planner.js'});
async function click(marker,dataset){
 const event={target:{closest:selector=>selector===marker?{dataset}:null}};
 for(const fn of handlers.click||[])await fn(event);
}
async function submit(fields){
 const form={fields,hasAttribute:key=>key==='data-history-recurring-form',
  querySelector(){return{disabled:false}},appendChild(){}};
 const event={preventDefault(){},target:{closest:key=>
  key==='[data-history-recurring-form]'?form:null}};
 for(const fn of handlers.submit||[])await fn(event);
}
const future=()=>el('planner-main').innerHTML;
const occurrences=html=>(html.match(/Mortgage ACH/g)||[]).length;
(async()=>{
 await click('[data-view]',{view:'transactions'});
 const initial=future();
 assert.equal(occurrences(initial),36,
  'One posted mortgage automatically creates November, December, January without review');
 assert.match(initial,/Nov 15/);
 assert.equal((initial.match(/ABC Draft 984/g)||[]).length,36,
  'Unfamiliar merchant with two real equal monthly payments appears automatically');
 assert.ok(!initial.includes('Forecast needs review.')||initial.includes('Mortgage ACH'),
  'A bank-derived mortgage must not be absent from the future schedule');
 await click('[data-view]',{view:'history'});
 assert.match(future(),/Home Mortgage ACH/);
 await click('[data-history-plan]',{
  historyPlan:'solo-bank-mortgage',historyAccount:'demo-checking'});
 assert.match(future(),/Save recurring forecast/);
 await submit({merchant:'Home Mortgage ACH',accountId:'demo-checking',
  date:'2026-11-25',amount:'2000',type:'expense',frequency:'monthly'});
 const saved=JSON.parse(store['household-planner-sample-settings-v1']||'{}');
 assert.equal(saved.futureRecurringRules.length,1);
 assert.equal(saved.futureRecurringRules[0].date,'2026-11-25');
 await click('[data-view]',{view:'transactions'});
 const after=future();
 assert.equal(occurrences(after),36,
  'One user-confirmed mortgage per future month over three years; no old inferred date');
 assert.match(after,/Nov 25/);
 assert.doesNotMatch(after,/Nov 15[^<]*.*Mortgage ACH/,
  'Old posting date must not produce a duplicate debit');
 // A bank transaction already attached to the recurring plan offers ONLY
 // View schedule, even when the bank categorized it as a transfer.
 await click('[data-view]',{view:'history'});
 assert.match(future(),/View schedule/, 'Known bank payment must not suggest creating recurrence');
 await click('[data-history-plan]',{
  historyPlan:'solo-bank-mortgage',historyAccount:'demo-checking'});
 assert.doesNotMatch(future(),/Confirm recurring transaction/,
  'Clicking linked history must not open another creation form');
 const again=JSON.parse(store['household-planner-sample-settings-v1']||'{}');
 assert.equal(again.futureRecurringRules.length,1,'Opening existing schedule leaves one rule');
 await click('[data-view]',{view:'transactions'});
 assert.equal(occurrences(future()),36,'No duplicate mortgage created by opening the schedule');
 // Repeat the exact same owner-confirmation scenario for an UNKNOWN merchant.
 // Its category/name provides no fixed-bill shortcut, so detection genuinely
 // depends on the two observed exact-amount calendar payments.
 await click('[data-view]',{view:'history'});
 await click('[data-history-plan]',{
  historyPlan:'generic-bank-second',historyAccount:'demo-checking'});
 await submit({merchant:'ABC Draft 984',accountId:'demo-checking',
  date:'2026-11-26',amount:'84',type:'expense',frequency:'monthly'});
 const genericSaved=JSON.parse(store['household-planner-sample-settings-v1']||'{}');
 assert.equal(genericSaved.futureRecurringRules.length,2,
  'Confirming unrelated generic payment creates one separate recurring rule');
 await click('[data-view]',{view:'transactions'});
 const genericAfter=future();
 assert.equal((genericAfter.match(/ABC Draft 984/g)||[]).length,36,
  'Owner-modified generic payment occurs once per month through the entire modeled period');
 assert.match(genericAfter,/Nov 26/);
 assert.doesNotMatch(genericAfter,/Nov 9[^<]*.*ABC Draft 984/);
 console.log('PASS mortgage and general-merchant automatic forecasting; owner edits due date and amount; no duplicate bills; bank history unchanged');
})().catch(e=>{console.error(e);process.exitCode=1});
