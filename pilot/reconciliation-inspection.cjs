'use strict';
// Authenticated, read-only source reconciliation proof. No bank identifier,
// merchant narrative, source transaction ID or personal preference is returned.
// Unlike a bank's "posted" status, a verified payment requires two symmetric
// canonical source links, opposite directions, exact cents, and a card/cash pair.
const iso=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 !Number.isNaN(Date.parse(d+'T12:00:00Z'))&&
 new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const cents=v=>Number.isFinite(Number(v))?Math.round(Number(v)*100):NaN;
const epoch=d=>Date.parse(d+'T12:00:00Z');
function inspect(prepared,date){
 if(!iso(date))throw Error('Valid ISO date is required');
 const records=prepared?.bundle?.rows;
 if(!Array.isArray(records))throw Error('Canonical derived source records are unavailable');
 const byId=new Map(records.filter(r=>r&&r.id!=null).map(r=>[String(r.id),r]));
 const isBankType=t=>['checking','savings','credit'].includes(t.accountType);
 const isPaymentRelevant=t=>t.type==='transfer'&&
  (t.cashDirection==='out'&&['checking','savings'].includes(t.accountType)||
   t.cashDirection==='in'&&t.accountType==='credit');
 const rows=records.filter(t=>t&&!t.pending&&iso(t.date)&&t.date===date&&
  isBankType(t)&&isPaymentRelevant(t));
 const entries=rows.slice(0,60).map(t=>{
  const other=t.pairedTransactionId==null?null:byId.get(String(t.pairedTransactionId));
  const reciprocal=Boolean(other&&other.pairedTransactionId!=null&&
   String(other.pairedTransactionId)===String(t.id)&&
   other.accountId!==t.accountId&&other.type==='transfer'&&!other.pending&&
   cents(other.amount)===cents(t.amount)&&cents(t.amount)>0&&
   iso(other.date)&&Math.abs(epoch(other.date)-epoch(t.date))<=5*86400000);
  const card=t.accountType==='credit'?t:other;
  const cash=t.accountType==='credit'?other:t;
  const verifiedCardPayment=Boolean(reciprocal&&card&&cash&&
   card.accountType==='credit'&&card.cashDirection==='in'&&
   ['checking','savings'].includes(cash.accountType)&&cash.cashDirection==='out'&&
   card.accountingKind==='card_payment'&&cash.accountingKind==='card_payment');
  return {accountType:t.accountType,cashDirection:t.cashDirection,
   amount:cents(t.amount)/100,accountingKind:String(t.accountingKind||'unknown'),
   reconciliationStatus:String(t.reconciliationStatus||'unknown'),
   paired:t.pairedTransactionId!=null,reciprocal,verifiedCardPayment};
 });
 return {date,asOf:String(prepared.asOf||''),source:'canonical-derived-posted',
  rowsOnDate:rows.length,truncated:rows.length>entries.length,
  verifiedCardPaymentLegs:entries.filter(x=>x.verifiedCardPayment).length,
  entries};
}
// Full-history conservative source audit. Source identifiers remain in server
// memory; authenticated callers receive only aggregate counts and warnings.
// A bank's Posted label alone is NEVER evidence of a paired transfer.
function auditAll(prepared){
 const records=prepared?.bundle?.rows;
 if(!Array.isArray(records))throw Error('Canonical derived source records are unavailable');
 const posted=records.filter(t=>t&&!t.pending&&iso(t.date)&&
  Number.isSafeInteger(cents(t.amount))&&cents(t.amount)>0);
 const byId=new Map(posted.filter(t=>t.id!=null).map(t=>[String(t.id),t]));
 const seen=new Set();
 const bankCash=t=>t&&['checking','savings'].includes(t.accountType);
 const isCard=t=>t&&t.accountType==='credit';
 const kind=(a,b)=>{
  if(!a||!b||String(a.accountId)===String(b.accountId)||
     a.cashDirection===b.cashDirection||
     cents(a.amount)!==cents(b.amount)||
     Math.abs(epoch(a.date)-epoch(b.date))>5*86400000||
     a.type!=='transfer'||b.type!=='transfer')return null;
  if(Boolean(isCard(a))!==Boolean(isCard(b))){
   const card=isCard(a)?a:b,cash=isCard(a)?b:a;
   return card.accountingKind==='card_payment'&&
    cash.accountingKind==='card_payment'&&
    card.cashDirection==='in'&&cash.cashDirection==='out'&&
    bankCash(cash)?'card':null;
  }
  const out=a.cashDirection==='out'?a:b,incoming=a.cashDirection==='in'?a:b;
  return bankCash(out)&&bankCash(incoming)&&
   out.accountingKind==='internal_transfer'&&
   incoming.accountingKind==='internal_transfer'?'internal':null;
 };
 let matchedCardPaymentPairs=0,matchedInternalTransferPairs=0,missingOrBrokenPairLinks=0;
 for(const t of posted){
  if(t.pairedTransactionId==null||seen.has(String(t.id)))continue;
  const other=byId.get(String(t.pairedTransactionId));
  const reciprocal=other&&other.pairedTransactionId!=null&&
   String(other.pairedTransactionId)===String(t.id);
  const classification=reciprocal?kind(t,other):null;
  if(!classification){
   missingOrBrokenPairLinks++;seen.add(String(t.id));continue;
  }
  seen.add(String(t.id));seen.add(String(other.id));
  if(classification==='card')matchedCardPaymentPairs++;
  else matchedInternalTransferPairs++;
 }
 const unpaired=posted.filter(t=>t.pairedTransactionId==null);
 const outgoing=unpaired.filter(t=>bankCash(t)&&t.cashDirection==='out'&&
  ['card_payment','internal_transfer'].includes(t.accountingKind));
 const incoming=unpaired.filter(t=>t.cashDirection==='in'&&
  (isCard(t)?['unclassified_card_credit','card_payment'].includes(t.accountingKind):
   bankCash(t)&&['unclassified_credit','internal_transfer'].includes(t.accountingKind)));
 const candidates=new Map();
 for(const debit of outgoing){
  const possibilities=incoming.filter(credit=>credit.accountId!==debit.accountId&&
   cents(credit.amount)===cents(debit.amount)&&
   Math.abs(epoch(credit.date)-epoch(debit.date))<=5*86400000&&
   (isCard(credit)&&debit.accountingKind==='card_payment'||
    bankCash(credit)&&debit.accountingKind==='internal_transfer'));
  if(possibilities.length!==1)continue;
  const id=String(possibilities[0].id);
  if(!candidates.has(id))candidates.set(id,[]);
  candidates.get(id).push(debit);
 }
 // These are not automatically promoted: same amount/date can coincide.
 const possibleMissedPairs=[...candidates.values()].filter(x=>x.length===1).length;
 return {source:'canonical-derived-posted',asOf:String(prepared.asOf||''),
  totalPosted:posted.length,
  matchedCardPaymentPairs,matchedInternalTransferPairs,
  unmatchedCardPaymentLegs:unpaired.filter(t=>t.accountingKind==='card_payment').length,
  unmatchedInternalTransferLegs:unpaired.filter(t=>t.accountingKind==='internal_transfer').length,
  unclassifiedCardCredits:unpaired.filter(t=>t.accountingKind==='unclassified_card_credit').length,
  unclassifiedCashCredits:unpaired.filter(t=>t.accountingKind==='unclassified_credit').length,
  refunds:posted.filter(t=>t.accountingKind==='refund').length,
  duplicateSourceIds:posted.length-byId.size,
  missingOrBrokenPairLinks,possibleMissedPairs,
  note:'Possible matching legs are review hints only; no financial data was edited'};
}
module.exports={inspect,auditAll};
