/* Historical bank records stay read-only. This scanner looks for actionable,
 * lower-confidence repeating patterns and sends them to Reviews, never directly
 * to the balance forecast. No user data leaves the browser. */
(function(root){
'use strict';
const DAY=86400000;
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&Number.isFinite(Date.parse(s+'T12:00:00Z'));
const amount=n=>Math.round(Number(n)*100);
const diff=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/DAY);
const lastDay=m=>new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).getUTCDate();
const addDays=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const monthAt=(iso,n)=>{
 const [y,m,d]=iso.split('-').map(Number);
 const first=new Date(Date.UTC(y,m-1+n,1,12)),target=first.toISOString().slice(0,7);
 return target+'-'+String(Math.min(d,lastDay(target))).padStart(2,'0');
};
const namesBill=/\b(?:mortgage|rent|loan|insurance|premium|subscription|membership|internet|electric|utilities|water|sewer|daycare|tuition|payroll|salary|paycheck|wireless|cellular|phone plan|autopay|gym|netflix|hulu|spotify)\b/i;
const pfcRecurring=t=>{
 const p=t.personal_finance_category||t.source?.personalFinanceCategory||{};
 return /MORTGAGE|INSURANCE|SUBSCRIPTION|RECURRING|UTILITIES|RENT|LOAN_PAYMENT|INCOME_WAGES/.test(String(p.detailed||'').toUpperCase());
};
const accountOf=(t,accounts)=>{
 const raw=String(t.accountId||t.account||'');
 const found=(accounts||[]).filter(a=>[a.id,a.name,a.transactionAccount].some(k=>String(k||'')===raw));
 return found.length===1?String(found[0].id):raw;
};
// Every real bank record is eligible to become a *proposal*, even when it
// was classified as a transfer/refund or is still pending. Actual posting
// evidence for automatic discovery remains stricter (settled, positive value).
const canPlan=t=>Boolean(t&&validDate(t.date)&&
 ['expense','income','refund','transfer'].includes(t.type)&&
 Number.isFinite(Number(t.amount))&&Number(t.amount)>=0);
const isMortgage=t=>{
 const p=t.personal_finance_category||t.source?.personalFinanceCategory||{};
 return /\b(mortgage|mtg|home loan|pennymac|loandepot|newrez|shellpoint|mr cooper)\b/i.test(String(t.merchant||''))||
  /MORTGAGE/.test(String(p.detailed||'').toUpperCase())||
  t.accountingKind==='loan_payment';
};
function draftFor(row,records,accounts,asOf){
 if(!canPlan(row))throw Error('This bank transaction has no valid date or amount');
 const sourceAccount=accountOf(row,accounts);
 if(!(accounts||[]).some(a=>String(a.id)===sourceAccount))
  throw Error('The bank account for this transaction is not connected');
 const credit=id=>String((accounts||[]).find(a=>String(a.id)===id)?.accountType||
  (accounts||[]).find(a=>String(a.id)===id)?.type||'').toLowerCase()==='credit';
 const counterpart=(records||[]).find(t=>row.pairedTransactionId&&
  String(t.id)===String(row.pairedTransactionId)&&!t.pending);
 const peerAccount=counterpart?accountOf(counterpart,accounts):'';
 const linked=Boolean(row.type==='transfer'&&counterpart&&peerAccount&&peerAccount!==sourceAccount&&
  (accounts||[]).some(a=>String(a.id)===peerAccount));
 let type=row.type,fromAccountId=sourceAccount,toAccountId=peerAccount||'';
 if(linked){
  const out=row.cashDirection==='out'||counterpart.cashDirection==='in';
  fromAccountId=out?sourceAccount:peerAccount;
  toAccountId=out?peerAccount:sourceAccount;
  type='transfer';
 }else if(row.type==='transfer'){
  // A non-paired ACH debit is not proof of a transfer between two of the
  // user's connected accounts. Treat as an outgoing bill suggestion, or
  // incoming deposit/refund, and let the user explicitly change the type.
  type=row.cashDirection==='in'?(credit(sourceAccount)?'refund':'income'):'expense';
 }
 // An ACH income may be labeled "transfer" by Plaid and payroll, power,
 // water and other regular streams often have a different amount each month.
 const direction=t=>t.type==='transfer'&&!t.pairedTransactionId?
  (t.cashDirection==='in'?'income':t.cashDirection==='out'?'expense':null):t.type;
 const evidence=(records||[]).filter(t=>canPlan(t)&&!t.pending&&
  accountOf(t,accounts)===sourceAccount&&direction(t)===type&&
  norm(t.merchant||t.name)===norm(row.merchant||row.name))
  .sort((a,b)=>a.date.localeCompare(b.date));
 const cadence=guessFrequency(evidence)||'monthly',last=evidence.at(-1)||row,
  pay=evidence.slice(-4),payA=pay.length===4?(Number(pay[0].amount)+Number(pay[2].amount))/2:0,
  payB=pay.length===4?(Number(pay[1].amount)+Number(pay[3].amount))/2:0,
  tolerance=Math.max(3,(payA+payB)/2*.003),
  alternating=cadence==='biweekly'&&type==='income'&&pay.length===4&&
   Math.abs(Number(pay[0].amount)-Number(pay[2].amount))<=tolerance&&
   Math.abs(Number(pay[1].amount)-Number(pay[3].amount))<=tolerance&&
   Math.abs(payA-payB)>=Math.max(2,(payA+payB)/2*.004),
  frequency=alternating?'every-4-weeks':cadence,
  // History starts from the SELECTED actual paycheck and only the matching
  // 28-day series, rather than merging the alternating partner into it.
  chosen=evidence.filter(t=>frequency!=='every-4-weeks'||
   Math.min(Math.abs(Math.round((Date.parse(t.date)-Date.parse(row.date))/86400000)%28),
    28-Math.abs(Math.round((Date.parse(t.date)-Date.parse(row.date))/86400000)%28))<=3);
 return {accountId:sourceAccount,merchant:String(row.merchant||row.name||'Bank transaction'),
  amount:Number(row.amount)||0,type,originalType:row.type,
  cashDirection:row.cashDirection||null,frequency,
  nextDate:nextDate(alternating?row.date:last.date,frequency,asOf),sourceRow:row,
  sourcePending:Boolean(row.pending),fromAccountId,toAccountId,
  linkedTransfer:linked,examples:chosen.filter(t=>Number(t.amount)>0).slice(-8).map(x=>String(x.id))};
}
function guessFrequency(history){
 const ts=[...(history||[])].sort((a,b)=>a.date.localeCompare(b.date));
 if(ts.length<2)return null;
 const gaps=ts.slice(1).map((t,i)=>diff(t.date,ts[i].date));
 const recent=gaps.slice(-3),avg=recent.reduce((a,b)=>a+b,0)/recent.length;
 const days=ts.slice(-Math.min(ts.length,4)).map(t=>Number(t.date.slice(-2)));
 const spread=Math.max(...days)-Math.min(...days);
 const choices=[
  {frequency:'weekly',span:7,tolerance:2},
  {frequency:'biweekly',span:14,tolerance:3},
  {frequency:'monthly',span:30.44,tolerance:6},
  {frequency:'quarterly',span:91.31,tolerance:9},
  {frequency:'semiannual',span:182.6,tolerance:11},
  {frequency:'annual',span:365.25,tolerance:16}
 ];
 return choices.find(c=>Math.abs(avg-c.span)<=c.tolerance&&
  recent.every(d=>Math.abs(d-c.span)<=c.tolerance)&&
  (!['monthly','quarterly','semiannual','annual'].includes(c.frequency)||spread<=7))?.frequency||null;
}
function nextDate(last,frequency,asOf){
 if(!validDate(last)||!validDate(asOf))return null;
 let d=last;
 for(let i=0;i<56&&d<=asOf;i++){
  d=frequency==='weekly'?addDays(d,7):frequency==='biweekly'?addDays(d,14):
   frequency==='every-4-weeks'?addDays(d,28):
   monthAt(last,(i+1)*({monthly:1,quarterly:3,semiannual:6,annual:12}[frequency]||1));
 }
 return d>asOf?d:null;
}
function candidates(records,accounts,asOf,preferences={},forecastEvents=[]){
 const dismissed=preferences.historyPatternDecisions||{},rules=preferences.futureRecurringRules||[],
  excluded=preferences.plannerRoutineDecisions||{};
 const groups=new Map();
 for(const t of records||[]){
  if(!canPlan(t)||t.pending||Number(t.amount)<=0||t.date>asOf||
   // Paired transfers already move between linked accounts, not bills.
   t.pairedTransactionId)continue;
  // Bank feeds sometimes misclassify ACH bills as transfers. Both outgoing
  // and incoming unpaired entries are reviewable, but an incoming transfer
  // must never be silently assumed to be earned income.
  const kind=t.type==='transfer'?
   (t.cashDirection==='out'?'expense':t.cashDirection==='in'?'income':null):
   t.type;
  if(!['expense','income'].includes(kind))continue; // Refunds remain manually schedulable in History.
  const aid=accountOf(t,accounts),name=norm(t.merchant||t.name);
  if(!name)continue;
  const account=(accounts||[]).find(a=>String(a.id)===aid);
  if(!account||String(account.accountType||account.type||'').toLowerCase()==='loan')continue;
  if(String(account.accountType||account.type||'').toLowerCase()==='credit'&&kind==='income')continue;
  const key=[aid,kind,name,String(amount(t.amount))].map(encodeURIComponent).join('|');
  if(!groups.has(key))groups.set(key,{key,accountId:aid,accountName:account.name||aid,
   merchant:String(t.merchant||t.name),amount:Number(t.amount),type:kind,rows:[]});
  groups.get(key).rows.push(t);
 }
 const result=[];
 for(const g of groups.values()){
  g.rows.sort((a,b)=>a.date.localeCompare(b.date));
  const latest=g.rows.at(-1),age=diff(asOf,latest.date);
  const bill=namesBill.test(g.merchant)||g.rows.some(pfcRecurring)||
   ['Housing','Insurance','Subscriptions','Utilities'].includes(latest.category);
  const frequency=guessFrequency(g.rows),cadence=frequency||'monthly';
  const tolerance={weekly:18,biweekly:35,monthly:75,quarterly:125,
   semiannual:210,annual:400}[cadence];
  // A single recent payment from *any* merchant can be offered for
  // confirmation, but never forecasts money by itself without clear
  // recurring evidence. Older ordinary one-offs do not clutter Reviews.
  if(age>(g.rows.length===1&&!bill?45:tolerance))continue;
  if(dismissed[g.key]==='dismissed'||
   preferences.futureRecurrenceExclusions?.[
    [g.accountId,g.type,norm(g.merchant)].map(encodeURIComponent).join('|')])continue;
  const sourceType=latest.type;
  const aliases=[g.accountId,g.accountName,latest.account,latest.accountId]
   .map(String).filter(Boolean);
  if(aliases.some(a=>[g.type,sourceType].some(kind=>{
   const decision=excluded[[kind,a,norm(g.merchant)].join('|')];
   return decision?.status==='excluded'&&Math.abs(Number(decision.amount)-g.amount)<.011;
  })))continue;
  const existingRules=rules.filter(r=>r.kind==='event'&&
   String(r.originalAccountId||r.accountId)===g.accountId&&(!r.type||r.type===g.type)&&
   (r.matchNames||[norm(r.originalMerchant||r.merchant)]).includes(norm(g.merchant)));
  // Manual plan owns bank stream no matter the latest bill amount. An
  // unexpected electric charge or NET paycheck is not another recurrence.
  if(existingRules.length)continue;
  const upcoming=nextDate(latest.date,cadence,asOf);
  if(!upcoming||diff(upcoming,asOf)>90)continue;
  const projected=(forecastEvents||[]).some(e=>
   accountOf(e,accounts)===g.accountId&&e.date>asOf&&
   norm(e.merchant)===norm(g.merchant)&&Math.abs(Number(e.amount)-g.amount)<.011);
  if(projected)continue;
  const strong=Boolean(frequency)&&g.rows.length>=3;
  result.push({key:g.key,accountId:g.accountId,accountName:g.accountName,
   merchant:g.merchant,amount:g.amount,type:g.type,
   frequency:cadence,confidence:strong?'Medium':g.rows.length>=2?'Low':'Needs confirmation',
   examples:g.rows.slice(-6).reverse().map(t=>({
    id:String(t.id||''),date:t.date,amount:Number(t.amount),merchant:String(t.merchant||'')
   })),
   occurrences:g.rows.length,lastDate:latest.date,nextDate:upcoming,
   reason:existingRules.length?
     'This payee is already connected to a confirmed recurring forecast':
     g.rows.length===1?bill?
     'One identifiable bill; confirm whether and how often it repeats':
     'One bank payment; no repeating pattern established yet':
    !frequency?'Repeated amount, but calendar timing varies; choose a schedule':
    'Matching bank account, payee and recurring timing (amounts can vary)',
   // Rank coherent patterns before the many single, unproven purchases.
   _priority:(frequency?3:bill?2:1)});
 }
 return result.sort((a,b)=>b._priority-a._priority||
  b.occurrences-a.occurrences||b.lastDate.localeCompare(a.lastDate)||
  b.amount-a.amount).slice(0,100).map(({_priority,...item})=>item);
}
const api={candidates,guessFrequency,nextDate,canPlan,accountOf,draftFor,isMortgage};
root.HouseholdPlannerHistory=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);