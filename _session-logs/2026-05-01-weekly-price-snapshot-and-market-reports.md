# Session Log — Weekly Price Snapshot & Market Reports
**Date:** 2026-05-01
**Duration:** ~1 session
**Focus:** Weekly automated price tracking, price delta reporting, and AI-generated weekly market analysis

---

## What Was Built

### 1. `scripts/price-update.js` — Full Rewrite
- Migrated from old `cards` table to new `card_inventory` schema
- Now captures both `tcg_price` (market) AND `tcg_low_price` (low listed) from YGOPRODeck `set_price` / `set_price_low`
- Calculates and writes `tcg_price_cad` = `tcg_low_price × live CAD rate` (fetched from open.er-api.com with frankfurter.app fallback)
- HR pricing via card name + `higher_rarity` lookup still intact
- PATCH target changed to `card_inventory?id=eq.${id}`
- History rows now include `tcg_low_price` (new column added to `price_history` via SQL)
- Purge runs on first Monday of the month (day ≤ 7) instead of 1st of month

### 2. `scripts/weekly-analysis.js` — New File
- Finds nearest available snapshot for 7-day, 30-day, and 365-day lookbacks using `snapshot_date=lte.${target}` queries
- Fetches all 4 snapshots + live inventory in parallel
- Calculates price deltas (filters noise below 5% change)
- Builds markdown tables with card name, rarity, prior/now price, % change, and "You Own" qty + acquisition cost
- Calls Claude Sonnet (`claude-sonnet-4-6`) with a structured business analyst prompt
- Report sections: Executive Summary, Sell Now, Hold Tight, Buy Opportunities, Watch & Protect, Action Items
- Saves full markdown report to `weekly_reports` Supabase table (upserts by date)

### 3. `.github/workflows/price-update.yml` — Updated
- Renamed to "Weekly Price Update & Market Analysis"
- Schedule changed from `1st/15th of month` → `every Monday at 13:00 UTC (8am EST)`
- Split into two sequential jobs:
  - `update-prices` — runs price-update.js (~30 min for 32K cards)
  - `weekly-analysis` — depends on `update-prices` via `needs:`, runs after snapshot is confirmed written
- Added `ANTHROPIC_API_KEY` env var to weekly-analysis job

### 4. `js/reports.js` — Major Updates
- Replaced old two-snapshot `getPriceMovers()` with period-aware version (week / month / year)
- New `loadPriceMovers(period)` async loader with loading state
- `window.switchPriceMovers(period)` global — toggle buttons call this, re-fetches and re-renders
- Gainers and losers now split into two side-by-side columns within the section
- Card names shown (previously only card number)
- Threshold lowered from ±15% to ±10%
- Download CSV button embedded in toggle bar
- Added download utility functions: `downloadTableCSV()`, `downloadText()`, `window.dlReport()`
- Added `loadWeeklyReport()` — fetches latest row from `weekly_reports`, renders markdown
- Added `renderWeeklyReport()` — renders date header, download .md button, and parsed markdown body
- Added `markdownToHtml()` — minimal converter handling headings, bold, italic, HR, pipe tables, bullet lists, paragraphs

### 5. `index.html` + `css/styles.css` — Layout Overhaul
- Reports tab restructured into 2-column grid rows:
  - Row 1: Inventory Overview (2/3 width) + Value by Set (1/3 width)
  - Row 2: Top 50 High Value Unlisted (full width + Download CSV)
  - Row 3: Top 50 High Qty Unlisted (full width + Download CSV)
  - Row 4: Monthly P&L (1/2) + Price Movers (1/2) — side by side
  - Row 5: Weekly AI Report (full width)
- New CSS: `.report-grid-2`, `.report-section-hdr`, `.rpt-dl-btn`, `.rsh-sub`, `.report-md-body`
- Responsive: grid collapses to single column below 860px
- `h3` margin removed from `.report-section` (now managed by `.report-section-hdr` flex container)

### 6. Repo / Hosting Updates
- GitHub repo renamed: `persaud19/shadowrealm-emporium` → `persaud19/YGOExclusives`
- Netlify URL updated: `https://ygoexclusives.netlify.app`
- GitHub Secrets confirmed set: `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`
- `CLAUDE.md` hosting line updated
- `MEMORY.md` updated with new repo name, URL, secrets status, and tab status

---

## SQL Run in Supabase (Already Applied)

```sql
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS tcg_low_price numeric;

CREATE TABLE IF NOT EXISTS weekly_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date  date NOT NULL UNIQUE,
  report_md    text NOT NULL,
  created_at   timestamptz DEFAULT now()
);
```

---

## Design Decisions Made

| Decision | Rationale |
|---|---|
| All 32,500 cards snapshotted (not just owned) | Enables buying-opportunity detection for cards Ryan doesn't yet own |
| Weekly Monday only (not 1st/15th) | More frequent = better delta resolution for 1W/1M/1Y comparisons |
| 13:00 UTC (8am EST) for price snapshot | Consistent year-round; EDT offset accepted (fires at 9am EDT in summer) |
| Weekly analysis runs after price update via `needs:` | Guarantees today's snapshot exists before Claude reads it |
| Reports stored in Supabase `weekly_reports` (not committed to repo) | No git bloat; instantly queryable from the app |
| `markdownToHtml()` written inline (no library) | Keeps zero-dependency vanilla JS rule; covers all sections Claude actually outputs |
| ±10% threshold for Price Movers (down from ±15%) | More signal, especially useful for B&B segment ($5–49 cards) |
| Purge on first Monday of month (day ≤ 7) | Keeps 3-year history while running weekly; one purge per month is sufficient |

---

## Pending / Known Issues

- **First run cold start**: Price Movers and AI report will show "insufficient history" messages until a few weeks of snapshots accumulate. This is expected and correct.
- **TCGPlayer quantity/sellers**: Decided to skip — not available in YGOPRODeck API. Can revisit if TCGPlayer API access is obtained.
- **EST vs EDT**: Workflow fires at 13:00 UTC year-round = 8am EST (winter) / 9am EDT (summer). Intentional.
- **`add-card` null id bug** — still open, not addressed this session
- **Collection bulk import 100-failed bug** — still open, not addressed this session

---

## Quick Reference

| Thing | Location |
|---|---|
| Price snapshot script | `scripts/price-update.js` |
| AI analysis script | `scripts/weekly-analysis.js` |
| GitHub Actions workflow | `.github/workflows/price-update.yml` |
| Reports UI | `js/reports.js` |
| Weekly reports table | Supabase `weekly_reports` |
| Price history table | Supabase `price_history` (now includes `tcg_low_price`) |
| Live site | `https://ygoexclusives.netlify.app` |
| Repo | `persaud19/YGOExclusives` |
| Manual trigger | GitHub → Actions → "Weekly Price Update & Market Analysis" → Run workflow |
