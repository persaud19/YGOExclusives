// ─── collection.js — Phase 3: Collection Tab ─────────────────────────────────

let collectionInitialized = false;
let colPage    = 0;
const COL_PAGE_SIZE = 50;
let colFilters = { search: '', rarity: '', location: '', listed: '' };
let colSort    = { col: 'card_number', dir: 'asc' };
let colTotal   = 0;
let editCardId = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
function initCollection() {
  if (collectionInitialized) return;
  collectionInitialized = true;
  wireCollectionControls();
  loadCollectionPage();
}

function wireCollectionControls() {
  const searchEl = document.getElementById('col-search');
  if (searchEl) {
    let debounce;
    searchEl.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        colFilters.search = searchEl.value.trim();
        colPage = 0;
        loadCollectionPage();
      }, 250);
    });
  }

  ['col-filter-rarity', 'col-filter-location', 'col-filter-listed'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      colFilters[id.replace('col-filter-', '')] = el.value;
      colPage = 0;
      loadCollectionPage();
    });
  });

  document.getElementById('col-prev-btn')?.addEventListener('click', () => {
    if (colPage > 0) { colPage--; loadCollectionPage(); }
  });
  document.getElementById('col-next-btn')?.addEventListener('click', () => {
    if ((colPage + 1) * COL_PAGE_SIZE < colTotal) { colPage++; loadCollectionPage(); }
  });

  // Sortable headers
  document.querySelectorAll('#col-thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (colSort.col === col) {
        colSort.dir = colSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        colSort.col = col;
        colSort.dir = 'asc';
      }
      colPage = 0;
      updateSortArrows();
      loadCollectionPage();
    });
  });

  document.getElementById('col-export-btn')?.addEventListener('click', exportCollectionCSV);
  document.getElementById('col-add-btn')?.addEventListener('click', openAddCardModal);
  document.getElementById('col-sets-btn')?.addEventListener('click', openSetsModal);
}

function updateSortArrows() {
  document.querySelectorAll('#col-thead th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.dataset.sort === colSort.col) {
      th.classList.add('sorted');
      arrow.textContent = colSort.dir === 'asc' ? ' ↑' : ' ↓';
    } else {
      th.classList.remove('sorted');
      arrow.textContent = ' ↕';
    }
  });
}

// ─── Load / Render ────────────────────────────────────────────────────────────
async function loadCollectionPage() {
  const tbody = document.getElementById('col-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="13" class="text-center muted" style="padding:24px">Loading…</td></tr>';
  try {
    const { rows, total } = await getCardsPage({
      ...colFilters,
      page:    colPage,
      pageSize: COL_PAGE_SIZE,
      sortCol: colSort.col,
      sortDir: colSort.dir,
    });
    colTotal = total;
    renderCollectionRows(rows, tbody);
    updateCollectionPagination(total);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="13" class="red text-center" style="padding:24px">Error: ${escHtml(e.message)}</td></tr>`;
  }
}

function renderCollectionRows(rows, tbody) {
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="text-center muted" style="padding:24px">No cards found</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(card => {
    const listed = card.listed;
    return `<tr>
      <td class="col-thumb">
        ${card.api_id
          ? `<img src="${CARD_IMG(card.api_id)}" alt="" loading="lazy" onerror="this.style.opacity=0">`
          : '<div style="width:32px;height:46px;background:var(--b1);border-radius:3px"></div>'}
      </td>
      <td><span class="cinzel" style="font-size:0.72rem;color:var(--muted);white-space:nowrap">${escHtml(card.card_number)}</span></td>
      <td style="max-width:200px;font-weight:500">${escHtml(card.card_name)}</td>
      <td>
        <span class="badge ${getRarityBadgeClass(card.rarity)}">${escHtml(card.rarity||'')}</span>
        ${(card.higher_rarity && card.higher_rarity !== card.rarity)
          ? `<br><span class="badge badge-purple" style="font-size:0.68rem;margin-top:3px">★ ${escHtml(card.higher_rarity)}</span>`
          : ''}
      </td>
      <td class="small muted" style="white-space:nowrap">${escHtml(card.set_name||'')}</td>
      <td style="white-space:nowrap">
        ${card.tcg_price_cad > 0
          ? `<span class="cinzel" style="color:var(--gold2)">C$${Number(card.tcg_price_cad).toFixed(2)}</span>
             <span class="muted" style="font-size:0.7rem;display:block">$${Number(card.tcg_market_price||0).toFixed(2)} USD</span>`
          : card.tcg_market_price > 0
            ? `<span class="cinzel" style="color:var(--muted)">$${Number(card.tcg_market_price).toFixed(2)}</span>`
            : '<span class="muted">—</span>'}
      </td>
      <td class="cinzel" style="color:var(--gold2);white-space:nowrap">${card.tcg_low_price > 0 ? '$'+Number(card.tcg_low_price).toFixed(2) : '—'}</td>
      <td class="small muted">${(card.acquisition_cost > 0) ? '$'+Number(card.acquisition_cost).toFixed(2) : '—'}</td>
      <td class="small muted">${escHtml(card.location||'')}</td>
      <td class="cinzel" style="color:var(--gold2);text-align:center;font-weight:700">${(card.fe_nm||0)+(card.fe_lp||0)+(card.fe_mp||0)+(card.un_nm||0)+(card.un_lp||0)+(card.un_mp||0)}</td>
      <td>
        <span class="badge ${listed ? 'badge-green' : 'badge-muted'}"
              style="cursor:pointer" id="listed-badge-${card.id}"
              onclick="quickToggleListed('${card.id}',${!listed},this)">
          ${listed ? 'Listed' : 'Unlisted'}
        </span>
      </td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openEditModal('${card.id}')">Edit</button>
        <button class="btn btn-sm" style="background:var(--red);color:#fff;margin-left:6px" onclick="deleteCard('${card.id}','${card.card_name.replace(/'/g,"\\'")}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function updateCollectionPagination(total) {
  const start = colPage * COL_PAGE_SIZE + 1;
  const end   = Math.min((colPage + 1) * COL_PAGE_SIZE, total);
  const el    = document.getElementById('col-page-info');
  if (el) el.textContent = total
    ? `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`
    : '0 results';
  document.getElementById('col-prev-btn').disabled = colPage === 0;
  document.getElementById('col-next-btn').disabled = end >= total;
}

// ─── Inline qty adjust ────────────────────────────────────────────────────────
async function colQtyAdj(cardId, field, current, btn, delta) {
  const newVal = Math.max(0, current + delta);
  btn.disabled = true;
  try {
    await updateCard({ id: cardId, [field]: newVal, updated_at: new Date().toISOString() });
    const span = document.getElementById(`colqty-${cardId}`);
    if (span) span.textContent = newVal;
    // Update both button onclicks with new current value
    const btns = btn.closest('td').querySelectorAll('.qty-btn');
    btns[0].setAttribute('onclick', `colQtyAdj('${cardId}','${field}',${newVal},this,-1)`);
    btns[1].setAttribute('onclick', `colQtyAdj('${cardId}','${field}',${newVal},this,1)`);
  } catch (e) {
    showToast('Failed: ' + e.message);
  }
  btn.disabled = false;
}

// ─── Listed toggle ────────────────────────────────────────────────────────────
async function quickToggleListed(id, newVal, badgeEl) {
  try {
    await toggleListed(id, newVal);
    badgeEl.textContent = newVal ? 'Listed' : 'Unlisted';
    badgeEl.className   = `badge ${newVal ? 'badge-green' : 'badge-muted'}`;
    badgeEl.setAttribute('onclick', `quickToggleListed('${id}',${!newVal},this)`);
  } catch (e) {
    showToast('Failed: ' + e.message);
  }
}

// ─── Delete Card ──────────────────────────────────────────────────────────────
async function deleteCard(cardId, cardName) {
  if (!confirm(`Delete "${cardName}" from your collection?\nThis cannot be undone.`)) return;
  try {
    await dbDelete('card_inventory', 'id', cardId);
    showToast(`Deleted: ${cardName}`);
    loadCollectionPage();
  } catch (e) {
    showToast('Delete failed: ' + e.message);
  }
}

// ─── Edit Modal — Open ────────────────────────────────────────────────────────
async function openEditModal(cardId) {
  editCardId = cardId;
  const modal = document.getElementById('edit-modal');
  modal.querySelector('.modal-title').textContent = 'Loading…';
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  try {
    const card = await getCardById(cardId);
    if (!card) { showToast('Card not found'); closeEditModal(); return; }
    populateEditModal(card);
  } catch (e) {
    showToast('Error: ' + e.message);
    closeEditModal();
  }
}

function populateEditModal(card) {
  document.getElementById('edit-modal-title').textContent = card.card_name;
  document.getElementById('edit-modal-sub').textContent   = card.card_number + (card.set_name ? ' · ' + card.set_name : '');

  const thumb = document.getElementById('edit-thumb');
  if (thumb) { thumb.src = card.api_id ? CARD_IMG(card.api_id) : ''; thumb.style.display = card.api_id ? '' : 'none'; }

  const sv = (id, v) => { const el = document.getElementById(id); if (!el) return; el.value = (v === null || v === undefined) ? '' : v; };

  // Basic
  sv('edit-card-name',   card.card_name);
  sv('edit-card-number', card.card_number);
  sv('edit-api-id',      card.api_id || '');
  sv('edit-rarity',      card.rarity || '');
  sv('edit-set-name',    card.set_name || '');
  sv('edit-year',        card.year || '');

  // Quantities
  sv('edit-fe-nm',  card.fe_nm  || 0);
  sv('edit-fe-lp',  card.fe_lp  || 0);
  sv('edit-fe-mp',  card.fe_mp  || 0);
  sv('edit-un-nm',  card.un_nm  || 0);
  sv('edit-un-lp',  card.un_lp  || 0);
  sv('edit-un-mp',  card.un_mp  || 0);
  // Prices
  sv('edit-tcg-low',    card.tcg_low_price    || '');
  sv('edit-tcg-market', card.tcg_market_price || '');
  sv('edit-first-ed-nm',  card.first_ed_nm  || '');
  sv('edit-first-ed-lp',  card.first_ed_lp  || '');
  sv('edit-first-ed-mp',  card.first_ed_mp  || '');
  sv('edit-unlimited-nm', card.unlimited_nm || '');
  sv('edit-unlimited-lp', card.unlimited_lp || '');
  sv('edit-unlimited-mp', card.unlimited_mp || '');

  // Location & status
  sv('edit-location', card.location || 'Basement Box');
  document.getElementById('edit-listed').checked = !!card.listed;

  // Acquisition
  sv('edit-acq-cost',     card.acquisition_cost || '');
  sv('edit-acq-shipping', card.acquisition_shipping || '');
  sv('edit-acq-fee',      card.acquisition_platform_fee || '');
  sv('edit-acq-source',   card.acquisition_source || '');
  sv('edit-acq-date',     card.acquisition_date || '');

  // Listings
  refreshListingPreviews(card);

  // Reset save button
  const saveBtn = document.getElementById('edit-save-btn');
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save Changes';
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  document.body.style.overflow = '';
  editCardId = null;
}

// ─── Edit Modal — Save ────────────────────────────────────────────────────────
async function saveEditModal() {
  if (!editCardId) return;
  const gv  = id => document.getElementById(id)?.value?.trim() || '';
  const gn  = id => parseFloat(document.getElementById(id)?.value) || 0;
  const gi  = id => parseInt(document.getElementById(id)?.value, 10) || 0;

  const patch = {
    id:                       editCardId,
    card_name:                gv('edit-card-name'),
    card_number:              gv('edit-card-number'),
    api_id:                   parseInt(gv('edit-api-id')) || null,
    rarity:                   gv('edit-rarity'),
    set_name:                 gv('edit-set-name'),
    year:                     gv('edit-year'),
    fe_nm:                    gi('edit-fe-nm'),
    fe_lp:                    gi('edit-fe-lp'),
    fe_mp:                    gi('edit-fe-mp'),
    un_nm:                    gi('edit-un-nm'),
    un_lp:                    gi('edit-un-lp'),
    un_mp:                    gi('edit-un-mp'),
    location:                 gv('edit-location'),
    listed:                   document.getElementById('edit-listed')?.checked || false,
    tcg_market_price:         gn('edit-tcg-market'),
    first_ed_nm:              gn('edit-first-ed-nm'),
    first_ed_lp:              gn('edit-first-ed-lp'),
    first_ed_mp:              gn('edit-first-ed-mp'),
    unlimited_nm:             gn('edit-unlimited-nm'),
    unlimited_lp:             gn('edit-unlimited-lp'),
    unlimited_mp:             gn('edit-unlimited-mp'),
    acquisition_cost:         gn('edit-acq-cost'),
    acquisition_shipping:     gn('edit-acq-shipping'),
    acquisition_platform_fee: gn('edit-acq-fee'),
    acquisition_source:       gv('edit-acq-source'),
    acquisition_date:         gv('edit-acq-date') || null,
    updated_at:               new Date().toISOString(),
  };

  const saveBtn = document.getElementById('edit-save-btn');
  saveBtn.disabled    = true;
  saveBtn.textContent = 'Saving…';

  try {
    await updateCard(patch);
    showToast('Saved ✓');
    closeEditModal();
    loadCollectionPage();
  } catch (e) {
    showToast('Save failed: ' + e.message);
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save Changes';
  }
}

// ─── Edit modal helpers ───────────────────────────────────────────────────────
function editAutoFillPrices() {
  const baseId = { 'tcg-low': 'edit-tcg-low', 'tcg-market': 'edit-tcg-market' };
  const sel = document.getElementById('edit-price-base')?.value || 'tcg-market';
  const p = parseFloat(document.getElementById(baseId[sel])?.value) || 0;
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.value = v.toFixed(2); };
  s('edit-first-ed-nm',  p * PRICE_MULT.first_ed_nm);
  s('edit-first-ed-lp',  p * PRICE_MULT.first_ed_lp);
  s('edit-first-ed-mp',  p * PRICE_MULT.first_ed_mp);
  s('edit-unlimited-nm', p * PRICE_MULT.unlimited_nm);
  s('edit-unlimited-lp', p * PRICE_MULT.unlimited_lp);
  s('edit-unlimited-mp', p * PRICE_MULT.unlimited_mp);
  refreshListingPreviewsFromForm();
}

async function fetchEditPrices() {
  const btn = document.getElementById('edit-fetch-btn');
  btn.disabled = true; btn.textContent = 'Fetching…';
  try {
    // Try by api_id first; fall back to card name lookup
    let apiId = document.getElementById('edit-api-id')?.value?.trim();
    let url;
    if (apiId) {
      url = `${YGOPRO_API}?id=${encodeURIComponent(apiId)}`;
    } else {
      const cardName = document.getElementById('edit-card-name')?.value?.trim();
      if (!cardName) throw new Error('No card name to search');
      url = `${YGOPRO_API}?name=${encodeURIComponent(cardName)}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const card   = data.data?.[0];
    const prices = card?.card_prices?.[0];
    if (!prices) throw new Error('No price data returned');

    // Populate TCG Market and eBay Low (only non-zero values)
    const s = (id, v) => {
      const el = document.getElementById(id);
      if (el && v && parseFloat(v) > 0) el.value = parseFloat(v).toFixed(2);
    };
    s('edit-tcg-market', prices.tcgplayer_price);
    s('edit-ebay-low',   prices.ebay_price);

    // Save api_id back to DB and the hidden field if we looked it up by name
    if (!apiId && card.id) {
      const apiIdEl = document.getElementById('edit-api-id');
      if (apiIdEl) apiIdEl.value = card.id;
      // Persist to DB so future fetches skip the name lookup
      if (editCardId) {
        updateCard({ id: editCardId, api_id: card.id }).catch(() => {});
      }
    }

    showToast('Fetched: TCG Market + eBay Low from YGOPRODeck');
  } catch(e) {
    showToast('Fetch failed: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Fetch ↑';
  }
}

function editHRChange() {
  const val = document.getElementById('edit-higher-rarity')?.value;
  document.getElementById('edit-hr-qty-row').style.display = val ? '' : 'none';
}

// ─── Listing generators ───────────────────────────────────────────────────────
function refreshListingPreviews(card) {
  const sv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  sv('edit-ebay-title', generateEbayTitle(card));
  sv('edit-ebay-desc',  generateEbayDescription(card));
  sv('edit-fb-post',    generateFBPost(card));
}

function refreshListingPreviewsFromForm() {
  refreshListingPreviews({
    card_name:    document.getElementById('edit-card-name')?.value || '',
    card_number:  document.getElementById('edit-card-number')?.value || '',
    rarity:       document.getElementById('edit-rarity')?.value || '',
    set_name:     document.getElementById('edit-set-name')?.value || '',
    unlimited_nm: parseFloat(document.getElementById('edit-unlimited-nm')?.value) || 0,
    fe_nm: parseInt(document.getElementById('edit-fe-nm')?.value)||0,
    fe_lp: parseInt(document.getElementById('edit-fe-lp')?.value)||0,
    fe_mp: parseInt(document.getElementById('edit-fe-mp')?.value)||0,
  });
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
async function exportCollectionCSV() {
  const btn = document.getElementById('col-export-btn');
  btn.disabled    = true;
  btn.textContent = 'Exporting…';

  try {
    let allRows = [], page = 0;
    while (true) {
      const { rows, total } = await getCardsPage({
        ...colFilters, page, pageSize: 250,
        sortCol: colSort.col, sortDir: colSort.dir,
      });
      allRows = allRows.concat(rows);
      if (allRows.length >= total || rows.length < 250) break;
      page++;
    }

    const headers = [
      'Card #','Card Name','Rarity','Set Name','Year',
      'First Edition - NM','First Edition - LP','First Edition - MP',
      'Unlimited - NM','Unlimited - LP','Unlimited - MP',
      'Location','Higher Rarity?','Secondary Rarity','Total Quantity','Listed?',
      'TCG Market Price','1st Ed NM Price','1st Ed LP Price','1st Ed MP Price',
      'Unlimited NM Price','Unlimited LP Price','Unlimited MP Price',
      'Acquisition Cost','Acquisition Shipping','Acquisition Source','Acquisition Date',
    ];

    const escape = v => `"${String(v ?? '').replace(/"/g,'""')}"`;

    const csvLines = [
      headers.map(escape).join(','),
      ...allRows.map(c => [
        c.card_number, c.card_name, c.rarity, c.set_name, c.year||'',
        c.fe_nm||0, c.fe_lp||0, c.fe_mp||0,
        c.un_nm||0, c.un_lp||0, c.un_mp||0,
        c.location, c.higher_rarity||'', c.higher_rarity||'',
        (c.fe_nm||0)+(c.fe_lp||0)+(c.fe_mp||0)+(c.un_nm||0)+(c.un_lp||0)+(c.un_mp||0),
        c.listed ? 'Yes' : 'No',
        c.tcg_market_price||0,
        c.first_ed_nm||0, c.first_ed_lp||0, c.first_ed_mp||0,
        c.unlimited_nm||0, c.unlimited_lp||0, c.unlimited_mp||0,
        c.acquisition_cost||0, c.acquisition_shipping||0,
        c.acquisition_source||'', c.acquisition_date||'',
      ].map(escape).join(',')),
    ];

    const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a    = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(blob),
      download: `ygoexclusives-${new Date().toISOString().slice(0,10)}.csv`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`Exported ${allRows.length.toLocaleString()} cards`);
  } catch (e) {
    showToast('Export failed: ' + e.message);
  }

  btn.disabled    = false;
  btn.textContent = 'Export CSV';
}

// ─── Add Card Modal ───────────────────────────────────────────────────────────
function openAddCardModal() {
  const modal = document.getElementById('add-card-modal');
  if (!modal) return;

  // Populate rarity select
  const rarSel = document.getElementById('ac-rarity');
  if (rarSel && rarSel.options.length <= 1) {
    (typeof RARITIES !== 'undefined' ? RARITIES : []).forEach(r => {
      rarSel.add(new Option(r, r));
    });
  }

  // Populate location select
  const locSel = document.getElementById('ac-location');
  if (locSel && locSel.options.length === 0) {
    (typeof LOCATIONS !== 'undefined' ? LOCATIONS : []).forEach(l => {
      locSel.add(new Option(l, l));
    });
  }

  // Clear fields
  ['ac-card-number','ac-card-name','ac-set-name','ac-year'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('ac-rarity').value  = '';
  document.getElementById('ac-error').textContent = '';
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('ac-card-number')?.focus(), 50);
}

function closeAddCardModal() {
  document.getElementById('add-card-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

async function saveNewCard() {
  const num  = document.getElementById('ac-card-number')?.value.trim();
  const name = document.getElementById('ac-card-name')?.value.trim();
  const errEl = document.getElementById('ac-error');
  errEl.textContent = '';

  if (!num)  { errEl.textContent = 'Card # is required.'; return; }
  if (!name) { errEl.textContent = 'Card Name is required.'; return; }

  const btn = document.getElementById('ac-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const row = {
      id:          crypto.randomUUID(),
      card_number: num,
      card_name:   name,
      rarity:      document.getElementById('ac-rarity')?.value   || '',
      set_name:    document.getElementById('ac-set-name')?.value.trim() || '',
      year:        document.getElementById('ac-year')?.value.trim()     || null,
      location:    document.getElementById('ac-location')?.value        || '',
      fe_nm: 0, fe_lp: 0, fe_mp: 0,
      un_nm: 0, un_lp: 0, un_mp: 0,
      listed: false,
    };
    await dbInsert('cards', row);
    showToast(`Added: ${name}`);
    closeAddCardModal();
    colPage = 0;
    loadCollectionPage();
  } catch (e) {
    errEl.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Card';
  }
}

// ─── Sets Modal ───────────────────────────────────────────────────────────────
let _allSets = [];

async function openSetsModal() {
  document.getElementById('sets-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('sets-search').value = '';

  if (_allSets.length === 0) await loadSets();
  else renderSets(_allSets);

  document.getElementById('sets-search').addEventListener('input', onSetsSearch);
  setTimeout(() => document.getElementById('sets-search')?.focus(), 50);
}

async function refreshSets() {
  const btn = document.getElementById('sets-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Loading…'; }
  _allSets = [];
  document.getElementById('sets-search').value = '';
  await loadSets();
  if (btn) { btn.disabled = false; btn.textContent = '⟳ Refresh'; }
}

function closeSetsModal() {
  document.getElementById('sets-modal').classList.add('hidden');
  document.body.style.overflow = '';
  document.getElementById('sets-search').removeEventListener('input', onSetsSearch);
}

async function loadSets() {
  const tbody = document.getElementById('sets-tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="text-center muted" style="padding:24px">Loading…</td></tr>';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sets?select=id,set_code,set_name,year,has_unlimited,has_first_ed&order=set_code.asc&limit=1000`,
      { headers: DB_HEADERS_RETURN }
    );
    if (!res.ok) throw new Error(await res.text());
    _allSets = await res.json();
    renderSets(_allSets);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="red text-center" style="padding:24px">Error: ${escHtml(e.message)}</td></tr>`;
  }
}

function onSetsSearch() {
  const q = document.getElementById('sets-search').value.trim().toLowerCase();
  const filtered = q
    ? _allSets.filter(s => s.set_code.toLowerCase().includes(q) || s.set_name.toLowerCase().includes(q))
    : _allSets;
  renderSets(filtered);
}

function renderSets(sets) {
  const countEl = document.getElementById('sets-count');
  if (countEl) countEl.textContent = `${sets.length.toLocaleString()} sets`;

  const tbody = document.getElementById('sets-tbody');
  if (!sets.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center muted" style="padding:16px">No sets found</td></tr>';
    return;
  }
  tbody.innerHTML = sets.map(s => `
    <tr style="border-top:1px solid var(--b1)">
      <td style="padding:8px;white-space:nowrap">
        <span class="cinzel" style="font-size:0.8rem;color:var(--gold2)">${escHtml(s.set_code)}</span>
      </td>
      <td style="padding:8px;font-size:0.85rem">${escHtml(s.set_name)}</td>
      <td style="padding:8px;text-align:center;color:var(--muted);font-size:0.8rem">${escHtml(s.year||'—')}</td>
      <td style="padding:8px;text-align:center">
        <label class="toggle-switch" title="${s.has_unlimited ? 'Has Unlimited — click to set 1st Ed only' : '1st Ed only — click to enable Unlimited'}">
          <input type="checkbox" ${s.has_unlimited ? 'checked' : ''}
            onchange="toggleSetUnlimited('${s.id}', this.checked, this)">
          <span class="toggle-track"></span>
        </label>
      </td>
    </tr>`).join('');
}

async function toggleSetUnlimited(setId, newVal, checkbox) {
  checkbox.disabled = true;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sets?id=eq.${encodeURIComponent(setId)}`,
      { method: 'PATCH', headers: DB_HEADERS, body: JSON.stringify({ has_unlimited: newVal }) }
    );
    if (!res.ok) throw new Error(await res.text());
    const set = _allSets.find(s => s.id === setId);
    if (set) set.has_unlimited = newVal;
    showToast(`Updated ✓`);
  } catch (e) {
    checkbox.checked = !newVal;
    showToast('Failed: ' + e.message);
  }
  checkbox.disabled = false;
}

// ── Sync Sets — diff YGOPRODeck vs DB, present missing sets for import ─────────

const YGOPRO = 'https://db.ygoprodeck.com/api/v7';
const UNLIMITED_EXCEPTIONS = new Set(['POTE', 'ETCO']);

function parseSetYear(tcgDate) {
  if (!tcgDate) return null;
  if (tcgDate.includes('/')) return tcgDate.split('/')[2] || null;
  return tcgDate.split('-')[0] || null;
}

function inferHasUnlimited(setCode, year) {
  if (UNLIMITED_EXCEPTIONS.has(setCode)) return true;
  const yr = parseInt(year, 10);
  return !isNaN(yr) && yr < 2020;
}

let _syncMissingSets = []; // [{set_name, set_code, num_of_cards, tcg_date, year}]

async function openSyncSetsModal() {
  const modal = document.getElementById('sync-sets-modal');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setSyncState('loading');

  try {
    // Fetch YGOPRODeck set list + sets that have at least one card_inventory row in parallel
    // We check card_inventory (not sets table) so sets that were partially synced show up again
    const [ygoRes, invRes] = await Promise.all([
      fetch(`${YGOPRO}/cardsets.php`),
      fetch(`${SUPABASE_URL}/rest/v1/card_inventory?select=card_number&limit=100000`, { headers: DB_HEADERS_RETURN }),
    ]);
    if (!ygoRes.ok) throw new Error('YGOPRODeck unavailable');
    if (!invRes.ok) throw new Error('DB fetch failed');

    const ygoSets  = await ygoRes.json();
    const invRows  = await invRes.json();
    // Extract set prefix from card_number (e.g. "RA04-EN001" → "RA04")
    const dbCodes  = new Set(invRows.map(r => r.card_number?.split('-')[0]).filter(Boolean));

    _syncMissingSets = ygoSets
      .filter(s => s.set_code?.trim() && !dbCodes.has(s.set_code.trim()))
      .map(s => ({ ...s, set_code: s.set_code.trim(), year: parseSetYear(s.tcg_date) }))
      .sort((a, b) => (b.tcg_date || '').localeCompare(a.tcg_date || '')); // newest first

    if (_syncMissingSets.length === 0) {
      setSyncState('uptodate');
    } else {
      setSyncState('results');
      renderSyncList();
    }
  } catch (e) {
    setSyncState('error', e.message);
  }
}

function closeSyncSetsModal() {
  document.getElementById('sync-sets-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function setSyncState(state, msg = '') {
  document.getElementById('sync-loading').style.display  = state === 'loading'  ? 'flex'   : 'none';
  document.getElementById('sync-uptodate').style.display = state === 'uptodate' ? 'block'  : 'none';
  document.getElementById('sync-error').style.display    = state === 'error'    ? 'block'  : 'none';
  document.getElementById('sync-results').style.display  = state === 'results'  ? 'flex'   : 'none';
  if (state === 'results') document.getElementById('sync-results').style.flexDirection = 'column';
  if (state === 'error') document.getElementById('sync-error').textContent = 'Error: ' + msg;
}

function renderSyncList() {
  const count = _syncMissingSets.length;
  document.getElementById('sync-missing-count').textContent =
    `${count} set${count !== 1 ? 's' : ''} missing from your collection`;

  const list = document.getElementById('sync-set-list');
  list.innerHTML = _syncMissingSets.map((s, i) => `
    <label class="sync-set-row" style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--b1);cursor:pointer">
      <input type="checkbox" class="sync-set-cb" data-idx="${i}" checked style="width:16px;height:16px;flex-shrink:0">
      <div style="flex:1;min-width:0">
        <span class="cinzel" style="font-size:0.8rem;color:var(--gold2)">${escHtml(s.set_code)}</span>
        <span style="color:var(--txt);margin-left:8px;font-size:0.85rem">${escHtml(s.set_name)}</span>
      </div>
      <div style="text-align:right;flex-shrink:0;font-size:0.75rem;color:var(--muted)">
        ${s.num_of_cards ? s.num_of_cards + ' cards' : ''}<br>
        ${s.year ? s.year : ''}
      </div>
    </label>
  `).join('');

  updateSyncImportBtn();
  list.querySelectorAll('.sync-set-cb').forEach(cb => cb.addEventListener('change', updateSyncImportBtn));
}

function updateSyncImportBtn() {
  const checked = document.querySelectorAll('.sync-set-cb:checked').length;
  const btn = document.getElementById('sync-import-btn');
  btn.disabled = checked === 0;
  btn.textContent = checked > 0 ? `Import ${checked} Set${checked !== 1 ? 's' : ''}` : 'Import Selected';
}

function syncSelectAll(select) {
  document.querySelectorAll('.sync-set-cb').forEach(cb => cb.checked = select);
  updateSyncImportBtn();
}

async function runSyncImport() {
  const selected = [...document.querySelectorAll('.sync-set-cb:checked')]
    .map(cb => _syncMissingSets[parseInt(cb.dataset.idx)]);

  if (!selected.length) return;

  const btn     = document.getElementById('sync-import-btn');
  const prog    = document.getElementById('sync-progress');
  const progBar = document.getElementById('sync-progress-fill');
  const progTxt = document.getElementById('sync-progress-txt');
  btn.disabled  = true;
  prog.style.display = 'block';

  const BATCH = 250;
  let totalCards = 0, totalInv = 0, errors = [];

  // Load existing card_numbers + inventory keys to avoid touching existing rows
  progTxt.textContent = 'Loading existing DB state…';
  progBar.style.width = '5%';

  let existingCardNums, existingInvKeys;
  try {
    const [cnRes, invRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/cards?select=card_number,id&limit=50000`, { headers: DB_HEADERS_RETURN }),
      fetch(`${SUPABASE_URL}/rest/v1/card_inventory?select=card_number,rarity&limit=50000`, { headers: DB_HEADERS_RETURN }),
    ]);
    if (!cnRes.ok || !invRes.ok) throw new Error('Failed to load existing DB state');
    const cnRows  = await cnRes.json();
    const invRows = await invRes.json();
    existingCardNums = new Map(cnRows.map(r => [r.card_number, r.id]));
    existingInvKeys  = new Set(invRows.map(r => `${r.card_number}|${r.rarity}`));
  } catch (e) {
    progTxt.textContent = 'Failed: ' + e.message;
    btn.disabled = false;
    return;
  }

  for (let si = 0; si < selected.length; si++) {
    const s    = selected[si];
    const pct  = 10 + Math.round((si / selected.length) * 80);
    progBar.style.width = pct + '%';
    progTxt.textContent = `Fetching ${s.set_code} — ${s.set_name}…`;

    let setCards = [];
    try {
      const res = await fetch(`${YGOPRO}/cardinfo.php?cardset=${encodeURIComponent(s.set_name)}&tcgplayer_data=true`);
      if (res.status === 400) { continue; } // no TCG cards
      if (!res.ok) throw new Error(`YGOPRODeck returned ${res.status}`);
      const data = await res.json();
      setCards = data.data || [];
    } catch (e) {
      errors.push(`${s.set_code}: ${e.message}`);
      continue;
    }

    if (!setCards.length) continue;

    const year         = s.year;
    const hasUnlimited = inferHasUnlimited(s.set_code, year);

    const setRows  = [{ set_code: s.set_code, set_name: s.set_name, year, has_first_ed: true, has_unlimited: hasUnlimited }];
    const cardRows = [];
    const invRows  = [];

    for (const card of setCards) {
      const apiId    = String(card.id);
      const cardName = card.name;
      const entries  = (card.card_sets || []).filter(e => e.set_name === s.set_name);

      for (const entry of entries) {
        const cardNumber = entry.set_code?.trim();
        const rarity     = entry.set_rarity?.trim();
        if (!cardNumber || !rarity) continue;

        if (!existingCardNums.has(cardNumber)) {
          const newId = crypto.randomUUID();
          cardRows.push({ id: newId, card_number: cardNumber, card_name: cardName, set_name: s.set_name, year, api_id: apiId });
          existingCardNums.set(cardNumber, newId);
        }

        const invKey = `${cardNumber}|${rarity}`;
        if (!existingInvKeys.has(invKey)) {
          invRows.push({
            id: crypto.randomUUID(),
            card_id: existingCardNums.get(cardNumber),
            card_number: cardNumber, card_name: cardName, set_name: s.set_name, rarity,
            qty_fe_nm: 0, qty_fe_lp: 0, qty_fe_mp: 0,
            qty_un_nm: 0, qty_un_lp: 0, qty_un_mp: 0,
            qty_binder_fe_nm: 0, qty_binder_un_nm: 0,
            listed: false, needs_review: false,
          });
          existingInvKeys.add(invKey);
          totalInv++;
        }
      }
      totalCards += cardRows.length ? 1 : 0;
    }

    const ignore = { ...DB_HEADERS, 'Prefer': 'resolution=ignore-duplicates,return=minimal' };

    async function insertBatch(table, rows) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
          method: 'POST', headers: ignore, body: JSON.stringify(rows.slice(i, i + BATCH)),
        });
        if (!res.ok) throw new Error(`INSERT ${table}: ${await res.text()}`);
      }
    }

    try {
      progTxt.textContent = `Saving ${s.set_code}… (${setCards.length} cards)`;
      await insertBatch('sets', setRows);
      if (cardRows.length) await insertBatch('cards', cardRows);
      if (invRows.length)  await insertBatch('card_inventory', invRows);
    } catch (e) {
      errors.push(`${s.set_code} save failed: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 200)); // respect YGOPRODeck rate limits
  }

  progBar.style.width = '100%';
  const errMsg = errors.length ? `\n⚠ ${errors.length} error(s): ${errors.join('; ')}` : '';
  progTxt.textContent = `Done — ${totalInv} new inventory rows added.${errMsg}`;

  // Refresh sets cache so the Sets modal shows the new entries
  _allSets = [];

  btn.disabled = false;
  btn.textContent = 'Done ✓';
}
