'use strict';
// Server-only, read-only planning snapshot. This process-memory projection is
// never saved to disk, browser storage, or exposed without pilot authentication.
// Import the exact same policies used by the browser, not a second forecast.
require('../accounting.js');
require('../categorization.js');
const model=require('../ledger-data.js');
const tools=require('../planner-transactions.js');
const payments=require('../payment-obligations.js');
const engine=require('../planner-core.js');
const feed=require('./data-source.js');

const HORIZON=1095;
const VERSION='canonical-1095-friday-v1';
// The household's normal Pacific calendar date is used only as a cache
// optimization; a browser in another zone must fall back to its own as-of.
function pacificDate(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const value=type=>parts.find(p=>p.type===type)?.value||'';
 return value('year')+'-'+value('month')+'-'+value('day');
}
function prepare(payload,asOf=pacificDate()){
 if(!payload?.connected||!Array.isArray(payload.accounts)||!payload.accounts.length)return null;
 const {state,snapshot}=feed.prepare(payload,asOf);
 const bundle=engine.materialize(snapshot,model.records(state),state.predictions||{},
  tools,payments,HORIZON,{weekendPolicy:'friday'});
 // Only the derived bundle is sent; never include process-memory bank tokens,
 // passwords, encryption keys, or an extra raw bank-history copy.
 return {version:VERSION,asOf,horizon:HORIZON,bundle};
}
module.exports={prepare,pacificDate,VERSION,HORIZON};
