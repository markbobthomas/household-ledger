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
 assert.doesNotMatch(html,/calendar-balance-explainer/,
  'Redundant explanation does not consume space above calendar');
 assert.doesNotMatch(html,/data-summary-days|Major payments|Payment checklist/);
 assert.match(html,/data-summary-low-date/);
 assert.doesNotMatch(html,/data-summary-plot|summary-extras/,
  'Calendar no longer embeds the Balance Trend chart or disclosure');
 assert.match(html,/data-calendar-stage/);
 assert.match(html,/data-summary-month-low/);
 assert.match(html,/data-summary-month-value/);
 assert.match(html,/data-calendar-month-low/);
 assert.match(html,/month-minimum/);
 assert.match(html,/Lowest this month/);
 assert.match(html,/data-summary-month-value>\$5,000\.00<\/strong>/,
  'October monthly low must be the first $5,000 day rather than later higher balances');
 assert.match(html,/data-calendar-month-low="2026-10-21"/,
  'Monthly minimum date must match the actual lowest day');
 assert.match(html,/data-calendar-day="2026-10-21"[^>]*month-minimum|month-minimum[^>]*data-calendar-day="2026-10-21"/,
  'Calendar must highlight the minimum day, not the maximum');
 assert.match(html,/data-calendar-day="2026-10-21"/);
 assert.match(html,/class="summary-heading calendar-toolbar"/,
  'Account and month controls share the same compact Calendar header');
 assert.match(html,/class="calendar-navigation" data-calendar-header/,
  'Month navigation lives in the account header');
 assert.match(html,/aria-label="October 2026 forecast calendar"/,
  'The calendar grid retains its accessible month and forecast description');
 assert.equal((html.match(/class="calendar-navigation"/g)||[]).length,1,
  'No duplicate month toolbar remains below the balance metrics');
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
 assert.doesNotMatch(html,/Balance trend<\/summary>|summary-trend-ranges/,
  'The trend belongs exclusively on the More-menu page');
 assert.equal(tool.getPoints(derived,iso(0),days).length,days+1);
 assert.match(html,/calendar-day-balance/);
 assert.match(html,/data-calendar-nav="1"/);
 assert.match(html,/End-of-day balance/);
}
const long=tool.render({...opts,days:1095});
assert.doesNotMatch(long,/data-summary-plot|data-trend-days/,
 'Calendar excludes detailed trend inspection');
assert.match(long,/calendar-grid/);
assert.match(long,/aria-label="Next forecast month"/);
const trend=tool.render({...opts,days:1095,view:'trend'});
assert.match(trend,/class="planner-page summary-page trend-page"/);
assert.match(trend,/<h2>Balance Trend<\/h2>/);
assert.match(trend,/data-summary-plot/);
assert.match(trend,/Property tax|Insurance|No dated transactions that day/,
 'Trend page continues to expose future movement details');
assert.match(trend,/Illustration, not a guaranteed minimum/);
assert.match(trend,/everyday unplanned spending is excluded/);
assert.match(trend,/low estimate far in the future is especially uncertain/i);
assert.doesNotMatch(trend,/data-calendar-stage|class="calendar-grid"/);
assert.match(trend,/id="summary-account"/);
assert.equal((trend.match(/data-summary-plot/g)||[]).length,1,
 'Only one interactive forecast chart is rendered on the trend page');
const short=tool.render({...opts,days:30});
assert.match(short,/Add a prediction →/);
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
assert.ok(liveView.includes('data-bank-available-value>$5,400.25<'));
assert.match(liveView,/Available today/);
assert.doesNotMatch(liveView,/Current:|Actual Current Balance|5,650\.25/,
 'Checking Calendar shows available only, never the bank current balance');
const pendingDisplayed=tool.render({...opts,days:1095,
 chosen:{...opts.chosen,current:6800,available:5600},
 snapshot:{...opts.snapshot,connected:true},isReal:true});
const postedDisplayed=tool.render({...opts,days:1095,
 chosen:{...opts.chosen,current:5600,available:5600},
 snapshot:{...opts.snapshot,connected:true},isReal:true});
assert.match(pendingDisplayed,/data-bank-available-value>\$5,600\.00</);
assert.match(postedDisplayed,/data-bank-available-value>\$5,600\.00</,
 'Pending-to-posted settlement leaves the visible available balance consistent');
assert.doesNotMatch(pendingDisplayed,/6,800\.00/,
 'Pending account current balance is not shown as extra cash');
const missingAvailable=tool.render({...opts,days:1095,
 chosen:{...opts.chosen,current:6000,available:null},
 snapshot:{...opts.snapshot,connected:true},isReal:true});
assert.match(missingAvailable,/Available today/);
assert.match(missingAvailable,/data-bank-available-value>Not reported</);
assert.doesNotMatch(missingAvailable,/6,000\.00/,
 'Missing bank available cash must not silently fall back to current');
const cardView=tool.render({...opts,days:1095,
 chosen:{...opts.chosen,type:'credit',current:1234.56,available:9000},
 snapshot:{...opts.snapshot,connected:true},isReal:true});
assert.match(cardView,/Actual Current Balance/);
assert.match(cardView,/data-bank-current-value>\$1,234\.56</,
 'Credit-card debt must not be mislabeled as available checking cash');
for(const n of [10,30,90,180,360,1095])
 assert.ok(trend.includes('data-trend-days="'+n+'"'));
assert.doesNotMatch(liveView,/data-trend-days|data-summary-plot/);
const unavailableTrend=tool.render({...opts,days:90,fresh:false,view:'trend'});
assert.match(unavailableTrend,/A verified starting balance is needed for the trend/);
assert.doesNotMatch(unavailableTrend,/data-summary-plot|data-calendar-stage/);
const noCurrent=tool.render({...opts,days:1095,chosen:{...opts.chosen,current:null,available:5000}});
assert.ok(noCurrent.includes('data-bank-available-value>$5,000.00<'));
console.log('PASS three-year lowest-balance Summary: single minimum, no major-payments checklist, warnings and unverified suppression');
