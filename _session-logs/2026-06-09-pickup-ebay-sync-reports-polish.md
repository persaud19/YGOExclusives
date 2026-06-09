# Session Log — 2026-06-09
## Feature: Pickup from other device + eBay Listed Sync + Reports Polish

---

## What Was Done

### 1. Picked up changes from another device
- Read `_pickup.ps1` and the patch file `0001-feat-eBay-listed-sync-updated-inventory-segments-set.patch`
- Confirmed the patch commit (`2d08a91`) was already applied as the top commit on `dev`
- Committed the 5 modified files that were sitting unstaged and pushed `dev` to GitHub

### 2. Deployed to production
- Merged `dev` → `master`, pushed to GitHub
- Netlify auto-deployed all 10 changed files

### 3. Fixed: Junk sets still showing in Sets Not in Inventory
- The patch had added a junk filter to the **sync modal** (`collection.js`) but NOT to `renderSetsInInventory` in `reports.js`
- Added the same filter to `reports.js`:
  - Bare numbers (`/^\d+$/`)
  - `XXXX Mega Pack` style (`/^\d+ Mega Pack$/`)
  - `Battles of Legend: Chapter N` (`/^Battles of Legend: Chapter \d+$/`)
  - Three one-off names: `Advanced Demo Deck Extra Pack`, `Anniversary Pack`, `Battle Pack Tournament Prize Cards`

### 4. Moved Sets Not in Inventory to bottom of Reports tab
- Was positioned above High Value Unlisted (near top)
- Moved to after the Monthly P&L + Price Movers row (last section)

### 5. All report tables capped to 10-row scroll with sticky headers
- Applied `max-height:calc(10 * 41px);overflow-y:auto` inner scroll wrapper to all table reports
- Sticky `<thead>` using `position:sticky;top:0;z-index:1;background:var(--surf)`
- Reports updated: High Value Unlisted, High Qty Unlisted, Monthly P&L, Price Movers (Gainers + Losers), Sets Not in Inventory

---

## Commits This Session

| Hash | Message |
|---|---|
| `2d08a91` | feat: eBay listed sync, updated inventory segments, sets-not-in-inventory report *(from other device)* |
| `4de2d6f` | chore: schema migration cleanup, rarity-sets fixes, weekly price workflow |
| `0c976b0` | fix: filter junk sets from Sets Not in Inventory report |
| `943ac2f` | fix: move Sets Not in Inventory to bottom of reports, cap scroll to 10 rows |
| `e34f022` | fix: cap all report tables to 10-row scroll with sticky headers |

---

## What the Patch from Other Device Included (`2d08a91` + `4de2d6f`)

### `netlify/functions/ebay-active-sync.js` (NEW)
- Fetches all active eBay listings via `GetMyeBaySelling` Trading API (paginated, 200/page)
- Matches by `ebay_listing_id` first, falls back to card number extracted from title
- Cards currently `listed=true` with no matching active listing → set to `listed=false`
- Safety: won't mass-unlist if eBay returns 0 results (empty response guard)
- Auth: `SYNC_API_KEY` via `X-Api-Key` header
- Supports `?dry_run=1` and `?debug_env=1` query params
- Batches DB updates in 250-row chunks

### `js/listing-queue.js` — `lqSyncListedStatus()`
- New "⟳ Sync Listed" button in Listing Queue tab toolbar
- Calls `/.netlify/functions/ebay-active-sync`
- Shows result count on button: `✓ 23 listed / 410 unlisted`
- 4-second auto-reset back to default label

### `js/reports.js` — Inventory Segments
- Thresholds updated to CAD (was USD):
  - High-End: C$40+ (was $50 USD)
  - Bread & Butter: C$2.50–39.99 (was $5–49 USD)
  - Bulk: <C$2.50 (was <$5 USD)
- Now uses `tcg_price_cad` column instead of converting USD at render time

### `js/reports.js` — Sets Not in Inventory
- Renamed from "Sets in Inventory" (which showed counted + not-counted split)
- Now shows **only** zero-count sets, alphabetical
- Old two-column counted/not-counted layout removed

### `js/collection.js` — Sync Sets Modal Filter
- Filters junk sets from YGOPRODeck API before showing in the sync modal

### `js/rarity-sets.js` — Schema migration + fixes
- All queries switched from `cards` → `card_inventory` table
- Field mapping: `un_nm`/`hr_qty_nm` → `qty_fe_nm` (unified field)
- Added Ultimate Rare, Collector's Rare, Starlight Rare to `RS_RARITY_ORDER` and `RS_CSV_MAP`
- Fixed alternate-art grouping: key is now `card_number||card_name` so e.g. Dark Magician Girl different arts each get their own row
- Row total updates now use `tr.querySelector('.rs-td-total')` instead of `getElementById` with card number (works with new keying)
- All PATCH calls updated to `card_inventory` table

### `scripts/price-update.js` — Schema migration + low price
- Targets `card_inventory` table (was `cards`)
- Now fetches and writes `tcg_low_price` and `tcg_price_cad` (was only `tcg_market_price`)
- Fetches live CAD rate from open.er-api.com (fallback: frankfurter.app, then 1.38)
- Runs in parallel with `fetchYGOCards()` and `fetchCadRate()`

### `.github/workflows/price-update.yml`
- Schedule changed from bi-monthly (1st + 15th) to **every Monday 13:00 UTC (8am EST)**
- Added `weekly-analysis` job that runs `scripts/weekly-analysis.js` after price update completes
- Timeout increased from 30m → 45m for price-update job

### `.gitignore`
- Added `.env`, `.env.local`, `.netlify` (local Netlify dev files)

---

## Report Tab Layout (as of end of session)

Order from top to bottom:
1. Weekly AI Report
2. Summary Stats
3. Inventory Overview (2/3) + Set Value (1/3) — grid row
4. High Value Unlisted (Top 50)
5. High Qty Unlisted (Top 50, TCG Low >$5)
6. Monthly P&L + Price Movers — grid row
7. **Sets Not in Inventory** ← moved here

All table sections: 10-row scroll cap, sticky header.

---

## Pending / Known Issues (carried forward)
- Add Card tab: save fails with `null value in column "id"` — needs UUID generation
- Collection bulk import: "100 failed" bug — undiagnosed
- `_pickup.ps1` and patch file still sitting in project root — can be deleted now that changes are merged
