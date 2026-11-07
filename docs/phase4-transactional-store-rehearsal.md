# Phase 4 — encrypted transactional storage: safe migration rehearsal

**Status:** Candidate implementation and fictional-data verification only. **Existing private Ledger still uses the original encrypted bank file, separate encrypted forecast file, and separately encrypted session file.** No real cutover, on-disk conversion or cloud infrastructure change is included.

## Why an isolated rehearsal

The current private backend safely replaces each AES-GCM file independently, but a bank sync, category adjustment and saved forecast can span more than one file. A transactional store can commit coherent bank records/cursors together and update stored forecasts or sessions separately without rewriting every bank record. This change is riskier than display-cache cleanup: automatically migrating an unverified live Render disk would risk account recovery, bank source integrity and saved household metadata. The first deliverable is a reversible engine plus a verified fictional migration and rollback test, not a switch on the private service.

## New store boundaries

- `pilot/transactional-store.cjs` is a new opt-in Node 22+ SQLite backend using native `node:sqlite`. It is not referenced by `pilot/server.cjs`, startup, live `/api/ledger` or Render configuration.
- Each bank transaction is individually AES-256-GCM sealed; transaction ID, account and YYYY-MM month are stored solely as keyed HMAC blind indexes. The bank metadata document, forecast preferences and hashed session records are separate sealed values. Cleartext schema identifiers contain no provider token, actual account ID, merchant, amount, note, date or personal data. Existing `PILOT_ENCRYPTION_KEY` derivation is preserved in the new engine; no key is rotated.
- SQLite uses full synchronous durability, rollback journaling and transaction boundaries for all bank rows and cursor/meta, with a complete rollback on a mid-batch failure. A separate forecast write does not touch bank rows or session state, and a bank write does not overwrite newer user preferences.
- Encrypted values use random 96-bit nonces and GCM authentication tags with domain-separated associated data; reading with the wrong secret or tampered ciphertext throws rather than treating the state as an empty ledger. The DB is owner-only (0600). Neither a raw SQL query nor the database bytes expose meaningful transaction IDs, account names or amounts.

## Reversible import contract

1. Source: the unchanged legacy `pilot.enc`, optional `.forecasts` and optional `.sessions`; never edit them. Prefer **offline fictional or independently verified backup copies** in a fresh isolated directory for all rehearsals.
2. Destination: a **new absolute path**, never the source path or an existing SQLite file. Import reads/decrypts all legacy envelopes first, writes to a temporary SQLite candidate, and compares canonical JSON of every reconstructed record, preference, and session before publishing the target via a no-clobber hard link.
3. On any failure, temporary candidate files are discarded; the legacy source remains bit-for-bit unchanged and usable. Wrong keys, unexpected schema versions, corrupted values, malformed source, existing destination or failed verification abort the import.
4. Source bank transactions and Item cursor are committed in one transaction. Account/month queries read only the matching keyed index and authenticate/decrypt individual rows. Future API integration must preserve existing `X-Ledger-Revision`, HTTP 409 conflict semantics, pending→posted ID links, forecast idempotency and server-authoritative Plaid source facts.

## Acceptance and live-cutover gate

Before the first private cutover, independently confirm: (a) the active private Render service, exact deployed source SHA, disk mount and `PILOT_STATE_PATH`; (b) successful snapshots and a **separate** tested offline encrypted restore, without restoring over the production disk; (c) production-safe Node/SQLite runtime, disk filesystem and backup support; (d) stable bank Item/cursor, forecast overrides, category notes, schedule edits, hashed 90-day sessions and per-device revision parity in representative *sanitized* tests; (e) correct access control on database, temporary files and persistent disk; (f) a maintenance window that pauses concurrent household writes and Plaid refresh; and (g) a documented backout to the unchanged original AES-GCM files. Do not enable the candidate store, remove old files, rotate keys, import `render.yaml`, or overwrite Render settings by inference.

**Manual acceptance now:** The owner can verify that Home, Bills, Spending, Transactions, Review, notes and multi-device saved preferences are unchanged because the new store is not live. Migrate private storage only after all prerequisites and a separate explicit production-cutover decision. The current PR has **no code path** that silently activates the candidate on production.
