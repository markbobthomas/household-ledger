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
assert.equal(cloud.due({enabled:true,baselineAt:'2026-11-20T00:00:00Z',lastScheduledDay:null},new Date('2026-11-30T17:05:00Z')),true,
 'Monday 9 AM Pacific is a valid scheduled check');
assert.equal(cloud.due({enabled:true,baselineAt:'2026-11-20T00:00:00Z',lastScheduledDay:'2026-11-30'},new Date('2026-11-30T17:05:00Z')),false,
 'Never repeat a scheduled day');
assert.equal(cloud.due({enabled:true},new Date('2026-12-01T17:05:00Z')),false,
 'Tuesday cannot start a browser run');
assert.equal(cloud.due({enabled:false},new Date('2026-11-30T17:05:00Z')),false);
const rows=cloud.parseOrders({status:'COMPLETED',result:{signedIn:true,complete:true,
 orders:[{orderId:'123-1234567-1234567',title:'Test item',date:today,
  shipmentDate:'',cents:2325,charged:2325}]}});
assert.equal(rows[0].cents,2325);
assert.throws(()=>cloud.parseOrders({status:'COMPLETED',result:{signedIn:false,complete:true,orders:[]}}),/sign-in/);
assert.throws(()=>cloud.parseOrders({status:'COMPLETED',result:{signedIn:true,complete:false,orders:[]}}),/incomplete/,
 'A provider that admits the export was incomplete cannot be recorded as successful');
assert.throws(()=>cloud.parseOrders({status:'COMPLETED',result:{signedIn:true,orders:[]}}),/incomplete/,
 'Missing completeness is not proof of a good report');
assert.throws(()=>cloud.parseOrders({status:'COMPLETED',result:{signedIn:true,complete:true,
 orders:[{orderId:'123-1234567-1234567',title:'Test item',date:'2026-99-99',
 shipmentDate:'',cents:2325,charged:2325}]}}),/invalid|RangeError/);

const baseline=cloud.baseline(fixture,{enabled:false,scanned:{}},new Date());
assert.ok(baseline.baselineAt,'A safe first-enable point must be durable');
assert.equal(cloud.eligible({...fixture,amazonCloud:{...baseline,enabled:true}}).length,0,
 'Enabling cannot launch TinyFish for historical Amazon charges without consent');
const newTx=t('just-posted-later');
const afterBaseline={...fixture,transactions:{...fixture.transactions,[newTx.id]:newTx},
 amazonCloud:{...baseline,enabled:true}};
assert.equal(cloud.eligible(afterBaseline).length,1,
 'A new posted Amazon purchase after enable must be eligible');
assert.equal(cloud.due({enabled:true},new Date('2026-11-30T17:05:00Z')),false,
 'A legacy enabled state without a safe baseline must not launch');
assert.equal(cloud.due({...baseline,enabled:true,pausedReason:'invalid-report'},
 new Date('2026-11-30T17:05:00Z')),false,
 'Paused connections never launch automatically');
const at=new Date('2026-11-30T17:05:00Z');
const last30=Array.from({length:13},(_,i)=>
 new Date(at.getTime()-(i+1)*86400000).toISOString());
assert.equal(cloud.limit({runStarts:last30},at),'30-day limit reached',
 'At most 13 provider starts in any rolling 30 days');
assert.equal(cloud.limit({runStarts:[new Date(at.getTime()-3600000).toISOString()]},at),
 'One Amazon browser check already started today');
assert.equal(cloud.due({...baseline,enabled:true,runStarts:last30},at),false,
 'Rolling run cap blocks an otherwise due weekly schedule');
const uncertainState={transactions:{'fictional-possible':{
 ...t('fictional-possible'),amount:39.99}},ledgerAdjustments:{predictions:{}}};
const uncertainProposal=cloud.prepare(uncertainState,[{
 orderId:'123-1234567-1234567',date:today,shipmentDate:today,
 title:'Fictional household storage tote',cents:1999,charged:1999
}],['Home & Maintenance','Shopping','Other'],
 [cloud.eligible({...uncertainState,amazonCloud:{scanned:{}}})[0].key]);
assert.equal(uncertainProposal.report.matches,0,
 'Approximate item-to-charge amounts must not be treated as exact');
assert.equal(uncertainProposal.hasNotes,false,
 'Automatic TinyFish import never writes speculative Possible Amazon Notes');

const exactTx={...t('fictional-exact-match'),amount:21.99};
const otherTx={...t('fictional-other-historical'),amount:21.99};
const scopedState={transactions:{[exactTx.id]:exactTx,[otherTx.id]:otherTx},
 ledgerAdjustments:{predictions:{}}};
const scopedResult=cloud.prepare(scopedState,[{
 orderId:'123-1234567-1234567',title:'Fictional household storage bin',
 date:today,shipmentDate:today,cents:2199,charged:2199
}],['Home & Maintenance','Shopping','Other'],[cloud.eligible({
 ...scopedState,amazonCloud:{scanned:{[cloud.eligible({
  ...scopedState,amazonCloud:{scanned:{}}
 }).find(x=>x.id===otherTx.id).key]:'2026-11-27T00:00:00Z'}}
})[0].key]);
assert.equal(scopedResult.report.bankCharges,1,
 'Cloud importer sees only the bank charge reserved for this run');
assert.equal(scopedResult.report.matches,1,
 'A single scoped exact match can be saved');
assert.equal(scopedResult.next.predictions.transactionNotes[
 cloud.eligible({...scopedState,amazonCloud:{scanned:{}}}).find(x=>x.id===otherTx.id).key
],undefined,'Unrelated prior purchases never receive a cloud Note');


assert.equal(cloud.DEFAULT_AGENT_MAX_STEPS,150,'Use standard TinyFish step default for cost modeling');
assert.equal(cloud.MAX_ESTIMATED_RUN_USD,2.42,'Model the full default step exposure and ten browser minutes');
assert.equal(cloud.MAX_RUNS_30_DAYS*cloud.MAX_ESTIMATED_RUN_USD,31.46,
 'Expose the rolling 30-day modeled worst case, not a hard provider dollar cap');
const fakeFetch=async (url,options)=>{
 if(url.endsWith('/v1/profiles'))return {ok:true,json:async()=>({profiles:[{
  id:'prof_fictional_amazon123',name:'Fictional Amazon',is_default:true,
  signed_in_sites:[{site:'amazon.com'}]
 }]})};
 if(url.endsWith('/v1/automation/run-async')){
  const request=JSON.parse(options.body);
  assert.equal(request.use_profile,true,'Reuse TinyFish saved Amazon sign-in');
  assert.equal(request.profile_id,'prof_fictional_amazon123',
   'Always pin a run to the Amazon profile verified during setup');
  assert.equal(request.session_id,undefined,
   'Do not send undocumented session_id to TinyFish Agent endpoint');
  assert.equal(request.agent_config.mode,undefined,
   'Do not send beta-gated mode configuration to ordinary accounts');
  assert.equal(request.agent_config.max_steps,undefined,
   'Standard TinyFish Agent must not send beta-only custom max_steps');
  assert.equal(request.agent_config.max_duration_seconds,600);
  assert.deepEqual(request.output_schema.properties.orders.items.properties.charged,
   {type:'integer',nullable:true},
   'TinyFish rejects type arrays (HTTP 400): use nullable:true for optional order totals');
  const allowed=new Set(['type','properties','required','items','nullable','minItems',
   'maxItems','minimum','maximum','anyOf','enum','format','propertyOrdering']);
  const validateSchema=(schema,path='#')=>{
   assert(schema&&typeof schema==='object'&&!Array.isArray(schema),
    'TinyFish output schema node must be an object at '+path);
   for(const [key,value] of Object.entries(schema)){
    assert(allowed.has(key),'TinyFish output schema has unsupported '+key+' at '+path);
    if(key==='type')assert.equal(typeof value,'string',
     'TinyFish output schema type arrays return 400 at '+path);
    if(key==='properties')
     for(const [name,child] of Object.entries(value))validateSchema(child,path+'/'+name);
    if(key==='items')validateSchema(value,path+'/items');
   }
  };
  validateSchema(request.output_schema);
  assert(!JSON.stringify(request).includes('fictional-card'),'Do not send bank IDs to TinyFish');
  return {ok:true,json:async()=>({run_id:'12345678-1234-1234-1234-123456789012'})};
 }
 return {ok:true,json:async()=>({status:'COMPLETED',result:{signedIn:true,complete:true,orders:[]}})};
};
(async()=>{
 const profile=await cloud.validateKey('fictional-tinyfish-key-example-1',fakeFetch);
 assert.equal(profile.profileId,'prof_fictional_amazon123');
 assert.equal(profile.amazonSignInClaimed,true);
 const run=await cloud.start('fictional-tinyfish-key-example-1',profile.profileId,fakeFetch);
 assert.equal(run,'12345678-1234-1234-1234-123456789012');
 assert.equal((await cloud.getRun('fictional-tinyfish-key-example-1',run,fakeFetch)).status,'COMPLETED');
 await assert.rejects(
  cloud.start('fictional-tinyfish-key-example-1','prof_fictional_amazon123',
   async()=>({ok:false,status:400,
    headers:{get:()=>null},
    text:async()=>JSON.stringify({
     error:{code:'INVALID_INPUT',message:
      'output_schema type arrays are not supported at #/properties/orders/items/properties/charged.'},
     request_id:'12345678-1234-1234-1234-123456789012'
    })})),
  error=>error.notStarted===true&&
   /INVALID_INPUT/.test(error.message)&&
   /output_schema type arrays/.test(error.message)&&
   /Request ID: 12345678/.test(error.message),
  '400 must expose sanitized provider validation details, request ID and no-paid-run status'
 );
 await assert.rejects(
  cloud.start('fictional-tinyfish-key-example-1','prof_fictional_amazon123',
   async()=>({ok:false,status:400,
    text:async()=>JSON.stringify({error:{code:'INVALID_INPUT',
     message:'Invalid request, key: fictional-tinyfish-key-example-1'}})})),
  error=>!error.message.includes('fictional-tinyfish-key-example-1')&&
    error.message.includes('[redacted]'),
  'Never leak a TinyFish API key through the displayed provider error'
 );
 await assert.rejects(cloud.validateKey('fictional-key-with-no-amazon',
  async()=>({ok:true,json:async()=>({profiles:[{id:'prof_fictional_other123',
   is_default:true,signed_in_sites:[{site:'example.com'}]}]})})),
  /Amazon is not saved/,
  'Wrong default profile cannot be silently used for paid Amazon browsing');
 await assert.rejects(cloud.validateKey('fictional-key-with-no-profile',
  async()=>({ok:true,json:async()=>({profiles:[]})})),
  /set it as Default/,
  'No default profile fails setup before paid work');
 assert.deepEqual(fixture.transactions.new,t('fictional-new'),'Cloud checks do not mutate source bank facts');
 console.log('PASS conditional TinyFish planning, 3-day scheduling, safe schema, no-repeat records and API preflight');
})().catch(e=>{console.error(e);process.exitCode=1});
