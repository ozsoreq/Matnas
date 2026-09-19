// Shared HTML-parsing helpers for the ticket-check API route. Kept outside
// /api so Vercel doesn't also turn this into its own serverless function.

export function decodeTicketHtml(buffer) {
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

export function parseTicketHtml(html) {
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
