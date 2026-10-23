'use strict';
const assert=require('node:assert/strict');
global.document={addEventListener(){}};
require('../planner-summary.js');
const tool=global.HouseholdPlannerSummary;
const iso=(offset)=>{const d=new Date('2026-10-21T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)};
const series=Array.from({length:1096},(_,i)=>({
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
for(const days of [1095]){
 const html=tool.render({...opts,days});
 assert.match(html,/3-year low/);
 assert.match(html,/3-year low/);
 assert.doesNotMatch(html,/data-summary-days|Major payments|Payment checklist/);
 assert.match(html,/data-summary-low-date/);
 assert.match(html,new RegExp(days+'-day forecast'));
 assert.match(html,/data-calendar-stage/);
 assert.match(html,/data-calendar-day="2026-10-21"/);
 assert.match(html,/Projected account balance|Account balance after daily activity/);
 assert.match(html,/calendar-day-detail/);
 assert.doesNotMatch(html,/class="calendar-math"/,
  'An empty day must not repeat the unchanged balance via a zero-only breakdown');
 assert.match(html,/End-of-day balance/);
 assert.match(html,/calendar-day-ending/,
  'Single balance footer comes after daily transactions and actions');
 assert.equal((html.match(/calendar-math-total/g)||[]).length,1,
  'A selected date has one end-of-day total in its panel footer');
 assert.doesNotMatch(html,/calendar-detail-balance/,
  'Do not repeat end-of-day balance in the selected date header');
 assert.equal((html.match(/No transactions predicted for this day/g)||[]).length,1,
  'An empty selected day explains its absence of payments once');
 assert.doesNotMatch(html,/Expand ↓/,
  'Native monthly disclosure should not also print a redundant expand prompt');
 assert.match(html,/data-calendar-add/,'Add an existing-day transaction without a tab change');
 assert.match(html,/Balance trend<\/summary>/);
 assert.match(html,/Illustration, not a guaranteed minimum/);
 assert.match(html,/everyday unplanned spending is excluded/);
 assert.equal(tool.getPoints(derived,iso(0),days).length,days+1);
 assert.match(html,/calendar-day-balance/);
 assert.match(html,/data-calendar-nav="1"/);
 assert.match(html,/End-of-day balance/);
}
const long=tool.render({...opts,days:1095});
assert.match(long,/Property tax|Insurance|No dated transactions that day/);
assert.match(long,/calendar-grid/);
assert.match(long,/aria-label="Next forecast month"/);
assert.match(long,/low estimate far in the future is especially uncertain/i);
const short=tool.render({...opts,days:30});
assert.match(short,/Add a schedule →/);
assert.match(short,/data-view="schedules"/,
 'An empty forecast should invite schedule setup instead of claiming accuracy');
const caution=tool.render({...opts,days:180,bundle:{
 historyCandidates:[{accountId:'checking'}],missingMortgages:[],duplicateConflicts:[],
 payments:{warnings:[]},routines:{warnings:[]},
 projection:{diagnostics:{unassigned:[],unmatchedTransfers:[]}}
}});
assert.doesNotMatch(caution,/Major payments|Payment checklist/,
 'Forecast uncertainty must not reintroduce ambiguous automatic coverage UI');
const bad=tool.render({...opts,days:90,fresh:false});
assert.match(bad,/Calendar needs attention/);
assert.match(bad,/data-repair-refresh/);
assert.match(bad,/data-repair-close/);
assert.match(bad,/Bank connections/);
assert.doesNotMatch(bad,/data-summary-plot/);
assert.doesNotMatch(bad,/data-calendar-stage/);
assert.equal(tool.getPoints(derived,iso(0),1095).at(-1).date,iso(1095),
 'The full three-year forecast is modeled rather than truncated to one year');
const liveView=tool.render({...opts,days:1095,chosen:{...opts.chosen,current:5650.25,available:5400.25},
 snapshot:{...opts.snapshot,connected:true},isReal:true});
assert.ok(liveView.includes('data-bank-current-value>$5,650.25<'));
assert.match(liveView,/Plaid current balance/);
assert.ok(!liveView.includes('data-bank-current-value>$5,400.25<'));
for(const n of [10,30,90,180,360,1095])
 assert.ok(liveView.includes('data-trend-days="'+n+'"'));
const noCurrent=tool.render({...opts,days:1095,chosen:{...opts.chosen,current:null,available:5000}});
assert.ok(noCurrent.includes('data-bank-current-value>Not reported<'));
console.log('PASS three-year lowest-balance Summary: single minimum, no major-payments checklist, warnings and unverified suppression');
