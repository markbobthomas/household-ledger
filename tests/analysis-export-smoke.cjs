'use strict';
// Fictional analysis export: complete source evidence without provider IDs,
// access tokens, authentication files, or automatic AI requests.
const assert=require('node:assert/strict');
const {build}=require('../pilot/analysis-export.cjs');
const asOf='2026-11-23',bank='private-raw-bank-id-123456789012345';
const date=n=>{
 const day=new Date(asOf+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+n);
 return day.toISOString().slice(0,10);
};
const history=Array.from({length:630},(_,i)=>({
 id:'raw-tx-'+i,accountId:bank,date:date(-(i%200)),
 type:i%11===0?'income':'expense',amount:34+i,
 merchant:i%2?'Fictional Grocer':'Fictional Store',
 description:'Fictional Store ACH ref 123456789012345678',
 category:'Groceries',pending:i===0,source:{
  providerTransactionId:'PRIVATE-ID',access_token:'PRIVATE-TOKEN'
 }
}));
for(const [j,i] of [12,13,14,15].entries()){
 history[i].merchant='Fictional Periodical';
 history[i].category=j===3?'Groceries':'Subscriptions';
}
const future=[
 {id:'raw-future',date:date(15),accountId:bank,merchant:'Fictional Housing',
  kind:'expense',amount:1280,recurringRuleId:'raw-private-rule'}
];
const prepared={bundle:{
 projection:{asOf,days:1095,
  accounts:[{id:bank,valid:true,type:'cash',balanceStatus:'fresh',
   source:{accountType:'checking',accountId:bank,token:'SECRET-IN-SOURCE'},
   openingCurrent:9300,openingAvailable:8800,
   series:Array.from({length:130},(_,i)=>({date:date(i),
    balance:9300-i*4,income:0,outflow:0}))}],
  series:[],events:future,
  household:{conservationDifference:0},diagnostics:{balanceMismatches:[]}},
 ledger:[],rows:history,
 payments:{statements:[{cardId:bank,fromAccountId:bank,periodStart:date(-30),
   periodEnd:date(-1),dueDate:date(10),amount:620,statementBalance:620,
   autopayEnabled:true,estimated:false,alreadyPaid:true,
   actualPaymentDate:date(-4),actualPaymentAmount:1280,
   statementReconciliation:{status:'difference',source:'user-entered',difference:12},
   estimatedPaymentLimited:true,requestedPaymentAmount:640,modeledPaymentLimit:620
   }],warnings:[]},
 overduePayments:[],duplicateChecks:[],postedMatchReview:[],
 paymentReconciliations:[{date:date(-4),expectedDate:date(-5),
  merchant:'Housing',amount:1280,forecastAmount:1290,difference:-10,
  status:'posted',cardId:bank,accountId:bank,
  bankId:'raw-private-bank-id',providerTransactionId:'private-ledger-evidence'}]
}};
const adjustments={
 categoryOverrides:{[history[1].id]:'Home & Maintenance'},
 predictions:{
  primaryAccountId:bank,lowAlertThreshold:6000,
  categoryMonthlyBudgets:{Groceries:800,'Home & Maintenance':1200},
  paymentRules:{[bank]:{fromAccountId:bank,autopayEnabled:true,
   method:'statement',billingStartDate:date(-30),billingEndDate:date(-1),
   nextPaymentDate:date(10),nextDueDate:date(11),closingDay:22,
   lastStatementBalance:620,minimumAmount:0,fixedAmount:0}},
  paymentBills:[{id:'private-bill',fromAccountId:bank,name:'Fictional Tuition',
   category:'Education',date:date(22),amount:480,frequency:'monthly',enabled:true}],
  futureRecurringRules:[{id:'raw-private-rule',kind:'event',type:'expense',
   accountId:bank,amount:1280,merchant:'Fictional Housing',category:'Housing',
   frequency:'monthly',anchorDate:date(15),exampleIds:[history[1].id],
   matchNames:['Fictional Housing'],sourceKey:'private-rule-reference'}],
  futureTransactionAdds:[{id:'raw-added',kind:'event',type:'income',
   accountId:bank,date:date(12),amount:3000,merchant:'Fictional Employer',
   bankToken:'DO-NOT-EXPORT'}],
  transactionNotes:{['bank:'+JSON.stringify([bank,history[1].id])]:
   'Recurring purchase from Fictional Store'},
  futureRecurrenceExclusions:{private:{accountId:bank,type:'expense',
   merchant:'Fictional Unknown Merchant',secret:'DO-NOT-EXPORT'}}
 },
 learning:{categoryRules:{rule:{merchant:'Fictional Grocer',category:'Groceries',
  mode:'auto',accountId:bank,privateId:'DO-NOT-EXPORT'}}}
};
const report=build({prepared,adjustments,lastSync:'2026-11-23T11:00:00Z',
 syncDiagnostics:{lastAttempt:{at:'2026-11-23T12:00:00Z',outcome:'failed',
  requestId:'NEVER-EXPORT-REQUEST-ID'},
  issues:[{code:'INVALID_FIELD',observedAt:'2026-11-23T12:00:01Z',
   message:'SECRET-PROVIDER-MESSAGE',requestId:'NEVER-EXPORT-REQUEST-ID'}]}});
assert.equal(report.bankSync.automaticTransactionSync,false);
assert.equal(report.bankSync.lastAttemptOutcome,'failed');
assert.equal(report.bankSync.lastAttemptAt,'2026-11-23T12:00:00Z');
assert.equal(report.bankSync.itemIssues[0].code,'INVALID_FIELD');
assert.equal(report.bankSync.itemIssues[0].observedAt,'2026-11-23T12:00:01Z');
assert.equal(report.format,'ledger-manual-analysis-export');
assert.equal(report.counts.history,630,'all history, not the last 500 or 140');
assert.equal(report.actualTransactions.length,630);
assert.equal(report.expectedTransactions.length,1);
assert.equal(report.projectedDailyBalances.length,130);
assert.equal(report.cardStatements.length,1);
assert(report.sourceIndices.length>10,'full-history grouping is included');
assert(report.sourceEvidence.length>0,'canonical evidence is included');
assert.equal(report.accounts[0].id,'account-1');
assert.equal(report.accounts[0].opening,9300);
assert.equal(report.savedDecisions.recurringSchedules[0].accountId,'account-1');
assert.equal(report.savedDecisions.recurringSchedules[0].amount,1280);
assert.equal(report.savedDecisions.oneOffPayments[0].amount,3000);
assert.equal(report.savedDecisions.cardPaymentRules.length,1);
assert.equal(report.savedDecisions.cardPaymentRules[0].cardId,'account-1');
assert.equal(report.savedDecisions.cardPaymentRules[0].lastStatementBalance,620);
assert.equal(report.savedDecisions.paymentBills[0].amount,480);
assert.equal(report.savedDecisions.paymentBills[0].fromAccountId,'account-1');
assert.equal(report.savedDecisions.monthlyBudgetTargets[0].monthlyTarget,800);
assert.equal(report.savedDecisions.categoryOverrides[0].category,'Home & Maintenance');
assert.equal(report.savedDecisions.transactionNotes[0].transactionId,
 report.savedDecisions.categoryOverrides[0].transactionId,
 'Notes and category overrides must refer to the same export-local transaction despite sorting');
assert.equal(report.savedDecisions.alertThreshold,6000);
assert.equal(report.reconciliationAndReview.paymentReconciliations[0].amount,1280);
assert.equal(report.reconciliationAndReview.paymentReconciliations[0].forecastAmount,1290);
assert.equal(report.reconciliationAndReview.paymentReconciliations[0].difference,-10);
assert.equal(report.reconciliationAndReview.paymentReconciliations[0].expectedDate,date(-5));
assert.equal(report.reconciliationAndReview.paymentReconciliations[0].cardId,'account-1');
assert.equal(report.cardStatements[0].actualPaymentAmount,1280);
assert.equal(report.cardStatements[0].actualPaymentDate,date(-4));
assert.equal(report.cardStatements[0].estimatedPaymentLimited,true);
assert.equal(report.cardStatements[0].statementReconciliation.difference,12);
assert.equal(report.reconciliationAndReview.categoryConsistency.length,1);
assert.equal(report.reconciliationAndReview.categoryConsistency[0].suggestedCategory,'Subscriptions');
assert.equal(report.reconciliationAndReview.categoryConsistency[0].category,'Groceries');
const raw=JSON.stringify(report);
for(const forbidden of [bank,'PRIVATE-ID','PRIVATE-TOKEN','SECRET-IN-SOURCE',
 'raw-private-rule','raw-future','raw-tx-','raw-added','DO-NOT-EXPORT',
 'providerTransactionId','access_token','itemId','account_id','passphrase',
 'SECRET-PROVIDER-MESSAGE','NEVER-EXPORT-REQUEST-ID' ])
 assert(!raw.includes(forbidden),'Private provider field leaked: '+forbidden);
const again=JSON.parse(raw);
assert.equal(again.actualTransactions.length,history.length,'download is standalone parseable JSON');
assert.equal(again.expectedTransactions[0].merchant,'Fictional Housing');
console.log('Analysis export: complete fictional source, budgets, schedule decisions, forecasts, no secrets');
