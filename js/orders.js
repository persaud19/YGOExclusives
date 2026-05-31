// ─── orders.js — Pick & Ship order sheet ──────────────────────────────────────

let ordersInitialized = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

function initOrders() {
  if (!ordersInitialized) {
    ordersInitialized = true;
    document.getElementById('orders-refresh-btn').addEventListener('click', loadOrders);
  }
  loadOrders();
}

// ─── Load unshipped sales, group by order ─────────────────────────────────────

async function loadOrders() {
  const list  = document.getElementById('orders-list');
  const empty = document.getElementById('orders-empty');
  const badge = document.getElementById('orders-count-badge');
  list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">Loading…</div>';
  empty.style.display = 'none';
  badge.style.display = 'none';

  try {
    const params = new URLSearchParams({
      shipped: 'eq.false',
      platform: 'eq.ebay',
      order: 'sale_date.asc,ebay_order_id.asc',
      select: 'id,sale_date,card_name,card_number,quantity,shipping_service,shipping_cost_out,buyer_name,buyer_username,buyer_address_line1,buyer_address_line2,buyer_city,buyer_province,buyer_postal_code,buyer_country,ebay_order_id',
      limit: '500',
    });

    const res  = await fetch(`${SUPABASE_URL}/rest/v1/sales?${params}`, { headers: DB_HEADERS_RETURN });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const rows = await res.json();

    if (!rows.length) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }

    // Group by ebay_order_id (or fall back to id for manual sales)
    const groups = groupByOrder(rows);

    badge.textContent = `${groups.length} order${groups.length !== 1 ? 's' : ''} pending`;
    badge.style.display = '';

    list.innerHTML = '';
    groups.forEach(group => {
      list.appendChild(buildOrderCard(group));
    });

  } catch (err) {
    list.innerHTML = `<div style="color:var(--red);padding:20px">Error loading orders: ${err.message}</div>`;
  }
}

function groupByOrder(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.ebay_order_id || row.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.values()];
}

// ─── Build one order card ─────────────────────────────────────────────────────

function buildOrderCard(items) {
  const first   = items[0];
  const isTracked = (first.shipping_cost_out ?? 5.50) > 2.00;
  const shipLabel = isTracked ? 'Tracked (Chit Chats)' : 'Lettermail';
  const shipColor = isTracked ? 'var(--blue)' : 'var(--green)';

  const addressParts = [
    first.buyer_address_line1,
    first.buyer_address_line2,
    [first.buyer_city, first.buyer_province].filter(Boolean).join(', '),
    first.buyer_postal_code,
    first.buyer_country,
  ].filter(Boolean);
  const hasAddress = addressParts.length > 0;

  // Build card rows HTML
  const rowsHtml = items.map(item => `
    <tr>
      <td class="oc-card-name">${escHtml(item.card_name || '—')}</td>
      <td class="oc-card-num">${escHtml(item.card_number || '—')}</td>
      <td class="oc-card-qty">${item.quantity || 1}</td>
    </tr>
  `).join('');

  const isTrackedClass = isTracked ? 'oc-badge-tracked' : 'oc-badge-letter';

  const card = document.createElement('div');
  card.className = 'order-card';
  card.dataset.orderGroup = JSON.stringify(items.map(i => i.id));

  card.innerHTML = `
    <div class="order-card-header">
      <div class="oc-meta">
        <span class="oc-order-id">${escHtml(first.ebay_order_id || 'Manual')}</span>
        <span class="oc-date">${formatDate(first.sale_date)}</span>
        <span class="oc-ship-badge ${isTrackedClass}">${shipLabel}</span>
      </div>
      <button class="oc-ship-btn no-print" onclick="markShipped(this)">✓ Mark Shipped</button>
    </div>

    <div class="order-card-body">
      <!-- Left: ship-to address -->
      <div class="order-buyer-block">
        <div class="oc-section-label">Ship To</div>
        <div class="oc-buyer-name">${escHtml(first.buyer_name || 'Unknown Buyer')}</div>
        ${hasAddress ? `
          <div class="oc-address">
            ${first.buyer_address_line1 ? `<div>${escHtml(first.buyer_address_line1)}</div>` : ''}
            ${first.buyer_address_line2 ? `<div>${escHtml(first.buyer_address_line2)}</div>` : ''}
            <div>${[first.buyer_city, first.buyer_province].filter(Boolean).map(escHtml).join(', ')}</div>
            ${first.buyer_postal_code ? `<div>${escHtml(first.buyer_postal_code)}</div>` : ''}
            <div>${escHtml(first.buyer_country || '')}</div>
          </div>
        ` : `<div class="oc-addr-warn">⚠ Address not captured — check eBay<br><small>eBay: @${escHtml(first.buyer_username || '—')}</small></div>`}
      </div>

      <!-- Right: cards to pick -->
      <div class="order-items-block">
        <div class="oc-section-label">Cards to Pick</div>
        <table class="oc-table">
          <thead>
            <tr>
              <th>Card</th>
              <th>Set Number</th>
              <th>Qty</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;

  return card;
}

// ─── Mark shipped ─────────────────────────────────────────────────────────────

async function markShipped(btn) {
  const card    = btn.closest('.order-card');
  const ids     = JSON.parse(card.dataset.orderGroup);
  const payload = { shipped: true, shipped_at: new Date().toISOString() };

  btn.disabled    = true;
  btn.textContent = '…';

  try {
    // PATCH each sale row
    await Promise.all(ids.map(async id => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/sales?id=eq.${id}`, {
        method:  'PATCH',
        headers: { ...DB_HEADERS, 'Prefer': 'return=minimal' },
        body:    JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`PATCH failed ${r.status}: ${await r.text()}`);
    }));

    // Animate out
    card.style.transition = 'opacity 0.3s, transform 0.3s';
    card.style.opacity    = '0';
    card.style.transform  = 'translateY(-8px)';
    setTimeout(() => {
      card.remove();
      // Update badge count
      const remaining = document.querySelectorAll('.order-card').length;
      const badge = document.getElementById('orders-count-badge');
      if (remaining === 0) {
        badge.style.display = 'none';
        document.getElementById('orders-empty').style.display = '';
      } else {
        badge.textContent = `${remaining} order${remaining !== 1 ? 's' : ''} pending`;
      }
    }, 300);

  } catch (err) {
    btn.disabled    = false;
    btn.textContent = '✓ Mark Shipped';
    showToast('Failed to mark shipped: ' + err.message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}
