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
 monthDate(s,n*({monthly:1,quarterly:3,semiannual:6,annual:12}[f]||1));
const signature=(accountId,type,merchant)=>[accountId,type,norm(merchant)].map(encodeURIComponent).join('|');
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
   same=g.rows.filter(r=>cents(r.amount)===amount),
   lastTwo=same.slice(-2),lastFour=same.slice(-4),
   twice=lastFour.length===4&&
    lastFour[0].date.slice(0,7)===lastFour[1].date.slice(0,7)&&
    lastFour[2].date.slice(0,7)===lastFour[3].date.slice(0,7)&&
    index(lastFour[2].date)-index(lastFour[0].date)===1&&
    Math.abs(+lastFour[0].date.slice(-2)-+lastFour[2].date.slice(-2))<=2&&
    Math.abs(+lastFour[1].date.slice(-2)-+lastFour[3].date.slice(-2))<=2,
   slots=twice?[+lastFour[2].date.slice(-2),+lastFour[3].date.slice(-2)]:null,
   f=twice?'twice-monthly':lastTwo.length===2?cadence(lastTwo[0].date,lastTwo[1].date):null,
   f3=same.length>=3&&f&&cadence(same.at(-3).date,same.at(-2).date)===f,
   recent={weekly:17,biweekly:31,monthly:66,quarterly:125,semiannual:215,annual:400},
   spaced=Boolean(f)&&age<=(twice?40:recent[f])&&
    // Never treat a mixed-price recent payment as an older constant-price pattern.
    g.rows.at(-2)===lastTwo[0]&&g.rows.at(-1)===lastTwo[1]&&(twice||same.length<3||f3),
   one=g.rows.length===1&&age<=50&&trusted(t)&&g.kind==='expense'&&
    !internalName.test(g.merchant),
   category=String(metadata(t).detailed||'').toUpperCase(),
   unpairedTransfer=g.rows.some(r=>r.type==='transfer'),
   transferRisk=unpairedTransfer&&(internalName.test(g.merchant)||
    g.kind==='income'||/TRANSFER/.test(category)&&!trusted(t)),
   multiCycle=f&&!['weekly','biweekly','twice-monthly'].includes(f)&&
    g.rows.filter(r=>r.date.slice(0,7)===t.date.slice(0,7)).length>1,
   enough=one||spaced&&(twice||f3||(!variableName.test(g.merchant)&&!transferRisk)),
   planDate=next(t.date,f||'monthly',1);
  const aliases=[g.accountId,g.accountName,t.account,t.accountId].map(String).filter(Boolean);
  const blocked=aliases.some(a=>[g.kind,t.type].some(type=>{
   const d=excluded[[type,a,norm(g.merchant)].join('|')];
   return d?.status==='excluded'&&Math.abs(cents(d.amount)-amount)<=1;
  }))||[g.kind,t.type].some(type=>dismiss[
   [g.accountId,type,norm(g.merchant),String(amount)].map(encodeURIComponent).join('|')
  ]==='dismissed')||(prefs.mortgageReviewDismissals||[]).includes(
   ['mortgage',g.accountId,norm(g.merchant),String(amount)].map(encodeURIComponent).join('|'));
  if(blocked)continue;
  const owners=rules.filter(r=>r.kind==='event'&&
   String(r.originalAccountId||r.accountId)===g.accountId&&
   (r.matchNames||[norm(r.originalMerchant||r.merchant)]).includes(norm(g.merchant)));
  if(owners.length){
   const changed=!owners.some(r=>Math.abs(Number(r.matchAmount??r.amount)-t.amount)<.011||
    Math.abs(Number(r.amount)-t.amount)<.011);
   if(changed&&age<=75)review.push({...reviewItem(g,same,f,t,planDate),
    reason:'New bank amount differs from your confirmed schedule; review before updating it'});
   continue;
  }
  // The same merchant/month may contain two genuine bills. Do not pick one
  // automatically or erase a competing charge because its name is similar.
  if(multiCycle){conflicts.push({merchant:g.merchant,reason:'Multiple same-merchant payments this cycle'});}
  if(g.kind==='expense'||g.kind==='income'){
   const auto=Boolean(one||spaced)&&enough&&!multiCycle&&
    !transferRisk&&g.kind!=='refund';
   if(auto){
    const series='series|'+g.id+'|'+(f||'monthly'),freq=f||'monthly';
    const dates=twice?twiceDates(t.date,slots,end):
     Array.from({length:110},(_,i)=>next(t.date,freq,i+1)).filter(d=>d<=end);
    for(const when of dates){
     if(when<=asOf)continue;
     automatic.push({id:'auto|'+series+'|'+when,date:when,amount:money(t.amount),
      merchant:g.merchant,accountId:g.accountId,type:g.kind,category:t.category||'Other',
      source:'historical',cadence:freq,_seriesKey:series,_seriesDate:when,
      planConfidence:one?'identified-single-bill':'observed-recurring-pattern',
      historicalIds:same.slice(-3).map(x=>String(x.id||''))});
    }
    continue;
   }
  }
  // Reviews represent candidates only. Nothing here changes a balance.
  if(age<=(g.rows.length===1&&!trusted(t)?45:recent[f||'monthly']||75)&&
   (g.rows.length>=2||trusted(t)))
   review.push(reviewItem(g,same,f,t,planDate));
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
 const detected=analyze(rows,accounts,asOf,prefs,days),rules=prefs.futureRecurringRules||[],
  series=prefs.futureSeriesEdits||{},edits=prefs.futureTransactionEdits||{},
  extras=prefs.futureTransactionAdds||[],entries=[],ids=new Set(),checks=[],warnings=[];
 const seen=(e)=>{if(ids.has(e.id)){checks.push({id:e.id,reason:'Duplicate future ledger ID'});return}
  ids.add(e.id);entries.push(e)};
 const ownerFor=(e)=>rules.some(r=>r.kind==='event'&&
  String(r.originalAccountId||r.accountId)===String(e.accountId)&&
  (r.matchNames||[norm(r.originalMerchant||r.merchant)]).includes(norm(e.merchant)));
 // Explicit rules come first, and always own their original bank series.
 const generated=tools.generatedRecurring(rules,add(asOf,-32),add(end,32));
 const ownerEntries=generated.events.map(e=>{
  const base=e._seriesDate||e.date,changed=tools.applySeries(e,base,e._seriesKey,series);
  return {...changed,_seriesDate:base,_forecastOriginalMerchant:e.merchant,
   _forecastOriginalAccountId:e.accountId,_forecastOriginalAmount:e.amount};
 });
 // User rules are filtered for posted coverage using existing bank facts.
 const covered=tools.postedCoverage({events:ownerEntries,plans:generated.plans},rules,rows,accounts,asOf);
 for(const e of covered.events)if(e.date>asOf&&e.date<=end)seen(e);
 for(const event of detected.automatic){
  if(ownerFor(event))continue;
  const base=event.date,adjusted=tools.applySeries(event,base,event._seriesKey,series);
  if(adjusted.date<=asOf||adjusted.date>end)continue;
  seen({...adjusted,_seriesDate:base,_forecastOriginalMerchant:event.merchant,
   _forecastOriginalAccountId:event.accountId,_forecastOriginalAmount:event.amount});
 }
 // One-off forecast additions are independent of Plaid facts.
 for(const e of extras){
  if(e.type==='transfer'||rules.some(r=>r.sourceAddedId===e.id))continue;
  if(!valid(e.date)||e.date<=asOf||e.date>end)continue;
  if(ownerFor(e))continue;
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
  .filter(e=>e.type!=='transfer');
 // All account-to-account movements use ONE linked record.
 const movementRules=covered.plans.map(m=>({...m,date:m.anchorDate,
  fromAccountId:m.fromAccountId,toAccountId:m.toAccountId,
  recurringRuleId:m.seriesRuleId,seriesKey:tools.manualSeriesKey(m.seriesRuleId),
  baseDate:m.anchorDate}));
 const plans=[...movementRules,...(payment.plans||[]).filter(p=>
  !movementRules.some(m=>m.fromAccountId===p.fromAccountId&&
   m.toAccountId===p.toAccountId&&m.date.slice(0,7)===p.anchorDate.slice(0,7)))
  .map(p=>({...p,date:p.anchorDate,seriesKey:tools.seriesPlan(p),
   baseDate:p.anchorDate,recurringRuleId:p.seriesRuleId||null}))];
 for(const e of extras.filter(x=>x.type==='transfer'&&x.date>asOf&&x.date<=end))
  plans.push({...e,id:'future|'+e.id,fromAccountId:e.fromAccountId,toAccountId:e.toAccountId,
   source:'manual'});
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
  if(bySignature.has(key)&&bySignature.get(key).source!==e.source){
   warnings.push('Competing future amounts for '+e.merchant+' require review');
   continue;
  }
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
   Math.abs(cents(e.amount)-cents(p.amount))<=1)){
   checks.push({id:p.id,reason:'Already represented as a linked account movement'});continue;
  }
  ledger.push({...p,kind:'movement'});
 }
 ledger.sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
 const projection=project(snapshot,ledger,days);
 return {ledger,projection,rows,events:ledger.filter(e=>e.kind==='event'),
  payments:{...payment,warnings:[...(payment.warnings||[]),...warnings]},
  forecast:{suppressedDuplicates:checks},routines:{events:[],review:[],warnings:[],
   counts:{confirmed:ownerEntries.length,suggested:detected.automatic.length,excluded:0}},
  missingMortgages:[],historyCandidates:detected.review,
  automaticRecurrence:{events:detected.automatic,review:[]},
  duplicateChecks:checks,duplicateConflicts:detected.conflicts};
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
   transferGroupId:group,predictionKey:group?null:'event|'+encodeURIComponent(String(entry.id))+'|'+encodeURIComponent(String(aid)),
   seriesKey:entry._seriesKey||entry.seriesKey||null,baseDate:entry._seriesDate||entry.baseDate||entry.date,
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
const api={analyze,materialize,project,accountId,cadence};
root.HouseholdFutureLedger=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
