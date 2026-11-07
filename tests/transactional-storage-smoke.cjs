'use strict';
// Purely fictional Phase-4 migration and rollback rehearsal. The source
// files are disposable; this test never connects to Plaid or private Render.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../pilot/transactional-store.cjs');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-phase4-fixtures-'));
const source=path.join(directory,'fictional-legacy.enc');
const dest=path.join(directory,'fictional-candidate.sqlite');
const secret='fictional-secret-only-for-testing-2026';
const key=crypto.createHash('sha256').update(secret).digest();
const legacyEncrypt=value=>{
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
 return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
  data:data.toString('base64')});
};
const bank={
 items:[{id:'FICTIONAL-ITEM-1',token:'FICTIONAL-PLAID-ACCESS-TOKEN-NEVER-A-REAL-TOKEN',
  cursor:'FICTIONAL-CURSOR-7',accountIds:['fictional-checking','fictional-card']}],
 accounts:[
  {id:'fictional-checking',type:'depository',subtype:'checking',name:'Sample Checking',current:8200},
  {id:'fictional-card',type:'credit',subtype:'credit card',name:'Sample Card',current:1200}
 ],
 transactions:{
  'fictional-mortgage':{id:'fictional-mortgage',accountId:'fictional-checking',date:'2026-09-03',
   name:'Fictional Mortgage ACH',amount:2450,pending:false},
  'fictional-payroll':{id:'fictional-payroll',accountId:'fictional-checking',date:'2026-10-01',
   name:'Fictional Employer Payroll',amount:-3000,pending:false},
  'fictional-pending':{id:'fictional-pending',accountId:'fictional-checking',date:'2026-10-05',
   name:'Fictional Pending Bill',amount:75,pending:true},
  'fictional-card-charge':{id:'fictional-card-charge',accountId:'fictional-card',date:'2026-10-05',
   name:'Fictional Card Purchase',amount:150,pending:false},
  'fictional-card-refund':{id:'fictional-card-refund',accountId:'fictional-card',date:'2026-11-01',
   name:'Fictional Card Refund',amount:-20,pending:false}
 },
 transactionReplacements:[{accountId:'fictional-checking',pendingId:'old-fictional-id',id:'fictional-mortgage'}],
 ledgerAdjustments:{
  predictions:{cashCushion:500,transactionNotes:{'bank:fictional-pending':'old-embedded-note'}},
  categoryOverrides:{'fictional-card-charge':'Shopping'},
  learning:{categoryRules:{}}
 },
 lastSync:'2026-10-06T15:00:00Z'
};
const forecast={
 cashCushion:650,transactionNotes:{'bank:fictional-pending':'Corrected private note'},
 categoryMonthlyBudgets:{Housing:2600},
 futureRecurringRules:[{id:'fictional-mortgage-rule',accountId:'fictional-checking',merchant:'Fictional Mortgage ACH',
   type:'expense',frequency:'monthly',amount:2450,date:'2026-12-03'}]
};
const sessions={version:1,sessions:[['f'.repeat(64),Date.now()+10000]]};
const bytes=Object.fromEntries([
 [source,bank],[source+'.forecasts',forecast],[source+'.sessions',sessions]
].map(([file,value])=>{const encoded=legacyEncrypt(value);fs.writeFileSync(file,encoded,{mode:0o600});
 return [file,fs.readFileSync(file)];}));
try{
 const migrated=Store.rehearseLegacyMigration({sourceFile:source,destinationFile:dest,secret});
 assert.deepEqual(migrated,{verified:true,transactions:5,forecastPresent:true,sessionsPresent:true});
 for(const [file,original] of Object.entries(bytes))
  assert.deepEqual(fs.readFileSync(file),original,
   'Rehearsal does not write or remove the original encrypted '+path.basename(file));
 const sqlite=fs.readFileSync(dest);
 assert.equal(sqlite.subarray(0,15).toString(),'SQLite format 3',
  'Destination is a normal transactional SQLite database');
 assert.equal(fs.statSync(dest).mode&0o077,0,'Only the local owner can read the new SQLite file');
 for(const sensitive of ['FICTIONAL-PLAID-ACCESS-TOKEN','fictional-checking','Fictional Mortgage ACH',
  'Fictional Card Purchase','Corrected private note','fictional-card-charge','fictional-mortgage-rule']){
  assert.equal(sqlite.includes(Buffer.from(sensitive)),false,
   'SQL records, identifiers and indices must be encrypted or keyed: '+sensitive);
 }
 let store=Store.open({filename:dest,secret});
 assert.deepEqual(store.readBank(),bank,'Migration read-back preserves every bank fact');
 assert.deepEqual(store.readForecasts(),forecast,
  'The separate forecast file remains authoritative after migration rehearsal');
 assert.deepEqual(store.readSessions(),sessions,'All existing hashed session records survive');
 assert.equal(store.queryTransactions({accountId:'fictional-checking',month:'2026-10'}).length,2,
  'Account/month blind index returns the expected checking transactions');
 assert.equal(store.queryTransactions({accountId:'fictional-card',month:'2026-10'}).length,1);
 assert.equal(store.queryTransactions({accountId:'fictional-card',month:'2026-09'}).length,0);
 assert.equal(store.queryTransactions({month:'2026-11'}).length,1);
 assert.throws(()=>store.queryTransactions({month:'2026-99'}),/Invalid YYYY-MM/);
 const updatedForecast={...forecast,
  transactionNotes:{...forecast.transactionNotes,'bank:fictional-payroll':'Reviewed deposit'}};
 store.updateForecasts(updatedForecast);
 assert.deepEqual(store.readBank(),bank,'Forecast updates do not rewrite bank facts');
 assert.deepEqual(store.readForecasts(),updatedForecast);
 const nextSessions={version:1,sessions:[['e'.repeat(64),Date.now()+20000]]};
 store.updateSessions(nextSessions);
 assert.deepEqual(store.readSessions(),nextSessions);
 const revisedBank=structuredClone(bank);
 revisedBank.transactions['fictional-new-sample']={
  id:'fictional-new-sample',accountId:'fictional-checking',date:'2026-11-05',
  name:'Fictional Payment',pending:false,amount:55
 };
 store.updateBank(revisedBank);
 assert.deepEqual(store.readForecasts(),updatedForecast,
  'Bank sync snapshots must not overwrite more recent forecast preferences');
 assert.deepEqual(store.readSessions(),nextSessions,'Bank sync does not log out household devices');
 assert.deepEqual(store.readBank(),revisedBank);
 // Fail after deleting old rows and inserting valid new rows: SQLite must
 // roll back the entire write, not leave half a transaction or lose a cursor.
 const bad=structuredClone(revisedBank);
 bad.transactions['zz-invalid-record']=undefined;
 assert.throws(()=>store.updateBank(bad),/Invalid source bank transaction/);
 assert.deepEqual(store.readBank(),revisedBank,
  'A mid-batch failure restores all prior bank transactions, Items and cursors');
 const malformed={...updatedForecast};
 malformed.invalid=BigInt(2);
 assert.throws(()=>store.updateForecasts(malformed));
 assert.deepEqual(store.readForecasts(),updatedForecast,
  'A failed forecast write cannot corrupt the prior encrypted owner decisions');
 store.close();
 store=Store.open({filename:dest,secret});
 assert.deepEqual(store.readBank(),revisedBank,'Bank and cursor survive a restart');
 assert.deepEqual(store.readForecasts(),updatedForecast,'Private notes survive a restart');
 assert.deepEqual(store.readSessions(),nextSessions,'Hashed login sessions survive a restart');
 store.close();
 const wrong=Store.open({filename:dest,secret:'wrong-fictional-secret'});
 assert.throws(()=>wrong.readBank(),/authenticate|auth|bad decrypt|Unsupported state/i,
  'Wrong encryption key must never open as an empty ledger');
 wrong.close();
 const unchanged=fs.readFileSync(dest);
 assert.throws(()=>Store.rehearseLegacyMigration({sourceFile:source,destinationFile:dest,secret}),
  /Destination exists/,'Migration never overwrites a preexisting store');
 assert.deepEqual(fs.readFileSync(dest),unchanged,'No-clobber guard preserves the existing SQLite store');
 assert.throws(()=>Store.rehearseLegacyMigration({
  sourceFile:source,destinationFile:path.join(directory,'wrong-key.sqlite'),
  secret:'wrong-fictional-key'
 }),/authenticate|auth|bad decrypt|Unsupported state/i);
 assert.equal(fs.existsSync(path.join(directory,'wrong-key.sqlite')),false,
  'Incorrect key must not even create a candidate DB');
 const corrupted=path.join(directory,'fictional-corrupt.enc');
 fs.writeFileSync(corrupted,'invalid-encrypted-source',{mode:0o600});
 assert.throws(()=>Store.rehearseLegacyMigration({
  sourceFile:corrupted,destinationFile:path.join(directory,'corrupt.sqlite'),secret
 }));
 assert.equal(fs.existsSync(path.join(directory,'corrupt.sqlite')),false);
 // A deleted transaction must not silently become a smaller ledger.
 // The sealed bank manifest authenticates the complete set of source IDs.
 const damagedRows=new DatabaseSync(dest);
 damagedRows.exec('DELETE FROM transactions WHERE id_key=(SELECT id_key FROM transactions LIMIT 1)');
 damagedRows.close();
 const missing=Store.open({filename:dest,secret});
 assert.throws(()=>missing.readBank(),/Incomplete encrypted bank transaction set/,
  'Missing source rows must fail closed instead of changing bank history');
 missing.close();
 // Tamper with an existing ciphertext. Failure must be explicit, never a
 // silent bank reset, partial read, or invented transactions.
 const direct=new DatabaseSync(dest);
 direct.prepare('UPDATE records SET sealed=? WHERE kind=?').run(Buffer.from([1,2,3]),'bank');
 direct.close();
 const tampered=Store.open({filename:dest,secret});
 assert.throws(()=>tampered.readBank(),/Invalid encrypted database record/);
 tampered.close();
 for(const [file,original] of Object.entries(bytes))
  assert.deepEqual(fs.readFileSync(file),original,'Legacy files remain rollback-ready');
 // Legacy installations may not yet have a forecast/session sidecar.
 const basic=path.join(directory,'fictional-old.enc');
 fs.writeFileSync(basic,legacyEncrypt(bank),{mode:0o600});
 const basicDest=path.join(directory,'fictional-basic.sqlite');
 const firstTime=Store.rehearseLegacyMigration({sourceFile:basic,destinationFile:basicDest,secret});
 assert.equal(firstTime.forecastPresent,false);
 assert.equal(firstTime.sessionsPresent,false);
 const basicStore=Store.open({filename:basicDest,secret});
 assert.deepEqual(basicStore.readBank(),bank);
 assert.equal(basicStore.readForecasts(),null);
 assert.equal(basicStore.readSessions(),null);
 basicStore.close();
 console.log('PASS phase-4 encrypted SQLite migration parity, blind indexes, atomic multirow rollback, independent forecasts/sessions, fail-closed recovery and no legacy writes');
}finally{
 fs.rmSync(directory,{recursive:true,force:true});
}
