/* Conservative-but-early cash commitment detection and cross-source
 * deduplication. Actual bank rows are never edited. The same scheduled
 * cash movement is represented by one event even when it originated in
 * imported-pattern inference, new detection and an owner-confirmed rule. */
(function(root){
'use strict';
const cents=x=>Math.round(Number(x)*100);
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&
 Number.isFinite(Date.parse(s+'T12:00:00Z'));
const dayDiff=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
const shift=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const monthNumber=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7));
const endDay=m=>new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).getUTCDate();
const monthFrom=(s,n)=>{const [y,m]=s.slice(0,7).split('-').map(Number);
 return new Date(Date.UTC(y,m-1+n,1,12)).toISOString().slice(0,7)};
const monthly=(dateValue,n,day)=>{
 const month=monthFrom(dateValue,n);
 return month+'-'+String(Math.min(Number(day),endDay(month))).padStart(2,'0');
};
const mortgageText=/\b(?:mortgage|mtg|home loan|home mtg|pennymac|loandepot|newrez|shellpoint|mr cooper)\b/i;
const recurringBill=/\b(?:mortgage|mtg|home loan|rent|loan payment|car payment|insurance|premium|membership|subscription|internet|cellular|phone plan|tuition|daycare|utility|electric|water|sewer|netflix|spotify|hulu|gym)\b/i;
const variableShopping=/\b(?:costco|safeway|walmart|amazon|grocery|target|restaurant|starbucks|fuel|gas station|chevron|shell)\b/i;
const pfc=t=>t.personal_finance_category||t.source?.personalFinanceCategory||{};
const isMortgage=t=>mortgageText.test(String(t.merchant||''))||
 /MORTGAGE|HOME_LOAN/.test(String(pfc(t).detailed||'').toUpperCase())||
 t.accountingKind==='loan_payment'&&/MORTGAGE/.test(String(t.category||'').toUpperCase());
const accountId=(t,accounts)=>{
 const raw=String(t.accountId||t.account||'');
 const found=(accounts||[]).filter(a=>[a.id,a.name,a.transactionAccount].some(s=>String(s||'')===raw));
 return found.length===1?String(found[0].id):raw;
};
const actualKind=t=>{
 if(t.type==='expense'||t.type==='income')return t.type;
 if(t.type==='transfer'&&t.cashDirection==='out'&&!t.pairedTransactionId&&isMortgage(t))return 'expense';
 return null;
};
const bankEligible=(t,accounts,asOf)=>{
 if(!t||t.pending||!date(t.date)||t.date>asOf||!(Number(t.amount)>0)||t.pairedTransactionId)return false;
 const id=accountId(t,accounts),a=(accounts||[]).find(x=>String(x.id)===id);
 if(!a||String(a.accountType||a.type||'').toLowerCase()==='loan')return false;
 const credit=String(a.accountType||a.type||'').toLowerCase()==='credit';
 if(credit&&actualKind(t)!=='expense')return false;
 return Boolean(actualKind(t));
};
const isStrongSource=t=>{
 const p=pfc(t),detail=String(p.detailed||'').toUpperCase(),
  primary=String(p.primary||'').toUpperCase();
 const payroll=t.type==='income'&&
  (/INCOME_WAGES|PAYROLL|SALARY|WAGES/.test(detail)||primary==='INCOME'&&
   /payroll|salary|wages|paycheck/i.test(String(t.merchant||''))||
   /payroll|salary|paycheck|employer deposit/i.test(String(t.merchant||'')));
 return payroll||isMortgage(t)||
  /SUBSCRIPTIONS|INSURANCE|RENT_AND_UTILITIES|RENT|LOAN_PAYMENT|RECURRING/.test(detail)||
  recurringBill.test(String(t.merchant||''))||
  ['Housing','Insurance','Subscriptions','Utilities','Kids & Family'].includes(t.category);
};
function infer(records,snapshot,predictions={},options={}){
 const accounts=snapshot.accounts||[],asOf=String(snapshot.asOf||''),days=Number(options.days||90);
 if(!date(asOf))return {events:[],review:[],diagnostics:[]};
 const through=shift(asOf,days),groups=new Map();
 for(const t of records||[]){
  if(!bankEligible(t,accounts,asOf))continue;
  const aid=accountId(t,accounts),name=norm(t.merchant),kind=actualKind(t);
  if(!name)continue;
  const key=[aid,kind,name].map(encodeURIComponent).join('|');
  if(!groups.has(key))groups.set(key,{key,accountId:aid,merchant:String(t.merchant),
   kind,rows:[]});
  groups.get(key).rows.push(t);
 }
 const events=[],review=[],diagnostics=[];
 const excluded=predictions.plannerRoutineDecisions||{},dismissed=predictions.historyPatternDecisions||{};
 for(const g of groups.values()){
  const rows=g.rows.sort((a,b)=>a.date.localeCompare(b.date)),last=rows.at(-1),
   amount=cents(last.amount),same=rows.filter(t=>cents(t.amount)===amount),
   lastTwo=same.slice(-2),months=lastTwo.map(t=>t.date.slice(0,7)),
   step=lastTwo.length===2?monthNumber(months[1])-monthNumber(months[0]):0,
   spread=lastTwo.length===2?Math.abs(Number(lastTwo[1].date.slice(-2))-
    Number(lastTwo[0].date.slice(-2))):Infinity,
   multipleInMonth=rows.filter(t=>t.date.slice(0,7)===last.date.slice(0,7)).length>1,
   mortgage=isMortgage(last),strong=isStrongSource(last),
   twoConsecutive=step===1&&spread<=5&&!multipleInMonth,
   recent=dayDiff(asOf,last.date)<=66,
   singleMortgage=mortgage&&rows.length===1&&dayDiff(asOf,last.date)<=50,
   matchedMonths=twoConsecutive&&lastTwo.length===2&&recent;
  // An explicit not-recurring decision is never overridden by auto inference.
  const aliases=[g.accountId,last.account,last.accountId,
   ...(accounts||[]).filter(a=>String(a.id)===g.accountId)
    .flatMap(a=>[a.name,a.transactionAccount])].map(String).filter(Boolean);
  const keys=new Set(aliases.flatMap(a=>[
   [g.kind,a,norm(last.merchant)].join('|'),
   [last.type,a,norm(last.merchant)].join('|')]));
  const rejected=[...keys].some(key=>excluded[key]?.status==='excluded'&&
   Math.abs(cents(excluded[key].amount)-amount)<=1);
  const dismissedInReviews=[g.kind,last.type].some(kind=>dismissed[
   [g.accountId,kind,norm(last.merchant),String(amount)].map(encodeURIComponent).join('|')
  ]==='dismissed');
  const dismissedMortgage=(predictions.mortgageReviewDismissals||[]).includes(
   ['mortgage',g.accountId,norm(last.merchant),String(amount)].map(encodeURIComponent).join('|'));
  const blocked=rejected||dismissedInReviews||dismissedMortgage;
  const manuallyScheduled=(predictions.futureRecurringRules||[]).some(r=>{
   if(r.kind!=='event'||String(r.originalAccountId||r.accountId)!==g.accountId)return false;
   const names=Array.isArray(r.matchNames)?r.matchNames:
    [norm(r.originalMerchant||r.merchant)];
   return names.includes(norm(last.merchant));
  });
  // A user-confirmed rule is authoritative even if its due date has moved
  // outside the original posting month; do not resurrect an old inference.
  if(blocked||manuallyScheduled)continue;
  // A one-off vague expense is not reliable, and two similar store visits are
  // a REVIEW item, not a guaranteed $X bill.
  if(!singleMortgage&&!matchedMonths)continue;
  const high=singleMortgage||(matchedMonths&&strong);
  const observed=matchedMonths?lastTwo.length:1;
  if(!high){
   review.push({accountId:g.accountId,merchant:g.merchant,amount:amount/100,
    reason:'Only two matching payments, merchant is not an identified fixed bill',
    observed,frequency:'monthly',date:monthly(last.date,1,Number(last.date.slice(-2)))});
   continue;
  }
  if(rows.some(t=>t.date.slice(0,7)===last.date.slice(0,7)&&cents(t.amount)!==amount)){
   review.push({accountId:g.accountId,merchant:g.merchant,amount:amount/100,
    reason:'Multiple payments to the same merchant in one month',observed,
    frequency:'monthly'});
   continue;
  }
  // Do not invent a future monthly payment from a payment last seen years
  // ago, or from a partial set of non-monthly historical transactions.
  const anchorDay=Number(last.date.slice(-2));
  for(let n=0;n<4;n++){
   const when=monthly(last.date,n+1,anchorDay);
   if(when<=asOf||when>through)continue;
   events.push({id:'auto-fixed|'+g.key+'|'+when,
    date:when,amount:amount/100,merchant:g.merchant,accountId:g.accountId,
    account:g.accountId,type:g.kind,category:last.category||'Housing',
    source:'early-bank-inference',cadence:'monthly',observations:observed,
    planConfidence:singleMortgage?'strong-mortgage-evidence':'strong-two-payment-evidence',
    originalSourceType:last.type,originalRecordId:String(last.id||'')});
  }
 }
 return {events,review,diagnostics};
}
const eventType=e=>{
 const type=e.type||e.kind;
 return type==='card_purchase'?'expense':type==='card_refund'?'refund':
  type==='transfer_out'||type==='transfer_in'?'transfer':type;
};
const account=e=>e.accountId||e.account||'';
const mortgageEvent=e=>mortgageText.test(String(e.merchant||''))||
  /MORTGAGE/.test(String(e.category||'').toUpperCase());
const sameBill=(a,b)=>{
 // The same lender can service different mortgages. Never merge two bills
 // just because their descriptions contain "mortgage" and amounts coincide.
 const aliases=x=>[x.merchant,x.originalMerchant,x._forecastOriginalMerchant]
  .map(norm).filter(Boolean);
 const aNames=aliases(a),bNames=aliases(b);
 return aNames.some(name=>bNames.includes(name));
};
const weight=e=>e.source==='user-recurring'?100:
 e.source==='future-add'||String(e.id||'').startsWith('future-add|')?95:
 e.source==='owner-bill'||e.source==='manual'?90:
 e.source==='early-bank-inference'?75:
 e.planConfidence==='confirmed'?70:40;
function dedupeEvents(events,accounts=[],options={}){
 const input=(events||[]).filter(x=>x&&date(x.date)&&Number(x.amount)>0)
  .map((e,i)=>({...e,_dedupeIndex:i}));
 const sorted=input.sort((a,b)=>weight(b)-weight(a)||a._dedupeIndex-b._dedupeIndex);
 const kept=[],removed=[],conflicts=[];
 for(const item of sorted){
  const acct=accountId(item,accounts),type=eventType(item);
  const matches=kept.filter(keep=>{
   if(accountId(keep,accounts)!==acct||eventType(keep)!==type||
    !sameBill(item,keep))return false;
   const close=Math.abs(dayDiff(item.date,keep.date))<=
    (['weekly','biweekly'].includes(String(item.cadence))?2:5);
   const explicitSource=x=>x.source==='user-recurring'||x._forecastExtra||
    x.source==='owner-bill'||x.source==='manual'||x.source==='future-add';
   const inferredSource=x=>x.source==='early-bank-inference'||
    x.source==='historical'||x.source==='bank-inferred';
   const inferredAndExplicit=explicitSource(item)&&inferredSource(keep)||
    explicitSource(keep)&&inferredSource(item);
   // A monthly due date can be deliberately moved by the owner, well
   // beyond the bank's historical posting day. It must replace (not join)
   // the automatic debit for that *same billing month*, but only where the
   // overlapping inference is a single monthly obligation.
   const sameMonth=item.date.slice(0,7)===keep.date.slice(0,7);
   return close||(inferredAndExplicit&&sameMonth&&
    norm(item.merchant)===norm(keep.merchant));
  });
  if(matches.length===1){
   const candidate=matches[0],sameSource=String(item.source||'')===String(candidate.source||''),
    sameDate=item.date===candidate.date,
    sameAmount=Math.abs(cents(item.amount)-cents(candidate.amount))<=1;
   if(sameSource&&(!sameDate||!sameAmount)){
    // Separate same-source charges could be legitimate; preserve both
    // instead of silently erasing a mortgage installment or payday.
    conflicts.push({id:item.id,merchant:item.merchant,matching:candidate.id,
     reason:'Close forecast payments from the same source need confirmation'});
    kept.push(item);continue;
   }
   // Exact source identity and dates are stronger than amount. A manually
   // adjusted obligation replaces a stale inferred amount, not both.
   const keep=matches[0];
   if(Math.abs(cents(item.amount)-cents(keep.amount))>1){
    const ratio=Math.abs(Number(item.amount)-Number(keep.amount))/
     Math.max(Number(item.amount),Number(keep.amount));
    // Never merge two different amounts without a uniquely identified
    // bill. Same merchant and <=20% variance can be a rate change.
    if(ratio>.2&&!mortgageEvent(item)&&item.merchant!==keep.merchant){
     conflicts.push({a:item.id,b:keep.id,reason:'Competing amounts: needs review'});
     kept.push(item);continue;
    }
   }
   removed.push({id:item.id,keptId:keep.id,merchant:item.merchant,
    reason:'Same account, bill, and payment cycle already predicted'});
  }else if(matches.length>1){
   conflicts.push({id:item.id,merchant:item.merchant,reason:'Several possible matching scheduled payments'});
   // Do not silently delete when a pair is genuinely ambiguous.
   kept.push(item);
  }else kept.push(item);
 }
 kept.sort((a,b)=>a._dedupeIndex-b._dedupeIndex);
 return {events:kept.map(({_dedupeIndex,...e})=>e),removed,conflicts};
}
const api={infer,dedupeEvents,isMortgage,accountId,actualKind};
root.HouseholdPlannerRecurrence=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);