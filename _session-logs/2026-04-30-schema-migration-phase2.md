# Session Log — 2026-04-30
## Schema Migration Phase 2 + Branding Rebrand

---

## What Was Built

### 1. Database — Dev Schema Finalized

All outstanding columns added to `card_inventory` in dev Supabase (`https://xyhzwmlqmazloyerelas.supabase.co`):

**Ran in dev SQL Editor:**
```sql
-- Drop and recreate rarity_order with 2 new rarities
ALTER TABLE card_inventory DROP COLUMN rarity_order;
ALTER TABLE card_inventory ADD COLUMN rarity_order smallint GENERATED ALWAYS AS (
  CASE rarity
    WHEN 'Common'                             THEN 0
    WHEN 'Short Print'                        THEN 1
    WHEN 'Rare'                               THEN 2
    WHEN 'Super Rare'                         THEN 3
    WHEN 'Ultra Rare'                         THEN 4
    WHEN 'Secret Rare'                        THEN 5
    WHEN 'Ultimate Rare'                      THEN 6
    WHEN 'Gold Rare'                          THEN 7
    WHEN 'Ghost/Gold Rare'                    THEN 8
    WHEN 'Ghost Rare'                         THEN 9
    WHEN 'Mosaic Rare'                        THEN 10
    WHEN 'Starfoil Rare'                      THEN 11
    WHEN 'Shatterfoil Rare'                   THEN 12
    WHEN 'Alternate Rare'                     THEN 13
    WHEN 'Gold Secret Rare'                   THEN 14
    WHEN 'Premium Gold Rare'                  THEN 15
    WHEN 'Platinum Rare'                      THEN 16
    WHEN 'Prismatic Secret Rare'              THEN 17
    WHEN 'Platinum Secret Rare'               THEN 18
    WHEN '10000 Secret Rare'                  THEN 19
    WHEN 'Duel Terminal Normal Parallel Rare' THEN 20
    WHEN 'Duel Terminal Ultra Parallel Rare'  THEN 21
    WHEN 'Pharaoh''s Rare'                    THEN 22
    WHEN 'Collector''s Rare'                  THEN 23
    WHEN 'Quarter Century Secret Rare'        THEN 24
    WHEN 'Prismatic Collector''s Rare'        THEN 25
    WHEN 'Prismatic Ultimate Rare'            THEN 26
    WHEN 'Starlight Rare'                     THEN 27
    WHEN 'Ultra Rare Over Frame'              THEN 28
    WHEN 'Starlight Over Frame'               THEN 29
    ELSE 99
  END
) STORED;

-- Binder qty columns + new qty_total
ALTER TABLE card_inventory DROP COLUMN qty_total;
ALTER TABLE card_inventory ADD COLUMN qty_binder_fe_nm int DEFAULT 0;
ALTER TABLE card_inventory ADD COLUMN qty_binder_un_nm int DEFAULT 0;
ALTER TABLE card_inventory ADD COLUMN qty_total int GENERATED ALWAYS AS (
  qty_fe_nm + qty_fe_lp + qty_fe_mp +
  qty_un_nm + qty_un_lp + qty_un_mp +
  qty_binder_fe_nm + qty_binder_un_nm
) STORED;
ALTER TABLE card_inventory DROP COLUMN location;

-- Denormalize card_name + set_name onto card_inventory
ALTER TABLE card_inventory DROP COLUMN card_name;
ALTER TABLE card_inventory DROP COLUMN set_name;
ALTER TABLE card_inventory ADD COLUMN card_name text;
ALTER TABLE card_inventory ADD COLUMN set_name text;
UPDATE card_inventory ci
SET card_name = c.card_name, set_name = c.set_name
FROM cards c WHERE ci.card_id = c.id;

-- Pre-2020 sets → has_unlimited = true
UPDATE sets SET has_unlimited = true WHERE year IS NOT NULL AND year < '2020';
UPDATE sets SET has_unlimited = true WHERE set_code IN ('POTE', 'ETCO');
UPDATE sets SET has_unlimited = true, has_first_ed = false
WHERE set_code LIKE 'OP%'
   OR set_code IN ('TP1','TP2','TP3','TP4','TP5','TP6','TP7','TP8');

-- Child tables created fresh in dev
CREATE TABLE acquisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid, card_number text, card_name text, rarity text, edition text,
  condition text, purchased_from text, quantity int,
  price_per_card numeric, total_cost numeric,
  acquisition_date date, created_at timestamptz DEFAULT now()
);
CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL, created_at timestamptz DEFAULT now()
);
INSERT INTO vendors (name) VALUES
  ('eBay'),('Local Card Shop'),('Facebook Marketplace'),('TCGPlayer'),('Cash')
ON CONFLICT (name) DO NOTHING;
CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_date date, card_name text, card_number text, set_name text, rarity text, platform text,
  sale_price numeric DEFAULT 0, shipping_charged numeric DEFAULT 0,
  platform_fee numeric DEFAULT 0, shipping_cost_out numeric DEFAULT 0,
  acquisition_cost numeric DEFAULT 0,
  net_profit numeric GENERATED ALWAYS AS (
    sale_price + shipping_charged - platform_fee - shipping_cost_out - acquisition_cost
  ) STORED,
  buyer_name text, created_at timestamptz DEFAULT now()
);
CREATE TABLE price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid, card_number text NOT NULL, card_name text, rarity text,
  tcg_price numeric, hr_tcg_price numeric, snapshot_date date,
  UNIQUE (card_number, rarity, snapshot_date)
);
UPDATE acquisitions a SET card_id = c.id FROM cards c
WHERE a.card_number = c.card_number AND a.card_id IS NULL;
```

### 2. Sets Modal — ⚙ Sets Button in Collection Toolbar

- New "⚙ Sets" button added to Collection tab toolbar
- Opens a modal with all 448 sets, searchable by set code or name
- Each row has a green toggle switch for `has_unlimited`
- Toggle fires a PATCH to `sets` table immediately
- Sets cached in `_allSets` — reloads only on first open

**Files changed:** `index.html`, `js/collection.js`, `css/styles.css`

### 3. Inventory Grid — New Schema

Complete rewrite of `buildCardRow()` in `js/inventory.js`:

| Before | After |
|---|---|
| Rarity inline dropdown (editable) | Rarity badge (read-only) |
| Location dropdown | Removed (column dropped) |
| Higher Rarity type select | Removed |
| HR 1st Ed NM/LP qty | Removed |
| HR Unlimited NM/LP qty | Removed |
| HR Location select | Removed |
| — | Binder 1st Ed NM input |
| — | Binder Unlimited NM input |
| Total includes HR | Total = fe + un + binder |

**Column count:** 18 → 13 (cleaner)

`doSave()` now sends: `fe_nm/lp/mp`, `un_nm/lp/mp`, `binder_fe_nm`, `binder_un_nm`, `needs_review`

### 4. db.js — DEV_MODE Routing

All four write/read functions now branch on `DEV_MODE`:

| Function | Prod | Dev |
|---|---|---|
| `getCardsBySet()` | `cards` table | `card_inventory` + `cards` join, sorted by `rarity_order` |
| `updateCard()` | PATCH `cards` | PATCH `card_inventory`, remaps field names (fe_nm→qty_fe_nm etc.), drops fields that don't exist |
| `toggleListed()` | PATCH `cards` | PATCH `card_inventory` |
| `deleteCard()` in collection.js | DELETE `cards` | DELETE `card_inventory` |

**Field remapping in updateCard() DEV_MODE:**
```js
fe_nm → qty_fe_nm,  fe_lp → qty_fe_lp,  fe_mp → qty_fe_mp
un_nm → qty_un_nm,  un_lp → qty_un_lp,  un_mp → qty_un_mp
binder_fe_nm → qty_binder_fe_nm
binder_un_nm → qty_binder_un_nm
tcg_market_price → tcg_price
// Dropped: higher_rarity, hr_*, location, set_name, year, card_name, api_id,
//          first_ed_*, unlimited_*, updated_at, rarity
```

### 5. Search Fixed (Collection Tab)

`getInventoryPage()` now uses `or` filter hitting `card_name`, `card_number`, `set_name` — all denormalized directly on `card_inventory`. Previously only searched `card_number`.

### 6. Rarity Sets Tab Removed

- Nav button removed from `index.html`
- Tab panel HTML removed
- `<script src="js/rarity-sets.js">` removed
- RA sets are now regular rows in Collection/Inventory since every rarity is its own `card_inventory` row

### 7. Branding — YGOExclusives

All instances of "Shadowrealm Emporium" replaced with "YGOExclusives":

| File | Change |
|---|---|
| `index.html` | Page title, start screen logo, app header |
| `bulk-price.html` | Page title, subtitle |
| `importer.html` | Page title, subtitle |
| `js/listing.js` | eBay description footer |
| `js/collection.js` | CSV export filename |
| `js/add-card.js` | localStorage key (`ygoexclusives_anthropic_key`) |
| `CLAUDE.md` | Project header, business name note |

**⚠ Action needed:** Re-enter Anthropic API key in List Card tab — localStorage key changed.

---

## Current App State

- `DEV_MODE = true` in `js/config.js`
- Inventory tab: loads from `card_inventory`, correct columns, autosave tested ✅
- Collection tab: search by name/number/set works ✅, ⚙ Sets modal works ✅
- Rarity Sets tab: removed ✅
- All other tabs (Acquisitions, Sales, Reports, Deal Check): still use old schema — will error or show no data in DEV_MODE

---

## Dev Schema — Final State

### `card_inventory` columns
```
id, card_id (FK→cards), card_number, rarity
card_name (denormalized), set_name (denormalized)
qty_fe_nm, qty_fe_lp, qty_fe_mp
qty_un_nm, qty_un_lp, qty_un_mp
qty_binder_fe_nm, qty_binder_un_nm
qty_total (generated: sum of all qty_*)
rarity_order (generated: 0=Common … 29=Starlight Over Frame, 99=unknown)
price_fe_nm, price_fe_lp, price_fe_mp
price_un_nm, price_un_lp, price_un_mp
tcg_price, tcg_low_price, ebay_low_price, acquisition_cost
needs_review, listed, created_at
UNIQUE(card_number, rarity)
```

### `sets` columns
```
id, set_code (UNIQUE), set_name, year
has_first_ed (bool, default true)
has_unlimited (bool, default false)
  → pre-2020 sets: true
  → POTE, ETCO: true
  → OP*/TP1-8: true, has_first_ed=false
edition_note
```

### Child tables (created in dev this session)
- `acquisitions` — card_id, card_number, rarity, edition, condition, etc.
- `sales` — net_profit as generated column, buyer_name included
- `price_history` — UNIQUE(card_number, rarity, snapshot_date)
- `vendors` — seeded with defaults

---

## Pending Work — Next Session

### Priority 1: Edition Locking (Inventory UI)
When a card's set has `has_unlimited = false`, the `qty_un_*` and `qty_binder_un_nm` inputs in the inventory grid should be greyed out and set to 0.

**How to implement:**
1. `getCardsBySet()` in DEV_MODE needs to also fetch `sets.has_unlimited` — join via set_code (first segment of card_number, e.g. "RA01" from "RA01-EN001")
2. Pass `has_unlimited` flag through the normalized card object
3. In `buildCardRow()`, if `!has_unlimited`: add `disabled` + `inv-qty-disabled` class to `un_nm/lp/mp` and `binder_un_nm` cells
4. In `doSave()`, force `un_nm/lp/mp` and `binder_un_nm` to 0 if set is 1st-ed-only

**Staff reminder popup:**
- When a set has `has_unlimited = true` AND `has_first_ed = true`, show a one-time popup per session:
  "Check the bottom-left corner of the card for a '1st Edition' stamp. No stamp = Unlimited."
- Track shown sets in a `Set` to avoid repeating per session

### Priority 2: Update Acquisitions Tab to New Schema
`js/acquisitions.js` currently inserts/queries the old `cards` table and uses old field names. In DEV_MODE it should:
- Query `card_inventory` for card lookups (by card_number + rarity)
- Insert to `acquisitions` table (already created in dev with correct schema)
- The acquisitions table schema is already correct — just needs the JS updated

### Priority 3: Update Sales Tab to New Schema
`js/sales.js` similarly targets old schema. The dev `sales` table already has the correct schema (net_profit generated, buyer_name included). JS needs updating.

### Priority 4: Prod Cutover (When Ready)
1. Confirm 100% data integrity in dev (check qty totals match prod)
2. Run `migrate.py` against prod Supabase
3. Run all the SQL from this session against prod
4. Flip `DEV_MODE = false` in `js/config.js`
5. Deploy → Netlify auto-deploys from GitHub master

### Known Bugs Still Open
- Collection bulk import broken (100 failed bug — undiagnosed)
- Add Card tab save fails with `null value in column "id"`

### Reports Tab Expansion (Lower Priority)
- Inventory Segmentation (High-End 5% / B&B 10% / Bulk 85%)
- Sales by Platform breakdown
- Price Movers (price_history two-date diff)
- Net Realized Margin KPI
- Customer LTV / Whale Buyers
- Inventory Turnover

---

## Quick Reference

| Item | Value |
|---|---|
| Toggle DEV/PROD | `js/config.js` line 3: `const DEV_MODE = true/false` |
| Dev Supabase URL | `https://xyhzwmlqmazloyerelas.supabase.co` |
| Prod Supabase URL | `https://cioijkralojzgelytbfc.supabase.co` |
| Dev anon key | In `js/config.js` (DEV_SUPABASE_KEY) |
| Migration script | `backups/migrate.py` |
| Dev schema SQL | `backups/dev-schema.sql` |
| Local dev server | `C:\ygo-serve\start-server.bat` port 8888 |
| Re-enter API key | List Card tab → paste Anthropic key (localStorage key changed this session) |
