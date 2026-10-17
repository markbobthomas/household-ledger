/* Separately authored fictional household with seasonal wages and business income. */
(function(root){'use strict';
function buildScenario(){
 const rows=[];let serial=0;
 const add=(date,merchant,amount,category,type='expense',account='Checking',cadence=null,direction=null)=>{
  rows.push({id:'seasonal-'+(++serial),date,merchant,amount:Math.round(amount*100)/100,
   category,type,account,cashDirection:direction,source:{provider:'scenario',verified:false},
   scenarioTruth:{recurring:Boolean(cadence),cadence:cadence||null}});
 };
 for(let y=2024;y<=2026;y++)for(let m=1;m<=12;m++){
  if(y===2024&&m<10||y===2026&&m>10)continue;
  const idx=(y-2024)*12+m-10,key=y+'-'+String(m).padStart(2,'0'),d=n=>key+'-'+String(n).padStart(2,'0');
  add(d(23),'Coastal Rent',1490,'Housing','expense','Checking','monthly');
  add(d(4),'District Heating',95+Math.round(55*Math.cos((m-1)*Math.PI/6)),'Utilities','expense','Checking','monthly');
  add(d(15),'Monthly Transit Card',74,'Transportation','expense','Checking','monthly');
  add(d(2),'Dental Plan',45,'Health','expense','Checking','monthly');
  add(d(17),'Online Storage Service',9.5,'Subscriptions','expense','Checking','monthly');
  if(m%3===2)add(d(20),'Home Contents Coverage',146,'Insurance','expense','Checking','quarterly');
  if(m===6)add(d(28),'Annual Arts Cooperative',90,'Entertainment','expense','Checking','annual');
  if(![6,7,8].includes(m)){
   add(d(8),'Teaching Contract Wages',1670,'Other','income','Checking','twice monthly');
   add(d(22),'Teaching Contract Wages',1670,'Other','income','Checking','twice monthly');
  }
  if(idx%2!==0)add(d(26),'Craft Projects Client',180+(idx*71)%450,'Other','income','Business');
  add(d(14),'Emergency Fund Transfer',120,'Other','transfer','Checking','monthly','out');
  add(d(14),'Emergency Fund Transfer',120,'Other','transfer','Savings','monthly','in');
  for(let i=0;i<3;i++)add(d(5+(idx*3+i*9)%22),'Farmers Market',35+(idx*17+i*43)%89,'Groceries');
  add(d(9+(idx%12)),'Community Hardware',30+(idx*29)%180,'Shopping');
  if(idx%4===0)add(d(27),'Bike Service Repair',95+idx*6,'Transportation');
 }
 rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 return rows;
}
const api={buildScenario};root.HouseholdAccuracySeasonal=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
