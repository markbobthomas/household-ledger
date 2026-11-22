'use strict';
// Fictional-only demonstration of encrypted report-cache behavior, using an
// injected in-memory persistence layer; never accesses live bank state.
const assert=require('node:assert/strict');
const {create}=require('../pilot/ai-report-cache.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async(condition)=>{for(let i=0;i<150;i++){if(condition())return;await tick()}
 throw Error('Fictional AI background operation did not settle');};
(async()=>{
 let stored=null,rev='A',sourceReads=0,analysisCalls=0;
 const make=async({analyze=async context=>({mode:'autonomous-adaptive',
  asOf:'2026-11-21',sourceRevision:context.revision,blocks:[]})}={})=>
  create({
   read:async()=>{if(!stored){const error=Error('missing');error.code='ENOENT';throw error}
    return structuredClone(stored)},
   write:async x=>{stored=structuredClone(x)},
   revision:()=>rev,snapshot:async()=>{sourceReads++;return {revision:rev}},
   analyze:async context=>{analysisCalls++;return analyze(context)}
  });
 let cache=await make();
 await cache.load();
 assert.equal(cache.status().status,'not_ready');
 assert.equal(cache.status().enabled,false);
 assert.equal(cache.schedule(),false,'never send data before ongoing consent');
 assert.equal(analysisCalls,0);
 await cache.setEnabled(true);
 await until(()=>cache.status().status==='ready');
 assert.equal(analysisCalls,1);
 assert.equal(cache.status().report.sourceRevision,'A');
 assert.equal(stored.autoEnabled,true);
 assert.equal(cache.schedule(),false,'same source version cannot trigger duplicate provider billing');
 assert.equal(analysisCalls,1);
 cache=await make();
 await cache.load();
 assert.equal(cache.status().report.sourceRevision,'A','restart reuses saved encrypted-derived report');
 assert.equal(cache.status().enabled,true,'standing opt-in persists');
 rev='B';
 let completeB;
 const waiting=await make({analyze:async context=>
  new Promise(resolve=>{completeB=()=>resolve({mode:'autonomous-adaptive',
   sourceRevision:context.revision,blocks:[]})})});
 await waiting.load();
 assert.equal(waiting.schedule(),true);
 await until(()=>typeof completeB==='function');
 rev='C';
 waiting.schedule();
 completeB();
 await until(()=>sourceReads>=3);
 // The next run must see C; previous B may NEVER be stored as current.
 assert.notEqual(stored.report?.sourceRevision,'B');
 await until(()=>typeof completeB==='function');
 completeB();
 await until(()=>waiting.status().status==='ready');
 assert.equal(waiting.status().report.sourceRevision,'C');
 await waiting.setEnabled(false);
 rev='D';
 assert.equal(waiting.schedule(),false,'opt-out stops further background sharing');
 assert.equal(waiting.status().status,'outdated','stale report is never shown as current');
 assert.equal(waiting.status().report,null);
 waiting.schedule({force:true});
 await until(()=>waiting.status().status==='running');
 completeB();
 await until(()=>waiting.status().status==='ready');
 assert.equal(waiting.status().report.sourceRevision,'D','manual consent allows an isolated run');
 assert.equal(waiting.status().enabled,false,'manual run does not grant standing consent');
 await waiting.clear();
 assert.equal(stored.autoEnabled,false);
 assert.equal(stored.report,null,'disconnect erases previous household report and authorization');
 assert.equal(waiting.status().report,null);
 // Previous release only authorized selected source summaries; a new
 // record-level data scope requires explicit renewed authorization.
 stored={version:1,autoEnabled:true,report:{mode:'autonomous-adaptive',
  blocks:[{kind:'hero',title:'Old model result',text:'Old'}]},
  revision:'D',completedAt:'2026-11-19T00:00:00Z'};
 const reconsent=await make();await reconsent.load();
 assert.equal(reconsent.status().enabled,false,'old consent never extends to broader data sharing');
 assert.equal(reconsent.status().report,null,'prior summary model report cannot be reused');
 assert.equal(stored.dataAccessVersion,2,'new scope is tracked in encrypted persistence');
 assert.equal(reconsent.schedule(),false,'no expanded scope data goes to AI until renewed opt-in');
 // A formatting-only upgrade should renew the analysis, not the consent.
 stored={version:1,dataAccessVersion:2,reportFormatVersion:3,autoEnabled:true,report:{
  mode:'autonomous-adaptive',blocks:[{kind:'hero',title:'Obsolete report',
   text:'Old wall of text'}]},revision:'D',
  completedAt:'2026-11-19T00:00:00Z'};
 const visual=await make();
 await visual.load();
 assert.equal(visual.status().enabled,true,
  'current ongoing data sharing remains authorized after a visual-only upgrade');
 assert.equal(visual.status().report,null,
  'old text-heavy layout is invalidated');
 assert.equal(stored.reportFormatVersion,4);
 assert.equal(stored.report,null);
 assert.equal(visual.schedule(),true,
  'format upgrade allows a newly generated report under existing consent');
 await until(()=>visual.status().status==='ready');
 assert.equal(stored.reportFormatVersion,4);

 console.log('PASS encrypted AI cache: consent, dedup, bank-refresh snapshot, stale result rejection, restart, manual refresh and disconnect');
})().catch(e=>{console.error(e);process.exitCode=1});
