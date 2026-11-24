'use strict';
// Synthetic, in-memory test only; no real accounts, API keys or provider calls.
const assert=require('node:assert/strict');
const {create}=require('../pilot/ai-report-cache.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async condition=>{for(let i=0;i<160;i++){if(condition())return;await tick()}
 throw Error('Manual-only analysis request did not settle')};
(async()=>{
 let stored=null,rev='A',reads=0,calls=0,resolveRun=null;
 const make=(analyze=async context=>({sourceRevision:context.revision,blocks:[]}))=>create({
  read:async()=>{if(!stored){const e=Error('missing');e.code='ENOENT';throw e}
   return structuredClone(stored)},
  write:async value=>{stored=structuredClone(value)},
  revision:()=>rev,
  snapshot:async()=>{reads++;return {revision:rev}},
  analyze:async(context,options)=>{calls++;return analyze(context,options)}
 });
 let cache=make();await cache.load();
 assert.equal(cache.status().enabled,false);
 assert.equal(cache.schedule(),false);
 await tick();assert.equal(calls,0);
 assert.equal(cache.status().status,'not_ready');
 await assert.rejects(()=>cache.setEnabled(true),/no longer supported/);
 assert.equal(cache.schedule(),false,'a failed old-client opt-in cannot call OpenAI');
 assert.equal(cache.schedule({force:true}),true,'manual Analysis request can start');
 assert.equal(cache.schedule({force:true}),false,'double click cannot enqueue a second paid run');
 await until(()=>cache.status().status==='ready');
 assert.equal(calls,1);
 assert.equal(cache.status().report.sourceRevision,'A');
 assert.equal(cache.status().enabled,false,'manual action does not authorize future automatic calls');
 rev='B';
 assert.equal(cache.status().status,'outdated');
 assert.equal(cache.status().report.sourceRevision,'A',
  'the last successful report stays accessible when records or date change');
 assert.equal(cache.status().isCurrent,false);
 assert.equal(cache.schedule(),false,'sync or GET cannot trigger analysis');
 await tick();assert.equal(calls,1);
 // An old persisted auto authorization is revoked without losing a valid report.
 stored={...stored,autoEnabled:true};
 cache=make();await cache.load();
 assert.equal(stored.autoEnabled,false,'persisted standing consent is retired at startup');
 assert.equal(cache.status().enabled,false);
 assert.equal(cache.schedule(),false,'restart never bills the provider');
 await tick();assert.equal(calls,1);
 const waiting=make(async context=>new Promise(resolve=>{resolveRun=()=>resolve({
  sourceRevision:context.revision,blocks:[]})}));
 await waiting.load();
 assert.equal(waiting.schedule({force:true}),true);
 await until(()=>typeof resolveRun==='function');
 assert.equal(waiting.schedule({force:true}),false,'running analysis ignores duplicate requests');
 rev='C';resolveRun();
 await until(()=>waiting.status().status!=='running');
 assert.equal(stored.report?.sourceRevision,'B',
  'a completed authorized run survives source changes during its investigation');
 assert.equal(waiting.status().status,'outdated');
 assert.equal(waiting.status().isCurrent,false);
 assert.equal(calls,2,'a changed bank snapshot must not initiate a replacement paid run');
 assert.equal(waiting.schedule(),false);
 resolveRun=null;
 assert.equal(waiting.schedule({force:true}),true);
 await until(()=>typeof resolveRun==='function');
 resolveRun();
 await until(()=>waiting.status().status==='ready');
 assert.equal(waiting.status().report.sourceRevision,'C');
 assert.equal(calls,3);
 // A failed new report never removes the old successful encrypted analysis.
 const broken=make(async()=>{const error=Error('fictional bad AI citation');
  error.safeCode='invalid_ai_evidence';throw error});
 await broken.load();
 assert.equal(broken.schedule({force:true}),true);
 await until(()=>broken.status().status==='failed');
 assert.equal(broken.status().errorCode,'invalid_ai_evidence');
 assert.equal(broken.status().report.sourceRevision,'C');
 assert.equal(broken.status().isCurrent,true);
 rev='D';
 assert.equal(broken.status().report.sourceRevision,'C');
 assert.equal(broken.status().isCurrent,false);
 cache=make();await cache.load();
 assert.equal(cache.status().status,'outdated');
 assert.equal(cache.status().report.sourceRevision,'C',
  'restart must preserve latest successful analysis without paid model calls');
 assert.equal(cache.schedule(),false);
 // Prior data-access versions and obsolete presentation formats cannot carry
 // any recurring consent forward, regardless of what the old cache contained.
 stored={version:1,autoEnabled:true,report:{blocks:[]},revision:'C',completedAt:'2026-11-19'};
 cache=make();await cache.load();
 assert.equal(cache.status().enabled,false);assert.equal(cache.status().report,null);
 assert.equal(stored.dataAccessVersion,2);
 stored={version:1,dataAccessVersion:2,reportFormatVersion:3,autoEnabled:true,
  report:{blocks:[]},revision:'C',completedAt:'2026-11-19'};
 cache=make();await cache.load();
 assert.equal(cache.status().enabled,false);assert.equal(stored.autoEnabled,false);
 assert.equal(stored.report,null);assert.equal(cache.schedule(),false);
 await cache.clear();
 assert.equal(stored.report,null);assert.equal(stored.autoEnabled,false);
 assert.equal(calls,4);
 // Synthetic encrypted checkpoint storage and manual-only recovery across
 // restart. Source records, account revisions and the old report are untouched.
 rev='E';
 const state={version:1,mode:'autonomous',model:'gpt-6.2-astra',
  progress:'discovery-two',stage:'discovery-two',nextRound:4};
 const interrupted=make(async(_ctx,{onCheckpoint})=>{
  await onCheckpoint(state);
  const error=Error('fictional provider timeout');
  error.safeCode='analysis_timeout';throw error;
 });
 await interrupted.load();
 assert.equal(interrupted.schedule({force:true}),true);
 await until(()=>interrupted.status().status==='failed');
 assert.equal(interrupted.status().resumeAvailable,true);
 assert.equal(interrupted.status().analysisStage,'discovery-two');
 assert.deepEqual(stored.checkpoint.state,state);
 assert.equal(interrupted.schedule(),false,'provider failure cannot enable automatic resume');
 const resumedCache=make(async(_ctx,{resumeState})=>{
  assert.deepEqual(resumeState,state,
   'new server instance receives completed work without repeating stages');
  return {sourceRevision:'E',blocks:[]};
 });
 await resumedCache.load();
 assert.equal(resumedCache.status().status,'paused');
 assert.equal(resumedCache.status().resumeAvailable,true);
 assert.equal(resumedCache.schedule(),false,'GET and startup never pay for a resumed run');
 assert.equal(resumedCache.schedule({force:true}),true);
 await until(()=>resumedCache.status().status==='ready');
 assert.equal(resumedCache.status().resumeAvailable,false);
 assert.equal(stored.checkpoint,null,'successful report clears private checkpoint');
 assert.equal(stored.report.sourceRevision,'E');
 // A changed source revision must never feed stale evidence into the model.
 stored.checkpoint={revision:'E',state};
 rev='F';
 const changedSnapshot=make(async(_ctx,{resumeState})=>{
  assert.equal(resumeState,null,'stale financial checkpoint cannot be resumed');
  return {sourceRevision:'F',blocks:[]};
 });
 await changedSnapshot.load();
 assert.equal(changedSnapshot.status().resumeAvailable,false);
 assert.equal(changedSnapshot.schedule({force:true}),true);
 await until(()=>changedSnapshot.status().status==='ready');
 console.log('PASS paid AI cache: stored intermediate research resumes manually only on matching financial snapshot');
 console.log('PASS paid AI cache: persisted successful reports after refresh, sync and failed rerun');
})().catch(e=>{console.error(e);process.exitCode=1});
