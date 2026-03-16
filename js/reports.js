// ─── reports.js — Phase 6: Reports ───────────────────────────────────────────

let reportsInitialized = false;

function initReports() {
  if (reportsInitialized) return;
  reportsInitialized = true;
  loadReports();
}

async function loadReports() {
  // Load sales and card data in parallel
  try {
    const [sales, setValueData, priceMovers] = await Promise.all([
      getMonthlySales(),
      getSetValues(),
      getPriceMovers(),
    ]);
    renderSummaryStats(sales);
    renderMonthlyPL(sales);
    renderSetValue(setValueData);
    renderPriceMovers(priceMovers);
  } catch (e) {
    showToast('Reports error: ' + e.message);
  }
}

// ─── Summary stats ────────────────────────────────────────────────────────────
function renderSummaryStats(sales) {
  const container = document.getElementById('report-stats');
  if (!container) return;

  const totalRevenue = sales.reduce((s, r) => s + (parseFloat(r.sale_price) || 0), 0);
  const totalNet     = sales.reduce((s, r) => s + (parseFloat(r.net_profit) || 0), 0);
  const totalSales   = sales.length;

  // Current month
  const nowMo = new Date().toISOString().slice(0, 7);
  const thisMo = sales.filter(s => s.sale_date?.startsWith(nowMo));
  const thisMoNet = thisMo.reduce((s, r) => s + (parseFloat(r.net_profit) || 0), 0);

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${totalSales}</div>
      <div class="stat-label">Total Sales</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">$${totalRevenue.toFixed(0)}</div>
      <div class="stat-label">Total Revenue</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:${totalNet >= 0 ? 'var(--green)' : 'var(--red)'}">
        ${totalNet >= 0 ? '+' : ''}$${totalNet.toFixed(0)}
      </div>
      <div class="stat-label">All-Time Net Profit</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:${thisMoNet >= 0 ? 'var(--green)' : 'var(--red)'}">
        ${thisMoNet >= 0 ? '+' : ''}$${thisMoNet.toFixed(0)}
      </div>
      <div class="stat-label">This Month Profit</div>
    </div>`;
}

// ─── Monthly P&L ──────────────────────────────────────────────────────────────
function renderMonthlyPL(sales) {
  const container = document.getElementById('report-monthly-pl');
  if (!container) return;

  const months = {};
  sales.forEach(s => {
    const mo = s.sale_date?.slice(0, 7) || 'Unknown';
    if (!months[mo]) months[mo] = { revenue: 0, fees: 0, cogs: 0, shipping: 0, net: 0, count: 0 };
    const m = months[mo];
    m.revenue  += parseFloat(s.sale_price)        || 0;
    m.fees     += parseFloat(s.platform_fee)      || 0;
    m.cogs     += parseFloat(s.acquisition_cost)  || 0;
    m.shipping += parseFloat(s.shipping_cost_out) || 0;
    m.net      += parseFloat(s.net_profit)        || 0;
    m.count++;
  });

  const sorted = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0]));
  if (!sorted.length) {
    container.innerHTML = '<p class="muted small">No sales data yet.</p>';
    return;
  }

  container.innerHTML = `
    <table style="width:100%">
      <thead>
        <tr>
          <th>Month</th><th>Sales</th><th>Revenue</th><th>Fees</th><th>COGS</th><th>Shipping Out</th><th>Net Profit</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(([mo, d]) => `
          <tr>
            <td class="cinzel small">${mo}</td>
            <td class="muted small">${d.count}</td>
            <td class="cinzel">$${d.revenue.toFixed(2)}</td>
            <td class="small muted">$${d.fees.toFixed(2)}</td>
            <td class="small muted">$${d.cogs.toFixed(2)}</td>
            <td class="small muted">$${d.shipping.toFixed(2)}</td>
            <td class="cinzel ${d.net >= 0 ? 'green' : 'red'}">${d.net >= 0 ? '+' : ''}$${d.net.toFixed(2)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ─── Inventory Value by Set ───────────────────────────────────────────────────
async function getSetValues() {
  // Fetch all cards with a price — paginate until done
  let allRows = [];
  let offset  = 0;
  const PAGE  = 1000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cards?unlimited_nm=gt.0&select=card_number,unlimited_nm,un_nm,fe_nm&limit=${PAGE}&offset=${offset}`,
      { headers: DB_HEADERS_RETURN }
    );
    if (!res.ok) break;
    const batch = await res.json();
    allRows = allRows.concat(batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

function renderSetValue(cards) {
  const container = document.getElementById('report-set-value');
  if (!container) return;

  if (!cards.length) {
    container.innerHTML = '<p class="muted small">No priced cards yet. Add prices via the Edit modal.</p>';
    return;
  }

  // Group by set code (first segment of card_number before the dash)
  const sets = {};
  cards.forEach(c => {
    const setCode = (c.card_number || '').split('-')[0];
    if (!setCode) return;
    if (!sets[setCode]) sets[setCode] = { value: 0, cards: 0 };
    const qty   = (c.un_nm || 0) + (c.fe_nm || 0);
    const price = parseFloat(c.unlimited_nm) || 0;
    sets[setCode].value += qty * price;
    if (qty > 0 && price > 0) sets[setCode].cards++;
  });

  const sorted = Object.entries(sets)
    .filter(([, d]) => d.value > 0)
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 10);

  if (!sorted.length) {
    container.innerHTML = '<p class="muted small">No inventory value data. Add prices to cards to see set values.</p>';
    return;
  }

  const maxVal = sorted[0][1].value;
  container.innerHTML = sorted.map(([code, d], i) => {
    const pct = Math.round((d.value / maxVal) * 100);
    return `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
          <span class="cinzel" style="font-size:0.85rem;color:var(--txt)">${code}</span>
          <span class="cinzel" style="color:var(--gold2);font-size:0.9rem">$${d.value.toFixed(2)}</span>
        </div>
        <div class="progress-wrap">
          <div class="progress-bar" style="width:${pct}%;background:${i === 0 ? 'var(--gold2)' : 'var(--b2)'}"></div>
        </div>
        <div class="muted small" style="margin-top:2px">${d.cards} priced card${d.cards !== 1 ? 's' : ''}</div>
      </div>`;
  }).join('');
}

// ─── Price Movers ─────────────────────────────────────────────────────────────
async function getPriceMovers() {
  // Get cards where both tcg_market_price and tcg_price_at_acquisition are set
  let allRows = [];
  let offset  = 0;
  const PAGE  = 1000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cards?tcg_market_price=gt.0&tcg_price_at_acquisition=gt.0&select=id,card_number,card_name,rarity,tcg_market_price,tcg_price_at_acquisition&limit=${PAGE}&offset=${offset}`,
      { headers: DB_HEADERS_RETURN }
    );
    if (!res.ok) break;
    const batch = await res.json();
    allRows = allRows.concat(batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

function renderPriceMovers(cards) {
  const container = document.getElementById('report-price-movers');
  if (!container) return;

  if (!cards.length) {
    container.innerHTML = '<p class="muted small">No data. Cards need both a TCG Market Price and a Price at Acquisition to appear here.</p>';
    return;
  }

  // Calculate % change and filter to ±20%+
  const movers = cards
    .map(c => {
      const now  = parseFloat(c.tcg_market_price)       || 0;
      const then = parseFloat(c.tcg_price_at_acquisition) || 0;
      const pct  = then > 0 ? ((now - then) / then) * 100 : 0;
      return { ...c, now, then, pct };
    })
    .filter(c => Math.abs(c.pct) >= 20)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 30); // top 30

  if (!movers.length) {
    container.innerHTML = '<p class="muted small">No significant price moves found (±20% threshold).</p>';
    return;
  }

  const e = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  container.innerHTML = `
    <table style="width:100%">
      <thead>
        <tr>
          <th>Card</th><th>Rarity</th><th>At Acquisition</th><th>Now</th><th>Change</th>
        </tr>
      </thead>
      <tbody>
        ${movers.map(c => {
          const up   = c.pct >= 0;
          const sign = up ? '+' : '';
          return `<tr>
            <td>
              <div style="font-weight:500">${e(c.card_name)}</div>
              <div class="muted small">${e(c.card_number)}</div>
            </td>
            <td><span class="badge ${getRarityBadgeClass(c.rarity)}">${e(c.rarity || '')}</span></td>
            <td class="cinzel small muted">$${c.then.toFixed(2)}</td>
            <td class="cinzel small">$${c.now.toFixed(2)}</td>
            <td class="cinzel" style="color:${up ? 'var(--green)' : 'var(--red)'}">
              ${sign}${c.pct.toFixed(0)}%
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}
