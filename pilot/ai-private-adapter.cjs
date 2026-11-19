'use strict';
// Explicit opt-in, server-only AI analysis. Never pass raw bank objects to a model.
const {validateAdvisories}=require('./ai-advisory.cjs');
const ID=/^[a-zA-Z0-9_.-]{1,80}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
function cleanDescription(value){
 let s=String(value??'').slice(0,180);
 // Remove email addresses, URL query strings, long identifiers and account-number-like digit groups.
 s=s.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[redacted-email]')
  .replace(/https?:\/\/\S+/gi,'[redacted-url]')
  .replace(/\b(?:\d[ -]?){4,}\d\b/g,'[redacted-number]')
  .replace(/\b(?:password|passcode|token|secret|authorization|api[_ -]?key|client[_ -]?id)\s*[:=]\s*\S+/gi,'[redacted-credential]')
  .replace(/\b[a-z0-9_-]{20,}\b/gi,'[redacted-identifier]')
  .replace(/\d+/g,'[number]');
 return s.trim();
}
function safeSnapshot(transactions,accounts){
 if(!Array.isArray(transactions)||!Array.isArray(accounts)||transactions.length>500||
    accounts.length>30)throw Error('Invalid analysis scope');
 const alias=new Map();
 accounts.forEach((a,i)=>{
  if(!a||typeof a.id!=='string'||!a.id)throw Error('Invalid account');
  alias.set(a.id,'account-'+(i+1));
 });
 const rows=transactions.map((t,i)=>{
  if(!t||typeof t.id!=='string'||!t.id||!alias.has(t.accountId)||
     typeof t.amount!=='number'||!Number.isFinite(t.amount)||
     !DATE.test(String(t.date||'')))throw Error('Invalid transaction');
  return {id:'tx-'+(i+1),accountId:alias.get(t.accountId),
   date:t.date,amount:t.amount,description:cleanDescription(t.description??t.name)};
 });
 return {rows,accountAliases:[...alias.values()],sourceIds:transactions.map(t=>t.id),
  sourceAccountIds:accounts.map(a=>a.id)};
}
async function analyze({transactions,accounts,consent,apiKey,model='gpt-4.1-mini',fetchImpl=fetch}){
 if(consent!==true)throw Error('Explicit AI data-sharing consent required');
 if(!apiKey||typeof apiKey!=='string')throw Error('Server API key not configured');
 if(!ID.test(model))throw Error('Invalid model');
 const scope=safeSnapshot(transactions,accounts);
 let response;
 try{response=await fetchImpl('https://api.openai.com/v1/chat/completions',{
  method:'POST',signal:AbortSignal.timeout(60000),
  headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
  body:JSON.stringify({model,store:false,temperature:0,
   response_format:{type:'json_object'},
   messages:[
    {role:'system',content:"Audit household transactions comprehensively for recurring payments and income, skipped or late cycles, changes in amounts or dates, possible internal transfers, category inconsistencies, and unusual duplicate-looking posted activity. Return JSON object with proposals array. Allowed kinds: recurring, missing-payment, changed-amount, changed-date, possible-transfer, category. Each proposal needs accountId, predictedDate (ISO date or null), predictedAmount (number or null), confidence (0 to 1), evidenceTransactionIds (array), explanation. Cite multiple dated examples for recurring claims and compare intervals and amounts. Similar merchants do not prove duplicate charges. Do not infer missing payments without repeated cycles. Do not suggest a rule solely because a payment repeated: the application may already have that rule, and existing forecast settings were not provided. Favor concrete anomalies over generic recurring observations. Never invent evidence or claim complete history was checked. Transfers are not proof of mortgage. Do not infer ownership or initiate transactions. Return at most 12 distinct high-value findings, or empty array if none supported. Every finding must use an accountId from the supplied accounts array and evidenceTransactionIds drawn verbatim from supplied transaction ids. All fields are mandatory, including explicit null for unknown predictedDate or predictedAmount. confidence must be a number between 0 and 1, not a string. Never create or modify ids."},
    {role:'user',content:JSON.stringify({accounts:scope.accountAliases,transactions:scope.rows})}
   ]})
 });}catch(error){const e=new Error('AI request failed');e.safeCode=error?.name==='TimeoutError'||error?.name==='AbortError'?'analysis_timeout':'provider_connection_failed';throw e}
 if(!response.ok){
  // Only expose a bounded status category. Never log provider bodies, secrets or input rows.
  const status=Number(response.status);
  const code=status===401?'invalid_api_key':status===403?'permission_denied':
   status===429?'rate_limit_or_quota':status===400?'invalid_request':
   status>=500?'provider_unavailable':'provider_rejected';
  const error=new Error('AI provider request failed');error.safeCode=code;throw error;
 }
 let json;
 try{json=await response.json()}catch{const e=new Error('Invalid provider JSON');e.safeCode='invalid_provider_response';throw e}
 const message=json?.choices?.[0]?.message?.content;
 if(typeof message!=='string'||message.length>60000){const e=new Error('Invalid AI response');e.safeCode='invalid_provider_response';throw e}
 let validated;
 try{
  const parsed=JSON.parse(message);
  if(!Array.isArray(parsed?.proposals)||parsed.proposals.length>100)throw Error('Invalid advisory list');
  // A model may return a mixture of valid and malformed suggestions.
  // Retain only independently validated findings; never invent or repair evidence.
  validated=[];
  for(const item of parsed.proposals){
   try{validated.push(...validateAdvisories([item],scope.rows,scope.accountAliases))}
   catch(_invalid){/* Discard this untrusted proposal only. */}
  }
  if(parsed.proposals.length&&validated.length===0)throw Error('No valid findings');
 }catch{const e=new Error('Invalid AI proposals');e.safeCode='invalid_ai_findings';throw e}
 return validated.map(p=>({...p,
  accountId:scope.sourceAccountIds[scope.accountAliases.indexOf(p.accountId)],
  evidenceTransactionIds:p.evidenceTransactionIds.map(id=>scope.sourceIds[Number(id.slice(3))-1])}));
}
module.exports={analyze,safeSnapshot,cleanDescription};
