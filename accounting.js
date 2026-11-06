/* Phase A: account-aware household transaction classification and reconciliation.
 * Read-only derived accounting view; Plaid and historical source rows are never mutated.
 * Both halves of a transfer remain independently auditable bank transactions.
 */
(function(root){
'use strict';
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const safe=s=>String(s??'').trim();
const key=t=>safe(t.accountId||t.account||'Unknown');
const norm=s=>safe(s).toLowerCase().replace(/\s+/g,' ');
const iso=s=>/^\d{4}-\d{2}-\d{2}$/.test(safe(s))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const days=(a,b)=>Math.abs((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
const accountTypes=new Set(['checking','savings','credit','loan','other','unknown']);
function accountType(input){
 const type=norm(input?.accountType||input?.type),sub=norm(input?.subtype);
 if(type==='depository')return sub==='savings'||sub==='money market'?'savings':'checking';
 if(type==='credit'||type==='credit_card'||type==='credit card'||sub==='credit card')return 'credit';
 if(type==='loan')return 'loan';
 if(accountTypes.has(type))return type;
 return 'unknown';
}
function registerAccounts(state,provided){
 if(!Array.isArray(provided))throw Error('Accounts must be an array');
 const current=Array.isArray(state.accounts)?state.accounts:[];
 const byId=new Map(current.filter(a=>a?.id).map(a=>[String(a.id),{...a}]));
 for(const raw of provided){
  const id=safe(raw?.account_id||raw?.id);
  if(!id||id.length>200)throw Error('Account requires a stable account ID');
  const prev=byId.get(id)||{};
  const explicit=raw.type||raw.subtype||raw.accountType;
  const type=explicit?accountType(raw):(prev.type||'unknown');
  const institution=safe(raw.institution||raw.institutionName||prev.institution);
  const name=safe(raw.name||raw.official_name||prev.name||id);
  const itemId=safe(raw.itemId||raw.item_id||prev.itemId);
  // Preserve only account metadata. Snapshots are separate and dated; no made-up balances.
  byId.set(id,{...prev,id,name,type,institution,itemId,
   ...(raw.mask!==undefined?{mask:safe(raw.mask)}:{}),
   ...(raw.currency||raw.iso_currency_code?{currency:safe(raw.currency||raw.iso_currency_code)}:{})});
 }
 state.accounts=[...byId.values()].sort((a,b)=>a.name.localeCompare(b.name));
 return state.accounts;
}
function accountsFor(state){
 const byId=new Map((Array.isArray(state?.accounts)?state.accounts:[])
  .filter(a=>a?.id).map(a=>[String(a.id),{...a}]));
 for(const t of state?.transactions||[]){
  const id=key(t);
  if(!byId.has(id))byId.set(id,{id,name:safe(t.account||id),type:'unknown',
   institution:'',inferred:true});
 }
 return [...byId.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
const cardPayment=/\b(?:credit card payment|card payment|payment to (?:card|credit)|autopay (?:card|credit)|card autopay|payment thank you|thank you(?: for)? (?:your )?payment|credit card autopay|cardmember payment|cc payment|cc pymt|payment received on card)\b/i;
const cardIssuer=/\b(?:amex|american express|discover card|capital one card|chase (?:visa|freedom|sapphire)|citi(?:bank)? card|bank of america (?:visa|card)|barclays card|synchrony card)\b/i;
const transferText=/\b(?:transfer (?:to|from)|internal transfer|account transfer|xfer (?:to|from)|transfer between|savings transfer|moving money)\b/i;
const refundText=/\b(?:refund|reversal|chargeback|return credit|purchase return|merchant credit|returned purchase|credit adjustment)\b/i;
const payrollText=/\b(?:payroll|salary|wages|paycheck|direct deposit|interest earned|dividend|deposit from employer)\b/i;
/* Strong external income evidence takes priority over a generic Plaid
 * TRANSFER_IN label, but never promotes ordinary account-to-account money. */
function recognizedIncome(t,account){
 const type=account?.type||t.accountType||t.account?.type;
 if(type==='credit'||type==='loan')return false;
 const description=String(t.merchant||t.name||'')+' '+String(t.description||'');
 const pfc=t.personal_finance_category||t.source?.personalFinanceCategory||t.category;
 const primary=String(pfc?.primary||'').toUpperCase(),
  detailed=String(pfc?.detailed||'').toUpperCase();
 const incoming=direction(t)==='in';
 if(!incoming||refundText.test(description)||cardPayment.test(description))return false;
 if(/\b(?:transfer (?:from|to) (?:my |own |the )?(?:checking|savings|account)|internal transfer|account transfer|savings transfer|cash advance)\b/i.test(description))return false;
 return /^INCOME$/.test(primary)||/^INCOME_(?:WAGES|OTHER_INCOME|SOCIAL_SECURITY|RETIREMENT|BENEFITS)/.test(detailed)||
  /\b(?:payroll|salary|wages|paycheck|pay\s*check|direct\s+dep(?:osit)?|employer\s+deposit|social\s+security\s+(?:deposit|benefit)|pension\s+(?:payment|deposit))\b/i.test(description);
}
function direction(t){
 const raw=t.source?.plaidAmount;
 if(Number.isFinite(Number(raw))&&raw!==null&&raw!==undefined&&raw!=='')
  return Number(raw)>0?'out':Number(raw)<0?'in':'unknown';
 if(['out','in'].includes(t.cashDirection))return t.cashDirection;
 return t.type==='expense'?'out':t.type==='income'?'in':'unknown';
}
function initialKind(t,account){
 const name=String(t.merchant||'')+' '+String(t.description||'');
 const dir=direction(t),isCard=account?.type==='credit',
  pfc=t.personal_finance_category||t.source?.personalFinanceCategory||{},
  primary=String(pfc.primary||'').toUpperCase(),
  detailed=String(pfc.detailed||'').toUpperCase();
 // Card imports may initially label *every incoming card amount* a
 // refund. That provisional type must NEVER override payment evidence:
 // card settlements are linked transfers, excluded from card purchases and
 // used to infer the next bill. Preserve confirmed merchant returns below.
 const payment=cardPayment.test(name)||isCard&&/\b(?:payment|autopay|pymt)\b/i.test(name)||
   cardIssuer.test(name)&&/\b(?:payment|autopay|pymt)\b/i.test(name);
 if(payment)return 'card_payment';
 // Only bank-direction-confirmed returns count as statement credits. For
 // credit cards, a generic imported type='refund' is not proof: it may be
 // a card payment. Keep explicit refund descriptors/provider codes, and
 // let the unique-merchant match below resolve unlabeled merchant refunds.
 if(dir==='in'&&(refundText.test(name)||
  (!isCard&&t.type==='refund')||
  /(?:^|_)REFUND(?:_|$)|(?:^|_)RETURN(?:_|$)/.test(primary+'_'+detailed)))
  return 'refund';
 // Plaid can code mortgage/loan withdrawals as LOAN_PAYMENTS. They are external
 // bills leaving checking, not transfers between connected household accounts.
 // This also reinterprets existing read-only records imported as "transfer".
 const obligation=root.HouseholdCategorization?.loanBill?.(t);
 if(!isCard&&account?.type!=='loan'&&obligation?.isBill){
  if(dir==='out')return 'loan_payment';
  if(dir==='in')return 'refund'; // A returned loan payment is never earned income.
 }
 if(recognizedIncome(t,account))return 'income';
 // Preserve explicit internal-transfer evidence while distinguishing a
 // generic merchant credit from a card settlement. A bank-coded TRANSFER_IN
 // with no return evidence remains a transfer until matched/reviewed.
 if(transferText.test(name)||isCard&&dir==='in'&&primary==='TRANSFER_IN')
  return 'internal_transfer';
 if(t.type==='transfer'&&!isCard)return 'internal_transfer';
 if(isCard&&dir==='in')return 'unclassified_card_credit'; // Reconcile possible payment first.
 if(dir==='in')return 'income';
 if(dir==='out')return 'purchase';
 return 'unclassified';
}
function cleanedRefundMerchant(name){
 return norm(name).replace(/^(?:refund|reversal|return|returned|credit|purchase return)\s*[:#-]?\s*/,'')
  .replace(/\s*(?:refund|return|reversal)$/,'').trim();
}
function reconcile(state){
 const registry=accountsFor(state),accountMap=new Map(registry.map(a=>[a.id,a]));
 const output=(state?.transactions||[]).filter(t=>t&&typeof t==='object').map(t=>{
  const accountId=key(t),kind=initialKind(t,accountMap.get(accountId));
  return {...t,accountId,account:t.account||accountMap.get(accountId)?.name||accountId,
   accountType:accountMap.get(accountId)?.type||'unknown',
   accountingKind:kind,cashDirection:direction(t),
   spendingAmount:0,earnedIncomeAmount:0,reconciliationStatus:'not-applicable',
   transferGroupId:null,pairedTransactionId:null,
   classificationConfidence:kind==='unclassified'||kind==='unclassified_card_credit'?'Needs review':'Rule'};
 });
 // Match conservatively: exact equal amounts, opposite direction, separate accounts,
 // within 5 days, at least one side has unmistakable transfer/payment semantics.
 // If multiple equally plausible counterparts exist, leave them unmatched for review.
 const candidateRows=output.filter(t=>!t.pending&&Number(t.amount)>0&&iso(t.date));
 // Limit cross-account pairing to the same five-day window and opposite
 // direction BEFORE comparing amounts. Keep the original (i,j) visit order:
 // stable equal-score matches must retain the existing ambiguity policy.
 const indexedDays=new Map(),dayNumber=t=>Date.parse(t.date+'T12:00:00Z')/86400000;
 for(let j=0;j<candidateRows.length;j++){
  const t=candidateRows[j];
  if(!['in','out'].includes(t.cashDirection))continue;
  const id=dayNumber(t)+'|'+t.cashDirection;
  if(!indexedDays.has(id))indexedDays.set(id,[]);
  indexedDays.get(id).push(j);
 }
 const candidates=[];
 for(let i=0;i<candidateRows.length;i++){
  const a=candidateRows[i];
  if(!['in','out'].includes(a.cashDirection))continue;
  const other=a.cashDirection==='in'?'out':'in',day=dayNumber(a),near=[];
  for(let offset=-5;offset<=5;offset++)
   for(const j of indexedDays.get((day+offset)+'|'+other)||[])
    if(j>i)near.push(j);
  near.sort((x,y)=>x-y);
  for(const j of near){
  const b=candidateRows[j];
  if(a.accountId===b.accountId||a.cashDirection===b.cashDirection||
     !['in','out'].includes(a.cashDirection)||!['in','out'].includes(b.cashDirection)||
     Math.abs(Number(a.amount)-Number(b.amount))>.011||days(a.date,b.date)>5)continue;
  const aTransfer=['card_payment','internal_transfer'].includes(a.accountingKind);
  const bTransfer=['card_payment','internal_transfer'].includes(b.accountingKind);
  if(!aTransfer&&!bTransfer)continue;
  // A clearly identified merchant refund is a card credit, NOT the incoming
  // leg of a checking-to-card settlement, even if a coincidentally equal
  // transfer posted on another account within the matching window.
  if(a.accountingKind==='refund'||b.accountingKind==='refund')continue;
  const aCard=a.accountType==='credit',bCard=b.accountType==='credit';
  const card=a.accountingKind==='card_payment'||b.accountingKind==='card_payment'||aCard!==bCard&&(aCard||bCard);
  const priority=(aTransfer?2:0)+(bTransfer?2:0)+(card?2:0);
  candidates.push({a,b,card,priority,delta:days(a.date,b.date)});
  }
 }
 const assigned=new Set();
 const byRow=new Map();
 for(const c of candidates){
  for(const t of [c.a,c.b]){
   if(!byRow.has(t.id))byRow.set(t.id,[]);
   byRow.get(t.id).push(c);
  }
 }
 // Only uniquely resolvable counterparts are linked. Never guess if two card
 // accounts have indistinguishable same-dollar payment credits.
 for(const c of candidates.sort((a,b)=>b.priority-a.priority||a.delta-b.delta)){
  if(assigned.has(c.a.id)||assigned.has(c.b.id))continue;
  const eligible=t=>{
   const list=(byRow.get(t.id)||[]).filter(x=>!assigned.has(x.a.id)&&!assigned.has(x.b.id));
   const best=Math.max(...list.map(x=>x.priority));
   const tied=list.filter(x=>x.priority===best).sort((x,y)=>x.delta-y.delta);
   return tied.length===1||tied[0]===c&&(tied.length===1||tied[1].delta>c.delta);
  };
  if(!eligible(c.a)||!eligible(c.b))continue;
  assigned.add(c.a.id);assigned.add(c.b.id);
  const group='transfer|'+[String(c.a.id),String(c.b.id)].sort().map(encodeURIComponent).join('|');
  for(const [t,peer] of [[c.a,c.b],[c.b,c.a]]){
   t.accountingKind=c.card?'card_payment':'internal_transfer';
   t.transferGroupId=group;t.pairedTransactionId=peer.id;
   t.reconciliationStatus='matched';t.classificationConfidence='Matched accounts';
  }
 }
 const purchases=output.filter(t=>t.accountingKind==='purchase');
 // A bank credit may have no literal 'refund' in its merchant description.
 // Identify it only against a UNIQUE same-card posted purchase by merchant
 // within 120 days; a generic adjustment without return evidence remains
 // unclassified and cannot silently lower the next card payment.
 for(const t of output)if(t.accountingKind==='unclassified_card_credit'&&
  iso(t.date)&&!t.pending){
  const original=cleanedRefundMerchant(t.merchant);
  const candidates=original?purchases.filter(p=>
   p.accountId===t.accountId&&cleanedRefundMerchant(p.merchant)===original&&
   p.date<=t.date&&days(p.date,t.date)<=120&&!p.pending):[];
  if(candidates.length===1){
   t.accountingKind='refund';
   t.classificationConfidence='Matched single merchant purchase';
  }
 }
 for(const t of output){
  if(['card_payment','internal_transfer'].includes(t.accountingKind)){
   if(t.reconciliationStatus!=='matched'){
    t.reconciliationStatus=(byRow.get(t.id)||[]).length?'ambiguous':'unmatched';
    t.classificationConfidence=t.reconciliationStatus==='ambiguous'?'Needs review':'Description';
   }
   t.type='transfer';
  }else if(t.accountingKind==='refund'){
   t.type='refund';
   // A verifiable same-account matching purchase is enough to recover a refund's
   // category; otherwise retain the bank category / user override for review.
   if((!t.category||t.category==='Other')&&iso(t.date)){
    const target=cleanedRefundMerchant(t.merchant);
    const possibilities=purchases.filter(p=>p.accountId===t.accountId&&
     cleanedRefundMerchant(p.merchant)===target&&p.date<=t.date&&days(p.date,t.date)<=120);
    possibilities.sort((a,b)=>b.date.localeCompare(a.date));
    if(possibilities.length===1)t.category=state?.categoryOverrides?.[possibilities[0].id]||possibilities[0].category||'Other';
    else if(possibilities.length>1){t.reconciliationStatus='needs-review';t.classificationConfidence='Multiple possible refund purchases';}
   }
  }else if(t.accountingKind==='unclassified_card_credit'){
   // Still unproven after transfer pairing and merchant matching: surface
   // a positive credit for review, without guessing that it is a refund or
   // decreasing the card statement estimate for a possible payment.
   t.type='transfer';t.reconciliationStatus='needs-review';
   t.classificationConfidence='Card credit — confirm refund versus payment';
  }else if(t.accountingKind==='purchase'||t.accountingKind==='loan_payment')t.type='expense';
  else if(t.accountingKind==='income')t.type='income';
  else {t.type='transfer';t.reconciliationStatus='needs-review'}
  if(!t.pending){
   if(t.type==='expense')t.spendingAmount=round(Number(t.amount)||0);
   if(t.type==='refund')t.spendingAmount=round(-Number(t.amount)||0);
   if(t.type==='income')t.earnedIncomeAmount=round(Number(t.amount)||0);
  }
 }
 const issues=output.filter(t=>['ambiguous','unmatched','needs-review'].includes(t.reconciliationStatus)).map(t=>({
  id:t.id,accountId:t.accountId,date:t.date,merchant:t.merchant,amount:t.amount,
  status:t.reconciliationStatus,kind:t.accountingKind,
  reason:t.reconciliationStatus==='ambiguous'?'Several plausible transfer counterparts: confirm manually':
   t.reconciliationStatus==='unmatched'?'Transfer counterpart not found: verify account coverage':
   t.accountingKind==='refund'?'Multiple possible source purchases: confirm refund category':
   'Accounting classification requires confirmation'
 }));
 return {accounts:registry,transactions:output,issues,summary:{
  spending:round(output.reduce((s,t)=>s+t.spendingAmount,0)),
  income:round(output.reduce((s,t)=>s+t.earnedIncomeAmount,0)),
  refunds:round(output.filter(t=>t.type==='refund').reduce((s,t)=>s+Number(t.amount||0),0)),
  matchedTransfers:output.filter(t=>t.pairedTransactionId).length/2,
  unmatchedTransfers:output.filter(t=>t.type==='transfer'&&t.reconciliationStatus==='unmatched').length,
  needsReview:output.filter(t=>t.reconciliationStatus==='ambiguous'||t.reconciliationStatus==='needs-review').length
 }};
}
// The private Plaid adapter and all statement/report readers share this
// classification boundary. The provider's signed amount and source metadata
// remain immutable; reconciliation later adds paired-transfer evidence.
function classifyPlaidSource({amount,merchant,description,pfc},account,categorization){
 const name=String(merchant||''),bankNarrative=name+' '+String(description||name),
  code=String(pfc?.primary||'').toUpperCase(),lower=bankNarrative.toLowerCase(),
  incoming=Number(amount)<0,card=account?.type==='credit';
 const obligation=categorization?.loanBill?.({merchant:name,personal_finance_category:pfc});
 const payment=/\b(payment thank you|autopay payment|payment received|credit card payment|card payment|payment to .*card)\b/i.test(bankNarrative)||
   code==='LOAN_PAYMENTS'&&obligation?.isCardSettlement;
 const earned=incoming&&!card&&recognizedIncome({
  merchant:name,personal_finance_category:pfc,source:{plaidAmount:amount}
 },account);
 const transfer=!earned&&(/^(?:TRANSFER_IN|TRANSFER_OUT)$/.test(code)||
  lower.includes('transfer to ')||lower.includes('transfer from ')||payment);
 return {incoming,transfer,type:transfer?'transfer':
  incoming&&(card||obligation?.isBill)?'refund':incoming?'income':'expense'};
}

// One signed, integer-cent reporting contract. Reconciliation classifies
// purchases/refunds/transfers first; selectors use these measures rather than
// independently deciding whether an item is spending or earned income.
function cardActivityCents(row){
 if(!row||row.pending||row.pairedTransactionId||
  ['card_payment','internal_transfer'].includes(row.accountingKind)||
  !['expense','refund'].includes(row.type))return 0;
 const value=Math.round(Math.abs(Number(row.amount))*100);
 if(!Number.isFinite(value))return 0;
 return row.type==='refund'?-value:value;
}
function categorizedOutflowCents(t){
 if(!t||t.pending||t.pairedTransactionId||t.type!=='transfer'||
    t.cashDirection!=='out'||t.method!=='manual'||
    t.reconciliationStatus==='ambiguous'||
    ['card_payment','unclassified_card_credit'].includes(t.accountingKind)||
    t.accountType==='credit'||t.accountType==='loan'||
    ['Uncategorized','Income','Transfer','Savings'].includes(String(t.category||'')))
  return 0;
 const value=Math.round(Number(t.amount)*100);
 return Number.isFinite(value)&&value>0?value:0;
}
function reportingMeasures(row,settlements){
 const settled=Boolean(row&&settlements?.has(String(row.id))),
  purchaseCents=settled?0:cardActivityCents(row),
  manualOutflowCents=settled?0:categorizedOutflowCents(row),
  provisionalPendingSpendingCents=!settled&&row?.pending?
   cardActivityCents({...row,pending:false}):0;
 let postedIncomeCents=0;
 if(row&&!row.pending&&!row.pairedTransactionId&&row.type==='income'&&
    !['card_payment','internal_transfer'].includes(row.accountingKind)){
  const value=Math.round(Math.abs(Number(row.amount))*100);
  if(Number.isSafeInteger(value))postedIncomeCents=value;
 }
 return {purchaseCents,manualOutflowCents,
  postedSpendingCents:purchaseCents+manualOutflowCents,
  provisionalPendingSpendingCents,postedIncomeCents};
}
// A card repayment or an internal account transfer never creates a second
// expense in forecast reports; the canonical balance engine owns its legs.
function forecastSpendingCents(event){
 if(event?.kind!=='event'||!['expense','refund'].includes(event.type)||
  event.transferGroupId)return 0;
 const value=Math.round(Number(event.amount)*100);
 return Number.isSafeInteger(value)&&value>0?(event.type==='refund'?-value:value):0;
}

// A generic payment reference is not enough to infer a checking-to-card
// settlement. It must match ONE opposite-side card credit by amount/date.
function budgetCardSettlementIds(rows){
 const ids=new Set(),cardCredits=new Map(),cashDebits=[];
 const cents=t=>Math.round(Number(t.amount)*100),
  day=t=>Date.parse(String(t.date||'')+'T12:00:00Z'),
  matched=t=>Boolean(t.pending||t.pairedTransactionId),
  isIn=t=>t.cashDirection==='in'&&t.accountType==='credit'&&
   ['card_payment','internal_transfer','unclassified_card_credit'].includes(t.accountingKind),
  isOut=t=>t.cashDirection==='out'&&t.accountType!=='credit'&&
   t.accountType!=='loan'&&['expense','transfer'].includes(t.type),
  paymentHint=t=>{
   const source=String(t.merchant||'')+' '+String(t.description||'') ,
    pfc=t.personal_finance_category||t.source?.personalFinanceCategory||{},
    category=String(pfc.detailed||'').toUpperCase();
   return /\b(?:payment|pmt|pymt|autopay|auto\s?pay|bill\s?pay|paybill|e-?pay)\b/i.test(source)||
    /CREDIT_CARD_PAYMENT|CARD_PAYMENT/.test(category);
  };
 for(const row of rows||[]){
  if(!row||matched(row)||!Number.isFinite(cents(row))||cents(row)<=0||
     !Number.isFinite(day(row)))continue;
  if(isIn(row)){
   if(!cardCredits.has(cents(row)))cardCredits.set(cents(row),[]);
   cardCredits.get(cents(row)).push(row);
  }else if(isOut(row)&&paymentHint(row))cashDebits.push(row);
 }
 const choices=new Map();
 for(const debit of cashDebits){
  const matches=(cardCredits.get(cents(debit))||[]).filter(credit=>
   credit.accountId!==debit.accountId&&Math.abs(day(credit)-day(debit))<=5*86400000);
  if(matches.length===1){
   const credit=matches[0],key=String(credit.id);
   if(!choices.has(key))choices.set(key,[]);
   choices.get(key).push(debit);
  }
 }
 for(const [id,matches] of choices)if(matches.length===1){
  ids.add(String(matches[0].id));ids.add(id);
 }
 return ids;
}
const api={accountType,registerAccounts,accountsFor,reconcile,recognizedIncome,
 classifyPlaidSource,cardActivityCents,categorizedOutflowCents,
 reportingMeasures,forecastSpendingCents,budgetCardSettlementIds};
root.HouseholdAccounting=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
