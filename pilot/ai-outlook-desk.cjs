'use strict';
// Read-only household research desk, NOT an automated findings/QA checklist.
// Starts with the complete sanitized owner export. Verifiable figures and
// source-backed charts enable a model to develop its own financial outlook.
// No records, rules, balances, or future forecasts are ever modified.
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T12:00:00Z'))&&
 new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const cents=x=>Math.round(Number(x||0)*100);
const dollar=x=>'$'+(Math.abs(cents(x))/100).toFixed(2);
const money=x=>cents(x)/100;
const monthBefore=ym=>{const d=new Date(ym+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7)};
const monthNext=ym=>{const d=new Date(ym+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,7)};
const isoAdd=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const safe=s=>String(s||'').slice(0,105);
const M=Object.freeze({weekly:52,'every-2-weeks':26,biweekly:26,
 'every-3-weeks':52/3,'every-4-weeks':13,
 monthly:12,'twice-monthly':24,'semi-monthly':24,quarterly:4,annual:1,annually:1});
const mean=(array,key)=>array.length?money(array.reduce((s,r)=>s+Number(r[key]||0),0)/array.length):0;
function buildOutlookDesk(context){
 const doc=context?.reportEvidence;
 if(!doc||doc.format!=='ledger-manual-analysis-export')return null;
 const rows=(doc.actualTransactions||[]).filter(t=>t&&validDate(t.date)&&finite(t.amount));
 const asOf=validDate(doc.asOf)?doc.asOf:context.asOf,asMonth=asOf.slice(0,7);
 const coverageStart=validDate(doc.coverage?.pastDataStart)?doc.coverage.pastDataStart:
  rows.map(x=>x.date).sort()[0]||asOf;
 const byMonth=new Map();
 const group=(map,label,amount)=>{if(!label)return;map.set(safe(label),cents(amount)+ (map.get(safe(label))||0))};
 const init=month=>({month,purchases:0,refunds:0,purchaseCount:0,refundCount:0,
  payroll:0,otherIncome:0,transferOut:0,obligationTransfers:0,
  otherTransferOut:0,transferCount:0,cardPurchases:0,
  fees:0,categories:new Map(),merchants:new Map(),retailOther:new Map(),
  high100:0,high100Count:0,subMerchants:new Map(),transfers:new Map()});
 for(const tx of rows){
  if(tx.pending)continue;
  const key=tx.date.slice(0,7),v=byMonth.get(key)||init(key);
  const amount=Math.abs(cents(tx.amount)),type=String(tx.type||'').toLowerCase(),
   kind=String(tx.accountingKind||'').toLowerCase(),
   isCard=doc.accounts?.some(a=>a.id===tx.accountId&&a.type==='credit');
  const label=safe(tx.merchant),category=safe(tx.category||'Unassigned');
  if(type==='refund'||kind==='refund'){v.refunds+=amount;v.refundCount++;}
  else if(type==='expense'&&!['card_payment','internal_transfer'].includes(kind)){
   v.purchases+=amount;v.purchaseCount++;
   if(isCard)v.cardPurchases+=amount;
   if(amount>=10000){v.high100+=amount;v.high100Count++}
   group(v.categories,category,Number(tx.amount));
   group(v.merchants,label,Number(tx.amount));
   if(category.toLowerCase()==='other')group(v.retailOther,label,Number(tx.amount));
   if(category.toLowerCase().startsWith('subscription'))group(v.subMerchants,label,Number(tx.amount));
   if(/\b(?:service fee|monthly fee|maintenance fee|bank fee)\b/i.test(label+' '+(tx.description||'')))
    v.fees+=amount;
  }else if(type==='income'){
   // Income split is descriptive; saved paycheck rules establish annual cadence.
   const memo=(label+' '+safe(tx.description)).toLowerCase();
   if(/payroll|salary|paycheck|direct deposit|employer/.test(memo))v.payroll+=amount;
   else v.otherIncome+=amount;
  }else if(type==='transfer'&&tx.cashDirection==='out'&&
   !['card_payment'].includes(kind)){
   v.transferOut+=amount;v.transferCount++;
   // Only owner-categorized mortgage/utility-like transfers are part of a
   // conservative household outflow proxy. Other transfer destinations may
   // be savings, family movements or unsettled reimbursements.
   if(['mortgage','utility','utilities'].includes(category.toLowerCase()))
    v.obligationTransfers+=amount;
   else v.otherTransferOut+=amount;
   group(v.transfers,category,Number(tx.amount));
  }
  byMonth.set(key,v);
 }
 // Exclude months with incomplete source coverage and the ongoing partial month.
 const months=[...byMonth.keys()].filter(m=>m<asMonth&&
  m+'-01'>=coverageStart).sort().slice(-6);
 const complete=months.map(m=>byMonth.get(m));
 const last3=complete.slice(-3);
 const windows=last3.length?last3:complete;
 const averaged={months:windows.map(m=>m.month),purchaseAverage:mean(windows,'purchases')/100,
  refundAverage:mean(windows,'refunds')/100,
  netPurchaseAverage:mean(windows,'purchases')/100-mean(windows,'refunds')/100,
  creditPurchasesAverage:mean(windows,'cardPurchases')/100,
  transferOutAverage:mean(windows,'transferOut')/100,
  obligationTransferAverage:mean(windows,'obligationTransfers')/100,
  otherTransferAverage:mean(windows,'otherTransferOut')/100,
  payrollObservedAverage:mean(windows,'payroll')/100,
  otherIncomeAverage:mean(windows,'otherIncome')/100,
  largePurchaseCount:windows.reduce((s,x)=>s+x.high100Count,0),
  largePurchaseTotal:windows.reduce((s,x)=>s+x.high100,0)/100};
 // Deliberately distinct series: the checking transfer may be a mortgage,
 // but this export does not prove the unconnected recipient or final purpose.
 const schedules=(doc.savedDecisions?.recurringSchedules||[]).filter(x=>
  x.type==='income'&&finite(x.amount)&&x.amount>0);
 const recognized=schedules.filter(x=>M[String(x.frequency)]>0);
 const unresolved=schedules.filter(x=>!M[String(x.frequency)]);
 const normalizedPayroll=recognized.length===schedules.length&&schedules.length?
  money(recognized.reduce((a,x)=>a+x.amount*M[x.frequency],0)/12):null;
 const projected=(doc.projectedDailyBalances||[]).filter(x=>x.accountId===doc.primaryAccount&&
  validDate(x.date)&&finite(x.balance)).sort((a,b)=>a.date.localeCompare(b.date));
 const baseAccount=(doc.accounts||[]).find(x=>x.id===doc.primaryAccount)||null;
 const next90=projected.filter(p=>p.date>=asOf&&p.date<=isoAdd(asOf,90));
 const trough=next90.reduce((min,p)=>!min||p.balance<min.balance?p:min,null);
 const future=(doc.expectedTransactions||[]).filter(x=>x&&validDate(x.date)&&
  finite(x.amount)).sort((a,b)=>a.date.localeCompare(b.date));
 const nextDated=future.filter(x=>x.accountId===doc.primaryAccount&&
  x.date>=asOf&&x.date<=isoAdd(asOf,45))
  .sort((a,b)=>b.amount-a.amount).slice(0,16);
 const totals=(dimension)=>{const map=new Map();for(const month of windows)
  for(const [label,value] of month[dimension]||[])map.set(label,(map.get(label)||0)+value);
  return [...map].sort((a,b)=>b[1]-a[1]).slice(0,22).map(([label,value])=>({label,
   total:money(value/100),monthlyAverage:windows.length?money(value/100/windows.length):0}));
 };
 const categories=totals('categories'),merchants=totals('merchants'),
  other=totals('retailOther'),subscriptions=totals('subMerchants');
 const budgets=doc.savedDecisions?.monthlyBudgetTargets||[];
 const facts=[],charts=[];
 const add=(title,statement,extra={})=>{
  const id='outlook-'+(facts.length+1);
  facts.push({id,kind:'independent-household-research',text:
   (title+'. '+statement).slice(0,1850)});
  return {id,title,...extra};
 };
 const monthsCoverage=add('Historical full-calendar-month coverage',
  'Analysis as of '+asOf+'; full months with source coverage '+(months.join(', ')||'none')+
  '; comparison window '+(windows.map(x=>x.month).join(', ')||'none')+
  '. The ongoing '+asMonth+' month is incomplete; never project it as a full month.',{});
 const summaryWindow=add('Observed monthly household purchase run rate',windows.length?
  windows.length+' available complete months: gross purchases '+dollar(averaged.purchaseAverage)+
  ' per month, separately identified refunds '+dollar(averaged.refundAverage)+
  ' per month, purchases net identified refunds '+dollar(averaged.netPurchaseAverage)+
  ' per month; credit-card purchases '+dollar(averaged.creditPurchasesAverage)+
  ' per month; outgoing transfers (excluding card repayments) '+dollar(averaged.transferOutAverage)+
  ' per month, of which owner-categorized mortgage/utility transfer candidates '+dollar(averaged.obligationTransferAverage)+
  ' per month and other transfers '+dollar(averaged.otherTransferAverage)+
  ' per month. Owner labels do not independently prove final mortgage payment/expense. Posted card repayments are excluded to avoid counting purchases twice.': 'No fully covered calendar month available; do not infer historical monthly spending.',{});
 for(const m of complete){
  add('Recorded purchases and cash inflows '+m.month,
   'Full calendar month '+m.month+': purchase charges '+dollar(m.purchases/100)+
   ', identified refunds '+dollar(m.refunds/100)+
   ', net purchase charges '+dollar((m.purchases-m.refunds)/100)+
   ', observed direct payroll-like deposits '+dollar(m.payroll/100)+
   ', other classified income '+dollar(m.otherIncome/100)+
   ', outgoing non-card transfers '+dollar(m.transferOut/100)+
   ', of which owner-categorized mortgage/utility '+dollar(m.obligationTransfers/100)+
   ', other ambiguous transfers '+dollar(m.otherTransferOut/100)+
   ', credit-card new purchases '+dollar(m.cardPurchases/100)+
   ', purchase count '+m.purchaseCount+'. Payroll-like deposit names are heuristics; saved recurring income rules separately establish cadence.');
 }
 const incomeFact=add('Saved recurring pay schedules and normalized monthly income',
  recognized.length+' recognized income schedules'+(unresolved.length?
   ' and '+unresolved.length+' with an unrecognized cadence; normalized income unavailable.':
   normalizedPayroll!==null?
    ', producing '+dollar(normalizedPayroll)+' per calendar month equivalent, assuming those saved recurring income streams continue.':
    '; no verified annualized income schedule available.')+
  ' A month with three paychecks does not imply three-paycheck income every month. '+
  recognized.slice(0,8).map(x=>x.id+' '+dollar(x.amount)+' '+x.frequency+
   (validDate(x.anchorDate)?' anchored '+x.anchorDate:'')).join('; '));
 if(windows.length&&normalizedPayroll!==null){
  const combined=money(averaged.netPurchaseAverage+averaged.obligationTransferAverage),
   difference=money(normalizedPayroll-combined);
  add('Conditional normalized cash-flow sustainability comparison',
   'Normalized saved recurring income '+dollar(normalizedPayroll)+
   ' per month versus observed net purchase charges plus owner-categorized housing/utility withdrawal candidates '+
   dollar(combined)+' per month; difference '+(difference<0?'-':'+')+dollar(difference)+
   '. WARNING: transfer recipient/purpose not independently verified; other transfers and possibly missing household income/expenses excluded. This is a scenario proxy, not an audited deficit or daily cash forecast.');
  add('Illustrative spending-adjustment sensitivity',
   'At that same observed proxy and normalized income, spending reductions of $250.00, $500.00 and $750.00 per month would change that calculated margin by those amounts, to '+
   (difference+250<0?'-':'+')+dollar(difference+250)+', '+
   (difference+500<0?'-':'+')+dollar(difference+500)+', and '+
   (difference+750<0?'-':'+')+dollar(difference+750)+
   ' per month, respectively. These are arithmetic illustrations, not verified avoidable spending.');
 }
 if(baseAccount) add('Current primary account cash balance',
  'On '+asOf+', primary account '+doc.primaryAccount+' has source current balance '+
  (finite(baseAccount.opening)?dollar(baseAccount.opening):'unknown')+
  '; source status '+safe(baseAccount.status)+
  '. The export does not establish savings, investment or net-worth coverage.');
 if(trough){
  const threshold=doc.savedDecisions?.alertThreshold;
  add('Earliest critical scheduled checking liquidity',
   'In the next 90 calendar days, the lowest scheduled primary checking end-of-day balance is '+
   dollar(trough.balance)+' on '+trough.date+
   '. Forecast only includes scheduled/known future deposits and withdrawals; ordinary variable purchases are NOT projected.'+
   (finite(threshold)?' Saved checking alert threshold '+dollar(threshold)+
    '; scheduled trough difference from alert '+dollar(trough.balance-threshold)+
    ' ('+(trough.balance<threshold?'below':'at or above')+' threshold).':''));
 }
 for(const x of nextDated) add('Large upcoming scheduled primary-account event',
  x.date+' on '+doc.primaryAccount+': '+safe(x.merchant)+' '+safe(x.kind)+
  ' '+dollar(x.amount)+'. Source derived Ledger future event, not a guarantee of settlement.');
 for(const item of categories) add('Historical purchase category '+item.label,
  'Across '+windows.length+' complete observed months, '+safe(item.label)+
  ' gross recorded purchase charges '+dollar(item.total)+
  ', monthly average '+dollar(item.monthlyAverage)+'. Categories are owner/provider labels and may include mixed-use merchants.');
 for(const item of merchants.slice(0,18)) add('Historical merchant '+item.label,
  'Across '+windows.length+' complete months, '+safe(item.label)+
  ' gross recorded purchase charges '+dollar(item.total)+
  ', monthly average '+dollar(item.monthlyAverage)+'. Receipts/items are unavailable; merchant totals are not proven discretionary.');
 for(const item of other.slice(0,15))add('Unbudgeted or Other merchant '+item.label,
  'Of the Other category, '+safe(item.label)+' recorded '+dollar(item.total)+
  ' across '+windows.length+' complete months, an average '+dollar(item.monthlyAverage)+
  ' per month. Necessity unknown from merchant-only bank records.');
 for(const item of budgets.filter(x=>finite(x.monthlyTarget)).slice(0,40)){
  const matching=categories.find(x=>x.label===item.category);
  add('Saved monthly category target '+safe(item.category),
   'Owner target '+dollar(item.monthlyTarget)+
   (matching?', full-month observed purchase average '+dollar(matching.monthlyAverage):', no comparable observed category amount')+
   '. Category targets are not proof of affordability or necessity.');
 }
 if(windows.length)add('Size and concentration of recorded purchases',
  'Across '+windows.length+' complete months, '+averaged.largePurchaseCount+
  ' purchases of at least $100.00 accounted for '+dollar(averaged.largePurchaseTotal)+
  ' of '+dollar(windows.reduce((s,m)=>s+m.purchases,0)/100)+
  ' gross purchase charges. This is purchasing concentration, not an estimate of waste.');
 const cardAccounts=(doc.accounts||[]).filter(a=>a.type==='credit');
 if(cardAccounts.length&&windows.length){
  const upcoming=future.filter(e=>e.date>=asOf&&e.date<isoAdd(asOf,100)&&
   (e.kind==='transfer_out'||e.kind==='card_payment')&&
   String(e.merchant||'').toLowerCase().includes('card'));
  add('Credit-card purchases versus intentionally scheduled-only future card outflows',
   'Historical new credit purchases averaged '+dollar(averaged.creditPurchasesAverage)+
   ' per calendar month in the comparison window; '+cardAccounts.length+
   ' linked credit-card accounts. Ledger predicts known and recurring future purchases and their statement payments, not all future variable card spending. A growing multi-year scheduled checking balance cannot by itself establish future savings. Card purchases and statement repayments have different dates and must not be compared as same-month cash expense.');
 }
 const limitation=add('Financial completeness and uncertainty',
  'Only '+(doc.accounts||[]).length+' account sources present; no comprehensive assets, investments, unlinked liabilities or emergency savings. Actual history starts '+coverageStart+
  ', ends '+(doc.coverage?.pastDataEnd||asOf)+
  '; current month is partial. No itemized retail receipts. External transfer recipients and the final purpose of transfers are not independently verified. No assumptions about unlinked household income or other accounts.');
 if(windows.length>=2){
  const points=windows.map(m=>({label:m.month,value:money(m.purchases/100),
   alternateValue:money((m.payroll+m.otherIncome)/100)}));
  charts.push({id:'outlook-observed-purchases-vs-deposits',kind:'historical-income-purchasing',
   type:'comparison',unit:'USD',
   title:'Recorded monthly purchases versus classified deposits',
   legendPrimary:'Posted purchase charges',
   legendSecondary:'Observed income deposits',
   subtitle:'Complete months; charged purchases are not the same timing as card autopays. Deposit identification follows bank classification.',
   points});
 }
 if(categories.length>=2)
  charts.push({id:'outlook-purchase-categories',kind:'historical-category-rank',
   type:'bar',unit:'USD',title:'Historical monthly purchasing by category',
   subtitle:'Observed completed-month average; mixed-use categories may mislead',
   points:categories.slice(0,14).map(x=>({label:x.label,value:x.monthlyAverage}))});
 if(merchants.length>=2)
  charts.push({id:'outlook-purchase-merchants',kind:'merchant-purchase-rank',
   type:'bar',unit:'USD',title:'Largest recorded purchase merchants',
   subtitle:'Monthly average of complete months; necessary and optional purchases both included',
   points:merchants.slice(0,12).map(x=>({label:x.label,value:x.monthlyAverage}))});
 if(projected.length>1){
  const points=projected.filter(p=>p.date>=asOf&&p.date<=isoAdd(asOf,35))
   .map(p=>({label:p.date,value:p.balance}));
  if(points.length>1)charts.push({id:'outlook-near-term-checking',
   kind:'conditional-cash-flow',type:'line',unit:'USD',
   title:'Checking balance from known scheduled transactions',
   subtitle:'Conditional Ledger forecast — DOES NOT include future ordinary variable spending',
   points});
 }
 const first=add('Research desk manifest',
  'Full sanitized export examined: '+(doc.counts?.history||rows.length)+' history entries, '+
  (doc.counts?.future||0)+' canonical future entries, '+
  (doc.counts?.balances||0)+' daily account projections, '+
  (doc.counts?.cards||0)+' card statements, '+
  (doc.counts?.recurringSchedules||0)+' saved recurring rules; as-of '+asOf+
  '. Only evidence-backed conclusions are permitted.');
 const briefing={
  source:'Read-only independently calculated research desk from the COMPLETE sanitized export',
  asOf,fullCalendarMonths:months,
  comparisonMonths:windows.map(x=>x.month),
  monthByMonth:complete.map(m=>({month:m.month,
   grossPurchases:money(m.purchases/100),identifiedRefunds:money(m.refunds/100),
   netPurchases:money((m.purchases-m.refunds)/100),
   classifiedPayrollDeposits:money(m.payroll/100),
   otherClassifiedIncome:money(m.otherIncome/100),
   externalOrInternalTransferOut:money(m.transferOut/100),
   ownerCategorizedHousingUtilityTransfers:money(m.obligationTransfers/100),
   unclassifiedOrOtherTransfers:money(m.otherTransferOut/100),
   creditCardNewPurchases:money(m.cardPurchases/100),
   purchaseCount:m.purchaseCount})),
  monthlyAverage:averaged,
  savedIncome:{recognizedSchedules:recognized.length,unrecognizedCadence:unresolved.length,
   normalizedMonthly:normalizedPayroll},
  categories,merchants,otherCategoryMerchants:other,subscriptions,
  savedCategoryTargets:budgets,
  primaryChecking:{current:baseAccount?.opening??null,
   lowestScheduled90:trough?{date:trough.date,balance:trough.balance}:null,
   alertThreshold:doc.savedDecisions?.alertThreshold??null},
  futureEventsNearCheckingLow:nextDated.map(x=>({date:x.date,merchant:safe(x.merchant),
   kind:x.kind,amount:x.amount,accountId:x.accountId})),
  creditCardCount:cardAccounts.length,
  insightStatus:'Open-ended source research, NOT predetermined financial advice or QA findings',
  sourceFactIds:{monthsCoverage:monthsCoverage.id,runRate:summaryWindow.id,
   normalizedIncome:incomeFact.id,limitations:limitation.id,manifest:first.id},
  citationRule:'Every exact dollar/date in prose or a chart must be supported by evidence IDs. Numbers here are calculated from canonical normalized records, and evidence facts with IDs are attached to this request.',
  methodologicalLimits:['Cards: new purchases are counted as consumption when charged; autopay settlement is a separate cash flow.',
   'Transfers: outgoing transfers can be external costs, savings movements or linked settlement; do not call them expenses without corroboration.',
   'Forecast: predicts scheduled entries only; no automatic variable-spending extrapolation or assertion of future cash savings.',
   'Complete calendar months only for spending averages; normalize pay cycles rather than treating third-paycheck months as a new recurring pay level.',
   'A merchant total is not itemized proof that spending is discretionary.'],
  potentialCharts:charts.map(x=>({id:x.id,title:x.title,type:x.type,subtitle:x.subtitle}))
 };
 return {briefing,facts,charts};
}
module.exports={buildOutlookDesk};
