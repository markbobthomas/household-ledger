'use strict';
// Private, revocable 90-day household sessions. Persist ONLY hashed random
// session identifiers in the same encrypted Render disk; never bank snapshots
// or secrets in cookies/browser storage.
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const TTL=90*24*60*60*1000;
const COOKIE='__Host-ledger_session';
const SIGNED_OUT='__Host-ledger_signed_out';
const UPGRADED='__Host-ledger_upgraded';
const expiryHeader='Path=/; Secure; HttpOnly; SameSite=Lax';
module.exports=function createSessionAuth({password,secret,sessionFile,decrypted,atomicEncryptedWrite}){
 const passwordHash=crypto.createHash('sha256').update(password).digest();
 // Rotating the existing private password invalidates all prior sessions,
 // without touching or decrypting the separately stored bank transactions.
 const hmacKey=crypto.createHmac('sha256',secret)
  .update('ledger-session-id-v1').update(passwordHash).digest();
 let entries=new Map(),writes=Promise.resolve();
 const failures=new Map();
 const idHash=value=>crypto.createHmac('sha256',hmacKey).update(value).digest('hex');
 function cookieValue(req,name){
  const header=String(req.headers.cookie||'');
  const part=header.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
  return part?part.slice(name.length+1):'';
 }
 function sessionId(req){
  const token=cookieValue(req,COOKIE);
  return /^[a-f0-9]{64}$/.test(token)?idHash(token):null;
 }
 function authenticated(req){
  const id=sessionId(req);
  return !!(id&&entries.get(id)>Date.now());
 }
 function isSignedOut(req){return cookieValue(req,SIGNED_OUT)==='1'}
 function wasUpgraded(req){return cookieValue(req,UPGRADED)==='1'}
 // This marker outlives the session. A browser with previously cached Basic
 // credentials must still re-enter its password when its 90-day cookie expires.
 function upgradedCookie(){return UPGRADED+'=1; Max-Age=31536000; '+expiryHeader}
 function cookie(token){return COOKIE+'='+token+'; Max-Age='+String(TTL/1000)+'; '+expiryHeader}
 function clearCookie(){return COOKIE+'=; Max-Age=0; '+expiryHeader}
 function signedOutCookie(){return SIGNED_OUT+'=1; Max-Age='+String(TTL/1000)+'; '+expiryHeader}
 function clearSignedOut(){return SIGNED_OUT+'=; Max-Age=0; '+expiryHeader}
 async function load(){
  try{
   const value=decrypted(await fs.readFile(sessionFile,'utf8'));
   if(!value||value.version!==1||!Array.isArray(value.sessions))throw Error('Invalid private session state');
   entries=new Map();
   for(const item of value.sessions){
    if(!Array.isArray(item)||!(/^[a-f0-9]{64}$/.test(item[0]))||
       !Number.isSafeInteger(item[1]))throw Error('Invalid private session entry');
    if(item[1]>Date.now()&&item[1]<=Date.now()+TTL)entries.set(item[0],item[1]);
   }
  }catch(error){if(error.code!=='ENOENT')throw error}
 }
 function mutate(fn){
  const task=writes.catch(()=>{}).then(async()=>{
   const old=new Map(entries);
   fn();
   for(const [id,end] of entries)if(end<=Date.now())entries.delete(id);
   try{await atomicEncryptedWrite(sessionFile,{version:1,sessions:[...entries]})}
   catch(error){entries=old;throw error}
  });
  writes=task.catch(()=>{});
  return task;
 }
 function checkPassword(candidate){
  const raw=typeof candidate==='string'&&candidate.length<=4096?candidate:'';
  const candidateHash=crypto.createHash('sha256').update(raw).digest();
  return crypto.timingSafeEqual(passwordHash,candidateHash);
 }
 function blocked(ip){
  const item=failures.get(ip);
  if(!item)return false;
  if(item.until<Date.now()){failures.delete(ip);return false}
  return item.count>=7;
 }
 function failed(ip){
  if(failures.size>1000)failures.clear();
  const item=failures.get(ip);
  if(!item||item.until<Date.now())failures.set(ip,{count:1,until:Date.now()+15*60*1000});
  else item.count++;
 }
 function successful(ip){failures.delete(ip)}
 async function issue(){
  const token=crypto.randomBytes(32).toString('hex'),hash=idHash(token);
  await mutate(()=>{
   if(entries.size>=50){
    const first=entries.keys().next().value;
    if(first)entries.delete(first);
   }
   entries.set(hash,Date.now()+TTL);
  });
  return token;
 }
 async function revoke(req){
  const id=sessionId(req);
  if(id&&entries.has(id))await mutate(()=>entries.delete(id));
 }
 return {TTL,COOKIE,authenticated,isSignedOut,cookie,clearCookie,
  signedOutCookie,clearSignedOut,upgradedCookie,wasUpgraded,
  checkPassword,blocked,failed,successful,issue,revoke,load};
};
