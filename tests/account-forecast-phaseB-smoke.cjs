const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const B=require('../account-forecast.js'),M=require('../ledger-data.js');
const snapshot={asOf:'2026-10-17',mode:'demo',accounts:[
 {id:'checking-1',name:'Primary Checking',accountType:'checking',current:5000,available:4800,transactionAccount:'Checking'},
 {id:'checking-2',name:'Second Checking',accountType:'checking',current:600,available:600},
 {id:'savings',name:'Savings',accountType:'savings',current:1200,available:1200},
 {id:'visa',name:'Visa',accountType:'credit',current:1000,available:4000},
 {id:'mastercard',name:'Mastercard',accountType:'credit',current:200,available:1800},
 {id:'amex',name:'Amex',accountType:'credit',current:400,available:2600}
]};
const events=[
 {id:'card-purchase',type:'expense',accountId:'visa',merchant:'Groceries',date:'2026-10-20',amount:300},
 {id:'checking-purchase',type:'expense',accountId:'checking-1',merchant:'Utilities',date:'2026-10-20',amount:80},
 {id:'payroll',type:'income',accountId:'checking-1',merchant:'Employer',date:'2026-10-21',amount:1000},
 {id:'card-refund',type:'refund',accountId:'visa',merchant:'Refund',date:'2026-10-22',amount:50},
 {id:'unassigned',type:'expense',merchant:'Unknown account',date:'2026-10-23',amount:400}
];
const planned=[
 {id:'movement|visa',fromAccountId:'checking-1',toAccountId:'visa',amount:500,anchorDate:'2026-10-26',frequency:'once'},
 {id:'movement|save',fromAccountId:'checking-1',toAccountId:'savings',amount:200,anchorDate:'2026-10-27',frequency:'once'},
 {id:'movement|mc',fromAccountId:'savings',toAccountId:'mastercard',amount:100,anchorDate:'2026-10-28',frequency:'once'}
];
const original=JSON.stringify({snapshot,events,planned});
const out=B.build(snapshot,events,planned,{days:90});
const a=id=>out.accounts.find(x=>x.id===id);
assert.equal(a('checking-1').closing,5220,'Checking cash = 5000 - 80 + 1000 - 500 - 200');
assert.equal(a('checking-1').closingAvailable,5020,'Available cash retains independent availability adjustment');
assert.equal(a('savings').closing,1300,'Savings transfer credited, card settlement debited');
assert.equal(a('visa').closing,750,'Credit balance owed: 1000+300-50-500');
assert.equal(a('mastercard').closing,100);
assert.equal(a('amex').closing,400);
assert.equal(out.household.openingCash,6800);
assert.equal(out.household.closingCash,7120);
assert.equal(out.household.openingDebt,1600);
assert.equal(out.household.closingDebt,1250);
assert.equal(out.household.openingNet,5200);
assert.equal(out.household.closingNet,5870);
assert.equal(out.household.expectedSpending,330);
assert.equal(out.household.expectedIncome,1000);
assert.equal(out.household.conservationDifference,0,'Household movement conservation identity');
assert.equal(out.household.complete,false,'Unknown destination prevents fully reconciled forecast');
assert.equal(out.diagnostics.unassigned.length,1,'Unassigned event excluded and disclosed');
assert.equal(out.diagnostics.pairedMovements.length,3,'Each planned transfer emitted once');
assert.equal(out.accounts.length,6);
assert.equal(out.series.length,91,'Exactly 90 projected days plus opening snapshot');
assert.equal(JSON.stringify({snapshot,events,planned}),original,'Pure engine cannot mutate input or bank balances');
const movements=out.events.filter(p=>p.transferGroupId);
assert.equal(movements.length,6,'Each movement has exactly two legs');
for(const m of planned){
 const rows=movements.filter(p=>p.transferGroupId==='plan|'+m.id+'|'+m.anchorDate);
 assert.equal(rows.length,2,'Each planned transfer has two sides');
 const sum=rows.reduce((n,p)=>n+(p.kind==='transfer_in'?p.amount:-p.amount),0);
 assert.equal(sum,0,'Internal transfer cash legs conserve amounts');
}
const base=B.build(snapshot,events.filter(e=>e.id!=='unassigned'),[],{days:90});
assert.equal(base.household.complete,true,'Fully assigned events plus verified snapshots are complete');
assert.equal(base.household.closingNet,out.household.closingNet,
 'Shifting cash between owned accounts cannot alter household net position');
const monthly=B.occurrences({anchorDate:'2026-10-31',day:31,frequency:'monthly'},'2026-10-17','2027-02-28');
assert.deepEqual(monthly,['2026-10-31','2026-11-30','2026-12-31','2027-01-31','2027-02-28']);
assert.deepEqual(B.occurrences({anchorDate:'2026-10-17',frequency:'biweekly'},'2026-10-17','2026-11-30'),
 ['2026-10-31','2026-11-14','2026-11-28']);
const s=M.migrate({transactions:[{id:'bank-row',date:'2026-10-09',type:'expense',merchant:'Grocer',amount:80,category:'Groceries'}]});
const frozen=JSON.stringify(s.transactions);
const id=M.saveAccountMovement(s,{...planned[0],id:null});
assert.ok(id.startsWith('movement|'));assert.equal(s.predictions.accountMovements.length,1);
assert.equal(JSON.stringify(s.transactions),frozen,'Plan writes predictions, never source');
assert.equal(M.migrate(s).predictions.accountMovements[0].amount,500,'Plan survives migration');
M.removeAccountMovement(s,id);assert.equal(s.predictions.accountMovements.length,0);
assert.throws(()=>M.saveAccountMovement(s,{fromAccountId:'checking-1',toAccountId:'checking-1',amount:100,anchorDate:'2026-10-25'}));
assert.throws(()=>M.saveAccountMovement(s,{fromAccountId:'checking-1',toAccountId:'visa',amount:-100,anchorDate:'2026-10-25'}));
const history=[
 {id:'source-out',date:'2026-09-14',accountId:'checking-1',merchant:'Credit Card Payment',pairedTransactionId:'source-in'},
 {id:'source-in',date:'2026-09-15',accountId:'visa',merchant:'Payment Thank You',pairedTransactionId:'source-out'}
];
const mirrored=[
 {id:'expect-out',date:'2026-11-14',accountId:'checking-1',merchant:'Credit Card Payment',type:'transfer',cashDirection:'out',amount:200},
 {id:'expect-in',date:'2026-11-15',accountId:'visa',merchant:'Payment Thank You',type:'transfer',cashDirection:'in',amount:200}
];
const mirroredForecast=B.build(snapshot,mirrored,[],{records:history,days:90});
assert.equal(mirroredForecast.diagnostics.pairedMovements.length,1,'Historically linked predicted card payments merge');
assert.equal(mirroredForecast.events.length,2,'Mirror prediction cannot double-post each credit/checking side');
assert.equal(mirroredForecast.household.conservationDifference,0);
const manualWins=B.build(snapshot,mirrored,[{id:'movement|same',amount:200,
 fromAccountId:'checking-1',toAccountId:'visa',anchorDate:'2026-11-14',frequency:'once'}],{records:history,days:90});
assert.equal(manualWins.diagnostics.pairedMovements.length,1,'Manual matching settlement cannot produce a second card payment');
assert.equal(manualWins.household.closingNet,mirroredForecast.household.closingNet);
const noPartner=B.build(snapshot,[mirrored[0]],[],{days:90});
assert.equal(noPartner.diagnostics.unmatchedTransfers.length,1,'Unlinked bank movement is flagged');
assert.equal(noPartner.household.complete,false,'Incomplete internal transfer cannot claim reconciled net');
async function browserCase(browser,opts,mobile){
 const page=await browser.newPage(opts),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const Native=Date;class Fixed extends Native{
  constructor(...args){if(args.length)super(...args);else super('2026-10-17T12:00:00Z')}
  static now(){return new Native('2026-10-17T12:00:00Z').getTime()}
 }window.Date=Fixed});
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  await page.locator(mobile?'.mobile-top-nav [data-page=overview]':'aside [data-page=overview]').click();
  const panel=page.locator('#cashflow');
  assert.equal(await panel.locator('.account-forecast').count(),1);
  assert.equal(await panel.locator('.account-projection-row').count(),4,'Demo checks two cards, savings and checking');
  assert.match(await panel.locator('.account-total-strip').innerText(),/Card debt/);
  const before=await page.evaluate(()=>({
   bank:window.HouseholdBankFeed.getSnapshot('2026-10-17'),
   tx:JSON.stringify(JSON.parse(localStorage.getItem('household-ledger-v1')).transactions),
   forecast:window.HouseholdAccountForecast.build(
     window.HouseholdBankFeed.getSnapshot('2026-10-17'),[],[],{days:90}).household
  }));
  const visa=panel.locator('.account-projection-row').filter({hasText:'Rewards Visa'});
  const beforeVisa=await visa.locator('.account-projection-future').innerText();
  const checking=panel.locator('.account-projection-row').filter({hasText:'Everyday Checking'});
  const beforeChecking=await checking.locator('.account-projection-future').innerText();
  await panel.locator('.account-plan-detail > summary').click();
  const form=panel.locator('#account-movement-form');
  await form.locator('[name=fromAccountId]').selectOption('demo-checking');
  await form.locator('[name=toAccountId]').selectOption('demo-visa');
  await form.locator('[name=anchorDate]').fill('2026-10-25');
  await form.locator('[name=amount]').fill('150');
  await form.locator('button[type=submit]').click();
  assert.equal(await page.locator('.account-movement-row').count(),1,'New payment shown in account planner');
  const afterVisa=await visa.locator('.account-projection-future').innerText();
  const afterChecking=await checking.locator('.account-projection-future').innerText();
  assert.notEqual(afterVisa,beforeVisa,'Credit liability declines when payment forecast saved');
  assert.notEqual(afterChecking,beforeChecking,'Checking funds decline on same payment date');
  const after=await page.evaluate(()=>({
   bank:window.HouseholdBankFeed.getSnapshot('2026-10-17'),
   tx:JSON.stringify(JSON.parse(localStorage.getItem('household-ledger-v1')).transactions),
   stored:JSON.parse(localStorage.getItem('household-ledger-v1')).predictions.accountMovements
  }));
  assert.deepEqual(after.bank,before.bank,'Editing forecast cannot edit bank snapshot');
  assert.equal(after.tx,before.tx,'Editing forecast cannot edit real source transactions');
  assert.equal(after.stored[0].amount,150);
  await page.reload({waitUntil:'load'});
  await page.locator(mobile?'.mobile-top-nav [data-page=overview]':'aside [data-page=overview]').click();
  assert.equal(await page.locator('.account-movement-row').count(),1,'Saved planned movement persists across reload');
  await page.locator('.account-plan-detail > summary').click();
  await page.locator('[data-remove-account-movement]').click();
  assert.equal(await page.locator('.account-movement-row').count(),0,'Remove is reversible');
  assert.equal(await visa.locator('.account-projection-future').innerText(),beforeVisa);
  assert.equal(await checking.locator('.account-projection-future').innerText(),beforeChecking);
  if(mobile)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Account summary fits phone');
  assert.deepEqual(errors,[]);
 }finally{await page.close()}
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{await browserCase(browser,{viewport:{width:1300,height:850}},false)}finally{await browser.close()}
 const safari=await webkit.launch({headless:true});
 try{await browserCase(safari,{...devices['iPhone 13']},true)}finally{await safari.close()}
 console.log('PASS: Phase B checking/savings/3-card ledger conservation, card settlements, duplicates, unassigned events, demo planner, Chromium and iPhone Safari');
})().catch(e=>{console.error(e);process.exit(1)});
