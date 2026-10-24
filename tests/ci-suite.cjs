'use strict';
const suites = {
  baseline: ['architecture-baseline'],
  banking: ['pilot-security-smoke','pilot-plaid-flow','pilot-remove-account-smoke','planner-core-smoke','planner-schedule-only-smoke','planner-focused-review-smoke','planner-integrity-smoke','planner-recurrence-integration-smoke','planner-independent-schedules-smoke','planner-posted-matching-smoke','card-statement-cycles-smoke','card-setup-gate-smoke','planner-transactions-smoke','planner-summary-smoke','forecast-only-save-smoke','forecast-client-save-smoke'],
  forecast: ['pilot-account-forecast-links-smoke','planner-routine-smoke','planner-backtest-smoke','planner-series-smoke','planner-recurring-confirmation-smoke','planner-merchant-streams-smoke','planner-recurring-collision-smoke','planner-card-estimate-smoke','planner-alternating-pay-smoke','planner-payroll-safety-smoke','planner-missing-mortgage-smoke','planner-history-smoke','history-any-recurring-smoke','planner-early-recurrence-smoke','recurrence-early-dedupe-smoke','planner-income-smoke','payment-obligations-smoke','planner-three-year-smoke','planner-schedule-categories-smoke','planner-coverage-smoke','mortgage-prediction-smoke'],
  parity: ['planner-parity'],
  reconciliation: ['bank-balance-authority','review-to-budget-parity','reconciliation-phase1-smoke','reconciliation-phase3-stress','conservative-categorization-phase2','sandbox-categorization-smoke'],
  browser: ['planner-browser','pilot-remove-account-browser'],
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
