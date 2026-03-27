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
  document.getElementById('col-import-btn')?.addEventListener('click', openImportModal);
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
  tbody.innerHTML = '<tr><td colspan="12" class="text-center muted" style="padding:24px">Loading…</td></tr>';
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
    tbody.innerHTML = `<tr><td colspan="12" class="red text-center" style="padding:24px">Error: ${escHtml(e.message)}</td></tr>`;
  }
}

function renderCollectionRows(rows, tbody) {
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="text-center muted" style="padding:24px">No cards found</td></tr>';
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
      <td><span class="badge ${getRarityBadgeClass(card.rarity)}">${escHtml(card.rarity||'')}</span></td>
      <td class="small muted" style="white-space:nowrap">${escHtml(card.set_name||'')}</td>
      <td class="cinzel" style="color:var(--gold2);white-space:nowrap">${(card.tcg_market_price > 0) ? '$'+Number(card.tcg_market_price).toFixed(2) : '—'}</td>
      <td class="small muted" style="white-space:nowrap">${(card.ebay_low_price > 0) ? '$'+Number(card.ebay_low_price).toFixed(2) : '—'}</td>
      <td class="small muted">${(card.acquisition_cost > 0) ? '$'+Number(card.acquisition_cost).toFixed(2) : '—'}</td>
      <td class="small muted">${escHtml(card.location||'')}</td>
      <td>
        <div style="display:flex;align-items:center;gap:4px">
          <button class="qty-btn" onclick="colQtyAdj('${card.id}','un_nm',${card.un_nm||0},this,-1)">−</button>
          <span class="cinzel" style="min-width:22px;text-align:center;font-size:0.9rem" id="colqty-${card.id}">${card.un_nm||0}</span>
          <button class="qty-btn" onclick="colQtyAdj('${card.id}','un_nm',${card.un_nm||0},this,1)">+</button>
        </div>
      </td>
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
    await dbDelete('cards', 'id', cardId);
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
  sv('edit-hr-qty-nm', card.hr_qty_nm || 0);
  sv('edit-hr-qty-lp', card.hr_qty_lp || 0);

  // Prices — 4 market metrics
  sv('edit-tcg-low',    card.tcg_low_price    || '');
  sv('edit-tcg-market', card.tcg_market_price || '');
  sv('edit-ebay-low',   card.ebay_low_price   || '');
  sv('edit-ebay-sold',  card.ebay_sold_price  || '');
  sv('edit-first-ed-nm',  card.first_ed_nm  || '');
  sv('edit-first-ed-lp',  card.first_ed_lp  || '');
  sv('edit-first-ed-mp',  card.first_ed_mp  || '');
  sv('edit-unlimited-nm', card.unlimited_nm || '');
  sv('edit-unlimited-lp', card.unlimited_lp || '');
  sv('edit-unlimited-mp', card.unlimited_mp || '');

  // Higher rarity
  sv('edit-higher-rarity', card.higher_rarity || '');
  document.getElementById('edit-hr-qty-row').style.display = card.higher_rarity ? '' : 'none';

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
    hr_qty_nm:                gi('edit-hr-qty-nm'),
    hr_qty_lp:                gi('edit-hr-qty-lp'),
    higher_rarity:            gv('edit-higher-rarity'),
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
  const baseId = { 'tcg-low': 'edit-tcg-low', 'tcg-market': 'edit-tcg-market',
                   'ebay-low': 'edit-ebay-low', 'ebay-sold': 'edit-ebay-sold' };
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
      download: `shadowrealm-${new Date().toISOString().slice(0,10)}.csv`,
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

// ─── Import Set Modal ─────────────────────────────────────────────────────────
let _importRows = [];

const IMPORT_TEMPLATE_HEADERS = ['Card #','Card Name','Type','ATR','Sub Type','LVL','ATK','DEF','Rarity','Set Name','Year'];

function openImportModal() {
  _importRows = [];
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-preview').textContent = '';
  document.getElementById('import-progress').style.display = 'none';
  document.getElementById('import-go-btn').disabled = true;
  document.getElementById('import-set-modal')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeImportModal() {
  document.getElementById('import-set-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function downloadImportTemplate() {
  const sample = [
    IMPORT_TEMPLATE_HEADERS,
    ['MAZE-EN001','Shadow Ghoul','Effect Monster','DARK','Zombie','5','1600','1300','Rare','Maze of Millennia','2024'],
    ['MAZE-EN002','Labyrinth Wall','Spell','','Field','','','','Rare','Maze of Millennia','2024'],
  ];
  const csv = sample.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv),
    download: 'import-template.csv',
  });
  a.click();
}

function previewImportFile(input) {
  _importRows = [];
  const previewEl = document.getElementById('import-preview');
  const goBtn     = document.getElementById('import-go-btn');
  goBtn.disabled  = true;

  const file = input.files?.[0];
  if (!file) { previewEl.textContent = ''; return; }

  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      previewEl.textContent = 'File appears empty.';
      return;
    }

    // Parse header row — find column indices
    const headers = parseCSVRow(lines[0]).map(h => h.trim().toLowerCase());
    const idx = {
      card_number: findCol(headers, ['card #','card#']),
      card_name:   findCol(headers, ['card name','cardname','name']),
      rarity:      findCol(headers, ['rarity']),
      set_name:    findCol(headers, ['set name','setname','set']),
      year:        findCol(headers, ['year']),
    };

    if (idx.card_number < 0 || idx.card_name < 0) {
      previewEl.innerHTML = '<span class="red">Missing required columns: "Card #" and "Card Name".</span>';
      return;
    }

    _importRows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVRow(lines[i]);
      const num  = cols[idx.card_number]?.trim();
      const name = cols[idx.card_name]?.trim();
      if (!num && !name) continue;
      _importRows.push({
        id:          crypto.randomUUID(),
        card_number: num  || '',
        card_name:   name || '',
        rarity:      idx.rarity  >= 0 ? (cols[idx.rarity]?.trim()   || '') : '',
        set_name:    idx.set_name >= 0 ? (cols[idx.set_name]?.trim() || '') : '',
        year:        idx.year     >= 0 ? (cols[idx.year]?.trim()     || null) : null,
        fe_nm: 0, fe_lp: 0, fe_mp: 0,
        un_nm: 0, un_lp: 0, un_mp: 0,
        listed: false,
      });
    }

    previewEl.innerHTML = `<span style="color:var(--green)">&#10003; ${_importRows.length} card${_importRows.length !== 1 ? 's' : ''} ready to import</span>`;
    goBtn.disabled = _importRows.length === 0;
  };
  reader.readAsText(file);
}

function findCol(headers, aliases) {
  for (const a of aliases) {
    const i = headers.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

function parseCSVRow(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === ',' && !inQuote) {
      result.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

async function runImport() {
  if (!_importRows.length) return;
  const goBtn   = document.getElementById('import-go-btn');
  const progEl  = document.getElementById('import-progress');
  const barEl   = document.getElementById('import-bar');
  const statEl  = document.getElementById('import-status');

  goBtn.disabled    = true;
  progEl.style.display = '';
  const BATCH = 250;
  let done = 0, errors = 0;

  for (let i = 0; i < _importRows.length; i += BATCH) {
    const batch = _importRows.slice(i, i + BATCH);
    try {
      await upsertCardsBatch(batch);
      done += batch.length;
    } catch (e) {
      errors += batch.length;
    }
    const pct = Math.round(((i + batch.length) / _importRows.length) * 100);
    barEl.style.width = pct + '%';
    statEl.textContent = `${Math.min(i + batch.length, _importRows.length)} / ${_importRows.length} processed…`;
  }

  statEl.textContent = errors
    ? `Done — ${done} imported, ${errors} failed.`
    : `&#10003; All ${done} cards imported successfully.`;
  showToast(`Import complete: ${done} cards added`);
  colPage = 0;
  loadCollectionPage();
  goBtn.disabled = false;
}
