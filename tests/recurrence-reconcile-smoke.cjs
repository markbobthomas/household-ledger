'use strict';
const assert=require('node:assert/strict'),M=require('../ledger-data.js'),F=require('../forecast.js'),L=require('../forecast-ledger.js'),R=require('../recurring.js');
const transactions=[
 {id:'jul',date:'2026-07-14',merchant:'Netflix',amount:19.99,type:'expense',category:'Subscriptions',account:'Checking'},
 {id:'aug',date:'2026-08-14',merchant:'Netflix',amount:19.99,type:'expense',category:'Housing',account:'Checking'},
 {id:'sep',date:'2026-09-14',merchant:'Netflix',amount:19.99,type:'expense',category:'Subscriptions',account:'Checking'},
 {id:'oct',date:'2026-10-14',merchant:'Netflix',amount:19.99,type:'expense',category:'Subscriptions',account:'Checking'},
 {id:'other-account',date:'2026-09-14',merchant:'Netflix',amount:19.99,type:'expense',category:'Subscriptions',account:'Other checking'}
];
const original=JSON.stringify(transactions),s=M.migrate({transactions});
const recentKey=F.patternKey('expense','Subscriptions','Checking','Netflix'),historicalKey=F.patternKey('expense','Housing','Checking','Netflix');
const rule=(anchor,amount=19.99)=>({mode:'schedule',frequency:'monthly',anchorDate:anchor,day:14,amount});
M.setPatternRule(s,recentKey,rule('2026-10-14'));
assert.equal(M.recurringRuleKey(s,'expense','Housing','Checking','Netflix'),recentKey,
 'Editing August sees the same recurring schedule that October already saved');
assert.equal(Object.keys(s.predictions.patternRules).length,1);
M.setPatternRule(s,historicalKey,rule('2026-08-14',19.99));
assert.deepEqual(Object.keys(s.predictions.patternRules),[historicalKey],
 'A different historical category replaces the same account+merchant rule rather than creating another');
assert.equal(M.recurringRuleKey(s,'expense','Subscriptions','Checking','Netflix'),historicalKey,
 'Later-month Activity rows find the historical confirmation');
const rows=M.records(s),report=R.analyze(rows,'2026-10-19',s.predictions.patternRules);
assert.equal(report.confirmed.filter(g=>g.merchant==='Netflix'&&g.account==='Checking').length,1,
 'Recurring Insights combines the same merchant across dates and categories');
assert.equal(report.confirmed.filter(g=>g.account==='Checking')[0].count,4,
 'All four posted months remain part of its historical evidence');
const shared=L.build(s,rows,'2026-10-19',90,F,M);
const netflix=shared.events.filter(e=>e.type==='expense'&&e.merchant==='Netflix'&&e.account==='Checking');
assert.deepEqual(netflix.map(e=>e.date),['2026-11-14','2026-12-14','2027-01-14'],
 'Shared future cash forecast has exactly one debit per cycle, no duplicates in Budget or Overview');
assert.equal(new Set(netflix.map(e=>e.id)).size,netflix.length);
for(const month of ['2026-11','2026-12','2027-01']){
 const total=['Subscriptions','Housing'].reduce((sum,cat)=>sum+(shared.categoryViews[month+'|'+cat]?.additional||0),0);
 assert.equal(total,19.99,'Monthly category totals never double-book a single recurring charge');
}
assert.equal(shared.categoryViews['2026-10|Subscriptions'].actual,19.99,
 'October posted spending is historical, not predicted a second time');
assert.equal(shared.categoryViews['2026-08|Housing'],undefined,
 'Shared 90-day forecast does not retroactively change the past month');
assert.equal(JSON.stringify(transactions),original,'Bank facts unchanged by recurring edits');
// A legacy state could already contain two sibling rules. Forecasting still
// projects a single merchant identity, not one payment for each historical category.
const legacy=M.migrate({transactions,predictions:{patternRules:{
 [recentKey]:rule('2026-10-14'),[historicalKey]:rule('2026-08-14')
}}});
const old=L.build(legacy,M.records(legacy),'2026-10-19',90,F,M).events.filter(e=>e.merchant==='Netflix'&&e.account==='Checking'&&e.type==='expense');
assert.deepEqual(old.map(x=>x.date),netflix.map(x=>x.date),'Legacy category-split rules cannot double bill');
M.setPatternRule(s,M.recurringRuleKey(s,'expense','Subscriptions','Checking','Netflix'),{mode:'none'});
assert.equal(Object.keys(s.predictions.patternRules).length,1,'Not recurring is one shared rule across both categories');
assert.equal(L.build(s,M.records(s),'2026-10-19',90,F,M).events.filter(e=>e.merchant==='Netflix'&&e.account==='Checking'&&e.type==='expense').length,0,
 'Disabling a merchant applies to all historical months and categories');
M.setPatternRule(s,M.recurringRuleKey(s,'expense','Housing','Checking','Netflix'),null);
assert.equal(Object.keys(s.predictions.patternRules).length,0,'Reset removes historical aliases');
console.log('PASS monthly recurring rule reconciliation across past/future dates, differing categories, legacy duplicate rules, separate accounts, bank immutability');
