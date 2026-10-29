'use strict';
// Fictional private-bank fixture: scoped category corrections are saved with
// merchant lessons, while actual Plaid facts and forecasts remain unchanged.
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-category-lesson-'));
const file=path.join(dir,'pilot.enc'),password='isolated-category-learning-password';
const secret='isolated-fake-encryption-key-category-learning';
Object.assign(process.env,{PILOT_PASSWORD:password,PILOT_ENCRYPTION_KEY:secret,
 PLAID_CLIENT_ID:'fake-client',PLAID_SECRET:'fake-secret',PLAID_ENV:'sandbox',PILOT_STATE_PATH:file});
const key=crypto.createHash('sha256').update(secret).digest();
const encrypt=data=>{
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),
  value=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data))),cipher.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
  data:value.toString('base64')});
};
const row=(id,merchant,date,primary='GENERAL_MERCHANDISE',confidence='LOW')=>({
 id,accountId:'checking',date,merchant,name:merchant,amount:15,pending:false,
 category:{primary,detailed:primary+'_OTHER',confidence_level:confidence}
});
const transactionRows=[
 row('coffee-1','Fictional Corner Café','2026-10-04','GENERAL_MERCHANDISE','LOW'),
 row('coffee-2','Fictional Corner Café','2026-10-11','GENERAL_MERCHANDISE','LOW'),
 row('coffee-3','Fictional Corner Café','2026-10-18','GENERAL_MERCHANDISE','LOW'),
 row('amazon-1','Amazon','2026-10-10','GENERAL_MERCHANDISE','HIGH'),
 row('amazon-2','Amazon','2026-10-15','GENERAL_MERCHANDISE','HIGH'),
 row('pay-1','Fictional Paycheck','2026-10-01','INCOME','HIGH')
];
const initial={items:[{id:'item-1',token:'fictional-token',accountIds:['checking']}],
 accounts:[{id:'checking',name:'Fictional Checking',type:'depository',subtype:'checking',current:5000}],
 transactions:Object.fromEntries(transactionRows.map(row=>[row.id,row])),
 ledgerAdjustments:{categoryOverrides:{},learning:{categoryRules:{},ruleHistory:[]},
  predictions:{futureRecurringRules:[],cashCushion:500}}};
fs.writeFileSync(file,encrypt(initial),{mode:0o600});
const {start}=require('../pilot/server.cjs');
const Feed=require('../pilot/data-source.js'),Ledger=require('../ledger-data.js');
(async()=>{
 let server;
 try{
  server=await start(0);
  const origin='http://127.0.0.1:'+server.address().port,
   auth='Basic '+Buffer.from('pilot:'+password).toString('base64');
  const request=async(route,body)=>{
   const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',
    headers:{Authorization:auth,'X-Pilot-Action':'1','Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,data:await response.json()};
  };
  const before=await request('/api/ledger');
  const saved=await request('/api/ledger/category',{
   transactionId:'coffee-1',category:'Dining',remember:true});
  assert.equal(saved.status,200,JSON.stringify(saved));
  assert.equal(saved.data.learningMode,'auto');
  const after=(await request('/api/ledger')).data;
  assert.deepEqual(after.transactions,before.data.transactions,
   'Bank-reported transactions are immutable');
  assert.deepEqual(after.accounts,before.data.accounts,'Bank balances remain unchanged');
  assert.deepEqual(after.adjustments.predictions,before.data.adjustments.predictions,
   'A category edit cannot update forecast preferences');
  assert.equal(after.adjustments.categoryOverrides['coffee-1'],'Dining');
  const rules=after.adjustments.learning.categoryRules,
   [ruleKey]=Object.keys(rules);
  assert.equal(Object.keys(rules).length,1);
  assert.equal(rules[ruleKey].mode,'auto');
  const normalized=after.transactions.map(tx=>Feed.record(tx,after.accounts[0]));
  const model=Ledger.migrate({accounts:after.accounts,transactions:normalized,
   categoryOverrides:after.adjustments.categoryOverrides,learning:after.adjustments.learning,
   predictions:after.adjustments.predictions});
  assert.equal(Ledger.categoryFor(model,'coffee-2'),'Dining',
   'Future low-confidence purchases from the same merchant reuse saved corrections');
  assert.equal(Ledger.categoryFor(model,'coffee-3'),'Dining');

  const mixed=await request('/api/ledger/category',{
   transactionId:'amazon-1',category:'Groceries',remember:true});
  assert.equal(mixed.status,200);
  assert.equal(mixed.data.learningMode,'suggest',
   'Multi-purpose merchants never receive an automatic global category');
  const changed=(await request('/api/ledger')).data;
  const amazonKey=Object.keys(changed.adjustments.learning.categoryRules).find(k=>k!==ruleKey);
  assert.ok(amazonKey,'Mixed-use merchant decision stored as review-first suggestion');
  const m=Ledger.migrate({accounts:changed.accounts,
   transactions:changed.transactions.map(tx=>Feed.record(tx,changed.accounts[0])),
   categoryOverrides:changed.adjustments.categoryOverrides,
   learning:changed.adjustments.learning,predictions:changed.adjustments.predictions});
  assert.equal(Ledger.categoryFor(m,'amazon-2'),'Shopping',
   'A multi-purpose merchant correction must not override a specific bank category');
  assert.ok(Ledger.categoryReviewQueue(m).transactions.some(t=>
   t.id==='amazon-2'&&t.suggested==='Groceries'),'Uncertain suggestions are reviewable');

  const forged=await request('/api/ledger/category',{
   transactionId:'coffee-2',category:'Dining',remember:true,merchant:'Fake'});
  assert.equal(forged.status,400,'Never trust browser-provided merchant identity');
  const absent=await request('/api/ledger/category-rule',{ruleKey:'made-up-rule'});
  assert.equal(absent.status,404);
  const forgotten=await request('/api/ledger/category-rule',{ruleKey});
  assert.equal(forgotten.status,200);
  const final=(await request('/api/ledger')).data;
  assert.ok(!final.adjustments.learning.categoryRules[ruleKey],
   'Removing learned rule is persisted without removing manual correction');
  assert.equal(final.adjustments.categoryOverrides['coffee-1'],'Dining');
  assert.deepEqual(final.transactions,before.data.transactions);
  await new Promise(resolve=>server.close(resolve));server=null;
  server=await start(0);
  const restarted=await request('/api/ledger');
  assert.equal(restarted.status,200);
  assert.ok(!restarted.data.adjustments.learning.categoryRules[ruleKey]);
  assert.ok(restarted.data.adjustments.learning.categoryRules[amazonKey]);
  assert.equal(restarted.data.adjustments.categoryOverrides['coffee-1'],'Dining');
  console.log('PASS atomic merchant learning, multi-purpose review, read-only bank data, forget rule and restart persistence');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(err=>{console.error(err);process.exitCode=1});
