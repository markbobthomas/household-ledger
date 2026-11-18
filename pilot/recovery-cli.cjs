'use strict';
// Offline-only recovery utility. Never exposes a restore endpoint in the app.
// Usage (with LEDGER_BACKUP_PASSPHRASE in the environment):
//   node pilot/recovery-cli.cjs verify /path/to/file.ledgerbackup
//   PILOT_ENCRYPTION_KEY=<new deployment key> node pilot/recovery-cli.cjs restore /path/to/file.ledgerbackup /new/empty-directory
// Never put secrets into command arguments, GitHub, or the app's logs.
const fs=require('node:fs/promises'),path=require('node:path');
const Backup=require('./portable-backup.cjs');
(async()=>{
 const [, ,action,filename,destination]=process.argv;
 if(!['verify','restore'].includes(action)||!filename||
  action==='restore'&&!destination||action==='verify'&&destination)
  throw Error('Usage: node pilot/recovery-cli.cjs verify <backup> | restore <backup> <new-absolute-directory>');
 const passphrase=process.env.LEDGER_BACKUP_PASSPHRASE;
 const bundle=await fs.readFile(path.resolve(filename));
 if(action==='verify'){
  const parts=await Backup.open(bundle,passphrase);
  console.log('PASS portable recovery archive: authenticated bank snapshot'+
   (parts.forecasts!==null?', forecast preferences':'')+
   (parts.sessions!==null?', saved sessions':''));
  return;
 }
 const output=await Backup.restore({bundle,passphrase,destination,
  secret:process.env.PILOT_ENCRYPTION_KEY});
 if(!output.verified)throw Error('Isolated restore was not verified');
 console.log('PASS isolated recovery verification. No live Ledger file was overwritten.');
})().catch(error=>{
 // Do not log secrets, decrypted payloads or system paths from thrown errors.
 console.error('Recovery failed: check the archive, passphrase, and isolated destination.');
 process.exitCode=1;
});
