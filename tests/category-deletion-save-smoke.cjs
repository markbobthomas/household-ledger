'use strict';
// Fictional private-Plaid fixture. Deleted category must be saved server-side,
// together with bank category overlays and an encrypted forecast sidecar.
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-delete-category-'));
const file=path.join(dir,'bank.enc'),password='fictional-category-delete-password';
const secret='isolated-fake-delete-category-key';
Object.assign(process.env,{PILOT_PASSWORD:password,PILOT_ENCRYPTION_KEY:secret,
 PLAID_CLIENT_ID:'fake',PLAID_SECRET:'fake',PLAID_ENV:'sandbox',PILOT_STATE_PATH:file});
const key=crypto.createHash('sha256').update(secret).digest();
const encode=data=>{
 const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),
  encrypted=Buffer.concat([c.update(Buffer.from(JSON.stringify(data))),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),
  data:encrypted.toString('base64')});
};
const row=(id,merchant,date)=>({id,accountId:'checking',date,merchant,name:merchant,
 amount:35,pending:false,category:{primary:'GENERAL_MERCHANDISE',
 detailed:'GENERAL_MERCHANDISE_OTHER',confidence_level:'LOW'}});
const transactions={
 one:row('one','Fictional Utility','2026-10-04'),
 two:row('two','Fictional Market','2026-10-05')
};
const initial={items:[{id:'fake-item',token:'fictional-token',accountIds:['checking']}],
 accounts:[{id:'checking',name:'Fictional Checking',type:'depository',
  subtype:'checking',current:8000,available:8000}],
 transactions,ledgerAdjustments:{
 categoryOverrides:{one:'Subscriptions'},learning:{categoryRules:{},ruleHistory:[]},
 predictions:{futureRecurringRules:[{id:'bill',accountId:'checking',type:'expense',
  merchant:'Fictional Utility',frequency:'monthly',anchorDate:'2026-11-04',
  amount:50,category:'Subscriptions',categoryReviewed:true}],
  futureTransactionAdds:[{id:'oneoff',merchant:'Fictional Gift',
   date:'2026-11-06',accountId:'checking',amount:15,type:'expense',category:'Subscriptions'}],
  categoryMonthlyBudgets:{Subscriptions:200},cashCushion:700}
 }};
fs.writeFileSync(file,encode(initial),{mode:0o600});
const {start}=require('../pilot/server.cjs');
const Model=require('../ledger-data.js'),Feed=require('../pilot/data-source.js');
(async()=>{
 let server,origin;
 try{
  server=await start(0);
  origin='http://127.0.0.1:'+server.address().port;
  const auth='Basic '+Buffer.from('pilot:'+password).toString('base64');
  const call=async(route,body)=>{
   const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',
    headers:{Authorization:auth,'X-Pilot-Action':'1','Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,value:await response.json()};
  };
  const before=(await call('/api/ledger')).value;
  const invalid=await call('/api/ledger/categories/delete',
   {category:'Subscriptions',transactions:{one:'Uncategorized'}});
  assert.equal(invalid.status,400,'Browser-supplied bank facts must be rejected');
  const result=await call('/api/ledger/categories/delete',{category:'Subscriptions'});
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.value.scope,'category-deletion');
  const after=(await call('/api/ledger')).value;
  assert.deepEqual(after.transactions,before.transactions,'Plaid bank facts untouched');
  assert.deepEqual(after.accounts,before.accounts,'Account balances untouched');
  assert.deepEqual(after.adjustments.categoryOverrides,{one:'Uncategorized'},
   'Existing classified transaction becomes Unassigned');
  const prefs=after.adjustments.predictions;
  assert.ok(prefs.deletedCategories.includes('Subscriptions'));
  assert.equal(prefs.futureRecurringRules[0].category,'Uncategorized');
  assert.equal(prefs.futureRecurringRules[0].categoryReviewed,false);
  assert.equal(prefs.futureRecurringRules[0].amount,50);
  assert.equal(prefs.futureRecurringRules[0].anchorDate,'2026-11-04');
  assert.equal(prefs.futureTransactionAdds[0].category,'Uncategorized');
  assert.equal(prefs.categoryMonthlyBudgets.Subscriptions,undefined);
  const reloaded=Model.migrate({
   transactions:after.transactions.map(tx=>Feed.record(tx,after.accounts[0])),
   predictions:prefs,categoryOverrides:after.adjustments.categoryOverrides,
   learning:after.adjustments.learning
  });
  assert.ok(!Model.categories(reloaded).includes('Subscriptions'));
  assert.equal(Model.categoryFor(reloaded,'one'),'Uncategorized');
  assert.ok(Model.categoryReviewQueue(reloaded).transactions.some(t=>t.id==='one'));
  assert.ok(Model.categoryReviewQueue(reloaded).plans.some(p=>p.id==='bill'));
  await new Promise(done=>server.close(done));server=null;
  server=await start(0);origin='http://127.0.0.1:'+server.address().port;
  const persisted=(await call('/api/ledger')).value;
  assert.ok(persisted.adjustments.predictions.deletedCategories.includes('Subscriptions'));
  assert.equal(persisted.adjustments.categoryOverrides.one,'Uncategorized');
  assert.deepEqual(persisted.transactions,before.transactions);
  console.log('PASS private deletion endpoint, encrypted restart, in-use bills and bank facts unchanged');
 }finally{
  if(server)await new Promise(done=>server.close(done));
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
