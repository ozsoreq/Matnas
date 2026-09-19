# Fast QR ticket scanner

Replaces the normal flow (scan → browser navigates to the ticket site →
Hebrew popup → tap OK → tap back → scan again, ~10s/person) with a page that
stays open, shows the same result inline, and is ready for the next scan
within about a second.

## Why a proxy is needed

The ticket site (`matnas-kz.co.il`) doesn't send CORS headers, so a browser
page is not allowed to read its response directly — that's a security
restriction of every browser, not something fixable from this page alone.
`worker.js` is a tiny server-side proxy: it fetches the ticket URL itself
(server-to-server calls aren't restricted by CORS), pulls out the Hebrew
status text, and returns clean JSON to the scanner page.

## Setup (one-time, ~10 minutes)

1. **Deploy the proxy** (free, no credit card):
   - Go to <https://workers.cloudflare.com>, sign up / log in.
   - Create a new Worker, paste in the contents of `worker.js`, deploy.
   - Copy the resulting URL, e.g. `https://qr-ticket-proxy.<you>.workers.dev`.

2. **Create the guest-log database** (D1 — Cloudflare's free SQLite):
   - In the Cloudflare dashboard: **Workers & Pages → D1 → Create database**
     (any name, e.g. `matnas-guests`).
   - Open its **Console** tab and paste in the contents of `schema.sql`, then run it.
   - Go to your Worker → **Settings → Bindings → Add binding → D1 database**.
     Variable name must be exactly `DB`, and select the database you just created.

3. **Protect the guest list** with a secret key:
   - Worker → **Settings → Variables** → add a variable named `ADMIN_KEY`
     (mark it as a **Secret**), value = any password you choose. This is what
     guards the list of names/orders from being publicly viewable.
   - Re-deploy the worker after adding the binding/variable (it only applies
     to new deployments).

4. **Point the scanner at the proxy**:
   - Open `index.html`, find the line:
     ```js
     const PROXY_URL = "";
     ```
   - Paste your Worker URL in between the quotes.

5. **Host `index.html` and `guests.html`** somewhere with HTTPS (camera
   access requires a secure context) — GitHub Pages, Netlify, Vercel, or any
   static host works. Open `index.html` on the phone that will do the
   scanning, tap **התחל סריקה**, and allow camera access.

## Using it at the door

- Point the camera at the ticket's QR code.
- The screen flashes **green** ("✓") for a valid, first-time scan, or **red**
  ("✕") if it was already used, showing the ticket system's own status
  phrase plus explicit lines for **שם הרוכש** (purchaser name), **מס׳ הזמנה**
  (order number), and **כרטיסים שמומשו** (tickets redeemed, X out of Y) —
  then automatically returns to the camera view after ~1.4 seconds.
- No tapping, no back button — just move to the next ticket.
- A running session total (scanned / approved / duplicate) shows at the top
  for staff's own tracking; this resets if the page reloads — for the
  permanent record, use the guest list below.

## Viewing the guest log

Every scan (success or duplicate) is written to the D1 database with the
date/time, purchaser name, order number, and redemption count. Open
`guests.html`, enter your Worker URL and the `ADMIN_KEY` you set above, and
click **טען** to see the full list, or **ייצוא ל-CSV** to download it for
Excel/Sheets.

## Notes / limits

- The proxy only allows fetching `matnas-kz.co.il` URLs (an allow-list in
  `worker.js`), so the endpoint can't be abused to fetch arbitrary sites.
- The message shown is whatever Hebrew text the ticket system itself
  returns (colored green/red in its own HTML) — the scanner just displays it
  faster, it doesn't change the wording.
- If the ticket site ever changes its page structure, `worker.js` falls back
  to showing the raw visible text rather than failing silently — but the
  color-coded success/duplicate detection (`parseTicketHtml` in `worker.js`)
  may need a small tweak to match the new markup.
- Each logged row also keeps the raw `sid` / `idqr` / `did` query-string
  values from the scanned QR (see `schema.sql`) alongside the human-facing
  order number, in case you ever need to trace a specific scan back to the
  exact QR code that produced it.
- A failed database write never blocks a scan from showing its result —
  staff always see the outcome even if logging hiccups; `logged: false` in
  the JSON response signals that a particular scan wasn't recorded.
