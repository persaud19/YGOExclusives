// ebay-queue-prices.js
// Fetches eBay lowest listed price for all pending listing_queue items.
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

function parseFindingPrices(items) {
  return (items || [])
    .map(item => {
      const price    = parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0);
      const shipping = parseFloat(item.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__ || 0);
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

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  // Accept either env var name — EBAY_APP_ID is the canonical one set by ebay-sync/list/auth
  const EBAY_APP_ID = process.env.EBAY_APP_ID || process.env.EBAY_CLIENT_ID;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !EBAY_APP_ID) {
    const missing = [!SUPABASE_URL && 'SUPABASE_URL', !SUPABASE_SERVICE_KEY && 'SUPABASE_SERVICE_KEY', !EBAY_APP_ID && 'EBAY_APP_ID'].filter(Boolean);
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

  // 3. Fetch eBay prices in small batches to avoid burst/concurrent limits
  // eBay Finding API allows 5000/day but can reject a flood of simultaneous requests
  const BATCH_SIZE  = 5;
  const BATCH_DELAY = 300; // ms between batches
  const results     = [];
  let firstEbayError = null;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async item => {
      if (!item.card_number || !item.rarity) return { ...item, ebay_low_cad: null };
      try {
        const query = `${item.card_number} ${getRarityKeyword(item.rarity)}`;
        const url   = `https://svcs.ebay.com/services/search/FindingService/v1`
          + `?OPERATION-NAME=findItemsAdvanced`
          + `&SERVICE-VERSION=1.0.0`
          + `&SECURITY-APPNAME=${encodeURIComponent(EBAY_APP_ID)}`
          + `&RESPONSE-DATA-FORMAT=JSON`
          + `&keywords=${encodeURIComponent(query)}`
          + `&sortOrder=PricePlusShippingLowest`
          + `&paginationInput.entriesPerPage=5`;

        const res  = await fetch(url);
        const data = await res.json();

        // Capture any eBay-level error for diagnostics
        const ebayErr = data?.errorMessage?.[0]?.error?.[0];
        if (ebayErr) {
          const errId  = ebayErr.errorId?.[0];
          const errMsg = ebayErr.message?.[0] || 'unknown';
          if (!firstEbayError) firstEbayError = { errorId: errId, message: errMsg };
          // 10001 = rate limit / service unavailable
          if (errId === '10001') return { ...item, ebay_low_cad: null, rateLimited: true };
          return { ...item, ebay_low_cad: null };
        }

        const activeItems = data?.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item || [];
        const prices      = parseFindingPrices(activeItems);
        const lowestUsd   = prices[0] || null;
        return { ...item, ebay_low_cad: lowestUsd ? +(lowestUsd * cadRate).toFixed(2) : null };
      } catch (e) {
        return { ...item, ebay_low_cad: null };
      }
    }));
    results.push(...batchResults);

    // Delay between batches (skip after last batch)
    if (i + BATCH_SIZE < items.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  if (results.some(r => r.rateLimited)) {
    return {
      statusCode: 429,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({
        error:   'rate_limit',
        message: 'eBay API quota exceeded — resets midnight PT',
        ebayError: firstEbayError,
      }),
    };
  }

  const withPrice = results.filter(r => r.ebay_low_cad !== null);

  // 4. Write ebay_low_cad back to listing_queue rows
  await Promise.all(withPrice.map(r =>
    fetch(`${SUPABASE_URL}/rest/v1/listing_queue?id=eq.${r.id}`, {
      method:  'PATCH',
      headers: sbHeaders,
      body:    JSON.stringify({ ebay_low_cad: r.ebay_low_cad }),
    })
  ));

  // 5. Write ebay_low_cad to card_inventory matching card_number + rarity
  await Promise.all(withPrice.map(r => {
    const params = new URLSearchParams({
      card_number: `eq.${r.card_number}`,
      rarity:      `eq.${r.rarity}`,
    });
    return fetch(`${SUPABASE_URL}/rest/v1/card_inventory?${params}`, {
      method:  'PATCH',
      headers: sbHeaders,
      body:    JSON.stringify({ ebay_low_cad: r.ebay_low_cad }),
    });
  }));

  return {
    statusCode: 200,
    headers:    CORS_HEADERS,
    body:       JSON.stringify({ updated: withPrice.length, total: items.length, cadRate: +cadRate.toFixed(4) }),
  };
};
