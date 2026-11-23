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
  analyze:async context=>{calls++;return analyze(context)}
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
 assert.equal(cache.status().report,null);
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
 assert.equal(stored.report?.sourceRevision==='B',false,'stale work is never published');
 assert.equal(calls,2,'a changed bank snapshot must not initiate a replacement paid run');
 assert.equal(waiting.schedule(),false);
 resolveRun=null;
 assert.equal(waiting.schedule({force:true}),true);
 await until(()=>typeof resolveRun==='function');
 resolveRun();
 await until(()=>waiting.status().status==='ready');
 assert.equal(waiting.status().report.sourceRevision,'C');
 assert.equal(calls,3);
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
 assert.equal(calls,3);
 console.log('PASS paid AI cache: manual-only request, no restart/sync/retry charges, independent stale result rejection');
})().catch(e=>{console.error(e);process.exitCode=1});
