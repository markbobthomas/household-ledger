const assert=require('node:assert/strict');
const F=require('../forecast.js');
const {buildScenario}=require('./fixtures/household-25months.cjs');

const source=buildScenario(),asOf='2026-10-17';
const forecast=(cat,date=asOf,mode='expense')=> mode==='income'?
 F.forecastIncome(source,date.slice(0,7),date):F.forecast(source,date.slice(0,7),cat,date);
assert.ok(source.length>700,'Scenario should cover 25 months and hundreds of records');
assert.equal(source.every(x=>x.source.provider==='scenario'),true,'Never presented as bank-verified data');

const subscriptions=forecast('Subscriptions');
assert.ok(subscriptions.expected.some(x=>x.merchant==='Music Stream'&&x.date==='2026-10-21'),'Stable monthly subscription predicted exactly');
assert.ok(!subscriptions.expected.some(x=>x.merchant==='Cinema Stream'),'Paid Oct 12 subscription is not predicted twice');
assert.ok(subscriptions.expected.some(x=>x.merchant==='Weekly Shuttle'&&x.cadence==='weekly'),'Weekly 4/5 occurrences detected');
assert.ok(!subscriptions.expected.some(x=>x.merchant==='Canceled Video Service'),'Old canceled subscriptions never forecast');
assert.ok(subscriptions.expected.every(x=>x.date>asOf),'Only future dated expenses in current month');

const utilities=forecast('Utilities');
assert.ok(utilities.expected.some(x=>x.merchant==='Quarterly Pest Service'&&x.cadence==='quarterly'&&['2026-10-18','2026-10-19'].includes(x.date)),'Quarterly payment detected');
assert.ok(utilities.expected.some(x=>x.merchant==='Water Utility'&&x.cadence==='monthly'),'Monthly variable utility detected');
assert.ok(utilities.expected.every(x=>x.id.startsWith('hist|')),'Source-linked IDs remain stable');

const salary=forecast(null,'2026-10-10','income');
assert.ok(salary.expected.some(x=>x.merchant==='Primary Paycheck'&&x.type==='income'&&x.cadence==='every 2 weeks'),'Biweekly income pattern supported');
assert.ok(salary.expected.some(x=>x.merchant==='Partner Salary'&&x.cadence==='twice monthly'),'Twice-monthly salary supported');
assert.ok(salary.expected.every(x=>x.type==='income'),'Income does not appear as expense');

const november='2026-11-01';
const annual=forecast('Subscriptions',november);
assert.ok(annual.expected.some(x=>x.merchant==='Annual Digital Membership'&&x.cadence==='annual'&&x.date==='2026-11-12'),'Yearly bill inferred from two prior years');
const insurance=forecast('Insurance',november);
assert.ok(insurance.expected.some(x=>x.cadence==='semiannual'&&x.merchant==='Car Insurance Semiannual'),'Six-month insurance schedule recognized');
const oct=forecast('Utilities');
assert.ok(oct.unscheduled.includedInDatedTotal===false,'Unscheduled expense risk separate from dated charges');
const grocery=forecast('Groceries');
assert.equal(grocery.expected.filter(x=>x.merchant==='Neighborhood Grocer').length,0,'Irregular shopping must not become invented dated purchases');
assert.ok(grocery.unscheduled.estimate>0&&grocery.unscheduled.max>=grocery.unscheduled.min,'Irregular spending risk given as range');

const electricity=forecast('Utilities');
assert.ok(electricity.historyMonths.length>=20,'Long-term scenario contributes real historical coverage');
const novemberUtilities=forecast('Utilities',november);
assert.ok(novemberUtilities.expected.some(x=>x.merchant==='Northwest Electric'&&x.seasonal),
  'Seasonal utility model uses previous-year same-month observation');
const octoberSubscription=subscriptions.expected.find(x=>x.merchant==='Music Stream');
assert.ok(octoberSubscription.evidence>=12,'Confidence uses long history, not only three observations');
assert.equal(octoberSubscription.confidence,'High','Long stable subscriptions are high evidence');
// Future rows exist in the scenario, but must not influence a prediction for the earlier as-of date.
const pastOnly=source.filter(t=>t.date<=asOf);
for(const cat of ['Subscriptions','Utilities','Groceries']){
 const all=F.forecast(source,'2026-10',cat,asOf);
 const limited=F.forecast(pastOnly,'2026-10',cat,asOf);
 assert.deepEqual(all.expected,limited.expected,'No future-data leakage: '+cat);
 assert.deepEqual(all.unscheduled,limited.unscheduled,'No future leakage to variable spending risk: '+cat);
}
assert.ok(F.forecast(source,'2026-09','Subscriptions',asOf).expected.length===0,'Closed month has no new future predictions');
const noHistory=F.forecast([{date:'2026-10-03',type:'expense',merchant:'Single',amount:10,category:'Subscriptions'}],
 '2026-10','Subscriptions',asOf);
assert.equal(noHistory.expected.length,0,'Not enough history gives no false schedule');
console.log('PASS: Phase 1 25-month synthetic coverage: weekly, biweekly, twice-monthly, quarterly, semiannual, annual, seasonal, canceled, income, irregular risk and no lookahead');
