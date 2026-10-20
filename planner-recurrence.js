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
const variableShopping=/\b(?:costco|safeway|walmart|amazon|grocery|target|restaurant|starbucks|fuel|gas station|chevron|shell|coffee|uber|lyft)\b/i;
const obviousInternalTransfer=/\b(?:transfer to|transfer from|account transfer|savings transfer|xfer|credit card payment|payment to visa|payment to mastercard)\b/i;
const singleFixedBill=/\b(?:mortgage|mtg|home loan|rent|lease payment|loan payment|car payment|subscription|membership|autopay|monthly fee|recurring|netflix|spotify|hulu|gym|daycare|tuition)\b/i;
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
 // A bank may call an ordinary payment an ACH transfer. Only unpaired
 // outgoing debits can be considered expenses; never turn a genuine paired
 // account-to-account transfer into a second cash withdrawal.
 if(t.type==='transfer'&&t.cashDirection==='out'&&!t.pairedTransactionId)return 'expense';
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
// Two equally priced, same-merchant bank transactions must demonstrate a
// plausible cadence. A matching calendar day alone never proves a schedule.
const cadenceBetween=(a,b)=>{
 const gap=dayDiff(b,a),months=monthNumber(b)-monthNumber(a),
  spread=Math.abs(Number(b.slice(-2))-Number(a.slice(-2)));
 if(Math.abs(gap-7)<=1)return 'weekly';
 if(Math.abs(gap-14)<=2)return 'biweekly';
 if(months===1&&spread<=5)return 'monthly';
 if(months===3&&spread<=5)return 'quarterly';
 if(months===6&&spread<=5)return 'semiannual';
 if(months===12&&spread<=5)return 'annual';
 return null;
};
const recentEnough=(cadence,age)=>age<=({
 weekly:17,biweekly:31,monthly:66,quarterly:125,semiannual:215,annual:400
}[cadence]||66);
const nextOccurrence=(last,cadence,n)=>cadence==='weekly'?shift(last,n*7):
 cadence==='biweekly'?shift(last,n*14):
 monthly(last,n*({monthly:1,quarterly:3,semiannual:6,annual:12}[cadence]||1),
 Number(last.slice(-2)));
const clearlyMonthlyFromOne=t=>{
 const p=pfc(t),detail=String(p.detailed||'').toUpperCase(),
  name=String(t.merchant||'');
 // A lone insurance, utility or payroll payment may be annual, variable,
 // or biweekly. Leave those in Reviews until their schedule is evidenced.
 return isMortgage(t)||singleFixedBill.test(name)||
  /SUBSCRIPTIONS|RECURRING|MORTGAGE|RENT_PAYMENT|RENT_AND_UTILITIES_RENT|LOAN_PAYMENTS_AUTO|AUTO_LOAN|LOAN_PAYMENT/.test(detail);
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
   amount=cents(last.amount),recentRows=rows.slice(-3),
   matchingLast=rows.length>=2&&cents(rows.at(-2).amount)===amount,
   cadence=matchingLast?cadenceBetween(rows.at(-2).date,last.date):null,
   age=dayDiff(asOf,last.date),
   single=rows.length===1&&age<=50&&clearlyMonthlyFromOne(last),
   schedule=cadence||'monthly',
   recurring=Boolean(cadence)&&recentEnough(cadence,age),
   irregular=variableShopping.test(g.merchant),
   transferUncertain=rows.some(t=>t.type==='transfer'&&
    obviousInternalTransfer.test(String(t.merchant||''))),
   threeConsistent=recentRows.length===3&&recentRows.every(t=>cents(t.amount)===amount)&&
    cadenceBetween(recentRows[0].date,recentRows[1].date)===cadence&&
    cadenceBetween(recentRows[1].date,recentRows[2].date)===cadence,
   sameMonthExtra=['monthly','quarterly','semiannual','annual'].includes(schedule)&&
    rows.filter(t=>t.date.slice(0,7)===last.date.slice(0,7)).length>1,
   matched=recurring&&!sameMonthExtra,
   high=single||matched&&(!irregular||threeConsistent)&&!transferUncertain;
  // Existing user decisions win over new inferences, even if they moved
  // the day, amount, or converted an ACH transfer into an expense.
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
  if(blocked||manuallyScheduled)continue;
  if(!single&&!recurring)continue;
  // A multi-charge merchant, store visits that lack a third observation,
  // or an unpaired transfer that looks internal goes to Reviews.
  if(!high||sameMonthExtra){
   review.push({accountId:g.accountId,merchant:g.merchant,amount:amount/100,
    reason:sameMonthExtra?'Several payments to the same merchant within one cycle':
     transferUncertain?'Unpaired bank transfer needs account confirmation':
     'Repeating amount needs more evidence before automatic forecasting',
    observed:rows.length,frequency:schedule,
    date:nextOccurrence(last.date,schedule,1)});
   continue;
  }
  const observed=single?1:threeConsistent?3:2;
  // Generate the full 90-day horizon for every supported frequency.
  // Quarterly and annual payments are never silently made monthly.
  for(let n=1;n<=110;n++){
   const when=nextOccurrence(last.date,schedule,n);
   if(when>through)break;
   if(when<=asOf)continue;
   events.push({id:'auto-fixed|'+g.key+'|'+when,
    date:when,amount:amount/100,merchant:g.merchant,accountId:g.accountId,
    account:g.accountId,type:g.kind,category:last.category||'Other',
    source:'early-bank-inference',cadence:schedule,observations:observed,
    planConfidence:single?(isMortgage(last)?'strong-mortgage-evidence':'single-identified-payment'):
     'strong-repeating-payment-evidence',
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
   // Amount differences are not proof of a duplicate. Only an explicit
   // owner-edited schedule may replace a different auto-inferred amount
   // for the same merchant and billing month. Competing bank engines must
   // not silently erase distinct payments from one merchant.
   const keep=matches[0];
   if(!sameAmount){
    const explicit=x=>x.source==='user-recurring'||x._forecastExtra||
     x.source==='owner-bill'||x.source==='manual'||x.source==='future-add';
    const inferred=x=>x.source==='early-bank-inference'||
     x.source==='historical'||x.source==='bank-inferred';
    const ownerOverride=(explicit(item)&&inferred(keep)||
     explicit(keep)&&inferred(item))&&
     item.date.slice(0,7)===keep.date.slice(0,7);
    if(!ownerOverride){
     conflicts.push({a:item.id,b:keep.id,merchant:item.merchant,
      reason:'Same merchant and date but different amounts: needs review'});
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