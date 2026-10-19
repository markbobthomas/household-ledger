'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-hosted-'));
const port=19667;
const password='smoke-test-password-very-long';
const env={...process.env,HOSTED_SANDBOX:'1',SANDBOX_TEST_PASSWORD:password,
 SANDBOX_FIXTURE_STATE_PATH:path.join(dir,'fixture.json'),PORT:String(port)};
let child;
function request(route,method='GET',input,auth=true){
 return new Promise((resolve,reject)=>{
  const body=input===undefined?null:JSON.stringify(input);
  const headers=auth?{authorization:'Basic '+Buffer.from('tester:'+password).toString('base64')}:{};
  if(body){headers['content-type']='application/json';headers['x-household-sandbox']='1'}
  const q=http.request({host:'127.0.0.1',port,path:route,method,headers},res=>{
   const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{
    const raw=Buffer.concat(chunks).toString('utf8');
    let json;try{json=JSON.parse(raw)}catch{}
    resolve({status:res.statusCode,body:raw,json});
   });
  });q.on('error',reject);q.end(body);
 });
}
async function start(){
 child=spawn(process.execPath,['sandbox/server.cjs'],{env,stdio:'ignore'});
 for(let i=0;i<80;i++){
  if(child.exitCode!==null)throw Error('Server exited');
  try{const r=await request('/api/sandbox/status');if(r.status===200)return}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 throw Error('Server did not start');
}
async function stop(){
 if(!child)return;
 const p=child;child=null;p.kill('SIGTERM');
 await new Promise(resolve=>{if(p.exitCode!==null)return resolve();p.once('exit',resolve)});
}
(async()=>{
 try{
  await start();
  assert.equal((await request('/', 'GET',undefined,false)).status,401);
  assert.equal((await request('/api/sandbox/snapshot','GET',undefined,false)).status,401);
  const home=await request('/');
  assert.equal(home.status,200);
  assert.match(home.body,/household-sandbox-hosted/);
  assert.equal((await request('/api/sandbox/status')).json.mode,'fixture');
  const connected=await request('/api/sandbox/connect','POST',{institutionId:'ins_109508',profile:'standard'});
  assert.equal(connected.status,200);
  assert.equal((await request('/api/sandbox/status')).json.items.length,1);
  const firstId=connected.json.itemId;
  const refresh=await request('/api/sandbox/refresh','POST',{itemId:firstId});
  assert.equal(refresh.status,200);
  await request('/api/sandbox/sync','POST',{itemId:firstId});
  const before=await request('/api/sandbox/snapshot');
  assert.ok(before.json.items[0].transactions.some(t=>t.transaction_id.endsWith('-posted')));
  await stop();await start();
  const after=await request('/api/sandbox/snapshot');
  assert.equal(after.status,200);
  assert.equal(after.json.items[0].itemId,firstId);
  assert.ok(after.json.items[0].transactions.some(t=>t.transaction_id.endsWith('-posted')));
  console.log('Hosted Sandbox authentication and fixture persistence passed');
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
