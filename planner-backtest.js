/* Historical prediction audit. Read-only and strictly walk-forward:
 * Each month is predicted using ONLY bank transactions posted before that month.
 * Current confirmation decisions, card statement amounts and live balances are
 * deliberately excluded: reusing them would leak future knowledge.
 */
(function(root){
'use strict';
const DAY=86400000;
const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const date=s=>new Date(s+'T12:00:00Z');
const plusDays=(s,n)=>{const d=date(s);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const monthShift=(s,n)=>new Date(Date.UTC(+s.slice(0,4),+s.slice(5,7)-1+n,1,12)).toISOString().slice(0,7);
const monthEnd=m=>new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0,12)).toISOString().slice(0,10);
const monthIndex=s=>+s.slice(0,4)*12+(+s.slice(5,7));
const diff=(a,b)=>Math.round((date(a)-date(b))/DAY);
const money=n=>Math.round(Number(n)*100);
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+(?:\d{4,}|x{4,})$/,'');
const settlement=/\b(?:credit card payment|card payment|payment thank you|payment to (?:visa|mastercard|amex|discover)|visa autopay|mastercard autopay|amex autopay)\b/i;
function classify(t){
 if(t.type==='income')return 'income';
 if(t.type==='expense')return 'expense';
 return null;
}
function accountResolver(accounts=[]){
 const ids=new Set(accounts.map(a=>String(a.id)));
 const aliases=new Map();
 for(const a of accounts){
  for(const name of [a.name,a.transactionAccount]){
   const key=norm(name);if(!key)continue;
   if(!aliases.has(key))aliases.set(key,new Set());
   aliases.get(key).add(String(a.id));
  }
 }
 return value=>{
  const raw=String(value||'');
  if(ids.has(raw))return raw;
  const aliasesFor=aliases.get(norm(raw));
  return aliasesFor?.size===1?[...aliasesFor][0]:raw;
 };
}
function ruleKey(t,resolve){return [classify(t)||t.type,resolve(t.accountId||t.account),norm(t.merchant)].join('|')}
function latestThree(rows){
 return rows.filter(t=>valid(t.date)&&!t.pending&&money(t.amount)>0)
  .sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id))).slice(-3);
}
function goodSequence(rows,step){
 const last=latestThree(rows);
 if(last.length!==3||last.some(t=>money(t.amount)!==money(last[0].amount)))return false;
 const days=last.map(t=>+t.date.slice(8,10));
 return Math.max(...days)-Math.min(...days)<=6&&last.slice(1).every((t,i)=>
  monthIndex(t.date)-monthIndex(last[i].date)===step);
}
function previouslyStable(t,history,resolve,planner){
 if(!classify(t)||!planner.periodic)return false;
 if(t.type==='expense'&&!planner.periodic(t.merchant,t.category,
   t.source?.personalFinanceCategory||t.personal_finance_category))return false;
 const matches=history.filter(h=>ruleKey(h,resolve)===ruleKey(t,resolve));
 const postingDay=+t.date.slice(8,10);
 // Two monthly paychecks under one name are evaluated in separate calendar slots.
 const nearSlot=matches.filter(h=>Math.abs(+h.date.slice(8,10)-postingDay)<=6);
 for(const [rows,step] of [[nearSlot,1],[nearSlot,3],[nearSlot,6],[nearSlot,12]]){
  if(goodSequence(rows,step)){
   const last=latestThree(rows).at(-1);
   const age=monthIndex(t.date)-monthIndex(last.date);
   if(age>=step&&age<=step+1)return true;
  }
 }
 const recent=matches.filter(h=>h.date>=monthShift(t.date,-3))
  .sort((a,b)=>a.date.localeCompare(b.date));
 const last=recent.slice(-4);
 if(last.length>=4&&last.every(h=>money(h.amount)===money(last[0].amount))){
  for(const step of [7,14]){
   if(last.slice(1).every((h,i)=>Math.abs(diff(h.date,last[i].date)-step)<=2)&&
      diff(t.date,last.at(-1).date)>0&&diff(t.date,last.at(-1).date)<=step+3)return true;
  }
 }
 return false;
}
function compare(predicted,actual,history,resolve,planner,windowMonth){
 const predictions=(predicted||[]).filter(t=>classify(t)&&valid(t.date)&&money(t.amount)>0)
  .map(t=>({...t,auditKey:ruleKey(t,resolve)}));
 const observed=(actual||[]).filter(t=>classify(t)&&valid(t.date)&&money(t.amount)>0);
 const eligible=observed.filter(t=>previouslyStable(t,history,resolve,planner))
  .map(t=>({...t,auditKey:ruleKey(t,resolve)}));
 const usedPred=new Set(),usedActual=new Set();
 const issues=[];
 let matched=0,changed=0,drift=0;
 for(let i=0;i<eligible.length;i++){
  const row=eligible[i];
  const candidates=predictions.map((p,j)=>({p,j,days:Math.abs(diff(p.date,row.date)),
   dollars:Math.abs(money(p.amount)-money(row.amount))}))
   .filter(q=>!usedPred.has(q.j)&&q.p.auditKey===row.auditKey&&q.days<=5)
   .sort((a,b)=>a.days-b.days||a.dollars-b.dollars);
  if(!candidates.length)continue;
  const exact=candidates.find(q=>q.dollars<=1);
  const found=exact||candidates[0];
  usedPred.add(found.j);usedActual.add(i);
  if(found.dollars<=1){matched++;if(found.days>2)drift++}
  else {
   changed++;
   issues.push({kind:'amount changed',merchant:row.merchant,account:row.accountId||row.account,
    date:row.date,expected:found.p.amount,actual:row.amount,month:windowMonth});
  }
 }
 for(let i=0;i<eligible.length;i++)if(!usedActual.has(i)){
  const t=eligible[i];issues.push({kind:'missed',merchant:t.merchant,account:t.accountId||t.account,
   date:t.date,actual:t.amount,month:windowMonth});
 }
 let duplicates=0,extra=0;
 for(let j=0;j<predictions.length;j++)if(!usedPred.has(j)){
  const t=predictions[j];
  const duplicate=predictions.some((other,k)=>k!==j&&usedPred.has(k)&&
   other.auditKey===t.auditKey&&Math.abs(diff(other.date,t.date))<=4&&
   Math.abs(money(other.amount)-money(t.amount))<=1);
  if(duplicate)duplicates++;else extra++;
  issues.push({kind:duplicate?'duplicate':'unmatched forecast',merchant:t.merchant,
   account:t.accountId||t.account,date:t.date,expected:t.amount,month:windowMonth});
 }
 return {predicted:predictions.length,eligible:eligible.length,matched,changed,
  missed:eligible.length-matched-changed,extra,duplicates,drift,issues};
}
function build(state,asOf,accountId,engine,options={}){
 if(!valid(asOf)||!accountId||!engine?.model?.migrate||!engine?.model?.records||
  !engine?.ledger?.build||!engine?.forecast||!engine?.planner?.project)
  throw Error('Historical audit needs a valid account, date and forecasting engine');
 const maxMonths=Math.min(12,Math.max(1,Number(options.months)||6));
 const all=engine.model.records(state).filter(t=>valid(t.date)&&t.date<=asOf&&!t.pending);
 const resolve=accountResolver(options.accounts||state.accounts||[]);
 const target=String(accountId),belongs=t=>resolve(t.accountId||t.account)===target;
 const accountRows=all.filter(belongs);
 const endMonth=monthShift(asOf.slice(0,7),-1);
 const windows=[],totals={predicted:0,eligible:0,matched:0,changed:0,missed:0,
  extra:0,duplicates:0,drift:0},issues=[];
 let excludedWindows=0,cardSettlements=0;
 for(let i=maxMonths-1;i>=0;i--){
  const evaluated=monthShift(endMonth,-i),cutoff=monthEnd(monthShift(evaluated,-1));
  const actualRows=accountRows.filter(t=>t.date.slice(0,7)===evaluated);
  const historical=accountRows.filter(t=>t.date<=cutoff);
  const covered=new Set(historical.map(t=>t.date.slice(0,7)));
  // Require three separate bank-history months and activity in the scored
  // month. An absent sync month is not evidence a bill never happened.
  if(covered.size<3||!actualRows.length){excludedWindows++;continue}
  const training=engine.model.migrate({accounts:state.accounts||[],
   transactions:(state.transactions||[]).filter(t=>valid(t.date)&&t.date<=cutoff&&!t.pending)});
  const trainingRows=engine.model.records(training);
  const horizon=diff(monthEnd(evaluated),cutoff);
  const ledger=engine.ledger.build(training,trainingRows,cutoff,horizon,
   engine.forecast,engine.model);
  const filtered=engine.planner.project(training,trainingRows,ledger.events,cutoff);
  const predicted=filtered.events.filter(belongs).filter(t=>t.date.slice(0,7)===evaluated);
  const scored=compare(predicted,actualRows,historical,resolve,engine.planner,evaluated);
  for(const field of Object.keys(totals))totals[field]+=scored[field];
  issues.push(...scored.issues);
  cardSettlements+=actualRows.filter(t=>t.type==='transfer'&&
   (settlement.test(String(t.merchant||''))||
    /LOAN_PAYMENTS_CREDIT_CARD_PAYMENT/i.test(String(t.source?.personalFinanceCategory?.detailed||'')))).length;
  windows.push({month:evaluated,predicted:scored.predicted,eligible:scored.eligible,
   matched:scored.matched,changed:scored.changed,missed:scored.missed,
   extra:scored.extra,duplicates:scored.duplicates});
 }
 const enough=windows.length>0&&(totals.eligible>0||totals.predicted>0);
 const rank={missed:0,'amount changed':1,duplicate:2,'unmatched forecast':3};
 issues.sort((a,b)=>(rank[a.kind]??4)-(rank[b.kind]??4)||
  (money(b.actual||b.expected)-money(a.actual||a.expected))||b.date.localeCompare(a.date));
 return {status:enough?'evaluated':'insufficient-history',accountId:target,
  periods:windows.map(w=>w.month),windows,excludedWindows,totals,
  matchRate:totals.predicted?Math.round(100*totals.matched/totals.predicted):null,
  coverageRate:totals.eligible?Math.round(100*totals.matched/totals.eligible):null,
  issues:issues.slice(0,12),issueCount:issues.length,cardSettlements,
  disclaimer:'Historical event accuracy only, not historical account balances. Automatic recurring detection uses only earlier posted transactions. Current confirmations and statement balances are not backdated. Card statement autopays are not scored without historical statements. A missing sync month is excluded; partial bank history may still affect results.'};
}
const api={build,compare,previouslyStable,accountResolver};
root.HouseholdPlannerBacktest=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
