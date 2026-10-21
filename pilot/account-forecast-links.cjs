'use strict';
// Read-only inspection of encrypted planning preferences. Never deduce identity
// from account display names or masked numbers; only stable Plaid account IDs.
// No bank token, transaction list or forecast merchant is returned to the UI.
const namedFields=new Set([
 'accountId','fromAccountId','toAccountId','originalAccountId','sourceAccountId',
 'primaryAccountId','fundingAccountId','transactionAccountId','paymentAccountId',
 'linkedAccountId','cardId'
]);
const encodedFields=new Set(['id','sourceKey','seriesKey','key','ruleId','sourceRuleId','recurringRuleId']);
const maxDepth=12;
// These settings are global categories/thresholds, never account identities.
const globalSettings=new Set(['monthlyBudgets','categoryForecasts','cashCushion','dailyVariable']);
function keyContains(key,id){
 const seen=new Set(),pending=[String(key??'')];
 while(pending.length&&seen.size<180){
  const part=pending.pop();
  if(seen.has(part))continue;
  seen.add(part);
  if(part===id)return true;
  if(part.includes('|'))pending.push(...part.split('|'));
  try{const decoded=decodeURIComponent(part);if(decoded!==part)pending.push(decoded)}
  catch{}
 }
 return false;
}
function itemContains(value,id,key='',depth=0){
 if(depth>maxDepth||value==null)return false;
 if(Array.isArray(value))
  return value.some(part=>itemContains(part,id,key,depth+1));
 if(typeof value==='object')
  return Object.entries(value).some(([field,part])=>
   keyContains(field,id)||itemContains(part,id,field,depth+1));
 if(typeof value!=='string'&&typeof value!=='number')return false;
 if(namedFields.has(key))return String(value)===id;
 if(encodedFields.has(key))return keyContains(value,id);
 return false;
}
function inspect(state){
 const accounts=Array.isArray(state?.accounts)?state.accounts:[],
  adjustments=state?.ledgerAdjustments||{},p=adjustments.predictions||{},
  txs=state?.transactions||{},categoryOverrides=adjustments.categoryOverrides||{};
 const categoryAccounts=Object.entries(categoryOverrides).reduce((lookup,[txId])=>{
  const t=txs[txId],accountId=t?.accountId;
  if(accountId){lookup[String(accountId)]=(lookup[String(accountId)]||0)+1}
  return lookup;
 },{});
 return accounts.map(a=>{
  const id=String(a.id),byType={};
  if(String(p.primaryAccountId||'')===id)byType.primaryAccount=1;
  for(const [type,collection] of Object.entries(p)){
   if(type==='primaryAccountId'||globalSettings.has(type)||collection==null)continue;
   if(Array.isArray(collection)){
    const count=collection.filter(entry=>itemContains(entry,id)).length;
    if(count)byType[type]=count;
   }else if(typeof collection==='object'){
    const count=Object.entries(collection).filter(([key,entry])=>
     keyContains(key,id)||itemContains(entry,id)).length;
    if(count)byType[type]=count;
   }
  }
  const forecastLinks=Object.values(byType).reduce((sum,n)=>sum+n,0),
   categoryEdits=categoryAccounts[id]||0;
  return {id,forecastLinks,categoryEdits,primary:Boolean(byType.primaryAccount),
   protected:forecastLinks>0||categoryEdits>0,
   counts:byType};
 });
}
module.exports={inspect,keyContains,itemContains};
