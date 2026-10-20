'use strict';
/* Loopback-only Sandbox server. NEVER bind publicly or serve this as a cloud
 * production backend. No Plaid tokens ever reach the browser. */
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const HOSTED=process.env.HOSTED_SANDBOX==='1';
if(HOSTED&&(!process.env.SANDBOX_TEST_PASSWORD||process.env.SANDBOX_TEST_PASSWORD.length<16)) throw Error('Hosted Sandbox requires a password of at least 16 characters');
const STATE_PATH=process.env.SANDBOX_FIXTURE_STATE_PATH||'/var/data/sandbox-fixture.json';
const {createService,remoteTransport,PlaidError}=require('./plaid-service.cjs');
const {fixtureTransport}=require('./fixture.cjs');
const ROOT=path.resolve(__dirname,'..');
const ALLOWED_ROOT=/^(?:index\.html|modern\.css|planner\.css|(?:planner|demo-data|forecast|forecast-ledger|accounting|categorization|ledger-data|account-forecast|payment-obligations|planner-intelligence|planner-backtest|planner-transactions|planner-history|planner-recurrence|planner-core|bank-feed|feed-health|cashflow|recurring|reviews|accuracy-fixture|accuracy-fixture-holdout|accuracy-fixture-seasonal|accuracy-lab|stress-lab|readiness-lab)\.js)$/;
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
function createServer({service}={}){
 const api=service||createService({
  mode:!HOSTED&&process.env.PLAID_CLIENT_ID&&process.env.PLAID_SANDBOX_SECRET?'plaid':'fixture',
  request:!HOSTED&&process.env.PLAID_CLIENT_ID&&process.env.PLAID_SANDBOX_SECRET?
   remoteTransport({clientId:process.env.PLAID_CLIENT_ID,secret:process.env.PLAID_SANDBOX_SECRET}):
   fixtureTransport()
 });
 let fixtureConnections=[];
 async function persistFixture(){if(!HOSTED)return;await fs.mkdir(path.dirname(STATE_PATH),{recursive:true});const tmp=STATE_PATH+'.tmp';await fs.writeFile(tmp,JSON.stringify(fixtureConnections),{mode:0o600});await fs.rename(tmp,STATE_PATH)}
 async function restoreFixture(){if(!HOSTED)return;let records=[];try{records=JSON.parse(await fs.readFile(STATE_PATH,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}if(!Array.isArray(records))throw Error('Invalid fixture state');for(const item of records){if(!['ins_109508','ins_109509','ins_109510'].includes(item.institutionId))continue;await api.connectTest(item.institutionId,item.profile==='dynamic'?'dynamic':'standard');if(item.refreshed){const id=api.status().items.at(-1)?.itemId;if(id){await api.refresh(id);await api.sync(id)}}fixtureConnections.push({institutionId:item.institutionId,profile:item.profile||'standard',refreshed:Boolean(item.refreshed)})}}
 const server=http.createServer(async(req,res)=>{
  const send=(status,obj)=>{
   res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
   res.end(JSON.stringify(obj));
  };
  try{
   if(HOSTED&&req.method==='GET'&&req.url==='/healthz')return send(200,{status:'ok',service:'fictional-test-sandbox'});
   if(HOSTED){
    const provided=String(req.headers.authorization||'');
    const expected='Basic '+Buffer.from('tester:'+process.env.SANDBOX_TEST_PASSWORD).toString('base64');
    const a=Buffer.from(provided),b=Buffer.from(expected);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b)){
     res.writeHead(401,{'WWW-Authenticate':'Basic realm="Household Ledger Test Sandbox"','Cache-Control':'no-store'});res.end('Authentication required');return;
    }
   }
   const host=String(req.headers.host||'');
   const allowedHost=/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host);
   if(!HOSTED&&(!allowedHost||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)))
    return send(403,{error:'Loopback access only'});
   const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
   const origin=req.headers.origin;
   if(origin&&(HOSTED?new URL(origin).host!==host:!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin)))
    return send(403,{error:'Cross-origin requests refused'});
   if(pathname.startsWith('/api/sandbox/')){
    if(req.method==='GET'){
     if(pathname==='/api/sandbox/status')return send(200,api.status());
     if(pathname==='/api/sandbox/snapshot')return send(200,api.snapshot());
     return send(404,{error:'Unknown route'});
    }
    if(req.method!=='POST'||req.headers['x-household-sandbox']!=='1')
     return send(403,{error:'Same-origin Sandbox request header required'});
    let total=0,parts=[];
    for await(const chunk of req){
     total+=chunk.length;
     if(total>65536)return send(413,{error:'Request too large'});
     parts.push(chunk);
    }
    let input={};
    try{input=JSON.parse(Buffer.concat(parts).toString('utf8')||'{}')}catch{return send(400,{error:'Invalid JSON'})}
    if(!input||typeof input!=='object'||Array.isArray(input))return send(400,{error:'Expected object'});
    switch(pathname){
     case '/api/sandbox/connect':{const connected=await api.connectTest(input.institutionId,input.profile);if(HOSTED){fixtureConnections.push({institutionId:input.institutionId,profile:input.profile||'standard',refreshed:false});await persistFixture()}return send(200,connected)}
     case '/api/sandbox/link-token':return send(200,await api.createLinkToken());
     case '/api/sandbox/exchange':return send(200,await api.exchangePublicToken(input.publicToken,input.institutionId));
     case '/api/sandbox/sync':return send(200,await api.sync(input.itemId));
     case '/api/sandbox/refresh':{const result=await api.refresh(input.itemId);if(HOSTED){const position=api.status().items.findIndex(i=>i.itemId===input.itemId);if(position>=0&&fixtureConnections[position]){fixtureConnections[position].refreshed=true;await persistFixture()}}return send(200,result)}
     case '/api/sandbox/disconnect':{const position=api.status().items.findIndex(i=>i.itemId===input.itemId);const result=await api.disconnect(input.itemId);if(HOSTED&&position>=0){fixtureConnections.splice(position,1);await persistFixture()}return send(200,result)}
     default:return send(404,{error:'Unknown Sandbox route'});
    }
   }
   if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed'});
   const requested=pathname==='/'?'index.html':decodeURIComponent(pathname).slice(1);
   if(!ALLOWED_ROOT.test(requested)&&requested!=='sandbox/sandbox-ui.js')
    return send(404,{error:'Not found'});
   const full=path.join(ROOT,requested);
   let body=await fs.readFile(full);
   if(HOSTED&&requested==='index.html')body=Buffer.from(body.toString('utf8').replace('<head>','<head><meta name="household-sandbox-hosted" content="fixture">'));
   res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'application/octet-stream',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self' https://cdn.plaid.com; script-src 'self' 'unsafe-inline' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.plaid.com; img-src 'self' data: https://*.plaid.com; frame-src https://*.plaid.com"});
   if(req.method==='HEAD')res.end();else res.end(body);
  }catch(e){
   const status=e instanceof PlaidError?e.status:e.code==='ENOENT'?404:500;
   // No error stacks, access tokens, request payloads or Plaid credentials in HTTP responses.
   send(status,{error:e instanceof PlaidError?e.message:'Sandbox service error',
    code:e instanceof PlaidError?e.code:'SERVER_ERROR'});
  }
 });
 return {server,service:api,listen(port=8766){
  return new Promise((resolve,reject)=>{
   server.once('error',reject);
   restoreFixture().then(()=>server.listen(port,HOSTED?'0.0.0.0':'127.0.0.1',()=>resolve(server.address()))).catch(reject);
  });
 },close(){return new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}};
}
if(require.main===module&&process.env.LIVE_PLAID_ENABLED==='1'){
 // Explicit mode switch: never run fictional Sandbox routes with live bank credentials.
 require('../pilot/server.cjs').start(Number(process.env.PORT||8766)).then(()=>process.stdout.write('Household Ledger live bank mode ready\n')).catch(e=>{process.stderr.write('Live bank startup failed: '+e.message+'\n');process.exitCode=1});
}else if(require.main===module){
 const app=createServer();
 app.listen(Number(process.env.PORT||process.env.SANDBOX_PORT||8766)).then(addr=>{
  const mode=app.service.status().mode;
  process.stdout.write('Household Ledger '+(mode==='plaid'?'Plaid Sandbox':'LOCAL FIXTURE')+
   ' at http://127.0.0.1:'+addr.port+'\n');
 }).catch(()=>{process.stderr.write('Unable to start loopback Sandbox service\n');process.exitCode=1});
}
module.exports={createServer};
