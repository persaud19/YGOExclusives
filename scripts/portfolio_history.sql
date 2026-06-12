-- One-time setup for the Portfolio Value Over Time report.
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query → Run).
-- After it exists, scripts/price-update.js writes one row automatically every Monday
-- (via the existing .github/workflows/price-update.yml cron). No further manual action.

CREATE TABLE IF NOT EXISTS portfolio_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date     date UNIQUE NOT NULL,
  total_value_cad   numeric,   -- sum(tcg_low_price_cad * qty_total)
  high_end_cad      numeric,   -- C$40+ segment
  bread_butter_cad  numeric,   -- C$2.50–39.99 segment
  bulk_cad          numeric,   -- <C$2.50 segment
  total_qty         int,
  unique_printings  int,
  created_at        timestamptz DEFAULT now()
);
