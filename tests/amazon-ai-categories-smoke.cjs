'use strict';
const assert=require('node:assert/strict');
const Ai=require('../pilot/amazon-ai-categories.cjs');
const Imp=require('../pilot/amazon-import.cjs');
const {keyFor}=require('../pilot/amazon-pairing.cjs');
const html=require('node:fs').readFileSync(
 require('node:path').join(__dirname,'../pilot/amazon-import.html'),'utf8');
const inlineScript=html.match(/<script>([\s\S]*?)<\/script>/);
assert(inlineScript,'Amazon page must contain its UI script');
new (require('node:vm').Script)(inlineScript[1],{filename:'amazon-import.html'});
const categories=['Uncategorized','Other','Shopping','Groceries',
 'Kids & Family','Home & Maintenance','Health','Pets','Maintenance'];
// The added word-boundary patterns must match product nouns in normal titles.
assert.equal(Imp.classify('Newborn pacifier for stroller',categories),'Kids & Family');
assert.equal(Imp.classify('Fresh cookies box',categories),'Groceries');
assert.equal(Imp.classify('Electric humidifier',categories),'Maintenance');
assert.equal(Imp.classify('USB webcam',categories),'Shopping');
assert.equal(Imp.classify('Unknown ZX-9831 trademarked thing',categories),'Uncategorized');
const make=(id,note)=>({
 id,name:'AMZN MKTPLACE',merchant:'Amazon',accountId:'card-one',
 date:'2026-11-12',amount:26.50,pending:false,note
});
const rows=[
 make('a','Possible Amazon: Pet grooming brush for a cat'),
 make('b','Amazon: Camping carabiner and climbing gear'),
 make('c','Possible Amazon (date only): Pet food'),
 make('d','Amazon: Pet grooming brush for a cat'),
 make('e','Amazon: Pet grooming brush for a cat'),
 make('f','Possible Amazon: Single-use neoprene gasket 8mm')
];
const notes=Object.fromEntries(rows.map(t=>[keyFor(t),t.note]));
const adjustments={predictions:{transactionNotes:notes},
 categoryOverrides:{d:'Shopping',f:'Other'},
 amazonAllocations:{e:{orderId:'fiction',lines:[],amountCents:2650}}};
const available=Ai.eligible(Object.fromEntries(rows.map(t=>[t.id,t])),
 adjustments,categories,false);
assert.equal(available.candidates.length,2,'Only unknown eligible product Notes');
assert.deepEqual(available.candidates.map(c=>c.transactionId),['a','b']);
assert.equal(available.stats.allocated,1);
assert.equal(available.stats.alreadyAssigned,2);
assert.equal(available.stats.unsafeNote,1);
assert.equal(available.stats.importerNotes,6);
const withOther=Ai.eligible(Object.fromEntries(rows.map(t=>[t.id,t])),
 adjustments,categories,true);
assert.equal(withOther.candidates.length,3,
 'Explicit opt-in can include an Other category without touching specific categories');
assert(withOther.candidates.some(c=>c.transactionId==='f'));
const allowed=Ai.categoriesForAi(categories);
assert(!allowed.includes('Other')&&!allowed.includes('Uncategorized'));
assert.equal(Ai.refineCategory('Gate check car seat travel bag','Childcare',
 ['Kids & Family','Childcare']),'Kids & Family');
assert.equal(Ai.refineCategory('Cotton muslin burp cloth set','Childcare',
 ['Kids & Family','Childcare']),'Kids & Family');
assert.equal(Ai.refineCategory('Toy accident protection plan warranty','Kids & Family',
 ['Insurance','Kids & Family']),'Insurance');
assert.equal(Ai.refineCategory('Orthodontic toothpaste 10%','Shopping',
 ['Shopping','Healthcare']),'Healthcare');
assert.equal(Ai.refineCategory('Children chewable probiotic','Shopping',
 ['Shopping','Healthcare']),'Healthcare');
assert.equal(Ai.refineCategory('Monthly homeowner insurance premium','Insurance',
 ['Insurance','Kids & Family']),'Insurance');
assert.equal(Ai.refineCategory('Toy accident protection plan','Insurance',
 ['Insurance']),'Insurance','Do not invent categories missing from budget');

// Shared decisions across AI post-validation and deterministic bank/item paths.
const chosen=['Insurance','Healthcare','Kids & Family','Groceries','Dining','Subscriptions'];
assert.equal(Ai.refineCategory('Extended accident protection plan','Kids & Family',chosen),'Insurance');
assert.equal(Ai.refineCategory('Medical insurance premium','Insurance',chosen),'Healthcare');
assert.equal(Ai.refineCategory('Annual software subscription','Shopping',chosen),'Subscriptions');
assert.equal(Ai.refineCategory('Coffee beans subscription delivery','Subscriptions',chosen),'Groceries');
assert.equal(Ai.refineCategory('Grocery store prepared meal','Dining',chosen),'Groceries');
assert.equal(Ai.refineCategory('Coffee shop latte','Groceries',chosen),'Dining');
assert.equal(Ai.refineCategory('Generic monthly membership subscription','Subscriptions',chosen),null);
const bank=require('../categorization.js');
assert.equal(bank.pfcCategory({primary:'INSURANCE',detailed:'INSURANCE_HEALTH'}),'Healthcare');
assert.equal(bank.pfcCategory({primary:'INSURANCE',detailed:'INSURANCE_HOME'}),'Insurance');
assert.equal(bank.pfcCategory({primary:'SUBSCRIPTIONS',detailed:'SUBSCRIPTIONS_OTHER'}),null);
assert.equal(bank.pfcCategory({primary:'SUBSCRIPTIONS',detailed:'SUBSCRIPTIONS_DIGITAL_STREAMING'}),'Subscriptions');
assert.equal(bank.classify({merchant:'Starbucks',type:'expense',
 personal_finance_category:{primary:'FOOD_AND_DRINK',detailed:'FOOD_AND_DRINK_GROCERIES',confidence_level:'HIGH'}}).category,'Dining');
assert.equal(bank.classify({merchant:'Safeway prepared meal',type:'expense',
 personal_finance_category:{primary:'FOOD_AND_DRINK',detailed:'FOOD_AND_DRINK_RESTAURANT',confidence_level:'HIGH'}}).category,'Groceries');
assert.equal(bank.classify({merchant:'Health insurance premium',type:'expense'}).category,'Healthcare');
assert.equal(bank.merchantCategory({merchant:'Costco'}),null,'Unknown basket cannot invent dominant category');

const {request,preflightMaximumUsd}=Ai.buildRequest(available.candidates,allowed);
assert.equal(request.model,'gpt-6-luna');
const guidance=JSON.stringify(request.input);
assert(guidance.includes('Childcare = paid daycare'),'AI gets category meanings');
assert(guidance.includes('Insurance = premiums'),'Retail protections now included');
assert(guidance.includes('Subscriptions = DIGITAL services ONLY'));
assert(guidance.includes('Groceries = edible food and drinks ONLY'));
assert(guidance.includes('Health-insurance premiums belong Healthcare/Health'));
assert(guidance.includes('Possible can be categorized for user REVIEW'),'Possible match stays unverified');
assert(request.max_output_tokens<=4096);
assert(preflightMaximumUsd<Ai.COST_CEILING_USD);
let calls=0;
const fakeFetch=async(url,opts)=>{
 calls++;
 assert.equal(url,'https://api.openai.com/v1/responses');
 assert.equal(opts.headers.Authorization,'Bearer fictional-key');
 const prompt=JSON.stringify(JSON.parse(opts.body).input);
 assert(prompt.includes('Pet grooming brush'));
 assert(prompt.includes('Camping carabiner'));
 assert(!prompt.includes('card-one'),'No bank account identifier in prompt');
 assert(!prompt.includes('2026-11-12'),'No bank dates in prompt');
 assert(!prompt.includes('26.5'),'No bank amounts in prompt');
 assert(!prompt.includes('fictional-key'),'No API key in prompt');
 return {ok:true,json:async()=>({
  status:'completed',usage:{input_tokens:350,output_tokens:160},
  output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({
   choices:[{i:0,category:'Pets',confidence:'high'},
    {i:1,category:'Shopping',confidence:'high'},
    {i:0,category:'Other',confidence:'high'},
    {i:999,category:'Shopping',confidence:'high'}]
  })}]}]
 })};
};
(async()=>{
 const result=await Ai.classify({candidates:available.candidates,
  categories,apiKey:'fictional-key',fetchImpl:fakeFetch});
 assert.equal(calls,1,'Only one bounded AI request');
 assert.equal(result.proposals.length,2);
 assert.deepEqual(result.proposals.map(p=>p.category),['Pets','Shopping']);
 assert.equal(result.costUsd,(350*0.10+160*0.50)/1e6);
 assert.equal(result.proposals[0].note,notes[keyFor(rows[0])]);
 assert.equal(result.proposals[0].previous,null);
 assert.deepEqual(adjustments.categoryOverrides,{d:'Shopping',f:'Other'},
  'AI preview must not mutate category choices');
 const low=await Ai.classify({candidates:available.candidates,
  categories,apiKey:'fictional-key',fetchImpl:async()=>({
   ok:true,json:async()=>({status:'completed',
    usage:{input_tokens:250,output_tokens:120},
    output:[{type:'message',content:[{type:'output_text',text:
     JSON.stringify({choices:[
      {i:0,category:'Pets',confidence:'low'},
      {i:1,category:'Not a real category',confidence:'high'}]})
    }]}]})
  })});
 assert.equal(low.proposals.length,0,
  'Low confidence and invented labels must not become categories');
 assert.equal((await Ai.classify({candidates:[],categories,
  apiKey:'fictional-key',fetchImpl:()=>{throw Error('must not call')}})).proposals.length,0);
 console.log('Amazon AI categories: consent input, high-confidence validation, cost limits and manual priority PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
