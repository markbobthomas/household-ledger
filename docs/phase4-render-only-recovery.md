# Phase 4 — Render-only recovery and rehearsal (not yet executed)

The owner opted out of a Mac backup. **Do not put bank ciphertext, keys, source records, or credentials in public GitHub.** The existing private Render service `household-ledger-test` has a 1 GB disk at `/var/data`, with bank `/var/data/pilot.enc`, `pilot.enc.forecasts`, and `pilot.enc.sessions`. The owner observed a Render snapshot from November 6, 2026 at 4:37 PM; all three encrypted files were reported nonempty. The Render connector can inspect services and deployments but cannot access disk files, enumerate snapshots, run Shell commands, or test a restore.

Render documents automatic encrypted daily disk snapshots, retained **seven days**; restoring a snapshot **overwrites the whole disk** and discards later changes. See https://render.com/docs/disks. The observed snapshot is a recovery checkpoint, **not a tested restore**, and can become stale. A second copy on the *same disk* helps against accidental overwrites but is **not independent disaster recovery**.

## Safe next step on the existing Render Shell

Only the owner or an authorized remote shell session can execute this. It is not a GitHub Action, predeploy command, automatic startup migration, or deployment. Run it on the currently deployed service, never a new instance. No secrets or private records should be pasted into ChatGPT.

This exact script does not edit original ciphertext files. It takes a checksum before and after copying, rejects a changed source, creates private copies on the existing persistent disk, and uses the existing inactive `pilot/transactional-store.cjs` to rehearse SQLite migration **from copies only** and verify parity. On failure, it deletes only its new rehearsal directory.

```sh
cd /opt/render/project/src
node <<'NODE'
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source=process.env.PILOT_STATE_PATH||'/var/data/pilot.enc';
if(!path.isAbsolute(source)||!source.startsWith('/var/data/'))throw Error('Unexpected path');
const files=[source,source+'.forecasts',source+'.sessions'];
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before=files.map(f=>{
 if(!fs.lstatSync(f).isFile())throw Error('Not a regular source file');
 return sha(f);
});
const directory=path.join('/var/data','ledger-phase4-backup-'+
 new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
fs.mkdirSync(directory,{mode:0o700});
try{
 const copies=files.map(f=>{
  const dst=path.join(directory,path.basename(f));
  fs.copyFileSync(f,dst,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(dst,0o600);
  return dst;
 });
 const after=files.map(sha), copied=copies.map(sha);
 if(before.some((v,i)=>v!==after[i]||v!==copied[i]))
  throw Error('Files changed during copy; retry during a quiet period');
 const {rehearseLegacyMigration}=require('./pilot/transactional-store.cjs');
 const result=rehearseLegacyMigration({
  sourceFile:copies[0],
  destinationFile:path.join(directory,'candidate.sqlite'),
  secret:process.env.PILOT_ENCRYPTION_KEY
 });
 if(!result.verified||!result.forecastPresent||!result.sessionsPresent)
  throw Error('Missing category or parity failure');
 fs.writeFileSync(path.join(directory,'ciphertext-sha256.json'),
  JSON.stringify(copies.map((f,i)=>({file:path.basename(f),sha256:copied[i]}))),{mode:0o600});
 console.log('VERIFIED: Render ciphertext backup and isolated SQLite parity');
 console.log('Recovery location: '+directory);
}catch(e){
 fs.rmSync(directory,{recursive:true,force:true});
 console.error('NOT VERIFIED: '+e.message);
 process.exitCode=1;
}
NODE
```

Only a visible `VERIFIED` result establishes that this operation succeeded; it would **not** mean a live database cutover or independent snapshot restore succeeded. If the environment lacks Node 22+ or the current source code, it must fail safely. No shell execution or backup creation has yet been verified.

## Production cutover remains gated

Before replacing the active file store: verify a **fresh** Render snapshot close to cutover; validate a rehearsed restore/parity and app readback; implement and test explicit runtime SQLite integration and rollback using fictional CI; pause bank refreshes and household writes for a consistent handoff; preserve original encrypted files, session and forecast parity; and obtain separate owner authorization. Never rely on a days-old snapshot alone, change Render secrets, or restore a snapshot on production merely as a test. Until then the current AES-GCM system stays live.
