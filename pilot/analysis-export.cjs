'use strict';
// An explicitly requested, human-downloadable *analysis* dataset, not a
// portable recovery backup. Build from canonical normalized/forecast sources.
// Never export Plaid Items, access tokens, source IDs, auth/session state,
// encryption keys, credentials, or arbitrary stored preference objects.
const {financialContext}=require('./ai-financial-report.cjs');
const {createDataset}=require('./ai-open-data.cjs');
const {cleanDescription}=require('./ai-private-adapter.cjs');
const {auditAll:sourceReconciliationAudit}=require('./reconciliation-inspection.cjs');

const isDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x);
const num=x=>typeof x==='number'&&Number.isFinite(x);
const money=x=>Math.round(x*100)/100;
const safe=x=>cleanDescription(String(x??'')).slice(0,140);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const permitted=(v,allowed)=>allowed.includes(String(v))?String(v):null;

function build({prepared,adjustments={},lastSync=null,syncDiagnostics={},context=null}){
 // One canonical sanitized export for both an owner download and a consented
 // AI investigation; reuse the already verified financial snapshot when supplied.
 const ctx=context||financialContext(prepared,{lastSync,adjustments});
 const sync=object(syncDiagnostics),lastAttempt=object(sync.lastAttempt);
 const safeTimestamp=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x)?x:null;
 const bankSync={
  // The server refreshes derived forecasts hourly, but Plaid history only
  // refreshes on an authenticated manual Sync action; a stale timestamp
  // by itself is not proof of a provider error.
  automaticTransactionSync:false,
  lastAttemptAt:safeTimestamp(lastAttempt.at),
  lastAttemptOutcome:permitted(lastAttempt.outcome,['started','success','failed']),
  attemptStatusScope:'current-server-process-only',
  itemIssues:(Array.isArray(sync.issues)?sync.issues:[]).slice(0,30).map(issue=>({
   code:/^[A-Z_]{3,60}$/.test(String(issue?.code||''))?String(issue.code):'UNSPECIFIED',
   observedAt:safeTimestamp(issue?.observedAt)
  }))
 };
 const ds=createDataset(ctx);
 const section=name=>{
  const n=ds.manifest[name],result=[];
  for(let offset=0;offset<n;offset+=200){
   const page=ds.page(name,offset,200);
   if(page.error||!Array.isArray(page.rows))throw Error('Financial dataset pagination failed');
   result.push(...page.rows);
  }
  if(result.length!==n)throw Error('Incomplete financial dataset export');
  return result;
 };
 const data=Object.fromEntries(Object.keys(ds.manifest).map(k=>[k,section(k)]));
 const alias=id=>ctx.privateIds.get(String(id||''))||null;
 const projection=ctx.source.projection,decisions=object(object(adjustments).predictions);
 const history=[...ctx.source.history].filter(r=>r&&isDate(r.date)&&num(r.amount))
  .sort((a,b)=>b.date.localeCompare(a.date));
 const txAlias=new Map(history.map((r,i)=>[String(r.id),'dataset-history-'+(i+1)]));
 const actual=data.history.map((r,i)=>{
  const src=history[i]||{};
  return {...r,
   ...(safe(src.description||src.name)&&
     safe(src.description||src.name)!==r.merchant?{
      bankDescription:safe(src.description||src.name)}:{}),
   ...(permitted(src.cashDirection,['in','out'])?{cashDirection:src.cashDirection}:{}),
   ...(typeof src.method==='string'?{categoryMethod:safe(src.method)}:{})
  };
 });
 const accounts=ctx.accounts.map(a=>{
  const raw=(projection.accounts||[]).find(x=>alias(x.id)===a.id)||{};
  const source=raw.source||{};
  return {...a,currency:permitted(source.currency||raw.currency,['USD','CAD','EUR','GBP'])||'USD',
   subtype:permitted(source.subtype||source.accountType,
    ['checking','savings','credit','money market','cash','depository'])||null};
 });
 const aid=x=>alias(x);
 const value=x=>num(x)?money(x):null;
 const fieldDate=x=>isDate(x)?x:null;
 const rules=(Array.isArray(decisions.futureRecurringRules)?decisions.futureRecurringRules:[])
  .filter(x=>x&&typeof x==='object').map((r,i)=>({
   id:'saved-rule-'+(i+1),
   kind:permitted(r.kind,['event','movement']),type:permitted(r.type,['income','expense','transfer']),
   accountId:aid(r.accountId),fromAccountId:aid(r.fromAccountId),toAccountId:aid(r.toAccountId),
   merchant:safe(r.merchant),originalMerchant:safe(r.originalMerchant),
   scheduleLabel:safe(r.scheduleLabel),
   category:safe(r.category),amount:value(r.amount),amountBasis:safe(r.amountBasis),
   // Frequency is a trusted schedule enum, not freeform bank text. Preserve
   // significant cadence digits (e.g., every-4-weeks) for annualizing income.
   frequency:permitted(r.frequency,['weekly','biweekly','every-2-weeks',
    'every-4-weeks','every-3-weeks','monthly','twice-monthly',
    'semi-monthly','quarterly','annual','annually','once'])||safe(r.frequency),
   anchorDate:fieldDate(r.anchorDate),
   reconciliationAnchorDate:fieldDate(r.reconciliationAnchorDate),
   sourceAnchorDate:fieldDate(r.sourceAnchorDate),secondDay:num(r.secondDay)?r.secondDay:null,
   cashDirection:permitted(r.cashDirection,['in','out']),
   matchingNames:Array.isArray(r.matchNames)?r.matchNames.slice(0,30).map(safe):[],
   historicalExamples:Array.isArray(r.exampleIds)?r.exampleIds.filter(id=>txAlias.has(String(id)))
    .map(id=>txAlias.get(String(id))):[]
  }));
 const oneOffs=(Array.isArray(decisions.futureTransactionAdds)?decisions.futureTransactionAdds:[])
  .filter(x=>x&&typeof x==='object').map((r,i)=>({
   id:'saved-oneoff-'+(i+1),date:fieldDate(r.date),
   kind:permitted(r.kind,['event','movement']),type:permitted(r.type,['income','expense','transfer']),
   cashDirection:permitted(r.cashDirection,['in','out']),
   accountId:aid(r.accountId),fromAccountId:aid(r.fromAccountId),toAccountId:aid(r.toAccountId),
   merchant:safe(r.merchant),category:safe(r.category),amount:value(r.amount)
  }));
 const cardPaymentRules=Object.entries(object(decisions.paymentRules)).map(([cardId,r])=>{
  const p=object(r);
  return {
   cardId:aid(cardId),fromAccountId:aid(p.fromAccountId),
   autopayEnabled:p.autopayEnabled===true,
   method:permitted(p.method,['statement','full','minimum','fixed']),
   billingStartDate:fieldDate(p.billingStartDate),
   billingEndDate:fieldDate(p.billingEndDate),
   lastStatementClose:fieldDate(p.lastStatementClose),
   nextPaymentDate:fieldDate(p.nextPaymentDate),
   nextDueDate:fieldDate(p.nextDueDate),
   closingDay:Number.isInteger(p.closingDay)?p.closingDay:null,
   lastStatementBalance:value(p.lastStatementBalance),
   minimumAmount:value(p.minimumAmount),fixedAmount:value(p.fixedAmount)
  };
 });
 const paymentBills=(Array.isArray(decisions.paymentBills)?decisions.paymentBills:[])
  .filter(x=>x&&typeof x==='object').map((r,i)=>({
   id:'saved-bill-'+(i+1),fromAccountId:aid(r.fromAccountId),
   name:safe(r.name),category:safe(r.category),date:fieldDate(r.date),
   amount:value(r.amount),frequency:permitted(r.frequency,['once','monthly']),
   enabled:r.enabled!==false
  }));
 const budget=Object.entries(object(decisions.categoryMonthlyBudgets))
  .filter(([,v])=>num(v)&&v>=0)
  .map(([category,amount])=>({category:safe(category),monthlyTarget:money(amount)}));
 const overrides=Object.entries(object(adjustments.categoryOverrides))
  .filter(([raw])=>txAlias.has(raw))
  .map(([raw,category])=>({transactionId:txAlias.get(raw),category:safe(category)}));
 const notes=Object.entries(object(decisions.transactionNotes)).flatMap(([key,note])=>{
  if(typeof note!=='string'||!note.trim())return [];
  let id=null;
  if(txAlias.has(key))id=txAlias.get(key);
  else if(key.startsWith('bank:')){
   try{const pair=JSON.parse(key.slice(5));if(Array.isArray(pair))id=txAlias.get(String(pair[1]));}catch{}
  }
  return id?[{transactionId:id,note:safe(note)}]:[];
 });
 const categoryRules=Object.values(object(object(adjustments.learning).categoryRules))
  .filter(r=>r&&typeof r==='object').map(r=>({
   merchant:safe(r.merchant),category:safe(r.category),
   mode:permitted(r.mode,['auto','suggest']),accountId:aid(r.accountId)
  }));
 const exclusions=Object.values(object(decisions.futureRecurrenceExclusions))
  .filter(r=>r&&typeof r==='object').map(r=>({
   accountId:aid(r.accountId),type:permitted(r.type,['income','expense','transfer']),
   merchant:safe(r.merchant)
  }));
 // Select explicit, inspectable fields rather than JSON-serializing internal
 // reconciliation objects, which may carry source IDs or hidden metadata.
 const issue=row=>({
  date:fieldDate(row?.date),dueDate:fieldDate(row?.dueDate),
  expectedDate:fieldDate(row?.expectedDate),
  accountId:aid(row?.accountId||row?.fromAccountId),
  merchant:safe(row?.merchant),amount:value(row?.amount??row?.actualAmount),
  cardId:aid(row?.cardId),forecastAmount:value(row?.forecastAmount),
  difference:value(row?.difference),
  status:safe(row?.status),reason:safe(row?.reason),kind:safe(row?.kind)
 });
 // An observed one-off category difference is not permission to overwrite
 // an owner's deliberate category. Expose the exact export-local transaction
 // for Review; exclude mixed-use retailers whose categories are naturally varied.
 const mixedUse=/^(?:amazon|walmart|costco|target|safeway|fred meyer|lowe'?s|the home depot)$/i;
 const categoryGroups=new Map();
 for(const row of actual.filter(r=>r.type==='expense'&&!r.pending&&r.category&&
  !['Other','Uncategorized'].includes(r.category)&&!mixedUse.test(r.merchant))){
  const key=row.merchant.toLowerCase().trim();
  if(!categoryGroups.has(key))categoryGroups.set(key,[]);
  categoryGroups.get(key).push(row);
 }
 const categoryConsistency=[];
 for(const rows of categoryGroups.values()){
  if(rows.length<3)continue;
  const totals=new Map();
  for(const row of rows)totals.set(row.category,(totals.get(row.category)||0)+1);
  const ordered=[...totals].sort((a,b)=>b[1]-a[1]);
  const [dominant,count]=ordered[0];
  if(count<3||count/rows.length<.7)continue;
  for(const row of rows)if(row.category!==dominant)
   categoryConsistency.push({transactionId:row.id,accountId:row.accountId,
    date:row.date,merchant:row.merchant,category:row.category,
    suggestedCategory:dominant,reason:'Different from consistent same-merchant history; owner review required'});
 }
 // Export-only review hints: a fuel brand is not proof a particular
 // convenience-store purchase was fuel. Never override user categories.
 const possibleFuelCategories=actual.filter(r=>!r.pending&&r.type==='expense'&&
  r.category==='Groceries'&&
  /^(?:chevron|shell|texaco|exxon|mobil|arco|cenex|bp|76)(?:\b|\s)/i.test(r.merchant))
  .map(r=>({transactionId:r.id,accountId:r.accountId,date:r.date,
   merchant:r.merchant,category:r.category,suggestedCategory:'Gas',
   reason:'Fuel retailer may have charged for gas or convenience-store items; verify before changing a category'}));
 // Compare groups of independent same-payee fixed monthly schedules against
 // COMPLETE historical posting months, never replacing owner-entered amounts.
 const recurringAmountReview=[];
 const monthGroups=new Map();
 for(const rule of rules.filter(r=>r.kind==='event'&&r.type==='expense'&&
  r.frequency==='monthly'&&r.amount>0&&r.accountId&&r.merchant)){
  const key=rule.accountId+'|'+rule.merchant.toLowerCase().trim();
  if(!monthGroups.has(key))monthGroups.set(key,[]);
  monthGroups.get(key).push(rule);
 }
 for(const group of monthGroups.values()){
  if(group.length<2)continue;
  const exemplar=group[0],monthAmounts=new Map();
  for(const row of actual){
   if(row.accountId!==exemplar.accountId||row.type!=='expense'||row.pending||
    row.merchant.toLowerCase().trim()!==exemplar.merchant.toLowerCase().trim()||
    row.date.slice(0,7)>=ctx.asOf.slice(0,7))continue;
   const month=row.date.slice(0,7);
   monthAmounts.set(month,money((monthAmounts.get(month)||0)+Number(row.amount||0)));
  }
  // At least three observed prior calendar months avoid first-month/noise bias.
  const observed=[...monthAmounts.values()];
  if(observed.length<3)continue;
  const pastAverage=money(observed.reduce((s,v)=>s+v,0)/observed.length);
  const expectedAmount=money(group.reduce((s,r)=>s+Number(r.amount),0));
  if(pastAverage>0&&expectedAmount>pastAverage*1.4&&
   expectedAmount-pastAverage>=50)
   recurringAmountReview.push({accountId:exemplar.accountId,
    merchant:exemplar.merchant,ruleCount:group.length,months:observed.length,
    forecastMonthlyAmount:expectedAmount,historicalMonthlyAverage:pastAverage,
    reason:'Saved monthly forecasts exceed multi-month posted history; distinct schedules may be intentional and require owner review'});
 }
 const cardTypes=new Set(accounts.filter(a=>a.type==='credit').map(a=>a.id));
 const cardOutflowClassification=actual.filter(r=>cardTypes.has(r.accountId)&&
  r.cashDirection==='out'&&r.type==='transfer'&&
  ['Subscriptions','Insurance','Groceries','Dining','Gas','Healthcare'].includes(r.category))
  .map(r=>({transactionId:r.id,accountId:r.accountId,date:r.date,
   merchant:r.merchant,category:r.category,reason:
    'Outgoing card merchant charge is marked transfer; verify external purchase versus card correction'}));
 const bundle=prepared.bundle;
 const reviews={
  overduePayments:(bundle.overduePayments||[]).map(issue),
  duplicateChecks:(bundle.duplicateChecks||[]).map(issue),
  postedMatchReview:(bundle.postedMatchReview||[]).map(issue),
  paymentReconciliations:(bundle.paymentReconciliations||[]).map(issue),
  paymentWarnings:(bundle.payments?.warnings||[]).map(safe),
  categoryConsistency,
  possibleFuelCategories,recurringAmountReview,
  cardOutflowClassification
 };
 const coverage=ctx.scope;
 return {
  format:'ledger-manual-analysis-export',version:1,
  exportedAt:new Date().toISOString(),asOf:ctx.asOf,lastSuccessfulBankSync:lastSync,
  bankSync,
  currency:'USD',
  purpose:'Owner-initiated analysis in an external chat. No model or external API was called to create this file.',
  sensitivity:'CONFIDENTIAL: Contains private balances, spending, income, merchant names and financial decisions in plain JSON. Share only deliberately; do not post publicly.',
  method:{
   actualTransactions:'Canonical normalized Ledger history with resolved categories; refunds, transfers and card payments must not be added to spending again.',
   expectedTransactions:'Canonical future event legs; weekend-prediction dates are already adjusted by Ledger. Forecasted income is not guaranteed.',
   projectedDailyBalances:'Ledger derived balances for scheduled events; ordinary variable spending is not independently forecast.',
   sourceIndices:'Full-history grouping with gross absolute totals; not necessarily net expenses or transfer-reconciled spending.',
   accountIds:'Opaque account-1, account-2 aliases; raw bank IDs and account numbers are deliberately excluded.',
   exclusions:'Plaid tokens, bank account numbers, logins, credentials, sessions, raw transaction IDs, unrecognized private settings and file encryption keys are excluded.'
  },
  counts:{...ds.manifest,recurringSchedules:rules.length,oneOffPayments:oneOffs.length,
   cardPaymentRules:cardPaymentRules.length,paymentBills:paymentBills.length},
  coverage,accounts,primaryAccount:ctx.primary?.id||null,
  actualTransactions:actual,
  expectedTransactions:data.future,
  projectedDailyBalances:data.balances,
  cardStatements:data.cards,
  sourceIndices:data.indices,
  sourceEvidence:data.evidence,
  savedDecisions:{
   recurringSchedules:rules,oneOffPayments:oneOffs,cardPaymentRules,paymentBills,
   monthlyBudgetTargets:budget,
   categoryOverrides:overrides,transactionNotes:notes,
   learnedCategoryRules:categoryRules,notRecurringChoices:exclusions,
   alertThreshold:value(decisions.lowAlertThreshold??decisions.warnBelow),
   deletedCategories:(Array.isArray(decisions.deletedCategories)?decisions.deletedCategories:[]).map(safe)
  },
  reconciliationAndReview:{...reviews,sourceReconciliationAudit:sourceReconciliationAudit(prepared)}
 };
}
module.exports={build};
