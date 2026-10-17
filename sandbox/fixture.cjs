'use strict';
/* Deterministic Plaid-shaped test transport, never a genuine Plaid response. */
function fixtureTransport(){
 let serial=0;
 const publicTokens=new Map(),itemAccess=new Map();
 function createItem(institutionId){
  const id='item_fixture_'+(++serial),token='access_fixture_'+serial;
  const accounts=[
   {account_id:id+'-checking',name:'Test Checking',mask:'0011',type:'depository',subtype:'checking',
    balances:{current:4500,available:4320,iso_currency_code:'USD'}},
   {account_id:id+'-savings',name:'Test Savings',mask:'0022',type:'depository',subtype:'savings',
    balances:{current:2100,available:2100,iso_currency_code:'USD'}},
   {account_id:id+'-card',name:'Test Rewards Card',mask:'0033',type:'credit',subtype:'credit card',
    balances:{current:660,available:4340,iso_currency_code:'USD'}}
  ];
  const tx=(i,accountIndex,amount,name,date,extra={})=>({
   transaction_id:id+'-'+i,account_id:accounts[accountIndex].account_id,
   date,amount,name,merchant_name:name,pending:false,...extra
  });
  const transactions=[
   tx('payroll',0,-2450,'Payroll','2026-10-02'),
   tx('grocery',2,87.45,'Market Grocery','2026-10-04'),
   tx('card-payment-out',0,240,'Credit Card Payment','2026-10-09'),
   tx('card-payment-in',2,-240,'Payment Thank You','2026-10-09'),
   tx('transfer-out',0,180,'Transfer to Savings','2026-10-10'),
   tx('transfer-in',1,-180,'Transfer from Checking','2026-10-10'),
   tx('refund',2,-15.55,'Refund Market Grocery','2026-10-11'),
   tx('pending',2,22.50,'Pending Merchant','2026-10-12',{pending:true})
  ];
  const item={id,token,accounts,transactions,version:0,institutionId};
  itemAccess.set(token,item);return item;
 }
 return async(path,b={})=>{
  if(path==='/sandbox/public_token/create'){
   if(!['ins_109508','ins_109509','ins_109510'].includes(b.institution_id))
    throw Object.assign(Error('Unknown fixture institution'),{code:'BAD_INSTITUTION'});
   const item=createItem(b.institution_id),publicToken='public-sandbox-fixture-'+item.id;
   publicTokens.set(publicToken,item);return {public_token:publicToken};
  }
  if(path==='/item/public_token/exchange'){
   const item=publicTokens.get(b.public_token);
   if(!item)throw Object.assign(Error('Invalid test token'),{code:'BAD_PUBLIC_TOKEN'});
   publicTokens.delete(b.public_token);
   return {access_token:item.token,item_id:item.id};
  }
  const item=itemAccess.get(b.access_token);
  if(!item)throw Object.assign(Error('Fixture Item not found'),{code:'ITEM_LOGIN_REQUIRED'});
  if(path==='/accounts/get')return {accounts:item.accounts};
  if(path==='/transactions/sync'){
   const cursor=b.cursor||'';
   if(!cursor)return {added:item.transactions.slice(0,5),modified:[],removed:[],
    has_more:true,next_cursor:item.id+':first'};
   if(cursor===item.id+':first')return {added:item.transactions.slice(5),modified:[],removed:[],
    has_more:false,next_cursor:item.id+':v0'};
   if(cursor===item.id+':v0')return {added:item.version?[
    {...item.transactions.at(-1),pending:false,transaction_id:item.id+'-posted',
     pending_transaction_id:item.id+'-pending',date:'2026-10-13'}]:[],
    modified:[],removed:item.version?[{transaction_id:item.id+'-pending'}]:[],
    has_more:false,next_cursor:item.id+':v'+item.version};
   return {added:[],modified:[],removed:[],has_more:false,next_cursor:cursor};
  }
  if(path==='/transactions/refresh'){item.version=1;return {request_id:'fixture'};}
  if(path==='/item/remove'){itemAccess.delete(item.token);return {}}
  throw Object.assign(Error('Unsupported fixture route'),{code:'UNKNOWN_FIXTURE_ROUTE'});
 };
}
module.exports={fixtureTransport};
