// Vercel serverless function: GET /api/scan?url=<ticket url>
//
// The ticket site (matnas-kz.co.il) does not allow the browser to read its
// response directly (no CORS headers), so the scanner page can't just
// fetch() the ticket URL and inspect the result itself. This function does
// that fetch on the server side instead (server-to-server requests aren't
// subject to CORS), pulls the Hebrew status message out of the returned
// HTML, logs the scan to Neon, and hands the scanner page back clean JSON.

import { neon } from "@neondatabase/serverless";
import { decodeTicketHtml, parseTicketHtml } from "../lib/ticketParser.js";
import { legacyFetch } from "../lib/legacyFetch.js";

// Only these hosts may be fetched. Prevents this endpoint being abused as an
// open proxy for arbitrary URLs (SSRF) via a crafted QR code.
const ALLOWED_HOSTS = new Set(["www.matnas-kz.co.il", "matnas-kz.co.il"]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const target = req.query.url;
  if (!target) {
    res.status(200).json({ ok: false, status: "error", message: "Missing url parameter" });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(String(target));
  } catch {
    res.status(200).json({ ok: false, status: "error", message: "Invalid url" });
    return;
  }

  if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
    res.status(200).json({ ok: false, status: "error", message: "Host not allowed" });
    return;
  }

  let upstream;
  try {
    upstream = await legacyFetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
    });
  } catch (e) {
    // Log the real cause server-side (visible in Vercel's function logs) -
    // the client only gets a generic Hebrew message so staff aren't shown
    // raw error internals mid-event.
    console.error("Failed to reach ticket site:", e);
    res.status(200).json({
      ok: false,
      status: "error",
      message: "לא ניתן להתחבר לשרת הכרטיסים",
      errorDetail: String(e && e.cause ? e.cause : e),
    });
    return;
  }

  const html = decodeTicketHtml(upstream.body);
  const parsed = parseTicketHtml(html);

  const logged = await logScan(targetUrl, parsed);

  res.status(200).json({ ok: true, httpStatus: upstream.statusCode, ...parsed, logged });
}

async function logScan(targetUrl, parsed) {
  if (!process.env.DATABASE_URL) return false;
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO scans (order_id, used_count, total_count, status, message, sid, idqr, did)
      VALUES (${parsed.order}, ${parsed.usedCount}, ${parsed.totalCount}, ${parsed.status}, ${parsed.message},
              ${targetUrl.searchParams.get("sid")}, ${targetUrl.searchParams.get("idqr")}, ${targetUrl.searchParams.get("did")})
    `;
    return true;
  } catch {
    // A logging failure shouldn't block staff from seeing the scan result.
    return false;
  }
}
