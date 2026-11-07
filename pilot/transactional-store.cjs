'use strict';
// Phase 4 candidate: opt-in encrypted transactional SQLite store.
// It is deliberately NOT imported by pilot/server.cjs and never switches the
// existing private bank disk. Rehearse migration on an isolated copy first.
// Requires Node 22+ for node:sqlite, with no native npm dependencies.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');

function secretKey(secret){
 if(typeof secret!=='string'||!secret.length)throw Error('Encryption secret is required');
 // Preserve the legacy secret derivation; never log, persist, or rotate keys.
 return crypto.createHash('sha256').update(secret).digest();
}
function opaque(key,kind,id){
 return crypto.createHmac('sha256',key).update('ledger-sqlite-key-v1\0')
  .update(String(kind)).update('\0').update(String(id)).digest('hex');
}
function encrypt(key,kind,id,data){
 const json=JSON.stringify(data);
 if(json===undefined)throw Error('Cannot persist an undefined private record');
 const iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from('ledger-sqlite-aad-v1\0'+kind+'\0'+id));
 const ciphertext=Buffer.concat([cipher.update(json,'utf8'),cipher.final()]);
 return Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),ciphertext]);
}
function decrypt(key,kind,id,blob){
 const value=Buffer.from(blob||[]);
 if(value.length<30||value[0]!==1)throw Error('Invalid encrypted database record');
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,value.subarray(1,13));
 decipher.setAAD(Buffer.from('ledger-sqlite-aad-v1\0'+kind+'\0'+id));
 decipher.setAuthTag(value.subarray(13,29));
 return JSON.parse(Buffer.concat([decipher.update(value.subarray(29)),
  decipher.final()]).toString('utf8'));
}
function isObject(value){
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function ordered(value){
 if(Array.isArray(value))return value.map(ordered);
 if(isObject(value))return Object.fromEntries(
  Object.keys(value).sort().map(k=>[k,ordered(value[k])]));
 return value;
}
function equivalent(a,b){return JSON.stringify(ordered(a))===JSON.stringify(ordered(b))}
function open({filename,secret}){
 if(typeof filename!=='string'||!path.isAbsolute(filename))
  throw Error('Use an absolute database path');
 const key=secretKey(secret),exists=fs.existsSync(filename);
 if(exists){
  const stat=fs.lstatSync(filename);
  if(!stat.isFile()||(stat.mode&0o077)!==0)
   throw Error('Refusing insecure, non-regular or shared private database file');
 }
 // SQLite would otherwise create the new file with the process umask
 // (potentially 0644). Reserve it exclusively as 0600 before opening.
 if(!exists){const fd=fs.openSync(filename,'wx',0o600);fs.closeSync(fd)}
 let db;
 try{
  db=new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY; PRAGMA secure_delete=ON');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(exists&&version!==1)throw Error('Unexpected private database schema; no automatic upgrade');
  if(!exists){
   db.exec('BEGIN IMMEDIATE');
   try{
    db.exec('CREATE TABLE records(kind TEXT PRIMARY KEY, sealed BLOB NOT NULL)');
    db.exec('CREATE TABLE transactions(id_key TEXT PRIMARY KEY, account_key TEXT NOT NULL, month_key TEXT NOT NULL, sealed BLOB NOT NULL)');
    db.exec('CREATE INDEX transactions_by_account_month ON transactions(account_key,month_key)');
    db.exec('PRAGMA user_version=1');
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error}
  }
 }catch(error){
  if(db){try{db.close()}catch{}}
  if(!exists){try{fs.unlinkSync(filename)}catch(e){if(e.code!=='ENOENT')throw e}}
  throw error;
 }
 const transaction=(action)=>{
  db.exec('BEGIN IMMEDIATE');
  try{const value=action();db.exec('COMMIT');return value}
  catch(error){db.exec('ROLLBACK');throw error}
 };
 const docStmt=db.prepare('SELECT sealed FROM records WHERE kind=?');
 const upsertDoc=db.prepare('INSERT INTO records(kind,sealed) VALUES(?,?) ON CONFLICT(kind) DO UPDATE SET sealed=excluded.sealed');
 const deleteDoc=db.prepare('DELETE FROM records WHERE kind=?');
 const insertTx=db.prepare('INSERT INTO transactions(id_key,account_key,month_key,sealed) VALUES(?,?,?,?)');
 const doc=(kind)=>{
  const result=docStmt.get(kind);
  return result?decrypt(key,'doc',kind,result.sealed):null;
 };
 const putDoc=(kind,value)=>{
  if(value===null){deleteDoc.run(kind);return}
  upsertDoc.run(kind,encrypt(key,'doc',kind,value));
 };
 const putBank=bank=>{
  if(!isObject(bank)||!isObject(bank.transactions))
   throw Error('Expected complete bank snapshot with transaction map');
  const meta={...bank};
  delete meta.transactions;
  // A crash or invalid row after DELETE cannot publish a half-written feed.
  db.prepare('DELETE FROM transactions').run();
  for(const [id,row] of Object.entries(bank.transactions)){
   if(!isObject(row))throw Error('Invalid source bank transaction');
   const idKey=opaque(key,'tx',id);
   insertTx.run(idKey,opaque(key,'account',row.accountId||''),
    opaque(key,'month',typeof row.date==='string'?row.date.slice(0,7):''),
    encrypt(key,'transaction',idKey,{id,row}));
  }
  // The collection checksum is itself authenticated and encrypted in
  // the source document. A missing/deleted transaction cannot silently
  // turn a complete bank snapshot into incomplete financial history.
  const keys=Object.keys(bank.transactions).sort();
  const idDigest=crypto.createHmac('sha256',key)
   .update('ledger-transaction-set-v1\0')
   .update(JSON.stringify(keys)).digest('hex');
  putDoc('bank',{format:1,body:meta,transactionCount:keys.length,idDigest});
 };
 const selectAll=db.prepare('SELECT id_key,account_key,month_key,sealed FROM transactions');
 const readTx=(row)=>{
  const unsealed=decrypt(key,'transaction',row.id_key,row.sealed);
  if(!isObject(unsealed)||typeof unsealed.id!=='string'||!isObject(unsealed.row)||
     opaque(key,'tx',unsealed.id)!==row.id_key||
     opaque(key,'account',unsealed.row.accountId||'')!==row.account_key||
     opaque(key,'month',typeof unsealed.row.date==='string'?unsealed.row.date.slice(0,7):'')!==row.month_key)
   throw Error('Encrypted bank transaction index mismatch');
  return unsealed;
 };
 const readBank=()=>{
  const sealed=doc('bank');
  if(sealed===null)return null;
  if(!isObject(sealed)||sealed.format!==1||!isObject(sealed.body)||
     !Number.isSafeInteger(sealed.transactionCount)||sealed.transactionCount<0||
     !/^[a-f0-9]{64}$/.test(String(sealed.idDigest||'')))
   throw Error('Invalid encrypted bank snapshot');
  const transactions={};
  for(const stored of selectAll.all()){
   const {id,row}=readTx(stored);
   if(Object.hasOwn(transactions,id))throw Error('Duplicate bank transaction identity');
   Object.defineProperty(transactions,id,{value:row,writable:true,enumerable:true,configurable:true});
  }
  const ids=Object.keys(transactions).sort();
  const digest=crypto.createHmac('sha256',key)
   .update('ledger-transaction-set-v1\0')
   .update(JSON.stringify(ids)).digest('hex');
  if(ids.length!==sealed.transactionCount||digest!==sealed.idDigest)
   throw Error('Incomplete encrypted bank transaction set');
  return {...sealed.body,transactions};
 };
 const queryTransactions=({accountId,month}={})=>{
  const filters=[],values=[];
  if(accountId!==undefined){
   if(typeof accountId!=='string')throw Error('Invalid account filter');
   filters.push('account_key=?');values.push(opaque(key,'account',accountId));
  }
  if(month!==undefined){
   if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw Error('Invalid YYYY-MM month filter');
   filters.push('month_key=?');values.push(opaque(key,'month',month));
  }
  const sql='SELECT id_key,account_key,month_key,sealed FROM transactions'+
   (filters.length?' WHERE '+filters.join(' AND '):'');
  return db.prepare(sql).all(...values).map(row=>readTx(row).row);
 };
 const updateBank=bank=>transaction(()=>putBank(bank));
 const updateForecasts=forecast=>transaction(()=>{
  if(!isObject(forecast))throw Error('Expected forecast preferences');
  putDoc('forecast',forecast);
 });
 const updateSessions=sessions=>transaction(()=>{
  if(!isObject(sessions)||sessions.version!==1||!Array.isArray(sessions.sessions))
   throw Error('Invalid private session state');
  putDoc('sessions',sessions);
 });
 const replaceAll=({bank,forecast=null,sessions=null})=>transaction(()=>{
  putBank(bank);
  if(forecast!==null&&!isObject(forecast))throw Error('Invalid forecast preferences');
  if(sessions!==null&&(!isObject(sessions)||sessions.version!==1||!Array.isArray(sessions.sessions)))
   throw Error('Invalid session state');
  putDoc('forecast',forecast);putDoc('sessions',sessions);
 });
 return {readBank,queryTransactions,readForecasts:()=>doc('forecast'),
  readSessions:()=>doc('sessions'),updateBank,updateForecasts,updateSessions,
  replaceAll,close:()=>db.close()};
}
// Read the pre-existing AES-GCM envelopes. This is deliberately read-only;
// no migration may rewrite, delete, or truncate the private original files.
function decryptLegacy(secret,contents){
 const key=secretKey(secret),raw=JSON.parse(contents);
 if(!isObject(raw))throw Error('Invalid legacy encrypted envelope');
 const iv=Buffer.from(raw.iv||'','base64'),tag=Buffer.from(raw.tag||'','base64');
 if(iv.length!==12||tag.length!==16||typeof raw.data!=='string')
  throw Error('Invalid legacy encryption');
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
 decipher.setAuthTag(tag);
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(raw.data,'base64')),
  decipher.final()]).toString('utf8'));
}
function readLegacy(filename,secret,optional=false){
 try{
  const stat=fs.lstatSync(filename);
  if(!stat.isFile())throw Error('Refusing non-regular legacy source');
  return decryptLegacy(secret,fs.readFileSync(filename,'utf8'));
 }catch(error){
  if(optional&&error.code==='ENOENT')return null;
  throw error;
 }
}
// New target only. Rehearse on an isolated destination after restoring
// offline fictional/verified-backup copies, never the running Render files.
// Publish the result via a no-clobber hard link after exact read-back parity.
// This function does not change the live service's storage selection.
function rehearseLegacyMigration({sourceFile,destinationFile,secret}){
 if(typeof sourceFile!=='string'||typeof destinationFile!=='string'||
    !path.isAbsolute(sourceFile)||!path.isAbsolute(destinationFile))
  throw Error('Source and destination must be absolute paths');
 const bank=readLegacy(sourceFile,secret);
 const forecast=readLegacy(sourceFile+'.forecasts',secret,true);
 const sessions=readLegacy(sourceFile+'.sessions',secret,true);
 if(!isObject(bank)||!isObject(bank.transactions))throw Error('Invalid source bank snapshot');
 if(forecast!==null&&!isObject(forecast))throw Error('Invalid legacy forecasts');
 if(sessions!==null&&(!isObject(sessions)||sessions.version!==1||!Array.isArray(sessions.sessions)))
  throw Error('Invalid legacy sessions');
 if(fs.existsSync(destinationFile))throw Error('Destination exists: refusing overwrite');
 const temporary=destinationFile+'.rehearsal-'+process.pid+'-'+crypto.randomBytes(6).toString('hex');
 let store=null;
 try{
  store=open({filename:temporary,secret});
  store.replaceAll({bank,forecast,sessions});
  if(!equivalent(store.readBank(),bank)||
     !equivalent(store.readForecasts(),forecast)||
     !equivalent(store.readSessions(),sessions))
   throw Error('Transactional migration failed exact read-back parity');
  store.close();store=null;
  // Atomic no-clobber publication on the same filesystem.
  fs.linkSync(temporary,destinationFile);
  fs.unlinkSync(temporary);
  return {verified:true,transactions:Object.keys(bank.transactions).length,
   forecastPresent:forecast!==null,sessionsPresent:sessions!==null};
 }catch(error){
  if(store){try{store.close()}catch{}}
  for(const f of [temporary,temporary+'-journal',temporary+'-wal',temporary+'-shm']){
   try{fs.unlinkSync(f)}catch(e){if(e.code!=='ENOENT')throw e}
  }
  throw error;
 }
}
module.exports={open,rehearseLegacyMigration};
