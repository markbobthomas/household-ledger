'use strict';
const assert=require('node:assert/strict');
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),
 os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-category-ai-'));
const file=path.join(root,'pilot.enc'),port=19879;
const secret=crypto.randomBytes(32).toString('hex'),
 pass='fictional-'+crypto.randomBytes(24).toString('hex'),
 key=crypto.createHash('sha256').update(secret).digest();
const seal=value=>{
 const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),
 data=Buffer.concat([c.update(Buffer.from(JSON.stringify(value))),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),
  data:data.toString('base64')});
};
const read=()=>{const b=JSON.parse(fs.readFileSync(file,'utf8')),
 d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(b.iv,'base64'));
 d.setAuthTag(Buffer.from(b.tag,'base64'));
 return JSON.parse(Buffer.concat([d.update(Buffer.from(b.data,'base64')),d.final()]).toString())};
const tx=(id,merchant,category)=>({id,accountId:'fictional-checking',date:'2026-11-22',
 name:merchant,merchant,amount:21.50,pending:false,
 personal_finance_category:category?{primary:'FOOD_AND_DRINK',
  detailed:'FOOD_AND_DRINK_GROCERIES',confidence_level:'HIGH'}:null});
const ordinary=tx('fictional-provider','Fictional Grocer',true),
 manually=tx('fictional-manual','Fictional Retail',true),
 unknown=tx('fictional-unknown','Amazon Marketplace',false);
const aiKey='bank:'+JSON.stringify(['fictional-checking',unknown.id]);
const fixture={items:[{id:'fictional-item',token:'placeholder-token',accountIds:['fictional-checking']}],
 accounts:[{id:'fictional-checking',name:'Fictional checking',itemId:'fictional-item',
  type:'depository',subtype:'checking',current:100,available:100}],
 transactions:{[ordinary.id]:ordinary,[manually.id]:manually,[unknown.id]:unknown},
 ledgerAdjustments:{categoryAutomation:{automatic:false,ai:false},
  predictions:{},categoryOverrides:{[manually.id]:'Shopping'},
  categoryProvenance:{[manually.id]:{source:'manual',category:'Shopping'}},
  categoryAiChecks:{[aiKey]:{status:'unable',checkedAt:'2026-11-27T09:00:00Z'}}}};
fs.writeFileSync(file,seal(fixture));
const request=(route,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
 const raw=body===undefined?null:JSON.stringify(body);
 const r=http.request({hostname:'127.0.0.1',port,path:route,method,
  headers:{...headers,...(raw?{'Content-Type':'application/json','X-Pilot-Action':'1'}:{})}},res=>{
  let output='';res.on('data',part=>output+=part);
  res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,
   data:()=>{try{return JSON.parse(output)}catch{return {}}},raw:output}));
 });
 r.on('error',reject);r.end(raw);
});
const env={...process.env,PORT:String(port),PILOT_PASSWORD:pass,PILOT_ENCRYPTION_KEY:secret,
 PLAID_CLIENT_ID:'fictional-client',PLAID_SECRET:'fictional-secret',PLAID_ENV:'sandbox',
 PILOT_STATE_PATH:file,OPENAI_API_KEY:'fictional-never-call-provider'};
(async()=>{
 const child=spawn(process.execPath,['pilot/server.cjs'],{cwd:path.resolve(__dirname,'..'),
  env,stdio:['ignore','ignore','pipe']});child.stderr.on('data',b=>process.stderr.write(b));
 try{
  let ready=false;
  for(let i=0;i<160;i++){try{ready=(await request('/healthz')).status===200;if(ready)break}catch{}
   await new Promise(r=>setTimeout(r,35))}
  assert.ok(ready,'Fictional server started');
  assert.equal((await request('/api/ledger/category-automation')).status,401,
   'Settings must not be available through an unauthenticated request');
  const login=await request('/auth/login','POST',{password:pass});
  assert.equal(login.status,200);
  const session=login.headers['set-cookie'].find(s=>s.startsWith('__Host-ledger_session='));
  const owner={Cookie:session};
  let config=(await request('/api/ledger/category-automation','GET',undefined,owner)).data();
  assert.equal(config.automatic,false);assert.equal(config.ai,false);
  const off=(await request('/api/ledger/category-automation/plan','GET',undefined,owner)).data();
  assert.equal(off.enabled,false);assert.equal(off.count,0);
  assert.equal((await request('/api/ledger/category-automation/run','POST',{
   planHash:'bad',approved:false,maximumUsd:0
  },owner)).status,409,'AI OFF is enforced on the server');
  let lite=(await request('/api/share/categorize','GET',undefined,owner)).data();
  const ids=new Set(lite.items.map(x=>x.id));
  assert(ids.has(ordinary.id),'Provider-categorized purchase enters Lite while rules are OFF');
  assert(ids.has(unknown.id),'Uncategorized marketplace enters Lite');
  assert(!ids.has(manually.id),'Human-confirmed choice never reenters Lite');
  const unidentifiable=lite.items.find(i=>i.id===unknown.id);
  assert(unidentifiable.notes.some(x=>x.text==='AI checked — unable to categorize'),
   'A completed AI abstention is visible to the family');
  const enabled=await request('/api/ledger/category-automation','POST',
   {action:'set',automatic:false,ai:true},owner);
  assert.equal(enabled.status,200);
  assert.equal(read().ledgerAdjustments.categoryAutomation.ai,true,'On/Off choice is encrypted and durable');
  const plan=(await request('/api/ledger/category-automation/plan','GET',undefined,owner)).data();
  assert.equal(plan.enabled,true);assert.equal(plan.count,1,
   'Previously examined unknown and human-confirmed purchases cannot be billed again');
  assert.ok(plan.maximumUsd>0&&plan.maximumUsd<=0.08);
  assert.equal((await request('/api/ledger/category-automation/run','POST',{
   planHash:'outdated',approved:true,maximumUsd:0
  },owner)).status,409,'A stale cost proposal is rejected before any paid API request');
  assert.equal((await request('/api/ledger/category-automation','POST',
   {action:'set',automatic:true,ai:false},owner)).status,200);
  assert.equal((await request('/api/ledger/category-automation/plan','GET',undefined,owner)).data().count,0);
  assert.deepEqual(read().transactions,fixture.transactions,'No Plaid transaction is ever rewritten');
  assert.equal((await request('/api/ledger/category-automation','GET',undefined,
   {'X-Ledger-Share':'f'.repeat(64)})).status,401,'Lite bearer cannot control paid AI');
  console.log('PASS private category controls: unauthenticated refusal, $0.08 plan, AI OFF, idempotent check, Lite full review, encrypted settings');
 }finally{
  child.kill('SIGTERM');
  try{fs.rmSync(root,{recursive:true,force:true})}catch{}
 }
})().catch(error=>{console.error(error);process.exitCode=1});
