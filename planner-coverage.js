/* Monthly assurance checks use the SAME materialized future ledger as the balance
 * curve. Expected schedules are inferred separately from posted history or a
 * saved card payment rule; a card merely being connected is not coverage. */
(function(root){
'use strict';
const asId=x=>String(x??'');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
const dollars=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(asId(s));
const day=(iso,delta)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)};
const monthPlus=(iso,n)=>{const [y,m,d]=iso.split('-').map(Number);
 const x=new Date(Date.UTC(y,m-1+n,1)),end=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0)).getUTCDate();
 return x.toISOString().slice(0,7)+'-'+String(Math.min(d,end)).padStart(2,'0')};
const monthEnd=m=>monthPlus(m+'-01',1).slice(0,7)+'-01';
const daysBetween=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
const titleDate=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const monthTitle=m=>new Date(m+'-15T12:00:00Z').toLocaleDateString('en-US',{month:'short',year:'2-digit',timeZone:'UTC'});
const mortgage=s=>/\b(?:mortgage|mtg|home[\s-]*loan|pennymac|loandepot|newrez|shellpoint|mr[\s.]*cooper|rocket[\s-]*mortgage)\b/i.test(asId(s));
const norm=s=>asId(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const credit=a=>asId(a?.accountType||a?.type).toLowerCase()==='credit';
const accountFor=(row,accounts)=>{
 const raw=asId(row?.accountId||row?.account||'');
 const aliases=(accounts||[]).filter(a=>[a.id,a.name,a.transactionAccount].some(v=>asId(v)===raw));
 return aliases.length===1?asId(aliases[0].id):raw;
};
const mortgageRow=r=>mortgage(r.merchant||r.description||r.name)||
 /MORTGAGE/.test(asId(r.personal_finance_category?.detailed||r.source?.personalFinanceCategory?.detailed||r.category).toUpperCase());
const realExpense=r=>r&&!r.pending&&Number(r.amount)>0&&
 (r.type==='expense'||r.type==='transfer'&&r.cashDirection==='out'&&!r.pairedTransactionId);
const realIncome=r=>r&&!r.pending&&Number(r.amount)>0&&
 (r.type==='income'||r.type==='transfer'&&r.cashDirection==='in'&&!r.pairedTransactionId);
const futureExpense=e=>e&&e.kind==='event'&&e.type==='expense';
const dayWithin=(m,d)=>date(d)&&d>=m.start&&d<=m.end;
const initCells=months=>months.map(m=>({month:m.key,status:'na',label:'—',detail:'No known due date in this portion of the forecast',items:[]}));
const described=items=>items.map(e=>
 ({date:e.date||e.anchorDate,amount:Number(e.amount)||0,merchant:asId(e.merchant||e.name||'Payment')}));
let details=new Map();
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
function historical(rows,accounts,accountId,check,asOf){
 return (rows||[]).filter(r=>accountFor(r,accounts)===accountId&&
  r.date<=asOf&&realExpense(r)||false).filter(check).sort((a,b)=>a.date.localeCompare(b.date));
}
function historyFor(rows,accounts,accountId,predicate,asOf){
 return (rows||[]).filter(r=>r.date<=asOf&&
  accountFor(r,accounts)===accountId&&predicate(r))
  .sort((a,b)=>a.date.localeCompare(b.date));
}
function billCells({months,found,expected,reason,tooMany=false}){
 return months.map(m=>{
  const due=expected.filter(d=>dayWithin(m,d));
  const items=found.filter(e=>dayWithin(m,e.date));
  if(!due.length&&!items.length)return {month:m.key,status:'na',label:'—',
   detail:'No expected payment falls inside '+titleDate(m.start)+'–'+titleDate(m.end),items:[]};
  if(!due.length&&items.length)return {month:m.key,status:'review',label:items.length+'?',
   detail:'This payment is predicted, but its due date is not matched to the usual schedule',items:described(items)};
  if(!items.length)return {month:m.key,status:'missing',label:'!',
   detail:reason||'Expected payment is not included in the balance forecast',items:[]};
  if(items.length>due.length||tooMany&&items.length>1)return {month:m.key,status:'review',label:items.length+'?',
   detail:'More payments than expected are included; verify no double counting',items:described(items)};
  if(items.length<due.length)return {month:m.key,status:'missing',label:items.length+' / '+due.length,
   detail:'Not every expected payment is included in this period',items:described(items)};
  return {month:m.key,status:'covered',label:'✓ '+items.length,
   detail:'Predicted withdrawal included in the account balance',items:described(items)};
 });
}
function mortgageCoverage({months,ledger,rows,chosen,accounts,asOf,prefs}){
 const id=asId(chosen.id),
  posted=historyFor(rows,accounts,id,r=>realExpense(r)&&mortgageRow(r),asOf),
  knownNames=new Set(posted.map(r=>norm(r.merchant))),
  confirmed=(prefs?.futureRecurringRules||[]).filter(r=>
   asId(r.originalAccountId||r.accountId||r.fromAccountId)===id&&
   r.type==='expense'&&(mortgage(r.merchant)||mortgage(r.originalMerchant))),
  planned=(ledger||[]).filter(e=>
   futureExpense(e)&&asId(e.accountId)===id&&
   (mortgage(e.merchant)||mortgage(e._forecastOriginalMerchant)||
    knownNames.has(norm(e.merchant))||knownNames.has(norm(e._forecastOriginalMerchant)))),
  hasHistory=posted.length>0,
  seed=posted.at(-1)?.date||confirmed.at(0)?.anchorDate||planned.at(0)?.date;
 // Without an observed/confirmed mortgage schedule, seeing a single future
 // expense is not enough evidence to assert that every month is covered.
 if(!hasHistory&&!confirmed.length){
  return {id:'mortgage',title:'Mortgage',hint:'Selected account',
   cells:months.map(m=>{
    const items=planned.filter(e=>dayWithin(m,e.date));
    return {month:m.key,status:'unknown',label:items.length?'? '+items.length:'?',
     detail:items.length?'Mortgage-looking payment is present, but its monthly schedule is not verified':
      'No reliable recurring mortgage schedule has been identified for this account',
     items:described(items)};
   })};
 }
 const due=expectedMonthly(seed,months);
 return {id:'mortgage',title:'Mortgage',hint:'Selected account',
  cells:billCells({months,found:planned,expected:due,
   reason:'Mortgage is expected from bank history or your saved schedule but is absent from the future ledger',
   tooMany:true})};
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
    detail:items.length?'Deposits are forecast but their repeating pay schedule is not verified':
     'No reliable recurring pay schedule has been established for this partial month',
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
 if(!due.length)return null;
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
  const rule=prefs?.paymentRules?.[card.id],configured=ready(rule,card,accounts),
   due=configured?expectedMonthly(rule.nextPaymentDate,months):[],
   cardId=asId(card.id),payer=asId(rule?.fromAccountId),
   funding=accounts.find(a=>asId(a.id)===payer),
   plans=(ledger||[]).filter(e=>e.kind==='movement'&&
    asId(e.toAccountId)===cardId&&asId(e.fromAccountId)===payer),
   statements=payments?.statements||[],
   inChosen=payer===asId(chosen.id);
  const cells=months.map(m=>{
   if(!configured)return {month:m.key,status:'setup',label:'!',
    detail:'Card payment setup is incomplete. No future checking withdrawal is assured.',
    items:[]};
   const targets=due.filter(d=>dayWithin(m,d));
   const relevant=plans.filter(p=>dayWithin(m,p.date));
   const paid=statements.filter(s=>asId(s.cardId)===cardId&&
    dayWithin(m,s.withdrawalDate)&&s.alreadyPaid);
   if(rule.autopayEnabled===false)return {month:m.key,status:'setup',label:'Manual',
    detail:'Autopay is off. A statement estimate is not a scheduled checking withdrawal.',
    items:[]};
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
     ', not in the balance curve for '+chosen.name,items:described(relevant)};
   if(relevant.length!==targets.length)return {month:m.key,status:'review',label:relevant.length+'?',
    detail:'More than one withdrawal or an unmatched payment date needs review',
    items:described(relevant)};
   return {month:m.key,status:'covered',label:'✓ '+relevant.length,
    detail:'Credit-card payment is included as a single linked withdrawal from '+
     (funding?.name||'checking')+'. The amount may be estimated.',items:described(relevant)};
  });
  return {id:'card|'+cardId,title:asId(card.name||'Credit card')+
   (card.mask?' ••'+card.mask:''),hint:funding?'Paid from '+funding.name:'Payment setup needed',cells};
 });
}
function analyze({snapshot,chosen,bundle,prefs,days,accounts,ready}){
 const columns=months(snapshot.asOf,days),ledger=bundle?.ledger||[],rows=bundle?.rows||[],
  params={months:columns,ledger,rows,chosen,accounts,prefs,asOf:snapshot.asOf,
   payments:bundle?.payments,ready};
 const lines=credit(chosen)?
  cardCoverage(params):
  [incomeCoverage(params),mortgageCoverage(params),...cardCoverage(params),
   otherMajorCoverage(params)].filter(Boolean);
 const review=lines.flatMap(row=>row.cells.filter(cell=>
  ['missing','setup','unknown','review'].includes(cell.status)));
 return {months:columns,rows:lines,attention:review.length,
  uncovered:review.filter(c=>c.status==='missing'||c.status==='setup').length};
}
function render(result){
 details=new Map();
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
  (result.uncovered?result.uncovered+' missing or unscheduled':result.attention?
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
 el.hidden=false;
 el.innerHTML='<div class="coverage-detail-title"><strong>'+escape(row.title)+' · '+
  escape(monthTitle(window.key))+'</strong><button type="button" class="coverage-close"'+
  ' data-coverage-close aria-label="Close payment details">×</button></div>'+
  '<p>'+escape(cell.detail)+'</p>'+items+
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
root.HouseholdPlannerCoverage={analyze,render,months,expectedMonthly};
if(typeof module!=='undefined'&&module.exports)module.exports={analyze,render,months,expectedMonthly};
})(typeof window!=='undefined'?window:globalThis);
