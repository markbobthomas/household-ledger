# Automatic Amazon updates in Ledger

You no longer need a PC or Chrome extension for the recommended setup. Ledger uses the TinyFish cloud browser to read Amazon orders and privately match them to *existing* bank charges.

## Set up once — no technical knowledge required

In Full Ledger, open **Settings → Amazon purchases → Set up Amazon updates**. The Ledger page includes these nine actions, including the links and the place to paste your key:

1. **Open TinyFish.** Tap **Open TinyFish** in Ledger, or open https://agent.tinyfish.ai. Sign in to TinyFish, or select **Sign up** if you are new. No desktop installation is required.
2. **Find TinyProfiles.** From the TinyFish dashboard menu, choose **TinyProfiles**. This is the feature that saves a website login. Do not choose **Browser Profiles** (Lite/Stealth); that controls browser behavior, not saved Amazon sign-in. TinyFish's current [official TinyProfiles guide](https://docs.tinyfish.ai/key-concepts/tinyprofile) explains the setup.
3. **Use the default TinyProfile.** If a profile is marked **Default**, open it and begin its sign-in/setup session. If none exists, select **Create Profile**, name it **Ledger Amazon**, select **Set as default**, then press **Create and set up**. Ledger's current TinyFish API uses the default profile, so this distinction matters.
4. **Sign in to Amazon *inside the TinyFish setup browser*.** Visit **www.amazon.com/your-orders**, enter Amazon credentials on Amazon's own page and complete any verification requested. Make sure you can see real orders.
5. **Save the login.** In TinyFish, select **Save** or **Save setup session**. Do not simply close the setup browser before saving.
6. **Get an API key.** Open TinyFish's official [API Keys page](https://agent.tinyfish.ai/api-keys). Sign into the **same TinyFish account** used for your saved Amazon session. Select **Create API Key** and optionally name it **Ledger Amazon**.
7. **Copy the key.** Select **Copy** immediately when it is displayed; it may only be shown in full once. An API key is a private connection code, not your Amazon password. Do not share it in chat, screenshots, public code or messages.
8. **Paste into Ledger.** Return to the Amazon setup page, find **Paste TinyFish API key here**, paste your key, and press **Connect TinyFish**. Wait until Ledger says **TinyFish connected**. Ledger checks your TinyFish key and Default TinyProfile through a free, read-only TinyProfiles lookup. If TinyFish reports that Amazon has not been saved, Ledger explains how to save it rather than beginning a paid run. Once connected, Ledger saves the profile identity and key in private encrypted state; changing TinyFish's Default profile later will not unexpectedly change the browser Ledger uses.
9. **Enable.** Press **Turn on automatic updates** (below the instructions). Confirm the page shows **Automatic updates ON**. You can close Ledger and your computer; the private Render server performs checks when enabled and running.

The numbered instructions remain available in a collapsible section, even after TinyFish is connected. You can reopen them to repair an Amazon login. If a key has been connected already, **Disconnect** is available to revoke Ledger's saved copy.

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

If **Connect TinyFish** fails, return to the **API Keys** page and copy the correct key from the same TinyFish account as your Amazon sign-in. Check that TinyFish's **Default TinyProfile** has a saved Amazon sign-in; Ledger will tell you if it cannot verify that setup. If an Amazon run says sign-in is required, go to TinyFish **TinyProfiles**, reopen the **default** profile's setup, sign in to Amazon inside that browser, and save it again. If the bank isn't updating, sign in to Ledger and use **Sync** to repair the existing bank connection. If an order cannot be matched exactly to a posted bank charge, use Lite or the ZIP/CSV fallback instead of guessing. If updates show **Paused**, read the reason under **Last check and troubleshooting**, repair the Amazon sign-in or connection, and then press **Turn on automatic updates** again. Ledger does not silently keep retrying paid runs.

**Release boundary:** Connecting TinyFish and a successful live signed-in Amazon extraction require one-time owner action. Repository tests use fictional data and do not establish that your private Render deployment is current. The retired desktop-extension source remains archived for existing users but is no longer the recommended setup.
