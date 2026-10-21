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
