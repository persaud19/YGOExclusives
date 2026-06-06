// ebay-queue-prices.js
// Fetches eBay lowest listed price for all pending listing_queue items.
// Uses Browse API (Finding API was shut down by eBay).
// Writes ebay_low_cad back to listing_queue AND card_inventory (matched by card_number+rarity).
// GET /.netlify/functions/ebay-queue-prices  (requires X-Api-Key header)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
  'Content-Type':                 'application/json',
};

function getRarityKeyword(rarity) {
  const r = (rarity || '').toLowerCase().trim();
  if (r.includes('starlight'))           return 'starlight';
  if (r.includes('quarter century'))     return 'quarter century';
  if (r.includes('prismatic secret'))    return 'prismatic secret';
  if (r.includes('prismatic ultimate'))  return 'prismatic ultimate';
  if (r.includes('prismatic collector')) return 'prismatic collectors';
  if (r.includes('collector'))           return 'collectors rare';
  if (r.includes('pharaoh'))             return 'pharaohs rare';
  if (r.includes('ghost/gold'))          return 'ghost gold rare';
  if (r.includes('platinum secret'))     return 'platinum secret';
  if (r.includes('premium gold'))        return 'premium gold';
  if (r.includes('gold secret'))         return 'gold secret rare';
  if (r.includes('gold'))                return 'gold rare';
  if (r.includes('ultimate'))            return 'ultimate rare';
  if (r.includes('ghost'))               return 'ghost rare';
  if (r.includes('starfoil'))            return 'starfoil';
  if (r.includes('shatterfoil'))         return 'shatterfoil';
  if (r.includes('mosaic'))              return 'mosaic rare';
  if (r.includes('10000'))               return '10000 secret';
  if (r.includes('secret'))              return 'secret rare';
  if (r.includes('ultra'))               return 'ultra rare';
  if (r.includes('super'))               return 'super rare';
  return rarity.replace(/'/g, '').toLowerCase();
}

// Get OAuth app token via Client Credentials grant (no user login needed)
async function getAppToken(clientId, clientSecret) {
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization':  `Basic ${creds}`,
      'Content-Type':   'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

// Parse Browse API item summaries → sorted array of (price + shipping) in USD
function parseBrowsePrices(items) {
  return (items || [])
    .map(item => {
      const price    = parseFloat(item.price?.value || 0);
      const shipping = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || 0);
      return price + shipping;
    })
    .filter(p => p > 0)
    .sort((a, b) => a - b);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  const params = event.queryStringParameters || {};
  const apiKey = event.headers['x-api-key'] || params.api_key;
  if (apiKey !== process.env.SYNC_API_KEY) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, EBAY_APP_ID, EBAY_CERT_ID } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !EBAY_APP_ID || !EBAY_CERT_ID) {
    const missing = [
      !SUPABASE_URL        && 'SUPABASE_URL',
      !SUPABASE_SERVICE_KEY && 'SUPABASE_SERVICE_KEY',
      !EBAY_APP_ID         && 'EBAY_APP_ID',
      !EBAY_CERT_ID        && 'EBAY_CERT_ID',
    ].filter(Boolean);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: `Missing env vars: ${missing.join(', ')}` }) };
  }

  const sbHeaders = {
    'apikey':        SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=minimal',
  };

  // 1. Fetch all pending listing_queue items
  const qRes = await fetch(
    `${SUPABASE_URL}/rest/v1/listing_queue?status=eq.pending&select=id,card_number,rarity`,
    { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const items = await qRes.json();
  if (!Array.isArray(items) || items.length === 0) {
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ updated: 0, total: 0 }) };
  }

  // 2. Get live USD→CAD rate
  let cadRate = 1.38;
  try {
    const rateRes  = await fetch('https://api.frankfurter.app/latest?from=USD&to=CAD');
    const rateData = await rateRes.json();
    if (rateData?.rates?.CAD) cadRate = rateData.rates.CAD;
  } catch (_) {}

  // 3. Get eBay OAuth app token (Client Credentials — no user login needed)
  let appToken;
  try {
    appToken = await getAppToken(EBAY_APP_ID, EBAY_CERT_ID);
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: `eBay token failed: ${e.message}` }) };
  }

  // 4. Fetch eBay prices concurrently via Browse API
  let firstEbayError   = null;
  let firstRawResponse = null;

  const skippedNoRarity = items.filter(i => !i.card_number || !i.rarity);

  const results = await Promise.all(items.map(async item => {
    if (!item.card_number || !item.rarity) return { ...item, ebay_low_cad: null, skipped: true };
    try {
      const query  = `${item.card_number} ${getRarityKeyword(item.rarity)}`;
      const params = new URLSearchParams({ q: query, sort: 'price', limit: '5' });
      const url    = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`;

      const res  = await fetch(url, {
        headers: {
          'Authorization':             `Bearer ${appToken}`,
          'X-EBAY-C-MARKETPLACE-ID':   'EBAY_US',
          'Content-Type':              'application/json',
        },
      });
      const text = await res.text();
      if (!firstRawResponse) firstRawResponse = { httpStatus: res.status, body: text.substring(0, 400) };

      let data;
      try { data = JSON.parse(text); }
      catch (_) {
        if (!firstEbayError) firstEbayError = { errorId: 'JSON_PARSE_FAIL', httpStatus: res.status, body: text.substring(0, 300) };
        return { ...item, ebay_low_cad: null };
      }

      if (!res.ok) {
        if (!firstEbayError) firstEbayError = { errorId: data?.errors?.[0]?.errorId || res.status, message: data?.errors?.[0]?.message || text.substring(0, 200) };
        return { ...item, ebay_low_cad: null };
      }

      const browseItems = data?.itemSummaries || [];
      const prices      = parseBrowsePrices(browseItems);
      const lowestUsd   = prices[0] || null;
      return { ...item, ebay_low_cad: lowestUsd ? +(lowestUsd * cadRate).toFixed(2) : null };
    } catch (e) {
      if (!firstEbayError) firstEbayError = { errorId: 'FETCH_ERROR', message: e.message };
      return { ...item, ebay_low_cad: null };
    }
  }));

  const withPrice = results.filter(r => r.ebay_low_cad !== null);

  // 5. Write ebay_low_cad back to listing_queue rows
  await Promise.all(withPrice.map(r =>
    fetch(`${SUPABASE_URL}/rest/v1/listing_queue?id=eq.${r.id}`, {
      method:  'PATCH',
      headers: sbHeaders,
      body:    JSON.stringify({ ebay_low_cad: r.ebay_low_cad }),
    })
  ));

  // 6. Write ebay_low_cad to card_inventory matching card_number + rarity
  await Promise.all(withPrice.map(r => {
    const ciParams = new URLSearchParams({
      card_number: `eq.${r.card_number}`,
      rarity:      `eq.${r.rarity}`,
    });
    return fetch(`${SUPABASE_URL}/rest/v1/card_inventory?${ciParams}`, {
      method:  'PATCH',
      headers: sbHeaders,
      body:    JSON.stringify({ ebay_low_cad: r.ebay_low_cad }),
    });
  }));

  return {
    statusCode: 200,
    headers:    CORS_HEADERS,
    body:       JSON.stringify({
      updated:          withPrice.length,
      total:            items.length,
      cadRate:          +cadRate.toFixed(4),
      // diagnostics — remove once confirmed working
      skippedNoRarity:  skippedNoRarity.length,
      firstEbayError:   firstEbayError,
      firstRawResponse: firstRawResponse,
      sampleItem:       items[0] || null,
      sampleQuery:      items[0]?.card_number && items[0]?.rarity
                          ? `${items[0].card_number} ${getRarityKeyword(items[0].rarity)}`
                          : null,
    }),
  };
};
