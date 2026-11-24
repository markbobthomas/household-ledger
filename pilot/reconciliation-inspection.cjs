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
module.exports={inspect};
