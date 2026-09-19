/**
 * Cloudflare Worker proxy for the QR ticket scanner.
 *
 * The ticket site (matnas-kz.co.il) does not allow the browser to read its
 * response directly (no CORS headers), so a phone page can't just fetch()
 * the ticket URL and inspect the result. This worker does that fetch on the
 * server side instead (server-to-server requests aren't subject to CORS),
 * pulls the Hebrew status message out of the returned HTML, and hands the
 * scanner page back a small JSON object it can render instantly.
 *
 * Deploy: paste this file into a new Worker at https://workers.cloudflare.com
 * (free tier), then copy the resulting *.workers.dev URL into PROXY_URL near
 * the top of index.html.
 */

// Only these hosts may be fetched. Prevents the endpoint being abused as an
// open proxy for arbitrary URLs (SSRF) via a crafted QR code.
const ALLOWED_HOSTS = new Set(["www.matnas-kz.co.il", "matnas-kz.co.il"]);

export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const target = new URL(request.url).searchParams.get("url");
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

    return json({ ok: true, httpStatus: upstream.status, ...parsed }, corsHeaders);
  },
};

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
    const message = stripTags(statusMatch[2]);
    let status = "unknown";
    if (rawColor === "green") status = "success";
    else if (rawColor === "red") status = "used";
    return { status, color: rawColor, message, order, name };
  }

  // Structure didn't match what we expected (site changed, error page, etc).
  // Fall back to showing whatever visible text came back so staff aren't
  // left with a blank screen.
  const fallbackText = stripTags(html).slice(0, 300);
  return { status: "unknown", color: "gray", message: fallbackText || null, order, name };
}

function json(obj, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}
