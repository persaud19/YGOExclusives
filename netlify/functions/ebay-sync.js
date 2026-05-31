// ebay-sync.js — Daily eBay sold-order sync
// Only uses Fulfillment API (2 calls: token + orders). FVF calculated at 13.25%.
// GET /.netlify/functions/ebay-sync              → sync last 7 days
// GET /.netlify/functions/ebay-sync?since=YYYY-MM-DD → sync from date
// GET /.netlify/functions/ebay-sync?dry_run=1   → return records without saving
// GET /.netlify/functions/ebay-sync?debug_env=1 → check env vars (no auth needed)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
  'Content-Type':                 'application/json',
};

const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_FULFILL   = 'https://api.ebay.com/sell/fulfillment/v1/order';
const EBAY_FVF_PCT   = 0.1325; // Standard eBay final value fee
const CHIT_CHATS     = 5.50;   // Default shipping cost out (CAD)

// ── OAuth ─────────────────────────────────────────────────────────────────────

async function getAccessToken(appId, certId, refreshToken) {
  const creds = Buffer.from(`${appId}:${certId}`).toString('base64');
  const res = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&scope=${encodeURIComponent('https://api.ebay.com/oauth/api_scope/sell.fulfillment')}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Fetch orders ──────────────────────────────────────────────────────────────

async function fetchOrders(token, since) {
  const sinceStr = new Date(since).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const filter   = `lastmodifieddate:[${sinceStr}..]`;
  const orders   = [];
  let   url      = `${EBAY_FULFILL}?filter=${encodeURIComponent(filter)}&limit=200`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`fetchOrders ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    orders.push(...(data.orders || []));
    url = data.next || null;
  }

  return orders.filter(o => o.orderPaymentStatus === 'PAID');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractCardNumber(title) {
  const m = title.match(/\b([A-Z0-9]{2,8}-[A-Z]{2}\d{3}[A-Z]?)\b/i);
  return m ? m[1].toUpperCase() : null;
}

// ── Build sale records from order data ────────────────────────────────────────

function buildRecords(orders) {
  const records = [];

  for (const order of orders) {
    const buyer   = order.buyer || {};
    const regAddr = buyer.buyerRegistrationAddress?.contactAddress || {};
    const shipStep = (order.fulfillmentStartInstructions || [])[0]?.shippingStep || {};
    const shipTo   = shipStep.shipTo?.contactAddress || {};

    const city    = shipTo.city            || regAddr.city            || null;
    const country = shipTo.countryCode     || regAddr.countryCode     || null;
    const prov    = shipTo.stateOrProvince || regAddr.stateOrProvince || null;

    const lineCount = (order.lineItems || []).length;

    for (const item of order.lineItems || []) {
      const title           = item.title || '';
      const salePrice       = parseFloat(item.lineItemCost?.value || 0);
      const shippingCharged = parseFloat(
        item.deliveryCost?.shippingCost?.value ||
        order.pricingSummary?.deliveryCost?.value || 0
      );
      const fvf       = Math.round(salePrice * EBAY_FVF_PCT * 100) / 100;
      const payout    = Math.round((salePrice + shippingCharged - fvf) * 100) / 100;
      const netProfit = Math.round((payout - CHIT_CHATS) * 100) / 100;

      records.push({
        id:                  crypto.randomUUID(),
        platform:            'ebay',
        source:              'ebay_sync',
        sale_date:           (order.creationDate || '').slice(0, 10),
        card_name:           title,
        card_number:         extractCardNumber(title),
        set_name:            null,
        rarity:              null,
        quantity:            item.quantity || 1,
        sale_price:          salePrice,
        shipping_charged:    shippingCharged,
        shipping_cost_out:   CHIT_CHATS,
        acquisition_cost:    null,
        final_value_fee:     fvf,
        promoted_listing_fee: null,
        platform_fee:        fvf,
        payout_amount:       payout,
        net_profit:          netProfit,
        buyer_name:          buyer.buyerRegistrationAddress?.fullName || null,
        buyer_username:      buyer.username || null,
        buyer_city:          city,
        buyer_province:      prov,
        buyer_country:       country,
        ebay_order_id:       order.orderId,
        ebay_item_id:        item.legacyItemId || null,
        ebay_transaction_id: item.lineItemId   || null,
        tracking_number:     null,
        shipping_carrier:    null,
        shipping_service:    shipStep.shippingServiceCode || null,
        created_at:          new Date().toISOString(),
      });
    }
  }

  return records;
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function upsertSales(records, supabaseUrl, serviceKey) {
  if (!records.length) return { upserted: 0 };
  const res = await fetch(`${supabaseUrl}/rest/v1/sales?on_conflict=ebay_transaction_id`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(records),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { upserted: records.length };
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const params = event.queryStringParameters || {};

  // Env var debug — no auth needed, returns key names and lengths only
  if (params.debug_env === '1') {
    const keys = ['EBAY_APP_ID','EBAY_CERT_ID','EBAY_REFRESH_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_KEY','SYNC_API_KEY'];
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
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
    const since  = params.since
      ? new Date(params.since)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const { EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    const missing = ['EBAY_APP_ID','EBAY_CERT_ID','EBAY_REFRESH_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_KEY']
      .filter(k => !process.env[k]);
    if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);

    const token   = await getAccessToken(EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN);
    const orders  = await fetchOrders(token, since);
    const records = buildRecords(orders);  // sync — no extra API calls

    if (dryRun) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ dry_run: true, count: records.length, records }) };
    }

    const result = await upsertSales(records, SUPABASE_URL, SUPABASE_SERVICE_KEY);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: true, since: since.toISOString(), orders_fetched: orders.length, ...result }),
    };
  } catch (err) {
    console.error('ebay-sync error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
