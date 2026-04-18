// ebay-prices.js — Netlify serverless function
// Returns eBay active listing + sold data for a card + rarity combo
// Used by bulk-price.html to populate hr_tcg_price and hr_ebay_price
//
// GET /.netlify/functions/ebay-prices?card_number=BLMM-EN001&rarity=Starlight+Rare
//
// Response:
//   { lowestListed, recentSoldMedian, soldCount, activeCount }
//   lowestListed     — lowest active listing (price + shipping combined)
//   recentSoldMedian — median of last ~20 sold transactions (price + shipping)
//   soldCount        — number of sold results found
//   activeCount      — number of active listing results found

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  const { card_number, rarity } = event.queryStringParameters || {};

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
      body: JSON.stringify({ error: 'eBay credentials not configured in environment' }),
    };
  }

  try {
    // ── 1. Get OAuth2 token (client credentials — no user login needed) ───────
    const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method:  'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return {
        statusCode: 502,
        headers:    CORS_HEADERS,
        body:       JSON.stringify({ error: 'eBay OAuth failed: ' + errText }),
      };
    }

    const { access_token } = await tokenRes.json();
    if (!access_token) {
      return {
        statusCode: 502,
        headers:    CORS_HEADERS,
        body:       JSON.stringify({ error: 'No access_token in eBay OAuth response' }),
      };
    }

    // Search query — both card number AND rarity must appear in title
    const query = `"${card_number}" "${rarity}"`;

    const BROWSE_HEADERS = {
      'Authorization':           `Bearer ${access_token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      'Content-Type':            'application/json',
    };

    // ── 2. Active listings — Browse API (lowest listed price + shipping) ──────
    // category_ids=2536 = YuGiOh Singles on eBay
    const browseUrl =
      `https://api.ebay.com/buy/browse/v1/item_summary/search` +
      `?q=${encodeURIComponent(query)}` +
      `&category_ids=2536` +
      `&limit=20` +
      `&sort=price` +
      `&fieldgroups=EXTENDED`;

    const browseRes  = await fetch(browseUrl, { headers: BROWSE_HEADERS });
    const browseData = browseRes.ok ? await browseRes.json() : {};

    const activeTotals = (browseData.itemSummaries || [])
      .map(item => {
        const price    = parseFloat(item.price?.value           || 0);
        const shipping = parseFloat(
          item.shippingOptions?.[0]?.shippingCost?.value        || 0
        );
        return price + shipping;
      })
      .filter(p => p > 0)
      .sort((a, b) => a - b);

    const lowestListed  = activeTotals.length > 0
      ? +activeTotals[0].toFixed(2)
      : null;

    // ── 3. Sold listings — Finding API (last 90 days, JSON response) ─────────
    // Finding API uses App ID directly — no OAuth needed
    const findingUrl =
      `https://svcs.ebay.com/services/search/FindingService/v1` +
      `?OPERATION-NAME=findCompletedItems` +
      `&SERVICE-VERSION=1.0.0` +
      `&SECURITY-APPNAME=${encodeURIComponent(CLIENT_ID)}` +
      `&RESPONSE-DATA-FORMAT=JSON` +
      `&keywords=${encodeURIComponent(query)}` +
      `&categoryId=2536` +
      `&itemFilter(0).name=SoldItemsOnly` +
      `&itemFilter(0).value=true` +
      `&sortOrder=EndTimeSoonest` +
      `&paginationInput.entriesPerPage=20`;

    const findRes  = await fetch(findingUrl);
    const findData = findRes.ok ? await findRes.json() : {};

    const soldItems = (
      findData
        ?.findCompletedItemsResponse?.[0]
        ?.searchResult?.[0]
        ?.item
    ) || [];

    const soldTotals = soldItems
      .map(item => {
        const price    = parseFloat(
          item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0
        );
        const shipping = parseFloat(
          item.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__ || 0
        );
        return price + shipping;
      })
      .filter(p => p > 0)
      .sort((a, b) => a - b);

    // Median sold price
    let recentSoldMedian = null;
    if (soldTotals.length > 0) {
      const mid = Math.floor(soldTotals.length / 2);
      recentSoldMedian = soldTotals.length % 2 === 0
        ? +((soldTotals[mid - 1] + soldTotals[mid]) / 2).toFixed(2)
        : +soldTotals[mid].toFixed(2);
    }

    return {
      statusCode: 200,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({
        lowestListed,
        recentSoldMedian,
        soldCount:   soldTotals.length,
        activeCount: activeTotals.length,
      }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ error: e.message }),
    };
  }
};
