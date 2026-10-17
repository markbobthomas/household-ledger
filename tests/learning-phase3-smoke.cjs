const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const M=require('../ledger-data.js'),F=require('../forecast.js'),R=require('../reviews.js');
const original={
 transactions:[
  {id:'c1',date:'2026-07-11',merchant:'Morning Coffee',amount:8.75,type:'expense',category:'Other',account:'Checking'},
  {id:'c2',date:'2026-08-11',merchant:'Morning Coffee',amount:8.75,type:'expense',category:'Other',account:'Checking'},
  {id:'c3',date:'2026-09-11',merchant:'Morning Coffee',amount:8.75,type:'expense',category:'Other',account:'Checking'},
  {id:'amazon1',date:'2026-10-13',merchant:'Amazon',amount:48,type:'expense',category:'Shopping',account:'Checking'},
  {id:'amazon2',date:'2026-10-14',merchant:'Amazon',amount:40,type:'expense',category:'Other',account:'Checking'},
  {id:'otherAccount',date:'2026-10-14',merchant:'Morning Coffee',amount:4,type:'expense',category:'Other',account:'Savings'}
 ]};
const state=M.migrate(original);
const untouched=JSON.stringify(state.transactions);
assert.ok(R.build(state,F,'2026-10-16').tasks.some(t=>t.targetId==='amazon2'));
M.setCategory(state,'c3','Dining');
const learned=M.learnCategory(state,'c3','Dining');
assert.equal(learned.mode,'auto','Consistent merchant gets automatic rule');
assert.equal(M.records(state).find(x=>x.id==='c1').category,'Dining','Unclassified older expense is classified through overlay');
assert.equal(M.records(state).find(x=>x.id==='otherAccount').category,'Other','Rule scoped to matching account');
state.transactions.push({id:'c4',date:'2026-10-15',merchant:'Morning Coffee',type:'expense',category:'Other',amount:9.1,account:'Checking'});
let resolved=M.records(state).find(x=>x.id==='c4');
assert.equal(resolved.category,'Dining','New bank transaction learns existing category');
assert.equal(resolved.method,'learned','Provenance is visible');
assert.equal(R.build(state,F,'2026-10-16').tasks.some(t=>t.targetId==='c4'),false,'No repeat review for auto-classified item');
state.transactions.push({id:'bank-conflict',date:'2026-10-15',merchant:'Morning Coffee',type:'expense',category:'Shopping',amount:9.1,account:'Checking'});
assert.equal(M.records(state).find(x=>x.id==='bank-conflict').category,'Shopping','Never overwrite strong specific source classification');
assert.ok(R.build(state,F,'2026-10-16').tasks.some(t=>t.targetId==='bank-conflict'),'Conflicting category asks for review');
M.setCategory(state,'amazon2','Groceries');
const ambiguous=M.learnCategory(state,'amazon2','Groceries');
assert.equal(ambiguous.mode,'suggest','Multi-purpose merchant cannot be forced to one category');
state.transactions.push({id:'amazon3',date:'2026-10-15',merchant:'Amazon',type:'expense',category:'Other',amount:55,account:'Checking'});
assert.equal(M.categoryFor(state,'amazon3'),'Other','Ambiguous merchant rule does not auto-classify');
assert.ok(R.build(state,F,'2026-10-16').tasks.some(t=>t.targetId==='amazon3'&&t.suggested==='Groceries'),'Learned suggestion surfaces for review');
const reloaded=M.migrate(state);
assert.equal(M.records(reloaded).find(x=>x.id==='c4').category,'Other',
  'A conflicting new category safely downgrades auto-classification to a review suggestion after reload');
assert.equal(reloaded.learning.categoryRules[learned.key].category,'Dining','Original learned rule persists for later reconciliation');
assert.ok(R.build(reloaded,F,'2026-10-16').tasks.some(t=>t.targetId==='c4'&&t.suggested==='Dining'),
  'Conflict produces an actionable review instead of silently forcing merchant category');
const beforeUndoSource=JSON.stringify(reloaded.transactions);
assert.ok(M.removeCategoryRule(reloaded,learned.key),'Learned rule is removable');
assert.equal(M.categoryFor(reloaded,'c4'),'Other','Removing rule stops auto-category overlay');
assert.equal(JSON.stringify(reloaded.transactions),beforeUndoSource,'Removing rule leaves source untouched');
assert.equal(JSON.stringify(state.transactions.slice(0,original.transactions.length)),untouched,'Category learning never edits originals');
// Normalized provider updates and new source records must trigger rescoring.
const src=M.migrate({transactions:[]});
M.applyPlaidSync(src,{added:[{transaction_id:'new-1',account_id:'checking',date:'2026-10-13',name:'New vendor',amount:25}],modified:[],removed:[],nextCursor:'a'});
assert.equal(R.build(src,F,'2026-10-16').categoryCount,1,'New unclassified sync creates review');
const review=R.build(src,F,'2026-10-16').tasks[0];
R.confirm(src,review);
assert.equal(R.build(src,F,'2026-10-16').categoryCount,0,'Reviewed source item not repeated');
M.applyPlaidSync(src,{added:[],modified:[{transaction_id:'new-1',account_id:'checking',date:'2026-10-13',name:'New vendor',amount:30}],removed:[],nextCursor:'b'});
assert.equal(R.build(src,F,'2026-10-16').categoryCount,1,'Changed bank source reopens review');

// Confirm a recurring pattern, then keep auto-forecasting while source amounts evolve.
const bills=M.migrate({transactions:[
 {id:'b1',date:'2026-07-20',merchant:'Town Water',category:'Utilities',type:'expense',account:'Checking',amount:48.75},
 {id:'b2',date:'2026-08-20',merchant:'Town Water',category:'Utilities',type:'expense',account:'Checking',amount:48.75},
 {id:'b3',date:'2026-09-20',merchant:'Town Water',category:'Utilities',type:'expense',account:'Checking',amount:48.75}
]});
const k=F.patternKey('expense','Utilities','Checking','Town Water');
M.setPatternRule(bills,k,{mode:'trust',cadence:'monthly',amount:48.75,day:20});
const confirmed=F.forecast(M.records(bills),'2026-10','Utilities','2026-10-16',bills.predictions.patternRules).expected;
assert.equal(confirmed[0].confidence,'Confirmed','Reviewed schedule reused without freezing charge');
M.setCategory(bills,'b3','Utilities');
bills.transactions[1].amount=100;bills.transactions[2].amount=100;
const changed=F.forecast(M.records(bills),'2026-10','Utilities','2026-10-16',bills.predictions.patternRules).expected;
assert.ok(changed.length&&changed[0].ruleChanged,'Significantly changed utility pattern invalidates trust');
assert.ok(R.build(bills,F,'2026-10-16').tasks.some(t=>t.kind==='prediction'&&t.ruleChanged),'Changed trusted pattern returns to Reviews');
M.setPatternRule(bills,k,null);
assert.equal(bills.predictions.patternRules[k],undefined,'Can restore automatic pattern inference');

(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:860}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Base=Date;class FixedDate extends Base{constructor(...args){if(args.length)super(...args);else super('2026-10-16T12:00:00Z')}static now(){return new Base('2026-10-16T12:00:00Z').getTime()}}
  window.Date=FixedDate;
 });
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  await page.locator('aside [data-page=reviews]').click();
  assert.ok(await page.locator('.learned-rules > summary').count(),'Learning rules visible');
  const originalTransactions=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')).transactions);
  await page.locator('[data-review-filter=category]').click();
  let first=page.locator('.review-task').first();await first.locator('summary').click();
  assert.equal(await first.locator('[name=remember]').count(),1,'Category review offers reusable learning');
  const firstId=await first.getAttribute('data-review-task');
  await first.locator('[data-review-confirm]').click();
  const current=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(current.learning.categoryRules===undefined,false,'Confirming category creates rule data');
  const keys=Object.keys(current.learning.categoryRules);
  assert.ok(keys.length,'Remembered category rule present');
  await page.locator('.learned-rules > summary').click();
  assert.ok(await page.locator('.learned-rules [data-forget-category]').count(),'Saved rules are inspectable');
  await page.locator('.learned-rules [data-forget-category]').first().click();
  const undone=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.equal(Object.keys(undone.learning.categoryRules).length,0,'Rule can be removed from Reviews');
  assert.ok(!await page.locator('.review-task[data-review-task="'+firstId+'"]').count(),'Explicit original review remains confirmed');
  // Quick edits affect one transaction; reusable merchant learning stays explicitly in Reviews.
  await page.locator('aside [data-page=transactions]').click();
  const transaction=page.locator('.ledger-table tbody tr').filter({has:page.locator('td:text-is("expense")')}).first();
  assert.equal(await transaction.locator('select[data-category]').count(),1,'Activity category uses native inline dropdown');
  assert.equal(await transaction.locator('select[data-category] option').count(),12);
  assert.equal(await page.locator('#entry').count(),0,'No top-of-page category editor');
  assert.equal(await transaction.locator('input[name=remember]').count(),0,'Quick edit never automatically learns a merchant rule');
  const finalState=await page.evaluate(()=>JSON.parse(localStorage.getItem('household-ledger-v1')));
  assert.deepEqual(finalState.transactions,originalTransactions,'Learning is separate from posted bank records');
  await page.setViewportSize({width:390,height:844});
  await page.locator('.mobile-top-nav [data-page=reviews]').click();
  await page.locator('.learned-rules > summary').click();
  assert.ok(await page.locator('.learned-rules').isVisible(),'Rule control reachable on phone');
  const width=await page.evaluate(()=>({body:document.documentElement.scrollWidth,screen:innerWidth}));
  assert.ok(width.body<=width.screen+1,'No phone horizontal overflow');
  assert.deepEqual(errors,[]);
  console.log('PASS: Phase 3 learning, safe merchant rules, recurring validation, reversible UI, mobile and immutable source');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
