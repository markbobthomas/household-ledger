'use strict';
const assert=require('node:assert/strict');
const AI=require('../pilot/category-ai-automation.cjs');
const priceNote='Cost preflight is a maximum for a fixed deployed model rate, not a guarantee of billing.';
const account={id:'fictional-checking',itemId:'fictional-item',name:'Fictional account',
 type:'depository',subtype:'checking'};
const make=(i,merchant='Fictional Marketplace')=>({
 id:'fictional-item-'+i,accountId:account.id,date:'2026-11-19',
 amount:11+i*.01,name:merchant,merchant,pending:false,category:null
});
const transactions=Object.fromEntries(Array.from({length:92},(_,i)=>{
 const t=make(i);return[t.id,t];
}));
const base={transactions,accounts:[account],ledgerAdjustments:{
 categoryAutomation:{automatic:false,ai:true},predictions:{}
}};
const p=AI.plan(base);
assert.equal(p.count,92,'All unconfirmed purchases remain eligible with rules off');
assert.equal(p.batches.reduce((n,b)=>n+b.rows.length,0),92,'Batching loses no purchases');
assert.equal(new Set(p.batches.flatMap(b=>b.rows.map(r=>r.key))).size,92,'No duplicate charge keys');
assert.ok(p.maximumUsd>0&&p.maximumUsd<1,priceNote);
assert.ok(p.batches.every(b=>b.maximumUsd>0&&b.maximumUsd<0.05),
 'Every request has a bounded preflight maximum');
const marked=structuredClone(base);
marked.ledgerAdjustments.categoryAiChecks={
 [AI.qualified(transactions['fictional-item-0'])]:{status:'unable'},
 [AI.qualified(transactions['fictional-item-1'])]:{status:'suggested',category:'Shopping'},
 [AI.qualified(transactions['fictional-item-2'])]:{status:'pending'},
 [AI.qualified(transactions['fictional-item-3'])]:{status:'interrupted'}
};
assert.equal(AI.plan(marked).count,88,'Reviewed, suggested, pending and unknown-outcome calls never re-bill');
const manually=structuredClone(marked);
manually.ledgerAdjustments.categoryOverrides={'fictional-item-4':'Groceries'};
manually.ledgerAdjustments.categoryProvenance={'fictional-item-4':{source:'manual',category:'Groceries'}};
assert.equal(AI.plan(manually).count,87,'Human-confirmed purchases are excluded');
manually.ledgerAdjustments.categoryAutomation.automatic=true;
assert.ok(AI.plan(manually).count<=87,'Rules-on is not more permissive than manual-review mode');
const batch=p.batches[0],cats=p.mode&&AI.eligible(base).categories;
const choices=batch.rows.map((row,i)=>({
 i,category:i===0?'Groceries':null,confidence:i===0?'high':'low'
}));
const result=AI.parseResponse({
 status:'completed',output:[{type:'message',content:[{
  type:'output_text',text:JSON.stringify({choices})
 }]}]
},batch,cats);
assert.equal(result.length,batch.rows.length,'Response includes every input');
assert.equal(result[0].category,null,'A generic marketplace without exact product evidence must abstain');
assert.equal(result[1].category,null);
assert.throws(()=>AI.parseResponse({status:'completed',output:[{
 type:'message',content:[{type:'output_text',text:'{"choices":[]}'}]
}]},batch,cats),/omitted/,'Truncated output must not be marked reviewed');
const caught=AI.plan({...base,ledgerAdjustments:{
 ...base.ledgerAdjustments,categoryAutomation:{automatic:false,ai:false}
}});
assert.equal(caught.mode.ai,false,'AI OFF persists separately from automatic categorization');
console.log('AI categorization planning: budget, all-purchase batches, abstention memory, human choices, strict output PASS');
