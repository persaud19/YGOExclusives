# YGOExclusives — Project Context

## What This Is
YuGiOh card resale business management app for Ryan Persaud. Replaces CSV spreadsheets with a live cloud-backed system. ~32,500 cards in inventory. Primary sales platform: eBay + Facebook Groups. Ships via Chit Chats (Guelph drop spot) for $5.50–6.50 CAD tracked US shipping.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS — NO framework, NO Supabase SDK
- **Database**: Supabase PostgreSQL at `https://xyhzwmlqmazloyerelas.supabase.co`
- **Hosting**: Netlify auto-deploy from GitHub `persaud19/YGOExclusives` master branch → `https://ygoexclusives.netlify.app`
- **Card data**: YGOPRODeck API (free, no key needed)
- **Local dev**: `C:\ygo-serve\start-server.bat` on port 8888 via `.claude/launch.json`
- **All Supabase calls**: plain `fetch()` to REST API — never use SDK

## File Structure
```
D:\CoworkOS\YGO Project\
├── index.html                  ← main app
├── bulk-price.html             ← standalone bulk TCG price updater
├── importer.html               ← CSV import tool
├── css/styles.css              ← dark purple/gold theme
├── js/
│   ├── config.js               ← SUPABASE_URL, SUPABASE_KEY, RARITIES, LOCATIONS, HR_OPTIONS
│   ├── db.js                   ← all Supabase REST helpers
│   ├── app.js                  ← mode management, tab routing
│   ├── inventory.js            ← Excel-style grid, autosave, Tab/Enter nav
│   ├── collection.js           ← server-side pagination, edit modal, CSV export, bulk import, sync sets modal
│   ├── add-card.js             ← List Card tab (Claude Vision + card lookup)
│   ├── acquisitions.js         ← manual entry + bulk CSV import + vendor management
│   ├── sales.js                ← sales log + eBay sync
│   ├── reports.js              ← all report sections (10-row scroll cap on all tables)
│   ├── dashboard.js            ← Dashboard tab (KPIs, Collection DNA, value concentration)
│   ├── listing.js              ← eBay title/desc + FB post generators
│   ├── listing-queue.js        ← Listing Queue tab (DB-backed queue, eBay prices, sync listed)
│   ├── orders.js               ← Orders tab (pick & ship sheet)
│   └── rarity-sets.js          ← RA01/RA02+ horizontal rarity grid
├── netlify/functions/
│   ├── ebay-sync.js            ← daily eBay order sync (https module, NOT fetch)
│   ├── ebay-queue-prices.js    ← on-demand eBay low price fetch for listing queue
│   └── ebay-active-sync.js     ← syncs card_inventory.listed with live eBay active listings
├── scripts/
│   ├── price-update.js         ← weekly GitHub Actions price snapshot (card_inventory)
│   └── weekly-analysis.js      ← Claude Sonnet market analysis → weekly_reports table
├── .github/workflows/
│   └── price-update.yml        ← every Monday 13:00 UTC: price update + weekly AI analysis
├── backups/
│   ├── config.json             ← Supabase service role key + Anthropic key (NEVER commit)
│   ├── backup.ps1              ← runs on Windows login via Task Scheduler
│   ├── restore.ps1             ← manual restore: .\restore.ps1 -Date 2026-04-07
│   ├── setup-task.ps1          ← run once as admin to register Task Scheduler
│   ├── process-photos.ps1      ← Google Drive → Claude Vision → Card Photos\ + listing_queue
│   └── mark-listed.ps1         ← mark queue entry as pushed to eBay
└── importer/importer.js        ← CSV processing logic
```

## Supabase Schema (LIVE — new schema as of 2026-04-30)

### cards table (identity/lookup only)
```
id            uuid PRIMARY KEY
card_number   text  e.g. "BLMM-EN001"
card_name     text
api_id        text  YGOPRODeck image ID
```

### card_inventory table (main working table — 32,500+ rows)
```
id                uuid PRIMARY KEY
card_number       text
card_name         text  (denormalized)
set_name          text  (denormalized)
rarity            text
year              text
higher_rarity     text  nullable — HR type e.g. "Starlight Rare"
qty_fe_nm/lp/mp   int   1st edition NM/LP/MP qty
qty_un_nm/lp/mp   int   unlimited NM/LP/MP qty
qty_binder_fe_nm  int
qty_binder_un_nm  int
qty_total         int   generated column (sum of all qty fields)
rarity_order      int   generated column (for sort)
tcg_price         numeric  TCG market price (USD)
tcg_low_price     numeric  TCG low price (USD)
tcg_price_cad     numeric  tcg_low_price × live CAD rate
hr_tcg_price      numeric  HR variant price
ebay_low_cad      numeric  eBay lowest sold (CAD, from ebay-queue-prices function)
acquisition_cost  numeric
listed            boolean  true = currently live on eBay
ebay_listing_id   text  nullable
needs_review      boolean default false
```

### sets table
```
id, set_code, set_name, year
has_first_ed    boolean  (pre-2020 = true; exceptions: POTE, ETCO = true)
has_unlimited   boolean
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

### sales table
```
id, sale_date, card_name, card_number, set_name, rarity, platform
sale_price, shipping_charged, platform_fee, shipping_cost_out, acquisition_cost
net_profit  (generated on submit — fixed)
buyer_name, buyer_address_line1, buyer_address_line2, buyer_postal_code
ebay_transaction_id  (upsert key for eBay sync)
ebay_order_id
shipped boolean DEFAULT false
shipped_at timestamptz
```

### price_history table
```
id, card_number (NOT NULL), card_name, rarity
tcg_price, tcg_low_price, hr_tcg_price
snapshot_date date (UNIQUE per card_number+date)
```
Written every Monday by GitHub Actions. Keeps 3 years.

### listing_queue table
```
id uuid, card_id uuid, card_number text NOT NULL
photo_folder text, flagged boolean DEFAULT false
status text DEFAULT 'pending'  (pending/skipped/listed)
queued_at timestamptz, pushed_at timestamptz
ebay_listing_id text, ebay_low_cad numeric
```

### weekly_reports table
```
id, report_date date (UNIQUE), summary text, created_at
```

## Key Decisions Made

### Schema: card_inventory is the main table
The old `cards` table is now identity-only. All qty, price, and listing data lives in `card_inventory`. Every JS module and Netlify function queries `card_inventory`, not `cards`.

### No PIN protection
Removed PIN modal — Full Access goes directly to owner mode. Inventory mode still exists for senior helper.

### Rarity-based pricing (bulk updater)
Match chain: `card_number|rarity` → `card_number` → `card_name`
This fixed ~50% accuracy issue where same card_number had multiple rarities overwriting each other.

### HR (High Rarity) definition
Normal: Common, Rare, Short Print, Super Rare, Ultra Rare, Secret Rare
High Rarity: everything else (Starlight, QCSR, Prismatic, Platinum Secret, Ultimate Rare, Collector's Rare, etc.)

### RA-series sets
Sets matching `/^RA\d{2}-/i` use the Rarity Sets tab (horizontal layout).
Each rarity is a separate row in `card_inventory`.
All qty uses `qty_fe_nm` (unified field — no HR/normal split in rarity sets tab).
Alternate arts (same card_number, different card_name) each get their own row.

### Inventory segmentation thresholds (CAD)
- High-End: C$40+ (tcg_price_cad)
- Bread & Butter: C$2.50–39.99
- Bulk: <C$2.50

### Price update schedule
GitHub Actions runs every **Monday at 13:00 UTC (8am EST)**.
- Job 1: `price-update.js` — patches `tcg_price`, `tcg_low_price`, `tcg_price_cad`, `hr_tcg_price` on `card_inventory`; writes `price_history` snapshot; purges history >3 years on first Monday of month
- Job 2: `weekly-analysis.js` — Claude Sonnet market analysis saved to `weekly_reports`

### Backups
Local only. Windows Task Scheduler on login. 60-day retention.
Tables: cards, acquisitions, vendors.
Service role key stored in `backups/config.json` — gitignored.

### eBay Sync Architecture
- **Order sync**: `netlify/functions/ebay-sync.js` — daily 13:00 UTC via GitHub Actions. Uses Node `https` module (not fetch — Netlify Node version issue). Upserts by `ebay_transaction_id`.
- **Active listing sync**: `netlify/functions/ebay-active-sync.js` — on-demand via "⟳ Sync Listed" button in Listing Queue tab. Fetches all active listings via `GetMyeBaySelling` Trading API, matches by `ebay_listing_id` then card number from title, updates `card_inventory.listed`.
- **eBay low prices**: `netlify/functions/ebay-queue-prices.js` — on-demand via "↺ eBay Prices" button. Uses eBay Finding API. Writes `ebay_low_cad` to both `listing_queue` and `card_inventory`.
- FVF: 13.25% on `salePrice + shippingCharged`
- Shipping cost: `CA_PostLettermail` → $2.00, all others → $5.50

### Reports tab — all tables use 10-row scroll cap
Pattern: sticky `<thead>` in outer table + `max-height:calc(10 * 41px);overflow-y:auto` wrapper around inner `<tbody>` table.

### Junk set filtering
Applied in both the Collection sync modal AND the Sets Not in Inventory report:
- Bare numbers (`/^\d+$/`)
- `XXXX Mega Pack` style (`/^\d+ Mega Pack$/`)
- `Battles of Legend: Chapter N`
- Three one-offs: Advanced Demo Deck Extra Pack, Anniversary Pack, Battle Pack Tournament Prize Cards

### Photo/Listing workflow (TO BE BUILT)
1. Senior uploads photos to Google Drive
2. PowerShell script syncs to `D:\Card Photos\Incoming\`
3. Second script matches folders to card_inventory, creates listing_queue entries
4. Queue: flagged cards first → oldest pending first
5. 10 cards/day pushed to eBay as drafts (personal discipline target, not enforced)
6. Ryan approves on eBay → "⟳ Sync Listed" marks as listed in app

Photo naming convention: `LOB-EN001_front.jpg` (card number prefix).

## Tab Status (as of 2026-06-09)

| Tab | Status | Notes |
|---|---|---|
| Inventory | ✅ | Edition locking, binder columns, rarity badge, autosave |
| Collection | ✅ | Search, Sets modal with junk filter, CAD price column |
| Acquisitions | ✅ | New schema, card_inventory lookups |
| Sales | ✅ | eBay sync live, slide-in detail panel, multi-channel log modal, buyer info, net profit |
| Orders | ✅ | Pick & ship sheet, Mark Shipped, Print — visible in Inventory + Full Access |
| Reports | ✅ | All sections with 10-row scroll, Sets Not in Inventory at bottom |
| Dashboard | ✅ | Instant analysis (2026-07-16): KPI row · Collection DNA (Nostalgia/Staples/Individual, Whole↔Binder scope toggle) · Value Concentration (top 10 names, set-segmented bars). Nostalgia = first-10-booster names (YGOPRODeck, cached in localStorage `ygx_nostalgia_names_v1`) + DM/GX anime aces; staples curated in dashboard.js. Price basis: max(tcg_price_cad, ebay_low_cad) |
| Listing Queue | ✅ | eBay Low (CAD) column, ↺ eBay Prices, ⟳ Sync Listed |
| Rarity Sets | ✅ | RA01+ horizontal grid, card_inventory table, alternate art rows |
| Bulk Price Updater | ✅ | Standalone /bulk-price.html, YGOPRODeck, USD→CAD |
| Add Card | ⚠️ | Save fails — null id bug (needs UUID generation) |
| Listing | ⚠️ | Text generators only, no eBay API push yet |

## Reports Tab Layout (top to bottom)
1. Weekly AI Report
2. Summary Stats
3. Inventory Overview (2/3 width) + Set Value by Set Code (1/3 width)
4. Top 50 Highest Value — Unlisted
5. Top 50 Highest Qty — Unlisted & TCG Low >$5
6. Monthly P&L + Price Movers (side by side)
7. Sets Not in Inventory

## Known Bugs / Pending Work

### Add Card tab
- Save fails with `null value in column "id"` — id must be a generated UUID, not a composite key

### Collection bulk import — 100 failed bug
- Bulk import of a new set fails with ~100 errors — root cause undiagnosed

### listing_queue / process-photos workflow
- `process-photos.ps1` and `mark-listed.ps1` scripts exist but full photo workflow not wired end-to-end
- Google Drive desktop app not yet set up on Ryan's machine

### eBay order sync — NOT automated (manual only)
- ⚠️ There is NO scheduled eBay order sync. The "daily 13:00 UTC GitHub Actions" line elsewhere in this doc was aspirational — no `ebay-sync.yml` workflow exists. The only sync that ever ran was a one-time manual backfill on 2026-05-31.
- For now, sync is manual via the **⇅ Sync eBay** button on the Orders tab (`syncEbayOrders()` in `js/orders.js`) → calls `ebay-sync` function → reloads the order list.
- **TODO (Ryan wants this automated):** run the eBay order sync **daily at 6:00am EST** to pull new orders AND auto-refresh the Orders page. Needs a GitHub Actions cron (`ebay-sync.yml`, `0 11 * * *` = 11:00 UTC = 6am EST) hitting the deployed function with `SYNC_API_KEY`, plus a client-side periodic `loadOrders()` so an open Orders tab refreshes itself.

### Cleanup
- `_pickup.ps1` and `0001-feat-*.patch` still in project root — safe to delete now that changes are merged to master

## Business Context
- Ryan = owner, Full Access mode
- Senior helper = Inventory mode only (counts cards in binders)
- Business name: YGOExclusives (previously Shadow Realm Emporium / The Apex Archive)
- Inventory segmentation: High-End (C$40+), Bread & Butter (C$2.50–39.99), Bulk (<C$2.50)
- KPIs: Inventory Turnover, Net Realized Margin, Customer LTV
- Chit Chats Guelph drop spot for US shipping ($5.50–6.50 CAD tracked)

## Design System
- Dark purple/gold theme
- Fonts: Cinzel (headings), DM Sans (body)
- CSS vars: --bg, --surf, --surf2, --b1, --b2, --gold, --gold2, --txt, --muted, --dim, --green, --yellow, --red, --blue, --purple
- Full-width tables: `#tab-inventory .tab-content`, `#tab-collection .tab-content` both have `max-width: 100%`
- Qty inputs: `type="text" inputmode="numeric"` — NOT type="number"
- Autosave: debounced 800ms
- Server-side pagination: 50 rows/page
- RA01 detection: `/^RA\d{2}-/i`
- Report tables: sticky thead + 10-row scroll cap (`max-height:calc(10 * 41px);overflow-y:auto`)

## Coding Rules
- NO Supabase SDK — plain fetch() only
- NO framework — vanilla JS only
- PATCH for updates, POST for inserts
- Batch upsert size: 250 rows
- toUUID() helper exists in db.js to guard against non-UUID id values
- Card image: `https://images.ygoprodeck.com/images/cards_small/{api_id}.jpg`
- Netlify functions: use Node `https` module NOT fetch (Netlify Node version issue)
- URL query params with `%` wildcards MUST go through URLSearchParams — never build ilike URLs manually
- Field names: `qty_fe_nm`, `qty_un_nm`, `qty_binder_fe_nm` etc. (NOT the old `fe_nm`, `un_nm` names)
