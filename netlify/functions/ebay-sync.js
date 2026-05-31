// ebay-sync.js — Daily eBay sold-order sync
// Uses https module (no fetch dependency) — works on any Node version.
// GET /.netlify/functions/ebay-sync                    → sync last 7 days
// GET /.netlify/functions/ebay-sync?since=YYYY-MM-DD   → sync from date
// GET /.netlify/functions/ebay-sync?dry_run=1          → return without saving
// GET /.netlify/functions/ebay-sync?debug_env=1        → check env vars (no auth)

const https = require('https');
const { randomUUID } = require('crypto');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
  'Content-Type':                 'application/json',
};

const EBAY_FVF_PCT = 0.1325;
const CHIT_CHATS   = 5.50;  // tracked via Chit Chats
const LETTERMAIL   = 2.00;  // CA lettermail (untracked, cheap)

const LETTERMAIL_SERVICES = new Set([
  'CA_PostLettermail',
  'CA_PostLetterMailInternational',
]);

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

function post(host, path, headers, body) {
  return request({ method: 'POST', host, path, headers }, body);
}

function get(host, path, headers) {
  return request({ method: 'GET', host, path, headers }, null);
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

async function getAccessToken(appId, certId, refreshToken) {
  const creds = Buffer.from(`${appId}:${certId}`).toString('base64');
  const body  = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&scope=${encodeURIComponent('https://api.ebay.com/oauth/api_scope/sell.fulfillment')}`;
  const res   = await post('api.ebay.com', '/identity/v1/oauth2/token', {
    'Content-Type':  'application/x-www-form-urlencoded',
    'Authorization': `Basic ${creds}`,
    'Content-Length': Buffer.byteLength(body),
  }, body);
  if (!res.body.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

// ── Fetch orders ──────────────────────────────────────────────────────────────

async function fetchOrders(token, since) {
  const sinceStr = new Date(since).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const filter   = encodeURIComponent(`lastmodifieddate:[${sinceStr}..]`);
  const orders   = [];
  let   path     = `/sell/fulfillment/v1/order?filter=${filter}&limit=200`;

  while (path) {
    const res = await get('api.ebay.com', path, { Authorization: `Bearer ${token}` });
    if (res.status !== 200) throw new Error(`fetchOrders ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
    orders.push(...(res.body.orders || []));
    // next is a full URL — extract just the path+query
    const next = res.body.next;
    path = next ? next.replace('https://api.ebay.com', '') : null;
  }

  return orders.filter(o => o.orderPaymentStatus === 'PAID');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractCardNumber(title) {
  const m = title.match(/\b([A-Z0-9]{2,8}-[A-Z]{2}\d{3}[A-Z]?)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function buildRecords(orders) {
  const records = [];
  for (const order of orders) {
    const buyer    = order.buyer || {};
    const regAddr  = buyer.buyerRegistrationAddress?.contactAddress || {};
    const shipStep = (order.fulfillmentStartInstructions || [])[0]?.shippingStep || {};
    const shipTo   = shipStep.shipTo?.contactAddress || {};

    const city           = shipTo.city            || regAddr.city            || null;
    const country        = shipTo.countryCode     || regAddr.countryCode     || null;
    const prov           = shipTo.stateOrProvince || regAddr.stateOrProvince || null;
    const addrLine1      = shipTo.addressLine1    || regAddr.addressLine1    || null;
    const addrLine2      = shipTo.addressLine2    || regAddr.addressLine2    || null;
    const postalCode     = shipTo.postalCode      || regAddr.postalCode      || null;
    const shippingService = shipStep.shippingServiceCode || null;
    const shipCostOut    = LETTERMAIL_SERVICES.has(shippingService) ? LETTERMAIL : CHIT_CHATS;

    for (const item of order.lineItems || []) {
      const salePrice       = parseFloat(item.lineItemCost?.value || 0);
      const shippingCharged = parseFloat(
        item.deliveryCost?.shippingCost?.value ||
        order.pricingSummary?.deliveryCost?.value || 0
      );
      const totalReceived = salePrice + shippingCharged;
      const fvf           = Math.round(totalReceived * EBAY_FVF_PCT * 100) / 100;
      const payout        = Math.round((totalReceived - fvf) * 100) / 100;
      const netProfit     = Math.round((payout - shipCostOut) * 100) / 100;

      records.push({
        id:                  randomUUID(),
        platform:            'ebay',
        source:              'ebay_sync',
        sale_date:           (order.creationDate || '').slice(0, 10),
        card_name:           item.title || '',
        card_number:         extractCardNumber(item.title || ''),
        set_name:            null,
        rarity:              null,
        quantity:            item.quantity || 1,
        sale_price:          salePrice,
        shipping_charged:    shippingCharged,
        shipping_cost_out:   shipCostOut,
        acquisition_cost:    null,
        final_value_fee:     fvf,
        promoted_listing_fee: null,
        platform_fee:        fvf,
        payout_amount:       payout,
        net_profit:          netProfit,
        buyer_name:           buyer.buyerRegistrationAddress?.fullName || null,
        buyer_username:       buyer.username || null,
        buyer_address_line1:  addrLine1,
        buyer_address_line2:  addrLine2,
        buyer_city:           city,
        buyer_province:       prov,
        buyer_postal_code:    postalCode,
        buyer_country:        country,
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
  const url  = new URL(`${supabaseUrl}/rest/v1/sales?on_conflict=ebay_transaction_id`);
  const body = JSON.stringify(records);
  const res  = await post(url.host, url.pathname + url.search, {
    'Content-Type':  'application/json',
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Prefer':        'resolution=merge-duplicates,return=minimal',
    'Content-Length': Buffer.byteLength(body),
  }, body);
  if (res.status >= 300) throw new Error(`Supabase upsert ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  return { upserted: records.length };
}

// ── Handler ───────────────────────────────────────────────────────────────────

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
    const since  = params.since
      ? new Date(params.since)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const missing = ['EBAY_APP_ID','EBAY_CERT_ID','EBAY_REFRESH_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_KEY']
      .filter(k => !process.env[k]);
    if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);

    const { EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

    const token   = await getAccessToken(EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN);
    const orders  = await fetchOrders(token, since);
    const records = buildRecords(orders);

    if (dryRun) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ dry_run: true, count: records.length, records }) };
    }

    const result = await upsertSales(records, SUPABASE_URL, SUPABASE_SERVICE_KEY);

    return {
      statusCode: 200, headers: CORS_HEADERS,
      body: JSON.stringify({ ok: true, since: since.toISOString(), orders_fetched: orders.length, ...result }),
    };
  } catch (err) {
    console.error('ebay-sync error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
