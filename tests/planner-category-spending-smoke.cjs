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
const source=fixture.transactions.map(t=>({id:t.id,category:t.category,type:t.type,amount:t.amount}));
assert.deepEqual(fixture.transactions.map(t=>({id:t.id,category:t.category,type:t.type,amount:t.amount})),source,
 'Reporting classification never changes the bank source');
console.log('PASS categorized external outflows count once, paired/card/incoming/pending transfers excluded');
