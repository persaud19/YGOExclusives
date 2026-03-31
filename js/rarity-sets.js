// ── Rarity Sets Inventory ────────────────────────────────────────────────────
// Handles RA01, RA02, RA03... sets (25th Anniversary Rarity Collection, etc.)
// Each card has multiple rarities as separate rows — displayed horizontally.

const RA_PATTERN       = /^RA\d{2}-/i;
const RS_NORMAL_RARITY = new Set(['Common','Rare','Short Print','Super Rare','Ultra Rare','Secret Rare']);

// Preferred display order for rarity columns
const RS_RARITY_ORDER = [
  'Super Rare','Ultra Rare','Secret Rare',
  'Platinum Secret Rare','Prismatic Ultimate Rare',
  "Prismatic Collector's Rare",'Quarter Century Secret Rare'
];

// CSV column header → canonical rarity name (handles typos in source files)
const RS_CSV_MAP = {
  'Super Rare'                   : 'Super Rare',
  'Ultra Rare'                   : 'Ultra Rare',
  'Secret Rare'                  : 'Secret Rare',
  'Platinum Secret Rare'         : 'Platinum Secret Rare',
  'Prismatic Ultimate Rare'      : 'Prismatic Ultimate Rare',
  "Prismatic Collector's Rare"   : "Prismatic Collector's Rare",
  'Prismatic Collectors Rare'    : "Prismatic Collector's Rare",
  'Quarter Century Secret Rare'  : 'Quarter Century Secret Rare',
  'Quarter Centry Secret Rare'   : 'Quarter Century Secret Rare',
};

let rsCurrentSet  = null;
let rsCards       = [];   // flat array of card rows from DB
let rsRarities    = [];   // ordered rarity list for current set
let rsInitDone    = false;

// ── Init ─────────────────────────────────────────────────────────────────────
async function initRaritySets() {
  if (rsInitDone) return;
  rsInitDone = true;

  await loadRaritySetList();

  document.getElementById('rs-set-select').addEventListener('change', e => {
    if (e.target.value) loadRaritySetCards(e.target.value);
    else document.getElementById('rs-table-wrap').innerHTML = '';
  });

  document.getElementById('rs-csv-input').addEventListener('change', e => {
    if (e.target.files[0]) handleRsCSVImport(e.target.files[0]);
    e.target.value = '';
  });
}

// ── Load set list ─────────────────────────────────────────────────────────────
async function loadRaritySetList() {
  const sel = document.getElementById('rs-set-select');
  sel.innerHTML = '<option value="">— Select a Rarity Collection set —</option>';

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cards?card_number=ilike.RA*&select=set_name&order=set_name`,
      { headers: DB_HEADERS }
    );
    if (!res.ok) throw new Error(await res.text());
    const rows  = await res.json();
    const sets  = [...new Set(rows.map(r => r.set_name).filter(Boolean))].sort();

    sets.forEach(s => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = s;
      sel.appendChild(opt);
    });

    if (sets.length === 1) {
      sel.value = sets[0];
      loadRaritySetCards(sets[0]);
    }
  } catch (err) {
    console.error('loadRaritySetList:', err);
  }
}

// ── Load cards for selected set ───────────────────────────────────────────────
async function loadRaritySetCards(setName) {
  rsCurrentSet = setName;
  const wrap   = document.getElementById('rs-table-wrap');
  wrap.innerHTML = '<div class="rs-loading">Loading cards…</div>';

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cards?set_name=eq.${encodeURIComponent(setName)}&card_number=ilike.RA*&select=id,card_number,card_name,rarity,un_nm,hr_qty_nm&order=card_number,rarity`,
      { headers: DB_HEADERS }
    );
    if (!res.ok) throw new Error(await res.text());
    rsCards = await res.json();

    // Build ordered rarity list for this set
    const present = new Set(rsCards.map(c => c.rarity));
    rsRarities    = RS_RARITY_ORDER.filter(r => present.has(r));
    // Append any future rarities not yet in our order list
    present.forEach(r => { if (!rsRarities.includes(r)) rsRarities.push(r); });

    renderRarityTable();
  } catch (err) {
    wrap.innerHTML = `<div style="color:var(--red);padding:20px">Error: ${err.message}</div>`;
  }
}

// ── Render horizontal table ───────────────────────────────────────────────────
function renderRarityTable() {
  const wrap     = document.getElementById('rs-table-wrap');
  const normalR  = rsRarities.filter(r =>  RS_NORMAL_RARITY.has(r));
  const hrR      = rsRarities.filter(r => !RS_NORMAL_RARITY.has(r));

  // Group cards by card_number
  const groups   = {};
  const order    = [];
  for (const c of rsCards) {
    if (!groups[c.card_number]) {
      groups[c.card_number] = { name: c.card_name, byRarity: {} };
      order.push(c.card_number);
    }
    groups[c.card_number].byRarity[c.rarity] = c;
  }

  if (!order.length) {
    wrap.innerHTML = '<div class="rs-loading">No cards found for this set.</div>';
    return;
  }

  /* ── Header ── */
  const thead = `
    <thead>
      <tr class="rs-group-row">
        <th rowspan="2" class="rs-th-num">Card #</th>
        <th rowspan="2" class="rs-th-name">Card Name</th>
        ${normalR.length ? `<th colspan="${normalR.length}" class="rs-group-label">Normal Rarities</th>` : ''}
        ${hrR.length     ? `<th colspan="${hrR.length}"     class="rs-group-label rs-group-hr">High Rarities</th>` : ''}
        <th rowspan="2" class="rs-th-total">Total</th>
      </tr>
      <tr>
        ${normalR.map((r,i) => `<th class="rs-th-rarity${i===0?' rs-col-sep':''}">${rsAbbr(r)}</th>`).join('')}
        ${hrR.map((r,i)     => `<th class="rs-th-rarity rs-th-hr${i===0?' rs-col-hr-sep':''}">${rsAbbr(r)}</th>`).join('')}
      </tr>
    </thead>`;

  /* ── Body ── */
  let ci = 0;
  const rows = order.map(cardNum => {
    const g   = groups[cardNum];
    let total = 0;
    let cells = '';

    rsRarities.forEach((r, idx) => {
      const card   = g.byRarity[r];
      const isHR   = !RS_NORMAL_RARITY.has(r);
      const isSep  = (idx === 0) ? 'rs-col-sep' : (idx === normalR.length ? 'rs-col-hr-sep' : '');
      const field  = isHR ? 'hr_qty_nm' : 'un_nm';
      const qty    = card ? (Number(card[field]) || 0) : null;
      if (qty !== null) total += qty;
      cells += buildRsQtyCell(card, field, qty, idx, isHR, isSep);
    });

    return `
      <tr data-cardnum="${cardNum}">
        <td class="rs-td-num cinzel">${cardNum}</td>
        <td class="rs-td-name">${g.name || '—'}</td>
        ${cells}
        <td class="rs-td-total" id="rs-tot-${cardNum}">${total}</td>
      </tr>`;
  });

  wrap.innerHTML = `
    <table class="rs-table">
      ${thead}
      <tbody>${rows.join('')}</tbody>
    </table>`;

  // Wire events
  wrap.querySelectorAll('.rs-qty-input').forEach(wireRsInput);
}

function buildRsQtyCell(card, field, qty, colIdx, isHR, sepClass) {
  if (!card) {
    return `<td class="rs-qty-cell rs-qty-na ${sepClass}"><span class="rs-na">—</span></td>`;
  }
  return `
    <td class="rs-qty-cell ${sepClass}${isHR ? ' rs-hr-cell' : ''}">
      <input class="rs-qty-input${isHR ? ' rs-qty-hr' : ''}"
             type="text" inputmode="numeric" pattern="[0-9]*"
             value="${qty}"
             data-id="${card.id}"
             data-field="${field}"
             data-col="${colIdx}">
    </td>`;
}

// Abbreviated column header labels
function rsAbbr(r) {
  return r
    .replace('Quarter Century Secret Rare', 'QC Secret')
    .replace('Platinum Secret Rare',        'Plat Secret')
    .replace("Prismatic Collector's Rare",  'Pris Collector')
    .replace('Prismatic Ultimate Rare',     'Pris Ultimate')
    .replace(' Rare', '');
}

// ── Input wiring ──────────────────────────────────────────────────────────────
function wireRsInput(input) {
  let timer;

  input.addEventListener('focus', () => input.select());

  input.addEventListener('input', () => {
    updateRowTotal(input);
    clearTimeout(timer);
    timer = setTimeout(() => saveRsCell(input), 800);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const col    = input.dataset.col;
      const nextTr = input.closest('tr').nextElementSibling;
      if (nextTr) {
        const next = nextTr.querySelector(`.rs-qty-input[data-col="${col}"]`);
        if (next) next.focus();
      }
    }
  });
}

function updateRowTotal(input) {
  const tr    = input.closest('tr');
  const num   = tr.dataset.cardnum;
  let total   = 0;
  tr.querySelectorAll('.rs-qty-input').forEach(i => { total += parseInt(i.value) || 0; });
  const el = document.getElementById(`rs-tot-${num}`);
  if (el) el.textContent = total;
}

// ── Save single cell ──────────────────────────────────────────────────────────
async function saveRsCell(input) {
  const id    = input.dataset.id;
  const field = input.dataset.field;
  const val   = Math.max(0, parseInt(input.value) || 0);
  input.value = val;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cards?id=eq.${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: DB_HEADERS, body: JSON.stringify({ [field]: val }) }
    );
    if (!res.ok) throw new Error(await res.text());
    input.classList.add('rs-saved');
    setTimeout(() => input.classList.remove('rs-saved'), 900);
  } catch (err) {
    input.classList.add('rs-error');
    setTimeout(() => input.classList.remove('rs-error'), 2000);
    console.error('RS save failed:', id, err.message);
  }
}

// ── CSV Import ────────────────────────────────────────────────────────────────
async function handleRsCSVImport(file) {
  const statusEl = document.getElementById('rs-import-status');
  statusEl.textContent = 'Reading file…';
  statusEl.style.color = 'var(--gold)';

  try {
    const text    = await file.text();
    const lines   = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error('CSV has no data rows');

    const headers    = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const cardNumIdx = headers.findIndex(h => /^card\s*#?$/i.test(h.replace('#','').trim()) || h === 'Card #');

    if (cardNumIdx === -1) throw new Error('CSV must have a "Card #" column');

    // Map col index → canonical rarity name
    const rarityAtCol = {};
    headers.forEach((h, i) => {
      const mapped = RS_CSV_MAP[h.trim()];
      if (mapped) rarityAtCol[i] = mapped;
    });

    // Lookup: "CARDNUM|Rarity" → card row
    const lookup = {};
    rsCards.forEach(c => { lookup[`${c.card_number}|${c.rarity}`] = c; });

    const patches = [];
    let skipped   = 0;

    for (let i = 1; i < lines.length; i++) {
      const vals    = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const cardNum = (vals[cardNumIdx] || '').toUpperCase().trim();
      if (!cardNum || !RA_PATTERN.test(cardNum)) continue;

      for (const [colIdx, rarity] of Object.entries(rarityAtCol)) {
        const raw = vals[colIdx];
        // Skip empty, dashes, or non-numeric
        if (!raw || raw === '—' || raw === '-' || isNaN(parseInt(raw))) { skipped++; continue; }
        const qty  = parseInt(raw);
        const card = lookup[`${cardNum}|${rarity}`];
        if (!card) { skipped++; continue; }
        const field = RS_NORMAL_RARITY.has(rarity) ? 'un_nm' : 'hr_qty_nm';
        patches.push({ id: card.id, field, qty });
      }
    }

    if (!patches.length) {
      statusEl.textContent = 'No matching cards found — check set is loaded';
      statusEl.style.color = 'var(--yellow)';
      return;
    }

    statusEl.textContent = `Saving ${patches.length} values…`;

    let done = 0;
    for (let i = 0; i < patches.length; i += 100) {
      const batch = patches.slice(i, i + 100);
      await Promise.allSettled(batch.map(p =>
        fetch(`${SUPABASE_URL}/rest/v1/cards?id=eq.${encodeURIComponent(p.id)}`,
          { method: 'PATCH', headers: DB_HEADERS, body: JSON.stringify({ [p.field]: p.qty }) })
      ));
      done += batch.length;
      statusEl.textContent = `Saving… ${done}/${patches.length}`;
    }

    statusEl.textContent = `Done — ${patches.length} values imported${skipped ? `, ${skipped} skipped` : ''}`;
    statusEl.style.color  = 'var(--green)';

    // Reload table to reflect new values
    await loadRaritySetCards(rsCurrentSet);

  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.color  = 'var(--red)';
  }
}
