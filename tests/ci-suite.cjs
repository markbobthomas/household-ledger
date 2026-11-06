'use strict';
const suites = {
  baseline: ['architecture-baseline'],
  banking: ['pilot-security-smoke','pilot-plaid-flow','server-prepared-forecast-smoke','pilot-remove-account-smoke','planner-core-smoke','planner-schedule-only-smoke','planner-focused-review-smoke','planner-integrity-smoke','planner-recurrence-integration-smoke','planner-independent-schedules-smoke','planner-posted-matching-smoke','card-statement-cycles-smoke','card-setup-gate-smoke','planner-transactions-smoke','planner-summary-smoke','planner-calendar-gaps-smoke','forecast-only-save-smoke','forecast-client-save-smoke','household-concurrent-saves-smoke'],
  forecast: ['planner-legacy-invariants-smoke','pilot-account-forecast-links-smoke','planner-series-smoke','planner-recurring-confirmation-smoke','planner-merchant-streams-smoke','planner-recurring-collision-smoke','planner-card-estimate-smoke','planner-alternating-pay-smoke','planner-payroll-safety-smoke','planner-history-smoke','history-any-recurring-smoke','payment-obligations-smoke','planner-three-year-smoke','planner-business-days-smoke','planner-schedule-categories-smoke','planner-coverage-smoke',],
  parity: ['planner-parity'],
  reconciliation: ['planner-category-spending-smoke','bank-balance-authority','review-to-budget-parity','reconciliation-phase1-smoke','reconciliation-phase3-stress','conservative-categorization-phase2','sandbox-categorization-smoke','planner-category-review-smoke','planner-category-management-smoke','category-deletion-save-smoke','category-rename-save-smoke','category-learning-save-smoke'],
  browser: ['planner-browser','planner-opening-page-browser','planner-prepared-navigation-browser','calendar-navigation-date-browser','planner-budget-netting-browser','pilot-remove-account-browser','pilot-category-inline-browser'],
  historic: ['recurrence-reconcile-smoke']
};
const coreGroups = ['baseline','banking','forecast','parity','reconciliation'];
function resolve(group) {
  const groups=group==='core'?coreGroups:[group];
  if(groups.some(name=>!Object.hasOwn(suites,name)))throw Error('Unknown group: '+group);
  const tests=groups.flatMap(name=>suites[name]);
  if(tests.length!==new Set(tests).size)throw Error('Duplicate tests in '+group);
  return tests;
}
module.exports={suites,coreGroups,resolve};
if(require.main===module){
 const fs=require('node:fs'),path=require('node:path');
 const {spawnSync}=require('node:child_process');
 const group=process.argv[2]||'core',tests=resolve(group);
 for(const name of tests){
  const file=path.join(__dirname,name+'.cjs');
  if(!fs.existsSync(file))throw Error('Missing test: '+file);
 }
 if(process.argv.includes('--list')){
  console.log(tests.join('\n'));
  process.exit(0);
 }
 console.log('Running '+group+' regression suite: '+tests.length+' distinct scripts');
 if(group==='browser'){
  console.log('Shared browser worker: '+tests.length+' isolated specs, one Chromium/WebKit pair');
  // Browser specs run sequentially in one Node process and share a Chromium/WebKit pair.
  // Each spec still makes isolated browser contexts and runs its own fictional server.
  const outcome=spawnSync(process.execPath,[path.join(__dirname,'browser-suite.cjs')],
   {stdio:'inherit',cwd:path.join(__dirname,'..')});
  if(outcome.error||outcome.status!==0){
   if(outcome.error)console.error(outcome.error);
   process.exit(outcome.status||1);
  }
  console.log('PASS '+group+' regression suite ('+tests.length+' tests)');
  process.exit(0);
 }
 for(const name of tests){
  const result=spawnSync(process.execPath,[path.join(__dirname,name+'.cjs')],{stdio:'inherit',cwd:path.join(__dirname,'..')});
  if(result.error||result.status!==0){
   console.error('FAILED regression: '+name);
   if(result.error)console.error(result.error);
   process.exit(result.status||1);
  }
 }
 console.log('PASS '+group+' regression suite ('+tests.length+' tests)');
}

