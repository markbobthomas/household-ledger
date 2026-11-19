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
  .replace(/\b[a-z0-9_-]{20,}\b/gi,'[redacted-identifier]');
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
 const response=await fetchImpl('https://api.openai.com/v1/chat/completions',{
  method:'POST',signal:AbortSignal.timeout(30000),
  headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
  body:JSON.stringify({model,store:false,temperature:0,
   response_format:{type:'json_object'},
   messages:[
    {role:'system',content:'You analyze household transaction patterns. Return JSON object {"proposals":[]} with zero or more evidence-backed proposals. Each proposal has kind (recurring, missing-payment, changed-amount, changed-date, possible-transfer, category), accountId, predictedDate (ISO date or null), predictedAmount (number or null), confidence (0 to 1), evidenceTransactionIds (array), explanation. Never invent evidence. Transfers are not proof of a mortgage. Do not infer account ownership or initiate transactions.'},
    {role:'user',content:JSON.stringify({accounts:scope.accountAliases,transactions:scope.rows})}
   ]})
 });
 if(!response.ok)throw Error('AI analysis unavailable');
 const json=await response.json();
 const message=json?.choices?.[0]?.message?.content;
 if(typeof message!=='string'||message.length>60000)throw Error('Invalid AI response');
 const parsed=JSON.parse(message);
 const validated=validateAdvisories(parsed.proposals,scope.rows,scope.accountAliases);
 return validated.map(p=>({...p,
  accountId:scope.sourceAccountIds[scope.accountAliases.indexOf(p.accountId)],
  evidenceTransactionIds:p.evidenceTransactionIds.map(id=>scope.sourceIds[Number(id.slice(3))-1])}));
}
module.exports={analyze,safeSnapshot,cleanDescription};
