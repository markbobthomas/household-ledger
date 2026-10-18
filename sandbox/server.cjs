'use strict';
/* Loopback-only Sandbox server. NEVER bind publicly or serve this as a cloud
 * production backend. No Plaid tokens ever reach the browser. */
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {createService,remoteTransport,PlaidError}=require('./plaid-service.cjs');
const {fixtureTransport}=require('./fixture.cjs');
const ROOT=path.resolve(__dirname,'..');
const ALLOWED_ROOT=/^(?:index\.html|modern\.css|(?:demo-data|forecast|forecast-ledger|accounting|categorization|ledger-data|account-forecast|bank-feed|feed-health|cashflow|recurring|reviews|accuracy-fixture|accuracy-fixture-holdout|accuracy-fixture-seasonal|accuracy-lab|stress-lab|readiness-lab)\.js)$/;
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
function createServer({service}={}){
 const api=service||createService({
  mode:process.env.PLAID_CLIENT_ID&&process.env.PLAID_SANDBOX_SECRET?'plaid':'fixture',
  request:process.env.PLAID_CLIENT_ID&&process.env.PLAID_SANDBOX_SECRET?
   remoteTransport({clientId:process.env.PLAID_CLIENT_ID,secret:process.env.PLAID_SANDBOX_SECRET}):
   fixtureTransport()
 });
 const server=http.createServer(async(req,res)=>{
  const send=(status,obj)=>{
   res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
   res.end(JSON.stringify(obj));
  };
  try{
   const host=String(req.headers.host||'');
   const allowedHost=/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host);
   if(!allowedHost||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))
    return send(403,{error:'Loopback access only'});
   const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
   const origin=req.headers.origin;
   if(origin&&!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin))
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
     case '/api/sandbox/connect':return send(200,await api.connectTest(input.institutionId,input.profile));
     case '/api/sandbox/link-token':return send(200,await api.createLinkToken());
     case '/api/sandbox/exchange':return send(200,await api.exchangePublicToken(input.publicToken,input.institutionId));
     case '/api/sandbox/sync':return send(200,await api.sync(input.itemId));
     case '/api/sandbox/refresh':return send(200,await api.refresh(input.itemId));
     case '/api/sandbox/disconnect':return send(200,await api.disconnect(input.itemId));
     default:return send(404,{error:'Unknown Sandbox route'});
    }
   }
   if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed'});
   const requested=pathname==='/'?'index.html':decodeURIComponent(pathname).slice(1);
   if(!ALLOWED_ROOT.test(requested)&&requested!=='sandbox/sandbox-ui.js')
    return send(404,{error:'Not found'});
   const full=path.join(ROOT,requested);
   const body=await fs.readFile(full);
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
   server.listen(port,'127.0.0.1',()=>resolve(server.address()));
  });
 },close(){return new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}};
}
if(require.main===module){
 const app=createServer();
 app.listen(Number(process.env.SANDBOX_PORT||8766)).then(addr=>{
  const mode=app.service.status().mode;
  process.stdout.write('Household Ledger '+(mode==='plaid'?'Plaid Sandbox':'LOCAL FIXTURE')+
   ' at http://127.0.0.1:'+addr.port+'\n');
 }).catch(()=>{process.stderr.write('Unable to start loopback Sandbox service\n');process.exitCode=1});
}
module.exports={createServer};
