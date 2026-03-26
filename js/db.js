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
  // card_number starts with "SETCODE-"
  const params = {
    card_number: `ilike.${setCode}-%`,
    order: 'card_number.asc',
    limit: 1000,
  };
  return dbGet('cards', params);
}

async function getCardsPage({ search = '', rarity = '', location = '', listed = '',
                               page = 0, pageSize = 50,
                               sortCol = 'card_number', sortDir = 'asc' } = {}) {
  const params = new URLSearchParams({
    order: `${sortCol}.${sortDir}`,
    limit: pageSize,
    offset: page * pageSize,
  });
  if (search)            params.set('or',       `(card_name.ilike.*${search}*,card_number.ilike.*${search}*,set_name.ilike.*${search}*)`);
  if (rarity)            params.set('rarity',   `eq.${rarity}`);
  if (location)          params.set('location', `eq.${location}`);
  if (listed === 'true') params.set('listed',   'eq.true');
  if (listed === 'false')params.set('listed',   'eq.false');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/cards?${params}`, {
    headers: { ...DB_HEADERS_RETURN, 'Prefer': 'count=exact' },
  });
  if (!res.ok) throw new Error(`DB GET cards failed: ${res.status} ${await res.text()}`);
  const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0', 10);
  return { rows: await res.json(), total };
}

async function getCardById(id) {
  const rows = await dbGet('cards', { id: `eq.${id}` });
  return rows[0] || null;
}

async function saveCard(card) {
  return dbUpsert('cards', card);
}

async function updateCard(card) {
  return dbUpdate('cards', card);
}

async function toggleListed(id, listed) {
  return dbUpdate('cards', { id, listed });
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
