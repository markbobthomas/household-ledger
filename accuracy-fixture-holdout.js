/* Independent fictional household for out-of-sample robustness checks.
 * Two accounts: Checking and Savings; transfers have direction.
 */
(function(root){
'use strict';
function buildScenario(){
 const out=[];let id=0;
 const add=(date,merchant,amount,category,type='expense',account='Checking',cadence=null,cashDirection=null)=>{
  out.push({id:'holdout-'+(++id),date,merchant,amount:Math.round(amount*100)/100,
   category,type,account,cashDirection,source:{provider:'scenario',verified:false},
   scenarioTruth:{recurring:Boolean(cadence),cadence:cadence||null}});
 };
 const iso=d=>d.toISOString().slice(0,10),day=(year,mon,n)=>year+'-'+String(mon).padStart(2,'0')+'-'+String(n).padStart(2,'0');
 for(let y=2024;y<=2026;y++)for(let m=1;m<=12;m++){
  if(y===2024&&m<10||y===2026&&m>10)continue;
  const idx=(y-2024)*12+m-10;
  const d=n=>day(y,m,n);
  add(d(3),'Harbor Apartments',1725,'Housing','expense','Checking','monthly');
  add(d(5),'North County Power',75+Math.round(32*Math.cos(m*Math.PI/6))+idx%7*2,
   'Utilities','expense','Checking','monthly');
  if(!(y===2025&&m===11))add(d(8),'Mobile Carrier',66+idx%4*3,'Utilities','expense','Checking','monthly');
  add(d(14),'Study Loan',245,'Transportation','expense','Checking','monthly');
  add(d(19),'Gym Plan',39.99,'Subscriptions','expense','Checking','monthly');
  add(d(15),'Second Salary',1425,'Other','income','Checking','twice monthly');
  const end=new Date(Date.UTC(y,m,0,12)).getUTCDate();
  add(d(end-2),'Second Salary',1425,'Other','income','Checking','twice monthly');
  if(m===4||m===10)add(d(22),'Car Cover Six Month',495+(y-2024)*21,'Insurance','expense','Checking','semiannual');
  if(m===12)add(d(29),'Yearly Software License',98+(y-2024)*7,'Subscriptions','expense','Checking','annual');
  if([1,4,7,10].includes(m))add(d(24),'Window Cleaning Plan',115,'Housing','expense','Checking','quarterly');
  add(d(7),'Savings Sweep',250,'Other','transfer','Checking','monthly','out');
  add(d(7),'Savings Sweep',250,'Other','transfer','Savings','monthly','in');
  add(d(12),'Credit Card Payment',670+idx%4*35,'Other','transfer','Checking','monthly','out');
  const dates=[9+idx%6,16+idx%8,21+idx%6];
  dates.forEach((n,i)=>add(d(n),'Community Food Co-op',38+(idx*23+i*47)%148,'Groceries'));
  add(d(10+idx%8),'Outdoor Shop',39+(idx*67)%275,'Shopping');
  if(idx%3!==1)add(d(14+idx%9),'Online Basket',21+(idx*39)%160,'Shopping');
  if(idx%5===0)add(d(27),'Dental Visit',80+(idx*37)%260,'Health');
  if(idx<8)add(d(25),'Canceled TV',16.75,'Subscriptions','expense','Checking','monthly');
 }
 const biweekly=new Date(Date.UTC(2024,9,11,12));
 while(iso(biweekly)<='2026-10-31'){
  add(iso(biweekly),'Public Sector Payroll',2780,'Other','income','Checking','every 2 weeks');
  biweekly.setUTCDate(biweekly.getUTCDate()+14);
 }
 const weekly=new Date(Date.UTC(2025,0,2,12));
 while(iso(weekly)<='2026-10-31'){
  add(iso(weekly),'Weekly Child Activities',29.50,'Kids & Family','expense','Checking','weekly');
  weekly.setUTCDate(weekly.getUTCDate()+7);
 }
 out.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 return out;
}
const api={buildScenario};
root.HouseholdAccuracyHoldout=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
