// ebay-prices.js — Netlify serverless function
// Returns eBay active listing + sold data for a card + rarity combo
//
// GET /.netlify/functions/ebay-prices?card_number=BLMM-EN001&rarity=Starlight+Rare
// GET /.netlify/functions/ebay-prices?card_number=BLMM-EN001&rarity=Starlight+Rare&debug=1
//
// Both active listings and sold data use the Finding API (no EPN approval needed).
// Browse API requires eBay Partner Network approval — not available on standard dev accounts.
//
// Response:
//   { lowestListed, recentSoldMedian, soldCount, activeCount }
//   lowestListed     — lowest active listing (price + shipping combined)
//   recentSoldMedian — median of last ~20 sold transactions (price + shipping)
//
// Debug response adds: { _query, _activeStatus, _activeAck, _soldStatus, _soldAck,
//                        _activeRaw (first 2 items), _soldRaw (first 2 items) }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

// Map DB rarity names → eBay search keywords
// No apostrophes (break eBay search), no strict quotes, distinctive keyword only
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
  if (r.includes('secret'))             return 'secret rare';
  if (r.includes('ultra'))              return 'ultra rare';
  if (r.includes('super'))              return 'super rare';
  return rarity.replace(/'/g, '').toLowerCase();
}

// Parse prices from a Finding API item array
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

function median(arr) {
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0
    ? +((arr[mid - 1] + arr[mid]) / 2).toFixed(2)
    : +arr[mid].toFixed(2);
}

// Build a Finding API URL
function findingUrl(CLIENT_ID, operation, keywords, extraFilters = '') {
  return (
    `https://svcs.ebay.com/services/search/FindingService/v1` +
    `?OPERATION-NAME=${operation}` +
    `&SERVICE-VERSION=1.0.0` +
    `&SECURITY-APPNAME=${encodeURIComponent(CLIENT_ID)}` +
    `&RESPONSE-DATA-FORMAT=JSON` +
    `&keywords=${encodeURIComponent(keywords)}` +
    `&sortOrder=EndTimeSoonest` +
    `&paginationInput.entriesPerPage=20` +
    extraFilters
  );
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  const params      = event.queryStringParameters || {};
  const card_number = params.card_number;
  const rarity      = params.rarity;
  const debugMode   = params.debug === '1';

  if (!card_number || !rarity) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'card_number and rarity are required' }),
    };
  }

  const CLIENT_ID     = process.env.EBAY_CLIENT_ID;
  const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set in Netlify env vars' }),
    };
  }

  try {
    const rarityKeyword = getRarityKeyword(rarity);
    // Use card number without quotes first — eBay exact-phrase matching can be too strict
    // for card numbers that sellers format differently (spaces, lowercase, etc.)
    const query = `${card_number} ${rarityKeyword}`;

    // ── Active listings (Finding API — findItemsAdvanced) ────────────────────
    // No EPN required. Returns live listings sorted cheapest first.
    const activeUrl = findingUrl(CLIENT_ID, 'findItemsAdvanced', query);
    const activeRes = await fetch(activeUrl);
    const activeRaw = activeRes.ok ? await activeRes.json() : null;
    const activeAck = activeRaw?.findItemsAdvancedResponse?.[0]?.ack?.[0] || 'NO_RESPONSE';

    const activeItems  = activeRaw?.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item || [];
    const activePrices = parseFindingPrices(activeItems);
    const lowestListed = activePrices.length > 0 ? +activePrices[0].toFixed(2) : null;

    // ── Sold listings (Finding API — findCompletedItems) ─────────────────────
    const soldUrl = findingUrl(
      CLIENT_ID,
      'findCompletedItems',
      query,
      '&itemFilter(0).name=SoldItemsOnly&itemFilter(0).value=true'
    );
    const soldRes  = await fetch(soldUrl);
    const soldRaw  = soldRes.ok ? await soldRes.json() : null;
    const soldAck  = soldRaw?.findCompletedItemsResponse?.[0]?.ack?.[0] || 'NO_RESPONSE';

    const soldItems  = soldRaw?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
    const soldPrices = parseFindingPrices(soldItems);
    const recentSoldMedian = median(soldPrices);

    const result = {
      lowestListed,
      recentSoldMedian,
      soldCount:   soldPrices.length,
      activeCount: activePrices.length,
    };

    // Debug mode — include raw API info so we can diagnose zero-result issues
    if (debugMode) {
      result._query       = query;
      result._activeUrl   = activeUrl.replace(CLIENT_ID, 'APP_ID_HIDDEN');
      result._activeStatus = activeRes.status;
      result._activeAck   = activeAck;
      result._activeRaw   = activeItems.slice(0, 2).map(i => ({
        title:    i.title?.[0],
        price:    i.sellingStatus?.[0]?.currentPrice?.[0]?.__value__,
        shipping: i.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__,
      }));
      result._soldStatus  = soldRes.status;
      result._soldAck     = soldAck;
      result._soldRaw     = soldItems.slice(0, 2).map(i => ({
        title:    i.title?.[0],
        price:    i.sellingStatus?.[0]?.currentPrice?.[0]?.__value__,
        shipping: i.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__,
      }));
    }

    return {
      statusCode: 200,
      headers:    CORS_HEADERS,
      body:       JSON.stringify(result),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ error: e.message, stack: e.stack }),
    };
  }
};
