// scripts/price-update.js
// Runs via GitHub Actions every Monday at 13:00 UTC (8am EST).
// - Fetches rarity-specific TCG market + low prices from YGOPRODeck
// - Patches tcg_price, tcg_low_price, tcg_price_cad on card_inventory
// - Writes a price_history snapshot
// - Purges history older than 3 years (first Monday of the month only)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
};

// ── CAD rate ──────────────────────────────────────────────────────────────────
async function fetchCadRate() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const d = await r.json();
    if (d?.rates?.CAD) return d.rates.CAD;
  } catch (_) {}
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=CAD');
    const d = await r.json();
    if (d?.rates?.CAD) return d.rates.CAD;
  } catch (_) {}
  return 1.38;
}

// ── Step 1: Fetch YGOPRODeck card database ────────────────────────────────────
async function fetchYGOCards() {
  console.log('Fetching YGOPRODeck card database...');
  const res = await fetch('https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes');
  if (!res.ok) throw new Error(`YGOPRODeck fetch failed: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

function buildPriceMaps(ygoCards) {
  const bySetCode    = new Map(); // "blmm-en001" → { market, low, name, apiId }
  const byNameRarity = new Map(); // "blue-eyes white dragon|ultra rare" → { market, low }

  for (const card of ygoCards) {
    for (const set of (card.card_sets || [])) {
      const code   = set.set_code?.toLowerCase().trim();
      const market = parseFloat(set.set_price)     || 0;
      const low    = parseFloat(set.set_price_low) || 0;

      if (code && (market > 0 || low > 0) && !bySetCode.has(code)) {
        bySetCode.set(code, { market, low, name: card.name, apiId: card.id });
      }

      if ((market > 0 || low > 0) && set.set_rarity) {
        const nrKey = `${card.name.toLowerCase().trim()}|${set.set_rarity.toLowerCase().trim()}`;
        if (!byNameRarity.has(nrKey)) byNameRarity.set(nrKey, { market, low });
      }
    }
  }

  console.log(`Price maps: ${bySetCode.size.toLocaleString()} set codes, ${byNameRarity.size.toLocaleString()} name+rarity entries`);
  return { bySetCode, byNameRarity };
}

// ── Step 2: Fetch all card_inventory rows ─────────────────────────────────────
async function fetchAllInventory() {
  console.log('Fetching card_inventory from Supabase...');
  const all = [];
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/card_inventory?select=id,card_number,card_name,rarity,qty_total&limit=${PAGE}&offset=${offset}`,
      { headers: HEADERS }
    );
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`Loaded ${all.length.toLocaleString()} inventory rows`);
  return all;
}

// ── Step 3: PATCH a single inventory row ──────────────────────────────────────
async function patchInventory(id, fields) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/card_inventory?id=eq.${id}`,
    { method: 'PATCH', headers: HEADERS, body: JSON.stringify(fields) }
  );
  if (!res.ok) throw new Error(await res.text());
}

// ── Step 4: Write price_history snapshot ──────────────────────────────────────
async function insertPriceHistory(rows) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/price_history`,
    {
      method: 'POST',
      headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) throw new Error(`History insert failed: ${await res.text()}`);
}

// ── Write a portfolio_history snapshot (one row per day, upsert) ─────────────
async function insertPortfolioHistory(p, today) {
  const row = {
    snapshot_date:    today,
    total_value_cad:  +p.total.toFixed(2),
    high_end_cad:     +p.high.toFixed(2),
    bread_butter_cad: +p.bb.toFixed(2),
    bulk_cad:         +p.bulk.toFixed(2),
    total_qty:        p.qty,
    unique_printings: p.printings,
  };
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/portfolio_history?on_conflict=snapshot_date`,
    {
      method: 'POST',
      headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    }
  );
  if (!res.ok) throw new Error(`Portfolio snapshot failed: ${await res.text()}`);
  console.log(`Portfolio snapshot: C$${row.total_value_cad.toLocaleString()} total · ${row.total_qty.toLocaleString()} cards`);
}

// ── Step 5: Purge history older than 3 years (first Monday of month only) ────
async function purgeOldHistory() {
  console.log('Purging price history older than 3 years...');
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 3);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/price_history?snapshot_date=lt.${cutoffStr}`,
    { method: 'DELETE', headers: HEADERS }
  );
  if (!res.ok) throw new Error(`Purge failed: ${await res.text()}`);
  console.log(`Purged records before ${cutoffStr}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  const today     = new Date().toISOString().split('T')[0];
  console.log(`\n=== Price Update: ${today} ===\n`);

  const [ygoCards, cadRate] = await Promise.all([fetchYGOCards(), fetchCadRate()]);
  console.log(`YGOPRODeck: ${ygoCards.length.toLocaleString()} cards | CAD rate: ${cadRate}`);

  const { bySetCode, byNameRarity } = buildPriceMaps(ygoCards);
  const inventory = await fetchAllInventory();

  let matched = 0, skipped = 0, errors = 0;
  const patches     = [];
  const historyRows = [];

  // Portfolio snapshot accumulators (value = TCG Low CAD × qty_total, segmented)
  const portfolio = { total: 0, high: 0, bb: 0, bulk: 0, qty: 0, printings: 0 };

  for (const card of inventory) {
    const codeKey = (card.card_number || '').toLowerCase().trim();
    const entry   = bySetCode.get(codeKey);
    const market  = entry?.market || 0;
    const low     = entry?.low    || 0;

    // Accumulate portfolio value from this card's holdings
    const qty = card.qty_total || 0;
    if (qty > 0) {
      portfolio.qty += qty;
      portfolio.printings++;
      if (low > 0) {
        const cad = low * cadRate;
        const val = cad * qty;
        portfolio.total += val;
        if (cad >= 40)       portfolio.high += val;
        else if (cad >= 2.5) portfolio.bb   += val;
        else                 portfolio.bulk += val;
      }
    }

    // NOTE: card_inventory has no higher_rarity / hr_tcg_price columns (stale schema
    // removed). HR pricing is not tracked here; keep hrMarket=0 for history shape.
    const hrMarket = 0;

    const patch = {};
    if (market > 0 || low > 0) {
      if (market > 0)   patch.tcg_price     = +market.toFixed(2);
      if (low    > 0)   patch.tcg_low_price = +low.toFixed(2);
      if (low    > 0)   patch.tcg_price_cad = +(low * cadRate).toFixed(2);
      matched++;
    } else {
      skipped++;
    }

    if (Object.keys(patch).length > 0) {
      patches.push({ id: card.id, ...patch });
    }

    // Always write history row — even zero prices track card existence
    historyRows.push({
      card_number:   card.card_number,
      card_name:     card.card_name,
      rarity:        card.rarity,
      tcg_price:     market   || null,
      tcg_low_price: low      || null,
      hr_tcg_price:  hrMarket || null,
      snapshot_date: today,
    });
  }

  console.log(`\nMatched: ${matched.toLocaleString()} | No match: ${skipped.toLocaleString()}`);

  // PATCH in batches of 100 concurrent
  console.log(`\nPatching ${patches.length.toLocaleString()} inventory rows...`);
  const BATCH = 100;
  let done = 0;
  for (let i = 0; i < patches.length; i += BATCH) {
    const results = await Promise.allSettled(
      patches.slice(i, i + BATCH).map(p => {
        const { id, ...fields } = p;
        return patchInventory(id, fields);
      })
    );
    results.forEach(r => { if (r.status === 'rejected') { errors++; console.error('PATCH error:', r.reason); } });
    done += BATCH;
    if (done % 5000 === 0) console.log(`  ${done.toLocaleString()} / ${patches.length.toLocaleString()} patched`);
  }
  console.log(`Patching complete — ${errors} errors`);

  // Write history in batches of 500
  console.log(`\nWriting ${historyRows.length.toLocaleString()} price history snapshots...`);
  const HIST_BATCH = 500;
  for (let i = 0; i < historyRows.length; i += HIST_BATCH) {
    await insertPriceHistory(historyRows.slice(i, i + HIST_BATCH));
  }
  console.log('History snapshots written');

  // Write the weekly portfolio-value snapshot (non-fatal if the table is missing)
  try {
    await insertPortfolioHistory(portfolio, today);
  } catch (e) {
    console.error('Portfolio snapshot skipped:', e.message);
  }

  // Purge on first Monday of the month (day 1–7)
  if (new Date().getDate() <= 7) {
    await purgeOldHistory();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Complete in ${elapsed}s — ${matched.toLocaleString()} updated, ${skipped.toLocaleString()} skipped, ${errors} errors ===\n`);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
