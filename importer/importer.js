// ─── importer.js — CSV Import Logic ──────────────────────────────────────────

// ─── Rarity normalisation map ─────────────────────────────────────────────────
const RARITY_NORMALIZE = {
  "collectors rare":                    "Collector's Rare",
  "collector's rare":                   "Collector's Rare",
  "quarter centry secret rare":         "Quarter Century Secret Rare",
  "quarter century secret rare":        "Quarter Century Secret Rare",
  "ghost":                              "Ghost Rare",
  "ghost rare":                         "Ghost Rare",
  "common":                             "Common",
  "rare":                               "Rare",
  "short print":                        "Short Print",
  "super rare":                         "Super Rare",
  "ultra rare":                         "Ultra Rare",
  "secret rare":                        "Secret Rare",
  "ultimate rare":                      "Ultimate Rare",
  "mosaic rare":                        "Mosaic Rare",
  "starfoil rare":                      "Starfoil Rare",
  "shatterfoil rare":                   "Shatterfoil Rare",
  "alternate rare":                     "Alternate Rare",
  "gold rare":                          "Gold Rare",
  "gold secret rare":                   "Gold Secret Rare",
  "ghost/gold rare":                    "Ghost/Gold Rare",
  "prismatic secret rare":              "Prismatic Secret Rare",
  "starlight rare":                     "Starlight Rare",
  "10000 secret rare":                  "10000 Secret Rare",
  "duel terminal normal parallel rare": "Duel Terminal Normal Parallel Rare",
  "duel terminal ultra parallel rare":  "Duel Terminal Ultra Parallel Rare",
  "platinum rare":                      "Platinum Rare",
  "platinum secret rare":               "Platinum Secret Rare",
  "premium gold rare":                  "Premium Gold Rare",
  "pharaoh's rare":                     "Pharaoh's Rare",
  "pharaoh's rare":                     "Pharaoh's Rare",
  "prismatic collector's rare":         "Prismatic Collector's Rare",
  "prismatic ultimate rare":            "Prismatic Ultimate Rare",
};

function normalizeRarity(raw) {
  if (!raw) return '';
  const key = raw.trim().toLowerCase();
  return RARITY_NORMALIZE[key] || raw.trim();
}

// ─── Detect RA01 set ──────────────────────────────────────────────────────────
// Card numbers like RA01-EN001, RA02-EN001 etc.
function isRA01Set(cardNumber) {
  return /^RA\d{2}-/i.test(cardNumber);
}

// ─── CSV parser (handles quoted fields with commas inside) ────────────────────
function parseCSV(text) {
  const lines = [];
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let i = 0;

  while (i < raw.length) {
    const row = [];
    while (i < raw.length && raw[i] !== '\n') {
      if (raw[i] === '"') {
        // quoted field
        i++;
        let cell = '';
        while (i < raw.length) {
          if (raw[i] === '"') {
            if (raw[i+1] === '"') { cell += '"'; i += 2; }
            else { i++; break; }
          } else {
            cell += raw[i++];
          }
        }
        row.push(cell);
        if (raw[i] === ',') i++;
      } else {
        let cell = '';
        while (i < raw.length && raw[i] !== ',' && raw[i] !== '\n') {
          cell += raw[i++];
        }
        row.push(cell);
        if (raw[i] === ',') i++;
      }
    }
    if (raw[i] === '\n') i++;
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      lines.push(row);
    }
  }
  return lines;
}

// ─── Main processing function ─────────────────────────────────────────────────
function processCSV(text) {
  const lines = parseCSV(text);
  if (!lines.length) return [];

  const headers = lines[0].map(h => h.trim());
  const dataLines = lines.slice(1);

  // Column indices (case-insensitive)
  const col = name => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const iCardNum     = col('Card #');
  const iCardName    = col('Card Name');
  const iRarity      = col('Rarity');
  const iSetName     = col('Set Name');
  const iYear        = col('Year');
  const iFe_NM       = col('First Edition - NM');
  const iFe_LP       = col('First Edition - LP');
  const iFe_MP       = col('First Edition - MP');
  const iUn_NM       = col('Unlimited - NM');
  const iUn_LP       = col('Unlimited - LP');
  const iUn_MP       = col('Unlimited - MP');
  const iLocation    = col('Location');
  const iSecRarity   = col('Secondary Rarity');
  const iTotalQty    = col('Total Quanity');  // note: typo in original CSV header
  const iListed      = col('Listed?');
  const iHR          = col('Higher Rarity?');

  const g = (row, idx) => (idx >= 0 && idx < row.length ? row[idx] : '').trim();
  const num = v => { const n = parseInt(v, 10); return isNaN(n) ? 0 : Math.max(0, n); };

  const outputRows = [];
  const errors = [];

  dataLines.forEach((row, lineIdx) => {
    if (row.every(c => !c.trim())) return; // skip blank rows

    const cardNumber = g(row, iCardNum);
    const cardName   = g(row, iCardName);

    if (!cardNumber && !cardName) return;

    const rawRarity  = g(row, iRarity);
    const setName    = g(row, iSetName);
    const year       = g(row, iYear);
    const rawLoc     = g(row, iLocation) || 'Basement Box';
    const location   = rawLoc || 'Basement Box';
    const listedRaw  = g(row, iListed).toLowerCase();
    const listed     = listedRaw === 'yes' || listedRaw === 'true' || listedRaw === '1';
    const secRarity  = iSecRarity >= 0 ? g(row, iSecRarity) : '';
    const totalQty   = num(iTotalQty >= 0 ? g(row, iTotalQty) : '0');

    const fe_nm  = num(g(row, iFe_NM));
    const fe_lp  = num(g(row, iFe_LP));
    const fe_mp  = num(g(row, iFe_MP));
    let   un_nm  = num(g(row, iUn_NM));
    const un_lp  = num(g(row, iUn_LP));
    const un_mp  = num(g(row, iUn_MP));

    // Rule 4: if no edition breakdown, put total in un_nm
    const hasEditionData = fe_nm || fe_lp || fe_mp || un_nm || un_lp || un_mp;
    if (!hasEditionData && totalQty > 0) {
      un_nm = totalQty;
    }

    // ─── RA01 sets: expand each semicolon-separated rarity to its own row ──────
    if (isRA01Set(cardNumber)) {
      const rarities = rawRarity.split(';').map(r => normalizeRarity(r)).filter(Boolean);
      if (!rarities.length) rarities.push('');

      rarities.forEach((rarity, ri) => {
        const id = makeId(cardNumber, rarity, ri);
        outputRows.push({
          id,
          card_number:  cardNumber,
          card_name:    cardName,
          rarity,
          set_name:     setName,
          year,
          location,
          listed,
          fe_nm: 0, fe_lp: 0, fe_mp: 0,
          un_nm: 0, un_lp: 0, un_mp: 0,
          higher_rarity: '',
          hr_qty_nm: 0, hr_qty_lp: 0,
          added_at:   new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      });
      return;
    }

    // ─── All other sets ────────────────────────────────────────────────────────
    let primaryRarity = rawRarity;
    let higherRarity  = '';

    const rarityParts = rawRarity.split(';').map(r => r.trim()).filter(Boolean);
    if (rarityParts.length >= 2) {
      primaryRarity = normalizeRarity(rarityParts[0]);
      higherRarity  = normalizeRarity(rarityParts[1]);
    } else {
      primaryRarity = normalizeRarity(rawRarity);
    }

    // Rule 6: Secondary Rarity column overrides semicolon-derived higher_rarity
    if (secRarity) {
      higherRarity = normalizeRarity(secRarity);
    }

    const id = makeId(cardNumber, primaryRarity, 0);
    outputRows.push({
      id,
      card_number:  cardNumber,
      card_name:    cardName,
      rarity:       primaryRarity,
      set_name:     setName,
      year,
      location,
      listed,
      fe_nm, fe_lp, fe_mp,
      un_nm, un_lp, un_mp,
      higher_rarity: higherRarity,
      hr_qty_nm: 0,
      hr_qty_lp: 0,
      added_at:   new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  return { rows: outputRows, errors };
}

// ─── Generate a stable unique ID ──────────────────────────────────────────────
function makeId(cardNumber, rarity, index) {
  const clean = s => String(s || '').replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const base = `${clean(cardNumber)}-${clean(rarity)}`;
  return index > 0 ? `${base}-${index}` : base;
}

// ─── Get unique set codes from processed rows ─────────────────────────────────
function getUniqueSets(rows) {
  const sets = new Set(rows.map(r => r.card_number?.split('-')[0]).filter(Boolean));
  return [...sets].sort();
}

// ─── Batch upsert to Supabase ─────────────────────────────────────────────────
async function importBatch(rows, batchSize, onProgress) {
  let imported = 0;
  let errorCount = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      await upsertCardsBatch(batch);
      imported += batch.length;
    } catch (e) {
      console.error('Batch error:', e, batch.slice(0,3));
      errorCount += batch.length;
    }
    onProgress(i + batch.length, rows.length, imported, errorCount);
    // Tiny yield to keep UI responsive
    await new Promise(r => setTimeout(r, 0));
  }

  return { imported, errorCount };
}
