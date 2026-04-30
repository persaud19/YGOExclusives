# YGOExclusives — Project Context

## What This Is
YuGiOh card resale business management app for Ryan Persaud. Replaces CSV spreadsheets with a live cloud-backed system. ~32,500 cards in inventory. Primary sales platform: eBay + Facebook Groups. Ships via Chit Chats (Guelph drop spot) for $5.50–6.50 CAD tracked US shipping.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS — NO framework, NO Supabase SDK
- **Database**: Supabase PostgreSQL at `https://cioijkralojzgelytbfc.supabase.co`
- **Hosting**: Netlify auto-deploy from GitHub `persaud19/shadowrealm-emporium` master branch
- **Card data**: YGOPRODeck API (free, no key needed)
- **Local dev**: `C:\ygo-serve\start-server.bat` on port 8888 via `.claude/launch.json`
- **All Supabase calls**: plain `fetch()` to REST API — never use SDK

## File Structure
```
D:\CoworkOS\YGO Project\
├── index.html              ← main app (915 lines — needs modularization)
├── bulk-price.html         ← standalone bulk TCG price updater
├── importer.html           ← CSV import tool
├── css/styles.css          ← dark purple/gold theme
├── js/
│   ├── config.js           ← SUPABASE_URL, SUPABASE_KEY, RARITIES, LOCATIONS, HR_OPTIONS
│   ├── db.js               ← all Supabase REST helpers
│   ├── app.js              ← mode management, tab routing
│   ├── inventory.js        ← Excel-style grid, autosave, Tab/Enter nav
│   ├── collection.js       ← server-side pagination, edit modal, CSV export, bulk import
│   ├── add-card.js         ← List Card tab (Claude Vision + card lookup)
│   ├── acquisitions.js     ← manual entry + bulk CSV import + vendor management
│   ├── sales.js            ← sales log
│   ├── reports.js          ← Monthly P&L (partial — needs expansion)
│   ├── listing.js          ← eBay title/desc + FB post generators
│   └── rarity-sets.js      ← RA01/RA02+ horizontal rarity grid
├── backups/
│   ├── config.json         ← Supabase service role key + Anthropic key (NEVER commit)
│   ├── backup.ps1          ← runs on Windows login via Task Scheduler
│   ├── restore.ps1         ← manual restore: .\restore.ps1 -Date 2026-04-07
│   ├── setup-task.ps1      ← run once as admin to register Task Scheduler
│   ├── process-photos.ps1  ← Google Drive → Claude Vision → Card Photos\ + listing_queue
│   └── mark-listed.ps1     ← mark queue entry as pushed to eBay
└── importer/importer.js    ← CSV processing logic
```

## Supabase Schema

### cards table (32,500+ rows)
```
id                    text (some are UUIDs, some are legacy composites like "LOB-EN001-Ultra-Rare")
card_number           text  e.g. "BLMM-EN001"
card_name             text
rarity                text
set_name              text
year                  text
location              text  default "Basement Box"
higher_rarity         text  nullable — HR type e.g. "Starlight Rare"
hr_location           text  nullable
fe_nm, fe_lp, fe_mp   int   1st edition NM/LP/MP qty
un_nm, un_lp, un_mp   int   unlimited NM/LP/MP qty
hr_fe_nm, hr_fe_lp    int   HR 1st edition qty
hr_qty_nm, hr_qty_lp  int   HR unlimited qty
tcg_market_price      numeric
hr_tcg_price          numeric
ebay_low_price        numeric  nullable (column exists, needs data)
acquisition_cost      numeric
needs_review          boolean default false
api_id                text  YGOPRODeck image ID
listed                boolean
first_ed_nm/lp/mp     numeric  listing prices (multiplied from tcg)
unlimited_nm/lp/mp    numeric  listing prices
```

### acquisitions table
```
id, card_id (uuid nullable), card_number, card_name, rarity, edition
condition, purchased_from, quantity, price_per_card, total_cost
acquisition_date, created_at
```

### vendors table
```
id, name (unique), created_at
```
Default vendors: eBay, Local Card Shop, Facebook Marketplace, TCGPlayer, Cash

### price_history table
```
id, card_id (uuid nullable — NO foreign key, soft reference)
card_number (NOT NULL), card_name, rarity
tcg_price, hr_tcg_price
snapshot_date date (UNIQUE per card_number+date)
```
Runs on 1st and 15th via GitHub Actions. Keeps 3 years. No pg_cron needed.

### sales table
```
id, sale_date, card_name, card_number, set_name, rarity, platform
sale_price, shipping_charged, platform_fee, shipping_cost_out, acquisition_cost
net_profit (BUG: never written — always 0, needs fix)
buyer_name (needs to be added: ALTER TABLE sales ADD COLUMN buyer_name text)
```

## Key Decisions Made

### No PIN protection
Removed PIN modal — Full Access goes directly to owner mode. Inventory mode still exists for senior helper.

### Rarity-based pricing (bulk updater)
Match chain: `card_number|rarity` → `card_number` → `card_name`
This fixed ~50% accuracy issue where same card_number had multiple rarities overwriting each other.

### HR (High Rarity) definition
Normal: Common, Rare, Short Print, Super Rare, Ultra Rare, Secret Rare
High Rarity: everything else (Starlight, QCSR, Prismatic, Platinum Secret, etc.)

### RA-series sets
Sets matching `/^RA\d{2}-/i` use the Rarity Sets tab (horizontal layout).
Each rarity is a separate row in the cards table.
Normal rarities → `un_nm`. HR rarities → `hr_qty_nm`.

### Backups
Local only. Windows Task Scheduler on login. 60-day retention.
Tables: cards, acquisitions, vendors.
Service role key stored in `backups/config.json` — gitignored.

### eBay API (IN PROGRESS)
Credentials expected this weekend (2026-04-12 approx).
Need: App ID, Cert ID, Dev ID, RuName from developer.ebay.com
Will use Netlify serverless functions (not browser JS — secret key can't be exposed).
Planned functions: ebay-auth.js, ebay-search.js, ebay-list.js

### GitHub Actions price scheduler
Runs on 1st and 15th of every month.
Script: `.github/workflows/price-update.yml` (TO BE BUILT — pending service role key setup).
Also writes price_history snapshot and purges entries older than 3 years.

### Photo/Listing workflow (TO BE BUILT)
1. Senior uploads photos to Google Drive
2. PowerShell script syncs to `D:\Card Photos\Incoming\`
3. Second script creates folders by card number, moves photos
4. Card enters listing_queue in Supabase
5. Queue: flagged cards first → oldest pending first
6. 10 cards/day pushed to eBay as drafts (personal discipline target, not enforced)
7. Ryan approves on eBay → marks as listed in app

Photo naming convention: `LOB-EN001_front.jpg` (card number prefix).
Google Drive desktop app needed on Ryan's machine.

## Module Architecture (Planned)

| Module | Purpose | Status |
|---|---|---|
| 1. Inventory | Physical card counts, source of truth | ✅ Built |
| 2. Collection | Business intelligence layer on inventory | ⚠️ Partial |
| 3. The Market | TCGPlayer/eBay prices, snapshots, trends | ⚠️ Partial |
| 4. Listing | Photos → Claude ID → eBay draft queue | 🔲 Not started |
| 5. Sales & Sentiment | Sales tracking, LTV, whale buyers | ⚠️ Partial |
| 6. Pocket Tool | Quick card lookup, USD→CAD converter | 🔲 Not started |

## Known Bugs / Pending Work

### Must fix before reporting is useful:
1. `net_profit` never saved in sales — compute on submit: `sale_price + shipping_charged - platform_fee - shipping_cost_out - acquisition_cost`
2. `buyer_name` missing from sales table — run: `ALTER TABLE sales ADD COLUMN buyer_name text;`

### Pending Supabase columns:
- `ebay_low_price` already exists on cards (added earlier session) — needs bulk price run to populate
- `hr_tcg_price` already exists on cards
- `needs_review` already exists on cards
- `hr_fe_nm`, `hr_fe_lp` already exist on cards

### listing_queue table (NOT YET CREATED -- run SQL below in Supabase SQL Editor before using process-photos.ps1):
```sql
CREATE TABLE listing_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         uuid,
  card_number     text NOT NULL,
  photo_folder    text,
  flagged         boolean DEFAULT false,
  status          text DEFAULT 'pending',
  queued_at       timestamptz DEFAULT now(),
  pushed_at       timestamptz,
  ebay_listing_id text
);
```

### Reports tab — sections to add:
- Inventory Segmentation (High-End 5% / B&B 10% / Bulk 85%)
- Sales by Platform breakdown
- Price Movers (use price_history, two-date diff — current query broken)
- Net Realized Margin KPI
- Customer LTV / Whale Buyers (needs buyer_name first)
- Inventory Turnover (needs avg inventory value snapshot)

### Collection tab improvements pending:
- Total qty from inventory showing in search results
- HR qty separate from normal qty display

### Import new set (collection tab) — 100 failed bug:
Collection bulk import is broken — not yet diagnosed. Needs investigation.

### Add Card tab:
- Save fails with `null value in column "id"` — card_id must be a UUID, not composite key

## Business Context
- Ryan = owner, Full Access mode
- Senior helper = Inventory mode only (counts cards in binders)
- Business name: YGOExclusives (previously Shadow Realm Emporium / The Apex Archive)
- Inventory segmentation: High-End (QCSR/1st Ed/$50+), Bread & Butter ($5-49), Bulk (<$5)
- KPIs: Inventory Turnover, Net Realized Margin, Customer LTV
- Chit Chats Guelph drop spot for US shipping ($5.50-6.50 CAD tracked)

## Design System
- Dark purple/gold theme
- Fonts: Cinzel (headings), DM Sans (body)
- CSS vars: --bg, --surf, --surf2, --b1, --b2, --gold, --gold2, --txt, --muted, --dim, --green, --yellow, --red, --blue, --purple
- Full-width tables: `#tab-inventory .tab-content`, `#tab-collection .tab-content` both have `max-width: 100%`
- Qty inputs: `type="text" inputmode="numeric"` — NOT type="number"
- Autosave: debounced 800ms
- Server-side pagination: 50 rows/page
- RA01 detection: `/^RA\d{2}-/i`

## Coding Rules
- NO Supabase SDK — plain fetch() only
- NO framework — vanilla JS only
- PATCH for updates, POST for inserts
- Batch upsert size: 250 rows
- toUUID() helper exists in db.js to guard against non-UUID id values
- Card image: `https://images.ygoprodeck.com/images/cards_small/{api_id}.jpg`
