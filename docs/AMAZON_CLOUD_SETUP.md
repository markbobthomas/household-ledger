# Automatic Amazon updates in Ledger

You no longer need a PC or Chrome extension for the recommended setup. Ledger uses the TinyFish cloud browser to read Amazon orders and privately match them to *existing* bank charges.

## Set up once

1. Open **Ledger → Settings → Amazon purchases**.
2. Open **TinyFish** from that page. In TinyFish, open your saved browser profile, sign in to your Amazon account, and save the session. This is the only Amazon sign-in; **never enter your Amazon password in Ledger**.
3. In your TinyFish account, get an API key and paste it into the **TinyFish API key** box in Ledger. Press **Connect TinyFish**. Ledger checks the key without starting a paid browser run.
4. Press **Turn on automatic updates**.

That's it. You can close Ledger and turn off your PC. The cloud **server** performs the checks while its Render service is running.

## When it checks

- **Monday, Thursday and Saturday, after 8 AM Pacific.** Ledger first syncs fresh bank transactions through the existing secure Plaid connection.
- If there is **no new, unmatched posted Amazon charge**, TinyFish is **not called**.
- If one or more charges are newly eligible, Ledger makes **one** TinyFish browser run, not one run per transaction.
- A completed run is remembered, so the same charges do not launch another browser job. Pending charges are ignored until they post.
- The **Check now** button allows a separate expressly confirmed check. It still requires a posted unmatched Amazon charge.

## Cost and limits

At TinyFish's observed November 2026 rates, the run is limited to **45 Agent steps** and **10 minutes**. At $0.016/step plus $0.002/browser-minute, the maximum modeled amount is approximately **$0.74** per completed run, before any other applicable provider fees. This is a safety estimate rather than an exact provider invoice cap. The UI conservatively says **up to about $1 per run**. The routine schedule provides no more than three opportunities per week. User-initiated extra checks are billed separately.

TinyFish browser costs are **separate** from Ledger's **$0.08 AI categorization** approval limit.

## What is shared

TinyFish sees only the Amazon order website through your authorized browser profile. It returns an order ID, item title, dates and prices to Ledger's private server. Ledger's **bank account identifiers, balances, Plaid tokens and full banking history are never in the TinyFish browser prompt**.

Ledger applies its existing conservative Amazon matcher. Verified prices and dates can add product Notes and supported confident categories without changing bank transactions. Ambiguous and split orders are left for review. A successful scan never creates duplicate purchases, even if the exact matching fails.

The TinyFish API key is stored in Ledger's encrypted private state, not in GitHub, the shared Lite page or app GET responses. Use **Turn off automatic updates** to stop new browser runs; already-started jobs may still incur charges. Use **Disconnect** to clear the stored key.

## Troubleshooting

If **Connect TinyFish** fails, check the API key in TinyFish's settings and retry. If an Amazon run says sign-in is required, reopen the saved TinyFish browser profile, sign into Amazon again, and save it. If the bank isn't updating, sign in to Ledger and use **Sync** to repair the existing bank connection. If an order cannot be matched to a posted bank charge, use Lite or the ZIP/CSV fallback instead of guessing.

**Release boundary:** Connecting TinyFish and a successful live signed-in Amazon extraction require one-time owner action. Repository tests use fictional data and do not establish that your private Render deployment is current. The retired desktop-extension source remains archived for existing users but is no longer the recommended setup.
