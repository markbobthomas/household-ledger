'use strict';
// Injected ONLY by offline test subprocess. Prevents all external network calls.
let stage=0;
global.fetch=async function(url,options){
 const p=new URL(url).pathname,body=JSON.parse(options.body||'{}');
 let data;
 switch(p){
  case '/link/token/create':data={link_token:'link-test'};break;
  case '/item/public_token/exchange':data={access_token:'secret-test-access-token',item_id:'test-item'};break;
  case '/accounts/get':data={accounts:[{account_id:'acct-1',name:'Test Checking',mask:'1234',type:'depository',subtype:'checking',balances:{current:321.45,available:300.10,iso_currency_code:'USD'}},{account_id:'acct-2',name:'Unselected',type:'credit',balances:{current:9999}}]};break;
  case '/transactions/sync':
   data={added:stage++===0?[{transaction_id:'pending-1',account_id:'acct-1',date:'2026-10-19',name:'Test pending',amount:10,pending:true}]:[{transaction_id:'posted-1',pending_transaction_id:'pending-1',account_id:'acct-1',date:'2026-10-19',name:'Test posted',amount:10,pending:false}],modified:[],removed:[],has_more:false,next_cursor:'cursor-'+stage};break;
  case '/item/remove':data={removed:true};break;
  default:throw Error('Unexpected Plaid route in mock '+p);
 }
 return {ok:true,json:async()=>data};
};
