# Fast QR ticket scanner

Replaces the normal flow (scan → browser navigates to the ticket site →
Hebrew popup → tap OK → tap back → scan again, ~10s/person) with a page that
stays open, shows the same result inline, and is ready for the next scan
within about a second.

Everything runs as one Vercel deployment: `index.html` / `guests.html` are
the static pages, `/api/scan.js` and `/api/guests.js` (at the repo root) are
serverless functions, and Neon (Postgres) holds the guest log.

## Why a server-side function is needed at all

The ticket site (`matnas-kz.co.il`) doesn't send CORS headers, so a browser
page is not allowed to read its response directly — that's a security
restriction of every browser, not something fixable from the page alone.
`/api/scan.js` does that fetch server-side instead (server-to-server calls
aren't restricted by CORS), pulls out the Hebrew status text, and returns
clean JSON to the scanner page — which is also why no `PROXY_URL` needs
configuring anymore: the page just calls `/api/scan` on its own origin.

## Setup (one-time, ~10 minutes)

1. **Create a Neon database** (free, no credit card):
   - Go to <https://neon.tech>, sign up / log in, create a project.
   - Open its **SQL Editor** and paste in the contents of `../schema.sql`
     (repo root), then run it.
   - Copy the connection string from the Neon dashboard (**Connection Details**
     → looks like `postgresql://user:password@ep-...neon.tech/dbname?sslmode=require`).

2. **Deploy this repo to Vercel** (if not already):
   - Import the GitHub repo into Vercel. No special Root Directory setting
     is needed — `package.json`, `/api`, and `vercel.json` all live at the
     repo root, and `vercel.json`'s rewrites route `/` and `/guests` into
     `qr-scanner/`.

3. **Set environment variables** in the Vercel project (**Settings → Environment
   Variables**):
   - `DATABASE_URL` = the Neon connection string from step 1.
   - `ADMIN_KEY` = any password you choose — this guards the guest list
     (`/api/guests`) from being publicly viewable.
   - Redeploy after adding them (env vars only apply to new deployments).

4. **Open the scanner** on the phone that will do the scanning: your Vercel
   URL (e.g. `https://matnas.vercel.app`), tap **התחל סריקה**, and allow
   camera access. Camera access requires HTTPS, which Vercel provides by
   default.

## Using it at the door

- Point the camera at the ticket's QR code.
- The screen flashes **green** ("✓") for a valid, first-time scan, or **red**
  ("✕") if it was already used, showing the ticket system's own status
  phrase plus explicit lines for **שם הרוכש** (purchaser name), **מס׳ הזמנה**
  (order number), and **כרטיסים שמומשו** (tickets redeemed, X out of Y) —
  then automatically returns to the camera view after ~1.4 seconds.
- No tapping, no back button — just move to the next ticket.
- A running session total (scanned / approved / duplicate / errors) shows at
  the top for staff's own tracking; this resets if the page reloads — for
  the permanent record, use the guest list below.

## Viewing the guest log

Every scan (success or duplicate) is written to Neon with the date/time,
order number, and redemption count - purchaser names are shown live on the
scanner popup but intentionally not persisted, to keep this log free of
personal data beyond ticket/order identifiers. Open `/guests.html` on your
Vercel deployment, enter the `ADMIN_KEY` you set above, and click **טען** to
see the full list, or **ייצוא ל-CSV** to download it for Excel/Sheets.

## Notes / limits

- `/api/scan.js` only allows fetching `matnas-kz.co.il` URLs (an allow-list
  in that file), so the endpoint can't be abused to fetch arbitrary sites.
- The message shown is whatever Hebrew text the ticket system itself
  returns (colored green/red in its own HTML) — the scanner just displays it
  faster, it doesn't change the wording.
- If the ticket site ever changes its page structure, `lib/ticketParser.js`
  falls back to showing the raw visible text rather than failing silently —
  but the color-coded success/duplicate detection may need a small tweak to
  match the new markup.
- Each logged row also keeps the raw `sid` / `idqr` / `did` query-string
  values from the scanned QR (see `../schema.sql`) alongside the human-facing
  order number, in case you ever need to trace a specific scan back to the
  exact QR code that produced it.
- A failed database write never blocks a scan from showing its result —
  staff always see the outcome even if logging hiccups; `logged: false` in
  the JSON response signals that a particular scan wasn't recorded.
