import http from "node:http";
import https from "node:https";

/**
 * Node's built-in fetch() (undici) rejects HTTP responses that aren't
 * strictly RFC 7230 compliant - e.g. a header line missing its \r before
 * \n - which every browser tolerates fine but undici's parser does not.
 * The ticket site (matnas-kz.co.il) turns out to be exactly that case
 * ("HTTPParserError: Missing expected CR after header value"), so this
 * falls back to Node's legacy http/https modules with insecureHTTPParser,
 * which use a lenient parser built for talking to non-conforming servers.
 * Redirects are followed manually since core http/https don't do that.
 */
export function legacyFetch(targetUrl, { headers = {}, maxRedirects = 5, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    function request(currentUrl, redirectsLeft) {
      const lib = currentUrl.protocol === "https:" ? https : http;
      const req = lib.request(
        currentUrl,
        { method: "GET", headers, insecureHTTPParser: true },
        (res) => {
          const { statusCode, headers: resHeaders } = res;
          if (statusCode >= 300 && statusCode < 400 && resHeaders.location && redirectsLeft > 0) {
            res.resume(); // discard this response's body, follow the redirect instead
            request(new URL(resHeaders.location, currentUrl), redirectsLeft - 1);
            return;
          }
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => resolve({ statusCode, headers: resHeaders, body: Buffer.concat(chunks) }));
          res.on("error", reject);
        }
      );
      req.on("error", reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error("Request to ticket site timed out")));
      req.end();
    }
    request(targetUrl, maxRedirects);
  });
}
