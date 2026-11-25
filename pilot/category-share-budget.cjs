'use strict';
// Read-only shared Budget: the same normalized Plaid records, accounting
// measures, monthly targets, Amazon allocations and prepared forecast used by
// the main Ledger Budget. The bearer link has no write access to budgets.
const model=require('../ledger-data.js');
const Accounting=require('../accounting.js');
const T=require('../planner-transactions.js');
const feed=require('./data-source.js');
const {pacificDate}=require('./prepared-forecast.cjs');
function build(state,prepared){
 if(!state.items?.length)return null;
 const asOf=prepared?.asOf||pacificDate(),month=asOf.slice(0,7);
 const {state:ledger}=feed.prepare({connected:true,
  account:state.accounts[0]||null,accounts:state.accounts,
  transactions:Object.values(state.transactions||{}),
  adjustments:state.ledgerAdjustments||{}},asOf);
 const all=model.records(ledger).filter(r=>r.date&&r.date<=asOf);
 const settlements=Accounting.budgetCardSettlementIds(all);
 const monthRows=all.filter(r=>r.date.slice(0,7)===month);
 const prefs=ledger.predictions||{},targets=prefs.categoryMonthlyBudgets||{};
 const grouped=new Map();
 const group=name=>{
  const category=model.canonicalCategory(ledger,name)||name||'Other';
  if(!grouped.has(category))grouped.set(category,{name:category,spentCents:0,
   pendingCents:0,expectedCents:0});
  return grouped.get(category);
 };
 let spentCents=0,pendingCents=0,expectedCents=0;
 for(const row of monthRows){
  const measure=Accounting.reportingMeasures(row,settlements);
  const posted=measure.postedSpendingCents,pending=measure.provisionalPendingSpendingCents;
  if(!posted&&!pending)continue;
  spentCents+=posted;pendingCents+=pending;
  const parts=row.amazonAllocation?.lines,
   valid=posted>0&&Array.isArray(parts)&&parts.length&&
    parts.every(l=>Number.isSafeInteger(l.cents)&&l.cents>0&&typeof l.category==='string')&&
    parts.reduce((n,l)=>n+l.cents,0)===posted;
  if(valid){
   for(const line of parts)group(line.category).spentCents+=line.cents;
  }else group(row.category||'Other').spentCents+=posted;
  if(pending)group(row.category||'Other').pendingCents+=pending;
 }
 const projection=prepared?.bundle?.projection;
 if(projection){
  const rules=new Map((prefs.futureRecurringRules||[]).filter(r=>r.kind!=='movement')
   .map(r=>[String(r.id),r]));
  const additions=new Map((prefs.futureTransactionAdds||[])
   .map(r=>[String(r.id),r]));
  const accountIds=new Set((state.accounts||[]).map(a=>String(a.id)));
  const postedBills=all.flatMap(row=>{
   const amount=Number(row.amount);
   if(!accountIds.has(String(row.accountId))||row.pairedTransactionId||
      !(row.type==='expense'||row.type==='transfer'&&row.cashDirection==='out')||
      settlements.has(String(row.id))||row.accountingKind==='card_payment'||
      row.accountingKind==='internal_transfer'&&row.type!=='transfer'||
      !Number.isFinite(amount)||amount<=0)return [];
   const matches=T.historicalScheduleMatches(row,ledger.accounts||[],prefs.futureRecurringRules||[])
    .filter(r=>r.kind!=='movement'&&(r.type==='expense'||r.type==='transfer'&&r.cashDirection==='out'));
   return matches.length===1?[{row,rule:matches[0]}]:[];
  });
  const seen=new Set();
  for(const event of projection.events||[]){
   if(event.transferGroupId||event.date<=asOf||event.date.slice(0,7)!==month)continue;
   const type=event.type==='refund'||event.kind==='card_refund'?'refund':
    event.type==='expense'||event.kind==='card_purchase'?'expense':null;
   if(!type)continue;
   const id=String(event.id||''),key=String(event.predictionKey||JSON.stringify([id,event.accountId,event.date]));
   if(seen.has(key))continue;seen.add(key);
   const rule=rules.get(String(event.recurringRuleId));
   if(type==='expense'&&rule&&postedBills.some(p=>
    String(p.rule.id)===String(rule.id)&&T.postedWithinMatchWindow(
     rule,p.row,event.date,event.amount,(rule.exampleIds||[]).map(String).includes(String(p.row.id)))))continue;
   const cents=Accounting.forecastSpendingCents({kind:'event',type,amount:event.amount});
   if(!cents)continue;
   const name=rule?.category||event.category||additions.get(id)?.category||'Other',
    category=['Income','Transfer'].includes(name)?'Other':name;
   group(category).expectedCents+=cents;expectedCents+=cents;
  }
 }
 for(const name of model.categories(ledger))if(name!=='Uncategorized')group(name);
 for(const [name,value] of Object.entries(targets))
  if(name&&Number.isFinite(Number(value)))group(name);
 const order=new Map((prefs.categoryDisplayOrder||[]).filter(n=>typeof n==='string')
  .map((n,i)=>[n,i]));
 const rows=[...grouped.values()].filter(r=>!['Income','Transfer'].includes(r.name))
  .map(r=>{
   const raw=Object.hasOwn(targets,r.name)?targets[r.name]:null,
    set=raw!==null&&raw!==''&&Number.isFinite(Number(raw))&&Number(raw)>=0,
    targetCents=set?Math.round(Number(raw)*100):null,
    usedCents=r.spentCents+r.pendingCents+r.expectedCents;
   return {...r,targetCents,usedCents};
  }).sort((a,b)=>
   Number(!order.has(a.name))-Number(!order.has(b.name))||
   (order.get(a.name)||0)-(order.get(b.name)||0)||
   a.name.localeCompare(b.name));
 const totalBudgetCents=Object.entries(targets).reduce((sum,[name,v])=>
  !['Income','Transfer'].includes(name)&&v!==null&&v!==''&&
   Number.isFinite(Number(v))&&Number(v)>=0?sum+Math.round(Number(v)*100):sum,0);
 const budgetSet=Object.entries(targets).some(([name,v])=>
  !['Income','Transfer'].includes(name)&&v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0);
 return {month,asOf,rows,spentCents,pendingCents,expectedCents,
  usedCents:spentCents+pendingCents+expectedCents,totalBudgetCents,
  budgetSet,expectedIncluded:!!projection};
}
module.exports={build};
