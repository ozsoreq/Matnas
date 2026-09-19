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

## Setup (one-time, ~5 minutes)

1. **Deploy the proxy** (free, no credit card):
   - Go to <https://workers.cloudflare.com>, sign up / log in.
   - Create a new Worker, paste in the contents of `worker.js`, deploy.
   - Copy the resulting URL, e.g. `https://qr-ticket-proxy.<you>.workers.dev`.

2. **Point the scanner at it**:
   - Open `index.html`, find the line:
     ```js
     const PROXY_URL = "";
     ```
   - Paste your Worker URL in between the quotes.

3. **Host `index.html`** somewhere with HTTPS (camera access requires a
   secure context) — GitHub Pages, Netlify, Vercel, or any static host works.
   Open that URL on the phone that will do the scanning, tap **התחל סריקה**,
   and allow camera access.

## Using it at the door

- Point the camera at the ticket's QR code.
- The screen flashes **green** ("✓" + the ticket system's own message) for a
  valid, first-time scan, or **red** ("✕" + message) if it was already used —
  then automatically returns to the camera view after ~1.4 seconds.
- No tapping, no back button — just move to the next ticket.
- A running total (scanned / approved / duplicate) shows at the top for
  staff's own tracking.

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
