# Deployment verification for Household Ledger

This document distinguishes repository merges, GitHub Pages publishing, and the
private Render banking deployment. A green GitHub check is **not** evidence that
the private Render service is running the same commit.

## Three separate statuses

1. **GitHub source:** the current SHA on the `main` branch. Changes are made on
   feature branches, validated by pull-request checks, then merged.
2. **GitHub Pages:** `.github/workflows/pages.yml` publishes the public static
   demo on pushes to `main`. A successful Pages deployment says nothing about
   private banking deployment.
3. **Private Render service:** the existing password-protected banking service
   runs the live Plaid backend in `pilot/server.cjs`. It can be launched
   directly or through `sandbox/server.cjs` with its existing live-mode
   environment switch. Its deployment revision must be verified independently.

## How to verify the private revision

The private server's unauthenticated `GET /healthz` responds with `ok`,
`mode`, and `commit`. Render automatically supplies `RENDER_GIT_COMMIT` at
runtime. The response includes that value only when it is a valid 40-character
Git SHA; otherwise `commit` is `null`.

Compare the returned full `commit` value with the full SHA on `main`. Also
verify Render's service Deploys view shows a successful **live** deployment,
not only a build. A missing, old, or null commit must be reported as
**not verified**, not as deployed. The endpoint exposes no account records,
passwords, banking tokens, encryption keys or saved forecasts.

## Safe automation configuration

The private Render service itself must be inspected before changing its
settings. Verify that it is connected to
`markbobthomas/household-ledger`, branch `main`, with its existing start
command, disk mount, environment variables, and secrets unchanged. Once these
conditions are verified, Render's **After CI Checks Pass** auto-deploy option
is preferable to **On Commit** for this application. The option belongs to
the **existing private service**, not the fictional test Blueprint.

Do **not** import `render.yaml` to reconfigure the private service:
that file declares `household-ledger-test` as a *fictional* Sandbox with
`sandbox/server.cjs`, test passwords and fixture data. No private banking
deployment may be recreated from those Sandbox defaults.

Do not rotate `PILOT_ENCRYPTION_KEY`, change `PILOT_STATE_PATH`, detach or
replace the persistent disk, overwrite forecast preferences, change live Plaid
credentials, or run tests against real records. Use temporary, isolated
fictional data for regression tests. No hosted Sandbox values should be pushed
to the private banking service.

## Release procedure for future automated changes

- Make a focused branch, change only necessary code, and add regressions.
- Confirm both private pilot safety checks and browser tests pass on the PR.
- Merge into `main`. Report the exact merge SHA as **merged**, not deployed.
- Check post-merge GitHub Actions. GitHub Pages is reported separately.
- Check the existing private Render service's Deploys view and `/healthz`
  deployed SHA. Mark **deployed** only if the commit and successful live deploy
  are both confirmed.
- If Render isn't connected to ChatGPT or the service URL is unknown,
  explicitly report deployment as **unverified**. Never silently claim a merge
  triggered a successful private deploy.

## Household sharing readiness checks (October 31, 2026)

**Source-side safeguards:** The authenticated private Ledger now supports a
deterministic, keyed preference revision returned in the `X-Ledger-Revision`
response header. Current browsers submit that revision with writes, and stale
updates are rejected with HTTP 409 rather than overwriting a newer household
edit. Repeated identical forecast requests remain safe after a dropped reply.
This is not per-user authentication; the same private password still governs
both devices. Upgrade all household browsers to the current page before
concurrent editing; older cached clients without the header retain legacy
compatibility and cannot be guaranteed conflict-safe.

**Mobile sharing:** The existing private Render URL is the only live household
link. The Settings page can use the device share sheet to send its clean root
URL, and Safari Add to Home Screen can install it with an icon. It requires
network access and the existing password. GitHub Pages is a fictional demo
only. No new hosting, public banking endpoint, domain registration, or
authentication changes are included.

**What still requires the owner-authenticated Render dashboard:**
1. Select the **existing** live service, not a new service or the fictional
   `render.yaml` Blueprint. Verify its connected repo and branch, start
   command, compute plan, successful live deployment and currently running SHA
   from `/healthz`.
2. On the existing service Disk page, verify a paid persistent disk mounted
   over `PILOT_STATE_PATH` (typically `/var/data/pilot.enc`) and check that
   daily snapshots are present. A restore would replace the entire disk and
   discard edits made since the selected snapshot; never use Restore to
   test backups on live household data.
3. On Settings, prefer **After CI Checks Pass**, after confirming the existing
   Git integration and relevant required checks. Do not replace the encryption
   key, move state files, change Plaid configuration, detach or resize disks,
   or import the fictional Blueprint to accomplish this.
4. If desired, add a custom domain to that **same service** only after the
   domain owner provides the name and controls DNS. The onrender.com URL works
   without one.

**Verification boundary:** GitHub source/tests can be checked from this repo.
The private Render dashboard, disk snapshot inventory, service plan and live
deployed revision cannot be certified solely from GitHub or a successful
public GitHub Pages action. Mark them *unverified* until inspected directly.

## Private 90-day session rollout (implementation pending verification)

- The private backend has a new password-based sign-in screen at `/login`. On successful sign in, the existing long password is exchanged for a per-device 90-day, Secure, HttpOnly, SameSite=Strict, host-only cookie. Only a hashed session identifier and expiration are kept on the existing encrypted private disk beside the bank state; the browser holds no bank data or password in localStorage.
- Settings provides Sign out. It revokes only that device's session, including across server restarts. Other household devices stay signed in. A prior Basic-authenticated browser is offered a session cookie on its next Ledger page load; a signed-out marker prevents cached Basic credentials from silently reopening the app. Existing Basic authorization remains temporarily accepted when no signed-out marker is present, to avoid breaking old clients.
- A fixed absolute 90-day expiration applies even if Ledger is used daily. The server rejects expired/revoked cookies. Password attempts are rate limited; all existing protected API/asset routes remain guarded.
- **Rollout boundary:** This source change requires the existing private Render service to deploy the new revision before browsers can use it. Do not alter the existing Render disk, encryption key, Plaid setup, or server configuration. Independently check the live `/healthz` commit against the merged GitHub SHA; a source merge or published demo alone is not proof of live private deployment.
