'use strict';
// Portable recovery for the private Ledger: decrypt existing AES-GCM envelopes
// only in memory, then encrypt the WHOLE consistent snapshot with a separate
// owner-held passphrase. No bank facts, Plaid tokens or recovery keys go to Git.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util'),scrypt=promisify(crypto.scrypt);
const FORMAT='household-ledger-portable-v1',AAD=Buffer.from(FORMAT,'utf8');
const MAX_SOURCE=40*1024*1024,MAX_BUNDLE=80*1024*1024;
// The optional derived analysis contains standing consent and private report
// output. It must travel with the other encrypted files during recovery.
const PARTS=[['bank',''],['forecasts','.forecasts'],['sessions','.sessions'],
 ['analysis','.analysis']];
function object(v){return !!v&&typeof v==='object'&&!Array.isArray(v)}
function requiredSecret(secret){
 if(typeof secret!=='string'||!secret)throw Error('Source encryption key is required');
 return crypto.createHash('sha256').update(secret).digest();
}
function requiredPassphrase(passphrase){
 if(typeof passphrase!=='string'||passphrase.length<20||passphrase.length>512)
  throw Error('Use a separate recovery passphrase of 20–512 characters');
 return passphrase;
}
function bytes(value){
 if(typeof value!=='string'||!value||value.length%4!==0||
  !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
  throw Error('Invalid encrypted backup encoding');
 return Buffer.from(value,'base64');
}
function decodeExisting(text,secret){
 const sealed=JSON.parse(text);
 if(!object(sealed))throw Error('Invalid existing encrypted file');
 const iv=bytes(sealed.iv),tag=bytes(sealed.tag),encrypted=bytes(sealed.data);
 if(iv.length!==12||tag.length!==16)throw Error('Invalid encrypted file header');
 const cipher=crypto.createDecipheriv('aes-256-gcm',requiredSecret(secret),iv);
 cipher.setAuthTag(tag);
 return JSON.parse(Buffer.concat([cipher.update(encrypted),cipher.final()]).toString('utf8'));
}
function encodeForDisk(value,secret){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',requiredSecret(secret),iv);
 const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
  data:data.toString('base64')});
}
function validate(parts){
 if(!object(parts)||!object(parts.bank)||!Array.isArray(parts.bank.items)||
  !Array.isArray(parts.bank.accounts)||!object(parts.bank.transactions)||
  !object(parts.bank.ledgerAdjustments))throw Error('Incomplete encrypted bank snapshot');
 if(parts.forecasts!==null&&!object(parts.forecasts))throw Error('Invalid forecast preferences');
 if(parts.sessions!==null&&(!object(parts.sessions)||parts.sessions.version!==1||
  !Array.isArray(parts.sessions.sessions)))throw Error('Invalid session state');
 if(parts.analysis!==undefined&&parts.analysis!==null&&
   (!object(parts.analysis)||parts.analysis.version!==1||
    typeof parts.analysis.autoEnabled!=='boolean'||
    (parts.analysis.report!==null&&!object(parts.analysis.report))))
  throw Error('Invalid automatic AI analysis cache');
 for(const name of Object.keys(parts))if(!PARTS.some(([kind])=>kind===name))
  throw Error('Unexpected private file in recovery archive');
}
async function derive(passphrase,salt){
 return scrypt(requiredPassphrase(passphrase),salt,32,
  {N:32768,r:8,p:1,maxmem:64*1024*1024});
}
async function capture({statePath,secret,passphrase}){
 if(typeof statePath!=='string'||!path.isAbsolute(statePath))
  throw Error('Private bank path must be absolute');
 requiredSecret(secret);requiredPassphrase(passphrase);
 const parts={};
 for(const [kind,suffix] of PARTS){
  let text;
  try{text=await fs.readFile(statePath+suffix,'utf8')}
  catch(error){
   if(error.code==='ENOENT'&&kind!=='bank'){parts[kind]=null;continue}
   throw error;
  }
  if(Buffer.byteLength(text,'utf8')>MAX_SOURCE)throw Error('Private file too large for portable backup');
  parts[kind]=decodeExisting(text,secret);
 }
 validate(parts);
 const salt=crypto.randomBytes(32),iv=crypto.randomBytes(12),
  key=await derive(passphrase,salt);
 const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(AAD);
 const data=Buffer.concat([
  cipher.update(JSON.stringify({format:FORMAT,parts}),'utf8'),cipher.final()
 ]);
 const bundle=Buffer.from(JSON.stringify({format:FORMAT,kdf:'scrypt-32768-8-1',
  cipher:'aes-256-gcm',salt:salt.toString('base64'),iv:iv.toString('base64'),
  tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}));
 if(bundle.length>MAX_BUNDLE)throw Error('Encrypted backup is too large');
 return bundle;
}
async function open(bundle,passphrase){
 requiredPassphrase(passphrase);
 const raw=Buffer.isBuffer(bundle)?bundle:Buffer.from(bundle||'');
 if(!raw.length||raw.length>MAX_BUNDLE)throw Error('Invalid encrypted backup size');
 const envelope=JSON.parse(raw.toString('utf8'));
 if(!object(envelope)||envelope.format!==FORMAT||envelope.kdf!=='scrypt-32768-8-1'||
   envelope.cipher!=='aes-256-gcm')throw Error('Unsupported private backup format');
 const salt=bytes(envelope.salt),iv=bytes(envelope.iv),tag=bytes(envelope.tag),
  data=bytes(envelope.data);
 if(salt.length!==32||iv.length!==12||tag.length!==16)
  throw Error('Invalid portable backup header');
 const key=await derive(passphrase,salt),cipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(AAD);cipher.setAuthTag(tag);
 const decoded=JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8'));
 if(!object(decoded)||decoded.format!==FORMAT)throw Error('Unexpected private backup content');
 validate(decoded.parts);
 return decoded.parts;
}
async function restore({bundle,passphrase,destination,secret}){
 // Destructive restore of the LIVE file path is deliberately not supported:
 // only a nonexistent, absolute, isolated directory may be created.
 if(typeof destination!=='string'||!path.isAbsolute(destination)||
  destination===path.parse(destination).root)throw Error('Specify a new absolute restore directory');
 requiredSecret(secret);
 const parts=await open(bundle,passphrase);
 await fs.mkdir(destination,{mode:0o700,recursive:false});
 try{
  for(const [kind,suffix] of PARTS){
   if(parts[kind]===null)continue;
   const target=path.join(destination,'pilot.enc'+suffix);
   await fs.writeFile(target,encodeForDisk(parts[kind],secret),{flag:'wx',mode:0o600});
   const checked=decodeExisting(await fs.readFile(target,'utf8'),secret);
   if(JSON.stringify(checked)!==JSON.stringify(parts[kind]))
    throw Error('Isolated restore verification failed');
  }
 }catch(error){
  // Destination was created in this operation; clean it on failure.
  await fs.rm(destination,{recursive:true,force:true});
  throw error;
 }
 return {verified:true,hasBank:true,hasForecasts:parts.forecasts!==null,
  hasSessions:parts.sessions!==null,hasAnalysis:parts.analysis!==null};
}
module.exports={capture,open,restore};
