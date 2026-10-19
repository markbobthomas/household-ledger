'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
(async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'hl-plaid-flow-')),port=19849,pass=crypto.randomBytes(24).toString('hex'),store=path.join(folder,'pilot.enc');
 const env={...process.env,LIVE_PLAID_ENABLED:'1',HOSTED_SANDBOX:'1',PORT:String(port),PILOT_PASSWORD:pass,PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'test',PLAID_SECRET:'test',PLAID_ENV:'sandbox',PILOT_STATE_PATH:store,SANDBOX_TEST_PASSWORD:pass};
 const child=spawn(process.execPath,['--require','./tests/pilot-plaid-stub.cjs','sandbox/server.cjs'],{cwd:path.resolve(__dirname,'..'),env,stdio:'ignore'});
 const request=(route,body)=>{
  return new Promise((resolve,reject)=>{
   const b=body===undefined?null:JSON.stringify(body);
   const r=http.request({hostname:'127.0.0.1',port,path:route,method:b?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from('pilot:'+pass).toString('base64'),...(b?{'Content-Type':'application/json','X-Pilot-Action':'1'}:{})}},res=>{
    let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({code:res.statusCode,data:JSON.parse(raw)}))});
   r.on('error',reject);r.end(b);
  });
 };
 try{
  for(let i=0;i<100;i++){try{const r=await request('/api/status');if(r.code===200)break}catch{}await new Promise(r=>setTimeout(r,50))}
  let before=await request('/api/status');assert.equal(before.data.connected,false);
  let token=await request('/api/link-token',{});assert.equal(token.data.link_token,'link-test');
  let connected=await request('/api/exchange',{publicToken:'public-test',accountId:'acct-1'});assert.equal(connected.data.connected,true);
  let status=await request('/api/status');assert.equal(status.data.account.current,321.45,'Exact bank current balance');assert.equal(status.data.account.available,300.10,'Separate available');
  assert.equal(status.data.transactions.length,1);assert.equal(status.data.transactions[0].pending,true);
  assert.equal(JSON.stringify(status.data).includes('acct-2'),false,'Only selected account exposed');
  assert.equal(fs.readFileSync(store,'utf8').includes('secret-test-access-token'),false,'Plaid access token encrypted on disk');
  await request('/api/sync',{});
  status=await request('/api/status');
  assert.equal(status.data.transactions.length,1,'Pending charge replaced rather than duplicated');
  assert.equal(status.data.transactions[0].pending,false);
  assert.equal(status.data.account.current,321.45,'Transactions never mutate bank-reported balances');
  await request('/api/disconnect',{});
  status=await request('/api/status');assert.equal(status.data.connected,false);assert.equal(status.data.transactions.length,0);
  console.log('PASS Plaid Link exchange, one selected account, exact reported bank balances, encrypted token, pending-posted sync and disconnect');
 }finally{child.kill();fs.rmSync(folder,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
