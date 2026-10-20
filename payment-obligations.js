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
function build(snapshot,records=[],expected=[],predictions={},options={}){
 const asOf=String(snapshot.asOf||''),days=options.days||90,through=shift(asOf,days);
 if(!date(asOf))throw Error('Missing as-of date');
 const accounts=snapshot.accounts||[],byId=new Map(accounts.map(a=>[String(a.id),a]));
 const cards=predictions.paymentRules||{},bills=predictions.paymentBills||[];
 const plans=[],billEvents=[],obligations=[],warnings=[],statements=[],suppressedExpectedIds=[];
 const matchesAccount=(row,account)=>{
  const key=String(row.accountId||row.account||''),id=String(account.id);
  if(key===id)return true;
  const aliases=accounts.filter(a=>String(a.name)===key||String(a.transactionAccount||'')===key);
  return aliases.length===1&&aliases[0].id===id;
 };
 for(const [id,rule] of Object.entries(cards)){
  const card=byId.get(id),from=byId.get(String(rule.fromAccountId||''));
  if(!card||!credit(card)||!from||!cash(from)){
   warnings.push((card?.name||id)+': choose a connected checking/savings payment source');continue;
  }
  if(!date(rule.nextPaymentDate)||!date(rule.lastStatementClose)||!Number.isInteger(Number(rule.closingDay))||
   Number(rule.closingDay)<1||Number(rule.closingDay)>31||!validAmount(rule.lastStatementBalance)){
   warnings.push(card.name+': statement amount, close date or payment date needs confirmation');continue;
  }
  const method=rule.method||'statement';
  if(!['statement','minimum','fixed'].includes(method)||method==='minimum'&&!validAmount(rule.minimumAmount)||
   method==='fixed'&&!validAmount(rule.fixedAmount)){
   warnings.push(card.name+': invalid autopay amount or method');continue;
  }
  const lastClose=rule.lastStatementClose,amount0=Number(method==='statement'?rule.lastStatementBalance:
   method==='minimum'?rule.minimumAmount:rule.fixedAmount);
  if(rule.nextPaymentDate<=lastClose){warnings.push(card.name+': payment date must follow the statement close');continue}
  for(let n=0;n<=12;n++){
   const due=plus(rule.nextPaymentDate,n);
   if(due>through)break;
   if(due<=asOf)continue;
   const cycleClose=n===0?lastClose:closeFor(plus(lastClose,n).slice(0,7),rule.closingDay);
   const prevClose=n===0?closeFor(plus(lastClose,-1).slice(0,7),rule.closingDay):
    closeFor(plus(lastClose,n-1).slice(0,7),rule.closingDay);
   const cycleRows=records.filter(t=>t.accountId===id&&!t.pending&&t.date>prevClose&&t.date<=cycleClose&&
     ['expense','refund'].includes(t.type));
   const bankPurchases=round(cycleRows.reduce((sum,t)=>sum+(t.type==='refund'?-Number(t.amount):Number(t.amount)),0));
   const futureCharges=round(expected.filter(t=>matchesAccount(t,card)&&t.date>prevClose&&
     t.date<=cycleClose&&['expense','refund'].includes(t.type)).reduce((sum,t)=>sum+(t.type==='refund'?-Number(t.amount):Number(t.amount)),0));
   const calculated=round(Math.max(0,bankPurchases+futureCharges));
   // Never falsely claim a statement is verified by transactions. Carry the
   // last confirmed amount as a deliberately conservative planning floor.
   const estimated=Math.max(calculated,Number(rule.lastStatementBalance));
   const amount=round(n===0?amount0:method==='statement'?estimated:amount0);
   const confidence=n===0?'entered statement / review required':'estimate, not a bank-issued statement';
   const actualDue=plus(String(rule.nextDueDate||rule.nextPaymentDate),n);
   if(due>actualDue)warnings.push(card.name+': planned bank withdrawal '+due+' is after the card due date '+actualDue);
   const statement={cardId:id,cardName:card.name,fromAccountId:from.id,fromName:from.name,
    dueDate:actualDue,withdrawalDate:due,closingDate:cycleClose,amount,statementBalance:n===0?Number(rule.lastStatementBalance):calculated,
    bankPurchases,estimatedCharges:futureCharges,method,confidence,confirmed:n===0,estimated:n>0};
   statements.push(statement);
   // Each card payment appears exactly once as one two-legged transfer.
   if(amount>0){
    const plan={id:'autopay|'+id+'|'+due,fromAccountId:from.id,toAccountId:id,
     anchorDate:due,amount,frequency:'once',status:'scheduled',origin:'card-autopay'};
    plans.push(plan);
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
    type:'expense',amount,date:due,merchant:label,category:b.category||'Housing',source:'owner-bill'};
   billEvents.push(e);
   obligations.push({id:e.id,date:due,amount,fromAccountId:account.id,merchant:label,
    kind:'automatic_bill',confidence:'entered schedule / amount estimate'});
  }
 }
 return {plans,billEvents,suppressedExpectedIds,obligations:obligations.sort((a,b)=>a.date.localeCompare(b.date)),warnings,statements};
}
const api={build,plus,closeFor};
root.HouseholdPaymentObligations=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
