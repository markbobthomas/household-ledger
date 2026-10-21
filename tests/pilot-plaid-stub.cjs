'use strict';
// Injected ONLY by offline test subprocess. Prevents all external network calls.
let stage=0,secondStage=0,removals=0;
global.fetch=async function(url,options){
 const p=new URL(url).pathname,body=JSON.parse(options.body||'{}');
 let data;
 switch(p){
  case '/link/token/create':data={link_token:'link-test'};break;
  case '/item/public_token/exchange':data=body.public_token==='public-second'?
 {access_token:'secret-second-access-token',item_id:'test-item-2'}:
 {access_token:'secret-test-access-token',item_id:'test-item'};break;
  case '/accounts/get':data={accounts:[{account_id:'acct-1',name:'Test Checking',mask:'1234',type:'depository',subtype:'checking',balances:{current:321.45,available:300.10,iso_currency_code:'USD'}},{account_id:'acct-2',name:'Test Visa',mask:'5555',type:'credit',subtype:'credit card',balances:{current:900,available:null}}]};break;
  case '/transactions/sync':
   if(body.access_token==='secret-second-access-token'){
    data={added:secondStage++===0?[
     {transaction_id:'credit-charge-1',account_id:'acct-2',date:'2026-10-19',name:'Card groceries',amount:300,pending:false},
     {transaction_id:'credit-payment-1',account_id:'acct-2',date:'2026-10-19',name:'Payment Thank You',amount:-100,pending:false}
    ]:[],modified:[],removed:[],has_more:false,next_cursor:'card-cursor-'+secondStage};
   }else{
    data={added:stage++===0?[{transaction_id:'pending-1',account_id:'acct-1',date:'2026-10-19',name:'Test pending',amount:10,pending:true},
     ...(process.env.PILOT_REMOVE_TEST==='1'?[{transaction_id:'card-from-shared-item',account_id:'acct-2',date:'2026-10-18',name:'Card purchase from shared link',amount:43,pending:false}]:[])]:
    [{transaction_id:'posted-1',pending_transaction_id:'pending-1',account_id:'acct-1',date:'2026-10-19',name:'Test posted',amount:10,pending:false}],
    modified:[],removed:[],has_more:false,next_cursor:'cursor-'+stage};
   }
   break;
  case '/item/remove':
   if(process.env.PILOT_REMOVE_FAIL_FIRST==='1'&&removals++===0)
    return {ok:false,status:400,json:async()=>({error_code:'ITEM_REMOVE_TEMPORARY_FAILURE'})};
   data={removed:true};break;
  default:throw Error('Unexpected Plaid route in mock '+p);
 }
 return {ok:true,json:async()=>data};
};
