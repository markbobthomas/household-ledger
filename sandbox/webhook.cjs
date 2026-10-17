'use strict';
const crypto=require('node:crypto');
const {PlaidError}=require('./plaid-service.cjs');
/* Validation helper for a future HTTPS webhook receiver.
 * The loopback-only Phase D service does NOT expose an internet webhook route.
 * Check JWT ES256 P-256, fresh iat, and constant-time SHA256 of the EXACT body.
 */
async function verifyPlaidWebhook(rawBody,token,request,nowMs=Date.now()){
 if(typeof rawBody!=='string'||typeof token!=='string'||typeof request!=='function')
  throw new PlaidError('Invalid webhook request','BAD_WEBHOOK',401);
 const segments=token.split('.');
 if(segments.length!==3)throw new PlaidError('Malformed webhook signature','BAD_WEBHOOK',401);
 let header,payload;
 try{
  header=JSON.parse(Buffer.from(segments[0],'base64url').toString());
  payload=JSON.parse(Buffer.from(segments[1],'base64url').toString());
 }catch{throw new PlaidError('Malformed webhook JWT','BAD_WEBHOOK',401)}
 if(header.alg!=='ES256'||!header.kid||!payload.request_body_sha256||
  !Number.isInteger(payload.iat)||Math.abs(nowMs/1000-payload.iat)>300)
  throw new PlaidError('Untrusted or expired webhook','BAD_WEBHOOK',401);
 const resp=await request('/webhook_verification_key/get',{key_id:header.kid});
 const jwk=resp.key;
 if(!jwk||jwk.kid!==header.kid||jwk.alg!=='ES256'||jwk.kty!=='EC'||jwk.crv!=='P-256'||
  jwk.expired_at&&jwk.expired_at<Math.floor(nowMs/1000))
  throw new PlaidError('Invalid Plaid webhook key','BAD_WEBHOOK_KEY',401);
 let valid=false;
 try{
  const key=crypto.createPublicKey({key:jwk,format:'jwk'});
  valid=crypto.verify('sha256',Buffer.from(segments[0]+'.'+segments[1]),
   {key,dsaEncoding:'ieee-p1363'},Buffer.from(segments[2],'base64url'));
 }catch{}
 if(!valid)throw new PlaidError('Webhook signature rejected','BAD_WEBHOOK',401);
 const hash=Buffer.from(crypto.createHash('sha256').update(rawBody,'utf8').digest('hex'),'hex');
 let expected;
 try{expected=Buffer.from(payload.request_body_sha256,'hex')}catch{}
 if(!expected||hash.length!==expected.length||!crypto.timingSafeEqual(hash,expected))
  throw new PlaidError('Webhook body mismatch','BAD_WEBHOOK',401);
 return JSON.parse(rawBody);
}
module.exports={verifyPlaidWebhook};
