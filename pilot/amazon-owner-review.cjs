'use strict';
// Private, read-only candidate lookup for a completed TinyFish run.
// The bank snapshot stays authoritative. Only an explicit owner selection
// may create a product Note; neither this module nor the UI runs an Agent.
const cloud=require('./amazon-cloud.cjs');
const Evidence=require('./amazon-evidence.cjs');
const pairing=require('./amazon-pairing.cjs');
const MAX_CANDIDATES=40;
function reject(message){throw Object.assign(Error(message),{httpStatus:409})}
const isoDay=value=>Date.parse(String(value||'')+'T12:00:00Z');
const gap=(posted,ordered)=>Math.round((isoDay(posted)-isoDay(ordered))/86400000);
function checked(state,run){
 const settings=state.amazonCloud||{},id=settings.lastFailedRunId;
 if(!settings.apiKey||!settings.profileId||settings.enabled||settings.run||
  !['no-matches','partial-report','invalid-report','empty-report'].includes(settings.pausedReason)||
  !/^[A-Za-z0-9-]{16,90}$/.test(String(id||'')))
  reject('There is no paused completed Amazon check to review');
 if(run?.status!=='COMPLETED'||run.run_id!==id||
    run.profile_attached!==true||run.profile_id!==settings.profileId||
    !String(run.goal||'').includes('Read only Amazon.com Your Orders')||
    !Number.isFinite(Date.parse(run.created_at))||
    Date.parse(run.created_at)>Date.now()+300000||
    Date.parse(run.created_at)<Date.now()-30*86400000)
  reject('This result is not a recent completed check from the connected Amazon profile');
 return cloud.parseOrders(run);
}
function grouped(parsed){
 const groups=new Map();
 for(const row of parsed){
  if(!groups.has(row.orderId))groups.set(row.orderId,[]);
  groups.get(row.orderId).push(row);
 }
 for(const part of parsed.unpricedOrders||[])
  groups.set(part.orderId,part.items.map(item=>({...item,orderId:part.orderId,
   date:part.date,charged:part.charged})));
 return [...groups.entries()].map(([orderId,items])=>{
  const ordered=items.map(i=>i.date).sort().at(0);
  const shipment=items.map(i=>i.shipmentDate||i.date).sort().at(-1);
  const amounts=[...new Set(items.map(i=>i.charged))];
  return {orderId,date:ordered,shipmentDate:shipment,
   totalCents:amounts.length===1&&Number.isSafeInteger(amounts[0])&&amounts[0]>0?amounts[0]:null,
   itemPricesVerified:items.every(i=>Number.isSafeInteger(i.cents)&&i.cents>0),
   items:items.map(i=>({title:String(i.title||'').slice(0,240),
    cents:Number.isSafeInteger(i.cents)&&i.cents>0?i.cents:null}))
  };
 });
}
function view(state,run){
 const parsed=checked(state,run),orders=grouped(parsed),at=Date.parse(run.created_at),
  txByKey=new Map(Object.values(state.transactions||{}).map(t=>[pairing.keyFor(t),t]));
 const charges=cloud.eligible(state).filter(entry=>{
  const tx=txByKey.get(entry.key);
  return tx&&isoDay(tx.date)<=at+86400000;
 }).map(entry=>{
  const tx=txByKey.get(entry.key),amountCents=Math.round(Number(tx.amount)*100);
  const candidates=orders.filter(order=>{
   const days=gap(tx.date,order.shipmentDate||order.date);
   return days>=-2&&days<=21;
  }).sort((a,b)=>{
   const aa=Math.abs(gap(tx.date,a.shipmentDate||a.date)-2);
   const bb=Math.abs(gap(tx.date,b.shipmentDate||b.date)-2);
   const ma=a.totalCents===amountCents?0:1,mb=b.totalCents===amountCents?0:1;
   return ma-mb||aa-bb||a.orderId.localeCompare(b.orderId);
  }).slice(0,MAX_CANDIDATES).map(order=>({
   orderId:order.orderId,orderDate:order.date,shipmentDate:order.shipmentDate,
   orderTotalCents:order.totalCents,itemPricesVerified:order.itemPricesVerified,
   titles:order.items.slice(0,8).map(i=>i.title),extraItems:Math.max(0,order.items.length-8)
  }));
  return {transactionKey:entry.key,postedDate:tx.date,amountCents,candidates};
 });
 return {runId:state.amazonCloud.lastFailedRunId,charges};
}
function choose(state,run,transactionKey,orderId){
 const snapshot=view(state,run);
 const selected=snapshot.charges.find(c=>c.transactionKey===transactionKey);
 if(!selected||!selected.candidates.some(o=>o.orderId===orderId))
  reject('This charge or Amazon order is no longer available for review');
 const tx=Object.values(state.transactions||{}).find(t=>pairing.keyFor(t)===transactionKey);
 if(!tx||!Evidence.isAmazon(tx))reject('The bank charge changed or is no longer posted');
 const notes=state.ledgerAdjustments?.predictions?.transactionNotes||{};
 if(String(notes[transactionKey]||'').trim())
  reject('This charge already has a Note. Nothing was overwritten');
 const orders=grouped(checked(state,run)),order=orders.find(o=>o.orderId===orderId);
 if(!order||!order.items.length)reject('Amazon did not return readable product details for that order');
 const note=pairing.itemNote(order.items);
 if(!note||note.length>160)reject('The Amazon product names cannot be saved safely');
 const before=state.ledgerAdjustments||{};
 const predictions={...(before.predictions||{}),transactionNotes:{...notes,[transactionKey]:note}};
 const itemEvidence={
  version:1,source:'amazon-owner-confirmed',accountId:String(tx.accountId),
  amountCents:Math.round(Number(tx.amount)*100),orderId,
  match:'exact',uncertainty:'owner-selected-no-amount-reconciliation',
  choices:[{orderId,date:order.date,items:order.items.map(item=>({
   title:item.title,cents:item.cents}))}],
  updatedAt:new Date().toISOString()
 };
 const evidence={...(before.amazonEvidence||{}),[tx.id]:itemEvidence};
 const scanned={...(state.amazonCloud?.scanned||{}),[transactionKey]:new Date().toISOString()};
 return {predictions,evidence,scanned,transactionKey,note};
}
module.exports={view,choose,checked};
