# Automatic Amazon updates in Ledger

You no longer need a PC or Chrome extension for the recommended setup. Ledger uses the TinyFish cloud browser to read Amazon orders and privately match them to *existing* bank charges.

## Set up once — from the TinyFish screen that asks what your agent should do

In Full Ledger, open **Settings → Amazon purchases → Set up Amazon updates**. If TinyFish displays **"What do you want your agent to do?"**, you are in the **Agent Playground**. That is not the reusable sign-in setup. **Do not type an Amazon prompt or click Run** — doing so does not establish the saved Amazon browser login Ledger requires and could start a charged Agent job.

Follow these steps in Ledger:

1. **Recognize the Agent screen.** The "What do you want your agent to do?" box is normal; leave it alone during setup.
2. **Go straight to [TinyFish saved profiles](https://agent.tinyfish.ai/profiles).** This is the direct profile link from TinyFish's own [illustrated setup tutorial](https://docs.tinyfish.ai/agent/how-to/create-google-form-with-profile). Sign in to your TinyFish account if prompted.
3. **Create an Amazon profile.** Select **Create profile**, name it **Ledger Amazon**, press **Next**, and choose **Open a browser and sign in**. Existing Amazon saved profile? Open its setup option instead. Mark the Amazon profile as **Default** because Ledger's connection checks for a default profile.
4. **Log in to Amazon inside TinyFish's setup browser.** Enter **https://www.amazon.com/your-orders** in TinyFish's browser address field and select **Open**. Sign in on Amazon's own page, finish any verification, and confirm that Your Orders appears.
5. **Save the session.** Select **Save** in TinyFish after the browser captures the sign-in. Confirm that **amazon.com** is listed as **Signed in** in the profile and that the Amazon profile is the **Default**. Do not close the setup window without saving.
6. **Open the [TinyFish API Keys page](https://agent.tinyfish.ai/api-keys).** In the same TinyFish account, select **Create API Key** (name it "Ledger Amazon" if asked).
7. **Copy** the API key when TinyFish shows it. Do not share it in a chat or put your Amazon password anywhere in Ledger.
8. **Return to Ledger.** Paste the key into **Paste TinyFish API key here** and select **Connect TinyFish**. Ledger checks the key and saved profile using a free, read-only TinyFish API request. The connection remains OFF until you enable it.
9. **Tap Turn on automatic updates.** Confirm the **Automatic updates ON** status. Older charges are not imported automatically; the server checks new posted Amazon charges on its schedule without requiring a computer to remain open.

**If TinyFish only offers the agent prompt and [the saved-profiles link](https://agent.tinyfish.ai/profiles) also fails:** Do not try to force setup by typing instructions into the prompt. Your current TinyFish account or interface may not expose the required saved-session setup. Check the [official visual guide](https://docs.tinyfish.ai/agent/how-to/create-google-form-with-profile), contact TinyFish to clarify access, and use Ledger's **manual Amazon ZIP/CSV import** meanwhile. Leave automatic updates OFF. This is an explicit setup limitation, not something Ledger can safely bypass by repeatedly running a paid browser Agent.

## When it checks

- **Monday, Thursday and Saturday, after 8 AM Pacific.** Ledger first syncs fresh bank transactions through the existing secure Plaid connection.
- **First activation starts from new charges going forward**. Older transactions already in Ledger do not trigger a surprise historical scan; use the separate manual order-history import if you need a backfill.
- If there is **no new, unmatched posted Amazon charge**, TinyFish is **not called**.
- If one or more charges are newly eligible, Ledger makes **one** TinyFish browser run, not one run per transaction.
- A completed, verified match is remembered, so the same charges do not launch another browser job. Pending charges are ignored until they post.
- **Only exact matches** can save product details or apply automatic categories. Possible and fuzzy matches are left alone. A report that is incomplete, empty, or unable to match any charge pauses automatic updates. It does not claim success or start another paid run silently.
- The **Check now** button allows an expressly confirmed check, but follows the same cost and safety limits: one run per Pacific day and no more than 13 starts in the previous 30 days, including scheduled checks. It still requires a new posted unmatched Amazon charge.

## Cost and limits

At TinyFish's observed November 2026 rates, Ledger **requests** a 45-Agent-step and 10-minute ceiling. At $0.016/step plus $0.002/browser-minute, that is approximately **$0.74** in the model; provider billing could differ. **TinyFish currently restricts custom step limits to some accounts.** Ledger does not silently drop the limit if TinyFish rejects it. It shows a setup error instead; ask TinyFish to enable per-run step limits. No uncapped browser run is authorized. The routine schedule provides no more than three opportunities per week. A hard limit on launches prevents more than **one browser start per Pacific day or 13 in any rolling 30 days**, including user-initiated checks. Cost estimates are not a provider-enforced spending cap; actual TinyFish billing can differ.

TinyFish browser costs are **separate** from Ledger's **$0.08 AI categorization** approval limit.

## What is shared

TinyFish sees only the Amazon order website through your authorized browser profile. It returns an order ID, item title, dates and prices to Ledger's private server. Ledger's **bank account identifiers, balances, Plaid tokens and full banking history are never in the TinyFish browser prompt**.

Ledger applies its existing conservative Amazon matcher. Verified prices and dates can add product Notes and supported confident categories without changing bank transactions. Ambiguous and split orders are left for review. A successful scan never creates duplicate purchases, even if the exact matching fails.

The TinyFish API key and pinned saved profile ID are stored in Ledger's encrypted private state, not in GitHub, the shared Lite page or app GET responses. Use **Turn off automatic updates** to stop new browser runs; already-started jobs may still incur charges. Use **Disconnect** to clear the stored key.

## Troubleshooting

**TinyFish says the API was accessed, but Ledger says HTTP 400:** An API access is not an accepted browser run. Ledger previously sent a TinyFish `output_schema` containing an unsupported `type: ["integer", "null"]` for an order total. TinyFish's documented validator returns HTTP 400 before a browser run for that structure; Ledger now uses `type: "integer", nullable: true`. This was fixed in source after the reported incident. The same API key and saved Amazon sign-in can be reused; do not reenter your Amazon password. Once the corrected private Ledger deployment is verified, review the paused status and explicitly re-enable updates if desired. No automatic charged retry will be started. If a new 400 appears, Ledger now surfaces TinyFish's sanitized error code, reason and request ID for diagnosis rather than just the HTTP status. TinyFish's separate beta-only 45-step limit can still block a run; that limit is never silently disabled.

If **Connect TinyFish** fails, first use the direct [saved profiles](https://agent.tinyfish.ai/profiles) link rather than the agent prompt; verify that the default Amazon profile says Signed in. Recopy the key from [TinyFish API Keys](https://agent.tinyfish.ai/api-keys) if needed. If the saved-profiles page is missing, automatic setup cannot yet proceed—use manual import or ask TinyFish about feature access. If Amazon later requests sign-in, reopen the saved profile's setup browser, sign in again and choose Save. If the bank isn't updating, sign in to Ledger and use **Sync** to repair the existing bank connection. If an order cannot be matched exactly to a posted bank charge, use Lite or the ZIP/CSV fallback instead of guessing. If updates show **Paused**, read the reason under **Last check and troubleshooting**, repair the Amazon sign-in or connection, and then press **Turn on automatic updates** again. Ledger does not silently keep retrying paid runs.

**Release boundary:** Connecting TinyFish and a successful live signed-in Amazon extraction require one-time owner action. Repository tests use fictional data and do not establish that your private Render deployment is current. The retired desktop-extension source remains archived for existing users but is no longer the recommended setup.
