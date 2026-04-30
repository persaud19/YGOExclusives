# Session Log: 2026-04-21 — Collection Columns, New Reports, Pricing Source Fix

**Focus**: Collection tab column reorder, two new Reports, TCGCSV investigation, bulk-price.html pricing source
**Status**: Collection + Reports complete ✅ | bulk-price.html pricing BROKEN — needs fix next session ⚠️
**Key files**: `index.html`, `js/collection.js`, `js/reports.js`, `bulk-price.html`

---

## What Was Built

### 1. Collection Tab — Column Reorder + 2 New Columns ✅

New column order (17 total, was 13):
```
Card# → Name → Rarity → Set → TCG Market → TCG Low → eBay Low →
HR TCG → HR TCG Low → HR eBay → Cost In → Location → Reg Qty → HR Qty → Listed → Actions
```

Two new DB columns required (run these in Supabase SQL Editor if not yet done):
```sql
ALTER TABLE cards ADD COLUMN tcg_low_price numeric;
ALTER TABLE cards ADD COLUMN hr_tcg_low_price numeric;
```

- `index.html` thead reordered with 2 new sortable `<th>` entries
- `js/collection.js` row render reordered to match; all `colspan="13"` → `colspan="17"`
- New cells: TCG Low (gold), HR TCG Low (purple), pulled from `card.tcg_low_price` / `card.hr_tcg_low_price`

---

### 2. Reports Tab — Two New High-Value Reports ✅

Added before Monthly P&L in `index.html` and implemented in `js/reports.js`.

#### Report 1: Top 50 Highest Value — Unlisted
- Fetch: `?listed=eq.false&tcg_market_price=gt.0&order=tcg_market_price.desc&limit=500`
- Client filter: totalQty (reg + HR) > 0
- Shows first 50 after filter
- Columns: # | Card | Rarity | Set | TCG Market | TCG Low | Qty | Cost In
- HR qty shown as purple `+N★` suffix

#### Report 2: Top 50 Highest Quantity — Unlisted & TCG Low >$5
- Fetch: paginated up to 2000 rows at `?listed=eq.false&tcg_low_price=gt.5`
- Client sort: totalQty DESC → tcg_low_price DESC
- Shows first 50 after sort
- Columns: # | Card | Rarity | Set | Qty | TCG Low | TCG Market | **Total Value** | Cost In
- Total Value = totalQty × tcg_low_price, shown in green

Both reports run in parallel with existing Monthly P&L fetch on tab load.

---

### 3. TCGCSV Investigation — Integration Abandoned ⚠️

**Attempted**: Replace YGOPRODeck pricing with TCGCSV bulk endpoint for `tcg_market_price` (marketPrice) + `tcg_low_price` (lowPrice).

**Discovery**: TCGCSV has NO category-level bulk file. The URL `tcgcsv.com/tcgplayer/2/prices` returns an S3 "NoSuchKey" XML error. The API is strictly per-group only:
- `/tcgplayer/2/{groupId}/products` — 648 groups
- `/tcgplayer/2/{groupId}/prices` — 648 groups
- 1,296 total HTTP calls to get all YGO pricing — impractical for browser

**Current state**: `bulk-price.html` Step 1 still has the broken TCGCSV URLs — **it will fail if run**.

---

## Pending — CRITICAL Next Session

### Fix bulk-price.html — Revert to YGOPRODeck, Write Two Price Fields

The broken TCGCSV Step 1 needs replacing with a working YGOPRODeck approach that writes **two distinct price columns**:

| Column | Source | Notes |
|---|---|---|
| `tcg_market_price` | `card_prices[0].tcgplayer_price` | Global name-level market average across all printings |
| `tcg_low_price` | `card_sets[n].set_price` where `set_code == card_number` | Per-printing low — lower for reprints, higher for rare first prints |

**Map structure to build:**
```javascript
// ygoMap: cardName_lower → { id: api_id, marketPrice: tcgplayer_price }
// setCodeMap: "CARD-NUMBER|rarity_lower" → { id, marketPrice, setPrice: set_price }
// nameMap fallback
```

**Step 3 writes:**
```javascript
patch.tcg_market_price = match.marketPrice;  // from tcgplayer_price
patch.tcg_low_price    = match.setPrice;     // from set_price (per printing)
```

**HR section** (no change to logic, just ensure `hr_tcg_low_price` is written if available):
```javascript
if (hrMatch.marketPrice > 0) patch.hr_tcg_price = hrMatch.marketPrice;
if (hrMatch.setPrice    > 0) patch.hr_tcg_low_price = hrMatch.setPrice;
```

Also: **remove the `ebay_low_price` write from YGOPRODeck data** (YGOPRODeck's eBay price field is unreliable — leave `ebay_low_price` to the Netlify `ebay-prices` function only).

---

## Other Pending Work (from CLAUDE.md)

- **SQL**: Confirm `tcg_low_price` + `hr_tcg_low_price` columns were added to Supabase
- **eBay production keys**: Apply at developer.ebay.com to lift 5-10 calls/day quota → 5,000+/day
- **GitHub Actions weekly cron**: `.github/workflows/price-update.yml` for automated Monday price runs (not built)
- **Cards Listed workflow**: Moving photo folders to Cards Listed after eBay push (not built)
- **process-photos.ps1 batch test**: Script complete, needs real run with 10-20 photos
- **Collection bulk import bug**: 100-card import fails — not yet diagnosed
- **listing_queue table**: Run SQL in Supabase before using process-photos.ps1

---

## Quick Reference

### DB Column State
```sql
-- Required if not yet run:
ALTER TABLE cards ADD COLUMN tcg_low_price numeric;
ALTER TABLE cards ADD COLUMN hr_tcg_low_price numeric;
```

### Collection tab column count
17 columns — all `colspan` must be `17`

### Reports functions in reports.js
- `getHighValueUnlisted()` → `renderHighValueUnlisted()`
- `getHighQtyUnlisted()` → `renderHighQtyUnlisted()`
- Both called in `loadReports()` parallel fetch block

### YGOPRODeck pricing fields
- `card_prices[0].tcgplayer_price` → global market price → `tcg_market_price`
- `card_sets[n].set_price` where set_code matches → per-printing → `tcg_low_price`
- These are meaningfully different values — reprints will show lower `set_price` vs `tcgplayer_price`
