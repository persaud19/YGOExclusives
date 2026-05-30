// ─── listing-queue.js — eBay Listing Queue tab ───────────────────────────────

const LQ_PAGE_SIZE = 20;
let lqPage = 0;
let lqTotal = 0;

// ── Load queue from Supabase ──────────────────────────────────────────────────
async function lqLoad() {
  const status = document.getElementById('lq-status-filter').value;
  const tbody  = document.getElementById('lq-tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">Loading…</td></tr>';

  try {
    const offset = lqPage * LQ_PAGE_SIZE;
    const url = `${SUPABASE_URL}/rest/v1/listing_queue`
      + `?status=eq.${encodeURIComponent(status)}`
      + `&order=flagged.desc,queued_at.asc`
      + `&limit=${LQ_PAGE_SIZE}&offset=${offset}`
      + `&select=*`;

    const countUrl = `${SUPABASE_URL}/rest/v1/listing_queue?status=eq.${encodeURIComponent(status)}&select=id`;

    const [res, countRes] = await Promise.all([
      fetch(url, { headers: { ...DB_HEADERS_RETURN, 'Range-Unit': 'items', 'Range': `${offset}-${offset + LQ_PAGE_SIZE - 1}` } }),
      fetch(countUrl, { headers: { ...DB_HEADERS, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } }),
    ]);

    const rows = await res.json();
    if (!res.ok) {
      const msg = rows?.message || JSON.stringify(rows);
      throw new Error(msg);
    }
    const countHeader = countRes.headers.get('content-range') || '';
    lqTotal = parseInt(countHeader.split('/')[1] || '0', 10);

    lqRenderStats(status);
    lqRenderRows(rows, status);
    lqRenderPagination();
  } catch (e) {
    const msg = e.message.includes('relation') || e.message.includes('does not exist')
      ? 'listing_queue table not created yet — run backups/listing-queue-setup.sql in Supabase first.'
      : `Error loading queue: ${e.message}`;
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--yellow);text-align:center;padding:24px">${msg}</td></tr>`;
  }
}

// ── Render stats bar ──────────────────────────────────────────────────────────
async function lqRenderStats(activeStatus) {
  const statsEl = document.getElementById('lq-stats');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/listing_queue?select=status`,
      { headers: { ...DB_HEADERS, 'Prefer': 'count=exact' } }
    );
    const rows = await res.json();
    const counts = { pending: 0, pushed: 0, skipped: 0 };
    (rows || []).forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

    statsEl.innerHTML = Object.entries(counts).map(([s, n]) => `
      <div style="background:var(--surf);border:1px solid var(--b1);border-radius:6px;padding:8px 16px;cursor:pointer;${activeStatus === s ? 'border-color:var(--gold)' : ''}"
           onclick="document.getElementById('lq-status-filter').value='${s}';lqPage=0;lqLoad()">
        <div class="muted small" style="text-transform:capitalize">${s}</div>
        <div class="cinzel" style="font-size:1.3rem;color:${s==='pushed'?'var(--green)':s==='skipped'?'var(--muted)':'var(--gold)'}">${n}</div>
      </div>`).join('');
  } catch (e) {
    statsEl.innerHTML = '';
  }
}

// ── Render table rows ─────────────────────────────────────────────────────────
function lqRenderRows(rows, status) {
  const tbody = document.getElementById('lq-tbody');
  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center;padding:32px">No ${status} items in queue.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const flagIcon = row.flagged ? '<span title="Flagged" style="color:var(--yellow)">★</span>' : '';
    const pushedInfo = row.pushed_at
      ? `<div class="muted small">${new Date(row.pushed_at).toLocaleDateString()}</div>
         ${row.ebay_listing_id ? `<a href="https://www.ebay.com/itm/${row.ebay_listing_id}" target="_blank" style="color:var(--blue);font-size:0.75rem">View on eBay ↗</a>` : ''}`
      : '';

    const actionCell = status === 'pending'
      ? `<div style="display:flex;flex-direction:column;gap:4px">
           <button class="btn btn-primary" style="font-size:0.75rem;padding:4px 8px" onclick="lqOpenPush('${row.id}')">Push to eBay</button>
           <button class="btn btn-secondary" style="font-size:0.75rem;padding:4px 8px" onclick="lqSkip('${row.id}')">Skip</button>
         </div>`
      : pushedInfo || '<span class="muted small">—</span>';

    const price = row.price_cad ? `$${Number(row.price_cad).toFixed(2)}` : '<span class="muted">—</span>';

    return `<tr id="lq-row-${row.id}">
      <td style="text-align:center">${flagIcon}</td>
      <td>
        <div style="font-weight:500">${row.card_name || '—'}</div>
        <div class="muted small">${row.card_number}</div>
      </td>
      <td>
        <div>${row.set_name || '—'}</div>
        <div class="muted small">${row.rarity || '—'}</div>
      </td>
      <td>
        <select class="input" style="font-size:0.8rem;padding:3px 6px" id="lq-cond-${row.id}" onchange="lqSaveField('${row.id}','condition',this.value)">
          <option value="NM" ${row.condition==='NM'?'selected':''}>NM</option>
          <option value="LP" ${row.condition==='LP'?'selected':''}>LP</option>
          <option value="MP" ${row.condition==='MP'?'selected':''}>MP</option>
        </select>
      </td>
      <td>
        <select class="input" style="font-size:0.8rem;padding:3px 6px" id="lq-ed-${row.id}" onchange="lqSaveField('${row.id}','edition',this.value)">
          <option value="unlimited" ${row.edition==='unlimited'?'selected':''}>Unlimited</option>
          <option value="1st" ${row.edition==='1st'?'selected':''}>1st Edition</option>
        </select>
      </td>
      <td>
        <input class="input" type="text" inputmode="numeric" style="font-size:0.8rem;padding:3px 6px;width:80px"
          value="${row.price_cad || ''}" placeholder="0.00"
          onblur="lqSaveField('${row.id}','price_cad',parseFloat(this.value)||null)"
          id="lq-price-${row.id}">
      </td>
      <td id="lq-photos-${row.id}">
        ${status === 'pending' ? `<input type="file" accept="image/*" multiple style="font-size:0.72rem;max-width:150px" id="lq-file-${row.id}">` : '<span class="muted small">—</span>'}
      </td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('');
}

// ── Pagination ────────────────────────────────────────────────────────────────
function lqRenderPagination() {
  const el = document.getElementById('lq-pagination');
  const totalPages = Math.ceil(lqTotal / LQ_PAGE_SIZE);
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <button class="btn btn-secondary" ${lqPage === 0 ? 'disabled' : ''} onclick="lqPage--;lqLoad()">← Prev</button>
    <span class="muted small">Page ${lqPage + 1} of ${totalPages}</span>
    <button class="btn btn-secondary" ${lqPage >= totalPages - 1 ? 'disabled' : ''} onclick="lqPage++;lqLoad()">Next →</button>
  `;
}

// ── Save a single field back to Supabase ──────────────────────────────────────
async function lqSaveField(id, field, value) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/listing_queue?id=eq.${id}`, {
      method: 'PATCH',
      headers: DB_HEADERS,
      body: JSON.stringify({ [field]: value }),
    });
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

// ── Skip a card ───────────────────────────────────────────────────────────────
async function lqSkip(id) {
  if (!confirm('Skip this card? You can find it again under the Skipped filter.')) return;
  await lqSaveField(id, 'status', 'skipped');
  document.getElementById(`lq-row-${id}`)?.remove();
  showToast('Skipped.');
}

// ── Open push modal ───────────────────────────────────────────────────────────
function lqOpenPush(id) {
  const fileInput = document.getElementById(`lq-file-${id}`);
  if (!fileInput || fileInput.files.length === 0) {
    showToast('Select at least one photo first.', 'error');
    return;
  }
  const condEl  = document.getElementById(`lq-cond-${id}`);
  const edEl    = document.getElementById(`lq-ed-${id}`);
  const priceEl = document.getElementById(`lq-price-${id}`);
  const price   = parseFloat(priceEl?.value || '0');
  if (!price || price <= 0) {
    showToast('Enter a price before pushing.', 'error');
    return;
  }

  // Read row data from DOM for confirmation
  const row  = document.getElementById(`lq-row-${id}`);
  const name = row?.querySelector('td:nth-child(2) div')?.textContent || '';
  const num  = row?.querySelector('td:nth-child(2) .muted')?.textContent || '';

  if (!confirm(`Push "${name}" (${num}) to eBay for $${price.toFixed(2)} USD?`)) return;
  lqPush(id);
}

// ── Push listing to eBay via Netlify function ─────────────────────────────────
async function lqPush(queueId) {
  const btn = document.querySelector(`#lq-row-${queueId} .btn-primary`);
  if (btn) { btn.disabled = true; btn.textContent = 'Pushing…'; }

  try {
    // Gather row data
    const condEl  = document.getElementById(`lq-cond-${queueId}`);
    const edEl    = document.getElementById(`lq-ed-${queueId}`);
    const priceEl = document.getElementById(`lq-price-${queueId}`);
    const fileInput = document.getElementById(`lq-file-${queueId}`);

    // Fetch full row from Supabase for card fields
    const res  = await fetch(`${SUPABASE_URL}/rest/v1/listing_queue?id=eq.${queueId}&select=*`, { headers: DB_HEADERS_RETURN });
    const rows = await res.json();
    const row  = rows[0];
    if (!row) throw new Error('Queue entry not found');

    const form = new FormData();
    form.append('queue_id',     queueId);
    form.append('inventory_id', row.card_inventory_id || '');
    form.append('card_number',  row.card_number);
    form.append('card_name',    row.card_name || '');
    form.append('set_name',     row.set_name  || '');
    form.append('rarity',       row.rarity    || '');
    form.append('condition',    condEl?.value  || 'NM');
    form.append('edition',      edEl?.value    || 'unlimited');
    form.append('price_cad',    priceEl?.value || '0');

    const files = fileInput?.files || [];
    for (let i = 0; i < Math.min(files.length, 2); i++) {
      form.append(`photo_${i}`, files[i]);
    }

    const pushRes  = await fetch('/.netlify/functions/ebay-list', { method: 'POST', body: form });
    const pushData = await pushRes.json();

    if (!pushRes.ok || !pushData.success) {
      throw new Error(pushData.error || 'Unknown error from eBay');
    }

    // Update row in UI
    const tableRow = document.getElementById(`lq-row-${queueId}`);
    if (tableRow) tableRow.remove();

    showToast(`Listed! eBay ID: ${pushData.ebay_listing_id}`);
    lqRenderStats(document.getElementById('lq-status-filter').value);

  } catch (e) {
    showToast('Push failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Push to eBay'; }
  }
}

