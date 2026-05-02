// ─── db.js — All Supabase REST calls (plain fetch, NO SDK) ───────────────────

// ─── Generic helpers ──────────────────────────────────────────────────────────

async function dbGet(table, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, {
    headers: { ...DB_HEADERS_RETURN },
  });
  if (!res.ok) throw new Error(`DB GET ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function dbUpsert(table, rows, headers = DB_HEADERS) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!res.ok) throw new Error(`DB UPSERT ${table} failed: ${res.status} ${await res.text()}`);
  return res;
}

async function dbInsert(table, row) {
  const headers = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer':        'return=minimal',
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`DB INSERT ${table} failed: ${res.status} ${await res.text()}`);
  return res;
}

async function dbUpdate(table, row, matchKey = 'id') {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${matchKey}=eq.${encodeURIComponent(row[matchKey])}`,
    {
      method: 'PATCH',
      headers: DB_HEADERS,
      body: JSON.stringify(row),
    }
  );
  if (!res.ok) throw new Error(`DB UPDATE ${table} failed: ${res.status} ${await res.text()}`);
  return res;
}

async function dbDelete(table, matchKey, matchVal) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${matchKey}=eq.${encodeURIComponent(matchVal)}`,
    { method: 'DELETE', headers: DB_HEADERS }
  );
  if (!res.ok) throw new Error(`DB DELETE ${table} failed: ${res.status} ${await res.text()}`);
  return res;
}

// ─── app_config ───────────────────────────────────────────────────────────────

async function getConfig(key) {
  const rows = await dbGet('app_config', { key: `eq.${key}` });
  return rows.length ? rows[0].value : null;
}

async function setConfig(key, value) {
  return dbUpsert('app_config', { key, value });
}

// ─── Cards ────────────────────────────────────────────────────────────────────

async function getCardsBySet(setCode) {
  // Fetch edition flags for this set
  const setRes = await fetch(
    `${SUPABASE_URL}/rest/v1/sets?set_code=eq.${encodeURIComponent(setCode)}&select=has_unlimited,has_first_ed&limit=1`,
    { headers: DB_HEADERS_RETURN }
  );
  const setRows = setRes.ok ? await setRes.json() : [];
  const hasUnlimited = setRows[0]?.has_unlimited ?? true;
  const hasFirstEd   = setRows[0]?.has_first_ed  ?? true;

  const params = new URLSearchParams({
    select:      '*,cards(api_id,year)',
    card_number: `ilike.${setCode}-%`,
    order:       'card_number.asc,rarity_order.asc',
    limit:       1000,
  });
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/card_inventory?${params}`,
    { headers: DB_HEADERS_RETURN }
  );
  if (!res.ok) throw new Error(`DB GET card_inventory failed: ${res.status} ${await res.text()}`);
  return (await res.json()).map(r => ({
    id:               r.id,
    card_number:      r.card_number,
    card_name:        r.card_name || '',
    rarity:           r.rarity,
    set_name:         r.set_name || '',
    year:             r.cards?.year,
    api_id:           r.cards?.api_id,
    has_unlimited:    hasUnlimited,
    has_first_ed:     hasFirstEd,
    fe_nm:            r.qty_fe_nm,    fe_lp: r.qty_fe_lp,    fe_mp: r.qty_fe_mp,
    un_nm:            r.qty_un_nm,    un_lp: r.qty_un_lp,    un_mp: r.qty_un_mp,
    binder_fe_nm:     r.qty_binder_fe_nm,
    binder_un_nm:     r.qty_binder_un_nm,
    has_alt_art:      r.has_alt_art,
    alt_fe_nm:        r.qty_alt_fe_nm,
    alt_un_nm:        r.qty_alt_un_nm,
    tcg_market_price: r.tcg_price,
    tcg_price_cad:    r.tcg_price_cad,
    acquisition_cost: r.acquisition_cost,
    listed:           r.listed,
    needs_review:     r.needs_review,
    qty_total:        r.qty_total,
  }));
}

async function getCardsPage(opts = {}) {
  return getInventoryPage(opts);
}

// ─── card_inventory query ─────────────────────────────────────────────────────
async function getInventoryPage({ search = '', rarity = '', listed = '',
                                   page = 0, pageSize = 50,
                                   sortCol = 'card_number', sortDir = 'asc' } = {}) {
  const colMap = { tcg_market_price: 'tcg_price', tcg_price_cad: 'tcg_price_cad' };
  const mappedSort = colMap[sortCol] || sortCol;

  const params = new URLSearchParams({
    select: '*,cards(api_id,year)',
    order:  `${mappedSort}.${sortDir}`,
    limit:  pageSize,
    offset: page * pageSize,
  });
  if (search)   params.set('or',     `(card_name.ilike.*${search}*,card_number.ilike.*${search}*,set_name.ilike.*${search}*)`);
  if (rarity)   params.set('rarity', `eq.${rarity}`);
  if (listed === 'true')  params.set('listed', 'eq.true');
  if (listed === 'false') params.set('listed', 'eq.false');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/card_inventory?${params}`, {
    headers: { ...DB_HEADERS_RETURN, 'Prefer': 'count=exact' },
  });
  if (!res.ok) throw new Error(`DB GET card_inventory failed: ${res.status} ${await res.text()}`);
  const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0', 10);
  const raw   = await res.json();

  // Normalize new schema fields → old field names so the renderer works unchanged
  const rows = raw.map(r => ({
    id:               r.id,
    card_number:      r.card_number,
    card_name:        r.card_name || '',
    rarity:           r.rarity,
    higher_rarity:    null,
    set_name:         r.set_name || '',
    year:             r.cards?.year,
    api_id:           r.cards?.api_id,
    tcg_market_price: r.tcg_price,
    tcg_price_cad:    r.tcg_price_cad,
    tcg_low_price:    r.tcg_low_price,
    ebay_low_price:   r.ebay_low_price,
    hr_tcg_price:     null,
    hr_tcg_low_price: null,
    hr_ebay_price:    null,
    acquisition_cost: r.acquisition_cost,
    location:         null,
    fe_nm:            r.qty_fe_nm,
    fe_lp:            r.qty_fe_lp,
    fe_mp:            r.qty_fe_mp,
    un_nm:            r.qty_un_nm,
    un_lp:            r.qty_un_lp,
    un_mp:            r.qty_un_mp,
    binder_fe_nm:     r.qty_binder_fe_nm,
    binder_un_nm:     r.qty_binder_un_nm,
    hr_qty_nm:        0,
    hr_qty_lp:        0,
    listed:           r.listed,
    needs_review:     r.needs_review,
    qty_total:        r.qty_total,
  }));
  return { rows, total };
}

async function getCardById(id) {
  const rows = await dbGet('cards', { id: `eq.${id}` });
  return rows[0] || null;
}

async function saveCard(card) {
  return dbUpsert('cards', card);
}

async function updateCard(card) {
  const fieldMap = {
    fe_nm: 'qty_fe_nm', fe_lp: 'qty_fe_lp', fe_mp: 'qty_fe_mp',
    un_nm: 'qty_un_nm', un_lp: 'qty_un_lp', un_mp: 'qty_un_mp',
    binder_fe_nm: 'qty_binder_fe_nm', binder_un_nm: 'qty_binder_un_nm',
    alt_fe_nm: 'qty_alt_fe_nm', alt_un_nm: 'qty_alt_un_nm',
    tcg_market_price: 'tcg_price',
  };
  const drop = new Set(['higher_rarity','hr_fe_nm','hr_fe_lp','hr_qty_nm','hr_qty_lp',
    'hr_location','hr_tcg_price','set_name','year','card_name','api_id','updated_at',
    'first_ed_nm','first_ed_lp','first_ed_mp','unlimited_nm','unlimited_lp','unlimited_mp',
    'location','rarity']);
  const mapped = { id: card.id };
  for (const [k, v] of Object.entries(card)) {
    if (k === 'id' || drop.has(k)) continue;
    mapped[fieldMap[k] || k] = v;
  }
  return dbUpdate('card_inventory', mapped);
}

async function toggleListed(id, listed) {
  return dbUpdate('card_inventory', { id, listed });
}

async function upsertCardsBatch(rows) {
  return dbUpsert('cards', rows);
}

// ─── Sales ────────────────────────────────────────────────────────────────────

async function getSalesPage({ page = 0, pageSize = 50 } = {}) {
  const params = {
    order: 'sale_date.desc',
    limit: pageSize,
    offset: page * pageSize,
  };
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/sales?${new URLSearchParams(params).toString()}`,
    {
      method: 'HEAD',
      headers: { ...DB_HEADERS_RETURN, 'Prefer': 'count=exact' },
    }
  );
  const total = parseInt(countRes.headers.get('content-range')?.split('/')[1] || '0', 10);
  const rows = await dbGet('sales', params);
  return { rows, total };
}

async function saveSale(sale) {
  return dbUpsert('sales', sale);
}

async function deleteSale(id) {
  return dbDelete('sales', 'id', id);
}

// ─── Monthly P&L ─────────────────────────────────────────────────────────────

async function getMonthlySales() {
  // Returns all sales, we group client-side (not 31k rows, sales are manageable)
  return dbGet('sales', { order: 'sale_date.asc' });
}
