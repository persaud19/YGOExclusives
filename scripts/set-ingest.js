// scripts/set-ingest.js
// Runs via GitHub Actions on a weekly schedule.
//
// Checks YGOPRODeck for sets not yet in the `sets` table.
// For each new set: inserts rows into `sets`, `cards`, and `card_inventory`.
//
// SAFETY GUARANTEE:
//   - Every insert uses resolution=ignore-duplicates — existing rows are NEVER modified.
//   - qty columns (qty_fe_nm, qty_fe_lp, qty_fe_mp, qty_un_nm, qty_un_lp, qty_un_mp,
//     qty_binder_fe_nm, qty_binder_un_nm) are ONLY ever written on brand-new rows, set to 0.
//   - No UPDATE, PATCH, or DELETE is ever called.
//   - Safe to re-run at any time — duplicate inserts are silently skipped.

const { randomUUID } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const YGOPRO_BASE = 'https://db.ygoprodeck.com/api/v7';

const HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
};

// Sets released in 2020+ that still had unlimited print waves.
// Add to this list as needed when new exceptions are confirmed.
const UNLIMITED_EXCEPTIONS = new Set(['POTE', 'ETCO']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Parse "MM/DD/YYYY" or "YYYY-MM-DD" → year string
function parseYear(tcgDate) {
  if (!tcgDate) return null;
  if (tcgDate.includes('/')) return tcgDate.split('/')[2] || null; // MM/DD/YYYY
  return tcgDate.split('-')[0] || null;                            // YYYY-MM-DD
}

// Pre-2020 sets had unlimited print waves by default; 2020+ are 1st edition only.
function inferHasUnlimited(setCode, year) {
  if (UNLIMITED_EXCEPTIONS.has(setCode)) return true;
  const yr = parseInt(year, 10);
  if (isNaN(yr)) return false; // unknown year → safest default is 1st-only
  return yr < 2020;
}

// ── YGOPRODeck fetches ────────────────────────────────────────────────────────

async function fetchYGOSetList() {
  console.log('Fetching YGOPRODeck set list...');
  const res = await fetch(`${YGOPRO_BASE}/cardsets.php`);
  if (!res.ok) throw new Error(`cardsets.php failed: ${res.status}`);
  return res.json(); // [{set_name, set_code, num_of_cards, tcg_date}, ...]
}

async function fetchCardsInSet(setName) {
  const url = `${YGOPRO_BASE}/cardinfo.php?cardset=${encodeURIComponent(setName)}&tcgplayer_data=true`;
  const res = await fetch(url);
  if (res.status === 400) return []; // set exists in list but no TCG cards
  if (!res.ok) throw new Error(`cardinfo.php?cardset="${setName}" failed: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// ── Supabase reads ────────────────────────────────────────────────────────────

async function fetchAllSetCodes() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sets?select=set_code&limit=10000`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`sets fetch failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return new Set(rows.map(r => r.set_code));
}

// Returns Map<card_number, uuid>
async function fetchAllCardNumbers() {
  const all = [];
  let offset = 0;
  const PAGE = 5000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cards?select=card_number,id&limit=${PAGE}&offset=${offset}`,
      { headers: HEADERS }
    );
    if (!res.ok) throw new Error(`cards fetch failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return new Map(all.map(r => [r.card_number, r.id]));
}

// Returns Set of "card_number|rarity" strings
async function fetchAllInventoryKeys() {
  const all = [];
  let offset = 0;
  const PAGE = 5000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/card_inventory?select=card_number,rarity&limit=${PAGE}&offset=${offset}`,
      { headers: HEADERS }
    );
    if (!res.ok) throw new Error(`card_inventory fetch failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return new Set(all.map(r => `${r.card_number}|${r.rarity}`));
}

// ── Supabase writes ───────────────────────────────────────────────────────────

// INSERT with ignore-duplicates — safe to call even if some rows already exist.
// NEVER modifies existing rows.
async function insertIgnore(table, rows) {
  if (rows.length === 0) return;
  const BATCH = 250;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...HEADERS, 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`INSERT ${table} failed: ${res.status} ${body}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  const today = new Date().toISOString().split('T')[0];
  console.log(`\n=== Set Ingestion: ${today} ===\n`);

  // 1. Load YGOPRODeck set list
  const ygoSets = await fetchYGOSetList();
  console.log(`YGOPRODeck has ${ygoSets.length} sets`);

  // 2. Load existing DB state
  console.log('Loading existing sets from DB...');
  const existingSetCodes = await fetchAllSetCodes();
  console.log(`DB has ${existingSetCodes.size} sets`);

  const newSets = ygoSets.filter(s => {
    const code = s.set_code?.trim();
    return code && !existingSetCodes.has(code);
  });

  console.log(`\n${newSets.length} new set(s) to ingest`);
  if (newSets.length === 0) {
    console.log('Nothing to do.\n');
    return;
  }

  console.log('Loading existing card numbers from DB...');
  const cardNumberToId = await fetchAllCardNumbers();
  console.log(`DB has ${cardNumberToId.size} unique card_numbers`);

  console.log('Loading existing card_inventory keys from DB...');
  const existingInvKeys = await fetchAllInventoryKeys();
  console.log(`DB has ${existingInvKeys.size} card_inventory rows`);

  // 3. Collect all rows to insert
  const setRows  = [];
  const cardRows = [];
  const invRows  = [];

  for (const ygoSet of newSets) {
    const setCode = ygoSet.set_code?.trim();
    const setName = ygoSet.set_name?.trim();
    const year    = parseYear(ygoSet.tcg_date);

    console.log(`\n→ ${setCode} — "${setName}" (${year ?? 'unknown year'})`);

    // Respect YGOPRODeck rate limits between set requests
    await sleep(300);

    let setCards;
    try {
      setCards = await fetchCardsInSet(setName);
    } catch (err) {
      console.error(`  ERROR fetching cards: ${err.message} — skipping set`);
      continue;
    }

    if (setCards.length === 0) {
      console.log(`  No TCG cards found — skipping`);
      continue;
    }

    const hasUnlimited = inferHasUnlimited(setCode, year);

    setRows.push({
      set_code:      setCode,
      set_name:      setName,
      year:          year,
      has_first_ed:  true,
      has_unlimited: hasUnlimited,
    });

    let newCardCount = 0;
    let newInvCount  = 0;

    for (const card of setCards) {
      const apiId    = String(card.id);
      const cardName = card.name;

      // Filter to only entries for this specific set
      const setEntries = (card.card_sets || []).filter(
        s => s.set_code?.trim() === setCode
      );

      for (const entry of setEntries) {
        const cardNumber = entry.set_code?.trim();   // e.g. "BLMM-EN001" — YGOPRODeck uses set_code for the card-level code
        const rarity     = entry.set_rarity?.trim();
        if (!cardNumber || !rarity) continue;

        // Insert card identity row if this card_number is new
        if (!cardNumberToId.has(cardNumber)) {
          const newId = randomUUID();
          cardRows.push({
            id:          newId,
            card_number: cardNumber,
            card_name:   cardName,
            set_name:    setName,
            year:        year,
            api_id:      apiId,
          });
          cardNumberToId.set(cardNumber, newId); // track so we don't re-add within this run
          newCardCount++;
        }

        // Insert card_inventory row if this (card_number, rarity) pair is new
        const invKey = `${cardNumber}|${rarity}`;
        if (!existingInvKeys.has(invKey)) {
          const cardId = cardNumberToId.get(cardNumber);
          invRows.push({
            id:              randomUUID(),
            card_id:         cardId,
            card_number:     cardNumber,
            card_name:       cardName,
            set_name:        setName,
            rarity:          rarity,
            // ── All qty fields explicitly zero ────────────────────────────────
            // These are the ONLY qty writes in this script.
            // Existing rows are never touched (ignore-duplicates insert).
            qty_fe_nm:       0,
            qty_fe_lp:       0,
            qty_fe_mp:       0,
            qty_un_nm:       0,
            qty_un_lp:       0,
            qty_un_mp:       0,
            qty_binder_fe_nm: 0,
            qty_binder_un_nm: 0,
            // ─────────────────────────────────────────────────────────────────
            listed:          false,
            needs_review:    false,
          });
          existingInvKeys.add(invKey);
          newInvCount++;
        }
      }
    }

    console.log(`  ${setCards.length} YGO cards → ${newCardCount} new card rows, ${newInvCount} new inventory rows`);
  }

  // 4. Write to DB — sets first, then cards, then inventory
  console.log(`\nInserting ${setRows.length} set row(s)...`);
  await insertIgnore('sets', setRows);

  console.log(`Inserting ${cardRows.length} card row(s)...`);
  await insertIgnore('cards', cardRows);

  console.log(`Inserting ${invRows.length} card_inventory row(s)...`);
  await insertIgnore('card_inventory', invRows);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== Done in ${elapsed}s — ${setRows.length} sets, ${cardRows.length} cards, ${invRows.length} inventory rows added ===\n`);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
