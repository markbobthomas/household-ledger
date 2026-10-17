/* Entirely fictional, deterministic 25-month scenario with hidden future actuals.
 * Nothing here is appended to browser/local ledger or used as a bank balance.
 */
(function(root){
'use strict';
function dateFromUTC(y,m,d){return new Date(Date.UTC(y,m-1,d,12))}
function iso(d){return d.toISOString().slice(0,10)}
function shift(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return iso(d)}
function month(y,m){return y+'-'+String(m).padStart(2,'0')}
function buildScenario(){
 const transactions=[];
 let serial=0;
 const add=(date,merchant,amount,category,type='expense',account='Checking',notes='',truthCadence=null)=>{
  transactions.push({id:'scenario-'+(++serial),date,merchant,amount:Math.round(amount*100)/100,category,type,
   account,description:notes||'Fictional scenario data',scenarioTruth:truthCadence?{recurring:true,cadence:truthCadence}:{recurring:false},source:{provider:'scenario',verified:false}});
 };
 // 25 months: October 2024 through October 2026.
 for(let y=2024;y<=2026;y++)for(let m=1;m<=12;m++){
  if(y===2024&&m<10||y===2026&&m>10)continue;
  const key=month(y,m),idx=(y-2024)*12+m-10;
  const d=n=>key+'-'+String(n).padStart(2,'0');
  // Predictable expenses, with variable bill amounts and day slippage.
  add(d(2),'Home Mortgage',2680,'Housing','expense','Checking','','monthly');
  add(d(4),'Northwest Electric',Math.round((118+58*Math.cos((m-1)*Math.PI/6)+(idx%3)*3)*100)/100,'Utilities','expense','Checking','','monthly');
  add(d(6),'Fiber Internet',82,'Utilities','expense','Checking','','monthly');
  add(d(12),'Cinema Stream',18.99,'Subscriptions','expense','Checking','','monthly');
  add(d(15),'Childcare Center',815,'Kids & Family','expense','Checking','','monthly');
  add(d(21),'Music Stream',11.99,'Subscriptions','expense','Checking','','monthly');
  add(d(27),'Water Utility',67+((idx%4)*5),'Utilities','expense','Checking','','monthly');
  add(d(10),'Credit Card Settlement',1100,'Other','transfer'); // checking outflow, not consumption
  transactions[transactions.length-1].cashDirection='out';
  // Quarterly vendor, with slightly moving posting dates.
  if(m%3===1)add(d(18+(idx%2)),'Quarterly Pest Service',90+(idx%3)*3,'Utilities','expense','Checking','','quarterly');
  // Semiannual bill, due in May and November.
  if([5,11].includes(m))add(d(9),'Car Insurance Semiannual',680+(y-2024)*20,'Insurance','expense','Checking','','semiannual');
  // Annual subscription, renews each November.
  if(m===11)add(d(12),'Annual Digital Membership',129+(y-2024)*4,'Subscriptions','expense','Checking','','annual');
  // Rent-like monthly and semimonthly salary for income tests.
  add(d(1),'Partner Salary',1850,'Other','income','Checking','','twice monthly');
  add(d(16),'Partner Salary',1850,'Other','income','Checking','','twice monthly');
  // Day-shifting household shopping; deliberately not predictably dated.
  const irregularDays=[8+(idx%7),17+(idx%9),24+(idx%4)];
  const irregularAmounts=[81+(idx*19)%64,45+(idx*37)%81,119+(idx*23)%97];
  irregularDays.forEach((day,i)=>add(d(day),'Neighborhood Grocer',irregularAmounts[i],'Groceries'));
  add(d(9+(idx%5)),'Hardware Outlet',52+(idx*53)%250,'Shopping');
  if(idx%3!==0)add(d(13+(idx%9)),'Online Marketplace',26+(idx*47)%175,'Shopping');
  if(idx%5===0)add(d(14),'Surprise Repair',100+idx*6,'Housing'); // not recurring
  // A stale bill that ended over a year ago must never reappear in a forecast.
  if(y===2024||y===2025&&m<=2)add(d(23),'Canceled Video Service',9.99,'Subscriptions','expense','Checking','','monthly');
 }
 // Biweekly paychecks: same account, strong date interval, across calendar boundaries.
 let pay=dateFromUTC(2024,10,4);
 while(iso(pay)<='2026-10-31'){
  add(iso(pay),'Primary Paycheck',3920,'Other','income','Checking','','every 2 weeks');
  pay.setUTCDate(pay.getUTCDate()+14);
 }
 // Weekly carpool subscription with 4-5 charges per month.
 let weekly=dateFromUTC(2025,1,7);
 while(iso(weekly)<='2026-10-31'){
  add(iso(weekly),'Weekly Shuttle',13.50,'Subscriptions','expense','Checking','','weekly');
  weekly.setUTCDate(weekly.getUTCDate()+7);
 }
 // A frequently used grocery chain without stable invoice dates/amounts.
 // No deterministic exact payment should be inferred from it.
 transactions.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 return transactions;
}
const api={buildScenario,shift};
root.HouseholdAccuracyFixture=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
