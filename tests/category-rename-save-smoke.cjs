'use strict';
// Fictional connected-bank fixture: category renames must update the complete
// encrypted private preference state without editing bank facts.
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-rename-category-'));
const file=path.join(dir,'bank.enc'),password='fictional-rename-category-password';
const secret='isolated-fake-rename-category-key';
Object.assign(process.env,{PILOT_PASSWORD:password,PILOT_ENCRYPTION_KEY:secret,
 PLAID_CLIENT_ID:'fake',PLAID_SECRET:'fake',PLAID_ENV:'sandbox',PILOT_STATE_PATH:file});
const key=crypto.createHash('sha256').update(secret).digest();
function encode(data){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),
  bytes=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data))),cipher.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
  data:bytes.toString('base64')});
}
const transactions={
 one:{id:'one',accountId:'checking',date:'2026-10-08',merchant:'Fictional Utility',
  amount:58,pending:false,category:{primary:'GENERAL_MERCHANDISE',
   detailed:'GENERAL_MERCHANDISE_OTHER',confidence_level:'LOW'}},
 two:{id:'two',accountId:'checking',date:'2026-10-09',merchant:'Fictional Market',
  amount:24,pending:false,category:{primary:'GENERAL_MERCHANDISE',
   detailed:'GENERAL_MERCHANDISE_OTHER',confidence_level:'LOW'}}
};
const initial={items:[{id:'fake-item',token:'fictional-token',accountIds:['checking']}],
 accounts:[{id:'checking',name:'Fictional Checking',type:'depository',
  subtype:'checking',current:8000,available:8000}],
 transactions,ledgerAdjustments:{
 categoryOverrides:{one:'Subscriptions'},
 learning:{categoryRules:{remembered:{category:'Subscriptions',mode:'auto'}},ruleHistory:[]},
 predictions:{categoryMonthlyBudgets:{Subscriptions:200},
  categoryDisplayOrder:['Subscriptions','Groceries'],
  futureRecurringRules:[{id:'bill',accountId:'checking',type:'expense',
   merchant:'Fictional Subscription',frequency:'monthly',anchorDate:'2026-11-08',
   amount:50,category:'Subscriptions',categoryReviewed:true}],
  futureTransactionAdds:[{id:'oneoff',merchant:'Fictional Package',
   date:'2026-11-10',accountId:'checking',amount:15,type:'expense',category:'Subscriptions'}],
  cashCushion:700}
 }};
fs.writeFileSync(file,encode(initial),{mode:0o600});
const {start}=require('../pilot/server.cjs');
const Model=require('../ledger-data.js'),Feed=require('../pilot/data-source.js');
(async()=>{
 let server,origin;
 try{
  server=await start(0);origin='http://127.0.0.1:'+server.address().port;
  const auth='Basic '+Buffer.from('pilot:'+password).toString('base64');
  const call=async(route,body)=>{
   const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',
    headers:{Authorization:auth,'X-Pilot-Action':'1','Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,value:await response.json()};
  };
  const before=(await call('/api/ledger')).value;
  let invalid=await call('/api/ledger/categories/rename',
   {from:'Subscriptions',to:'Media',transactions:{one:'Media'}});
  assert.equal(invalid.status,400,'Client cannot supply bank-source classifications');
  invalid=await call('/api/ledger/categories/rename',
   {from:'Subscriptions',to:'Groceries'});
  assert.equal(invalid.status,400,'Collision must not overwrite an existing category');
  const result=await call('/api/ledger/categories/rename',
   {from:'Subscriptions',to:'Digital Services'});
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.value.scope,'category-rename');
  const after=(await call('/api/ledger')).value;
  assert.deepEqual(after.transactions,before.transactions,'Bank source facts untouched');
  assert.deepEqual(after.accounts,before.accounts,'Bank accounts and balances untouched');
  assert.equal(after.adjustments.categoryOverrides.one,'Digital Services');
  const p=after.adjustments.predictions;
  assert.equal(p.categoryMonthlyBudgets['Digital Services'],200);
  assert.equal(p.categoryMonthlyBudgets.Subscriptions,undefined);
  assert.deepEqual(p.categoryDisplayOrder,['Digital Services','Groceries']);
  assert.equal(p.futureRecurringRules[0].category,'Digital Services');
  assert.equal(p.futureRecurringRules[0].amount,50);
  assert.equal(p.futureRecurringRules[0].categoryReviewed,true);
  assert.equal(p.futureTransactionAdds[0].category,'Digital Services');
  assert.equal(after.adjustments.learning.categoryRules.remembered.category,'Digital Services');
  const reload=Model.migrate({transactions:after.transactions.map(tx=>
   Feed.record(tx,after.accounts[0])),predictions:p,
   categoryOverrides:after.adjustments.categoryOverrides,
   learning:after.adjustments.learning});
  assert.ok(!Model.categories(reload).includes('Subscriptions'));
  assert.equal(Model.categoryFor(reload,'one'),'Digital Services');
  await new Promise(done=>server.close(done));server=null;
  server=await start(0);origin='http://127.0.0.1:'+server.address().port;
  const persisted=(await call('/api/ledger')).value;
  assert.equal(persisted.adjustments.categoryOverrides.one,'Digital Services');
  assert.equal(persisted.adjustments.predictions.categoryMonthlyBudgets['Digital Services'],200);
  assert.deepEqual(persisted.transactions,before.transactions);
  console.log('PASS atomic category rename, private encrypted restart, budgets, rules, source immutability');
 }finally{
  if(server)await new Promise(done=>server.close(done));
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
