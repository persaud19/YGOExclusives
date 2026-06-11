// ─── listing-queue.js — eBay Listing Queue tab ───────────────────────────────

const LQ_PAGE_SIZE = 20;
let lqPage = 0;
let lqTotal = 0;

// ── Load queue from Supabase ──────────────────────────────────────────────────
async function lqLoad() {
  const status = document.getElementById('lq-status-filter').value;
  const tbody  = document.getElementById('lq-tbody');
  tbody.innerHTML = '<tr><td colspan="13" class="muted" style="text-align:center;padding:24px">Loading…</td></tr>';

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
    tbody.innerHTML = `<tr><td colspan="13" style="color:var(--yellow);text-align:center;padding:24px">${msg}</td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="13" class="muted" style="text-align:center;padding:32px">No ${status} items in queue.</td></tr>`;
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
           <button class="btn btn-primary" style="font-size:0.75rem;padding:4px 8px" id="lq-pushbtn-${row.id}" onclick="lqPushSingle('${row.id}','${row.card_number}')">Push to eBay</button>
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
          <option value="1st" ${row.edition==='1st'?'selected':''}>1st Edition</option>
          <option value="unlimited" ${row.edition==='unlimited'?'selected':''}>Unlimited</option>
        </select>
      </td>
      <td style="text-align:center;font-size:0.85rem">
        <span style="color:var(--muted)">${row.qty_inventory ?? '—'}</span>
      </td>
      <td style="text-align:center">
        ${row.is_playset
          ? `<span title="Photo is of a playset — divide inventory qty by ~3 for true listings" style="font-size:0.62rem;font-weight:700;background:var(--purple);color:#fff;border-radius:4px;padding:2px 6px;letter-spacing:0.04em;white-space:nowrap">PLAYSET</span>`
          : '<span class="muted">—</span>'}
      </td>
      <td>
        ${status === 'pending'
          ? `<input class="input" type="text" inputmode="numeric" style="font-size:0.8rem;padding:3px 6px;width:50px;text-align:center"
               value="${row.qty_list ?? 1}"
               onblur="lqSaveField('${row.id}','qty_list',parseInt(this.value)||1)"
               id="lq-qty-${row.id}">`
          : `<span class="muted small">${row.qty_list ?? 1}</span>`}
      </td>
      <td style="color:var(--muted);font-size:0.85rem">
        ${row.tcg_low_cad ? `<span style="color:var(--blue)">$${Number(row.tcg_low_cad).toFixed(2)}</span>` : '<span class="muted">—</span>'}
      </td>
      <td style="font-size:0.85rem">
        ${row.ebay_low_cad > 0
          ? `<span style="color:var(--green)">C$${Number(row.ebay_low_cad).toFixed(2)}</span>`
          : '<span class="muted">—</span>'}
      </td>
      <td>
        <input class="input" type="text" inputmode="numeric" style="font-size:0.8rem;padding:3px 6px;width:80px"
          value="${row.price_cad || ''}" placeholder="0.00"
          onblur="lqSaveField('${row.id}','price_cad',parseFloat(this.value)||null)"
          id="lq-price-${row.id}">
      </td>
      <td id="lq-photos-${row.id}" style="text-align:center;font-size:0.85rem">
        ${row.photo_count > 0
          ? `<span title="${row.photo_count} photo file(s) in folder">📷 ${row.photo_count}</span>`
          : '<span class="muted small">—</span>'}
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

// ── Trigger push via URI scheme ──────────────────────────────────────────────
function lqTriggerPush() {
  const pendingWithPrice = document.querySelectorAll('#lq-tbody tr[id^="lq-row-"]').length;
  if (!confirm('This will open PowerShell and push all priced pending cards to eBay.ca.\n\nMake sure prices and conditions are set first.\n\nProceed?')) return;

  // Launch the local push script via URI scheme
  window.location.href = 'ygoexclusives://push';

  // Show countdown and auto-refresh queue after script likely finishes
  const btn = document.querySelector('[onclick="lqTriggerPush()"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Pushed — refreshing in 30s…';
    let secs = 30;
    const interval = setInterval(() => {
      secs--;
      if (btn) btn.textContent = `Pushed — refreshing in ${secs}s…`;
      if (secs <= 0) {
        clearInterval(interval);
        lqLoad();
        if (btn) {
          btn.disabled = false;
          btn.textContent = '▶ Push to eBay';
        }
      }
    }, 1000);
  }
}

// ── Skip a card ───────────────────────────────────────────────────────────────
async function lqSkip(id) {
  if (!confirm('Skip this card? You can find it again under the Skipped filter.')) return;
  await lqSaveField(id, 'status', 'skipped');
  document.getElementById(`lq-row-${id}`)?.remove();
  showToast('Skipped.');
}

// ── Refresh eBay prices via Netlify function (writes to DB then reloads) ──────
async function lqRefreshEbayPrices() {
  const btn = document.getElementById('lq-ebay-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }

  const setBtn = (label, ok = true) => {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = label;
    btn.style.color = ok ? '' : 'var(--red)';
    setTimeout(() => { btn.textContent = '↺ eBay Prices'; btn.style.color = ''; }, 4000);
  };

  try {
    const syncKey = localStorage.getItem('ygoexclusives_sync_key') || '';
    const res  = await fetch('/.netlify/functions/ebay-queue-prices', {
      headers: { 'X-Api-Key': syncKey },
    });
    const data = await res.json();
    if (res.status === 429) {
      setBtn('Rate limit — try tomorrow', false);
      showToast('eBay rate limit hit — resets midnight PT', 'error');
    } else if (res.status === 401) {
      setBtn('Auth failed — check sync key', false);
      showToast('Sync key not set — add ygoexclusives_sync_key to localStorage', 'error');
    } else if (res.ok) {
      console.log('ebay-queue-prices result:', data);
      setBtn(`✓ Updated ${data.updated}/${data.total}`);
      showToast(`eBay prices updated: ${data.updated} of ${data.total} cards.`);
      lqLoad();
    } else {
      setBtn('Error — see console', false);
      console.error('ebay-queue-prices error:', data);
      showToast('Error: ' + (data.error || res.status), 'error');
    }
  } catch (e) {
    setBtn('Failed — see console', false);
    console.error('lqRefreshEbayPrices:', e);
    showToast('Error: ' + e.message, 'error');
  }
}

// ── Sync listed status with live eBay active listings ────────────────────────
async function lqSyncListedStatus() {
  const btn = document.getElementById('lq-ebay-listed-sync-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }

  const setBtn = (label, ok = true) => {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = label;
    btn.style.color = ok ? '' : 'var(--red)';
    setTimeout(() => { btn.textContent = '⟳ Sync Listed'; btn.style.color = ''; }, 4000);
  };

  try {
    const syncKey = localStorage.getItem('ygoexclusives_sync_key') || '';
    const res  = await fetch('/.netlify/functions/ebay-active-sync', {
      headers: { 'X-Api-Key': syncKey },
    });
    const data = await res.json();
    if (res.status === 401) {
      setBtn('Auth failed', false);
      showToast('Sync key not set — add ygoexclusives_sync_key to localStorage', 'error');
    } else if (res.ok) {
      setBtn(`✓ ${data.matched_listed} listed / ${data.matched_unlisted} unlisted`);
      showToast(`Listed sync done: ${data.matched_listed} marked listed, ${data.matched_unlisted} cleared.`);
    } else {
      setBtn('Error — see console', false);
      console.error('ebay-active-sync error:', data);
      showToast('Error: ' + (data.error || res.status), 'error');
    }
  } catch (e) {
    setBtn('Failed — see console', false);
    console.error('lqSyncListedStatus:', e);
    showToast('Error: ' + e.message, 'error');
  }
}

// ── Launch a workflow script via URI scheme ───────────────────────────────────
function lqLaunchScript(action, label) {
  const messages = {
    'process-photos': 'This will open PowerShell and run the photo processor.\n\nIt scans Card Photos\\Incoming\\ with Claude Vision, sorts photos into named folders in Cards Processed\\, and logs results.\n\nMake sure photos are in the Incoming folder first.\n\nProceed?',
    'build-queue':    'This will open PowerShell and build the listing queue.\n\nIt scans Cards Processed\\ folders, matches each to card_inventory, inserts queue entries, and moves folders to Cards Listed\\.\n\nProceed?',
  };
  if (!confirm(messages[action] || `Run ${label}?`)) return;

  window.location.href = `ygoexclusives://${action}`;

  const btns = document.querySelectorAll(`[onclick="lqLaunchScript('${action}','${label}')"]`);
  btns.forEach(btn => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Running in PowerShell…';
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = original;
      if (action === 'build-queue') lqLoad();
    }, 15000);
  });
}

// ── Push a single card to eBay via URI scheme ─────────────────────────────────
function lqPushSingle(id, cardNumber) {
  const priceEl = document.getElementById(`lq-price-${id}`);
  const price   = parseFloat(priceEl?.value || '0');
  if (!price || price <= 0) {
    showToast('Enter a price before pushing.', 'error');
    return;
  }

  const row  = document.getElementById(`lq-row-${id}`);
  const name = row?.querySelector('td:nth-child(2) div')?.textContent?.trim() || cardNumber;

  if (!confirm(`Push "${name}" (${cardNumber}) to eBay.ca for C$${price.toFixed(2)}?\n\nThis will open PowerShell — confirm in that window to complete the listing.`)) return;

  // Fire URI scheme with card number so PS script uses -CardNumber flag
  window.location.href = `ygoexclusives://push/${encodeURIComponent(cardNumber)}`;

  // Disable button + show countdown while PS script runs
  const btn = document.getElementById(`lq-pushbtn-${id}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Pushing…';
    let secs = 30;
    const iv = setInterval(() => {
      secs--;
      if (btn) btn.textContent = `Done in ${secs}s…`;
      if (secs <= 0) {
        clearInterval(iv);
        lqLoad();
      }
    }, 1000);
  }
}

