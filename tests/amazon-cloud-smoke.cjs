'use strict';
const assert=require('node:assert/strict');
const cloud=require('../pilot/amazon-cloud.cjs');
const today=new Date().toISOString().slice(0,10);
const t=(id,pending=false,merchant='AMZN Mktp')=>({id,accountId:'fictional-card',date:today,
 merchant,name:merchant,amount:23.25,pending});
const fixture={transactions:{new:t('fictional-new'),pending:t('fictional-pending',true),
 other:t('fictional-grocery',false,'Fictional Grocer'),
 done:t('fictional-done')},ledgerAdjustments:{predictions:{
  transactionNotes:{['bank:'+JSON.stringify(['fictional-card','fictional-done'])]:
   'Amazon: Verified Product'} }},amazonCloud:{enabled:true,scanned:{}}};
assert.equal(cloud.eligible(fixture).length,1,'Only uninspected, posted and unmatched Amazon charges trigger browser');
const id=cloud.eligible(fixture)[0].key;
const attempted=structuredClone(fixture);attempted.amazonCloud.scanned[id]='2026-11-27T11:00:00Z';
assert.equal(cloud.eligible(attempted).length,0,'One successful check removes the charge from automatic rechecks');
assert.equal(cloud.eligible(attempted,{retry:true}).length,1,'Explicit retry can inspect unresolved charges');
assert.equal(cloud.due({enabled:true,lastScheduledDay:null},new Date('2026-11-30T17:05:00Z')),true,
 'Monday 9 AM Pacific is a valid scheduled check');
assert.equal(cloud.due({enabled:true,lastScheduledDay:'2026-11-30'},new Date('2026-11-30T17:05:00Z')),false,
 'Never repeat a scheduled day');
assert.equal(cloud.due({enabled:true},new Date('2026-12-01T17:05:00Z')),false,
 'Tuesday cannot start a browser run');
assert.equal(cloud.due({enabled:false},new Date('2026-11-30T17:05:00Z')),false);
const rows=cloud.parseOrders({status:'COMPLETED',result:{signedIn:true,
 orders:[{orderId:'123-1234567-1234567',title:'Test item',date:today,
  shipmentDate:'',cents:2325,charged:2325}]}});
assert.equal(rows[0].cents,2325);
assert.throws(()=>cloud.parseOrders({status:'COMPLETED',result:{signedIn:false,orders:[]}}),/sign-in/);
assert.throws(()=>cloud.parseOrders({status:'COMPLETED',result:{signedIn:true,
 orders:[{orderId:'123-1234567-1234567',title:'Test item',date:'2026-99-99',
 shipmentDate:'',cents:2325,charged:2325}]}}),/invalid|RangeError/);
assert.equal(cloud.MAX_STEPS,45,'Cap browser-agent steps per run');
assert.ok(cloud.MAX_ESTIMATED_RUN_USD<=1,'Configured run estimate ceiling is not more than $1');
const fakeFetch=async (url,options)=>{
 if(url.endsWith('/v1/wallet'))return {ok:true,json:async()=>({available_balance:'4.0',currency:'USD'})};
 if(url.endsWith('/v1/automation/run-async')){
  const request=JSON.parse(options.body);
  assert.equal(request.use_profile,true,'Reuse TinyFish saved Amazon sign-in');
  assert.equal(request.agent_config.max_steps,45);
  assert(!JSON.stringify(request).includes('fictional-card'),'Do not send bank IDs to TinyFish');
  return {ok:true,json:async()=>({run_id:'12345678-1234-1234-1234-123456789012'})};
 }
 return {ok:true,json:async()=>({status:'COMPLETED',result:{signedIn:true,orders:[]}})};
};
(async()=>{
 await cloud.validateKey('fictional-tinyfish-key-example-1',fakeFetch);
 const run=await cloud.start('fictional-tinyfish-key-example-1',fakeFetch);
 assert.equal(run,'12345678-1234-1234-1234-123456789012');
 assert.equal((await cloud.getRun('fictional-tinyfish-key-example-1',run,fakeFetch)).status,'COMPLETED');
 assert.deepEqual(fixture.transactions.new,t('fictional-new'),'Cloud checks do not mutate source bank facts');
 console.log('PASS conditional TinyFish planning, 3-day scheduling, safe schema, no-repeat records and API preflight');
})().catch(e=>{console.error(e);process.exitCode=1});
