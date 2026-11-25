'use strict';
const assert=require('node:assert/strict');
const S=require('../browser/amazon-ledger/scraper.js');
const fake=(text,products)=>{
 const links=products.map(p=>({textContent:p}));
 return {textContent:text,querySelectorAll:()=>links};
};
const id='113-1234567-7654321';
const text='ORDER PLACED Nov 22, 2026 ORDER TOTAL $29.50 ORDER # '+id+' Delivered';
const card=fake(text,['Laundry detergent, 50 oz']);
const out=S.parseCard(card);
assert.deepEqual(out.row,{orderId:id,date:'2026-11-22',title:'Laundry detergent, 50 oz',cents:2950});
assert.equal(S.parseDate('Feb 30, 2026'),'');
assert.equal(S.parseDate('September 9, 2026'),'2026-09-09');
assert.equal(S.parseMoney('$1,234.56'),123456);
assert.equal(S.parseMoney('$2.0'),null);
const ambiguous=S.parseCard(fake(text+' 2 items',['Laundry detergent','Kids jacket']));
assert.equal(ambiguous.reason,'multi-item-or-unreadable');
const multiOnlyOneTitle=S.parseCard(fake(text+' 3 items',['Laundry detergent']));
assert.equal(multiOnlyOneTitle.reason,'multi-item-or-unreadable');
const missingCharge=S.parseCard(fake('ORDER PLACED Nov 22, 2026 ORDER # '+id,['Laundry detergent']));
assert.equal(missingCharge.reason,'date-or-charge-unknown');
const duplicateOrders=S.parseCard(fake(text+' 113-9999999-9999999',['Laundry detergent']));
assert.equal(duplicateOrders.reason,'invalid-order');
const seen=new Set(),fixture={querySelectorAll:()=>[card,card,ambiguous]};
const extracted=S.scanDocument(fixture,seen);
assert.equal(extracted.rows.length,1);
assert.equal(extracted.seenCount,1);
const csv=S.toCSV([{...out.row,title:'Detergent, "Premium"\n100 oz'}]);
assert.match(csv,/"Detergent, ""Premium"" 100 oz"/);
const A=require('../pilot/amazon-import.cjs');
const rows=A.extractCSV(csv);
assert.equal(rows.length,1);
assert.equal(rows[0].cents,2950);
const match=A.match(rows,{t:{id:'t',merchant:'Amazon Marketplace',name:'AMAZON',date:'2026-11-24',amount:29.50,pending:false}},{categoryOverrides:{}},['Home & Maintenance','Uncategorized']);
assert.equal(match.matches.length,1);
assert.equal(match.matches[0].lines[0].category,'Home & Maintenance');
assert.equal(match.matches[0].lines.reduce((a,l)=>a+l.cents,0),2950);
const fs=require('node:fs'),path=require('node:path');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../browser/amazon-ledger/manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.ok(!manifest.permissions.includes('cookies'));
assert.ok(!manifest.host_permissions,'No always-on host permission');
const background=fs.readFileSync(path.join(__dirname,'../browser/amazon-ledger/background.js'),'utf8');
assert.ok(background.includes('new File([csv]'),'Uses existing authenticated import page');

assert(manifest.permissions.includes('alarms'),'Periodic sync must declare MV3 alarms');
assert.ok(!manifest.permissions.includes('cookies'),'No Amazon cookie API or stored credentials');
const vm=require('node:vm');
(async()=>{
 const fixtureCsv=csv;
 const saved={ledgerOrigin:'https://ledger.example.test',autoEnabled:false};
 const tabs=new Map(),created=[],removed=[],alarmCalls=[],uploads=[];
 let tabCounter=0,listener=null,alarmListener=null,onStartup=null,onInstalled=null,allowAmazon=true,amazonRedirect=false;
 const fakeChrome={
  runtime:{id:'extension-fixture',onMessage:{addListener(fn){listener=fn}},
   onStartup:{addListener(fn){onStartup=fn}},onInstalled:{addListener(fn){onInstalled=fn}}},
  storage:{local:{
   async get(keys){
    return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,saved[k]]));
   },async set(obj){Object.assign(saved,obj)}
  }},
  permissions:{async contains({origins}){
   return origins.every(x=>x==='https://www.amazon.com/*'?allowAmazon:
    x==='https://ledger.example.test/*');
  }},
  alarms:{onAlarm:{addListener(fn){alarmListener=fn}},
   async clear(name){alarmCalls.push({action:'clear',name})},
   async create(name,params){alarmCalls.push({action:'create',name,...params})}
  },
  tabs:{
   async get(id){return tabs.get(id)},
   async create({url,active}){
    const tab={id:++tabCounter,url:amazonRedirect&&url.includes('amazon.com')?
      'https://www.amazon.com/ap/signin':url,status:'complete',active};
    tabs.set(tab.id,tab);created.push(tab);return tab;
   },
   async remove(id){removed.push(id);tabs.delete(id)},
   async update(id){return tabs.get(id)},
   onUpdated:{addListener(){},removeListener(){}}
  },
  scripting:{async executeScript(options){
   const tab=tabs.get(options.target.tabId);
   assert.ok(tab,'Cannot inject into an unknown tab');
   if(options.files){
    assert.deepEqual(Array.from(options.files),['scraper.js']);
    return [{result:true}];
   }
   if(tab.url.includes('amazon.com'))return [{result:await options.func()}];
   assert(tab.url.startsWith('https://ledger.example.test/amazon-import'));
   return [{result:await options.func(...options.args)}];
  }}
 };
 const fetch=async(url,options={})=>{
  if(url==='/api/ledger/amazon-review')return {ok:true,
   headers:{get:k=>k==='x-ledger-revision'?'a'.repeat(64):null}};
  if(url==='/api/ledger/amazon-import'){
   uploads.push({url,options});
   assert.equal(options.method,'POST');
   assert.equal(options.credentials,'same-origin');
   assert.equal(options.headers['X-Pilot-Action'],'1');
   assert.equal(options.headers['X-Ledger-Revision'],'a'.repeat(64));
   assert.equal(options.headers['X-Amazon-Dry-Run'],'0');
   assert.equal(await options.body.text(),fixtureCsv);
   return {ok:true,json:async()=>({applied:1,notesReady:1,confidentCategories:1})};
  }
  throw Error('Unexpected private Ledger route: '+url);
 };
 vm.runInNewContext(background,{chrome:fakeChrome,URL,Date,Blob,fetch,setTimeout,
  clearTimeout,console,LedgerAmazonScraper:{scan:()=>({csv:fixtureCsv,items:1,pages:1,skipped:0})}},
  {filename:'background.js'});
 function send(type,extra={}){
  return new Promise((resolve,reject)=>{
   if(!listener({type,...extra},{id:'extension-fixture'},resolve))
    reject(Error('Extension did not accept '+type));
  });
 }
 onStartup();await new Promise(r=>setTimeout(r,0));
 assert.equal(alarmCalls.filter(c=>c.action==='create').length,0,'Automatic sync off by default');
 assert.equal((await send('LEDGER_AMAZON_AUTO_ENABLE')).enabled,true);
 assert.equal(saved.autoEnabled,true);
 assert.equal(alarmCalls.find(c=>c.action==='create')?.periodInMinutes,360);
 const first=await send('LEDGER_AMAZON_AUTO_NOW');
 assert.equal(first.ok,true);
 assert.equal(first.applied,1);
 assert.equal(uploads.length,1);
 assert.equal(created.length,2,'Background sync creates an Amazon tab and a Ledger tab');
 assert.equal(removed.length,2,'Background tabs close after successful save');
 assert.ok(saved.lastAutoSuccess);
 assert.equal(saved.lastAutoResult.applied,1);
 assert.equal(saved.lastAutoError,'');
 assert(!Object.hasOwn(saved,'amazonPassword'),'No Amazon password is persisted');
 assert(!Object.hasOwn(saved,'orderCsv'),'No order CSV is persisted');
 alarmListener({name:'ledger-amazon-every-six-hours'});
 await new Promise(r=>setTimeout(r,25));
 assert.equal(uploads.length,2,'Scheduled alarm imports without another click');
 amazonRedirect=true;
 const failed=await send('LEDGER_AMAZON_AUTO_NOW');
 assert.equal(failed.ok,false,'Amazon sign-in interruption is not a success');
 assert.match(failed.error,/sign-in or verification/);
 assert.match(saved.lastAutoError,/sign-in or verification/);
 assert.equal(removed.length,5,'Amazon tab closes even on failed sign-in');
 const prior=uploads.length;
 assert.equal((await send('LEDGER_AMAZON_AUTO_DISABLE')).enabled,false);
 assert.equal(saved.autoEnabled,false);
 alarmListener({name:'ledger-amazon-every-six-hours'});
 await new Promise(r=>setTimeout(r,10));
 assert.equal(uploads.length,prior,'No import occurs after disabling');
 assert.equal(created.length,5,'No new background tabs after disabling');
 assert.equal(typeof onInstalled,'function');
 console.log('Automatic six-hour Amazon sync: alarm, consent, private save, status, sign-in recovery, disable PASS');
})().catch(error=>{console.error(error);process.exitCode=1});

console.log('Amazon browser sync: conservative extraction, CSV interop, bank matching, extension permissions PASS');
