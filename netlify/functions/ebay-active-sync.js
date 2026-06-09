// ebay-active-sync.js — Sync card_inventory.listed with active eBay listings
//
// GET /.netlify/functions/ebay-active-sync           → full sync
// GET /.netlify/functions/ebay-active-sync?dry_run=1 → return matches without saving
// GET /.netlify/functions/ebay-active-sync?debug_env=1
//
// Matches by ebay_listing_id first, then falls back to card_number extracted from title.
// Cards currently marked listed=true that have no matching active listing → listed=false.

const https = require('https');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
  'Content-Type':                 'application/json',
};

// ── HTTP helper ───────────────────────────────────────────────────────────────

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpPost(host, path, headers, body) {
  return request({ method: 'POST', host, path, headers }, body);
}

function httpGet(host, path, headers) {
  return request({ method: 'GET', host, path, headers }, null);
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

async function getAccessToken(appId, certId, refreshToken) {
  const creds = Buffer.from(`${appId}:${certId}`).toString('base64');
  const scope  = encodeURIComponent('https://api.ebay.com/oauth/api_scope/sell.inventory');
  const body   = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&scope=${scope}`;
  const res    = await httpPost('api.ebay.com', '/identity/v1/oauth2/token', {
    'Content-Type':  'application/x-www-form-urlencoded',
    'Authorization': `Basic ${creds}`,
    'Content-Length': Buffer.byteLength(body),
  }, body);
  if (!res.body.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

// ── Fetch all active listings via Trading API ─────────────────────────────────

async function fetchActiveListings(accessToken, appId) {
  const items = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${accessToken}</eBayAuthToken></RequesterCredentials>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>${page}</PageNumber>
    </Pagination>
    <Sort>TimeLeft</Sort>
  </ActiveList>
  <OutputSelector>ActiveList.ItemArray.Item.ItemID</OutputSelector>
  <OutputSelector>ActiveList.ItemArray.Item.Title</OutputSelector>
  <OutputSelector>ActiveList.PaginationResult</OutputSelector>
</GetMyeBaySellingRequest>`;

    const res = await httpPost(
      'api.ebay.com',
      '/ws/api.dll',
      {
        'X-EBAY-API-CALL-NAME':           'GetMyeBaySelling',
        'X-EBAY-API-SITEID':              '2',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
        'X-EBAY-API-APP-NAME':            appId,
        'Content-Type':                   'text/xml',
        'Content-Length':                 Buffer.byteLength(xml),
      },
      xml,
    );

    const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);

    // Parse items from XML
    const itemRe = /<Item>([\s\S]*?)<\/Item>/g;
    let m;
    let pageCount = 0;
    while ((m = itemRe.exec(text)) !== null) {
      const block  = m[1];
      const idM    = block.match(/<ItemID>(\d+)<\/ItemID>/);
      const titleM = block.match(/<Title>([^<]+)<\/Title>/);
      if (idM) {
        items.push({ itemId: idM[1], title: titleM ? titleM[1] : '' });
        pageCount++;
      }
    }

    // Check if there are more pages
    const totalPagesM = text.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/);
    const totalPages  = totalPagesM ? parseInt(totalPagesM[1], 10) : 1;
    hasMore = page < totalPages;
    page++;
  }

  return items;
}

// ── Extract card number from title ────────────────────────────────────────────

function extractCardNumber(title) {
  const m = title.match(/\b([A-Z0-9]{2,8}-[A-Z]{2}\d{3}[A-Z]?)\b/i);
  return m ? m[1].toUpperCase() : null;
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function supabaseGet(supabaseUrl, serviceKey, path) {
  const url = new URL(`${supabaseUrl}/rest/v1/${path}`);
  const res = await httpGet(url.host, url.pathname + url.search, {
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Accept':        'application/json',
  });
  return res;
}

async function supabasePatch(supabaseUrl, serviceKey, path, body) {
  const url     = new URL(`${supabaseUrl}/rest/v1/${path}`);
  const payload = JSON.stringify(body);
  return httpPost(url.host, url.pathname + url.search, {
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=minimal',
    'Content-Length': Buffer.byteLength(payload),
    'X-HTTP-Method-Override': 'PATCH',
  }, payload);
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const params = event.queryStringParameters || {};

  if (params.debug_env === '1') {
    const keys = ['EBAY_APP_ID','EBAY_CERT_ID','EBAY_REFRESH_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_KEY','SYNC_API_KEY'];
    return {
      statusCode: 200, headers: CORS_HEADERS,
      body: JSON.stringify(Object.fromEntries(
        keys.map(k => [k, process.env[k] ? `set (${process.env[k].length} chars)` : 'MISSING'])
      )),
    };
  }

  const apiKey = event.headers['x-api-key'] || params.api_key;
  if (apiKey !== process.env.SYNC_API_KEY) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const dryRun = params.dry_run === '1';

    const missing = ['EBAY_APP_ID','EBAY_CERT_ID','EBAY_REFRESH_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_KEY']
      .filter(k => !process.env[k]);
    if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);

    const { EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

    // 1. Fetch active eBay listings and all currently-listed inventory rows in parallel
    const [accessToken, inventoryRes] = await Promise.all([
      getAccessToken(EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN),
      supabaseGet(SUPABASE_URL, SUPABASE_SERVICE_KEY, 'card_inventory?select=id,card_number,ebay_listing_id&limit=10000'),
    ]);

    const activeListings = await fetchActiveListings(accessToken, EBAY_APP_ID);

    const inventoryRows = Array.isArray(inventoryRes.body) ? inventoryRes.body : [];

    // 2. Build lookup sets from active listings
    const activeItemIds    = new Set(activeListings.map(l => l.itemId));
    const activeCardNums   = new Set(
      activeListings.map(l => extractCardNumber(l.title)).filter(Boolean)
    );

    // 3. Classify each inventory row
    const toMarkListed    = [];  // ids to set listed=true
    const toMarkUnlisted  = [];  // ids to set listed=false

    for (const row of inventoryRows) {
      const matchById  = row.ebay_listing_id && activeItemIds.has(row.ebay_listing_id);
      const matchByNum = row.card_number && activeCardNums.has(row.card_number.toUpperCase());
      if (matchById || matchByNum) {
        toMarkListed.push(row.id);
      } else {
        // Only unlist if we have some active listings (avoid wiping on empty response)
        if (activeListings.length > 0) toMarkUnlisted.push(row.id);
      }
    }

    const result = {
      active_listings: activeListings.length,
      matched_listed:  toMarkListed.length,
      matched_unlisted: toMarkUnlisted.length,
      dry_run: dryRun,
    };

    if (dryRun) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ...result, listings: activeListings }) };
    }

    // 4. Apply updates in batches of 250
    const BATCH = 250;

    for (let i = 0; i < toMarkListed.length; i += BATCH) {
      const ids = toMarkListed.slice(i, i + BATCH).map(id => `"${id}"`).join(',');
      await supabasePatch(SUPABASE_URL, SUPABASE_SERVICE_KEY,
        `card_inventory?id=in.(${ids})`,
        { listed: true }
      );
    }

    for (let i = 0; i < toMarkUnlisted.length; i += BATCH) {
      const ids = toMarkUnlisted.slice(i, i + BATCH).map(id => `"${id}"`).join(',');
      await supabasePatch(SUPABASE_URL, SUPABASE_SERVICE_KEY,
        `card_inventory?id=in.(${ids})`,
        { listed: false }
      );
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, ...result }) };

  } catch (err) {
    console.error('ebay-active-sync error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
