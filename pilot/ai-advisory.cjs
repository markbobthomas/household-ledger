'use strict';
// AI advisory boundary. No bank data leaves this module; no model calls are made here.
// The caller must obtain explicit consent and use a separately secured model adapter.
// Recommendations never mutate posted bank history or the canonical forecast.
const ALLOWED=new Set(['recurring','missing-payment','changed-amount','changed-date','possible-transfer','category']);
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const money=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e9;
function normalizeProposal(raw,sourceIds){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid AI proposal');
 const kind=String(raw.kind||'');
 if(!ALLOWED.has(kind))throw Error('Unsupported proposal kind');
 const evidence=raw.evidenceTransactionIds;
 if(!Array.isArray(evidence)||!evidence.length||evidence.length>20||
    evidence.some(id=>typeof id!=='string'||!sourceIds.has(id)))throw Error('Evidence must refer to provided transactions');
 const date=raw.predictedDate==null?null:String(raw.predictedDate);
 if(date!==null&&(!ISO.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))))throw Error('Invalid predicted date');
 const amount=raw.predictedAmount==null?null:raw.predictedAmount;
 if(amount!==null&&!money(amount))throw Error('Invalid predicted amount');
 const confidence=raw.confidence;
 if(typeof confidence!=='number'||!Number.isFinite(confidence)||confidence<0||confidence>1)throw Error('Invalid confidence');
 const explanation=String(raw.explanation||'').trim();
 if(!explanation||explanation.length>1000)throw Error('Missing explanation');
 const accountId=String(raw.accountId||'');
 if(!accountId)throw Error('Missing account');
 return Object.freeze({kind,accountId,predictedDate:date,predictedAmount:amount,
  confidence,evidenceTransactionIds:[...new Set(evidence)],explanation,
  status:'needs-confirmation',origin:'ai-advisory'});
}
function validateAdvisories(raw,transactions,allowedAccountIds){
 if(!Array.isArray(raw)||raw.length>100)throw Error('Invalid advisory list');
 if(!Array.isArray(transactions)||!Array.isArray(allowedAccountIds))throw Error('Missing source scope');
 const ids=new Set(transactions.map(t=>String(t.id)).filter(Boolean));
 const accounts=new Set(allowedAccountIds.map(String));
 return raw.map(item=>{
  const proposal=normalizeProposal(item,ids);
  if(!accounts.has(proposal.accountId))throw Error('Proposal references unknown account');
  return proposal;
 });
}
module.exports={validateAdvisories};
