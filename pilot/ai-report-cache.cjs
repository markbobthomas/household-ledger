'use strict';
// Encrypted per-request AI result cache. Bank sync, navigation, and startup must
// never enqueue a paid model call. No standing AI consent is accepted.
function create({read,write,revision,snapshot,analyze,available=()=>true,defer=setImmediate}){
 const empty=()=>({version:1,dataAccessVersion:2,reportFormatVersion:5,
  autoEnabled:false,report:null,revision:null,completedAt:null,
  checkpoint:null});
 let saved=empty(),phase='idle',lastError=null,queued=false,running=false,generation=0,
  activeStage=null;
 const safeCode=e=>[
  'invalid_api_key','permission_denied','rate_limit_or_quota','invalid_request',
  'provider_unavailable','provider_rejected','analysis_timeout',
  'provider_connection_failed','invalid_provider_response','invalid_ai_json',
  'invalid_ai_schema','invalid_ai_evidence','forecast_context_unavailable'
 ].includes(e?.safeCode)?e.safeCode:'analysis_failed';
 async function store(next){await write(next);saved=next}
 async function load(){
  let value;
  try{value=await read()}
  catch(e){if(e.code==='ENOENT')return;throw e}
  if(!value||value.version!==1||typeof value.autoEnabled!=='boolean'||
    (value.report!==null&&(typeof value.report!=='object'||Array.isArray(value.report)))||
    (value.revision!==null&&typeof value.revision!=='string'))
   throw Error('Invalid encrypted AI report cache');
  if(value.dataAccessVersion!==2){
   await store(empty()); // Old summary-only consent is not valid for broad data.
  }else if(value.reportFormatVersion!==5){
   await store({...empty(),...value,autoEnabled:false,reportFormatVersion:5,
    report:null,revision:null,completedAt:null});
  }else if(value.autoEnabled){
   // Migrate any previously authorized automatic runs to manual-only.
   await store({...empty(),...value,autoEnabled:false});
  }else saved={...empty(),...value,autoEnabled:false,
   checkpoint:value.checkpoint&&typeof value.checkpoint.revision==='string'&&
    value.checkpoint.state?.version===1?value.checkpoint:null};
 }
 function status(){
  const current=available()?revision():null;
  const fresh=!!(current&&saved.report&&saved.revision===current);
  const canResume=!!(current&&saved.checkpoint?.revision===current);
  return {enabled:false,status:running?'running':queued?'queued':
   phase==='failed'?'failed':canResume?'paused':
   saved.report?(fresh?'ready':'outdated'):'not_ready',
   // A durable encrypted checkpoint never triggers a paid call by itself.
   resumeAvailable:canResume,
   analysisStage:running?(activeStage||'preparing'):
    canResume?(saved.checkpoint.state.progress||saved.checkpoint.state.stage):null,
   // Successful paid results remain viewable after sync, rollover or failed rerun.
   report:saved.report,completedAt:saved.completedAt,isCurrent:!!fresh,
   ...(phase==='failed'&&lastError?{errorCode:lastError}:{})};
 }
 function schedule({force=false}={}){
  // An explicit authenticated POST is the only allowed entry point.
  // Concurrent or repeated clicks do not add another billable job.
  if(!force||!available()||queued||running)return false;
  queued=true;phase='queued';const runGeneration=generation;
  defer(()=>{queued=false;void run(runGeneration)});
  return true;
 }
 async function run(runGeneration){
  if(running||!available()||runGeneration!==generation)return;
  running=true;phase='running';lastError=null;
  try{
   const examined=revision(),context=await snapshot();
   const prior=saved.checkpoint?.revision===examined?saved.checkpoint.state:null;
   activeStage=prior?.progress||prior?.stage||'preparing';
   const report=await analyze(context,{
    resumeState:prior,
    onCheckpoint:async state=>{
     if(!available()||runGeneration!==generation)return;
     await store({...saved,checkpoint:{revision:examined,state}});
     activeStage=state.progress||state.stage||'investigating';
    }
   });
   // A date rollover or sync during this authorized run does not erase the
   // completed analysis; it will be labelled historical. A disconnect or
   // explicit clear invalidates generation and still prevents publication.
   if(available()&&runGeneration===generation){
    await store({...saved,autoEnabled:false,report,revision:examined,
     checkpoint:null,completedAt:new Date().toISOString()});
    phase=revision()===examined?'ready':'outdated';
   }else phase='outdated';
  }catch(e){lastError=safeCode(e);phase='failed'}
  finally{running=false;activeStage=null}
 }
 async function setEnabled(enabled){
  // Allow only retirement of a legacy saved setting; never a new auto opt-in.
  if(enabled!==false)throw Error('Automatic AI Analysis is no longer supported');
  if(saved.autoEnabled)await store({...saved,autoEnabled:false});
  return status();
 }
 async function clear(){
  generation++;
  await store(empty());
  lastError=null;phase='idle';activeStage=null;
 }
 return {load,status,schedule,setEnabled,clear};
}
module.exports={create};
