# Ledger private backup and recovery

**Scope:** Owner-controlled portable recovery in addition to Render's existing disk snapshots. This does not change Plaid links, running encrypted files, Render persistent disks, or forecast calculations.

## Create an independent encrypted backup

1. On the **private** Ledger website, open **Settings → Recovery backup** (or **Bank connections → Encrypted recovery backup**).
2. Choose a unique recovery passphrase of at least 20 characters (prefer several unrelated random words). Confirm it, then choose **Download encrypted backup**.
3. On your device, **save the resulting `.ledgerbackup` file outside Render** (for example, iCloud Drive, a separate secured cloud-storage account, or an encrypted external drive). Confirm the saved file is present and has nonzero size. Store the passphrase separately in a password manager. Ledger never stores the passphrase and cannot recover it for you.
4. Repeat after meaningful bank, category, note, schedule or forecast changes. The export is not automatically transferred to cloud storage.

The authenticated endpoint `POST /api/backup/export` requires the existing private session or compatible Basic auth, a same-origin request, and `X-Pilot-Action: 1`. It serializes against bank mutations and completed forecast/session saves, checks the source AES-256-GCM authentication tags, and returns a **single passphrase-encrypted** bundle. The download is marked `no-store`, exposes no plaintext through headers, does not write an archive to Render's persistent disk, and never alters Plaid connections. Both the existing Render source key and its private bank files remain unchanged.

The portable file includes bank history, account links and metadata, category decisions, forecast settings, and session state when the corresponding files exist. The complete payload is encrypted with **AES-256-GCM** using a separate scrypt-derived key (N=32768, r=8, p=1 and a random 32-byte salt), so a replacement Render service does **not** need the original `PILOT_ENCRYPTION_KEY` to decrypt the archive. **Only the owner-held recovery passphrase can open it.** Treat the encrypted archive and passphrase as highly sensitive.

## Verify or rehearse an isolated restore

Use a trusted machine with Node.js 22 or newer and this source checkout. Do not upload either the archive or passphrase to public GitHub, a support ticket, ChatGPT, or a publicly accessible demo. Put the passphrase in an ephemeral environment variable (not on the command line or in committed files) and use a **new, empty path** outside the running server's state directory.

```sh
node pilot/recovery-cli.cjs verify /secure/location/ledger-private-YYYY-MM-DD.ledgerbackup

# Only in an isolated environment with a new encryption key:
node pilot/recovery-cli.cjs restore /secure/location/ledger-private-YYYY-MM-DD.ledgerbackup /isolated/brand-new-restore-directory
```

The verifier needs `LEDGER_BACKUP_PASSPHRASE`. An isolated restore additionally needs the destination environment's `PILOT_ENCRYPTION_KEY`. Neither secret is accepted in command-line arguments. The restore utility creates a brand-new directory with owner-only permissions, writes the three legacy-compatible encrypted private files, re-reads and decrypts them with the **new** key, then compares every restored object with the source archive. **It refuses to overwrite any existing destination directory or file.** There is deliberately no authenticated browser or network-facing live restore API.

Do not take restored files live until a separate authorized migration procedure has confirmed bank-link credentials, runtime configuration, source-key continuity for the target, and the recoverability of the existing production disk. Overwriting Render's live persistent disk with a snapshot or reconstructed files is destructive and not part of this feature.

## What is verified and what remains open

The mandatory regression suite covers a fictional bank with checking account and card-like history, category edits, separate recurring forecasts and saved sessions: authenticated download, anonymous/cross-origin rejection, stable original encrypted files, wrong-passphrase/tamper rejection, a separate-secret isolated restore, file permissions and refusal to overwrite. The **fictional** archive is verified independently; this does **not** certify that a real off-site backup is currently present.

Render documents daily persistent-disk snapshots with seven-day retention, but the snapshot inventory and a restore of the owner's **actual** encrypted disk have not been directly verified here. Unlike the portable archive, Render snapshots are a short-retention, provider-bound recovery option. Never run a snapshot restore on the live Ledger service as a test.

**Open operational step:** An actual independent backup exists only once the owner securely downloads and saves the portable archive outside the Render service, retains its passphrase, and verifies access to that file. An ongoing **automatic** off-site schedule would additionally require an authorized separate backup destination and credentials; none are configured by this code.
