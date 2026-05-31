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
      <td style="padding:8px 12px;font-weight:600;color:var(--txt)">${escHtml(item.card_name || '—')}</td>
      <td style="padding:8px 12px;color:var(--muted);font-size:0.85rem">${escHtml(item.card_number || '—')}</td>
      <td style="padding:8px 12px;text-align:center;font-weight:700;color:var(--gold);font-size:1rem">${item.quantity || 1}</td>
    </tr>
  `).join('');

  const card = document.createElement('div');
  card.className = 'order-card';
  card.dataset.orderGroup = JSON.stringify(items.map(i => i.id));

  card.innerHTML = `
    <div class="order-card-header no-print-actions">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:0.75rem;color:var(--muted);font-family:monospace">${escHtml(first.ebay_order_id || 'Manual')}</span>
        <span style="font-size:0.75rem;color:var(--muted)">${formatDate(first.sale_date)}</span>
        <span style="
          background:${shipColor}22;
          color:${shipColor};
          border:1px solid ${shipColor}44;
          border-radius:99px;
          padding:2px 10px;
          font-size:0.75rem;
          font-weight:600;
        ">${shipLabel}</span>
      </div>
      <button class="btn btn-sm no-print" style="background:var(--green);color:#fff;border:none;cursor:pointer"
        onclick="markShipped(this)">
        ✓ Mark Shipped
      </button>
    </div>

    <div class="order-card-body">
      <!-- Left: buyer info -->
      <div class="order-buyer-block">
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:6px">Ship To</div>
        <div style="font-weight:700;font-size:1rem;color:var(--txt);margin-bottom:2px">${escHtml(first.buyer_name || first.buyer_username || 'Unknown Buyer')}</div>
        ${first.buyer_username ? `<div style="font-size:0.8rem;color:var(--muted);margin-bottom:8px">@${escHtml(first.buyer_username)}</div>` : ''}
        ${hasAddress
          ? `<div style="font-size:0.88rem;color:var(--txt);line-height:1.6">${addressParts.map(p => escHtml(p)).join('<br>')}</div>`
          : `<div style="font-size:0.82rem;color:var(--yellow)">⚠ Address not captured — check eBay</div>`
        }
      </div>

      <!-- Right: items table -->
      <div class="order-items-block">
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:6px">Cards to Pick</div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid var(--b2)">
              <th style="padding:4px 12px 6px;text-align:left;font-size:0.75rem;color:var(--muted);font-weight:600">Card</th>
              <th style="padding:4px 12px 6px;text-align:left;font-size:0.75rem;color:var(--muted);font-weight:600">Number</th>
              <th style="padding:4px 12px 6px;text-align:center;font-size:0.75rem;color:var(--muted);font-weight:600">Qty</th>
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
