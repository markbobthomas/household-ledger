'use strict';
// Read-only shared Budget: the same normalized Plaid records, accounting
// measures, monthly targets, Amazon allocations and prepared forecast used by
// the main Ledger Budget. Budget targets remain read-only; a guarded posted
// transaction editor changes only the household's category override and note.
const model=require('../ledger-data.js');
const Accounting=require('../accounting.js');
const T=require('../planner-transactions.js');
const feed=require('./data-source.js');
const {pacificDate}=require('./prepared-forecast.cjs');
const {keyFor}=require('./amazon-pairing.cjs');
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
 const notes=prefs.transactionNotes||{};
 const postedIdentity=row=>{
  const raw=state.transactions?.[String(row.id)];
  return raw&&!raw.pending&&String(raw.accountId)===String(row.accountId)?{
   id:String(row.id),editableNote:String(notes[keyFor(raw)]||'').slice(0,1000)}:{};
 };
 const categories=model.categories(ledger).filter(c=>!['Uncategorized','Income','Transfer','Savings'].includes(c));
 const grouped=new Map();
 const group=name=>{
  const category=model.canonicalCategory(ledger,name)||name||'Other';
  if(!grouped.has(category))grouped.set(category,{name:category,spentCents:0,
   pendingCents:0,expectedCents:0,items:[]});
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
  const merchant=String(row.merchant||row.name||'Purchase').slice(0,140);
  if(valid){
   for(let lineIndex=0;lineIndex<parts.length;lineIndex++){
    const line=parts[lineIndex],category=group(line.category);
    category.spentCents+=line.cents;
    category.items.push({date:row.date,merchant:String(line.title||merchant).slice(0,140),
     cents:line.cents,source:'posted',...postedIdentity(row),lineIndex,
     category:category.name});
   }
  }else if(posted){
   const category=group(row.category||'Other');
   category.spentCents+=posted;
   category.items.push({date:row.date,merchant,cents:posted,source:'posted',
    ...postedIdentity(row),lineIndex:null,category:category.name});
  }
  if(pending){
   const category=group(row.category||'Other');
   category.pendingCents+=pending;
   category.items.push({date:row.date,merchant,cents:pending,source:'pending'});
  }
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
   // Keep event type fallback identical to Ledger's futureRows() view.
   // Many legitimate projected expenses have no explicit event.type.
   const type=event.type==='transfer'?'transfer':
    event.kind==='card_refund'?'refund':event.kind==='card_purchase'?'expense':
    event.type==='refund'?'refund':event.type==='income'?'income':'expense';
   if(!['expense','refund'].includes(type))continue;
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
   const entry=group(category);
   entry.expectedCents+=cents;expectedCents+=cents;
   entry.items.push({date:event.date,
    merchant:String(event.merchant||event.description||rule?.merchant||
      additions.get(id)?.merchant||'Expected expense').slice(0,140),
    cents,source:'expected'});
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
   return {...r,targetCents,usedCents,items:r.items.slice().sort((a,b)=>
    b.date.localeCompare(a.date)||a.merchant.localeCompare(b.merchant))};
  }).sort((a,b)=>
   Number(!order.has(a.name))-Number(!order.has(b.name))||
   (order.get(a.name)||0)-(order.get(b.name)||0)||
   a.name.localeCompare(b.name));
 const totalBudgetCents=Object.entries(targets).reduce((sum,[name,v])=>
  !['Income','Transfer'].includes(name)&&v!==null&&v!==''&&
   Number.isFinite(Number(v))&&Number(v)>=0?sum+Math.round(Number(v)*100):sum,0);
 const budgetSet=Object.entries(targets).some(([name,v])=>
  !['Income','Transfer'].includes(name)&&v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0);
 return {month,asOf,rows,categories,spentCents,pendingCents,expectedCents,
  usedCents:spentCents+pendingCents+expectedCents,totalBudgetCents,
  budgetSet,expectedIncluded:!!projection};
}

// Only already-visible posted Budget lines can be edited. Never allow a
// bearer to classify unknown transaction IDs, money movement, other months,
// pending charges, expected bills or a whole split Amazon charge.
function selection(state,visible,choice){
 if(!choice||typeof choice!=='object'||Array.isArray(choice)||
    Object.keys(choice).sort().join(',')!=='category,id,lineIndex,note'||
    typeof choice.id!=='string'||!choice.id||choice.id.length>200||
    typeof choice.category!=='string'||!visible.categories.includes(choice.category)||
    typeof choice.note!=='string'||choice.note.length>1000||
    !(choice.lineIndex===null||Number.isSafeInteger(choice.lineIndex)&&choice.lineIndex>=0))
  return null;
 const entry=visible.rows.flatMap(r=>r.items||[]).find(e=>
  e.source==='posted'&&e.id===choice.id&&e.lineIndex===choice.lineIndex);
 const raw=state.transactions?.[choice.id];
 if(!entry||!raw||raw.pending||!entry.id||!Number.isSafeInteger(entry.cents)||
    entry.cents<=0)return null;
 const split=state.ledgerAdjustments?.amazonAllocations?.[choice.id];
 // Split identities must be validated again against the immutable bank
 // charge, not trusted from an arbitrary browser payload.
 if(choice.lineIndex!==null){
  if(!Array.isArray(split?.lines)||split.amountCents!==Math.round(Number(raw.amount)*100)||
    split.lines.reduce((n,l)=>n+l.cents,0)!==split.amountCents||
    !split.lines[choice.lineIndex]||
    split.lines[choice.lineIndex].cents!==entry.cents)return null;
 }else if(Array.isArray(split?.lines)&&split.lines.length)return null;
 return entry;
}
function change(state,choice,entry){
 const previous=state.ledgerAdjustments||{},id=choice.id;
 const overrides={...(previous.categoryOverrides||{})},
  provenance={...(previous.categoryProvenance||{})},
  allocations={...(previous.amazonAllocations||{})};
 let categoryChanged=entry.category!==choice.category;
 if(categoryChanged&&choice.lineIndex!==null){
  const prior=allocations[id],lines=prior.lines.map((x,i)=>i===choice.lineIndex?
   {...x,category:choice.category}:x);
  allocations[id]={...prior,lines};
  overrides[id]=lines.some(x=>x.category==='Uncategorized')?
   'Uncategorized':lines[0].category;
  provenance[id]={...provenance[id],source:'manual-item',
   category:overrides[id],lines:{...(provenance[id]?.lines||{}),
    [choice.lineIndex]:{source:'manual',category:choice.category}}};
 }else if(categoryChanged){
  overrides[id]=choice.category;
  provenance[id]={source:'manual',category:choice.category};
 }
 const predictions=previous.predictions||{},transactionNotes={...(predictions.transactionNotes||{})},
  noteKey=keyFor(state.transactions[id]),value=choice.note.trim(),
  noteChanged=(transactionNotes[noteKey]||'')!==value;
 if(noteChanged){if(value)transactionNotes[noteKey]=value;else delete transactionNotes[noteKey]}
 return {adjustments:{...previous,categoryOverrides:overrides,
  categoryProvenance:provenance,amazonAllocations:allocations,
  predictions:noteChanged?{...predictions,transactionNotes}:predictions},
  categoryChanged,noteChanged};
}
module.exports={build,selection,change};
