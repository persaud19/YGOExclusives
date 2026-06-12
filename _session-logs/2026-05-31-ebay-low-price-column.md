# Session: eBay Lowest Listed Price Feature
**Date:** 2026-05-31
**Status:** Complete — pending rate limit reset (midnight PT)

---

## What Was Built

### Feature: eBay Lowest Listed Price in Listing Queue + Collection Tab

Pulled live eBay "lowest listed price" (price + shipping combined, USD→CAD) into the app via the eBay Finding API. The price flows from the Listing Queue into the Collection tab automatically — no manual entry, no bulk price updater involvement.

---

## Architecture

### Flow
```
Listing Queue tab
  → click "↺ eBay Prices"
  → /.netlify/functions/ebay-queue-prices (new)
      → fetches all pending listing_queue items (card_number + rarity)
      → calls eBay Finding API per card (sortOrder=PricePlusShippingLowest)
      → converts USD → CAD via Frankfurter API (fallback: 1.38)
      → PATCHes listing_queue.ebay_low_cad per row
      → PATCHes card_inventory.ebay_low_cad WHERE card_number+rarity match
  → queue reloads showing green C$XX.XX in eBay Low column
  → Collection tab already shows the same data from card_inventory
```

### Why not live per-row fetch?
First attempt used live eBay API calls per page load (one per row). Immediately hit the eBay Finding API daily quota (5,000 calls/day). Switched to DB-backed approach: prices are stored in the DB, refreshed on-demand via button. ~100 pending cards = ~100 calls/day, well within limit.

### Why Finding API and not Browse API?
Browse API requires eBay Partner Network (EPN) approval — not available on standard developer accounts. Finding API (`findItemsAdvanced`) works with just the App ID (Client Credentials scope) and returns active listings with price + shipping.

---

## Files Changed

| File | Change |
|------|--------|
| `netlify/functions/ebay-queue-prices.js` | NEW — fetches eBay prices for all pending queue items, writes to DB |
| `js/listing-queue.js` | Removed live-per-row fetch, added `lqRefreshEbayPrices()`, button reads from DB |
| `js/db.js` | Added `ebay_low_cad` to `getInventoryPage` normalization map |
| `js/collection.js` | Added eBay Low (CAD) cell in `renderCollectionRows` |
| `js/app.js` | Fixed `showToast` to accept `'error'` as type string (4s duration, red bg) |
| `index.html` | Added eBay Low column headers in both Listing Queue and Collection tables, added `↺ eBay Prices` button, fixed colspans |

---

## SQL Required (run once in Supabase SQL Editor)

```sql
ALTER TABLE listing_queue ADD COLUMN IF NOT EXISTS ebay_low_cad numeric;
ALTER TABLE card_inventory ADD COLUMN IF NOT EXISTS ebay_low_cad numeric;
```

---

## Env Vars Required (already set in Netlify)
- `EBAY_CLIENT_ID` — eBay App ID
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_KEY` — for writing back to DB
- `SYNC_API_KEY` — auth for the Netlify function (set via `ygoexclusives_sync_key` in browser localStorage)

---

## Known Limitation
- eBay Finding API rate limit: 5,000 calls/day, resets midnight PT
- First test hit the limit from earlier per-row testing — working correctly after reset
- With ≤100 pending cards the daily refresh will never hit the limit under normal use

---

## Pending
- Run the two `ALTER TABLE` SQL statements in Supabase if not done yet
- Test after rate limit resets (midnight PT)
