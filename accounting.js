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
 const dir=direction(t),isCard=account?.type==='credit';
 const payment=cardPayment.test(name)||isCard&&/\b(?:payment|autopay|pymt)\b/i.test(name)||
   cardIssuer.test(name)&&/\b(?:payment|autopay|pymt)\b/i.test(name);
 if(payment)return 'card_payment';
 // Plaid can code mortgage/loan withdrawals as LOAN_PAYMENTS. They are external
 // bills leaving checking, not transfers between connected household accounts.
 // This also reinterprets existing read-only records imported as "transfer".
 const obligation=root.HouseholdCategorization?.loanBill?.(t);
 if(!isCard&&account?.type!=='loan'&&obligation?.isBill){
  if(dir==='out')return 'loan_payment';
  if(dir==='in')return 'refund'; // A returned loan payment is never earned income.
 }
 if(recognizedIncome(t,account))return 'income';
 // Merchant refunds remain card credits even when Plaid calls them
 // TRANSFER_IN, or the imported row was initially labeled a transfer.
 // Bank-matched card settlements were classified above as card_payment.
 if(dir==='in'&&(refundText.test(name)||t.type==='refund'))return 'refund';
 if(transferText.test(name))return 'internal_transfer';
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
   // An incoming card credit that did not match a card-settlement pair is
   // positive card activity, never household income or a debit. Include it
   // as a refund (lowering statement purchases and card debt) while keeping
   // its uncertain purpose visible for review.
   t.type='refund';t.reconciliationStatus='needs-review';
   t.classificationConfidence='Unlabeled card credit — confirm refund versus payment';
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
const api={accountType,registerAccounts,accountsFor,reconcile,recognizedIncome};
root.HouseholdAccounting=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
