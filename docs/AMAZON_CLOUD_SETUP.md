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
- **Only exact matches** can save product details or apply automatic categories. Possible and fuzzy matches are left alone. The Agent now requests each item's own verified price, with missing prices represented as `null` rather than invented zeros. Ledger excludes *entire orders* with any unpriced item; orders outside the 45-day window are ignored. If a partially priced order could be the same bank charge, Ledger refuses to call a different order an exact match. Complete priced orders may still be matched, but any incomplete order or unmatched target pauses the automatic schedule and leaves unverified bank charges for review. No additional paid run starts automatically.
- The **Check now** button allows an expressly confirmed check, but follows the same cost and safety limits: one run per Pacific day and no more than 13 starts in the previous 30 days, including scheduled checks. It still requires a new posted unmatched Amazon charge.

## Cost and limits

Ledger uses the **standard TinyFish Agent**, without the beta-only `agent_config.max_steps` field, and requests a **600-second (10-minute) timeout**. TinyFish's standard default is up to **150 steps**. At the quoted rates of **$0.016 per Agent step** plus **$0.002 per browser minute**, a run reaching both 150 steps and 10 minutes models to **$2.42**. Five such runs model to **$12.10**, and the existing upper limit of 13 starts per rolling 30 days models to **$31.46**. These are *modeled costs*, **not guaranteed spending caps**: actual billing could differ, and runs using fewer steps cost less. Ledger does not independently enforce a dollar cap per run. Automatic updates remain OFF until the owner explicitly enables them. The existing one-start-per-Pacific-day, 13-per-30-days, only-new-posted-charges and pause-on-failure protections remain in effect. A run already started can incur charges even if paused later.

TinyFish browser costs are **separate** from Ledger's **$0.08 AI categorization** approval limit.

## What is shared

TinyFish sees only the Amazon order website through your authorized browser profile. It returns an order ID, item title, dates and prices to Ledger's private server. Ledger's **bank account identifiers, balances, Plaid tokens and full banking history are never in the TinyFish browser prompt**.

Ledger applies its existing conservative Amazon matcher. Verified prices and dates can add product Notes and supported confident categories without changing bank transactions. Ambiguous and split orders are left for review. A successful scan never creates duplicate purchases, even if the exact matching fails.

The TinyFish API key and pinned saved profile ID are stored in Ledger's encrypted private state, not in GitHub, the shared Lite page or app GET responses. Use **Turn off automatic updates** to stop new browser runs; already-started jobs may still incur charges. Use **Disconnect** to clear the stored key.

## Standard Agent without beta

A custom 45-step maximum previously required TinyFish beta entitlement and prevented standard accounts from starting. Ledger intentionally no longer requests that feature. **Do not assume a $1 ceiling**: the standard Agent may use up to 150 steps, in addition to browser time. Start with one explicitly approved manual **Check now** run, inspect the TinyFish invoice and matching results, then decide whether to enable the optional automatic schedule. Manual ZIP/CSV remains available if the cost or the quality is unsuitable.

## Recover a completed check without starting another Agent

If the last check says **Paused: incomplete Amazon report** or **no unambiguous priced order matched**, stay paused; do not click **Check now** or re-enable automatic updates merely to try again. Open **Last check and troubleshooting → Recheck a completed TinyFish result**. If Ledger saved its run ID, it fills the field; for an older failed check, copy the completed Amazon check's **Run ID** from TinyFish and paste it. Select **Recheck saved result**. This retrieves the previous provider result with a read-only API call, **not** a new paid browser Agent. It works even when the one-start-per-day paid limit has been reached, but only for a recent completed check belonging to the connected saved Amazon profile. It never modifies source bank transactions or automatically enables scheduled checks.

Rechecking does **not** magically recover missing item prices. It can salvage fully priced orders if their amounts and dates uniquely match a still-unchecked posted charge and no incompletely priced order could plausibly claim the same charge. If the result remains ambiguous, Ledger keeps it paused. Use the manual Amazon ZIP/CSV import for purchases requiring item-level detail. A previously rejected run may still need that manual fallback.

Ledger now refreshes the owner-only run status periodically while the Amazon page is open and a check is active; closing the page does not interrupt the server. No paid Agent run is started by a status refresh.

## Troubleshooting

**TinyFish says the API was accessed, but Ledger says HTTP 400:** An API access is not an accepted browser run. Ledger previously sent a TinyFish `output_schema` containing an unsupported `type: ["integer", "null"]` for an order total. TinyFish's documented validator returns HTTP 400 before a browser run for that structure; Ledger now uses `type: "integer", nullable: true`. This was fixed in source after the reported incident. The same API key and saved Amazon sign-in can be reused; do not reenter your Amazon password. Once the corrected private Ledger deployment is verified, review the paused status and explicitly re-enable updates if desired. No automatic charged retry will be started. If a new 400 appears, Ledger now surfaces TinyFish's sanitized error code, reason and request ID for diagnosis rather than just the HTTP status. The standard Agent no longer needs beta step-limit access.

If **Connect TinyFish** fails, first use the direct [saved profiles](https://agent.tinyfish.ai/profiles) link rather than the agent prompt; verify that the default Amazon profile says Signed in. Recopy the key from [TinyFish API Keys](https://agent.tinyfish.ai/api-keys) if needed. If the saved-profiles page is missing, automatic setup cannot yet proceed—use manual import or ask TinyFish about feature access. If Amazon later requests sign-in, reopen the saved profile's setup browser, sign in again and choose Save. If the bank isn't updating, sign in to Ledger and use **Sync** to repair the existing bank connection. If an order cannot be matched exactly to a posted bank charge, use Lite or the ZIP/CSV fallback instead of guessing. If updates show **Paused**, read the reason under **Last check and troubleshooting**, repair the Amazon sign-in or connection, and then press **Turn on automatic updates** again. Ledger does not silently keep retrying paid runs.

**Release boundary:** Connecting TinyFish and a successful live signed-in Amazon extraction require one-time owner action. Repository tests use fictional data and do not establish that your private Render deployment is current. The retired desktop-extension source remains archived for existing users but is no longer the recommended setup.
