'use strict';
const assert=require('node:assert/strict');
global.document={addEventListener(){}};
require('../planner-summary.js');
const tool=global.HouseholdPlannerSummary;
const iso=(offset)=>{const d=new Date('2026-10-21T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)};
const series=Array.from({length:361},(_,i)=>({
 date:iso(i),balance:5000+(i*20)-(i>=120?2000:0)-(i>=300?1500:0),
 events:i===120?[{merchant:'Property tax',amount:2000}]:[]
}));
const derived={balanceStatus:'fresh',type:'cash',events:[
 {date:iso(120),amount:2000,merchant:'Property tax'},
 {date:iso(300),amount:1500,merchant:'Insurance'}],series};
const snapshot={asOf:iso(0),accounts:[{id:'checking',name:'Checking',type:'depository'}]};
const opts={snapshot,chosen:snapshot.accounts[0],derived,bundle:{historyCandidates:[],
 missingMortgages:[],duplicateConflicts:[],payments:{warnings:[]},
 routines:{warnings:[]},projection:{diagnostics:{unassigned:[],unmatchedTransfers:[]}}},
 prefs:{cashCushion:500},accounts:snapshot.accounts,fresh:true,ready:()=>true};
for(const days of [30,60,90,120,180,360]){
 const html=tool.render({...opts,days});
 assert.match(html,new RegExp('End of '+days+' days'));
 assert.match(html,new RegExp(days+'-day forecast'));
 assert.match(html,/Forecast coverage/);
 assert.match(html,/excludes unplanned everyday spending/);
 assert.equal(tool.getPoints(derived,iso(0),days).length,days+1);
 assert.ok(html.includes(iso(days))===false,'Chart only includes human-formatted dates, no hidden bank facts');
}
const long=tool.render({...opts,days:360});
assert.match(long,/Property tax|Insurance|No dated transactions that day/);
assert.match(long,/longer-range forecasts are less certain/i);
const short=tool.render({...opts,days:30});
assert.doesNotMatch(short,/longer-range forecasts are less certain/i);
const caution=tool.render({...opts,days:90,bundle:{
 historyCandidates:[{accountId:'checking'}],missingMortgages:[],duplicateConflicts:[],
 payments:{warnings:[]},routines:{warnings:[]},
 projection:{diagnostics:{unassigned:[],unmatchedTransfers:[]}}
}});
assert.match(caution,/Needs review/);
assert.match(caution,/data-view="reviews"/);
const bad=tool.render({...opts,days:90,fresh:false});
assert.match(bad,/verifiable account balance/);
assert.doesNotMatch(bad,/data-summary-plot/);
assert.equal(tool.getPoints(derived,iso(0),360).at(-1).date,iso(360));
console.log('PASS concise forecast Summary: all six real date windows, non-overstated coverage, warnings, and unverified suppression');
