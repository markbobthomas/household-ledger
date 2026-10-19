# One-link online testing (fictional Sandbox)

The hosted test Sandbox is a **separate, password-protected web app**. It is
designed for testing categories, transactions, balances and pending/posting
behaviour with **fictional fixtures only**. The existing localhost server and
public GitHub Pages site are not converted into public Plaid backends.

## Set up once (no terminal commands or downloads)

1. Sign into [Render](https://dashboard.render.com/).
2. Open **Blueprints** > **New Blueprint Instance** and authorize the
   GitHub repository `markbobthomas/household-ledger`.
3. Select the `render.yaml` Blueprint. Choose a **new, strong, unique
   password of at least 16 characters** for `SANDBOX_TEST_PASSWORD`.
   Do not use a bank password or a Plaid API secret.
4. Approve the service and **paid persistent disk** charges shown by Render.
   A disk is required to remember connected fictional test institutions.
5. When deployment finishes, open the `https://...` address shown by
   Render. When prompted, username is **tester**, password is the password
   you chose. Bookmark this address.

From then on: changes pushed to GitHub deploy automatically. Refresh that
same bookmarked page to see the updated app. Your browser's category
overrides persist on that browser/origin, and the fictional connected
institutions are restored from the persistent disk after redeploy.

## Separation and limits

- The regular public app stays at
  https://markbobthomas.github.io/household-ledger/
- The hosted test app uses *deterministic, local Plaid-shaped fixtures*
  rather than calling the Plaid API, even if Plaid env variables are set.
  You can test categorization and pending-to-posted flows without any
  credentials. **It does not currently exercise live calls to Plaid
  Sandbox**. That would require a separate cloud-ready token-storage
  implementation and security review.
- Category edits and other Ledger interface preferences remain in the
  browser's local storage. They will not automatically sync between the
  Mac and iPhone. Do not clear browser site data if you wish to keep them.
- Use HTTPS and a unique secret. Basic authentication is a lightweight
  gate for fictional test data, not account-grade financial security.
- The hosted instance is not appropriate for real bank connections or
  personal financial records.
- The Render Blueprint uses a paid starter web service with a persistent
  disk. Pricing is displayed by Render before confirmation.
