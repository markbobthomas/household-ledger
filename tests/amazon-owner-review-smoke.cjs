'use strict';
// No financial provider calls. Fictional data only.
const assert=require('node:assert/strict');
const moduleUnderTest=require('../pilot/amazon-owner-review.cjs');
const evidence=require('../pilot/amazon-evidence.cjs');
const now=new Date(),date=now.toISOString().slice(0,10);
const orderDate=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
const runId='12345678-1234-1234-1234-123456789012';
const bank={id:'fake-bank-transaction',accountId:'fake-bank',
 date,amount:37.49,pending:false,merchant:'AMZN Mktp',name:'Amazon purchase'};
const key='bank:'+JSON.stringify([bank.accountId,bank.id]);
const state={transactions:{[bank.id]:bank},ledgerAdjustments:{predictions:{},categoryOverrides:{[bank.id]:'Other'}},
 amazonCloud:{enabled:false,pausedReason:'no-matches',lastFailedRunId:runId,
  apiKey:'fictional-private-key',profileId:'prof_fictional_amazon123',
  baselineAt:new Date().toISOString(),run:null,scanned:{}}};
const run={status:'COMPLETED',run_id:runId,created_at:now.toISOString(),
 profile_attached:true,profile_id:state.amazonCloud.profileId,
 goal:'Read only Amazon.com Your Orders for the last 45 days',
 result:{signedIn:true,complete:true,orders:[{
  orderId:'123-1234567-1234567',title:'Fictional kitchen filter',
  date:orderDate,shipmentDate:orderDate,cents:0,charged:0
 },{
  orderId:'123-1234567-1234567',title:'Fictional storage organizer',
  date:orderDate,shipmentDate:orderDate,cents:0,charged:0
 },{
  orderId:'123-2222222-2222222',title:'Fictional distant product',
  date:new Date(Date.now()-30*86400000).toISOString().slice(0,10),
  shipmentDate:'',cents:1999,charged:1999
 }]}};
const original=structuredClone(state);
const r=moduleUnderTest.view(state,run);
assert.equal(r.charges.length,1);
assert.equal(r.charges[0].amountCents,3749);
assert.equal(r.charges[0].candidates.length,1);
assert.equal(r.charges[0].candidates[0].orderTotalCents,null);
assert.deepEqual(r.charges[0].candidates[0].titles,
 ['Fictional kitchen filter','Fictional storage organizer']);
assert.deepEqual(state,original,'Reading candidates must not alter state');
const choice=moduleUnderTest.choose(state,run,key,'123-1234567-1234567');
assert.match(choice.note,/Fictional kitchen filter/);
assert.match(choice.note,/Fictional storage organizer/);
assert.equal(choice.predictions.transactionNotes[key],choice.note);
assert.equal(choice.evidence[bank.id].uncertainty,'owner-selected-no-amount-reconciliation');
assert.equal(choice.evidence[bank.id].source,'amazon-owner-confirmed');
assert.equal(choice.evidence[bank.id].choices[0].items[0].cents,null);
assert.equal(evidence.category(choice.evidence[bank.id],['Home & Maintenance','Shopping']),null,
 'Confirmed purchase titles with unverified item prices never produce automatic categories');
assert.equal(state.ledgerAdjustments.categoryOverrides[bank.id],'Other',
 'A manual category remains unchanged');
assert.ok(choice.scanned[key]);
assert.deepEqual(state,original,'Pure proposal must not write original transactions or state');
assert.throws(()=>moduleUnderTest.choose(state,run,key,'123-2222222-2222222'),/no longer available/);
const noted=structuredClone(state);noted.ledgerAdjustments.predictions.transactionNotes={[key]:'Handwritten note'};
assert.throws(()=>moduleUnderTest.choose(noted,run,key,'123-1234567-1234567'),/handwritten or independently confirmed Note/);
const generated=structuredClone(state);
generated.amazonCloud.enabled=true;generated.amazonCloud.pausedReason=null;
generated.amazonCloud.lastRunTargets=[key];
generated.amazonCloud.scanned={[key]:new Date().toISOString()};
generated.ledgerAdjustments.amazonEvidence={[bank.id]:{
 version:1,source:'amazon-import',accountId:bank.accountId,amountCents:3749,
 orderId:'123-1234567-1234567',match:'possible',
 uncertainty:'cloud-unverified-settlement',updatedAt:new Date().toISOString(),
 choices:[{orderId:'123-1234567-1234567',date:orderDate,
 items:[{title:'Fictional kitchen filter',cents:null}]}]
}};
generated.ledgerAdjustments.predictions.transactionNotes={[key]:'Possible Amazon: Fictional kitchen filter'};
const correctedView=moduleUnderTest.view(generated,run);
assert.equal(correctedView.charges.length,1,
 'An automatically suggested but scanned Possible purchase may still be owner-corrected');
const upgraded=moduleUnderTest.choose(generated,run,key,'123-1234567-1234567');
assert.match(upgraded.predictions.transactionNotes[key],/^Amazon:/,
 'Owner confirmation upgrades only the matching automatically generated Possible Note');
assert.equal(generated.amazonCloud.enabled,true,
 'Preview and confirmation proposal do not interrupt an enabled schedule');
const tampered=structuredClone(generated);
tampered.ledgerAdjustments.predictions.transactionNotes[key]='Possible Amazon: handwritten change';
assert.throws(()=>moduleUnderTest.choose(tampered,run,key,
 '123-1234567-1234567'),/handwritten|independently confirmed/,
 'A user-edited tentative Note may not be silently overwritten');

const elsewhere=structuredClone(state);elsewhere.amazonCloud.scanned[key]='2026-11-01T00:00:00Z';
assert.equal(moduleUnderTest.view(elsewhere,run).charges.length,0,'Previously checked charges cannot be changed');
const wrong=structuredClone(run);wrong.profile_id='prof_different123';
assert.throws(()=>moduleUnderTest.view(state,wrong),/not a recent completed check/);
assert.throws(()=>moduleUnderTest.view(state,{...run,run_id:'12345678-0000-0000-0000-000000000000'}),/not a recent completed check/);
assert.throws(()=>moduleUnderTest.view(state,{...run,status:'RUNNING'}),/not a recent completed check/);
const unpaused=structuredClone(state);unpaused.amazonCloud.pausedReason=null;
assert.throws(()=>moduleUnderTest.view(unpaused,run),/no paused completed/);
console.log('PASS owner-selected Amazon Notes: real order titles, no fabricated cents/categories, private run and bank-scoping guards');
