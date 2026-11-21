'use strict';
// Offline fictional-data exercise of a portable encrypted recovery archive,
// authenticated export, tamper protection, independent key and isolated restore.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),
 fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 http=require('node:http'),{spawn,spawnSync}=require('node:child_process');
const Backup=require('../pilot/portable-backup.cjs');
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-backup-fixture-'));
const source=path.join(temp,'private.enc'),port=19867;
const oldKey='FICTIONAL ORIGINAL KEY FOR PORTABLE EXPORT ONLY 2026',
 newKey='FICTIONAL RESTORE KEY NOT HELD BY ORIGINAL INSTANCE 2026',
 pass='five fictional unrelated recovery words private example';
const login='Fictional private Ledger password for smoke testing';
function seal(value,secret){
 const key=crypto.createHash('sha256').update(secret).digest(),iv=crypto.randomBytes(12),
  c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const ciphertext=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),
  data:ciphertext.toString('base64')});
}
function unseal(file,secret){
 const e=JSON.parse(fs.readFileSync(file,'utf8')),key=crypto.createHash('sha256').update(secret).digest(),
  c=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));
 c.setAuthTag(Buffer.from(e.tag,'base64'));
 return JSON.parse(Buffer.concat([
  c.update(Buffer.from(e.data,'base64')),c.final()
 ]).toString());
}
const bank={
 items:[{id:'fictional-item',token:'fictional-token-from-provider',cursor:'fictional-cursor',
  accountIds:['fictional-checking']}],
 accounts:[{id:'fictional-checking',type:'depository',subtype:'checking',
  name:'Fictional Checking',current:7700,available:7650}],
 transactions:{
  'fictional-income':{id:'fictional-income',accountId:'fictional-checking',itemId:'fictional-item',
   amount:-2800,date:'2026-11-03',merchant:'Fictional Employer',pending:false},
  'fictional-bill':{id:'fictional-bill',accountId:'fictional-checking',itemId:'fictional-item',
   amount:140,date:'2026-11-04',merchant:'Fictional Bills',pending:false}},
 lastSync:'2026-11-17T01:00:00.000Z',error:null,
 ledgerAdjustments:{categoryOverrides:{'fictional-bill':'Utilities'},
  predictions:{cashCushion:4700},customCategories:[]}
};
const forecasts={cashCushion:6800,transactionNotes:{'fictional-bill':'Keep note'},
 futureRecurringRules:[{id:'fictional-rule',accountId:'fictional-checking',merchant:'Fictional Bills',
  amount:140,frequency:'monthly'}]};
const sessions={version:1,sessions:[]};
const analysis={version:1,autoEnabled:true,revision:'fictional-revision',
 completedAt:'2026-11-17T02:00:00.000Z',
 report:{mode:'autonomous-adaptive',blocks:[{kind:'hero',title:'Budget observation',
  text:'Fictional summary'}]}};
function submit(route,body,options={}){
 return new Promise((resolve,reject)=>{
  const payload=JSON.stringify(body);
  const headers={'Content-Type':'application/json',
   ...(options.action===false?{}:{'X-Pilot-Action':'1'}),
   ...(options.auth===false?{}:{Authorization:'Basic '+Buffer.from('pilot:'+login).toString('base64')}),
   ...(options.origin?{Origin:options.origin}:{})};
  const req=http.request({hostname:'127.0.0.1',port,path:route,method:'POST',headers},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
  });
  req.on('error',reject);req.end(payload);
 });
}
function get(route,authenticated=true){
 return new Promise((resolve,reject)=>{
  http.get({hostname:'127.0.0.1',port,path:route,
   headers:authenticated?{Authorization:'Basic '+Buffer.from('pilot:'+login).toString('base64')}:{}},res=>{
   const chunks=[];res.on('data',x=>chunks.push(x));
   res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));
  }).on('error',reject);
 });
}
(async()=>{
 let child;
 try{
  fs.writeFileSync(source,seal(bank,oldKey),{mode:0o600});
  fs.writeFileSync(source+'.forecasts',seal(forecasts,oldKey),{mode:0o600});
  fs.writeFileSync(source+'.sessions',seal(sessions,oldKey),{mode:0o600});
  fs.writeFileSync(source+'.analysis',seal(analysis,oldKey),{mode:0o600});
  const originalFiles=[source,source+'.forecasts',source+'.sessions',source+'.analysis'].map(f=>
   fs.readFileSync(f,'utf8'));
  const env={...process.env,PORT:String(port),PILOT_PASSWORD:login,
   PILOT_ENCRYPTION_KEY:oldKey,PILOT_STATE_PATH:source,
   PLAID_ENV:'sandbox',PLAID_CLIENT_ID:'fictional',PLAID_SECRET:'fictional'};
  child=spawn(process.execPath,['pilot/server.cjs'],{cwd:root,env,stdio:'ignore'});
  let ready=false;
  for(let i=0;i<120;i++){
   try{if((await get('/healthz',false)).status===200){ready=true;break}}catch{}
   await new Promise(resolve=>setTimeout(resolve,40));
  }
  assert.ok(ready,'Fictional private server booted');
  const bankPage=await get('/bank-connect');
  assert.equal(bankPage.status,200);
  assert.match(bankPage.body.toString(),/Download encrypted backup/);
  assert.equal((await submit('/api/backup/export',{passphrase:pass},{auth:false})).status,401,
   'Anonymous requests can never export even an encrypted bank file');
  assert.equal((await submit('/api/backup/export',{passphrase:pass},{action:false})).status,403,
   'Export needs the non-simple action header');
  assert.equal((await submit('/api/backup/export',{passphrase:pass},
   {origin:'https://evil.example'})).status,403,'Cross-origin export is refused');
  assert.equal((await submit('/api/backup/export',{passphrase:'short'})).status,400);
  assert.equal((await get('/api/backup/export')).status,404,'No GET backup endpoint exists');
  const downloaded=await submit('/api/backup/export',{passphrase:pass});
  assert.equal(downloaded.status,200);
  assert.equal(downloaded.headers['content-type'],'application/octet-stream');
  assert.match(downloaded.headers['content-disposition'],/attachment.*ledger-private-/);
  assert.match(downloaded.headers['cache-control'],/no-store/);
  const archive=downloaded.body;
  assert.ok(archive.length>200);
  assert.equal(archive.includes(Buffer.from('fictional-token-from-provider')),false,
   'No source Plaid token appears in portable archive');
  assert.equal(archive.includes(Buffer.from('Fictional Employer')),false,
   'No original payee appears in portable archive');
  const restored=await Backup.open(archive,pass);
  assert.deepEqual(restored.bank,bank,'All accounts and exact source facts are retained');
  assert.deepEqual(restored.forecasts,forecasts,'Independent forecast file is retained');
  assert.deepEqual(restored.sessions,sessions,'Independent session file is retained');
  assert.deepEqual(restored.analysis,analysis,'Ongoing analysis consent and encrypted report retained');
  for(const [i,f] of [source,source+'.forecasts',source+'.sessions',source+'.analysis'].entries())
   assert.equal(fs.readFileSync(f,'utf8'),originalFiles[i],
    'Making the backup does not change any original encrypted file');
  await assert.rejects(Backup.open(archive,'incorrect long phrase for this encrypted archive'),
   'Wrong recovery passphrase fails closed');
  const poisoned=JSON.parse(archive.toString('utf8'));
  poisoned.data=(poisoned.data[0]==='A'?'B':'A')+poisoned.data.slice(1);
  await assert.rejects(Backup.open(Buffer.from(JSON.stringify(poisoned)),pass),
   'Tampering fails AES-GCM authentication');
  const isolated=path.join(temp,'isolated-restore');
  const result=await Backup.restore({bundle:archive,passphrase:pass,
   destination:isolated,secret:newKey});
  assert.deepEqual(result,{verified:true,hasBank:true,hasForecasts:true,hasSessions:true,hasAnalysis:true});
  for(const [name,document] of [
   ['pilot.enc',bank],['pilot.enc.forecasts',forecasts],['pilot.enc.sessions',sessions],
   ['pilot.enc.analysis',analysis]]){
   const file=path.join(isolated,name);
   assert.deepEqual(unseal(file,newKey),document,'Verified isolated '+name+' with NEW encryption key');
   assert.equal(fs.statSync(file).mode&0o077,0,'Only owner may read restored '+name);
  }
  assert.throws(()=>unseal(path.join(isolated,'pilot.enc'),oldKey),
   'The original Render encryption key is not required to restore');
  const sentinel=path.join(temp,'must-not-overwrite');
  fs.mkdirSync(sentinel);fs.writeFileSync(path.join(sentinel,'untouched.txt'),'keep');
  await assert.rejects(Backup.restore({bundle:archive,passphrase:pass,
   destination:sentinel,secret:newKey}));
  assert.equal(fs.readFileSync(path.join(sentinel,'untouched.txt'),'utf8'),'keep',
   'Recovery never overwrites an existing directory or file');
  const filename=path.join(temp,'separate-offline-copy.ledgerbackup');
  fs.writeFileSync(filename,archive,{mode:0o600});
  const verify=spawnSync(process.execPath,['pilot/recovery-cli.cjs','verify',filename],
   {cwd:root,env:{...process.env,LEDGER_BACKUP_PASSPHRASE:pass},encoding:'utf8'});
  assert.equal(verify.status,0,'Offline verifier can read the backup without Render key: '+verify.stderr);
  assert.ok(!verify.stdout.includes('fictional-token'));
  const cliDest=path.join(temp,'another-isolated-restore');
  const cli=spawnSync(process.execPath,['pilot/recovery-cli.cjs','restore',filename,cliDest],
   {cwd:root,env:{...process.env,LEDGER_BACKUP_PASSPHRASE:pass,
    PILOT_ENCRYPTION_KEY:'another fictional deployment key'},encoding:'utf8'});
  assert.equal(cli.status,0,'Standalone isolated restore command works: '+cli.stderr);
  assert.deepEqual(unseal(path.join(cliDest,'pilot.enc'),'another fictional deployment key'),bank);
  console.log('PASS portable Ledger recovery: authenticated private download, consistent 4-file snapshot, independent passphrase, tamper rejection, 0600 isolated restore with NEW key, immutable live files');
 }finally{
  if(child){
   child.kill('SIGTERM');
   await new Promise(resolve=>{if(child.exitCode!==null)return resolve();
    child.once('exit',resolve);
   });
  }
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
