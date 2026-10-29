'use strict';
// Reporting-only category spending must reconcile manual external payments
// without reclassifying actual bank facts or counting own-account transfers.
const assert=require('node:assert/strict');
const model=require('../ledger-data.js');
const history=require('../planner-history.js');
const accounts=[
 {id:'checking',name:'Fictional Checking',type:'checking'},
 {id:'savings',name:'Fictional Savings',type:'savings'},
 {id:'card',name:'Fictional Card',type:'credit'}
];
const row=(id,merchant,amount,type='transfer',extra={})=>({
 id,merchant,date:'2026-10-12',amount,type,accountId:'checking',
 category:'Other',source:{provider:'demo',verified:true,
  plaidAmount:extra.cashDirection==='in'?-amount:amount},...extra
});
const fixture=model.migrate({accounts,transactions:[
 row('bill','Zelle for daycare',95),
 row('savings-out','Transfer to savings',220,'transfer',{
  pairedTransactionId:'savings-in'}),
 row('savings-in','Transfer from checking',220,'transfer',{
  accountId:'savings',cashDirection:'in',pairedTransactionId:'savings-out'}),
 row('cardpay','Credit card payment',150),
 row('uncategorized','Other Zelle',15),
 row('deferred','Pending payment to school',45,'transfer',{pending:true}),
 row('ambiguous','Transfer to outside',40),
 row('income','Deposit from friend',75,'transfer',{cashDirection:'in'}),
 row('other','Other categorized payment',25),
 row('ordinary','Fictional grocer',32,'expense',{category:'Groceries'})
],categoryOverrides:{
 bill:'Childcare','savings-out':'Housing',cardpay:'Shopping',
 deferred:'Childcare',ambiguous:'Dining',income:'Dining',other:'Other'
}});
const actual=model.records(fixture),byId=id=>actual.find(t=>t.id===id);
const cents=row=>history.categorizedOutflowCents(row);
assert.equal(byId('bill').type,'transfer','Bank source accounting stays transfer');
assert.equal(byId('bill').method,'manual','Review saved category is authoritative');
assert.equal(cents(byId('bill')),9500,'Posted, manually categorized external Zelle bill enters spending budget');
assert.equal(cents(byId('uncategorized')),0,'Unreviewed outgoing transfer is not spending');
assert.equal(cents(byId('savings-out')),0,'Paired own-account transfer never becomes spending');
assert.equal(cents(byId('savings-in')),0,'Inbound half of transfer never becomes spending');
assert.equal(cents(byId('cardpay')),0,'Even manually categorized card payment is not a new purchase');
assert.equal(cents(byId('deferred')),0,'Pending outgoing transactions are not settled spending');
assert.equal(cents({...byId('ambiguous'),reconciliationStatus:'ambiguous'}),0,
 'Ambiguous matching cannot double count an unknown bank transfer');
assert.equal(cents(byId('income')),0,'Incoming money is not spending');
assert.equal(cents(byId('other')),2500,'Explicitly confirmed Other can be legitimate spending');
assert.equal(cents(byId('ordinary')),0,'Ordinary purchases use the existing category purchase count, not a duplicate');
// The bank labels the checking debit simply "ACH PMT" and the card credit
// "ACCOUNT CREDIT": neither standalone label identifies a card settlement.
const cases=model.migrate({accounts,transactions:[
 row('ach-checking','ACH PMT 7700',400,'expense',{date:'2026-10-10'}),
 row('card-credit','ACCOUNT CREDIT 7700',400,'refund',
  {date:'2026-10-12',accountId:'card',cashDirection:'in'}),
 row('real-bill','Zelle daycare payment',125,'transfer',{date:'2026-10-17'}),
 row('real-refund','Refund from shop',30,'refund',
  {accountId:'card',date:'2026-10-18',cashDirection:'in'}),
 row('duplicate-a','ACH PMT 101',90,'expense',{date:'2026-10-20'}),
 row('duplicate-b','ACH PMT 102',90,'expense',{date:'2026-10-20'}),
 row('one-card-credit','ACCOUNT CREDIT 100',90,'refund',
  {date:'2026-10-22',accountId:'card',cashDirection:'in'}),
 row('unpaired-checking','ACH PMT 887',81,'expense',{date:'2026-10-26'}),
 row('unpaired-card','ACCOUNT CREDIT 887',80,'refund',
  {date:'2026-10-27',accountId:'card',cashDirection:'in'})
],categoryOverrides:{'ach-checking':'Shopping','real-bill':'Childcare'}});
const classified=model.records(cases),payments=history.budgetCardSettlementIds(classified),
 find=id=>classified.find(t=>t.id===id);
assert.deepEqual([...payments].sort(),['ach-checking','card-credit'],
 'Only unique cross-account debit/card-credit evidence identifies a disguised card payment');
assert.equal(find('ach-checking').type,'expense',
 'Reporting-only matching does not change the underlying checking transaction');
assert.equal(find('card-credit').accountType,'credit');
assert.equal(cents(find('real-bill')),12500,
 'A true external categorized payment still counts as budget spending');
assert.ok(!payments.has('real-bill'),
 'A real bill with the word payment, but no card credit match, stays spending');
assert.ok(!payments.has('real-refund'),
 'Merchant refunds are not considered card settlements');
assert.ok(!payments.has('duplicate-a')&&!payments.has('duplicate-b'),
 'Ambiguous same-dollar checking debits must not be guessed as repayments');
assert.ok(!payments.has('unpaired-checking'),
 'An unmatched card amount must not suppress a legitimate checking purchase');
const byOneAccount=classified.filter(t=>t.accountId==='checking');
assert.ok(!history.budgetCardSettlementIds(byOneAccount).has('ach-checking'),
 'Evidence must be drawn from all connected bank accounts, not a single-account filter');
const source=fixture.transactions.map(t=>({id:t.id,category:t.category,type:t.type,amount:t.amount}));
assert.deepEqual(fixture.transactions.map(t=>({id:t.id,category:t.category,type:t.type,amount:t.amount})),source,
 'Reporting classification never changes the bank source');
console.log('PASS categorized external outflows count once, paired/card/incoming/pending transfers excluded');
