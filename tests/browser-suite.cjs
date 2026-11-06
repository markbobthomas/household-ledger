'use strict';
// Run one browser spec at a time; reuse browsers, not storage, context or test data.
process.env.LEDGER_SHARED_BROWSER_SUITE='1';
const path=require('node:path');
const {resolve}=require('./ci-suite.cjs');
const {shutdown}=require('./browser-harness.cjs');
(async()=>{
 try{
  for(const name of resolve('browser')){
   console.log('Browser regression: '+name);
   const result=require(path.join(__dirname,name+'.cjs'));
   if(!result||typeof result.then!=='function')throw Error(name+' did not export a completion promise');
   await result;
   if(process.exitCode)throw Error('Browser regression failed: '+name);
  }
 }catch(error){
  console.error('Browser suite failed:',error);
  process.exitCode=1;
 }finally{
  await shutdown();
 }
})();
