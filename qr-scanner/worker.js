/**
 * Cloudflare Worker proxy + guest log for the QR ticket scanner.
 *
 * The ticket site (matnas-kz.co.il) does not allow the browser to read its
 * response directly (no CORS headers), so a phone page can't just fetch()
 * the ticket URL and inspect the result. This worker does that fetch on the
 * server side instead (server-to-server requests aren't subject to CORS),
 * pulls the Hebrew status message out of the returned HTML, logs the scan
 * to a D1 database, and hands the scanner page back a small JSON object it
 * can render instantly.
 *
 * Routes:
 *   GET  /?url=<ticket url>   -> check + log a scan (used by index.html)
 *   GET  /guests?key=<key>    -> JSON list of logged scans (used by guests.html)
 *   GET  /guests.csv?key=<key> -> same list as a CSV download
 *
 * Setup: see README.md for creating the D1 database, binding it as `DB`,
 * and setting the `ADMIN_KEY` secret.
 */

// Only these hosts may be fetched. Prevents the endpoint being abused as an
// open proxy for arbitrary URLs (SSRF) via a crafted QR code.
const ALLOWED_HOSTS = new Set(["www.matnas-kz.co.il", "matnas-kz.co.il"]);

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === "/guests" || url.pathname === "/guests.csv") {
      return handleGuestsList(url, env, corsHeaders, url.pathname.endsWith(".csv"));
    }

    return handleScan(url, env, corsHeaders);
  },
};

async function handleScan(url, env, corsHeaders) {
  const target = url.searchParams.get("url");
  if (!target) {
    return json({ ok: false, status: "error", message: "Missing url parameter" }, corsHeaders);
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return json({ ok: false, status: "error", message: "Invalid url" }, corsHeaders);
  }

  if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
    return json({ ok: false, status: "error", message: "Host not allowed" }, corsHeaders);
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
    });
  } catch {
    return json({ ok: false, status: "error", message: "לא ניתן להתחבר לשרת הכרטיסים" }, corsHeaders);
  }

  const buffer = await upstream.arrayBuffer();
  const html = decodeTicketHtml(buffer);
  const parsed = parseTicketHtml(html);

  const logResult = await logScan(env, targetUrl, parsed);

  return json({ ok: true, httpStatus: upstream.status, ...parsed, logged: logResult.logged }, corsHeaders);
}

async function logScan(env, targetUrl, parsed) {
  if (!env.DB) return { logged: false };
  try {
    await env.DB.prepare(
      `INSERT INTO scans (scanned_at, purchaser, order_id, used_count, total_count, status, message, sid, idqr, did)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        new Date().toISOString(),
        parsed.name,
        parsed.order,
        parsed.usedCount,
        parsed.totalCount,
        parsed.status,
        parsed.message,
        targetUrl.searchParams.get("sid"),
        targetUrl.searchParams.get("idqr"),
        targetUrl.searchParams.get("did")
      )
      .run();
    return { logged: true };
  } catch (e) {
    // A logging failure shouldn't block staff from seeing the scan result.
    return { logged: false, logError: String(e) };
  }
}

async function handleGuestsList(url, env, corsHeaders, asCsv) {
  const key = url.searchParams.get("key");
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }
  if (!env.DB) {
    return json({ ok: false, message: "No DB bound to this worker" }, corsHeaders);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, scanned_at, purchaser, order_id, used_count, total_count, status, sid, idqr, did
     FROM scans ORDER BY scanned_at DESC LIMIT 5000`
  ).all();

  if (asCsv) {
    const header = "id,scanned_at,purchaser,order_id,used_count,total_count,status,sid,idqr,did";
    const rows = results.map((r) =>
      [r.id, r.scanned_at, csvEscape(r.purchaser), r.order_id, r.used_count, r.total_count, r.status, r.sid, r.idqr, r.did].join(",")
    );
    const csv = [header, ...rows].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=guests.csv",
        ...corsHeaders,
      },
    });
  }

  return json({ ok: true, results }, corsHeaders);
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function decodeTicketHtml(buffer) {
  // The ticket site declares windows-1255 (Hebrew) as its charset. Decoding
  // as UTF-8 would turn every Hebrew character into mojibake.
  try {
    return new TextDecoder("windows-1255").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function decodeEntities(str) {
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<div[\s\S]*?<\/div>/gi, "") // drop the hidden autoplay-audio div
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Splits a status cell's text into the human-readable phrase (e.g. "הכרטיס
 * כבר מומש בעבר") and the "X מתוך: Y" redemption count the ticket system
 * appends to it, so the scanner page can label each part explicitly instead
 * of showing one run-on block of text.
 */
function parseStatusCell(rawInner) {
  const fullText = stripTags(rawInner);
  const countMatch = fullText.match(/(\d+)\s*מתוך:?\s*(\d+)/);
  let phrase = fullText;
  let usedCount = null;
  let totalCount = null;
  if (countMatch) {
    usedCount = parseInt(countMatch[1], 10);
    totalCount = parseInt(countMatch[2], 10);
    phrase = fullText.replace(countMatch[0], "").trim();
  }
  return { phrase, usedCount, totalCount, fullText };
}

function parseTicketHtml(html) {
  const orderMatch = html.match(/סידורי<\/td>\s*<td[^>]*>([^<]*)</);
  const nameMatch = html.match(/שם המזמין<\/td>\s*<td[^>]*>([^<]*)</);
  const statusMatch = html.match(
    /colspan="2"[^>]*color:\s*(red|green|orange|blue|#[0-9a-fA-F]{3,6})[^>]*>([\s\S]*?)<\/td>/i
  );

  const order = orderMatch ? decodeEntities(orderMatch[1]).trim() : null;
  const name = nameMatch ? decodeEntities(nameMatch[1]).trim() : null;

  if (statusMatch) {
    const rawColor = statusMatch[1].toLowerCase();
    const { phrase, usedCount, totalCount, fullText } = parseStatusCell(statusMatch[2]);
    let status = "unknown";
    if (rawColor === "green") status = "success";
    else if (rawColor === "red") status = "used";
    return { status, color: rawColor, message: phrase || fullText, usedCount, totalCount, order, name };
  }

  // Structure didn't match what we expected (site changed, error page, etc).
  // Fall back to showing whatever visible text came back so staff aren't
  // left with a blank screen.
  const fallbackText = stripTags(html).slice(0, 300);
  return { status: "unknown", color: "gray", message: fallbackText || null, usedCount: null, totalCount: null, order, name };
}

function json(obj, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}
