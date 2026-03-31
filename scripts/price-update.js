// scripts/price-update.js
// Runs via GitHub Actions on the 1st and 15th of every month.
// - Fetches rarity-specific TCG prices from YGOPRODeck by card number
// - Prices high rarity cards using card name + HR type lookup
// - Patches tcg_market_price and hr_tcg_price on all cards
// - Writes a price_history snapshot for trend tracking
// - Purges history older than 3 years (on 1st of month only)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Step 1: Fetch all YGOPRODeck cards ───────────────────────────────────────
async function fetchYGOCards() {
  console.log('Fetching YGOPRODeck card database...');
  const res = await fetch('https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes');
  if (!res.ok) throw new Error(`YGOPRODeck fetch failed: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

function buildPriceMaps(ygoCards) {
  const bySetCode    = new Map(); // "lob-en001"                   → { price, name, apiId }
  const byNameRarity = new Map(); // "blue-eyes white dragon|ultra rare" → price

  for (const card of ygoCards) {
    for (const set of (card.card_sets || [])) {
      const code  = set.set_code?.toLowerCase().trim();
      const price = parseFloat(set.set_price) || 0;

      if (code && price > 0 && !bySetCode.has(code)) {
        bySetCode.set(code, { price, name: card.name, apiId: card.id });
      }

      if (price > 0 && set.set_rarity) {
        const nrKey = `${card.name.toLowerCase().trim()}|${set.set_rarity.toLowerCase().trim()}`;
        if (!byNameRarity.has(nrKey)) byNameRarity.set(nrKey, price);
      }
    }
  }

  console.log(`Price maps built: ${bySetCode.size.toLocaleString()} set codes, ${byNameRarity.size.toLocaleString()} name+rarity entries`);
  return { bySetCode, byNameRarity };
}

// ── Step 2: Fetch all DB cards ────────────────────────────────────────────────
async function fetchAllDBCards() {
  console.log('Fetching all cards from Supabase...');
  const allCards = [];
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cards?select=id,card_number,card_name,rarity,higher_rarity&limit=${PAGE}&offset=${offset}`,
      { headers: HEADERS }
    );
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    allCards.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`Loaded ${allCards.length.toLocaleString()} cards from DB`);
  return allCards;
}

// ── Step 3: PATCH prices ──────────────────────────────────────────────────────
async function patchCard(cardId, fields) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cards?id=eq.${cardId}`,
    { method: 'PATCH', headers: HEADERS, body: JSON.stringify(fields) }
  );
  if (!res.ok) throw new Error(await res.text());
}

// ── Step 4: Write price history ───────────────────────────────────────────────
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

// ── Step 5: Purge old history (runs on 1st only) ──────────────────────────────
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
  const today = new Date().toISOString().split('T')[0];
  console.log(`\n=== Price Update: ${today} ===\n`);

  const ygoCards = await fetchYGOCards();
  console.log(`Loaded ${ygoCards.length.toLocaleString()} cards from YGOPRODeck`);

  const { bySetCode, byNameRarity } = buildPriceMaps(ygoCards);
  const dbCards = await fetchAllDBCards();

  // Build patches and history rows
  let matched = 0, hrMatched = 0, skipped = 0, errors = 0;
  const patches      = [];
  const historyRows  = [];

  for (const card of dbCards) {
    const codeKey  = (card.card_number || '').toLowerCase().trim();
    const nameKey  = (card.card_name   || '').toLowerCase().trim();
    const entry    = bySetCode.get(codeKey);
    const tcgPrice = entry?.price || 0;

    const patch = {};
    if (tcgPrice > 0) {
      patch.tcg_market_price = tcgPrice;
      matched++;
    } else {
      skipped++;
    }

    // HR pricing: card name + higher_rarity type
    let hrPrice = 0;
    if (card.higher_rarity) {
      const hrKey = `${nameKey}|${card.higher_rarity.toLowerCase().trim()}`;
      hrPrice = byNameRarity.get(hrKey) || 0;
      if (hrPrice > 0) {
        patch.hr_tcg_price = +hrPrice.toFixed(2);
        hrMatched++;
      }
    }

    if (Object.keys(patch).length > 0) {
      patches.push({ id: card.id, ...patch });
    }

    // Always snapshot — even zero prices track that the card exists
    historyRows.push({
      card_id:       card.id,
      card_number:   card.card_number,
      card_name:     card.card_name,
      rarity:        card.rarity,
      tcg_price:     tcgPrice || null,
      hr_tcg_price:  hrPrice  || null,
      snapshot_date: today,
    });
  }

  console.log(`\nMatched: ${matched.toLocaleString()} | HR matched: ${hrMatched.toLocaleString()} | No match: ${skipped.toLocaleString()}`);

  // PATCH in batches of 100 concurrent
  console.log(`\nPatching ${patches.length.toLocaleString()} cards...`);
  const BATCH = 100;
  let done = 0;
  for (let i = 0; i < patches.length; i += BATCH) {
    const batch = patches.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(p => { const { id, ...fields } = p; return patchCard(id, fields); })
    );
    results.forEach(r => { if (r.status === 'rejected') { errors++; console.error('PATCH error:', r.reason); } });
    done += batch.length;
    if (done % 5000 === 0) console.log(`  ${done.toLocaleString()} / ${patches.length.toLocaleString()} patched`);
  }
  console.log(`Patching complete — ${errors} errors`);

  // Insert price history in batches of 500
  console.log(`\nWriting ${historyRows.length.toLocaleString()} price history snapshots...`);
  const HIST_BATCH = 500;
  for (let i = 0; i < historyRows.length; i += HIST_BATCH) {
    await insertPriceHistory(historyRows.slice(i, i + HIST_BATCH));
  }
  console.log('History snapshots written');

  // Purge on 1st of month only
  if (new Date().getDate() === 1) {
    await purgeOldHistory();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Complete in ${elapsed}s — ${matched.toLocaleString()} updated, ${skipped.toLocaleString()} skipped, ${errors} errors ===\n`);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
