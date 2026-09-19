-- Run this once against your Neon database (Neon console -> your project ->
-- SQL Editor -> paste and run), before setting DATABASE_URL in Vercel.
-- See README.md in qr-scanner/ for the full setup steps.

CREATE TABLE IF NOT EXISTS scans (
  id SERIAL PRIMARY KEY,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  purchaser TEXT,             -- name on the order (שם המזמין)
  order_id TEXT,              -- order number shown on the ticket (סידורי)
  used_count INTEGER,         -- tickets redeemed so far in this order, per the ticket system
  total_count INTEGER,        -- total tickets in this order
  status TEXT,                -- success | used | unknown | error
  message TEXT,               -- the Hebrew status phrase returned by the ticket system
  sid TEXT,                   -- raw "sid" query param from the scanned QR URL
  idqr TEXT,                  -- raw "idqr" query param from the scanned QR URL
  did TEXT                    -- raw "did" query param from the scanned QR URL
);

CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON scans (scanned_at DESC);
