'use strict';
// Local read-only reconciliation: no forecast data is sent to OpenAI.
const normalized=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const days=(a,b)=>Math.abs((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);
function reconcile(proposals,transactions,forecast){
 if(!Array.isArray(proposals)||!Array.isArray(transactions)||!Array.isArray(forecast))return proposals;
 const byId=new Map(transactions.map(t=>[t.id,t]));
 return proposals.filter(p=>{
  if(!['recurring','missing-payment','changed-date','changed-amount'].includes(p.kind))return true;
  const evidence=(p.evidenceTransactionIds||[]).map(id=>byId.get(id)).filter(Boolean);
  const merchants=new Set(evidence.map(t=>normalized(t.description)).filter(Boolean));
  if(!merchants.size)return true;
  return !forecast.some(e=>{
   if(!e||String(e.accountId)!==String(p.accountId)||!e.date||!Number.isFinite(Number(e.amount)))return false;
   if(!merchants.has(normalized(e.merchant)))return false;
   // For a missing/changed payment, only suppress an already scheduled matching
   // date and amount. An amount change is not covered by an old amount.
   if(p.kind!=='recurring'){
    return !!p.predictedDate&&days(e.date,p.predictedDate)<=3&&
     p.predictedAmount!=null&&Math.abs(Math.abs(Number(e.amount))-Math.abs(p.predictedAmount))<=0.01;
   }
   // A single occurrence cannot prove an existing recurring schedule.
   return !!(e.ruleId||e.seriesKey||e.cadence||e.source==='manual')&&
    (p.predictedAmount==null||Math.abs(Math.abs(Number(e.amount))-Math.abs(p.predictedAmount))<=0.01);
  });
 });
}
module.exports={reconcile};
