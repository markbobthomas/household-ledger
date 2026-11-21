'use strict';
// Encrypted, server-side AI result cache. Never stores a source record in Git,
// the browser, or an unencrypted on-disk file. A result is valid only for the
// exact canonical snapshot revision it examined.
function create({read,write,revision,snapshot,analyze,available=()=>true,defer=setImmediate}){
 let saved={version:1,autoEnabled:false,report:null,revision:null,completedAt:null};
 let phase='idle',lastError=null,lastFailedRevision=null,queued=false,running=false,requested=false,forceNext=false;
 const safeCode=e=>[
  'invalid_api_key','permission_denied','rate_limit_or_quota','invalid_request',
  'provider_unavailable','provider_rejected','analysis_timeout',
  'provider_connection_failed','invalid_provider_response','invalid_ai_json',
  'invalid_ai_schema','invalid_ai_evidence','forecast_context_unavailable'
 ].includes(e?.safeCode)?e.safeCode:'analysis_failed';
 async function load(){
  let value;
  try{value=await read()}
  catch(e){if(e.code==='ENOENT')return;throw e}
  if(!value||value.version!==1||typeof value.autoEnabled!=='boolean'||
    (value.report!==null&&(typeof value.report!=='object'||Array.isArray(value.report)))||
    (value.revision!==null&&typeof value.revision!=='string'))
   throw Error('Invalid encrypted AI report cache');
  saved={...saved,...value};
 }
 async function store(next){await write(next);saved=next}
 function status(){
  const current=available()?revision():null;
  const fresh=!!(current&&saved.report&&saved.revision===current);
  return {enabled:saved.autoEnabled,status:running?'running':queued?'queued':
   fresh?'ready':phase==='failed'?'failed':saved.report?'outdated':'not_ready',
   report:fresh?saved.report:null,completedAt:fresh?saved.completedAt:null,
   ...(phase==='failed'&&lastError?{errorCode:lastError}:{})};
 }
 function schedule({force=false}={}){
  if(!available()||!saved.autoEnabled&&!force)return false;
  const current=revision();
  if(!force&&lastFailedRevision===current)return false;
  if(!force&&saved.report&&saved.revision===current&&!running&&!queued)return false;
  if(running||queued){requested=true;forceNext=forceNext||force;return true}
  queued=true;phase='queued';forceNext=forceNext||force;
  defer(()=>{queued=false;void run()});
  return true;
 }
 async function run(){
  if(running||!available())return;
  const runForced=forceNext;forceNext=false;
  if(!runForced&&!saved.autoEnabled)return;
  running=true;phase='running';lastError=null;
  let examined=null;
  try{
   examined=revision();
   const context=await snapshot();
   const report=await analyze(context);
   // A concurrent bank sync or forecast edit cannot publish stale results.
   if(available()&&revision()===examined&&
     (saved.autoEnabled||runForced)){
    await store({...saved,report,revision:examined,completedAt:new Date().toISOString()});
    phase='ready';lastFailedRevision=null;
   }else if(available()&&saved.autoEnabled){
    requested=true;phase='outdated';
   }else phase='idle';
  }catch(e){lastError=safeCode(e);lastFailedRevision=examined;phase='failed'}
  finally{
   running=false;
   if(requested){const again=forceNext;requested=false;forceNext=false;
    if(saved.autoEnabled||again)schedule({force:again});}
  }
 }
 async function setEnabled(enabled){
  if(typeof enabled!=='boolean')throw Error('Invalid automatic analysis preference');
  await store({...saved,autoEnabled:enabled});
  if(enabled)schedule();
  return status();
 }
 async function clear(){
  await store({version:1,autoEnabled:false,report:null,revision:null,completedAt:null});
  requested=false;forceNext=false;lastError=null;lastFailedRevision=null;phase='idle';
 }
 return {load,status,schedule,setEnabled,clear};
}
module.exports={create};
