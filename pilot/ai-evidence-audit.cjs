'use strict';
// Read-only independent financial evidence checks using the SAME redacted
// manual-export payload. No provider credentials, arbitrary SQL/JS or writes.
const {cleanDescription}=require('./ai-private-adapter.cjs');
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
 !Number.isNaN(Date.parse(v+'T12:00:00Z'))&&
 new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const dollar=n=>'$'+Math.abs(round(n)).toFixed(2);
const cleaned=v=>cleanDescription(String(v||'')).slice(0,90);
const AUDIT_TOOL={type:'function',function:{
 name:'audit_financial_evidence',
 description:'Independently investigate full manual-export financial evidence: historical expense net of identified refunds; saved recurring obligations against actual posting history; card settlement/statement differences; all-source reconciliation; or category-review anomalies. Never edit records. Returns source-verified facts with IDs, and optional calculated chart. Review hints are not confirmed defects.',
 parameters:{type:'object',additionalProperties:false,
 required:['focus','startDate','endDate','merchant','accountId'],
 properties:{
  focus:{type:'string',enum:['net-spending','recurring-obligations',
   'card-reconciliation','source-reconciliation','category-quality']},
  startDate:{type:['string','null']},endDate:{type:['string','null']},
  merchant:{type:'string'},accountId:{type:['string','null']}
 }}}};
function auditFinancialEvidence(context,r,index){
 const doc=context?.reportEvidence;
 if(doc?.format!=='ledger-manual-analysis-export')return {error:'Complete analysis export evidence unavailable'};
 if(!r||!AUDIT_TOOL.function.parameters.properties.focus.enum.includes(r.focus)||
  (r.startDate!==null&&!validDate(r.startDate))||
  (r.endDate!==null&&!validDate(r.endDate))||
  r.startDate&&r.endDate&&r.startDate>r.endDate||
  typeof r.merchant!=='string'||r.merchant.length>90||
  (r.accountId!==null&&!doc.accounts?.some(a=>a.id===r.accountId)))
  return {error:'Invalid read-only audit request'};
 const history=(doc.actualTransactions||[]).filter(x=>validDate(x.date)&&finite(x.amount));
 const end=r.endDate||doc.asOf;
 const fallbackStart=new Date(Date.parse(end+'T12:00:00Z')-120*86400000).toISOString().slice(0,10);
 const start=r.startDate||fallbackStart;
 const matchText=v=>!r.merchant||String(v||'').toLowerCase().includes(r.merchant.toLowerCase());
 const included=row=>(!r.accountId||row.accountId===r.accountId)&&
  matchText(row.merchant||row.name)&&row.date>=start&&row.date<=end;
 const facts=[];
 const fact=(kind,text)=>{if(facts.length>=95)return;
  facts.push({id:'audit-'+index+'-'+(facts.length+1),kind,text:String(text).slice(0,1300)});
 };
 let chart=null;
 if(r.focus==='net-spending'){
  const months=new Map(),selected=history.filter(x=>included(x)&&!x.pending);
  const blank=()=>({expense:0,refund:0,income:0,expenseCount:0,refundCount:0,
   incomeCount:0,transfers:0,unclassifiedCredits:0});
  const all=blank();
  for(const x of selected){
   const m=x.date.slice(0,7),v=months.get(m)||blank(),n=Math.abs(x.amount);
   const kind=String(x.accountingKind||'').toLowerCase();
   const typ=String(x.type||'').toLowerCase();
   if(typ==='expense'&&!['card_payment','internal_transfer'].includes(kind)){
    v.expense+=n;v.expenseCount++;
   }else if(typ==='refund'||kind==='refund'){
    v.refund+=n;v.refundCount++;
   }else if(typ==='income'){
    v.income+=n;v.incomeCount++;
   }else if(typ==='transfer'||['card_payment','internal_transfer'].includes(kind)){
    v.transfers++;
   }else if(kind.startsWith('unclassified')||typ==='unclassified'){
    v.unclassifiedCredits++;
   }
   months.set(m,v);
  }
  for(const m of months.values())for(const k of Object.keys(all))all[k]+=m[k];
  fact('net-spending','Posted actual activity '+start+' through '+end+
   '; purchase expenses '+dollar(all.expense)+' across '+all.expenseCount+
   ' purchases, independently identified refunds '+dollar(all.refund)+
   ' across '+all.refundCount+' refunds, purchase expenses less identified refunds '+
   dollar(all.expense-all.refund)+'; recorded income '+dollar(all.income)+
   ' across '+all.incomeCount+' deposits; '+all.transfers+
   ' transfer/payment legs excluded; '+all.unclassifiedCredits+
   ' unclassified credits excluded from refunds. This is recorded purchasing, NOT future projected expenses.');
  const sorted=[...months].sort(([a],[b])=>a.localeCompare(b));
  for(const [month,m] of sorted)
   fact('monthly-net-spending','Posted month '+month+': purchase expenses '+dollar(m.expense)+
    ', identified refunds '+dollar(m.refund)+', net identified expenses '+
    dollar(m.expense-m.refund)+', income '+dollar(m.income)+
    '; purchases '+m.expenseCount+', refunds '+m.refundCount+
    ', transfers/payment legs excluded '+m.transfers+
    '. Months intersecting the range may be partial.');
  if(sorted.length>=2)chart={id:'analysis-audit-net-'+index,
   type:'bar',unit:'USD',title:'Recorded purchases less identified refunds',
   subtitle:'Observed transactions only; partial months possible; transfers excluded',
   points:sorted.map(([month,m])=>({label:month,value:round(m.expense-m.refund)}))};
 }else if(r.focus==='recurring-obligations'){
  const rules=(doc.savedDecisions?.recurringSchedules||[])
   .filter(x=>x.type==='expense'&&finite(x.amount)&&
    (!r.accountId||x.accountId===r.accountId)&&matchText(x.merchant));
  const monthlyByRule=new Map();
  for(const rule of rules.slice(0,65)){
   const months=new Map();
   for(const tx of history){
    if(tx.pending||tx.type!=='expense'||tx.accountId!==rule.accountId||
     !tx.date||tx.date<start||tx.date>end)continue;
    if(cleaned(tx.merchant).toLowerCase()!==cleaned(rule.merchant).toLowerCase())continue;
    const key=tx.date.slice(0,7);
    months.set(key,(months.get(key)||0)+Math.abs(tx.amount));
   }
   const observed=[...months].sort(([a],[b])=>a.localeCompare(b));
   monthlyByRule.set(rule.id,observed);
   fact('recurring-vs-history','Owner saved expense schedule '+cleaned(rule.merchant)+
    ' on '+rule.accountId+'; saved occurrence '+dollar(rule.amount)+
    ', frequency '+cleaned(rule.frequency)+
    (validDate(rule.anchorDate)?', anchor '+rule.anchorDate:'')+
    '; posted same-exact-merchant expense history '+start+' through '+end+
    ': '+(observed.length?observed.map(([m,v])=>m+' '+dollar(v)).join('; '):
     'none matching exactly')+
    '. Matching is limited to visible account and exact normalized merchant, not proof of missing or duplicated payments.');
  }
  fact('recurring-coverage','Matched '+rules.length+
   ' separately saved recurring expense schedules for the requested account/merchant filter. Similar payee schedules may be intentional; forecasted occurrences remain unchanged.');
 }else if(r.focus==='card-reconciliation'){
  const warnings=doc.reconciliationAndReview||{},audit=warnings.sourceReconciliationAudit||{};
  fact('card-source-audit','All-history source reconciliation: verified card payment pairs '+
   (audit.matchedCardPaymentPairs||0)+', unmatched card payment legs '+
   (audit.unmatchedCardPaymentLegs||0)+', unclassified card credits '+
   (audit.unclassifiedCardCredits||0)+', broken reciprocal links '+
   (audit.missingOrBrokenPairLinks||0)+'. Unclassified credits are not automatically refunds.');
  for(const row of (doc.cardStatements||[]).filter(x=>
   (!r.accountId||x.card===r.accountId||x.funding===r.accountId)&&
   (!r.startDate||!x.dueDate||x.dueDate>=r.startDate)&&
   (!r.endDate||!x.dueDate||x.dueDate<=r.endDate)).slice(0,35))
   fact('card-statement','Card '+row.card+' funded from '+row.funding+
    '; statement due '+(row.dueDate||'unknown')+
    (finite(row.amount)?', expected payment '+dollar(row.amount):'')+
    (finite(row.actualPaymentAmount)?', observed payment '+dollar(row.actualPaymentAmount):'')+
    (validDate(row.actualPaymentDate)?' on '+row.actualPaymentDate:'')+
    (finite(row.statementReconciliation?.difference)?
     ', stated reconciliation difference '+dollar(row.statementReconciliation.difference):'')+
    '; already paid '+Boolean(row.alreadyPaid)+', estimate '+Boolean(row.estimated));
  for(const row of (warnings.paymentReconciliations||[]).filter(x=>
   (!r.accountId||x.accountId===r.accountId||x.cardId===r.accountId)&&
   matchText(x.merchant)).slice(0,35))
   fact('card-payment-reconciliation','Payment reconciliation '+cleaned(row.merchant)+
    ' '+(row.date||row.expectedDate||'unknown date')+
    '; status '+cleaned(row.status)+
    (finite(row.amount)?', posted '+dollar(row.amount):'')+
    (finite(row.forecastAmount)?', expected '+dollar(row.forecastAmount):'')+
    (finite(row.difference)?', recorded difference '+dollar(row.difference):'')+
    '. This derived match does not independently prove a bank transfer.');
 }else if(r.focus==='source-reconciliation'){
  const audit=doc.reconciliationAndReview?.sourceReconciliationAudit||{};
  const fields=Object.entries(audit).filter(([k,v])=>typeof v==='number'&&Number.isFinite(v));
  fact('source-reconciliation','All posted source records: '+fields.map(([k,v])=>
   cleaned(k)+' '+v).join('; ')+'. Counted from original canonical normalized postings, not from the AI. Possible missed pairs are review hints, not confirmed matches.');
  const review=doc.reconciliationAndReview||{};
  for(const kind of ['overduePayments','duplicateChecks','postedMatchReview']){
   const list=Array.isArray(review[kind])?review[kind]:[];
   fact('review-coverage',kind+' has '+list.length+
    ' derived review records; presence is not proof of an accounting error.');
   for(const row of list.filter(x=>matchText(x.merchant)).slice(0,12))
    fact('review-evidence',kind+' '+cleaned(row.merchant)+
     (validDate(row.date)?' '+row.date:'')+
     (finite(row.amount)?' '+dollar(row.amount):'')+
     '; reason '+cleaned(row.reason)+', status '+cleaned(row.status));
  }
 }else if(r.focus==='category-quality'){
  const reviews=doc.reconciliationAndReview||{};
  for(const kind of ['categoryConsistency','possibleFuelCategories','recurringAmountReview','cardOutflowClassification']){
   const entries=(reviews[kind]||[]).filter(x=>
    (!r.accountId||x.accountId===r.accountId)&&
    matchText(x.merchant)&&(!r.startDate||!x.date||x.date>=r.startDate)&&
    (!r.endDate||!x.date||x.date<=r.endDate));
   fact('classification-review',kind+' contains '+entries.length+
    ' source-derived review candidates; none were automatically changed.');
   for(const row of entries.slice(0,22))
    fact('classification-evidence','Candidate '+kind+': '+
     (validDate(row.date)?row.date+' ':'')+cleaned(row.merchant)+
     (row.accountId?' '+row.accountId:'')+
     (row.category?' currently '+cleaned(row.category):'')+
     (row.suggestedCategory?' suggested '+cleaned(row.suggestedCategory):'')+
     (finite(row.forecastMonthlyAmount)?
      ' saved monthly '+dollar(row.forecastMonthlyAmount):'')+
     (finite(row.historicalMonthlyAverage)?
      ' observed historical monthly average '+dollar(row.historicalMonthlyAverage):'')+
     '; '+cleaned(row.reason)+'. Verify before correction; merchants may sell mixed products.');
  }
 }
 return {facts,chart,summary:{focus:r.focus,source:'complete owner-export evidence',
  recordsConsidered:history.length,returnedFacts:facts.length,
  dateWindow:{start,end},readOnly:true}};
}
module.exports={AUDIT_TOOL,auditFinancialEvidence};
