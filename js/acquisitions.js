// ─── acquisitions.js — Card Acquisition Logging ──────────────────────────────

let acqInitialised = false;
let acqImportRows  = [];

// Rarities that are NOT high-rarity
const REGULAR_RARITIES = new Set([
  'Common', 'Rare', 'Short Print', 'Super Rare', 'Ultra Rare', 'Secret Rare'
]);

// ── Vendor Dropdown (Supabase-backed) ─────────────────────────────────────────
async function fetchVendors() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/vendors?order=name`,
      { headers: DB_HEADERS }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map(v => v.name);
  } catch { return []; }
}

async function saveVendorIfNew(name) {
  if (!name) return;
  await fetch(`${SUPABASE_URL}/rest/v1/vendors`, {
    method: 'POST',
    headers: { ...DB_HEADERS, 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ name })
  });
}

async function initSourceDropdown() {
  const vendors = await fetchVendors();
  const dl = document.getElementById('acq-source-list');
  if (!dl) return;
  dl.innerHTML = vendors.map(s => `<option value="${s}">`).join('');
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
    const table = 'card_inventory';
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?card_number=eq.${encodeURIComponent(num)}&select=card_name,rarity&limit=1`,
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

      // Auto-check High Rarity checkbox if rarity is non-standard
      const hrCheck = document.getElementById('acq-hr-check');
      if (hrCheck) hrCheck.checked = !REGULAR_RARITIES.has(card.rarity);
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

  // Source dropdown from Supabase
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
    'Card #,Card Name,Rarity,Edition,High Rarity,Condition,Purchased From,Quantity,Price Per Card,Add to Inventory',
    'BLMM-EN001,Blue-Eyes White Dragon,Secret Rare,1st Edition,No,NM,Local Card Shop,3,4.50,Yes',
    'BLMM-EN001,Blue-Eyes White Dragon,Starlight Rare,1st Edition,Yes,NM,eBay,1,250.00,Yes',
    'MAZE-EN010,Pot of Prosperity,Ultra Rare,Unlimited,No,LP,eBay,2,12.00,No',
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

  const rawHeaders = lines[0].split(',').map(h =>
    h.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g, '_').replace('#', '')
  );
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    if (!vals[0]) continue;

    const raw = {};
    rawHeaders.forEach((h, idx) => raw[h] = vals[idx] || '');

    const hrVal     = (raw['high_rarity']     || '').toLowerCase();
    const addInvVal = (raw['add_to_inventory'] || 'yes').toLowerCase();
    const isHighRar    = hrVal === 'yes' || hrVal === 'true'  || hrVal === '1';
    const skipInventory = addInvVal === 'no' || addInvVal === 'false' || addInvVal === '0';
    const edition   = raw['edition'] || '1st Edition';

    rows.push({
      card_number:    (raw['card_'] || raw['card_number'] || '').toUpperCase().trim(),
      card_name:      raw['card_name']      || '',
      rarity:         raw['rarity']         || '',
      edition:        edition,
      is_high_rarity: isHighRar,
      skip_inventory: skipInventory,
      condition:      (raw['condition']     || 'NM').toUpperCase().trim(),
      purchased_from: raw['purchased_from'] || '',
      quantity:       Math.max(1, parseInt(raw['quantity'])     || 1),
      price_per_card: parseFloat(raw['price_per_card'])         || 0,
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
          <th>HR</th><th>Cond</th><th>Source</th><th>Qty</th><th>$/Card</th><th>Add to Inv</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td class="cinzel" style="color:var(--gold2)">${r.card_number}</td>
            <td>${r.card_name || '—'}</td>
            <td>${r.rarity   || '—'}</td>
            <td>${r.edition}</td>
            <td style="text-align:center">${r.is_high_rarity ? '✓' : ''}</td>
            <td>${r.condition}</td>
            <td>${r.purchased_from || '—'}</td>
            <td style="text-align:center">${r.quantity}</td>
            <td style="text-align:right">$${Number(r.price_per_card).toFixed(2)}</td>
            <td style="text-align:center;color:${r.skip_inventory ? 'var(--muted)' : 'var(--green)'}">${r.skip_inventory ? 'No' : 'Yes'}</td>
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

  btn.disabled       = true;
  bar.style.display  = 'block';
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

  fill.style.width   = '100%';
  status.textContent = `Done — ${ok} imported, ${failed} failed`;
  status.style.color = failed > 0 ? 'var(--yellow)' : 'var(--green)';

  if (ok > 0) loadRecentAcquisitions();
}

// ── Core: process one acquisition row ─────────────────────────────────────────
async function processAcquisitionRow(row, date) {
  let cardUUID = null;

  if (!row.skip_inventory) {
    const params = new URLSearchParams({
      card_number: `eq.${row.card_number}`,
      select: 'id,qty_fe_nm,qty_fe_lp,qty_fe_mp,qty_un_nm,qty_un_lp,qty_un_mp',
      limit: 1,
    });
    if (row.rarity) params.set('rarity', `eq.${row.rarity}`);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/card_inventory?${params}`,
      { headers: DB_HEADERS }
    );
    if (!res.ok) throw new Error(`DB lookup ${res.status}`);
    const cards = await res.json();
    if (!cards.length) throw new Error(`Card not found: ${row.card_number}`);
    const card = cards[0];
    cardUUID = card.id;

    const devField   = getDevQtyField(row);
    const currentQty = Number(card[devField]) || 0;
    const patchRes   = await fetch(
      `${SUPABASE_URL}/rest/v1/card_inventory?id=eq.${card.id}`,
      { method: 'PATCH', headers: DB_HEADERS, body: JSON.stringify({ [devField]: currentQty + row.quantity }) }
    );
    if (!patchRes.ok) throw new Error(`PATCH failed: ${await patchRes.text()}`);
  }

  // Always log acquisition record
  const logRes = await fetch(
    `${SUPABASE_URL}/rest/v1/acquisitions`,
    {
      method: 'POST',
      headers: { ...DB_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        card_id:          cardUUID,
        card_number:      row.card_number,
        card_name:        row.card_name      || null,
        rarity:           row.rarity         || null,
        edition:          row.is_high_rarity ? 'High Rarity' : row.edition,
        condition:        row.condition,
        purchased_from:   row.purchased_from || null,
        quantity:         row.quantity,
        price_per_card:   row.price_per_card,
        total_cost:       +(row.quantity * row.price_per_card).toFixed(2),
        acquisition_date: date,
      })
    }
  );
  if (!logRes.ok) throw new Error(`Log failed: ${await logRes.text()}`);
}

// Maps row → correct qty column for dev schema (card_inventory)
function getDevQtyField(row) {
  const c     = (row.condition || 'NM').toUpperCase();
  const e     = (row.edition   || '').toLowerCase();
  const is1st = e.includes('1st') || e.includes('first');
  if (is1st) {
    if (c === 'LP') return 'qty_fe_lp';
    if (c === 'MP') return 'qty_fe_mp';
    return 'qty_fe_nm';
  }
  if (c === 'LP') return 'qty_un_lp';
  if (c === 'MP') return 'qty_un_mp';
  return 'qty_un_nm';
}

// Maps row → correct DB qty column
function getQtyField(row) {
  const c       = (row.condition || 'NM').toUpperCase();
  const e       = (row.edition   || '').toLowerCase();
  const is1st   = e.includes('1st') || e.includes('first');

  if (row.is_high_rarity) {
    // HR respects edition: 1st Edition vs Unlimited
    if (is1st) return c === 'LP' ? 'hr_fe_lp' : 'hr_fe_nm';
    return c === 'LP' ? 'hr_qty_lp' : 'hr_qty_nm';
  }
  if (is1st) {
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

  // Save new vendor to Supabase vendors table
  if (purchasedFrom) await saveVendorIfNew(purchasedFrom);
  // Refresh datalist with any new entry
  initSourceDropdown();

  const row = {
    card_number:    cardNum,
    card_name:      document.getElementById('acq-card-name').value.trim(),
    rarity:         document.getElementById('acq-rarity').value,
    edition:        document.getElementById('acq-edition').value,
    is_high_rarity: document.getElementById('acq-hr-check').checked,
    skip_inventory: document.getElementById('acq-skip-inv').checked,
    condition:      document.getElementById('acq-condition').value,
    purchased_from: purchasedFrom,
    quantity:       Math.max(1, parseInt(document.getElementById('acq-qty').value) || 1),
    price_per_card: parseFloat(document.getElementById('acq-price').value) || 0,
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
    document.getElementById('acq-qty').value          = '1';
    document.getElementById('acq-hr-check').checked   = false;
    document.getElementById('acq-skip-inv').checked   = false;
    document.getElementById('acq-lookup-status').textContent = '';
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function toUUID(val) { return UUID_RE.test(String(val || '')) ? val : null; }

function setAcqStatus(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'red' ? 'var(--red)' : type === 'green' ? 'var(--green)' : 'var(--yellow)';
}
