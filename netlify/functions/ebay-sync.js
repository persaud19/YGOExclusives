// ebay-sync.js — Daily eBay sold-order sync
// GET  /.netlify/functions/ebay-sync              → sync last 48h
// GET  /.netlify/functions/ebay-sync?since=2026-01-01 → sync from date
// GET  /.netlify/functions/ebay-sync?dry_run=1   → return records without saving

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
  'Content-Type':                 'application/json',
};

const EBAY_TOKEN_URL  = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_FULFILL    = 'https://api.ebay.com/sell/fulfillment/v1/order';
const EBAY_FINANCES   = 'https://apiz.ebay.com/sell/finances/v1/transaction';

// ── OAuth ─────────────────────────────────────────────────────────────────────

async function getAccessToken(appId, certId, refreshToken) {
  const creds = Buffer.from(`${appId}:${certId}`).toString('base64');
  const scope = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    'https://api.ebay.com/oauth/api_scope/sell.finances',
  ].join(' ');

  const res = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&scope=${encodeURIComponent(scope)}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Safe JSON parse ───────────────────────────────────────────────────────────

async function safeJson(res) {
  const text = await res.text();
  if (!text || !text.trim()) return {};
  try { return JSON.parse(text); } catch (_) { return {}; }
}

// ── eBay Fulfillment API ──────────────────────────────────────────────────────

async function fetchOrders(token, since) {
  const sinceStr = new Date(since).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const filter   = `lastmodifieddate:[${sinceStr}..]`;
  const orders   = [];
  let   url      = `${EBAY_FULFILL}?filter=${encodeURIComponent(filter)}&limit=200`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`fetchOrders failed: ${res.status} ${await res.text()}`);
    const data = await safeJson(res);
    orders.push(...(data.orders || []));
    url = data.next || null;
  }

  const paid = orders.filter(o => o.orderPaymentStatus === 'PAID');
  return { orders: paid, debug: { raw: orders.length, paid: paid.length, statuses: [...new Set(orders.map(o => o.orderPaymentStatus))] } };
}

async function fetchTracking(token, orderId) {
  const res = await fetch(`${EBAY_FULFILL}/${encodeURIComponent(orderId)}/shipping_fulfillment`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await safeJson(res);
  return data.fulfillments || [];
}

// ── eBay Finances API ─────────────────────────────────────────────────────────

async function fetchTransactions(token, since) {
  const sinceStr = new Date(since).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const filter   = `transactionDate:[${sinceStr}..]`;
  const txns     = [];
  let   url      = `${EBAY_FINANCES}?filter=${encodeURIComponent(filter)}&transactionType=SALE&limit=200`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`fetchTransactions failed: ${res.status} ${await res.text()}`);
    const data = await safeJson(res);
    txns.push(...(data.transactions || []));
    url = data.next || null;
  }
  return txns;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extract YGO card number (e.g. BLMM-EN001) from eBay listing title
function extractCardNumber(title) {
  const m = title.match(/\b([A-Z0-9]{2,8}-[A-Z]{2}\d{3}[A-Z]?)\b/i);
  return m ? m[1].toUpperCase() : null;
}

// Net profit: payout already has eBay fees deducted; subtract shipping out + acq cost
// Acquisition cost isn't available from eBay — left null for manual fill-in
function calcNetProfit(payoutAmount, shippingCostOut) {
  if (payoutAmount == null) return null;
  return Math.round((payoutAmount - (shippingCostOut || 0)) * 100) / 100;
}

const CHIT_CHATS_DEFAULT = 5.50;

// ── Build sale records ────────────────────────────────────────────────────────

async function buildRecords(orders, txnsByOrderId) {
  const records = [];

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    // Tracking omitted from sync — not worth the extra API calls per order
    const trackingNumber  = null;
    const shippingCarrier = null;

    const buyer   = order.buyer || {};
    const regAddr = buyer.buyerRegistrationAddress?.contactAddress || {};
    const shipStep = (order.fulfillmentStartInstructions || [])[0]?.shippingStep || {};
    const shipTo   = shipStep.shipTo?.contactAddress || {};

    // Prefer ship-to address over registration address
    const city    = shipTo.city            || regAddr.city            || null;
    const country = shipTo.countryCode     || regAddr.countryCode     || null;
    const prov    = shipTo.stateOrProvince || regAddr.stateOrProvince || null;

    const txn    = txnsByOrderId[order.orderId];
    const payout = txn ? parseFloat(txn.amount?.value || 0) : null;
    const fvf    = txn ? parseFloat(txn.totalFeeAmount?.value || 0) : null;

    for (const item of order.lineItems || []) {
      const title          = item.title || '';
      const cardNumber     = extractCardNumber(title);
      const salePrice      = parseFloat(item.lineItemCost?.value || 0);
      const shippingCharged = parseFloat(
        item.deliveryCost?.shippingCost?.value ||
        order.pricingSummary?.deliveryCost?.value || 0
      );

      // Per-line payout: prorate by line item cost if multi-line order
      const lineCount    = order.lineItems.length;
      const linePayout   = payout != null ? Math.round((payout / lineCount) * 100) / 100 : null;
      const lineFvf      = fvf    != null ? Math.round((fvf    / lineCount) * 100) / 100 : null;

      records.push({
        id:                   crypto.randomUUID(),
        platform:             'ebay',
        source:               'ebay_sync',
        sale_date:            (order.creationDate || '').slice(0, 10),
        card_name:            title,
        card_number:          cardNumber,
        set_name:             null,
        rarity:               null,
        quantity:             item.quantity || 1,
        sale_price:           salePrice,
        shipping_charged:     shippingCharged,
        shipping_cost_out:    CHIT_CHATS_DEFAULT,
        acquisition_cost:     null,         // not available from eBay; fill manually
        final_value_fee:      lineFvf,
        promoted_listing_fee: null,         // requires separate Marketing API call
        platform_fee:         lineFvf,
        payout_amount:        linePayout,
        net_profit:           calcNetProfit(linePayout, CHIT_CHATS_DEFAULT),
        buyer_name:           buyer.buyerRegistrationAddress?.fullName || null,
        buyer_username:       buyer.username || null,
        buyer_city:           city,
        buyer_province:       prov,
        buyer_country:        country,
        ebay_order_id:        order.orderId,
        ebay_item_id:         item.legacyItemId || null,
        ebay_transaction_id:  item.lineItemId   || null,
        tracking_number:      trackingNumber,
        shipping_carrier:     shippingCarrier,
        shipping_service:     shipStep.shippingServiceCode || null,
        created_at:           new Date().toISOString(),
      });
    }
  }

  return records;
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function upsertSales(records, supabaseUrl, serviceKey) {
  if (!records.length) return { inserted: 0, updated: 0 };

  const res = await fetch(
    `${supabaseUrl}/rest/v1/sales?on_conflict=ebay_transaction_id`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(records),
    }
  );
  if (!res.ok) throw new Error(`Supabase upsert failed: ${res.status} ${await res.text()}`);
  return { upserted: records.length };
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Env var debug endpoint — no auth required, safe (returns only key names not values)
  if ((event.queryStringParameters || {}).debug_env === '1') {
    const keys = ['EBAY_APP_ID','EBAY_CERT_ID','EBAY_REFRESH_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_KEY','SYNC_API_KEY'];
    const state = {};
    keys.forEach(k => { state[k] = process.env[k] ? `set (${process.env[k].length} chars)` : 'MISSING'; });
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(state) };
  }

  // Require a simple shared secret to prevent public triggering
  const apiKey = event.headers['x-api-key'] || event.queryStringParameters?.api_key;
  if (apiKey !== process.env.SYNC_API_KEY) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const params  = event.queryStringParameters || {};
    const dryRun  = params.dry_run === '1';

    // Default: last 7 days (catches late payments, shipping updates, and missed runs)
    const since = params.since
      ? new Date(params.since)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const appId        = process.env.EBAY_APP_ID;
    const certId       = process.env.EBAY_CERT_ID;
    const refreshToken = process.env.EBAY_REFRESH_TOKEN;
    const supabaseUrl  = process.env.SUPABASE_URL;
    const serviceKey   = process.env.SUPABASE_SERVICE_KEY;

    const missing = [
      !appId        && 'EBAY_APP_ID',
      !certId       && 'EBAY_CERT_ID',
      !refreshToken && 'EBAY_REFRESH_TOKEN',
      !supabaseUrl  && 'SUPABASE_URL',
      !serviceKey   && 'SUPABASE_SERVICE_KEY',
    ].filter(Boolean);
    if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);

    // 1. Auth
    const token = await getAccessToken(appId, certId, refreshToken);

    // 2. Fetch orders + transactions in parallel (finances non-fatal)
    const [ordersResult, txns] = await Promise.all([
      fetchOrders(token, since),
      fetchTransactions(token, since).catch(err => {
        console.warn('fetchTransactions skipped:', err.message);
        return [];
      }),
    ]);
    const orders    = ordersResult.orders;
    const orderDbg  = ordersResult.debug;

    // 3. Index transactions by orderId
    const txnsByOrderId = {};
    for (const txn of txns) {
      if (txn.orderId) txnsByOrderId[txn.orderId] = txn;
    }

    // 4. Build sale records (fetches tracking per order)
    const records = await buildRecords(orders, txnsByOrderId);

    if (dryRun) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ dry_run: true, count: records.length, records }),
      };
    }

    // 5. Upsert to Supabase
    const result = await upsertSales(records, supabaseUrl, serviceKey);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        ok:    true,
        since: since.toISOString(),
        orders_fetched: orders.length,
        orders_debug:   orderDbg,
        txns_fetched:   txns.length,
        ...result,
      }),
    };
  } catch (err) {
    console.error('ebay-sync error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
