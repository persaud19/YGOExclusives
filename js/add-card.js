// ─── add-card.js — Phase 4: Add Card ─────────────────────────────────────────
// TODO: Phase 4

let addCardInitialized = false;

function initAddCard() {
  if (addCardInitialized) return;
  addCardInitialized = true;
  wireAddCardSearch();
}

function wireAddCardSearch() {
  const searchEl = document.getElementById('add-card-search');
  const resultsEl = document.getElementById('add-card-results');
  if (!searchEl) return;

  let debounce;
  searchEl.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = searchEl.value.trim();
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    debounce = setTimeout(() => searchYGO(q, resultsEl), 350);
  });
}

async function searchYGO(q, resultsEl) {
  try {
    const url = `${YGOPRO_API}?fname=${encodeURIComponent(q)}&num=20&offset=0`;
    const res = await fetch(url);
    const data = await res.json();
    const cards = data.data || [];
    if (!cards.length) { resultsEl.innerHTML = '<p class="muted small" style="padding:10px">No results</p>'; return; }
    resultsEl.innerHTML = cards.map(c => `
      <div class="search-result-item" onclick="selectYGOCard(${JSON.stringify(c).replace(/"/g,'&quot;')})">
        <img src="${CARD_IMG(c.id)}" alt="" loading="lazy">
        <div>
          <div style="font-weight:600;font-size:0.85rem">${escHtml(c.name)}</div>
          <div class="muted small">${escHtml(c.type||'')}</div>
        </div>
      </div>`).join('');
  } catch (e) {
    resultsEl.innerHTML = `<p class="red small" style="padding:10px">Search error: ${e.message}</p>`;
  }
}

function selectYGOCard(cardData) {
  document.getElementById('add-card-results').innerHTML = '';
  document.getElementById('add-card-search').value = cardData.name;
  document.getElementById('add-card-name').value   = cardData.name;
  document.getElementById('add-card-api-id').value  = cardData.id;

  // Auto-fill TCG price if available
  const price = cardData.card_prices?.[0]?.tcgplayer_price || 0;
  if (price) {
    document.getElementById('add-tcg-price').value = price;
    autoFillPrices(price);
  }
}

function autoFillPrices(p) {
  p = parseFloat(p) || 0;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val.toFixed(2); };
  set('add-fe-nm',  p * PRICE_MULT.first_ed_nm);
  set('add-fe-lp',  p * PRICE_MULT.first_ed_lp);
  set('add-fe-mp',  p * PRICE_MULT.first_ed_mp);
  set('add-un-nm',  p * PRICE_MULT.unlimited_nm);
  set('add-un-lp',  p * PRICE_MULT.unlimited_lp);
  set('add-un-mp',  p * PRICE_MULT.unlimited_mp);
}

async function submitAddCard(e) {
  e.preventDefault();
  const get = id => document.getElementById(id)?.value?.trim() || '';
  const getNum = id => parseFloat(document.getElementById(id)?.value) || 0;

  const cardNumber = get('add-card-number');
  if (!cardNumber) { showToast('Card # is required'); return; }

  const card = {
    id:                      `${cardNumber}-${get('add-rarity') || 'NM'}`.replace(/\s+/g, '-'),
    card_number:             cardNumber,
    card_name:               get('add-card-name'),
    api_id:                  parseInt(get('add-card-api-id')) || null,
    rarity:                  get('add-rarity'),
    set_name:                get('add-set-name'),
    year:                    get('add-year'),
    location:                get('add-location') || 'Basement Box',
    listed:                  document.getElementById('add-listed')?.checked || false,
    first_ed_nm:             getNum('add-fe-nm'),
    first_ed_lp:             getNum('add-fe-lp'),
    first_ed_mp:             getNum('add-fe-mp'),
    unlimited_nm:            getNum('add-un-nm'),
    unlimited_lp:            getNum('add-un-lp'),
    unlimited_mp:            getNum('add-un-mp'),
    tcg_market_price:        getNum('add-tcg-price'),
    tcg_price_at_acquisition:getNum('add-tcg-price'),
    acquisition_cost:        getNum('add-acq-cost'),
    acquisition_shipping:    getNum('add-acq-shipping'),
    acquisition_platform_fee:getNum('add-acq-fee'),
    acquisition_source:      get('add-acq-source'),
    acquisition_date:        get('add-acq-date') || null,
    added_at:                new Date().toISOString(),
    updated_at:              new Date().toISOString(),
  };

  try {
    await saveCard(card);
    showToast('Card saved!');
    document.getElementById('add-card-form')?.reset();
    document.getElementById('add-card-results').innerHTML = '';
  } catch (e) {
    showToast('Save failed: ' + e.message);
  }
}
