/* Household Ledger: unified future ledger.
 * Historical Plaid facts never mutate. Every future cash movement comes from
 * exactly one canonical ledger. Balance projection only reads that ledger.
 */
(function(root){
'use strict';
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const cents=n=>Math.round(Number(n)*100);
const money=n=>cents(n)/100;
const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&
 new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const add=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const diff=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7));
const month=(s,n)=>new Date(Date.UTC(+s.slice(0,4),+s.slice(5,7)-1+n,1,12)).toISOString().slice(0,7);
const monthDate=(s,n,day=+s.slice(8,10))=>{const m=month(s,n);
 return m+'-'+String(Math.min(day,new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).getUTCDate())).padStart(2,'0')};
const twiceDates=(from,slots,end)=>{const dates=[];
 for(let m=0;m<8;m++)for(const day of slots){
  const d=monthDate(from,m,day);if(d>from&&d<=end)dates.push(d);
 }return dates.sort();};
const next=(s,f,n)=>f==='weekly'?add(s,n*7):f==='biweekly'?add(s,n*14):
 f==='every-4-weeks'?add(s,n*28):
 monthDate(s,n*({monthly:1,quarterly:3,semiannual:6,annual:12}[f]||1));
const phaseOf=date=>Math.floor(Date.parse(date+'T12:00:00Z')/86400000)%28;
const phaseDistance=(a,b)=>{const n=Math.abs(phaseOf(a)-phaseOf(b));return Math.min(n,28-n)};
const phaseMatch=(a,b)=>valid(a)&&valid(b)&&phaseDistance(a,b)<=3;
const signature=(accountId,type,merchant)=>[accountId,type,norm(merchant)].map(encodeURIComponent).join('|');
const isExcludedPattern=(prefs,accountId,type,merchant)=>Boolean(
 prefs?.futureRecurrenceExclusions?.[signature(accountId,type,merchant)]);
const suppressedRecurrence=(prefs,e)=>{
 // Removing a mistaken inferred income series must not hide owner-confirmed
 // schedules with the same employer, account and cash direction.
 if(e.source==='historical'&&e._seriesKey&&
  prefs?.futureRecurrenceExclusions?.['auto-series|'+encodeURIComponent(e._seriesKey)])return true;
 const account=e._forecastOriginalAccountId||e.accountId,
  type=e._forecastOriginalType||e.type,
  merchant=e._forecastOriginalMerchant||e.merchant;
 if(isExcludedPattern(prefs,account,type,merchant))return true;
 const prefix=signature(account,type,merchant)+'|phase';
 return Object.entries(prefs?.futureRecurrenceExclusions||{}).some(([key,item])=>
  key.startsWith(prefix)&&valid(item.phaseDate)&&valid(e.date)&&
  phaseDistance(item.phaseDate,e.date)<=3);
};
const billName=/\b(?:mortgage|mtg|home loan|rent|lease payment|loan payment|auto loan|car payment|subscription|membership|autopay|recurring|monthly fee|insurance premium|netflix|spotify|hulu|daycare|tuition)\b/i;
const variableName=/\b(?:safeway|costco|walmart|amazon|grocery|supermarket|target|restaurant|coffee|starbucks|fuel|gas station|shell|chevron|uber|lyft)\b/i;
const internalName=/\b(?:transfer to|transfer from|savings transfer|account transfer|xfer|credit card payment|payment to visa|payment to mastercard)\b/i;
const metadata=t=>t.personal_finance_category||t.source?.personalFinanceCategory||{};
const trusted=t=>billName.test(String(t.merchant||''))||
 /(?:MORTGAGE|SUBSCRIPTION|RECURRING|RENT_PAYMENT|RENT_AND_UTILITIES_RENT|AUTO_LOAN|LOAN_PAYMENT)/.test(String(metadata(t).detailed||'').toUpperCase());
const cadence=(a,b)=>{
 const days=diff(b,a),months=index(b)-index(a),
  daySpread=Math.abs(+a.slice(-2)-+b.slice(-2));
 if(Math.abs(days-7)<=1)return 'weekly';
 if(Math.abs(days-14)<=2)return 'biweekly';
 for(const [span,name] of [[1,'monthly'],[3,'quarterly'],[6,'semiannual'],[12,'annual']])
  if(months===span&&daySpread<=5)return name;
 return null;
};
const horizon=(s,days)=>add(s,days);
const accountId=(row,accounts)=>{
 const raw=String(row.accountId||row.account||row.fromAccountId||'');
 const matches=accounts.filter(a=>[a.id,a.name,a.transactionAccount].some(n=>String(n||'')===raw));
 return matches.length===1?String(matches[0].id):raw;
};
const direction=t=>t.type==='expense'||t.type==='income'?t.type:
 t.type==='transfer'&&!t.pairedTransactionId&&t.cashDirection==='out'?'expense':null;
function analyze(rows,accounts,asOf,prefs={},days=90){
 const groups=new Map(),end=horizon(asOf,days),excluded=prefs.plannerRoutineDecisions||{},
  dismiss=prefs.historyPatternDecisions||{},rules=prefs.futureRecurringRules||[];
 for(const t of rows||[]){
  if(!t||t.pending||!valid(t.date)||t.date>asOf||!(Number(t.amount)>0)||
   t.pairedTransactionId)continue;
  const aid=accountId(t,accounts),acct=accounts.find(a=>String(a.id)===aid);
  if(!acct||String(acct.type||acct.accountType||'').toLowerCase()==='loan')continue;
  const kind=direction(t),reviewType=kind||(t.type==='refund'?'refund':
   t.type==='transfer'&&t.cashDirection==='in'?'income':null);
  if(!reviewType||!norm(t.merchant))continue;
  const id=signature(aid,reviewType,t.merchant);
  if(!groups.has(id))groups.set(id,{id,accountId:aid,accountName:acct.name||aid,
   merchant:String(t.merchant),kind:reviewType,rows:[]});
  groups.get(id).rows.push(t);
 }
 const automatic=[],review=[],conflicts=[];
 for(const g of groups.values()){
  g.rows.sort((a,b)=>a.date.localeCompare(b.date));
  const t=g.rows.at(-1),age=diff(asOf,t.date),amount=cents(t.amount),
   latest=g.rows.slice(-3),lastTwo=g.rows.slice(-2),lastFour=g.rows.slice(-4),
   // Payroll that posts every 14 days can temporarily resemble two fixed
   // calendar dates per month. Prioritize the observed interval, not the
   // accidental calendar alignment, to avoid inventing 1st/15th paydays.
   biweeklyIncome=g.kind==='income'&&lastFour.length===4&&
    lastFour.slice(1).every((r,i)=>Math.abs(diff(r.date,lastFour[i].date)-14)<=1),
   twice=lastFour.length===4&&
    lastFour[0].date.slice(0,7)===lastFour[1].date.slice(0,7)&&
    lastFour[2].date.slice(0,7)===lastFour[3].date.slice(0,7)&&
    index(lastFour[2].date)-index(lastFour[0].date)===1&&
    Math.abs(+lastFour[0].date.slice(-2)-+lastFour[2].date.slice(-2))<=2&&
    Math.abs(+lastFour[1].date.slice(-2)-+lastFour[3].date.slice(-2))<=2,
   slots=twice?[+lastFour[2].date.slice(-2),+lastFour[3].date.slice(-2)]:null,
   f=biweeklyIncome?'biweekly':twice?'twice-monthly':
    lastTwo.length===2?cadence(lastTwo[0].date,lastTwo[1].date):null,
   f3=g.rows.length>=3&&f&&cadence(g.rows.at(-3).date,g.rows.at(-2).date)===f,
   recent={weekly:17,biweekly:31,monthly:66,quarterly:125,semiannual:215,annual:400},
   spaced=Boolean(f)&&age<=(f==='twice-monthly'?40:recent[f])&&
    (f==='twice-monthly'||g.rows.length<3||f3),
   one=g.rows.length===1&&age<=50&&trusted(t)&&g.kind==='expense'&&
    !internalName.test(g.merchant),
   category=String(metadata(t).detailed||'').toUpperCase(),
   unpairedTransfer=g.rows.some(r=>r.type==='transfer'),
   transferRisk=internalName.test(g.merchant)||
    unpairedTransfer&&(g.kind==='income'||/TRANSFER/.test(category)&&!trusted(t)),
   multiCycle=f&&!['weekly','biweekly','twice-monthly'].includes(f)&&
    g.rows.filter(r=>r.date.slice(0,7)===t.date.slice(0,7)).length>1,
   varying=latest.some(r=>cents(r.amount)!==amount),
   // Detect an A/B/A/B biweekly payroll pattern only when two full cycles
   // show the same amount on each phase. Near-equal A and B are distinct
   // if their phase difference is meaningful compared with pay variability.
   payroll=/(payroll|paycheck|salary|wage|employer|direct deposit)/i.test(g.merchant)||
    /INCOME_WAGES/.test(String(metadata(t).detailed||'').toUpperCase()),
   lastPaychecks=g.rows.slice(-4),
   payA=lastPaychecks.length===4?money((Number(lastPaychecks[0].amount)+
    Number(lastPaychecks[2].amount))/2):0,
   payB=lastPaychecks.length===4?money((Number(lastPaychecks[1].amount)+
    Number(lastPaychecks[3].amount))/2):0,
   typicalPay=(payA+payB)/2,
   pairTolerance=Math.max(3,typicalPay*.003),
   semiMonthlyExact=Boolean(g.kind==='income'&&f==='twice-monthly'&&
    lastFour.length===4&&
    Math.abs(Number(lastFour[0].amount)-Number(lastFour[2].amount))<=pairTolerance&&
    Math.abs(Number(lastFour[1].amount)-Number(lastFour[3].amount))<=pairTolerance),
   alternating=Boolean(g.kind==='income'&&payroll&&f==='biweekly'&&
    lastPaychecks.length===4&&f3&&
    Math.abs(Number(lastPaychecks[0].amount)-Number(lastPaychecks[2].amount))<=pairTolerance&&
    Math.abs(Number(lastPaychecks[1].amount)-Number(lastPaychecks[3].amount))<=pairTolerance&&
    Math.abs(payA-payB)>=Math.max(2,typicalPay*.004)),
   // Other variable bill amounts use one rolling average.
   estimate=money(latest.reduce((total,r)=>total+Number(r.amount),0)/latest.length),
   // Never infer variable purchases at grocery/retail merchants merely
   // because they occurred near the same day three months in a row.
   // Inferred income must use a bank-posted paycheck amount. A real 1st/15th
   // salary is allowed only when BOTH calendar slots repeat their own amount;
   // all other unstable payroll is reviewed rather than averaged.
   enough=one||spaced&&!transferRisk&&
    (g.kind==='income'?(f==='twice-monthly'?semiMonthlyExact:
      f==='biweekly'?(!varying||alternating):f3||!varying):
     variableName.test(g.merchant)?!varying&&f3:
     (twice||f3||!varying)),
   planDate=next(t.date,f||'monthly',1);
  const aliases=[g.accountId,g.accountName,t.account,t.accountId].map(String).filter(Boolean);
  const blocked=aliases.some(a=>[g.kind,t.type].some(type=>{
   const d=excluded[[type,a,norm(g.merchant)].join('|')];
   return d?.status==='excluded'&&Math.abs(cents(d.amount)-amount)<=1;
  }))||[g.kind,t.type].some(type=>dismiss[
   [g.accountId,type,norm(g.merchant),String(amount)].map(encodeURIComponent).join('|')
  ]==='dismissed')||(prefs.mortgageReviewDismissals||[]).includes(
   ['mortgage',g.accountId,norm(g.merchant),String(amount)].map(encodeURIComponent).join('|'));
  if(blocked||isExcludedPattern(prefs,g.accountId,g.kind,g.merchant))continue;
  const owners=rules.filter(r=>r.kind==='event'&&
   String(r.originalAccountId||r.accountId)===g.accountId&&
   (!r.type||r.type===g.kind)&&
   (r.matchNames||[norm(r.originalMerchant||r.merchant)]).includes(norm(g.merchant)));
  // A confirmed recurring rule OWNS the entire historical stream. Different
  // amounts are normal for utilities and payroll and must not create another
  // forecast or a false warning for every monthly statement.
  // A confirmed four-week paycheck owns only its own payday phase;
  // the other paycheck may still be inferred as an independent stream.
  if(owners.some(r=>r.frequency!=='every-4-weeks'))continue;
  // The same merchant/month may contain two genuine bills. Do not pick one
  // automatically or erase a competing charge because its name is similar.
  if(multiCycle){conflicts.push({merchant:g.merchant,reason:'Multiple same-merchant payments this cycle'});}
  if(g.kind==='expense'||g.kind==='income'){
   const auto=Boolean(one||spaced)&&enough&&!multiCycle&&
    !transferRisk&&g.kind!=='refund';
   if(auto){
    const rootSeries='series|'+g.id+'|',freq=f||'monthly';
    // Two alternating biweekly deposits are two independent four-week
    // schedules, 14 days apart. Each has its own ID, phase and dollar amount.
    const dates=freq==='twice-monthly'?twiceDates(t.date,slots,end):
     Array.from({length:110},(_,i)=>next(t.date,freq,i+1)).filter(d=>d<=end);
    for(const when of dates){
     if(when<=asOf)continue;
     const steps=freq==='biweekly'?Math.round(diff(when,t.date)/14):0,
      fourWeekPhase=alternating,
      semiSlot=semiMonthlyExact?slots.findIndex(day=>monthDate(when,0,day)===when):-1,
      series=rootSeries+(fourWeekPhase?'every-4-weeks|phase'+phaseOf(when):
       semiSlot>=0?'twice-monthly|slot'+slots[semiSlot]:freq),
      forecastAmount=fourWeekPhase?(steps%2===1?payA:payB):
       semiSlot>=0?money(lastFour[semiSlot+2].amount):
       g.kind==='income'?money(t.amount):estimate;
     automatic.push({id:'auto|'+series+'|'+when,date:when,amount:forecastAmount,
      merchant:g.merchant,accountId:g.accountId,type:g.kind,category:t.category||'Other',
      source:'historical',cadence:fourWeekPhase?'every-4-weeks':freq,
      _seriesKey:series,_seriesDate:when,
      planConfidence:one?'identified-single-bill':'observed-recurring-pattern',
      amountEstimate:fourWeekPhase?'four-week-paycheck':
       semiSlot>=0?'bank-posted-calendar-paycheck':
       g.kind==='income'?'bank-posted-income':
       varying?'recent-history-average':'last-posted-amount',
      historicalIds:(fourWeekPhase?
       lastPaychecks.filter(x=>phaseMatch(x.date,when)):
       semiSlot>=0?[lastFour[semiSlot],lastFour[semiSlot+2]]:latest)
       .map(x=>String(x.id||''))});
    }
    continue;
   }
  }
  // Reviews represent candidates only. Nothing here changes a balance.
  if(age<=(g.rows.length===1&&!trusted(t)?45:recent[f||'monthly']||75)&&
   (g.rows.length>=2||trusted(t)))
   review.push(reviewItem(g,g.rows,f,t,planDate));
 }
 review.sort((a,b)=>b.priority-a.priority||b.occurrences-a.occurrences||
  b.lastDate.localeCompare(a.lastDate));
 return {automatic,review:review.slice(0,80).map(({priority,...p})=>p),conflicts};
}
function reviewItem(g,same,f,t,planDate){
 return {key:[g.accountId,g.kind,norm(g.merchant),String(cents(t.amount))].map(encodeURIComponent).join('|'),
 accountId:g.accountId,accountName:g.accountName,merchant:g.merchant,type:g.kind,
 amount:money(t.amount),frequency:f||'monthly',nextDate:planDate,
 confidence:f?'Low':'Needs confirmation',occurrences:same.length,lastDate:t.date,
 examples:same.slice(-6).reverse().map(r=>({id:String(r.id||''),date:r.date,
  amount:Number(r.amount),merchant:String(r.merchant||'')})),
 reason:f?'Some repeating evidence, but the schedule requires confirmation':
  'Recurrence is not established; confirm only if you expect another payment',
 priority:f?3:trusted(t)?2:1};
}
const eventKey=(tools,e)=>tools.keyEvent(e.id,e.accountId);
function materialize(snapshot,rows,prefs={},tools,paymentEngine,days=90){
 const asOf=snapshot.asOf,end=horizon(asOf,days),accounts=snapshot.accounts||[];
 if(!valid(asOf)||!tools||!Array.isArray(accounts))throw Error('Valid snapshot and forecast tools required');
 const configuredCard=id=>{
  const account=accounts.find(a=>String(a.id)===String(id));
  if(!account||String(account.accountType||account.type||'').toLowerCase()!=='credit')
   return true;
  return Boolean(paymentEngine?.ready?.(
   (prefs.paymentRules||{})[String(id)],account,accounts));
 };
 const detected=analyze(rows,accounts,asOf,prefs,days),
  rules=(prefs.futureRecurringRules||[]).filter(r=>!isExcludedPattern(prefs,
   r.originalAccountId||r.accountId||r.fromAccountId,
   r.kind==='movement'?'transfer':r.type,r.originalMerchant||r.merchant)),
  series=prefs.futureSeriesEdits||{},edits=prefs.futureTransactionEdits||{},
  extras=prefs.futureTransactionAdds||[],entries=[],ids=new Set(),checks=[],warnings=[];
 const seen=(e)=>{if(ids.has(e.id)){checks.push({id:e.id,reason:'Duplicate future ledger ID'});return}
  ids.add(e.id);entries.push(e)};
 const ownerFor=(e)=>rules.some(r=>r.kind==='event'&&
  String(r.originalAccountId||r.accountId)===String(e.accountId)&&
  (!r.type||r.type===e.type)&&
  (r.matchNames||[norm(r.originalMerchant||r.merchant)]).includes(norm(
   e._forecastOriginalMerchant||e.merchant))&&
  (r.frequency!=='every-4-weeks'||!e.date||phaseMatch(r.anchorDate,e.date)));
 // Explicit rules come first, and always own their original bank series.
 const generated=tools.generatedRecurring(rules,add(asOf,-32),add(end,32));
 // Explicitly confirmed card schedules can be included without card autopay
 // setup. Unconfirmed automatic card-spend inference remains gated below.
 const ownerEntries=generated.events.map(e=>{
  const base=e._seriesDate||e.date,changed=tools.applySeries(e,base,e._seriesKey,series),
   rule=rules.find(r=>r.id===e.ruleId);
  return {...changed,_seriesDate:base,
   _forecastOriginalMerchant:rule?.originalMerchant||e.merchant,
   _forecastOriginalAccountId:rule?.originalAccountId||e.accountId,
   _forecastOriginalType:rule?.type||e.type,_forecastOriginalAmount:rule?.matchAmount||e.amount};
 });
 // User rules are filtered for posted coverage using existing bank facts.
 const covered=tools.postedCoverage({events:ownerEntries,plans:generated.plans},rules,rows,accounts,asOf);
 for(const e of covered.events)if(e.date>asOf&&e.date<=end)seen(e);
 for(const event of detected.automatic){
  if(!configuredCard(event.accountId)||
   ownerFor(event)||suppressedRecurrence(prefs,event))continue;
  const base=event.date,adjusted=tools.applySeries(event,base,event._seriesKey,series);
  if(adjusted.date<=asOf||adjusted.date>end)continue;
  seen({...adjusted,_seriesDate:base,_forecastOriginalMerchant:event.merchant,
   _forecastOriginalAccountId:event.accountId,_forecastOriginalType:event.type,
   _forecastOriginalAmount:event.amount});
 }
 // One-off forecast additions are independent of Plaid facts.
 for(const e of extras){
  if(e.type==='transfer'||
   rules.some(r=>r.sourceAddedId===e.id))continue;
  if(!valid(e.date)||e.date<=asOf||e.date>end)continue;
  // A one-time explicit payment from the same payee is NOT the recurring
  // schedule. Only an explicitly promoted sourceAddedId replaces that entry.
  const clash=entries.find(a=>a.accountId===e.accountId&&
   norm(a.merchant)===norm(e.merchant)&&a.type===e.type&&
   a.date.slice(0,7)===e.date.slice(0,7)&&Math.abs(diff(a.date,e.date))<=7);
  if(clash){
   if(clash.source==='historical'){ids.delete(clash.id);entries.splice(entries.indexOf(clash),1);
    checks.push({id:clash.id,keptId:e.id,reason:'Explicit user entry replaces auto estimate'});}
   else {warnings.push('Several explicit entries for '+e.merchant+' need review');}
  }
  seen({...e,source:'manual',_forecastExtra:true});
 }
 // Apply individual overrides exactly once before calculating card statements.
 function adjust(list){
  return list.flatMap(e=>{
   const edit=edits[eventKey(tools,e)];
   if(edit?.skipped)return [];
   const result=edit?{...e,...edit}:e;
   return result.date>asOf&&result.date<=end?[result]:[];
  });
 }
 const adjusted=adjust(entries);
 const payment=paymentEngine?.build?paymentEngine.build(snapshot,rows,adjusted,prefs,{days}):
  {plans:[],billEvents:[],warnings:[],statements:[],suppressedExpectedIds:[]};
 const suppressed=new Set((payment.suppressedExpectedIds||[]).map(String));
 const finalEvents=adjust(adjusted.filter(e=>!suppressed.has(String(e.id)))
  .concat((payment.billEvents||[]).filter(e=>!ownerFor(e))))
  .filter(e=>e.type!=='transfer'&&(e.source==='manual'||!suppressedRecurrence(prefs,e)));
 // All account-to-account movements use ONE linked record.
 const movementRules=covered.plans.map(m=>({...m,date:m.anchorDate,
  fromAccountId:m.fromAccountId,toAccountId:m.toAccountId,
  recurringRuleId:m.seriesRuleId,seriesKey:tools.manualSeriesKey(m.seriesRuleId),
  baseDate:m.anchorDate}));
 const plans=[...movementRules,...(payment.plans||[]).filter(p=>
  !movementRules.some(m=>m.fromAccountId===p.fromAccountId&&
   m.toAccountId===p.toAccountId&&m.date.slice(0,7)===p.anchorDate.slice(0,7)))
  .map(p=>({...p,date:p.anchorDate,seriesKey:tools.seriesPlan(p),
   // Statement autopay is a monthly series, even though each generated
   // occurrence enters the ledger as a one-time linked movement.
   cadence:p.cadence||(p.origin==='card-autopay'?'monthly':
    p.frequency==='once'?null:p.frequency||null),
   baseDate:p.anchorDate,recurringRuleId:p.seriesRuleId||null}))];
 for(const e of extras.filter(x=>x.type==='transfer'&&x.date>asOf&&x.date<=end)){
  // An explicit one-off transfer to a credit card supersedes a provisional
  // same-cycle history estimate. It must not create two checking withdrawals.
  const provisional=plans.findIndex(p=>p.origin==='card-history-estimate'&&
   String(p.fromAccountId)===String(e.fromAccountId)&&
   String(p.toAccountId)===String(e.toAccountId)&&
   p.date.slice(0,7)===e.date.slice(0,7));
  if(provisional>=0){checks.push({id:plans[provisional].id,keptId:e.id,
   reason:'Explicit card payment replaces provisional payment estimate'});
   plans.splice(provisional,1);}
  plans.push({...e,id:'future|'+e.id,fromAccountId:e.fromAccountId,toAccountId:e.toAccountId,
   source:'manual'});
 }
 const finalPlans=[];
 for(const p of plans){
  const moved=tools.applySeries(p,p.baseDate||p.date,p.seriesKey,series);
  const edit=edits[tools.keyMovement(moved.id)];
  if(edit?.skipped)continue;
  const v=edit?{...moved,...edit}:moved;
  if(v.date>asOf&&v.date<=end)finalPlans.push(v);
 }
 const bySignature=new Map();
 const ledger=[];
 for(const e of finalEvents){
  const key=String(e.accountId)+'|'+e.date+'|'+norm(e.merchant)+'|'+e.type;
  // Independent user schedules (and intentional one-offs) may share the
  // merchant, date, account and even amount. Dedupe by durable IDs, not payee.
  // The earlier explicit-versus-inferred cleanup still applies above.
  if(bySignature.has(key)&&bySignature.get(key).source!==e.source)
   warnings.push('Same-day entries for '+e.merchant+' are included separately');
  bySignature.set(key,e);
  ledger.push({...e,kind:'event'});
 }
 for(const p of finalPlans){
  if(!accounts.some(a=>String(a.id)===String(p.fromAccountId))||
   !accounts.some(a=>String(a.id)===String(p.toAccountId))||
   p.fromAccountId===p.toAccountId||!(Number(p.amount)>0)){
   warnings.push('Transfer '+(p.merchant||p.id)+' has invalid linked accounts');continue;
  }
  if(ledger.some(e=>e.kind==='movement'&&e.fromAccountId===p.fromAccountId&&
   e.toAccountId===p.toAccountId&&Math.abs(diff(e.date,p.date))<=3&&
   Math.abs(cents(e.amount)-cents(p.amount))<=1&&
   // Two separately confirmed linked obligations must never collapse.
   !(e.recurringRuleId&&p.recurringRuleId&&e.recurringRuleId!==p.recurringRuleId))){
   checks.push({id:p.id,reason:'Already represented as a linked account movement'});continue;
  }
  ledger.push({...p,kind:'movement'});
 }
 ledger.sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
 const projection=project(snapshot,ledger,days);
 const integrity=auditProjection(projection);
 projection.diagnostics.balanceMismatches=integrity.errors;
 if(!integrity.ok)throw Error('Forecast integrity check failed; inconsistent daily balances were not displayed');
 return {ledger,projection,rows,events:ledger.filter(e=>e.kind==='event'),
  payments:{...payment,warnings:[...(payment.warnings||[]),...warnings]},
  forecast:{suppressedDuplicates:checks},routines:{events:[],review:[],warnings:[],
   counts:{confirmed:ownerEntries.length,suggested:detected.automatic.length,excluded:0}},
  missingMortgages:[],historyCandidates:detected.review,
  automaticRecurrence:{events:detected.automatic,review:[]},
  duplicateChecks:checks,duplicateConflicts:detected.conflicts};
}
/* Fail-closed arithmetic audit: every day uses only its canonical ledger event legs. */
function auditProjection(projection){
 const errors=[],round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
 for(const a of projection?.accounts||[]){
  if(!a.valid)continue;
  let current=Number(a.openingCurrent),
   available=a.openingAvailable==null?null:Number(a.openingAvailable);
  for(const point of a.series||[]){
   let delta=0;
   for(const e of point.events||[]){
    const sign=a.type==='credit'?
     (['card_purchase','transfer_out'].includes(e.kind)?1:-1):
     (['income','refund','transfer_in'].includes(e.kind)?1:-1);
    delta=round(delta+sign*Number(e.amount));
   }
   current=round(current+delta);
   if(available!==null)available=round(available+delta);
   const expected=a.type==='credit'?current:available??current;
   if(!Number.isFinite(expected)||!Number.isFinite(point.balance)||
     Math.abs(round(point.balance-expected))>.001||
     Math.abs(round(point.currentBalance-current))>.001)
    errors.push({accountId:a.id,date:point.date,reason:'Daily account balance does not reconcile'});
  }
 }
 if(projection?.household?.conservationDifference!=null&&
    Math.abs(Number(projection.household.conservationDifference))>.001)
  errors.push({reason:'Household money movement fails conservation check'});
 return {ok:errors.length===0,errors,daysChecked:(projection?.series||[]).length};
}
function project(snapshot,ledger,days=90){
 const asOf=snapshot.asOf,end=horizon(asOf,days),accounts=[],byId=new Map(),
  diagnostics={unassigned:[],unmatchedTransfers:[],unverifiedAccounts:[],
   suppressedDuplicates:[],pairedMovements:[],staleSnapshots:[],missingTimestamps:[],
   ambiguousMovements:[],duplicateEvents:[],statementWarnings:[],statementChecks:[]};
 const round=n=>cents(n)/100,live=snapshot.connected||snapshot.mode==='plaid'||snapshot.mode==='connected';
 for(const a of snapshot.accounts||[]){
  const id=String(a.id),credit=String(a.accountType||a.type||'').toLowerCase()==='credit',
   current=a.current==null?null:Number(a.current),avail=a.available==null?null:Number(a.available),
   validBalance=Number.isFinite(current),type=credit?'credit':'cash',
   age=a.balanceAsOf?diff(asOf,String(a.balanceAsOf).slice(0,10)):null,
   status=!validBalance?'unavailable':a.simulated||snapshot.mode==='demo'?'simulated':
    !live?'unverified':age===null?'unknown-age':age>2?'stale':age<0?'future-dated':'fresh',
   x={id,name:a.name||id,type,valid:validBalance,balanceStatus:status,
    opening:validBalance?current:null,openingCurrent:validBalance?current:null,
    openingAvailable:!credit&&Number.isFinite(avail)?avail:null,
    closing:null,closingAvailable:null,series:[],events:[],minimum:null,lowestDate:null,
    source:a,_current:current,_available:Number.isFinite(avail)?avail:null};
  if(status==='stale')diagnostics.staleSnapshots.push({accountId:id});
  if(status==='unknown-age')diagnostics.missingTimestamps.push({accountId:id});
  accounts.push(x);byId.set(id,x);
 }
 const scheduled=new Map(),posted=[],plans=[];
 const put=(entry,aid,kind,group=null)=>{
  const account=byId.get(String(aid));
  if(!account||!account.valid){diagnostics.unassigned.push({id:entry.id,accountId:aid});return;}
  const x={id:entry.id,accountId:String(aid),date:entry.date,amount:round(entry.amount),
   merchant:entry.merchant||'Future payment',type:entry.type||'transfer',kind,
   sourceAccountId:entry._forecastOriginalAccountId||entry.accountId||entry.fromAccountId||null,
   sourceMerchant:entry._forecastOriginalMerchant||entry.merchant||null,
   sourceType:entry._forecastOriginalType||entry.type||null,
   transferGroupId:group,predictionKey:group?null:'event|'+encodeURIComponent(String(entry.id))+'|'+encodeURIComponent(String(aid)),
   seriesKey:entry._seriesKey||entry.seriesKey||null,baseDate:entry._seriesDate||entry.baseDate||entry.date,
   amountEstimate:entry.amountEstimate||null,
   cadence:entry.cadence||null,recurringRuleId:entry.ruleId||entry.recurringRuleId||null,
   fromAccountId:entry.fromAccountId||null,toAccountId:entry.toAccountId||null};
  if(!scheduled.has(x.date))scheduled.set(x.date,[]);scheduled.get(x.date).push(x);
  posted.push(x);
 };
 for(const e of ledger||[]){
  if(!valid(e.date)||e.date<=asOf||e.date>end||!(Number(e.amount)>0))continue;
  if(e.kind==='movement'){
   const f=byId.get(String(e.fromAccountId)),t=byId.get(String(e.toAccountId));
   if(!f||!t||f.id===t.id){diagnostics.unmatchedTransfers.push({id:e.id});continue;}
   put(e,f.id,'transfer_out',e.id);put(e,t.id,'transfer_in',e.id);
   const p={...e,kind:t.type==='credit'||f.type==='credit'?'card_payment':'internal_transfer'};
   plans.push(p);diagnostics.pairedMovements.push(p);
  }else{
   const a=byId.get(String(e.accountId));
   if(!a){diagnostics.unassigned.push({id:e.id});continue;}
   const kind=e.type==='expense'?(a.type==='credit'?'card_purchase':'expense'):
    e.type==='income'?'income':e.type==='refund'?(a.type==='credit'?'card_refund':'refund'):null;
   if(!kind){diagnostics.unassigned.push({id:e.id,reason:'Unsupported future transaction type'});continue;}
   put(e,a.id,kind);
  }
 }
 const series=[],openingCash=round(accounts.filter(a=>a.valid&&a.type==='cash').reduce((v,a)=>v+a.opening,0)),
  openingDebt=round(accounts.filter(a=>a.valid&&a.type==='credit').reduce((v,a)=>v+a.opening,0));
 let earned=0,spent=0;
 for(let n=0;n<=days;n++){
  const day=add(asOf,n),rows=scheduled.get(day)||[];
  let cash=0,debt=0;
  for(const a of accounts){
   const mine=rows.filter(e=>e.accountId===a.id);
   let income=0,outflow=0,purchases=0;
   if(a.valid)for(const t of mine){
    const amount=round(t.amount);
    let signed;
    if(a.type==='credit'){
     signed=['card_purchase','transfer_out'].includes(t.kind)?amount:-amount;
     if(signed>0)purchases+=signed;else outflow-=signed;
    }else{
     signed=['income','refund','transfer_in'].includes(t.kind)?amount:-amount;
     if(signed>0)income+=signed;else outflow-=signed;
    }
    a._current=round(a._current+signed);
    if(a._available!==null)a._available=round(a._available+signed);
    if(t.kind==='expense'||t.kind==='card_purchase')spent+=amount;
    if(t.kind==='refund'||t.kind==='card_refund')spent-=amount;
    if(t.kind==='income')earned+=amount;
   }
   if(a.valid){
    const balance=a.type==='credit'?a._current:(a._available??a._current);
    if(a.minimum===null||balance<a.minimum){a.minimum=balance;a.lowestDate=day;}
    a.series.push({date:day,balance,currentBalance:a._current,
     income:round(income),outflow:round(outflow),purchases:round(purchases),events:mine});
    a.events.push(...mine);
    if(a.type==='credit')debt+=a._current;else cash+=a._current;
   }
  }
  series.push({date:day,cash:round(cash),debt:round(debt),net:round(cash-debt),movements:rows});
 }
 for(const a of accounts){a.closing=a.valid?round(a._current):null;
  a.closingAvailable=a.valid&&a.type==='cash'?a._available:null;
  delete a._current;delete a._available;}
 const endRow=series.at(-1)||{},net0=round(openingCash-openingDebt);
 return {asOf,through:end,days,accounts,events:posted,plans,series,
  diagnostics,household:{openingCash,closingCash:endRow.cash,openingDebt,closingDebt:endRow.debt,
   openingNet:net0,closingNet:endRow.net,expectedSpending:round(spent),expectedIncome:round(earned),
   forecastChange:round(endRow.net-net0),explainedChange:round(earned-spent),
   conservationDifference:round(endRow.net-net0-(earned-spent)),
   complete:diagnostics.unassigned.length===0&&diagnostics.unmatchedTransfers.length===0}};
}
// Backtesting uses the SAME historical prediction engine as the live plan.
// It never applies today's saved overrides to earlier months.
function backtest(records,accounts,asOf,account,months=6){
 const target=String(account),input=(records||[]).filter(r=>!r.pending&&valid(r.date)&&r.date<=asOf),
  accountRows=input.filter(r=>accountId(r,accounts)===target),
  totals={predicted:0,eligible:0,matched:0,changed:0,missed:0,extra:0,duplicates:0,drift:0},
  issues=[],windows=[],endMonth=month(asOf,-1);
 let excludedWindows=0,cardSettlements=0;
 for(let offset=Math.max(1,months)-1;offset>=0;offset--){
  const current=month(endMonth,-offset),cutoff=monthDate(current,0,1);
  const prior=add(cutoff,-1),end=monthDate(current,1,1),endDate=add(end,-1),
   training=accountRows.filter(r=>r.date<=prior),
   actual=accountRows.filter(r=>r.date>=cutoff&&r.date<=endDate),
   historyMonths=new Set(training.map(r=>r.date.slice(0,7)));
  if(historyMonths.size<2||!actual.length){excludedWindows++;continue;}
  const detected=analyze(training,accounts,prior,{},diff(endDate,prior)),
   candidates=detected.automatic.filter(e=>e.accountId===target),
   eligibleNames=new Set([...detected.review,...candidates].map(e=>
    signature(e.accountId,e.type||e.kind,e.merchant)));
  const eligible=actual.filter(r=>
   ['income','expense'].includes(direction(r))&&
   eligibleNames.has(signature(target,direction(r),r.merchant)));
  const used=new Set();let matched=0,changed=0,missed=0,drift=0;
  for(const row of eligible){
   const compare=candidates.map((e,j)=>({e,j,days:Math.abs(diff(e.date,row.date)),
    dollars:Math.abs(cents(e.amount)-cents(row.amount))}))
    .filter(x=>!used.has(x.j)&&norm(x.e.merchant)===norm(row.merchant)&&
     x.e.type===direction(row)&&x.days<=5)
    .sort((a,b)=>a.days-b.days||a.dollars-b.dollars);
   if(!compare.length){missed++;issues.push({kind:'missed',merchant:row.merchant,
     date:row.date,actual:row.amount});continue;}
   const best=compare.find(x=>x.dollars<=1)||compare[0];used.add(best.j);
   if(best.dollars<=1){matched++;if(best.days>2)drift++;}
   else {changed++;issues.push({kind:'amount changed',merchant:row.merchant,
    date:row.date,actual:row.amount,expected:best.e.amount});}
  }
  let extra=0,duplicates=0;
  for(let i=0;i<candidates.length;i++)if(!used.has(i)){
   const pred=candidates[i],duplicate=candidates.some((other,j)=>j!==i&&
    norm(other.merchant)===norm(pred.merchant)&&other.date===pred.date&&
    Math.abs(cents(other.amount)-cents(pred.amount))<=1);
   if(duplicate)duplicates++;else extra++;
   issues.push({kind:duplicate?'duplicate':'unmatched forecast',merchant:pred.merchant,
    date:pred.date,expected:pred.amount});
  }
  totals.predicted+=candidates.length;totals.eligible+=eligible.length;
  totals.matched+=matched;totals.changed+=changed;totals.missed+=missed;
  totals.extra+=extra;totals.duplicates+=duplicates;totals.drift+=drift;
  cardSettlements+=actual.filter(r=>r.type==='transfer'&&
   /card payment|payment to visa|payment thank you/i.test(r.merchant||'')).length;
  windows.push({month:current,predicted:candidates.length,eligible:eligible.length,
   matched,changed,missed,extra,duplicates});
 }
 const status=windows.length&&(totals.predicted||totals.eligible)?'evaluated':'insufficient-history';
 return {status,accountId:target,periods:windows.map(w=>w.month),windows,excludedWindows,
  totals,matchRate:totals.predicted?Math.round(totals.matched/totals.predicted*100):null,
  coverageRate:totals.eligible?Math.round(totals.matched/totals.eligible*100):null,
  issues:issues.slice(0,12),issueCount:issues.length,cardSettlements};
}
const api={analyze,materialize,project,auditProjection,backtest,accountId,cadence};
root.HouseholdFutureLedger=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
