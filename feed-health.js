/* Phase 4.3: pure, non-authoritative bank feed health metadata; no sync or writes. */
(function(root){'use strict';
const validTime=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)&&/(?:Z|[+-]\d{2}:?\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
function assess(snapshot,records=[],expectedAccountIds=[],now=new Date()){
 const mode=String(snapshot?.mode||'disconnected');
 const connected=(mode==='live'||mode==='connected')&&snapshot?.connected===true;
 const accounts=Array.isArray(snapshot?.accounts)?snapshot.accounts:[];
 const expected=Array.isArray(expectedAccountIds)?[...new Set(expectedAccountIds.filter(Boolean).map(String))]:[];
 const actual=new Set(accounts.map(a=>String(a.id)));
 const missing=connected&&expected.length?expected.filter(a=>!actual.has(a)):null;
 const sync=connected&&validTime(snapshot?.lastSuccessfulSync)?snapshot.lastSuccessfulSync:null;
 const nowMs=new Date(now).getTime(),age=sync?(nowMs-Date.parse(sync))/86400000:null;
 const ageDays=age!==null&&Number.isFinite(age)&&age>=-5/1440?Math.max(0,age):null;
 const pending=connected?(Array.isArray(records)?records.filter(t=>t?.pending===true&&
   (t.source?.provider==='plaid'||t.source?.verified===true)):[]):[];
 const oldPending=pending.filter(t=>/^\d{4}-\d{2}-\d{2}$/.test(t.date)&&
   Number.isFinite(nowMs)&&nowMs-Date.parse(t.date+'T12:00:00Z')>3*86400000);
 const warnings=[];let status;
 if(!connected){status='not-connected';warnings.push('No connected bank feed; sample balances and dates are fictional.')}
 else{
  if(!accounts.length)warnings.push('The feed returned no accounts.');
  if(missing?.length)warnings.push(missing.length+' expected account(s) are missing from the feed.');
  if(ageDays===null)warnings.push('Last successful sync is unavailable or invalid. Freshness cannot be verified.');
  else if(ageDays>=7)warnings.push('Bank sync is over seven days old.');
  else if(ageDays>=2)warnings.push('Bank sync is at least two days old.');
  if(oldPending.length)warnings.push(oldPending.length+' pending item(s) are older than three days.');
  status=warnings.length?(ageDays!==null&&ageDays>=7?'stale':'attention'):'recent-sync-reported';
 }
 return {status,connected,authoritative:false,mode,accountCount:accounts.length,
  expectedAccountsKnown:connected&&expected.length>0,missingAccountIds:missing,
  lastSuccessfulSync:sync,syncAgeDays:ageDays===null?null:Math.round(ageDays*10)/10,
  pendingCount:connected?pending.length:null,oldPendingCount:connected?oldPending.length:null,
  warnings,disclaimer:connected?'Feed metadata is not an independent balance verification. New or pending transactions may still be absent.':
   'Demo mode cannot confirm account coverage, pending items, or last bank sync.'};
}
const api={assess};root.HouseholdFeedHealth=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
