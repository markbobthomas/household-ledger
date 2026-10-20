'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const script=fs.readFileSync(path.resolve(__dirname,'../pilot/data-source.js'),'utf8');
const data={
 connected:true,lastSync:'2026-10-20T00:00:00Z',
 accounts:[{id:'checking',name:'Checking',type:'depository',subtype:'checking',
  current:4500,available:4500}],
 transactions:[{id:'secret-transaction-not-to-send',accountId:'checking',
  date:'2026-09-20',merchant:'Personal mortgage',amount:2000,pending:false}],
 adjustments:{categoryOverrides:{'old-deleted-id':'Housing'},predictions:{}}
};
let mode='demo',errorOnce=true;
const requests=[];
function response(status,body){
 return {status,ok:status>=200&&status<300,
  headers:{get:()=> 'application/json'},json:async()=>body};
}
const fetch=async(uri,options={})=>{
 requests.push({uri,options});
 if(uri==='/api/ledger')return response(200,data);
 if(uri==='/api/ledger/adjustments')return response(400,{error:'Invalid category override'});
 if(uri!=='/api/ledger/forecasts')throw Error('Unexpected URL '+uri);
 if(errorOnce){errorOnce=false;return response(503,{error:'Forecast settings temporarily unavailable'})}
 return response(200,{saved:true,scope:'predictions'});
};
const root={HouseholdLedgerData:{migrate:x=>x},
 HouseholdCategorization:{classify:()=>({category:'Housing'}),loanBill:()=>({isBill:true})}};
const localStorage={getItem:k=>k==='household-ledger-view-mode'?mode:null,
 setItem(k,v){if(k==='household-ledger-view-mode')mode=v}};
const document={addEventListener(){},getElementById(){return null}};
vm.runInNewContext(script,{window:root,globalThis:root,document,localStorage,
 fetch,console,Date,JSON,Promise,Number,String,Object,Array,Error,RegExp,Math});
(async()=>{
 let loaded=null,rendered=0;
 root.HouseholdLiveSource.bind({render(){rendered++},
  enterReal(state){loaded=state},enterDemo(){},enterUnavailable(){}});
 await root.HouseholdLiveSource.enterReal();
 assert.ok(loaded,'The test should be in connected Real mode');
 const rule={kind:'event',merchant:'Personal mortgage',amount:2000,frequency:'monthly',
  accountId:'checking',date:'2026-11-20'};
 const pending={cashCushion:500,futureRecurringRules:[rule]};
 await assert.rejects(root.HouseholdLiveSource.persistForecast(pending),
  /Forecast settings temporarily unavailable/,
  'Server error should be shown, not replaced with a generic bank message');
 const first=requests.find(x=>x.uri==='/api/ledger/forecasts');
 assert.deepEqual(Object.keys(JSON.parse(first.options.body)),['predictions'],
  'A forecast confirmation must not resubmit bank classification rules');
 assert.equal(first.options.headers['X-Pilot-Action'],'1');
 const one=root.HouseholdLiveSource.persistForecast(pending);
 pending.cashCushion=250;
 const two=root.HouseholdLiveSource.persistForecast(pending);
 const results=await Promise.all([one,two]);
 assert.ok(results.every(x=>x.saved===true));
 const saves=requests.filter(x=>x.uri==='/api/ledger/forecasts');
 assert.equal(saves.length,3,'Failure and both retried edits are sent individually');
 assert.equal(JSON.parse(saves[1].options.body).predictions.cashCushion,500,
  'A queued save captures its state before later user edits');
 assert.equal(JSON.parse(saves[2].options.body).predictions.cashCushion,250,
  'Last forecast edit is persisted last');
 assert.equal(requests.filter(x=>x.uri==='/api/ledger/adjustments').length,0,
  'No stale bank category endpoint is used for predicted payments');
 assert.ok(saves.every(x=>!JSON.stringify(JSON.parse(x.options.body)).includes('secret-transaction-not-to-send')),
  'Actual bank records never leave the browser as part of forecast saves');
 assert.equal(root.HouseholdLiveSource.error,'','Recovering from a transient save failure clears error state');
 console.log('PASS forecast-only client saves: error surfaced, rollback-compatible retry, queued snapshot isolation, no stale category overrides and no bank facts posted');
})().catch(e=>{console.error(e);process.exitCode=1});
