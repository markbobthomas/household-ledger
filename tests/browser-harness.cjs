'use strict';
// Fictional browser tests can share the expensive browser launches in the CI
// suite while keeping their own fresh contexts and independently started test servers.
// Running a spec directly preserves standalone launch/close semantics.
const playwright=require('playwright');
const shared=process.env.LEDGER_SHARED_BROWSER_SUITE==='1';
const launched=new Map();
function driver(name){
 return {
  async launch(options){
   if(!shared)return playwright[name].launch(options);
   if(!launched.has(name))launched.set(name,playwright[name].launch(options));
   const browser=await launched.get(name);
   return new Proxy(browser,{get(target,prop){
    // A spec's finally closes its lease, not the pooled browser.
    if(prop==='close')return async()=>{};
    const value=Reflect.get(target,prop,target);
    return typeof value==='function'?value.bind(target):value;
   }});
  }
 };
}
async function shutdown(){
 const results=await Promise.allSettled([...launched.values()]);
 await Promise.all(results.filter(r=>r.status==='fulfilled').map(r=>r.value.close()));
 launched.clear();
}
module.exports={chromium:driver('chromium'),webkit:driver('webkit'),shutdown};
