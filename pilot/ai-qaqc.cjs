'use strict';
// Independently recalculate source-visible forecast legs and classify gaps.
// Read-only: no bank changes, forecast changes, provider calls or disk writes.
const {financialContext}=require('./ai-financial-report.cjs');
const {cleanDescription}=require('./ai-private-adapter.cjs');
const cents=n=>Math.round(Number(n)*100);
const money=n=>'$'+(n/100).toFixed(2);
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s);
function inspect(context){
 const projection=context.source.projection||{},accounts=projection.accounts||[],
  events=projection.events||[],history=context.source.history||[],
  byAccount=new Map(accounts.map(a=>[String(a.id),a])),
  alias=id=>context.privateIds.get(String(id))||'unknown-account';
 const issues=[],checks={accounts:0,daysRecomputed:0,daysUnverifiable:0,
  expectedEventLegs:events.length,historyRows:history.length,transferGroups:0,
  cardStatements:context.source.payments?.statements?.length||0};
 const flag=(severity,title,detail)=>{
  const id='qaqc-'+(issues.length+1);
  issues.push({id,severity,title,detail});
 };
 let unmatched=0,invalid=0;
 const eventKeys=new Map(),represented=new Map(),transfers=new Map();
 const eventKey=e=>JSON.stringify([String(e.accountId||''),e.date,e.id,e.kind,Number(e.amount)]);
 for(const e of events){
  if(!e||!validDate(e.date)||!finite(e.amount)||e.amount<=0||
     !byAccount.has(String(e.accountId))){invalid++;continue}
  const key=eventKey(e);
  eventKeys.set(key,(eventKeys.get(key)||0)+1);
  if(e.transferGroupId){
   const key=String(e.transferGroupId)+'|'+e.date,group=transfers.get(key)||[];
   group.push(e);transfers.set(key,group);
  }
 }
 if(invalid)flag('confirmed','Invalid scheduled event legs',
  invalid+' event legs have invalid amounts, dates or no connected account in the projection.');
 const duplicateLegs=[...eventKeys.values()].filter(n=>n>1).reduce((sum,n)=>sum+n-1,0);
 if(duplicateLegs)flag('investigate','Repeated scheduled event identities',
  duplicateLegs+' projected event legs share all of account, date, source identity, kind and amount. Confirm they represent separate obligations.');
 for(const [key,group] of transfers){
  checks.transferGroups++;
  if(group.length!==2||new Set(group.map(x=>String(x.accountId))).size!==2||
   !group.some(e=>e.kind==='transfer_in')||!group.some(e=>e.kind==='transfer_out')||
   cents(group[0].amount)!==cents(group[1].amount)){
   unmatched++;
   if(unmatched<=12)flag('confirmed','Unbalanced transfer legs',
    group.length+' legs for one linked movement on '+group[0].date+
    '; expected equal-and-opposite legs on two different accounts.');
  }
 }
 if(unmatched>12)flag('confirmed','Additional unbalanced movements',
  (unmatched-12)+' more transfer groups failed the independent pairing check.');
 let balanceErrors=0,summaryErrors=0,missingDays=0;
 for(const a of accounts){
  if(!a.valid)continue;
  checks.accounts++;
  const id=alias(a.id),credit=a.type==='credit',rows=a.series||[];
  let current=finite(a.openingCurrent)?cents(a.openingCurrent):null;
  let available=!credit&&finite(a.openingAvailable)?cents(a.openingAvailable):null;
  let lastDate=null;
  if(current===null){
   flag('investigate','Missing balance anchor for '+id,
    'The bank-reported opening current balance was not available for an independent roll-forward.');
   checks.daysUnverifiable+=rows.length;continue;
  }
  for(const p of rows){
   if(!validDate(p.date)||lastDate&&p.date<=lastDate)missingDays++;
   lastDate=p.date;
   if(!Array.isArray(p.events)){
    checks.daysUnverifiable++;continue;
   }
   checks.daysRecomputed++;
   for(const e of p.events){
    if(!finite(e.amount)||e.amount<0){balanceErrors++;continue}
    const sign=credit?(['card_purchase','transfer_out'].includes(e.kind)?1:-1):
     (['income','refund','transfer_in'].includes(e.kind)?1:-1);
    current+=sign*cents(e.amount);
    if(available!==null)available+=sign*cents(e.amount);
    const key=eventKey(e);
    represented.set(key,(represented.get(key)||0)+1);
   }
   const target=credit?current:(available??current);
   if(!finite(p.balance)||Math.abs(cents(p.balance)-target)>1||
    finite(p.currentBalance)&&Math.abs(cents(p.currentBalance)-current)>1){
    balanceErrors++;
    if(balanceErrors<=12)flag('confirmed','Daily balance does not reconcile',
     id+' on '+p.date+': independently rolled balance '+money(target)+
     ', Ledger shows '+(finite(p.balance)?money(cents(p.balance)):'unavailable')+
     '. Source-event signs and opening balance were recomputed.');
   }
   if(finite(p.income)&&finite(p.outflow)){
    let inc=0,out=0;
    for(const e of p.events){
     if(!finite(e.amount))continue;
     const sign=credit?(['card_purchase','transfer_out'].includes(e.kind)?1:-1):
      (['income','refund','transfer_in'].includes(e.kind)?1:-1);
     if(credit){if(sign<0)out+=cents(e.amount)}
     else if(sign>0)inc+=cents(e.amount);else out+=cents(e.amount);
    }
    if(Math.abs(cents(p.income)-inc)>1||Math.abs(cents(p.outflow)-out)>1){
     summaryErrors++;
     if(summaryErrors<=10)flag('confirmed','Daily inflow/outflow subtotal mismatch',
      id+' on '+p.date+': independent event totals '+money(inc)+' incoming and '+
      money(out)+' outgoing differ from Ledger daily subtotals.');
    }
   }
  }
  if(finite(projection.days)&&rows.length<projection.days+1)
   flag('investigate','Incomplete forecast horizon for '+id,
    rows.length+' account days available for '+(projection.days+1)+' expected calendar days.');
 }
 if(balanceErrors>12)flag('confirmed','Additional daily balance mismatches',
  (balanceErrors-12)+' more daily discrepancies occurred beyond the first twelve shown.');
 if(summaryErrors>10)flag('confirmed','Additional daily subtotal mismatches',
  (summaryErrors-10)+' more daily subtotals failed reconciliation.');
 if(missingDays)flag('investigate','Nonsequential forecast dates',
  missingDays+' daily points have an invalid or non-increasing date.');
 if(checks.daysUnverifiable)flag('investigate','Some daily calculations could not be independently checked',
  checks.daysUnverifiable+' days have no usable source events or balance anchor. Missing coverage is not a pass.');
 let unmatchedEvents=0;
 for(const [key,count] of eventKeys)
  if(represented.get(key)!==count)unmatchedEvents+=Math.abs(count-(represented.get(key)||0));
 if(unmatchedEvents)flag('confirmed','Projected event legs missing or multiplied in daily series',
  unmatchedEvents+' source event-leg occurrences do not match the account/day event lists.');
 const diag=projection.diagnostics||{};
 if((diag.balanceMismatches||[]).length)
  flag('confirmed','Ledger detected forecast calculation errors',
   diag.balanceMismatches.length+' internal balance mismatches are recorded in canonical diagnostics.');
 if(finite(projection.household?.conservationDifference)&&
    Math.abs(cents(projection.household.conservationDifference))>1)
  flag('confirmed','Household transfer conservation failed',
   'Ledger reports a nonzero household money-conservation difference of '+
   money(cents(projection.household.conservationDifference))+'.');
 let duplicateIds=0;
 const histIds=new Set();
 for(const h of history){
  const key=String(h.accountId||'')+'|'+String(h.id||'');
  if(h.id&&histIds.has(key))duplicateIds++;
  histIds.add(key);
 }
 if(duplicateIds)flag('investigate','Repeated posted transaction identities',
  duplicateIds+' normalized history rows repeat the same account and bank transaction identity.');
 const unassigned=history.filter(x=>!x.category||/^(unassigned|uncategorized)$/i.test(String(x.category))).length;
 if(unassigned)flag('investigate','Unclassified actual transactions',
  unassigned+' normalized recorded transactions have no resolved spending category. Determine whether excluded transfers or user decisions explain them.');
 for(const [name,values] of [
  ['overdue payment review',context.source.projection?.overduePayments||[]],
  ['duplicate payment review',context.source.projection?.duplicateChecks||[]]]){void name;void values}
 const checkMeta={...checks,issues:issues.length,confirmed:issues.filter(x=>x.severity==='confirmed').length,
  investigate:issues.filter(x=>x.severity==='investigate').length,
  basis:'Read-only checks of canonical normalized history, scheduled event legs and full available daily account series. Not a proof of underlying code correctness or missing external bank activity.'};
 return {checks:checkMeta,issues:issues.slice(0,80),
  limitations:['No access to the bank’s independent statement or unseen transactions.',
   'The audit compares source-normalized financial records and projected legs; it does not execute a separate deployment, inspect arbitrary source code, or prove all business rules correct.',
   'An unresolved warning is not a verified software defect.']};
}
function buildContext(prepared,options={}){
 // The QA check must remain operational precisely when Ledger diagnostics report
 // an internal arithmetic failure. Ordinary financial advice remains fail-closed.
 const context=financialContext(prepared,{...options,allowIntegrityFailures:true});
 const audit=inspect(context);
 // The QA investigator must be able to compare explicit saved decisions
 // against generated occurrences. These are opaque aliases and safe fields,
 // not the underlying raw preference objects or provider IDs.
 const decisions=options.adjustments?.predictions||{};
 const alias=id=>context.privateIds.get(String(id||''))||'unmatched-account';
 const safe=s=>cleanDescription(String(s??'')).slice(0,90);
 const dollars=n=>finite(n)?'
  text:item.title+'. '+item.detail}));
 facts.unshift({id:'qaqc-coverage',kind:'qaqc-coverage',
  text:'Independent QA scan: '+audit.checks.accounts+' accounts; '+
  audit.checks.daysRecomputed+' daily balances independently recomputed; '+
  audit.checks.daysUnverifiable+' days not verifiable; '+
  audit.checks.expectedEventLegs+' expected event legs; '+
  audit.checks.historyRows+' posted records; '+
  audit.checks.confirmed+' confirmed check failures; '+
  audit.checks.investigate+' questions require investigation.'});
 context.facts=[...facts,...decisionFacts,...context.facts];
 context.qaAudit=audit;
 return context;
}
module.exports={inspect,buildContext};
+Number(n).toFixed(2):'unknown amount';
 const decisionFacts=[];
 const addDecision=description=>{
  const id='qaqc-decision-'+(decisionFacts.length+1);
  decisionFacts.push({id,kind:'qaqc-saved-decision',text:description.slice(0,450)});
 };
 for(const rule of Array.isArray(decisions.futureRecurringRules)?decisions.futureRecurringRules:[]){
  if(!rule||typeof rule!=='object')continue;
  addDecision('User-saved recurrence: '+alias(rule.accountId||rule.fromAccountId)+
   ' '+safe(rule.merchant||rule.scheduleLabel)+
   '; type '+safe(rule.type)+'; category '+safe(rule.category)+
   '; amount '+dollars(rule.amount)+'; cadence '+safe(rule.frequency)+
   '; anchor '+safe(rule.anchorDate)+'. Compare planned occurrences with the projected event legs; exclusions or posted matches may justify an apparent absence.');
 }
 for(const rule of Array.isArray(decisions.futureTransactionAdds)?decisions.futureTransactionAdds:[]){
  if(!rule||typeof rule!=='object')continue;
  addDecision('User-saved one-off: '+alias(rule.accountId||rule.fromAccountId)+
   ' '+safe(rule.merchant)+'; type '+safe(rule.type)+'; date '+safe(rule.date)+
   '; amount '+dollars(rule.amount)+'. Weekend shifts or confirmed occurrences can change the projected date.');
 }
 for(const bill of Array.isArray(decisions.paymentBills)?decisions.paymentBills:[]){
  if(!bill||typeof bill!=='object')continue;
  addDecision('User-saved payment bill: '+alias(bill.fromAccountId)+
   ' '+safe(bill.name)+'; enabled '+(bill.enabled!==false)+
   '; due '+safe(bill.date)+'; cadence '+safe(bill.frequency)+
   '; amount '+dollars(bill.amount)+'.');
 }
 for(const [card,rule] of Object.entries(decisions.paymentRules||{})){
  if(!rule||typeof rule!=='object')continue;
  addDecision('User-saved card payment: card '+alias(card)+
   ', funding '+alias(rule.fromAccountId)+'; autopay '+!!rule.autopayEnabled+
   '; method '+safe(rule.method)+'; payment date '+safe(rule.nextPaymentDate)+
   '; last statement '+dollars(rule.lastStatementBalance)+'.');
 }
 audit.checks.savedDecisionsReviewed=decisionFacts.length;
 const facts=audit.issues.map(item=>({id:item.id,kind:'qaqc-'+item.severity,
  text:item.title+'. '+item.detail}));
 facts.unshift({id:'qaqc-coverage',kind:'qaqc-coverage',
  text:'Independent QA scan: '+audit.checks.accounts+' accounts; '+
  audit.checks.daysRecomputed+' daily balances independently recomputed; '+
  audit.checks.daysUnverifiable+' days not verifiable; '+
  audit.checks.expectedEventLegs+' expected event legs; '+
  audit.checks.historyRows+' posted records; '+
  audit.checks.confirmed+' confirmed check failures; '+
  audit.checks.investigate+' questions require investigation.'});
 context.facts=[...facts,...context.facts];
 context.qaAudit=audit;
 return context;
}
module.exports={inspect,buildContext};
