// ─── acquisitions.js — Card Acquisition Logging ──────────────────────────────

let acqInitialised = false;
let acqImportRows  = [];

// Rarities treated as normal (non-High-Rarity) cards
const REGULAR_RARITIES = new Set([
  'Common', 'Rare', 'Short Print', 'Super Rare', 'Ultra Rare', 'Secret Rare'
]);

// ── Source Dropdown (localStorage-backed) ─────────────────────────────────────
const ACQ_SOURCES_KEY     = 'acq_sources';
const ACQ_DEFAULT_SOURCES = ['eBay', 'Local Card Shop', 'Facebook Marketplace', 'TCGPlayer', 'Cash'];

function initSourceDropdown() {
  const stored = JSON.parse(localStorage.getItem(ACQ_SOURCES_KEY) || '[]');
  const all    = [...new Set([...ACQ_DEFAULT_SOURCES, ...stored])];
  const dl     = document.getElementById('acq-source-list');
  if (!dl) return;
  dl.innerHTML = all.map(s => `<option value="${s}">`).join('');
}

function saveSourceIfNew(val) {
  if (!val) return;
  const stored = JSON.parse(localStorage.getItem(ACQ_SOURCES_KEY) || '[]');
  if (!ACQ_DEFAULT_SOURCES.includes(val) && !stored.includes(val)) {
    stored.push(val);
    localStorage.setItem(ACQ_SOURCES_KEY, JSON.stringify(stored));
    initSourceDropdown();
  }
}

// ── Card Number Auto-Lookup ────────────────────────────────────────────────────
function acqDebounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function lookupCardByNumber(raw) {
  const num    = raw.trim().toUpperCase();
  const status = document.getElementById('acq-lookup-status');
  if (!num || num.length < 4) { if (status) status.textContent = ''; return; }

  if (status) { status.textContent = '🔍'; status.style.color = 'var(--muted)'; }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cards?card_number=eq.${encodeURIComponent(num)}&select=card_name,rarity&limit=1`,
      { headers: DB_HEADERS }
    );
    if (!res.ok) throw new Error(res.status);
    const cards = await res.json();

    if (!cards.length) {
      if (status) { status.textContent = '✗ Not found'; status.style.color = 'var(--muted)'; }
      return;
    }

    const card = cards[0];

    // Auto-fill name (only if blank)
    const nameEl = document.getElementById('acq-card-name');
    if (nameEl && !nameEl.value) nameEl.value = card.card_name || '';

    // Auto-fill rarity
    if (card.rarity) {
      const rarSel = document.getElementById('acq-rarity');
      if (rarSel) rarSel.value = card.rarity;

      // Auto-set edition: non-standard rarity → High Rarity
      const edSel = document.getElementById('acq-edition');
      if (edSel && !REGULAR_RARITIES.has(card.rarity)) {
        edSel.value = 'High Rarity';
      }
    }

    if (status) { status.textContent = '✓ Found'; status.style.color = 'var(--green)'; }
  } catch (err) {
    console.warn('Card lookup failed:', err);
    if (status) status.textContent = '';
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────
function initAcquisitions() {
  if (acqInitialised) { loadRecentAcquisitions(); return; }
  acqInitialised = true;

  // Populate rarity select from config
  const rarSel = document.getElementById('acq-rarity');
  if (rarSel) {
    RARITIES.forEach(r => {
      const o = document.createElement('option');
      o.value = o.textContent = r;
      rarSel.appendChild(o);
    });
  }

  // Card number → auto-lookup (debounced 600ms)
  const cardNumInput = document.getElementById('acq-card-number');
  if (cardNumInput) {
    cardNumInput.addEventListener('input', acqDebounce(e => lookupCardByNumber(e.target.value), 600));
  }

  // Source dropdown
  initSourceDropdown();

  // Manual entry save
  document.getElementById('acq-save-btn').addEventListener('click', saveManualAcquisition);

  // Bulk import
  document.getElementById('acq-template-btn').addEventListener('click', downloadTemplate);
  document.getElementById('acq-file-input').addEventListener('change', handleCSVUpload);
  document.getElementById('acq-import-btn').addEventListener('click', runBulkImport);

  loadRecentAcquisitions();
}

// ── Template Download ──────────────────────────────────────────────────────────
function downloadTemplate() {
  const rows = [
    'Card #,Card Name,Rarity,Edition,Condition,Purchased From,Quantity,Price Per Card',
    'BLMM-EN001,Blue-Eyes White Dragon,Secret Rare,1st Edition,NM,Local Card Shop,3,4.50',
    'MAZE-EN010,Pot of Prosperity,Ultra Rare,Unlimited,LP,eBay,2,12.00',
  ];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'acquisition-template.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── CSV Upload ─────────────────────────────────────────────────────────────────
function handleCSVUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      acqImportRows = parseAcqCSV(ev.target.result);
      showImportPreview(acqImportRows);
    } catch (err) {
      setAcqStatus('acq-import-status', 'Parse error: ' + err.message, 'red');
    }
  };
  reader.readAsText(file);
}

function parseAcqCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV needs at least one data row');

  const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g, '_').replace('#', ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    if (!vals[0]) continue;

    const raw = {};
    rawHeaders.forEach((h, idx) => raw[h] = vals[idx] || '');

    rows.push({
      card_number:    (raw['card_'] || raw['card_number'] || '').toUpperCase().trim(),
      card_name:      raw['card_name']      || '',
      rarity:         raw['rarity']         || '',
      edition:        raw['edition']        || 'Unlimited',
      condition:      (raw['condition']     || 'NM').toUpperCase().trim(),
      purchased_from: raw['purchased_from'] || '',
      quantity:       Math.max(1, parseInt(raw['quantity'])          || 1),
      price_per_card: parseFloat(raw['price_per_card'])              || 0,
    });
  }
  return rows.filter(r => r.card_number);
}

function showImportPreview(rows) {
  const el  = document.getElementById('acq-preview');
  const btn = document.getElementById('acq-import-btn');

  if (!rows.length) {
    el.innerHTML = '<span style="color:var(--red)">No valid rows found.</span>';
    btn.disabled = true;
    return;
  }

  el.innerHTML = `
    <p style="color:var(--green);margin:0 0 10px"><strong>✓ ${rows.length} card${rows.length !== 1 ? 's' : ''} ready to import</strong></p>
    <div style="overflow-x:auto">
      <table class="acq-preview-table">
        <thead><tr>
          <th>Card #</th><th>Name</th><th>Rarity</th><th>Edition</th>
          <th>Cond</th><th>Source</th><th>Qty</th><th>$/Card</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td class="cinzel" style="color:var(--gold2)">${r.card_number}</td>
            <td>${r.card_name || '—'}</td>
            <td>${r.rarity   || '—'}</td>
            <td>${r.edition}</td>
            <td>${r.condition}</td>
            <td>${r.purchased_from || '—'}</td>
            <td style="text-align:center">${r.quantity}</td>
            <td style="text-align:right">$${Number(r.price_per_card).toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  btn.disabled = false;
}

// ── Bulk Import ────────────────────────────────────────────────────────────────
async function runBulkImport() {
  if (!acqImportRows.length) return;

  const btn    = document.getElementById('acq-import-btn');
  const fill   = document.getElementById('acq-bar-fill');
  const bar    = document.getElementById('acq-progress-bar');
  const status = document.getElementById('acq-import-status');

  btn.disabled    = true;
  bar.style.display = 'block';
  status.textContent = '';

  const today = new Date().toISOString().split('T')[0];
  let ok = 0, failed = 0;

  for (let i = 0; i < acqImportRows.length; i++) {
    fill.style.width = Math.round((i / acqImportRows.length) * 100) + '%';
    try {
      await processAcquisitionRow(acqImportRows[i], today);
      ok++;
    } catch (err) {
      console.error('Import row failed:', acqImportRows[i].card_number, err.message);
      failed++;
    }
  }

  fill.style.width = '100%';
  status.textContent = `Done — ${ok} imported, ${failed} failed`;
  status.style.color = failed > 0 ? 'var(--yellow)' : 'var(--green)';

  if (ok > 0) loadRecentAcquisitions();
}

// ── Core: process one acquisition row ─────────────────────────────────────────
async function processAcquisitionRow(row, date) {
  // 1. Look up card in Supabase by card_number
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cards?card_number=eq.${encodeURIComponent(row.card_number)}&select=id,fe_nm,fe_lp,fe_mp,un_nm,un_lp,un_mp,hr_qty_nm,hr_qty_lp&limit=1`,
    { headers: DB_HEADERS }
  );
  if (!res.ok) throw new Error(`DB lookup ${res.status}`);
  const cards = await res.json();
  if (!cards.length) throw new Error(`Card not found: ${row.card_number}`);
  const card = cards[0];

  // 2. Figure out which qty column to increment
  const field      = getQtyField(row.edition, row.condition);
  const currentQty = Number(card[field]) || 0;

  // 3. Increment inventory quantity
  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/cards?id=eq.${card.id}`,
    { method: 'PATCH', headers: DB_HEADERS, body: JSON.stringify({ [field]: currentQty + row.quantity }) }
  );
  if (!patchRes.ok) throw new Error(`PATCH failed: ${await patchRes.text()}`);

  // 4. Log acquisition record
  const logRes = await fetch(
    `${SUPABASE_URL}/rest/v1/acquisitions`,
    {
      method: 'POST',
      headers: { ...DB_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        card_id:         card.id,
        card_number:     row.card_number,
        card_name:       row.card_name      || null,
        rarity:          row.rarity         || null,
        edition:         row.edition,
        condition:       row.condition,
        purchased_from:  row.purchased_from || null,
        quantity:        row.quantity,
        price_per_card:  row.price_per_card,
        total_cost:      +(row.quantity * row.price_per_card).toFixed(2),
        acquisition_date: date,
      })
    }
  );
  if (!logRes.ok) throw new Error(`Log failed: ${await logRes.text()}`);
}

// Maps edition + condition → DB column name
function getQtyField(edition, condition) {
  const e = (edition   || '').toLowerCase();
  const c = (condition || 'NM').toUpperCase();

  if (e.includes('high') || e.includes('hr')) {
    return c === 'LP' ? 'hr_qty_lp' : 'hr_qty_nm';
  }
  if (e.includes('1st') || e.includes('first')) {
    if (c === 'LP') return 'fe_lp';
    if (c === 'MP') return 'fe_mp';
    return 'fe_nm';
  }
  // Unlimited (default)
  if (c === 'LP') return 'un_lp';
  if (c === 'MP') return 'un_mp';
  return 'un_nm';
}

// ── Manual Entry ───────────────────────────────────────────────────────────────
async function saveManualAcquisition() {
  const cardNum = document.getElementById('acq-card-number').value.trim().toUpperCase();
  if (!cardNum) { setAcqStatus('acq-manual-status', 'Card # is required', 'red'); return; }

  const purchasedFrom = document.getElementById('acq-source').value.trim();
  saveSourceIfNew(purchasedFrom);   // persist new vendor to dropdown

  const row = {
    card_number:    cardNum,
    card_name:      document.getElementById('acq-card-name').value.trim(),
    rarity:         document.getElementById('acq-rarity').value,
    edition:        document.getElementById('acq-edition').value,
    condition:      document.getElementById('acq-condition').value,
    purchased_from: purchasedFrom,
    quantity:       Math.max(1, parseInt(document.getElementById('acq-qty').value) || 1),
    price_per_card: parseFloat(document.getElementById('acq-price').value)         || 0,
  };

  const btn = document.getElementById('acq-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    await processAcquisitionRow(row, new Date().toISOString().split('T')[0]);
    setAcqStatus('acq-manual-status', '✓ Saved — inventory updated', 'green');
    // Clear form
    ['acq-card-number','acq-card-name','acq-source','acq-price'].forEach(id =>
      document.getElementById(id).value = ''
    );
    document.getElementById('acq-qty').value = '1';
    loadRecentAcquisitions();
  } catch (err) {
    setAcqStatus('acq-manual-status', 'Error: ' + err.message, 'red');
  } finally {
    btn.disabled = false; btn.textContent = 'Save & Update Inventory';
  }
}

// ── Recent Acquisitions Log ────────────────────────────────────────────────────
async function loadRecentAcquisitions() {
  const tbody = document.getElementById('acq-log-tbody');
  tbody.innerHTML = '<tr><td colspan="9" class="muted" style="text-align:center;padding:16px">Loading…</td></tr>';

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/acquisitions?order=created_at.desc&limit=100`,
      { headers: DB_HEADERS }
    );
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="muted" style="text-align:center;padding:16px">No acquisitions yet.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="muted small">${r.acquisition_date || '—'}</td>
        <td class="cinzel" style="color:var(--gold2)">${r.card_number}</td>
        <td>${r.card_name || '—'}</td>
        <td class="small muted">${r.rarity || '—'}</td>
        <td>${r.edition  || '—'}</td>
        <td style="text-align:center">${r.condition || '—'}</td>
        <td class="muted small">${r.purchased_from || '—'}</td>
        <td style="text-align:center">${r.quantity}</td>
        <td style="text-align:right;color:var(--green)">$${Number(r.total_cost || 0).toFixed(2)}</td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:var(--red);padding:12px">${err.message}</td></tr>`;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function setAcqStatus(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'red' ? 'var(--red)' : type === 'green' ? 'var(--green)' : 'var(--yellow)';
}
