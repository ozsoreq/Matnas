// Vercel serverless function: GET /api/guests?key=<ADMIN_KEY>[&format=csv]
//
// Returns the logged scan history from Neon, protected by a shared secret
// so guest names/orders aren't publicly viewable. Used by guests.html.

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const key = req.query.key;
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    res.status(401).send("Unauthorized");
    return;
  }
  if (!process.env.DATABASE_URL) {
    res.status(200).json({ ok: false, message: "No DATABASE_URL configured" });
    return;
  }

  const sql = neon(process.env.DATABASE_URL);
  const results = await sql`
    SELECT id, scanned_at, purchaser, order_id, used_count, total_count, status, sid, idqr, did
    FROM scans ORDER BY scanned_at DESC LIMIT 5000
  `;

  if (req.query.format === "csv") {
    const header = "id,scanned_at,purchaser,order_id,used_count,total_count,status,sid,idqr,did";
    const rows = results.map((r) =>
      [r.id, r.scanned_at, csvEscape(r.purchaser), r.order_id, r.used_count, r.total_count, r.status, r.sid, r.idqr, r.did].join(",")
    );
    const csv = [header, ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=guests.csv");
    res.status(200).send(csv);
    return;
  }

  res.status(200).json({ ok: true, results });
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
