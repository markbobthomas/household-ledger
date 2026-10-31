'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const Bank=require('../bank-feed.js');
const oldTZ=process.env.TZ;
process.env.TZ='America/Los_Angeles';
try{
 assert.equal(Bank.localDate(new Date('2026-11-01T06:30:00Z')),'2026-10-31',
  'Late Saturday in Pacific time remains October 31');
 assert.equal(Bank.localDate(new Date('2027-01-01T07:30:00Z')),'2026-12-31',
  'Do not convert Pacific New Year\'s Eve into January 1 using UTC');
 assert.equal(Bank.localDate(new Date('2027-01-01T08:30:00Z')),'2027-01-01',
  'Pacific local midnight advances exactly once');
}finally{if(oldTZ===undefined)delete process.env.TZ;else process.env.TZ=oldTZ}
const add=(iso,days)=>{
 const date=new Date(iso+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);
 return date.toISOString().slice(0,10);
};
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const delta=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
const T={
 recurrenceDates:rule=>rule.testDates,
 keyEvent:(id,account)=>id+'|'+account
};
global.HouseholdPlannerTransactions=T;
global.document={addEventListener(){}};
require('../planner-summary.js');
const calculate=global.HouseholdPlannerSummary.knownGaps;
const asOf='2026-10-31',through=add(asOf,1095),accountId='checking';
const points=Array.from({length:1096},(_,day)=>({date:add(asOf,day),events:[]}));
const byDate=new Map(points.map(p=>[p.date,p]));
const prefs={futureRecurringRules:[],futureTransactionEdits:{}};
for(let i=0;i<36;i++){
 const dates=Array.from({length:35},(_,n)=>add(asOf,12+n*30));
 const rule={id:'rule-'+i,accountId,type:i%5?'expense':'income',
  merchant:'Fictional payment '+i,originalMerchant:'Fictional payment '+i,
  amount:100+i,testDates:dates};
 prefs.futureRecurringRules.push(rule);
 for(let j=0;j<dates.length;j++){
  const due=dates[j];
  if(j%4===0){const p=byDate.get(add(due,2));if(p)p.events.push({
   kind:rule.type,recurringRuleId:rule.id,merchant:'Different provider description'});}
  if(j%4===1){const p=byDate.get(add(due,-3));if(p)p.events.push({
   kind:rule.type,merchant:rule.merchant.toUpperCase()});}
  if(j%4===2&&i%6===0)
   prefs.futureTransactionEdits[T.keyEvent('user|'+rule.id+'|'+due,accountId)]={skipped:true};
 }
}
function reference(){
 const dates=new Map();
 for(const r of prefs.futureRecurringRules){
  if(r.kind==='movement'||!['income','expense'].includes(r.type)||
   String(r.accountId)!==String(accountId)||!r.id)continue;
  for(const due of T.recurrenceDates(r,asOf,through)){
   if(delta(due,asOf)<=7)continue;
   const exists=points.some(p=>Math.abs(delta(p.date,due))<=6&&
    (p.events||[]).some(e=>e.kind===r.type&&
     (String(e.recurringRuleId||'')===String(r.id)||
      norm(e.sourceMerchant||e.merchant)===norm(r.originalMerchant||r.merchant))));
   if(exists||prefs.futureTransactionEdits[T.keyEvent('user|'+r.id+'|'+due,accountId)]?.skipped)continue;
   const matches=dates.get(due)||[];
   matches.push({date:due,merchant:r.merchant||'Recurring payment',
    amount:Number(r.amount),type:r.type,accountId:String(accountId)});
   dates.set(due,matches);
  }
 }
 return dates;
}
const startOld=performance.now(),old=reference(),oldMs=performance.now()-startOld;
const startNew=performance.now(),fast=calculate(prefs,asOf,through,accountId,points),
 newMs=performance.now()-startNew;
assert.deepEqual([...fast], [...old],
 'Indexed checks preserve every old calendar missing-payment result and ordering');
assert.ok(newMs<oldMs,
 'Event-day index should do less work than a 3-year scan per rule');
assert.equal(calculate({...prefs,futureRecurringRules:[]},asOf,through,accountId,points).size,0);
console.log('PASS calendar missing-payment parity; fictional 3-year workload: old '+oldMs.toFixed(1)+'ms, indexed '+newMs.toFixed(1)+'ms');
