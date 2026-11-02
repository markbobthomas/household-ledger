'use strict';
// Injected ONLY by offline test subprocess. Prevents all external network calls.
let stage=0,secondStage=0,removals=0,authorizedAgain=false,invalidFieldOnce=false,countRecovered=false,cursorRecovered=false,clientFieldDiagnosed=false,unknownCountRecovered=false,unknownFailureCalls=0,headerAuthRejected=false,headerAuthRecovered=false;
global.fetch=async function(url,options){
 const p=new URL(url).pathname,body=JSON.parse(options.body||'{}');
 let data;
 switch(p){
  case '/link/token/create':
   if(body.access_token){
    if(body.access_token!=='secret-test-access-token'||body.products)
     return {ok:false,status:400,json:async()=>({error_code:'INVALID_UPDATE_REQUEST'})};
    authorizedAgain=true;data={link_token:'link-update-test'};
   }else data={link_token:'link-test'};
   break;
  case '/item/public_token/exchange':data=body.public_token==='public-second'?
 {access_token:'secret-second-access-token',item_id:'test-item-2'}:
 {access_token:'secret-test-access-token',item_id:'test-item'};break;
  case '/item/get':
   if(options.headers['PLAID-CLIENT-ID']&&
      (options.headers['PLAID-CLIENT-ID']!=='test'||
       options.headers['PLAID-SECRET']!=='test'||
       body.client_id!==undefined||body.secret!==undefined))
    throw Error('Test did not keep original Plaid credentials private in headers');
   data={item:{item_id:'fictional-item',available_products:['transactions']}};
   break;
  case '/accounts/get':data={accounts:[{account_id:'acct-1',name:'Test Checking',mask:'1234',type:'depository',subtype:'checking',balances:{current:321.45,available:300.10,iso_currency_code:'USD'}},{account_id:'acct-2',name:'Test Visa',mask:'5555',type:'credit',subtype:'credit card',balances:{current:900,available:null}}]};break;
  case '/transactions/sync':
   if(body.access_token==='secret-second-access-token'){
    data={added:secondStage++===0?[
     {transaction_id:'credit-charge-1',account_id:'acct-2',date:'2026-10-19',name:'Card groceries',amount:300,pending:false},
     {transaction_id:'credit-payment-1',account_id:'acct-2',date:'2026-10-19',name:'Payment Thank You',amount:-100,pending:false}
    ]:[],modified:[],removed:[],has_more:false,next_cursor:'card-cursor-'+secondStage};
   }else{
    if(process.env.PILOT_LOGIN_REQUIRED_TEST==='1'&&stage>=3&&!authorizedAgain)
     return {ok:false,status:400,json:async()=>({error_code:'ITEM_LOGIN_REQUIRED'})};
    if(process.env.PILOT_INVALID_FIELD_TEST==='1'&&!invalidFieldOnce&&
     (process.env.PILOT_INVALID_FIELD_AFTER_STAGE?
      stage>=Number(process.env.PILOT_INVALID_FIELD_AFTER_STAGE):authorizedAgain&&stage>=4)){
     invalidFieldOnce=true;
     return {ok:false,status:400,json:async()=>({
      error_code:'INVALID_FIELD',error_type:'INVALID_REQUEST',
      error_message:'The account_id field has an invalid value',
      request_id:'fictional-request-id-42'
     })};
    }
    // The first rejected field above is intentionally NOT recoverable.
    // Separate cases below prove that the server changes exactly the field
    // named by Plaid and only when the original Item has a committed cursor.
    if(process.env.PILOT_INVALID_FIELD_TEST==='1'&&authorizedAgain&&
      stage>=5&&!countRecovered){
     if(body.count!==undefined)return {ok:false,status:400,json:async()=>({
      error_code:'INVALID_FIELD',error_type:'INVALID_REQUEST',
      error_message:'The count field has an invalid value',request_id:'fictional-count-id'
     })};
     countRecovered=true;
    }
    if(process.env.PILOT_INVALID_FIELD_TEST==='1'&&authorizedAgain&&
      stage>=6&&countRecovered&&!cursorRecovered){
     if(body.cursor!==undefined)return {ok:false,status:400,json:async()=>({
      error_code:'INVALID_FIELD',error_type:'INVALID_REQUEST',
      error_message:'The cursor field has an invalid value',request_id:'fictional-cursor-id'
     })};
     cursorRecovered=true;
    }
    // The provider may identify the client_id in a message containing
    // sensitive values. Record only the name of the offending field.
    if(process.env.PILOT_INVALID_FIELD_TEST==='1'&&authorizedAgain&&
       cursorRecovered&&stage>=7&&!clientFieldDiagnosed){
     clientFieldDiagnosed=true;
     return {ok:false,status:400,json:async()=>({
      error_code:'INVALID_FIELD',error_type:'INVALID_REQUEST',
      error_message:'The client_id field was rejected (private value must stay hidden)',
      request_id:'fictional-client-field-request'
     })};
    }
    if(process.env.PILOT_INVALID_FIELD_TEST==='1'&&clientFieldDiagnosed&&
       stage>=7&&!headerAuthRejected&&options.headers['PLAID-CLIENT-ID']){
     headerAuthRejected=true;
     return {ok:false,status:400,json:async()=>({
      error_code:'INVALID_FIELD',error_type:'INVALID_REQUEST',
      error_message:'The client_id field remains invalid',
      request_id:'fictional-rejected-header'
     })};
    }
    if(process.env.PILOT_INVALID_FIELD_TEST==='1'&&clientFieldDiagnosed&&stage>=8&&!unknownCountRecovered){
     if(body.count!==undefined)return {ok:false,status:400,json:async()=>({
      error_code:'INVALID_FIELD',error_type:'INVALID_REQUEST',
      error_message:'A request parameter is invalid',request_id:'fictional-unknown-count'
     })};
     unknownCountRecovered=true;
    }
    if(process.env.PILOT_INVALID_FIELD_TEST==='1'&&unknownCountRecovered&&stage>=9&&unknownFailureCalls<2){
     unknownFailureCalls++;
     return {ok:false,status:400,json:async()=>({
      error_code:'INVALID_FIELD',error_type:'INVALID_REQUEST',
      error_message:'The value is invalid',request_id:'fictional-unknown-failure'
     })};
    }
    if(process.env.PILOT_INVALID_FIELD_TEST==='1'&&unknownFailureCalls>=2&&
       stage>=10&&!headerAuthRecovered){
     if(body.client_id!==undefined)return {ok:false,status:400,json:async()=>({
      error_code:'INVALID_FIELD',error_type:'INVALID_REQUEST',
      error_message:'The client_id field is invalid',request_id:'fictional-header-fallback'
     })};
     if(options.headers['PLAID-CLIENT-ID']!=='test'||
        options.headers['PLAID-SECRET']!=='test'||body.secret!==undefined)
      throw Error('Header retry must retain the same fictional credentials');
     headerAuthRecovered=true;
    }
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
