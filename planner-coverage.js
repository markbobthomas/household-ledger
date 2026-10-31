/* Monthly assurance checks use the SAME materialized future ledger as the balance
 * curve. Expected schedules are inferred separately from posted history or a
 * saved card payment rule; a card merely being connected is not coverage. */
(function(root){
'use strict';
const shared=root.HouseholdPlannerTransactions||
 (typeof require==='function'?require('./planner-transactions.js'):null);
if(!shared)throw Error('Planner scheduling helpers are required');
const asId=x=>String(x??'');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
const currencyFormatter=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const dollars=n=>currencyFormatter.format(Number(n)||0);
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(asId(s));
const day=shared.shift;
const monthPlus=(iso,n)=>{const [y,m,d]=iso.split('-').map(Number);
 const x=new Date(Date.UTC(y,m-1+n,1)),end=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0)).getUTCDate();
 return x.toISOString().slice(0,7)+'-'+String(Math.min(d,end)).padStart(2,'0')};
const monthEnd=m=>monthPlus(m+'-01',1).slice(0,7)+'-01';
const daysBetween=shared.daysBetween;
const titleDate=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const monthTitle=m=>new Date(m+'-15T12:00:00Z').toLocaleDateString('en-US',{month:'short',year:'2-digit',timeZone:'UTC'});
const mortgage=s=>/\b(?:mortgage|mtg|home[\s-]*loan|pennymac|loandepot|newrez|shellpoint|mr[\s.]*cooper|rocket[\s-]*mortgage)\b/i.test(asId(s));
const norm=s=>asId(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const credit=a=>asId(a?.accountType||a?.type).toLowerCase()==='credit';
const accountFor=(row,accounts)=>
 shared.accountRef(row?.accountId||row?.account,accounts);
const mortgageRow=r=>[r.merchant,r.description,r.name,r.source?.name,
 r.source?.merchantName,r.personal_finance_category?.detailed,
 r.personal_finance_category?.primary,r.source?.personalFinanceCategory?.detailed,
 r.source?.personalFinanceCategory?.primary,r.category].some(x=>
  mortgage(x)||/MORTGAGE|HOME_LOAN/.test(asId(x).toUpperCase()));
const realExpense=r=>r&&!r.pending&&Number(r.amount)>0&&
 (r.type==='expense'||r.type==='transfer'&&r.cashDirection==='out'&&!r.pairedTransactionId);
const realIncome=r=>r&&!r.pending&&Number(r.amount)>0&&
 (r.type==='income'||r.type==='transfer'&&r.cashDirection==='in'&&!r.pairedTransactionId);
const futureExpense=e=>e&&e.kind==='event'&&e.type==='expense';
const dayWithin=(m,d)=>date(d)&&d>=m.start&&d<=m.end;
const initCells=months=>months.map(m=>({month:m.key,status:'na',label:'—',detail:'No known due date in this portion of the forecast',items:[]}));
const described=items=>items.map(e=>
 ({date:e.date||e.anchorDate,amount:Number(e.amount)||0,merchant:asId(e.merchant||e.name||'Payment')}));
let details=new Map(),mortgageChoices=new Map(),categoryChoices=new Map();
function months(asOf,days){
 if(!date(asOf)||![30,60,90,120,180,360].includes(days))return [];
 const first=day(asOf,1),through=day(asOf,days),out=[];
 let m=first.slice(0,7);
 while(m<=through.slice(0,7)){
  const next=monthEnd(m),end=day(next,-1);
  const start=first>m+'-01'?first:m+'-01';
  out.push({key:m,start,end:end<through?end:through,
   full:start===m+'-01'&&end<=through});
  m=next.slice(0,7);
 }
 return out;
}
function expectedMonthly(seed,months){
 if(!date(seed))return [];
 const first=months[0]?.start,last=months.at(-1)?.end;
 if(!first||!last)return [];
 const out=[];
 // Never manufacture older payments to fill a month before the entered
 // next-payment anchor. A first partial month may legitimately have no due.
 for(let n=0;n<22;n++){
  const d=monthPlus(seed,n);
  if(d>last)break;
  if(d>=first)out.push(d);
 }
 return out;
}
function historyFor(rows,accounts,accountId,predicate,asOf){
 return (rows||[]).filter(r=>r.date<=asOf&&
  accountFor(r,accounts)===accountId&&predicate(r))
  .sort((a,b)=>a.date.localeCompare(b.date));
}
/* Match the items users see under Predictions, not a second independently
 * named stream. Projection.events are the account movements actually included
 * in the balance, whereas ledger drafts may include entries that could not
 * be applied to an account. The ledger fallback serves isolated test fixtures. */
function actualFutureExpenses({projection,ledger,accounts}){
 const byId=new Map(accounts.map(a=>[asId(a.id),a]));
 // Match the exact projected cash withdrawals shown under Predictions.
 // Both expenses and linked outgoing transfers lower checking balance.
 // A transfer to a connected credit card is not a mortgage.
 const cashOut=e=>e&&byId.has(asId(e.accountId))&&
  !credit(byId.get(asId(e.accountId)))&&Number(e.amount)>0&&
  (e.kind==='expense'&&e.type==='expense'||
   e.kind==='transfer_out'&&!credit(byId.get(asId(e.toAccountId))));
 if(projection&&Array.isArray(projection.events))
  return projection.events.filter(cashOut);
 const fallback=(ledger||[]).flatMap(e=>{
  if(e.kind==='movement'&&!credit(byId.get(asId(e.toAccountId))))
   return [{...e,accountId:e.fromAccountId,kind:'transfer_out',type:'transfer'}];
  return futureExpense(e)?[{...e,kind:'expense'}]:[];
 });
 return fallback.filter(cashOut);
}
const futureNameFields=e=>[e.merchant,e._forecastOriginalMerchant,
 e.sourceMerchant,e.originalMerchant,e.description,e.source?.merchant];
const sameStream=(e,key)=>futureNameFields(e).some(x=>norm(x)===key);
const nearPayment=(e,d,amount)=>Math.abs(daysBetween(e.date,d))<=9&&
 Math.abs(Number(e.amount)-Number(amount))<=Math.max(30,.06*Number(amount));
// A forecast-only identity: never changes payment dates, amounts, bank facts or recurrence.
function mortgageIdentity(e){
 return {accountId:asId(e.accountId),
  seriesKey:asId(e.seriesKey||''),ruleId:asId(e.recurringRuleId||e.ruleId||''),
  merchant:norm(e.sourceMerchant||e._forecastOriginalMerchant||e.merchant),
  display:asId(e.merchant||'Predicted payment').slice(0,110)};
}
function matchesMortgageIdentity(e,identity){
 if(!identity||asId(e.accountId)!==asId(identity.accountId))return false;
 if(identity.seriesKey)return asId(e.seriesKey)===asId(identity.seriesKey);
 if(identity.ruleId)return asId(e.recurringRuleId||e.ruleId)===asId(identity.ruleId);
 return Boolean(identity.merchant)&&norm(e.sourceMerchant||
  e._forecastOriginalMerchant||e.merchant)===identity.merchant;
}
function mortgageChoicesFor(expenses,accountId){
 const groups=new Map();
 for(const e of expenses){
  if(asId(e.accountId)!==accountId||!(Number(e.amount)>=100))continue;
  const identity=mortgageIdentity(e),key=identity.seriesKey?
   'series|'+identity.seriesKey:identity.ruleId?'rule|'+identity.ruleId:
   'merchant|'+identity.merchant;
  if(!identity.merchant&&!identity.seriesKey&&!identity.ruleId)continue;
  if(!groups.has(key))groups.set(key,{identity,merchant:e.merchant||'Payment',
   amount:Number(e.amount),date:e.date,count:0,months:new Set()});
  const value=groups.get(key);
  value.count++;value.months.add(e.date.slice(0,7));
 }
 return [...groups.values()].sort((a,b)=>
  (b.months.size>=2?1:0)-(a.months.size>=2?1:0)||
  b.amount-a.amount||a.date.localeCompare(b.date)).slice(0,12).map(x=>({
   identity:x.identity,merchant:x.merchant,date:x.date,amount:x.amount,
   count:x.count,months:x.months.size
  }));
}

/* Learned labels only classify existing forecasted cash movements. They do not
 * generate income/bills, edit Plaid history, or change any projected balances. */
const assignmentKey=(category,accountId)=>category+'|'+asId(accountId);
const matchingRows=(items,id)=>items.filter(e=>matchesMortgageIdentity(e,id));
const nonCardDebit=(e,accounts)=>e.kind==='expense'&&e.type==='expense'||
 e.kind==='transfer_out'&&!credit(accounts.find(a=>asId(a.id)===asId(e.toAccountId)));
function datedCashMovements({projection,ledger,accounts}){
 const byId=new Map(accounts.map(a=>[asId(a.id),a]));
 if(projection&&Array.isArray(projection.events))
  return projection.events.filter(e=>e&&!credit(byId.get(asId(e.accountId)))&&
   (e.kind==='income'||nonCardDebit(e,accounts))&&Number(e.amount)>0);
 return (ledger||[]).flatMap(e=>{
  if(e.kind==='event'&&['income','expense'].includes(e.type))
   return [{...e,kind:e.type}];
  if(e.kind==='movement')return [{...e,accountId:e.fromAccountId,
   type:'transfer',kind:'transfer_out'}];
  return [];
 }).filter(e=>!credit(byId.get(asId(e.accountId)))&&
  (e.kind==='income'||nonCardDebit(e,accounts))&&Number(e.amount)>0);
}
function categoryCandidates(row,items,accounts,chosen,excluded=[]){
 const saved=excluded.filter(Boolean),id=asId(chosen.id),out=[];
 for(const e of items){
  if(asId(e.accountId)!==id||!(Number(e.amount)>0))continue;
  if(row.id==='income'&&e.kind!=='income')continue;
  if(row.id==='other-bills'&&e.kind==='income')continue;
  if(row.id.startsWith('card|')){
   const cardId=row.id.slice(5);
   if(e.kind==='income'||e.kind==='transfer_out'&&asId(e.toAccountId)!==cardId)continue;
  }
  if(row.id==='other-bills'&&e.kind==='transfer_out'&&
   credit(accounts.find(a=>asId(a.id)===asId(e.toAccountId))))continue;
  if(row.id!=='income'&&saved.some(x=>matchesMortgageIdentity(e,x)))continue;
  out.push(e);
 }
 const grouped=new Map();
 for(const e of out){
  const identity=mortgageIdentity(e);
  const key=identity.seriesKey?'s|'+identity.seriesKey:
   identity.ruleId?'r|'+identity.ruleId:'m|'+identity.merchant;
  if(!identity.merchant&&!identity.seriesKey&&!identity.ruleId)continue;
  if(!grouped.has(key))grouped.set(key,{identity,merchant:e.merchant||'Predicted item',
   date:e.date,amount:Number(e.amount),months:new Set(),count:0});
  const g=grouped.get(key);g.months.add(e.date.slice(0,7));g.count++;
 }
 return [...grouped.values()].sort((a,b)=>
  b.months.size-a.months.size||b.count-a.count||
  b.amount-a.amount||a.date.localeCompare(b.date)).slice(0,25)
  .map(x=>({identity:x.identity,merchant:x.merchant,date:x.date,
   amount:x.amount,months:x.months.size,count:x.count}));
}
function recurrenceForLearned(events,prefs,months,identity,category){
 const first=events[0];
 if(!first)return {dates:[],confidence:false};
 const rule=(prefs?.futureRecurringRules||[]).find(r=>
  asId(r.id)===asId(identity.ruleId)||
  asId(identity.seriesKey)==='user-series|'+encodeURIComponent(asId(r.id)));
 const cardId=category?.startsWith('card|')?category.slice(5):null,
  cardRule=cardId&&prefs?.paymentRules?.[cardId];
 let frequency=rule?.frequency||first.cadence||
  (cardRule?.nextPaymentDate?'monthly':'');
 if(!frequency&&events.length>=2){
  const dates=[...new Set(events.map(e=>e.date))].sort();
  const gaps=dates.slice(1).map((d,i)=>daysBetween(d,dates[i]));
  if(gaps.length>=2&&gaps.every(n=>n>=27&&n<=29))frequency='every-4-weeks';
  else if(gaps.length&&gaps.every(n=>n>=26&&n<=36))frequency='monthly';
  else if(gaps.length&&gaps.every(n=>n>=12&&n<=16))frequency='biweekly';
 }
 // Every recurring deposit phase stays separate (two alternating paychecks).
 const seed=rule?.anchorDate&&date(rule.anchorDate)?rule.anchorDate:
  cardRule?.nextPaymentDate&&date(cardRule.nextPaymentDate)?
   cardRule.nextPaymentDate:
   [...events].sort((a,b)=>a.date.localeCompare(b.date))[0].date;
 const result=[],last=months.at(-1)?.end;
 const period={weekly:7,biweekly:14,'every-4-weeks':28};
 if(period[frequency]){
  let d=seed;
  // Anchor may predate selected window. Advance without dropping its phase.
  for(let n=0;n<730&&d<=last;d=day(d,period[frequency]),n++)
   if(d>=months[0].start)result.push(d);
 }else if(['monthly','quarterly','semiannual','annual'].includes(frequency)){
  const step={monthly:1,quarterly:3,semiannual:6,annual:12}[frequency];
  for(let n=0;n<100;n++){
   const d=monthPlus(seed,n*step);if(d>last)break;
   if(d>=months[0].start)result.push(d);
  }
 }
 return {dates:result,confidence:result.length>0};
}
function learnedCoverage({row,chosen,months,accounts,prefs,projection,ledger}){
 const key=assignmentKey(row.id,chosen.id),
  saved=Array.isArray(prefs?.coverageAssignments?.[key])?
   prefs.coverageAssignments[key].slice(0,15):[];
 if(!saved.length)return row;
 const actual=datedCashMovements({projection,ledger,accounts}),
  tracked=saved.map(identity=>{
   const entries=matchingRows(actual,identity).filter(e=>
    row.id==='income'?e.kind==='income':
     row.id.startsWith('card|')?nonCardDebit(e,accounts)&&
      (e.kind!=='transfer_out'||asId(e.toAccountId)===row.id.slice(5)):
      nonCardDebit(e,accounts)&&
      (e.kind!=='transfer_out'||!credit(accounts.find(a=>
       asId(a.id)===asId(e.toAccountId)))));
   return {identity,entries,expected:recurrenceForLearned(entries,prefs,months,identity,row.id)};
  });
 const cells=months.map(m=>{
  const entries=tracked.flatMap(t=>t.entries.filter(e=>dayWithin(m,e.date)));
  const expectations=tracked.reduce((acc,t)=>
   acc+t.expected.dates.filter(d=>dayWithin(m,d)).length,0);
  const matched=tracked.reduce((acc,t)=>{
   const present=t.entries.filter(e=>dayWithin(m,e.date)).length,
    due=t.expected.dates.filter(d=>dayWithin(m,d)).length;
   return acc+Math.min(present,due);
  },0);
  const lacksSchedule=tracked.some(t=>!t.expected.confidence);
  const absent=tracked.some(t=>!t.entries.length);
  const allExpected=tracked.every(t=>t.expected.confidence);
  if(entries.length&&entries.length>expectations&&allExpected)
   return {month:m.key,status:'review',label:entries.length+'?',
    detail:'More tracked transactions are projected than this known recurrence expects. Review possible duplicates.',
    items:described(entries)};
  if(expectations>matched)
   return {month:m.key,status:'missing',label:matched?matched+' / '+expectations:'!',
    detail:expectations+' recurring payments are expected from identified schedules, but only '+
     matched+' matching forecast transactions are included this month.',items:described(entries)};
  if(entries.length&&expectations===matched&&(!lacksSchedule||expectations===0))
   return {month:m.key,status:'covered',label:'✓ '+entries.length,
    detail:'These '+entries.length+' owner-identified transaction'+
     (entries.length===1?' is':'s are')+' included in the actual balance forecast.'+
     (lacksSchedule?' Another identified series has no verified cadence.':''),
    items:described(entries)};
  if(entries.length)return {month:m.key,status:'review',label:'? '+entries.length,
   detail:'Identified transactions are included, but one or more predictions need more dated examples.',
   items:described(entries)};
  if(absent)return {month:m.key,status:'unknown',label:'?',
   detail:'An identified transaction is not forecast in this period. The app cannot yet verify its recurrence; check Predictions.',
   items:[]};
  return {month:m.key,status:'na',label:'—',
   detail:'No identified recurring payment is due in this portion of the selected period.',items:[]};
 });
 return {...row,cells,hint:saved.length+' identified '+(row.id==='income'?'income':'payment')+
  ' stream'+(saved.length===1?'':'s'),savedAssignments:saved};
}

function mortgageCoverage({months,ledger,rows,chosen,accounts,asOf,prefs,projection}){
 const id=asId(chosen.id),expenses=actualFutureExpenses({projection,ledger,accounts}),
  saved=prefs?.mortgageCoverageRules?.[id],
  posted=historyFor(rows,accounts,id,r=>realExpense(r)&&mortgageRow(r),asOf),
  confirmed=(prefs?.futureRecurringRules||[]).filter(r=>
   asId(r.originalAccountId||r.accountId||r.fromAccountId)===id&&
   r.type==='expense'&&(mortgage(r.merchant)||mortgage(r.originalMerchant))),
  knownNames=new Set([...posted.map(r=>norm(r.merchant||r.name)),...confirmed.flatMap(r=>
   [norm(r.merchant),norm(r.originalMerchant),...(r.matchNames||[]).map(norm)])].filter(Boolean)),
  knownRuleIds=new Set(confirmed.map(r=>asId(r.id)).filter(Boolean)),
  mortgageLike=e=>saved?matchesMortgageIdentity(e,saved):
   futureNameFields(e).some(mortgage)||
   futureNameFields(e).some(x=>knownNames.has(norm(x)))||
   knownRuleIds.has(asId(e.ruleId||e.recurringRuleId)),
  own=expenses.filter(e=>asId(e.accountId)===id),
  recognized=own.filter(mortgageLike),
  lastPosted=posted.at(-1),seed=saved&&recognized.length?
   recognized[0].date:
   confirmed.find(r=>date(r.anchorDate))?.anchorDate||
   lastPosted?.date||recognized[0]?.date,
  expected=expectedMonthly(seed,months);
 const selectedHasEvidence=Boolean(saved)||posted.length>0||confirmed.length>0||recognized.length>0;
 // A mortgage on an account other than the selected account is not absent
 // from the *household* forecast. It also must not be marked as affecting the
 // balance curve of the account being inspected.
 if(!selectedHasEvidence){
  const elsewhere=expenses.filter(e=>asId(e.accountId)!==id&&mortgageLike(e));
  if(elsewhere.length)return {id:'mortgage',title:'Mortgage',
   hint:'Paid from another account',cells:months.map(m=>{
    const entries=elsewhere.filter(e=>dayWithin(m,e.date)),
     names=[...new Set(entries.map(e=>accounts.find(a=>asId(a.id)===asId(e.accountId))?.name||'another account'))];
    return {month:m.key,status:entries.length?'external':'unknown',
     label:entries.length?'Other':'?',detail:entries.length?
      'Predicted mortgage exists in '+names.join(', ')+
      ', not in the selected '+chosen.name+' balance. Switch to that account to see its effect.':
      'No identifiable mortgage is predicted within this part of the forecast',
     items:described(entries.map(e=>({...e,
      merchant:(e.merchant||'Mortgage')+' · '+(accounts.find(a=>asId(a.id)===asId(e.accountId))?.name||'Other account')})))};
   })};
  return {id:'mortgage',title:'Mortgage',hint:'Selected account',
   cells:months.map(m=>({month:m.key,status:'unknown',label:'?',
    detail:'The app cannot identify a recurring mortgage prediction for this account',
    items:[]}))};
 }
 // An edited mortgage can have a new merchant label. Reconcile missing names
 // to one unique, dated, amount-matched projected debit from the SAME
 // account, only when posted history proves the original mortgage amount.
 // This never fabricates a payment, and the UI discloses the weaker match.
 const candidates=new Map();
 // A renamed ACH mortgage may have different labels, dates and amounts.
 // A unique plausible same-month debit is a REVIEW, not a missing payment
 // or a fabricated green check.
 const referenceAmount=Number(lastPosted?.amount||
  confirmed.find(r=>Number(r.matchAmount)>0)?.matchAmount||
  confirmed.find(r=>Number(r.amount)>0)?.amount);
 if(Number.isFinite(referenceAmount)&&referenceAmount>0&&expected.length){
  for(const due of expected){
   if(recognized.some(e=>e.date.slice(0,7)===due.slice(0,7)))continue;
   const comparable=own.filter(e=>!recognized.includes(e)&&
    e.date.slice(0,7)===due.slice(0,7)&&
    Math.abs(Number(e.amount)-referenceAmount)<=Math.max(60,referenceAmount*.25));
   const precise=comparable.filter(e=>nearPayment(e,due,referenceAmount));
   const match=precise.length===1?precise[0]:comparable.length===1?comparable[0]:null;
   if(match)candidates.set(match,true);
  }
 }
 // Source-matched events count as known mortgages. Amount/date-only matches
 // need a review indicator, never the same green check as a linked rule.
 const matched=[...recognized,...candidates.keys()];
 const hasHistory=posted.length>0,hasRules=confirmed.length>0||Boolean(saved);
 // The Predictions tab shows ALL accounts. A mortgage moved to another
 // account must be named, not falsely presented as absent everywhere.
 if(!matched.length){
  const elsewhere=expenses.filter(e=>asId(e.accountId)!==id&&mortgageLike(e));
  if(elsewhere.length)return {id:'mortgage',title:'Mortgage',
   hint:'Check paying account',cells:months.map(m=>{
    const entries=elsewhere.filter(e=>dayWithin(m,e.date));
    const names=[...new Set(entries.map(e=>accounts.find(a=>
     asId(a.id)===asId(e.accountId))?.name||'another account'))];
    return {month:m.key,status:entries.length?'review':'missing',
     label:entries.length?'Other?':'!',
     detail:entries.length?
      'The mortgage is in Predictions for '+names.join(', ')+
      ', but bank history or a saved prediction points to '+chosen.name+
      '. Check which account is actually paying it; this selected balance does not include the debit.':
      'The expected mortgage is not predicted in any identified paying account during these dates',
     items:described(entries.map(e=>({...e,merchant:
      (e.merchant||'Mortgage')+' · '+(accounts.find(a=>
       asId(a.id)===asId(e.accountId))?.name||'Other account')})))};
   })};
 }
 if(!hasHistory&&!hasRules){
  // Repeating explicitly named predictions show as forecasted, not missing.
  // A single one-off cannot prove future monthly coverage.
  const monthlyRecognized=recognized.length>=2&&
   new Set(recognized.map(e=>e.date.slice(0,7))).size>=2;
  const evidence=monthlyRecognized;
  return {id:'mortgage',title:'Mortgage',hint:'Selected account',
   cells:months.map(m=>{
    const entries=matched.filter(e=>dayWithin(m,e.date));
    return {month:m.key,status:entries.length&&evidence?'covered':'unknown',
     label:entries.length?(evidence?'✓ ':'? ')+entries.length:'?',
     detail:entries.length?(evidence?
      'Recurring mortgage predictions are included in this account balance; confirm the prediction against your lender.':
      'Mortgage-like predictions are included, but a monthly due prediction has not been verified.'):
      'No confirmed mortgage prediction is available to check this month',
     items:described(entries)};
   })};
 }
 return {id:'mortgage',title:'Mortgage',hint:'Selected account',cells:months.map(m=>{
  const due=expected.filter(d=>dayWithin(m,d));
  const entries=matched.filter(e=>dayWithin(m,e.date)),
   guessed=entries.some(e=>candidates.has(e));
  if(!due.length&&!entries.length)return {month:m.key,status:'na',label:'—',
   detail:'No expected mortgage date falls inside this part of the month',items:[]};
  if(!due.length&&entries.length)return {month:m.key,status:'review',
   label:entries.length+'?',detail:'Mortgage prediction is present but does not match the expected monthly prediction',
   items:described(entries)};
  if(entries.length>due.length)return {month:m.key,status:'review',
   label:entries.length+'?',detail:'More than one possible mortgage withdrawal is predicted for this month. Check for duplicates.',
   items:described(entries)};
  if(entries.length<due.length){
   const elsewhere=expenses.filter(e=>asId(e.accountId)!==id&&
    due.some(d=>dayWithin(m,e.date)||Math.abs(daysBetween(e.date,d))<=9)&&
    (mortgageLike(e)||referenceAmount>0&&
     Math.abs(Number(e.amount)-referenceAmount)<=Math.max(60,referenceAmount*.25)));
   const adjacent=own.filter(e=>!entries.includes(e)&&!candidates.has(e)&&
    due.some(d=>Math.abs(daysBetween(e.date,d))<=9)&&
    (mortgageLike(e)||referenceAmount>0&&
     Math.abs(Number(e.amount)-referenceAmount)<=Math.max(60,referenceAmount*.25)));
   const ambiguous=own.filter(e=>!entries.includes(e)&&dayWithin(m,e.date)&&
    referenceAmount>0&&Math.abs(Number(e.amount)-referenceAmount)<=Math.max(60,referenceAmount*.25));
   const plausible=[...new Set([...elsewhere,...adjacent,...ambiguous])];
   if(plausible.length){
    const names=[...new Set(plausible.map(e=>accounts.find(a=>
     asId(a.id)===asId(e.accountId))?.name||'Another account'))];
    return {month:m.key,status:'review',label:plausible.length+'?',
     detail:'The expected mortgage may be among these projected withdrawals'+
      (elsewhere.length?' on '+names.join(', '):'')+
      '. It is present in Predictions, but its identity, paying account, amount or posting date needs confirmation.',
     items:described([...entries,...plausible])};
   }
   return {month:m.key,status:'missing',
    label:entries.length?entries.length+' / '+due.length:'!',
    detail:'An expected mortgage withdrawal is absent from the projected withdrawals for this month',
    items:described(entries)};
  }
  return {month:m.key,status:guessed?'review':'covered',
   label:(guessed?'? ':'✓ ')+entries.length,
   detail:guessed?
    'A withdrawal matching the expected mortgage amount and date is in Predictions, but its merchant identity needs confirmation. It is not missing from the balance.':
    'Mortgage withdrawal is included in the selected account balance and the expected monthly prediction.',
   items:described(entries)};
 })};
}
function cadenceFor(history){
 const list=[...new Set(history.map(r=>r.date))].sort();
 if(list.length<2)return null;
 const gaps=list.slice(1).map((d,i)=>daysBetween(d,list[i]));
 const last=gaps.slice(-4),biweekly=last.length>=2&&last.every(g=>g>=12&&g<=16),
  monthly=last.length>=1&&last.every(g=>g>=25&&g<=36);
 if(biweekly)return 'biweekly';
 if(monthly)return 'monthly';
 if(last.length>=3&&last.every(g=>g>=12&&g<=19))return 'twice-monthly';
 return null;
}
function projectedIncomeSlots(records,months){
 const groups=new Map();
 for(const r of records){
  const key=norm(r.merchant||r.name);
  if(!key)continue;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(r);
 }
 const slots=[];
 for(const [source,group] of groups){
  const distinct=new Set(group.map(r=>r.date.slice(0,7)));
  if(group.length<2||distinct.size<2)continue;
  const rhythm=cadenceFor(group),seed=group.at(-1).date;
  if(rhythm==='monthly')
   slots.push(...expectedMonthly(seed,months).map(date=>({date,source})));
  if(rhythm==='biweekly'){
   for(let d=day(seed,14),n=0;n<36&&d<=months.at(-1).end;d=day(d,14),n++)
    if(d>=months[0].start)slots.push({date:d,source});
  }
  if(rhythm==='twice-monthly'){
   const days=[...new Set(group.slice(-6).map(r=>Number(r.date.slice(-2))))]
    .sort((a,b)=>a-b);
   if(days.length===2){
    for(const m of months)for(const dom of days){
     const end=Number(day(monthEnd(m.key),-1).slice(-2));
     const when=m.key+'-'+String(Math.min(dom,end)).padStart(2,'0');
     if(dayWithin(m,when))slots.push({date:when,source});
    }
   }
  }
 }
 return slots.sort((a,b)=>a.date.localeCompare(b.date)||a.source.localeCompare(b.source));
}
function incomeCoverage({months,ledger,rows,chosen,accounts,asOf,prefs}){
 const id=asId(chosen.id),
  posted=historyFor(rows,accounts,id,realIncome,asOf),
  planned=(ledger||[]).filter(e=>e.kind==='event'&&e.type==='income'&&
   asId(e.accountId)===id);
 let slots=projectedIncomeSlots(posted,months);
 // Saved recurring payroll is authoritative when history is sparse. Generate
 // slots from each separate confirmed rule (including alternating 4-week
 // income streams), never lump those two rules together by merchant alone.
 const confirmed=(prefs?.futureRecurringRules||[]).filter(r=>r.type==='income'&&
  asId(r.originalAccountId||r.accountId)===id&&date(r.anchorDate));
 const confirmedSources=new Set(confirmed.map(r=>norm(r.originalMerchant||r.merchant)));
 slots=slots.filter(x=>!confirmedSources.has(x.source));
 for(const rule of confirmed){
  const source=norm(rule.originalMerchant||rule.merchant),freq=rule.frequency;
  if(['monthly','quarterly','semiannual','annual'].includes(freq)){
   const step={monthly:1,quarterly:3,semiannual:6,annual:12}[freq];
   for(let n=0;n<24;n++){
    const d=monthPlus(rule.anchorDate,n*step);
    if(d>months.at(-1).end)break;
    if(d>=months[0].start)slots.push({date:d,source,ruleId:rule.id});
   }
  }else if(['biweekly','every-4-weeks','weekly'].includes(freq)){
   const step={biweekly:14,'every-4-weeks':28,weekly:7}[freq];
   for(let d=rule.anchorDate,n=0;n<65&&d<=months.at(-1).end;d=day(d,step),n++)
    if(d>=months[0].start)slots.push({date:d,source,ruleId:rule.id});
  }else if(freq==='twice-monthly'){
   for(const m of months)for(const dom of [Number(rule.anchorDate.slice(-2)),Number(rule.secondDay||0)]){
    if(!(dom>=1&&dom<=31))continue;
    const actual=Math.min(dom,Number(day(monthEnd(m.key),-1).slice(-2)));
    const d=m.key+'-'+String(actual).padStart(2,'0');
    if(d>=rule.anchorDate&&dayWithin(m,d))slots.push({date:d,source,ruleId:rule.id});
   }
  }
 }
 slots.sort((a,b)=>a.date.localeCompare(b.date));
 const groups=new Map();
 for(const r of posted){
  const key=norm(r.merchant||r.name);
  if(!groups.has(key))groups.set(key,new Set());
  groups.get(key).add(r.date.slice(0,7));
 }
 const payees=new Set([...groups].filter(([,set])=>set.size>=2).map(([key])=>key));
 const fullCounts=new Map();
 for(const r of posted){
  if(!payees.has(norm(r.merchant||r.name)))continue;
  const month=r.date.slice(0,7);
  if(month>=asOf.slice(0,7))continue;
  fullCounts.set(month,(fullCounts.get(month)||0)+1);
 }
 const counts=[...fullCounts.entries()].sort(([a],[b])=>b.localeCompare(a)).slice(0,3).map(([,n])=>n);
 const typical=slots.length?null:counts.length>=2?Math.min(...counts):null;
 return {id:'income',title:'Income',hint:'Selected account',cells:months.map(m=>{
  const items=planned.filter(e=>dayWithin(m,e.date)),
   expectedSlots=slots.filter(x=>dayWithin(m,x.date));
  const bySource=new Map();
  for(const slot of expectedSlots){
   const key=asId(slot.ruleId||slot.source);
   if(!bySource.has(key))bySource.set(key,{source:slot.source,ruleId:slot.ruleId,count:0});
   bySource.get(key).count++;
  }
  let matched=0;
  for(const group of bySource.values()){
   const candidates=items.filter(e=>group.ruleId?
    asId(e.ruleId||e.recurringRuleId)===asId(group.ruleId):
    norm(e._forecastOriginalMerchant||e.originalMerchant||e.merchant)===group.source);
   matched+=Math.min(group.count,candidates.length);
  }
  const count=expectedSlots.length||(m.full?typical:null);
  if(count===null){
   return {month:m.key,status:items.length?'review':'unknown',label:items.length?'? '+items.length:'?',
    detail:items.length?'Deposits are forecast but their repeating pay prediction is not verified':
     'No reliable recurring pay prediction has been established for this partial month',
    items:described(items)};
  }
  if(!count)return {month:m.key,status:items.length?'review':'na',
   label:items.length?'? '+items.length:'—',
   detail:'No predicted pay date is established for this portion of the month',
   items:described(items)};
  const satisfied=expectedSlots.length?matched:Math.min(count,items.length);
  if(satisfied<count)return {month:m.key,status:'missing',
   label:satisfied?satisfied+' / '+count:'!',
   detail:'Expected '+count+' recurring deposit'+(count===1?'':'s')+' but only '+satisfied+
    ' matching prediction'+(satisfied===1?'':'s')+' appear in this selected period',
   items:described(items)};
  return {month:m.key,status:'covered',label:'✓ '+items.length,
   detail:items.length+' dated deposit'+(items.length===1?'':'s')+
    ' included in the forecast; bank receipt and amount are not guaranteed',items:described(items)};
 })};
}
function otherMajorCoverage({months,ledger,rows,chosen,accounts,asOf,prefs}){
 const id=asId(chosen.id),history=historyFor(rows,accounts,id,r=>
  realExpense(r)&&!mortgageRow(r)&&Number(r.amount)>=150,asOf),groups=new Map();
 for(const r of history){
  const key=norm(r.merchant||r.name);
  if(!key)continue;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(r);
 }
 const explicit=(prefs?.futureRecurringRules||[]).filter(r=>
  asId(r.originalAccountId||r.accountId||r.fromAccountId)===id&&r.type==='expense'&&
  r.frequency==='monthly'&&Number(r.amount)>=150&&
  !mortgage(r.originalMerchant)&&!mortgage(r.merchant));
 for(const r of explicit){
  const key=norm(r.originalMerchant||r.merchant);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push({date:r.anchorDate,merchant:r.originalMerchant||r.merchant,
   amount:Number(r.amount),confirmed:true});
 }
 const due=[];
 for(const [source,g] of groups){
  const dates=[...new Set(g.filter(x=>!x.confirmed).map(x=>x.date))].sort(),
   last=dates.at(-1),gaps=dates.slice(1).map((d,i)=>daysBetween(d,dates[i]));
  const stable=dates.length>=3&&
   new Set(dates.map(d=>d.slice(0,7))).size>=3&&gaps.slice(-2).every(n=>n>=25&&n<=36),
   verified=g.some(x=>x.confirmed);
  if(!stable&&!verified)continue;
  const anchor=verified?g.find(x=>x.confirmed).date:last;
  for(const d of expectedMonthly(anchor,months))due.push({date:d,source});
 }
 if(!due.length)return {id:'other-bills',title:'Other major bills',hint:'Identify recurring payments',
  cells:months.map(m=>({month:m.key,status:'unknown',label:'?',
   detail:'No repeated major bill prediction has been identified. Select an existing prediction below to teach this category.',items:[]}))};
 const planned=(ledger||[]).filter(e=>futureExpense(e)&&asId(e.accountId)===id&&!mortgage(e.merchant));
 return {id:'other-bills',title:'Other major bills',hint:'Repeating $150+ bills',cells:months.map(m=>{
  const expected=due.filter(x=>dayWithin(m,x.date)),mine=planned.filter(e=>
   dayWithin(m,e.date)&&due.some(d=>d.source===norm(e._forecastOriginalMerchant||e.merchant)));
  if(!expected.length)return {month:m.key,status:'na',label:'—',
   detail:'No identified large repeating bill is due in these selected days',items:[]};
  const matched=expected.filter(x=>mine.some(e=>
   norm(e._forecastOriginalMerchant||e.merchant)===x.source&&
   Math.abs(daysBetween(e.date,x.date))<=7));
  if(matched.length<expected.length)return {month:m.key,status:'missing',
   label:matched.length?matched.length+' / '+expected.length:'!',
   detail:'At least one historically recurring major bill is absent from the future ledger',
   items:described(mine)};
  return {month:m.key,status:'covered',label:'✓ '+mine.length,
   detail:'Identified repeating large bills are represented by actual dated predictions',
   items:described(mine)};
 })};
}
function cardCoverage({months,ledger,accounts,chosen,prefs,payments,ready}){
 return accounts.filter(credit).map(card=>{
  const rule=prefs?.paymentRules?.[card.id],configured=Boolean(rule)&&ready(rule,card,accounts),
   inferred=(payments?.cardEstimates||[]).find(x=>asId(x.cardId)===asId(card.id)&&x.eligible),
   due=configured?expectedMonthly(rule.nextPaymentDate,months):
    inferred?expectedMonthly(inferred.nextPaymentDate,months):[],
   cardId=asId(card.id),payer=asId(rule?.fromAccountId||inferred?.fromAccountId),
   funding=accounts.find(a=>asId(a.id)===payer),
   plans=(ledger||[]).filter(e=>e.kind==='movement'&&
    asId(e.toAccountId)===cardId&&asId(e.fromAccountId)===payer),
   statements=payments?.statements||[],
   inChosen=payer===asId(chosen.id);
  const cells=months.map(m=>{
   if(!configured){
    const relevant=plans.filter(p=>dayWithin(m,p.date)),expected=due.filter(d=>dayWithin(m,d)),
     entries=described(relevant.map(p=>({...p,merchant:p.merchant||card.name+' estimated card payment'})));
    if(inferred&&relevant.length)return {month:m.key,
     status:inChosen?'review':'external',label:'~ '+relevant.length,
     detail:'Estimated checking-to-card payment inferred from multiple matched Plaid payment transfers and posted card spending. '+
      'The issuer statement date and amount are not confirmed. Review them in Settings.'+
      (inChosen?'':' This affects another paying account, not the selected balance.'),
     items:entries};
    if(inferred&&!expected.length)return {month:m.key,status:'na',label:'—',
     detail:'No inferred card payment is due in this portion of the forecast.',items:[]};
    return {month:m.key,status:'setup',label:'!',
     detail:'Card payment details are incomplete. Plaid purchases alone cannot establish the actual statement closing date, withdrawal date or paying account. Confirm them in Settings.',
     items:[]};
   }
   const targets=due.filter(d=>dayWithin(m,d));
   const relevant=plans.filter(p=>dayWithin(m,p.date));
   const details=described(relevant.map(p=>({...p,
    merchant:p.merchant||(p.origin==='card-autopay'?card.name+' autopay':card.name+' payment')})));
   const paid=statements.filter(s=>asId(s.cardId)===cardId&&
    dayWithin(m,s.withdrawalDate)&&s.alreadyPaid);
   if(rule.autopayEnabled===false){
    if(relevant.length)return {month:m.key,
     status:relevant.every(p=>asId(p.fromAccountId)===asId(chosen.id))?'covered':'external',
     label:'✓ '+relevant.length,detail:'A manually entered card payment is included'+
      (relevant.every(p=>asId(p.fromAccountId)===asId(chosen.id))?
       ' in this account balance.':' in another paying account, not this balance.'),
     items:details};
    return {month:m.key,status:'setup',label:'Manual',
     detail:'Autopay is off. A statement estimate is not a predicted checking withdrawal.',
     items:[]};
   }
   if(!targets.length&&!relevant.length)return {month:m.key,status:'na',label:'—',
    detail:'No configured withdrawal date falls inside this portion of the month',items:[]};
   if(paid.length&&!relevant.length)return {month:m.key,status:'posted',label:'Paid',
    detail:'The cycle was reconciled to an already-posted actual payment, not charged twice',
    items:paid.map(s=>({date:s.actualPaymentDate,amount:s.actualPaymentAmount,
     merchant:card.name+' actual payment'}))};
   if(!relevant.length)return {month:m.key,status:'missing',label:'!',
    detail:'The configured monthly payment is not a dated withdrawal in the future ledger'+
     (statements.some(s=>asId(s.cardId)===cardId&&dayWithin(m,s.withdrawalDate)&&s.amount===0)?
      ' (estimated statement amount is zero; review the card)' : ''),items:[]};
   if(!inChosen)return {month:m.key,status:'external',label:'Other',
    detail:'Payment is included in '+(funding?.name||'another account')+
     ', not in the balance curve for '+chosen.name,items:details};
   if(relevant.length!==targets.length)return {month:m.key,status:'review',label:relevant.length+'?',
    detail:'More than one withdrawal or an unmatched payment date needs review',
    items:details};
   return {month:m.key,status:'covered',label:'✓ '+relevant.length,
    detail:'Credit-card payment is included as a single linked withdrawal from '+
     (funding?.name||'checking')+'. The amount may be estimated.',items:details};
  });
  return {id:'card|'+cardId,title:asId(card.name||'Credit card')+
   (card.mask?' ••'+card.mask:''),hint:funding?'Paid from '+funding.name:'Payment setup needed',cells};
 });
}
function analyze({snapshot,chosen,bundle,prefs,days,accounts,ready}){
 const columns=months(snapshot.asOf,days),ledger=bundle?.ledger||[],rows=bundle?.rows||[],
  params={months:columns,ledger,rows,chosen,accounts,prefs,asOf:snapshot.asOf,
   projection:bundle?.projection,payments:bundle?.payments,ready};
 const lines=credit(chosen)?
  cardCoverage(params):
  [incomeCoverage(params),mortgageCoverage(params),...cardCoverage(params),
   otherMajorCoverage(params)].filter(Boolean);
 const movements=datedCashMovements({projection:bundle?.projection,ledger,accounts}),
  mortgageIdentitySaved=prefs?.mortgageCoverageRules?.[asId(chosen.id)];
 for(let i=0;i<lines.length;i++){
  const row=lines[i];
  if(row.id==='mortgage'){
   row.choices=mortgageChoicesFor(actualFutureExpenses({
    projection:bundle?.projection,ledger,accounts}),asId(chosen.id));
   row.selectedMortgage=mortgageIdentitySaved||null;
  }else{
   const learned=learnedCoverage({...params,row});
   const learnedKey=assignmentKey(row.id,chosen.id);
   learned.savedAssignments=Array.isArray(prefs?.coverageAssignments?.[learnedKey])?
    prefs.coverageAssignments[learnedKey].slice(0,15):[];
   learned.choices=categoryCandidates(row,movements,accounts,chosen,
    [mortgageIdentitySaved,
     ...Object.entries(prefs?.coverageAssignments||{}).filter(([k])=>
      k!==learnedKey).flatMap(([,v])=>Array.isArray(v)?v:[])]);
   lines[i]=learned;
  }
 }
 const review=lines.flatMap(row=>row.cells.filter(cell=>
  ['missing','setup','unknown','review'].includes(cell.status)));
 return {months:columns,rows:lines,attention:review.length,
  uncovered:review.filter(c=>c.status==='missing'||c.status==='setup').length};
}
function render(result){
 details=new Map();mortgageChoices=new Map();categoryChoices=new Map();
 const head=result.months.map(m=>
  '<th scope="col" class="coverage-month">'+escape(monthTitle(m.key))+
  (m.full?'':'<span>partial</span>')+'</th>').join('');
 let first=0;
 const rows=result.rows.map(row=>'<tr><th scope="row"><strong>'+escape(row.title)+
  '</strong><small>'+escape(row.hint)+'</small></th>'+
  row.cells.map((cell,i)=>{
   const key=String(first++);
   details.set(key,{row,cell,window:result.months[i]});
   const warning=['missing','setup','unknown','review'].includes(cell.status);
   return '<td><button class="coverage-cell '+escape(cell.status)+'" type="button"'+
    ' data-coverage-cell="'+key+'" aria-label="'+escape(row.title+', '+
     monthTitle(cell.month)+': '+cell.detail)+'" title="'+escape(cell.detail)+
     '">'+escape(cell.label)+'</button></td>';
  }).join('')+'</tr>').join('');
 return '<section class="coverage-section" aria-label="Major payment coverage">'+
  '<div class="coverage-heading"><h2>Major payments</h2><span>'+
  (result.uncovered?result.uncovered+' missing or unpredicted':result.attention?
   'Some dates need verification':'Planned items shown below')+'</span></div>'+
  '<div class="coverage-scroller" role="region" tabindex="0" aria-label="Payment coverage by calendar month">'+
  '<table class="coverage-table"><thead><tr><th scope="col">Expected</th>'+head+'</tr></thead>'+
  '<tbody>'+rows+'</tbody></table></div>'+
  '<div class="coverage-legend"><span><b>✓</b> In forecast</span>'+
  '<span><b>!</b> Missing / setup</span><span><b>?</b> Unverified</span>'+
  '<span><b>—</b> Not due in shown dates</span></div>'+
  '<div class="coverage-detail" data-coverage-detail hidden aria-live="polite"></div>'+
  '</section>';
}
document.addEventListener('click',e=>{
 const button=e.target.closest?.('[data-coverage-cell]');
 if(!button)return;
 const item=details.get(asId(button.dataset.coverageCell)),el=document.querySelector('[data-coverage-detail]');
 if(!item||!el)return;
 const {row,cell,window}=item;
 const items=cell.items.map(p=>
  '<div class="coverage-detail-event"><span>'+escape(titleDate(p.date||window.start))+
  ' · '+escape(p.merchant)+'</span><strong>'+dollars(p.amount)+'</strong></div>').join('');
 const options=row.id==='mortgage'?(row.choices||[]).map((c,i)=>{
  const key=asId(button.dataset.coverageCell)+'|'+i;
  mortgageChoices.set(key,c.identity);
  return '<button type="button" class="coverage-mortgage-option" data-coverage-mortgage="'+
   escape(key)+'">'+escape(c.merchant)+' · '+dollars(c.amount)+
   ' · '+escape(c.months>1?c.months+' forecast months':'Next '+titleDate(c.date))+
   '</button>';
 }).join(''):'';
 const identify=row.id==='mortgage'?
  '<div class="coverage-identify"><strong>'+(row.selectedMortgage?
    'Mortgage identified':'Which predicted payment is your mortgage?')+'</strong>'+
   '<p>Choose once to track the same payment across future months. This only labels existing predictions; it never adds a withdrawal.</p>'+
   (options||'<small>No eligible checking withdrawals are predicted in this date range. Check the selected account or choose a longer period.</small>')+
   (row.selectedMortgage?'<button type="button" class="coverage-mortgage-reset"'+
    ' data-coverage-mortgage-reset="'+escape(row.selectedMortgage.accountId)+'">Clear mortgage identification</button>':'')+
   '</div>':
  (()=>{const tracked=row.savedAssignments||[];
   const buttons=(row.choices||[]).map((c,i)=>{
    const selected=tracked.some(x=>matchesMortgageIdentity({
     ...c.identity,sourceMerchant:c.identity.merchant,accountId:c.identity.accountId,
     recurringRuleId:c.identity.ruleId},x));
    const key=asId(button.dataset.coverageCell)+'|'+i;
    categoryChoices.set(key,{category:row.id,accountId:c.identity.accountId,
     identity:c.identity,remove:selected});
    return '<button type="button" class="coverage-mortgage-option'+
     (selected?' tracked':'')+'" data-coverage-assign="'+escape(key)+'">'+
     (selected?'✓ ':'+ ')+escape(c.merchant)+' · '+dollars(c.amount)+
     ' · '+escape(c.months>1?c.months+' forecast months':'Next '+titleDate(c.date))+
     (selected?' · Stop tracking':'')+'</button>';
   }).join('');
   const title=row.id==='income'?'Which deposits are recurring income?':
    row.id==='other-bills'?'Which large bills should be tracked?':
    'Which withdrawal pays this credit card?';
   return '<div class="coverage-identify"><strong>'+title+'</strong>'+
    '<p>Tap each relevant prediction once. Identified series are remembered for future months, and gaps are flagged without creating extra transactions.</p>'+
    (buttons||'<small>No eligible future items in this account and time range.</small>')+
    '</div>';
  })();
 el.hidden=false;
 el.innerHTML='<div class="coverage-detail-title"><strong>'+escape(row.title)+' · '+
  escape(monthTitle(window.key))+'</strong><button type="button" class="coverage-close"'+
  ' data-coverage-close aria-label="Close payment details">×</button></div>'+
  '<p>'+escape(cell.detail)+'</p>'+items+identify+
  '<button class="coverage-open-predictions" data-view="'+(cell.status==='setup'?'settings':'transactions')+
  '" type="button">'+(cell.status==='setup'?'Set up card payments →':'View predictions →')+'</button>';
 document.querySelectorAll('[data-coverage-cell]').forEach(x=>
  x.setAttribute('aria-pressed',String(x===button)));
});
document.addEventListener('click',e=>{
 if(!e.target.closest?.('[data-coverage-close]'))return;
 const el=document.querySelector('[data-coverage-detail]');
 if(el)el.hidden=true;
 document.querySelectorAll('[data-coverage-cell]').forEach(x=>x.removeAttribute('aria-pressed'));
});
root.HouseholdPlannerCoverage={analyze,render,months,expectedMonthly,
 getMortgageChoice:key=>mortgageChoices.get(asId(key))||null,
 getCategoryChoice:key=>categoryChoices.get(asId(key))||null};
if(typeof module!=='undefined'&&module.exports)module.exports={analyze,render,months,expectedMonthly};
})(typeof window!=='undefined'?window:globalThis);
