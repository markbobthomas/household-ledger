'use strict';
// Fictional provider mock used only in isolated local smoke server processes.
// Never run a real TinyFish/Amazon task from banking CI.
const fs=require('node:fs');
const previous=globalThis.fetch;
globalThis.fetch=async (url,options={})=>{
 const target=String(url);
 if(!target.startsWith('https://agent.tinyfish.ai/'))return previous(url,options);
 if(process.env.TINYFISH_MOCK_LOG)fs.appendFileSync(process.env.TINYFISH_MOCK_LOG,target+'\n');
 if(target==='https://agent.tinyfish.ai/v1/wallet')
  return {ok:true,status:200,json:async()=>({available_balance:'5.0',currency:'USD'})};
 throw Error('Unexpected paid TinyFish request in fictional banking test');
};
