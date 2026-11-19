'use strict';
const assert=require('node:assert/strict');
const {analyze,safeSnapshot,cleanDescription}=require('../pilot/ai-private-adapter.cjs');
const accounts=[{id:'private-account-123',number:'123456789012',token:'secret'}];
const transactions=[{id:'real-id-1',accountId:'private-account-123',date:'2026-11-01',amount:2000,
 description:'Transfer 1234 5678 9012 mortgage',password:'dont-send'}];
const safe=safeSnapshot(transactions,accounts);
assert(!JSON.stringify(safe.rows).includes('123456789012'));
assert(!JSON.stringify(safe.rows).includes('private-account-123'));
assert(!JSON.stringify(safe.rows).includes('dont-send'));
assert(cleanDescription('password:supersecret').includes('[redacted-credential]'));
assert(!/\\d/.test(cleanDescription('Acct 123456789012 Store 24')));
(async()=>{
 await assert.rejects(()=>analyze({transactions,accounts,consent:false,apiKey:'test'}),/consent/);
 let sent;
 const result=await analyze({transactions,accounts,consent:true,apiKey:'test',
  fetchImpl:async(url,options)=>{
   assert.equal(url,'https://api.openai.com/v1/chat/completions');
   sent=options.body;
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({proposals:[{
    kind:'possible-transfer',accountId:'account-1',predictedDate:null,predictedAmount:2000,
    confidence:0.7,evidenceTransactionIds:['tx-1'],explanation:'Possible mortgage funding'
   }]})}}]})};
  }});
 assert(!sent.includes('private-account-123'));
 assert(!sent.includes('123456789012'));
 assert(!sent.includes('dont-send'));
 assert(sent.includes('"store":false'));
 const format=JSON.parse(sent).response_format;
 assert.equal(format.type,'json_schema');
 assert.equal(format.json_schema.strict,true);
 assert.deepEqual(format.json_schema.schema.properties.proposals.items.required,
  ['kind','accountId','predictedDate','predictedAmount','confidence','evidenceTransactionIds','explanation']);
 assert.equal(result[0].accountId,'private-account-123');
 assert.deepEqual(result[0].evidenceTransactionIds,['real-id-1']);
 assert.equal(result[0].status,'needs-confirmation');
 const valid={kind:'category',accountId:'account-1',predictedDate:null,
  predictedAmount:null,confidence:.7,evidenceTransactionIds:['tx-1'],explanation:'Review category'};
 const mixed=await analyze({transactions,accounts,consent:true,apiKey:'test',
  fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({proposals:[
   {...valid,evidenceTransactionIds:['tx-999']},valid]})}}]})})});
 assert.equal(mixed.length,1);
 assert.equal(mixed[0].kind,'category');
 await assert.rejects(()=>analyze({transactions,accounts,consent:true,apiKey:'test',
  fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({proposals:[
   {...valid,evidenceTransactionIds:['tx-999']}]})}}]})})}),e=>e.safeCode==='invalid_ai_evidence');
 await assert.rejects(()=>analyze({transactions,accounts,consent:true,apiKey:'test',
  fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'not-json'}}]})})}),
  e=>e.safeCode==='invalid_ai_json');
 await assert.rejects(()=>analyze({transactions,accounts,consent:true,apiKey:'test',
  fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({proposals:[
   {...valid,accountId:'unknown-account'}]})}}]})})}),e=>e.safeCode==='invalid_ai_account');
 const empty=await analyze({transactions,accounts,consent:true,apiKey:'test',
  fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"proposals":[]}'}}]})})});
 assert.deepEqual(empty,[]);
 console.log('Private AI adapter: passed');
})().catch(e=>{console.error(e);process.exitCode=1});
