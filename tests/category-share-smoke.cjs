'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),
 fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-share-'));
const port=19963,secret=crypto.randomBytes(32).toString('hex'),
 pass='fictional-'+crypto.randomBytes(24).toString('hex'),file=path.join(folder,'pilot.enc');
const key=crypto.createHash('sha256').update(secret).digest();
function seal(value){
 const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const data=Buffer.concat([c.update(Buffer.from(JSON.stringify(value))),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),
  data:data.toString('base64')});
}
function open(filename){
 const b=JSON.parse(fs.readFileSync(filename,'utf8')),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(b.iv,'base64'));
 d.setAuthTag(Buffer.from(b.tag,'base64'));
 return JSON.parse(Buffer.concat([d.update(Buffer.from(b.data,'base64')),d.final()]).toString());
}
const tx={id:'fictional-purchase',accountId:'fake-checking',itemId:'fake-item',
 date:'2026-11-10',name:'Fictional marketplace',merchant:'Fictional marketplace',
 amount:42.25,pending:false,category:null};
const fixture={items:[{id:'fake-item',token:'dummy-token-not-connected',cursor:null,accountIds:['fake-checking']}],
 accounts:[{id:'fake-checking',itemId:'fake-item',name:'Fictional Checking',
  type:'depository',subtype:'checking',current:100,available:100}],
 transactions:{[tx.id]:tx},lastSync:'2026-11-10T11:00:00Z',
 ledgerAdjustments:{predictions:{
  transactionNotes:{['bank:'+JSON.stringify(['fake-checking','fictional-purchase'])]:'Amazon: Fictional water bottle'},
  futureRecurringRules:[{id:'future-1',merchant:'Fictional recurring bill',
   accountId:'fake-checking',type:'expense',frequency:'monthly',
   anchorDate:'2026-11-01',amount:13,category:'Uncategorized'}]
 }}};
fs.writeFileSync(file,seal(fixture),{mode:0o600});
const env={...process.env,PORT:String(port),PILOT_PASSWORD:pass,PILOT_ENCRYPTION_KEY:secret,
 PLAID_CLIENT_ID:'fictional-client',PLAID_SECRET:'fictional-secret',
 PLAID_ENV:'sandbox',PILOT_STATE_PATH:file};
const req=(route,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
 const data=body===undefined?null:JSON.stringify(body);
 const request=http.request({hostname:'127.0.0.1',port,path:route,method,
  headers:{...headers,...(data?{'Content-Type':'application/json','X-Pilot-Action':'1'}:{})}},r=>{
  let result='';r.on('data',b=>result+=b);r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,
   data:()=>{try{return JSON.parse(result)}catch{return {}}},body:result}));
 });
 request.on('error',reject);request.end(data);
});
(async()=>{
 const child=spawn(process.execPath,['pilot/server.cjs'],{cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',x=>process.stderr.write(x));
 try{
  let ready=false;
  for(let n=0;n<150;n++){try{if((await req('/healthz')).status===200){ready=true;break}}catch{}
   await new Promise(r=>setTimeout(r,40))}
  assert.ok(ready,'Fictional private server must start');
  assert.equal((await req('/categorize')).status,200,'Shared landing page needs no household password');
  assert.equal((await req('/categorize/manage')).status,303,'Only owner may open link manager');
  assert.equal((await req('/api/share/categorize')).status,401,'Uncredentialed queue must be private');
  const login=await req('/auth/login','POST',{password:pass});
  assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'].find(x=>x.startsWith('__Host-ledger_session='));
  const owner={'Cookie':cookie};
  assert.equal((await req('/api/ledger/category-share','GET',undefined,owner)).data().active,false);
  const minted=await req('/api/ledger/category-share','POST',{action:'create'},owner);
  assert.equal(minted.status,200,'Owner can issue a private link');
  const token=minted.data().token;
  assert.match(token,/^[a-f0-9]{64}$/);
  const shared={'X-Ledger-Share':token};
  assert.equal((await req('/api/ledger','GET',undefined,shared)).status,401,
   'Scoped token must NEVER access the full banking endpoint');
  assert.equal((await req('/api/status','GET',undefined,shared)).status,401);
  const list=await req('/api/share/categorize','GET',undefined,shared);
  assert.equal(list.status,200,'Shared link can read only category questions');
  const initial=list.data();
  assert.ok(initial.items.some(x=>x.id==='fictional-purchase'&&x.kind==='transaction'));
  assert.ok(initial.items.some(x=>x.id==='future-1'&&x.kind==='schedule'));
  assert.equal(initial.items.find(x=>x.id==='fictional-purchase').note,'Amazon: Fictional water bottle');
  assert.equal(list.body.includes('Fictional Checking'),false,'Account names must not be disclosed');
  assert.equal(list.body.includes('dummy-token-not-connected'),false,'Plaid tokens must not be disclosed');
  assert.equal(list.body.includes('available'),false,'Bank balances are never shared');
  assert.ok(initial.categories.includes('Groceries'));
  assert.equal((await req('/api/share/categorize','POST',{
   kind:'transaction',id:'fictional-purchase',category:'Groceries'},shared)).status,409,
   'A category save requires the current private revision');
  assert.equal((await req('/api/share/categorize','POST',{
   kind:'transaction',id:'fictional-purchase',category:'NotARealCategory'},
   {...shared,'X-Ledger-Revision':initial.revision})).status,409,
   'Custom category text is not accepted');
  const save=await req('/api/share/categorize','POST',{
   kind:'transaction',id:'fictional-purchase',category:'Groceries'},
   {...shared,'X-Ledger-Revision':initial.revision});
  assert.equal(save.status,200,'A one-tap category assignment persists');
  const after=await req('/api/share/categorize','GET',undefined,shared);
  assert.ok(!after.data().items.some(x=>x.id==='fictional-purchase'),'Saved transaction leaves the queue');
  assert.equal(open(file).transactions[tx.id].amount,42.25,'Bank source amount is immutable');
  assert.equal(open(file).ledgerAdjustments.categoryOverrides[tx.id],'Groceries');
  const bill=await req('/api/share/categorize','POST',{
   kind:'schedule',id:'future-1',category:'Insurance'},
   {...shared,'X-Ledger-Revision':after.data().revision});
  assert.equal(bill.status,200,'Upcoming payment categories save to authoritative forecast preferences');
  assert.equal(open(file+'.forecasts').futureRecurringRules[0].categoryReviewed,true);
  assert.equal((await req('/api/share/categorize','GET',undefined,shared)).data().items.length,0);
  const replacement=await req('/api/ledger/category-share','POST',{action:'create'},owner);
  assert.equal(replacement.status,200);
  assert.equal((await req('/api/share/categorize','GET',undefined,shared)).status,401,
   'Creating a new link invalidates the old link');
  const newer={'X-Ledger-Share':replacement.data().token};
  assert.equal((await req('/api/share/categorize','GET',undefined,newer)).status,200);
  assert.equal((await req('/api/ledger/category-share','POST',{action:'revoke'},owner)).status,200);
  assert.equal((await req('/api/share/categorize','GET',undefined,newer)).status,401,
   'Revocation cuts off the shared access');
  console.log('PASS private spouse categorization: scope, save, forecast, consent and revocation');
 }finally{child.kill('SIGTERM');fs.rmSync(folder,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
