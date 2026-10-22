/* Payment-source and card statement forecasting.
 * Statements/forecast adjustments never mutate a bank source record.
 * Confirmed last statements are supplied by the owner; later amounts are estimates.
 */
(function(root){
'use strict';
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const plus=(iso,months)=>{const [y,m,d]=iso.split('-').map(Number),first=new Date(Date.UTC(y,m-1+months,1));
 const max=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 return first.toISOString().slice(0,7)+'-'+String(Math.min(d,max)).padStart(2,'0')};
const shift=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
const closeFor=(month,day)=>{const max=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
 return month+'-'+String(Math.min(Number(day),max)).padStart(2,'0')};
const cash=a=>['checking','savings','depository'].includes(String(a.accountType||a.type||'').toLowerCase());
const credit=a=>String(a.accountType||a.type||'').toLowerCase()==='credit';
const validAmount=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n))&&Number(n)>=0;
// A connected card's historical purchases are always read-only. Its future
// purchases/payment obligations cannot enter the forecast until configured.
const ready=(rule,card,accounts=[])=>Boolean(rule&&card&&credit(card)&&
 date(rule.billingEndDate||rule.lastStatementClose)&&
 date(rule.billingStartDate||rule.lastStatementClose)&&
 date(rule.nextPaymentDate)&&date(rule.nextDueDate||rule.nextPaymentDate)&&
 ['statement','full','minimum','fixed'].includes(rule.method||'statement')&&
 (rule.autopayEnabled===false||
  accounts.some(a=>String(a.id)===String(rule.fromAccountId)&&cash(a))));
// Plaid transactions provide amounts, but not a reliable issuer due date or
// funding account on their own. Only independently paired checking→card
// settlements can establish a provisional recurring checking debit.
function inferPayment(card,accounts,records,asOf){
 const same=(t,a)=>{
  const key=String(t.accountId||t.account||'');
  if(key===String(a.id))return true;
  const found=accounts.filter(x=>x.name===key||x.transactionAccount===key);
  return found.length===1&&String(found[0].id)===String(a.id);
 };
 const posted=new Map(records.filter(t=>t?.id&&!t.pending).map(t=>[String(t.id),t]));
 const matches=[];
 for(const t of records){
  if(!t||t.pending||t.type!=='transfer'||t.accountingKind!=='card_payment'||
   t.cashDirection!=='out'||!t.pairedTransactionId||!date(t.date)||t.date>asOf)continue;
  const other=posted.get(String(t.pairedTransactionId));
  if(!other||other.type!=='transfer'||other.cashDirection!=='in'||
   !same(other,card)||Math.abs(Number(other.amount)-Number(t.amount))>.011)continue;
  const from=accounts.find(a=>cash(a)&&same(t,a));
  if(from)matches.push({date:t.date,amount:Number(t.amount),fromAccountId:String(from.id)});
 }
 const groups=new Map();
 for(const p of matches){
  const key=p.fromAccountId;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(p);
 }
 const recent=[...groups.entries()].map(([id,rows])=>{
  const payments=[...rows].sort((a,b)=>a.date.localeCompare(b.date));
  const last=payments.at(-1),before=payments.at(-2),
   daysBetween=before?Math.round((Date.parse(last.date)-Date.parse(before.date))/86400000):null;
  return {id,payments,last,interval:daysBetween};
 }).filter(g=>g.payments.length>=2&&g.interval>=26&&g.interval<=36&&
  (Date.parse(asOf)-Date.parse(g.last.date))/86400000<=48)
 .sort((a,b)=>b.last.date.localeCompare(a.last.date));
 const net=(from,to)=>{
  let total=0,count=0;
  for(const t of records)if(!t.pending&&same(t,card)&&t.date>=from&&t.date<=to&&
   (t.type==='expense'||t.type==='refund')){
    total+=(t.type==='refund'?-1:1)*Number(t.amount||0);count++;
  }
  return {amount:round(Math.max(0,total)),count};
 };
 const lastThirty=net(shift(asOf,-29),asOf);
 const result={cardId:String(card.id),cardName:card.name,
  observedCharges:lastThirty.amount,observedCount:lastThirty.count,
  evidence:recent[0]?.payments.length||0};
 if(recent.length!==1)return {...result,eligible:false,
  reason:recent.length>1?'Payments appear to use multiple funding accounts':
   'No reliable pair of monthly checking-to-card payments was found'};
 const match=recent[0],previous=net(shift(asOf,-59),shift(asOf,-30));
 const estimate=round(Math.max(lastThirty.amount,previous.count?previous.amount:0)),
  debt=Number(card.current);
 if(!(estimate>0))return {...result,eligible:false,
  reason:'No settled card purchases were found to support a positive payment estimate'};
 if(card.current==null||!Number.isFinite(debt)||debt<=0)
  return {...result,eligible:false,reason:'Current card debt is not positive and requires confirmation'};
 let next=plus(match.last.date,1);
 for(let i=0;i<18&&next<=asOf;i++)next=plus(next,1);
 return {...result,eligible:true,fromAccountId:match.id,
  fromName:accounts.find(a=>String(a.id)===match.id)?.name||match.id,
  nextPaymentDate:next,estimatedAmount:estimate,firstAmount:round(Math.min(estimate,debt)),
  lastPaymentDate:match.last.date,
  reason:'Estimated from posted card charges and recurring matched bank transfers'};
}
function build(snapshot,records=[],expected=[],predictions={},options={}){
 const asOf=String(snapshot.asOf||''),days=options.days||90,through=shift(asOf,days);
 if(!date(asOf))throw Error('Missing as-of date');
 const accounts=snapshot.accounts||[],byId=new Map(accounts.map(a=>[String(a.id),a]));
 const cards=predictions.paymentRules||{},bills=predictions.paymentBills||[];
 const plans=[],billEvents=[],obligations=[],warnings=[],statements=[],historyStatements=[],suppressedExpectedIds=[],
  cardEstimates=[];
 for(const card of accounts.filter(credit))
  if(!ready(cards[card.id],card,accounts)){
   const candidate=cards[card.id]?{
    cardId:String(card.id),cardName:card.name,eligible:false,
    reason:'Saved card payment settings are incomplete; finish or remove them in Settings'
   }:inferPayment(card,accounts,records,asOf);
   cardEstimates.push(candidate);
   if(candidate.eligible){
    // Estimated monthly autopay is provisionally forecast when the bank
    // demonstrates a unique, repeated linked card-payment history. Nothing
    // is saved or claimed as the issuer's actual statement amount.
    for(let when=candidate.nextPaymentDate,n=0;when<=through;when=plus(when,1),n++){
     const amount=n===0?candidate.firstAmount:candidate.estimatedAmount;
     if(!(amount>0))continue;
     // First card payment draws from existing card debt; later monthly
     // payments require corresponding estimated future card charges.
     if(n>0){
      const chargeDay=shift(when,-15);
      if(chargeDay>asOf)billEvents.push({
       id:'card-spend-estimate|'+card.id+'|'+when,
       accountId:String(card.id),date:chargeDay,amount,
       type:'expense',merchant:card.name+' estimated monthly card spending',
       source:'card-history-estimate',amountEstimate:'bank-activity-estimate'
      });
     }
     plans.push({id:'card-history-estimate|'+card.id+'|'+when,
      fromAccountId:candidate.fromAccountId,toAccountId:String(card.id),
      anchorDate:when,amount,frequency:'once',
      merchant:card.name+' Credit-card payment (estimated)',
      origin:'card-history-estimate',status:'estimated',
      amountEstimate:'bank-activity-estimate'});
    }
    warnings.push(card.name+': provisional card withdrawals estimated from Plaid payment history. Confirm billing dates and statement amounts in Settings.');
   }else warnings.push(card.name+': no card withdrawal can be predicted yet. '+
    candidate.reason+'. Set payment dates and funding account in Settings.');
  }
 const settled=new Map(records.filter(t=>t&&t.id).map(t=>[String(t.id),t]));
 const matchesAccount=(row,account)=>{
  const key=String(row.accountId||row.account||''),id=String(account.id);
  if(key===id)return true;
  const aliases=accounts.filter(a=>String(a.name)===key||String(a.transactionAccount||'')===key);
  return aliases.length===1&&aliases[0].id===id;
 };
 // Only actual, reconciled transfers between the chosen funding account and
 // the particular card qualify as actual card payments. Amounts need not equal
 // our estimate (which may not include unplanned charges or account credits).
 const actualSettlements=(from,card)=>{
  if(!from||!card)return [];
  return records.filter(t=>{
   if(!t||t.pending||t.type!=='transfer'||t.accountingKind!=='card_payment'||
    t.cashDirection!=='out'||!t.pairedTransactionId||
    !date(t.date)||t.date>asOf||!matchesAccount(t,from))return false;
   const other=settled.get(String(t.pairedTransactionId));
   return other&&!other.pending&&other.type==='transfer'&&
    other.cashDirection==='in'&&matchesAccount(other,card)&&
    Number(other.amount)>0&&Math.abs(Number(t.amount)-Number(other.amount))<.011;
  }).map(t=>({id:String(t.id),date:t.date,amount:round(t.amount)}))
   .sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 };
 for(const [id,rule] of Object.entries(cards)){
  const card=byId.get(id),from=byId.get(String(rule.fromAccountId||''));
  const autopay=rule.autopayEnabled!==false;
  if(!ready(rule,card,accounts)){
   warnings.push((card?.name||'Credit card')+': complete statement dates, payment date and payment method in Settings');continue;
  }
  const postedPayments=actualSettlements(from,card);
  if(!card||!credit(card)){warnings.push('A configured credit card is not connected');continue}
  if(autopay&&(!from||!cash(from))){
   warnings.push(card.name+': select the checking/savings account paying this card');continue;
  }
  const explicit=Boolean(rule.billingStartDate&&rule.billingEndDate);
  const lastClose=String(explicit?rule.billingEndDate:rule.lastStatementClose||'');
  const anchorStart=explicit?String(rule.billingStartDate):
   shift(closeFor(plus(lastClose,-1).slice(0,7),rule.closingDay),1);
  if(!date(lastClose)||!date(anchorStart)||!date(rule.nextPaymentDate)||
   !date(rule.nextDueDate||rule.nextPaymentDate)||
   !Number.isInteger(Number(rule.closingDay))||Number(rule.closingDay)<1||Number(rule.closingDay)>31||
   (!explicit&&!validAmount(rule.lastStatementBalance))){
   warnings.push(card.name+': billing dates or next payment dates need confirmation');continue;
  }
  if(!autopay)warnings.push(card.name+': statement is estimated, but no automatic withdrawal is scheduled. Choose a payment account if this card is paid from checking.');
  const method=rule.method||'statement',hasIssued=validAmount(rule.lastStatementBalance);
  if(!['statement','full','minimum','fixed'].includes(method)||
    method==='minimum'&&!validAmount(rule.minimumAmount)||
    method==='fixed'&&!validAmount(rule.fixedAmount)){
   warnings.push(card.name+': invalid card payment method');continue;
  }
  if(rule.nextPaymentDate<=lastClose){
   warnings.push(card.name+': next autopay must follow the billing-period end');continue;
  }
  // Prior periods are reconstructed from settled card activity, not called
  // verified bank-issued statements. Retrieved history may be incomplete and
  // does not reveal carried balances, interest or adjustments reliably.
  for(let n=-6;n<=0;n++){
   const close=n===0?lastClose:closeFor(plus(lastClose,n).slice(0,7),rule.closingDay);
   if(close>asOf)continue;
   const start=n===0?anchorStart:
    shift(closeFor(plus(lastClose,n-1).slice(0,7),rule.closingDay),1);
   const entries=records.filter(t=>matchesAccount(t,card)&&!t.pending&&
    t.date>=start&&t.date<=close&&['expense','refund'].includes(t.type));
   const purchases=round(entries.filter(t=>t.type==='expense').reduce((sum,t)=>sum+Number(t.amount),0));
   const refunds=round(entries.filter(t=>t.type==='refund').reduce((sum,t)=>sum+Number(t.amount),0));
   historyStatements.push({cardId:id,cardName:card.name,periodStart:start,periodEnd:close,
    purchases,refunds,netActivity:round(purchases-refunds),count:entries.length,
    issuedBalance:n===0&&validAmount(rule.lastStatementBalance)?round(rule.lastStatementBalance):null,
    source:'Reconstructed from available posted card transactions'});
  }
  // A rolling historic cycle is a fallback estimate when future card activity
  // is not predictable. It never adds on top of known future charges.
  const priorCycles=historyStatements.filter(x=>x.cardId===id&&x.count>0).slice(-3);
  const historicalAverage=priorCycles.length>=2?
   round(priorCycles.reduce((total,x)=>total+x.netActivity,0)/priorCycles.length):null;
  let plannedCardPayments=0;
  // The statement is calculated from the *card's own* settled purchases and
  // refunds during each billing cycle, plus future explicitly predicted charges.
  // An account balance is not itself a statement balance (it may carry debt).
  for(let n=0;n<=18;n++){
   const due=plus(rule.nextPaymentDate,n),actualDue=plus(String(rule.nextDueDate||rule.nextPaymentDate),n);
   if(due>through)break;
   if(due<=asOf)continue;
   const cycleClose=n===0?lastClose:closeFor(plus(lastClose,n).slice(0,7),rule.closingDay);
   const cycleStart=n===0?anchorStart:
    shift(closeFor(plus(lastClose,n-1).slice(0,7),rule.closingDay),1);
   const matchesCard=t=>matchesAccount(t,card);
   const cycleRows=records.filter(t=>matchesCard(t)&&!t.pending&&
    t.date>=cycleStart&&t.date<=cycleClose&&t.date<=asOf&&
    ['expense','refund'].includes(t.type));
   const purchases=round(cycleRows.filter(t=>t.type==='expense')
    .reduce((sum,t)=>sum+Number(t.amount),0));
   const refunds=round(cycleRows.filter(t=>t.type==='refund')
    .reduce((sum,t)=>sum+Number(t.amount),0));
   const bankPurchases=round(purchases-refunds);
   const pendingRows=records.filter(t=>matchesCard(t)&&t.pending&&
    t.date>=cycleStart&&t.date<=cycleClose&&['expense','refund'].includes(t.type));
   const predictedRows=expected.filter(t=>matchesCard(t)&&t.date>=cycleStart&&
    t.date<=cycleClose&&t.date>asOf&&['expense','refund'].includes(t.type));
   const futureCharges=round(predictedRows.reduce((sum,t)=>
    sum+(t.type==='refund'?-Number(t.amount):Number(t.amount)),0));
   const calculated=round(Math.max(0,bankPurchases+futureCharges));
   // When two or more historical cycles exist, fill gaps in incomplete
   // future purchase predictions conservatively with observed net spending.
   const estimatedCycle=round(Math.max(calculated,
    historicalAverage===null?0:historicalAverage));
   // Posted activity is an exact bank-ledger sum, distinct from both the
   // projection for a not-yet-closed period and the issued card statement.
   const actualPeriodNet=round(bankPurchases);
   const periodComplete=cycleClose<=asOf;
   const postedTransactions=cycleRows.map(t=>({
    id:String(t.id||''),date:t.date,merchant:String(t.merchant||t.description||'Card transaction'),
    type:t.type,amount:round(Number(t.amount))
   })).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
   const legacy=!explicit;
   // A known issued statement (optional) supersedes our calculation once.
   // Legacy setups retain their old planning floor for subsequent cycles.
   const confirmedFirst=n===0&&hasIssued&&cycleClose<=asOf;
   const statementAmount=round(confirmedFirst?Number(rule.lastStatementBalance):
    legacy&&hasIssued?Math.max(calculated,Number(rule.lastStatementBalance)):
    periodComplete?calculated:estimatedCycle);
   // Full current balance means the modeled card debt that would exist at
   // withdrawal, including forecast charges up to that date, minus any earlier
   // planned card payments. It is not a bank-issued payoff quotation.
   const futureToDue=round(expected.filter(t=>matchesCard(t)&&t.date>asOf&&
    t.date<=due&&['expense','refund'].includes(t.type)).reduce((sum,t)=>
    sum+(t.type==='refund'?-Number(t.amount):Number(t.amount)),0));
   const currentDebt=Number(card.current);
   const fullAmount=Number.isFinite(currentDebt)&&card.current!==null&&card.current!==undefined?
    round(Math.max(0,currentDebt+futureToDue-plannedCardPayments)):null;
   const amount=round(method==='statement'?statementAmount:
    method==='full'?(fullAmount??0):
    method==='minimum'?Number(rule.minimumAmount):Number(rule.fixedAmount));
   if(method==='full'&&fullAmount===null){
    warnings.push(card.name+': full balance needs a current bank-reported card balance');continue;
   }
   const confidence=confirmedFirst?'User-entered issued statement':
    'Estimated from available card purchases, refunds and scheduled charges';
   if(due>actualDue&&autopay)warnings.push(card.name+': planned checking withdrawal '+due+
    ' falls after the due date '+actualDue);
   if(n===0&&!cycleRows.length&&!predictedRows.length&&!confirmedFirst)
    warnings.push(card.name+': no settled card transactions found in '+cycleStart+' to '+
     cycleClose+'. Verify the bank history before using this estimate.');
   // Plaid posting date is factual; nextPaymentDate is only the user's
   // configured future withdrawal date, not a bank-confirmed scheduled debit.
   const postedForCycle=autopay?postedPayments.filter(t=>
    t.date>cycleClose&&
    Math.abs((Date.parse(t.date)-Date.parse(due))/86400000)<=7):[];
   // One matching posted payment is enough to require reconciliation. Never
   // schedule the full amount again when part/all may already have been paid.
   const paid=postedForCycle.length>0;
   const postedPaymentTotal=round(postedForCycle.reduce((n,t)=>n+t.amount,0));
   if(paid&&Math.abs(postedPaymentTotal-amount)>.011)
    warnings.push(card.name+': actual payment '+postedPaymentTotal.toFixed(2)+
     ' differs from planned '+amount.toFixed(2)+'; confirm any remaining balance.');
   const recentPostedPayment=postedPayments[0]||null;
   const statement={cardId:id,cardName:card.name,fromAccountId:from?.id||null,
    fromName:from?.name||'No autopay source',periodStart:cycleStart,periodEnd:cycleClose,
    dueDate:actualDue,withdrawalDate:due,closingDate:cycleClose,amount,
    statementBalance:statementAmount,bankPurchases,purchases,refunds,
    actualPeriodNet,periodComplete,postedTransactions,
    estimatedCharges:futureCharges,pendingExcluded:pendingRows.length,
    method,confidence,confirmed:confirmedFirst,estimated:!confirmedFirst,
    historicalAverage,fullBalanceEstimate:fullAmount,
    autopayEnabled:autopay,alreadyPaid:paid,actualPayments:postedForCycle,
    actualPaymentAmount:postedPaymentTotal,actualPaymentDate:postedForCycle[0]?.date||null,
    lastPostedPayment:recentPostedPayment,observedCount:cycleRows.length,scheduledCount:predictedRows.length,
    incompleteFuture:cycleClose>asOf};
   statements.push(statement);
   // A statement preview exists even when autopay is disabled. Only a
   // confirmed full-statement autopay rule schedules a checking withdrawal.
   if(amount>0&&autopay&&!paid){
    const plan={id:'autopay|'+id+'|'+due,fromAccountId:from.id,toAccountId:id,
     anchorDate:due,amount,frequency:'once',status:'scheduled',origin:'card-autopay',
     merchant:card.name+' Credit-card payment',amountEstimate:confirmedFirst?null:'estimated-statement'};
    plans.push(plan);
    plannedCardPayments=round(plannedCardPayments+amount);
    obligations.push({id:plan.id,date:due,amount,fromAccountId:from.id,
     merchant:card.name+' autopay',kind:'card_payment',confidence,cardId:id});
   }
  }
 }
 for(const b of bills){
  if(b.enabled===false)continue;
  const account=byId.get(String(b.fromAccountId||'')),amount=Number(b.amount);
  if(!account||!cash(account)||!date(b.date)||!(amount>0)||!Number.isFinite(amount)){
   warnings.push((b.name||'Scheduled bill')+': valid funding account, date and amount required');continue;
  }
  for(let n=0;n<13;n++){
   const due=b.frequency==='monthly'?plus(b.date,n):n===0?b.date:null;
   if(!due||due>through)break;
   if(due<=asOf)continue;
   const label=String(b.name||'Automatic payment').trim();
   // One mortgage is one checking withdrawal, even when the owner calls the
   // saved bill "Mortgage" and Plaid calls it "Home Mortgage ACH" or "PENNYMAC".
   // Reconcile by funding account, date proximity and mortgage semantics.
   const normalized=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
   const mortgage=s=>/\b(?:mortgage|mtg|home\s+loan|pennymac|loandepot|newrez|shellpoint|mr\s+cooper)\b/i.test(String(s||''));
   const sameMerchant=expected.filter(t=>t.type==='expense'&&matchesAccount(t,account)&&
    Math.abs(Date.parse(t.date)-Date.parse(due))<=6*86400000&&
    (normalized(t.merchant)===normalized(label)||mortgage(t.merchant)&&mortgage(label)));
   if(sameMerchant.length===1){
    if(Math.abs(Number(sameMerchant[0].amount)-amount)<.011)continue;
    // When bank history and the owner disagree on the bill amount, use one
    // owner-entered estimate and flag the disagreement for confirmation.
    if(sameMerchant[0].id)suppressedExpectedIds.push(String(sameMerchant[0].id));
    warnings.push(label+': entered amount differs from the bank-derived recurring estimate for '+due+'. Review before relying on the projected balance.');
   }else if(sameMerchant.length>1){
    warnings.push(label+': multiple competing predicted withdrawals near '+due+'; review for duplicates');
   }
   const e={id:'bill|'+b.id+'|'+due,accountId:account.id,account:account.name,
    type:'expense',amount,date:due,merchant:label,category:b.category||'Housing',source:'owner-bill',
    frequency:b.frequency,billId:b.id,cadence:b.frequency==='monthly'?'monthly':null};
   billEvents.push(e);
   obligations.push({id:e.id,date:due,amount,fromAccountId:account.id,merchant:label,
    kind:'automatic_bill',confidence:'entered schedule / amount estimate'});
  }
 }
 return {plans,billEvents,suppressedExpectedIds,obligations:obligations.sort((a,b)=>a.date.localeCompare(b.date)),warnings,statements,
  cardEstimates,historyStatements:historyStatements.slice().sort((a,b)=>b.periodEnd.localeCompare(a.periodEnd))};
}
const api={build,plus,closeFor,ready,inferPayment};
root.HouseholdPaymentObligations=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
