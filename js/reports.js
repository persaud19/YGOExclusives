// ─── reports.js — Reports Tab ─────────────────────────────────────────────────
// All inventory queries target card_inventory (new schema).
// Pricing basis: tcg_low_price (TCG lowest listed, USD), shown in CAD.

let reportsInitialized = false;
let _reportsCadRate    = null;

async function getReportsCadRate() {
  if (_reportsCadRate) return _reportsCadRate;
  try {
    const res  = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data?.rates?.CAD) { _reportsCadRate = data.rates.CAD; return _reportsCadRate; }
  } catch (_) {}
  try {
    const res  = await fetch('https://api.frankfurter.app/latest?from=USD&to=CAD');
    const data = await res.json();
    if (data?.rates?.CAD) { _reportsCadRate = data.rates.CAD; return _reportsCadRate; }
  } catch (_) {}
  return (_reportsCadRate = 1.38);
}

function initReports() {
  if (reportsInitialized) return;
  reportsInitialized = true;
  loadReports();
}

function refreshReports() {
  const btn = document.getElementById('refresh-reports-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Refreshing…'; }

  const ids = ['report-stats','report-inv-overview','report-set-value','report-high-value',
               'report-high-qty','report-monthly-pl','report-price-movers','report-weekly-ai'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<p class="muted small">Loading…</p>';
  });

  _reportsCadRate = null;
  loadReports().finally(() => {
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Refresh Reports'; }
  });
}

async function loadReports() {
  const cadRate = await getReportsCadRate().catch(() => 1.38);
  const sales   = await getMonthlySales().catch(() => []);

  renderSummaryStats(sales);
  renderMonthlyPL(sales);

  const run = async (fetchFn, renderFn, containerId, ...args) => {
    try {
      const data = await fetchFn();
      renderFn(data, ...args);
    } catch (e) {
      const el = document.getElementById(containerId);
      if (el) el.innerHTML = `<p class="red small">Error: ${e.message}</p>`;
      console.error(containerId, e);
    }
  };

  await Promise.all([
    run(getInventoryOverviewRows, renderInventoryOverview, 'report-inv-overview', cadRate),
    run(getHighValueUnlisted,     renderHighValueUnlisted,  'report-high-value',   cadRate),
    run(getHighQtyUnlisted,       renderHighQtyUnlisted,    'report-high-qty',     cadRate),
    run(getSetValueRows,          renderSetValue,           'report-set-value',    cadRate),
    loadPriceMovers('week'),
    loadWeeklyReport(),
  ]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const _e = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const _cad = (usd, rate) => usd > 0 ? +(usd * rate).toFixed(2) : 0;

// ─── Summary stats (from sales table — no schema change needed) ───────────────

function renderSummaryStats(sales) {
  const container = document.getElementById('report-stats');
  if (!container) return;

  const totalRevenue = sales.reduce((s, r) => s + (parseFloat(r.sale_price)  || 0), 0);
  const totalNet     = sales.reduce((s, r) => s + (parseFloat(r.net_profit)  || 0), 0);
  const totalSales   = sales.length;

  const nowMo   = new Date().toISOString().slice(0, 7);
  const thisMo  = sales.filter(s => s.sale_date?.startsWith(nowMo));
  const moNet   = thisMo.reduce((s, r) => s + (parseFloat(r.net_profit) || 0), 0);
  const moRev   = thisMo.reduce((s, r) => s + (parseFloat(r.sale_price) || 0), 0);

  const pct = (v, t) => t > 0 ? ((v / t) * 100).toFixed(1) + '%' : '—';

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${totalSales.toLocaleString()}</div>
      <div class="stat-label">Total Sales</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">$${totalRevenue.toFixed(0)}</div>
      <div class="stat-label">All-Time Revenue</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:${totalNet >= 0 ? 'var(--green)' : 'var(--red)'}">
        ${totalNet >= 0 ? '+' : ''}$${totalNet.toFixed(0)}
      </div>
      <div class="stat-label">All-Time Net Profit</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:${moNet >= 0 ? 'var(--green)' : 'var(--red)'}">
        ${moNet >= 0 ? '+' : ''}$${moNet.toFixed(0)}
      </div>
      <div class="stat-label">This Month Profit</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">$${moRev.toFixed(0)}</div>
      <div class="stat-label">This Month Revenue</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${thisMo.length}</div>
      <div class="stat-label">This Month Sales</div>
    </div>`;
}

// ─── Inventory Overview ───────────────────────────────────────────────────────
// Segments by TCG Low price: High-End $50+, B&B $5–49, Bulk <$5

async function getInventoryOverviewRows() {
  const all = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/card_inventory` +
      `?select=tcg_low_price,tcg_price_cad,qty_total&limit=${PAGE}&offset=${offset}`,
      { headers: DB_HEADERS_RETURN }
    );
    if (!res.ok) break;
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function renderInventoryOverview(rows, cadRate) {
  const container = document.getElementById('report-inv-overview');
  if (!container) return;

  let totalQty = 0;
  let hiQty = 0, hiVal = 0;
  let bbQty = 0, bbVal = 0;
  let blkQty = 0, blkVal = 0;

  for (const r of rows) {
    const qty  = r.qty_total || 0;
    const low  = parseFloat(r.tcg_low_price) || 0;
    const cad  = r.tcg_price_cad ? parseFloat(r.tcg_price_cad) : _cad(low, cadRate);
    totalQty += qty;
    const totalCardVal = cad * qty;
    if (low >= 50) { hiQty  += qty; hiVal  += totalCardVal; }
    else if (low >= 5) { bbQty  += qty; bbVal  += totalCardVal; }
    else               { blkQty += qty; blkVal += totalCardVal; }
  }

  const totalVal = hiVal + bbVal + blkVal;
  const hiPct  = totalQty > 0 ? Math.round((hiQty  / totalQty) * 100) : 0;
  const bbPct  = totalQty > 0 ? Math.round((bbQty  / totalQty) * 100) : 0;
  const blkPct = 100 - hiPct - bbPct;

  const barWidth = (pct, color) =>
    `<div style="width:${pct}%;background:${color};height:100%;display:inline-block;vertical-align:top" title="${pct}%"></div>`;

  container.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      <div class="stat-card" style="flex:1;min-width:130px">
        <div class="stat-value cinzel">${totalQty.toLocaleString()}</div>
        <div class="stat-label">Total Cards</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:130px">
        <div class="stat-value cinzel" style="color:var(--gold2)">C$${totalVal.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
        <div class="stat-label">Total Value (TCG Low CAD)</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:130px">
        <div class="stat-value cinzel" style="color:var(--gold2)">${rows.length.toLocaleString()}</div>
        <div class="stat-label">Unique Printings</div>
      </div>
    </div>

    <div style="background:var(--b1);border-radius:8px;overflow:hidden;height:18px;margin-bottom:8px">
      ${barWidth(hiPct, 'var(--gold2)')}${barWidth(bbPct, 'var(--blue)')}${barWidth(blkPct, 'var(--dim)')}
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:0.82rem">
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--gold2);border-radius:2px;margin-right:5px;vertical-align:middle"></span>
        <strong style="color:var(--gold2)">High-End</strong> (TCG Low ≥$50) &mdash; ${hiQty.toLocaleString()} cards · C$${hiVal.toLocaleString(undefined,{maximumFractionDigits:0})} · ${hiPct}%
      </span>
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--blue);border-radius:2px;margin-right:5px;vertical-align:middle"></span>
        <strong style="color:var(--blue)">Bread &amp; Butter</strong> ($5–49) &mdash; ${bbQty.toLocaleString()} cards · C$${bbVal.toLocaleString(undefined,{maximumFractionDigits:0})} · ${bbPct}%
      </span>
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--dim);border-radius:2px;margin-right:5px;vertical-align:middle"></span>
        <strong class="muted">Bulk</strong> (&lt;$5) &mdash; ${blkQty.toLocaleString()} cards · C$${blkVal.toLocaleString(undefined,{maximumFractionDigits:0})} · ${blkPct}%
      </span>
    </div>
    <div class="muted small" style="margin-top:8px">Rate used: 1 USD = C$${cadRate.toFixed(4)} &nbsp;·&nbsp; Cards without a TCG Low price are excluded from value totals</div>`;
}

// ─── High Value Unlisted — top 50 by TCG Low ─────────────────────────────────

async function getHighValueUnlisted() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/card_inventory` +
    `?listed=eq.false&tcg_low_price=gt.0` +
    `&select=card_number,card_name,rarity,set_name,tcg_price,tcg_low_price,tcg_price_cad,acquisition_cost,qty_total` +
    `&order=tcg_low_price.desc&limit=500`,
    { headers: DB_HEADERS_RETURN }
  );
  if (!res.ok) throw new Error('High-value fetch failed: ' + res.status);
  return res.json();
}

function renderHighValueUnlisted(cards, cadRate) {
  const container = document.getElementById('report-high-value');
  if (!container) return;

  const top50 = cards.filter(c => (c.qty_total || 0) > 0).slice(0, 50);

  if (!top50.length) {
    container.innerHTML = '<p class="muted small">No unlisted cards with a TCG Low price and qty > 0 found.</p>';
    return;
  }

  container.innerHTML = `
    <div style="overflow-x:auto">
    <table style="width:100%">
      <thead>
        <tr>
          <th class="muted small" style="width:28px;text-align:center">#</th>
          <th>Card</th>
          <th>Rarity</th>
          <th>Set</th>
          <th>TCG Low (USD)</th>
          <th>TCG Low (CAD)</th>
          <th>TCG Market</th>
          <th style="text-align:center">Qty</th>
          <th>Cost In</th>
        </tr>
      </thead>
      <tbody>
        ${top50.map((c, i) => {
          const low    = parseFloat(c.tcg_low_price)    || 0;
          const market = parseFloat(c.tcg_price)        || 0;
          const cost   = parseFloat(c.acquisition_cost) || 0;
          const lowCad = c.tcg_price_cad ? parseFloat(c.tcg_price_cad) : _cad(low, cadRate);
          return `<tr>
            <td class="muted small" style="text-align:center">${i + 1}</td>
            <td>
              <span style="font-weight:500">${_e(c.card_name)}</span>
              <span class="cinzel" style="color:var(--muted);font-size:0.7rem;display:block">${_e(c.card_number)}</span>
            </td>
            <td><span class="badge ${getRarityBadgeClass(c.rarity)}">${_e(c.rarity || '')}</span></td>
            <td class="small muted" style="white-space:nowrap">${_e(c.set_name || '')}</td>
            <td class="cinzel" style="color:var(--gold2);white-space:nowrap">${low > 0 ? '$' + low.toFixed(2) : '—'}</td>
            <td class="cinzel" style="color:var(--gold2);white-space:nowrap">${lowCad > 0 ? 'C$' + lowCad.toFixed(2) : '—'}</td>
            <td class="small muted" style="white-space:nowrap">${market > 0 ? '$' + market.toFixed(2) : '—'}</td>
            <td class="cinzel" style="text-align:center;font-size:1.05rem;font-weight:700">${c.qty_total}</td>
            <td class="small muted">${cost > 0 ? '$' + cost.toFixed(2) : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>`;
}

// ─── High Qty Unlisted — top 50 by qty (TCG Low > $5) ────────────────────────

async function getHighQtyUnlisted() {
  const all = [];
  let offset = 0;
  const PAGE = 1000;
  while (all.length < 2000) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/card_inventory` +
      `?listed=eq.false&tcg_low_price=gt.5` +
      `&select=card_number,card_name,rarity,set_name,tcg_price,tcg_low_price,tcg_price_cad,acquisition_cost,qty_total` +
      `&limit=${PAGE}&offset=${offset}`,
      { headers: DB_HEADERS_RETURN }
    );
    if (!res.ok) break;
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function renderHighQtyUnlisted(cards, cadRate) {
  const container = document.getElementById('report-high-qty');
  if (!container) return;

  const top50 = cards
    .filter(c => (c.qty_total || 0) > 0)
    .sort((a, b) => (b.qty_total - a.qty_total) || (parseFloat(b.tcg_low_price) - parseFloat(a.tcg_low_price)))
    .slice(0, 50);

  if (!top50.length) {
    container.innerHTML = '<p class="muted small">No unlisted cards with TCG Low &gt;$5 and qty &gt;0 found.</p>';
    return;
  }

  container.innerHTML = `
    <div style="overflow-x:auto">
    <table style="width:100%">
      <thead>
        <tr>
          <th class="muted small" style="width:28px;text-align:center">#</th>
          <th>Card</th>
          <th>Rarity</th>
          <th>Set</th>
          <th style="text-align:center">Qty</th>
          <th>TCG Low (USD)</th>
          <th>TCG Low (CAD)</th>
          <th style="color:var(--green)">Total Value (CAD)</th>
          <th>Cost In</th>
        </tr>
      </thead>
      <tbody>
        ${top50.map((c, i) => {
          const low      = parseFloat(c.tcg_low_price)    || 0;
          const cost     = parseFloat(c.acquisition_cost) || 0;
          const lowCad   = c.tcg_price_cad ? parseFloat(c.tcg_price_cad) : _cad(low, cadRate);
          const totalCad = lowCad * (c.qty_total || 0);
          return `<tr>
            <td class="muted small" style="text-align:center">${i + 1}</td>
            <td>
              <span style="font-weight:500">${_e(c.card_name)}</span>
              <span class="cinzel" style="color:var(--muted);font-size:0.7rem;display:block">${_e(c.card_number)}</span>
            </td>
            <td><span class="badge ${getRarityBadgeClass(c.rarity)}">${_e(c.rarity || '')}</span></td>
            <td class="small muted" style="white-space:nowrap">${_e(c.set_name || '')}</td>
            <td class="cinzel" style="color:var(--gold2);text-align:center;font-size:1.1rem;font-weight:700">${c.qty_total}</td>
            <td class="cinzel" style="color:var(--gold2);white-space:nowrap">${low > 0 ? '$' + low.toFixed(2) : '—'}</td>
            <td class="cinzel" style="color:var(--gold2);white-space:nowrap">${lowCad > 0 ? 'C$' + lowCad.toFixed(2) : '—'}</td>
            <td class="cinzel" style="color:var(--green);white-space:nowrap;font-weight:700">${totalCad > 0 ? 'C$' + totalCad.toFixed(2) : '—'}</td>
            <td class="small muted">${cost > 0 ? '$' + cost.toFixed(2) : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>`;
}

// ─── Monthly P&L (reads from sales — works with new schema) ──────────────────

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
    container.innerHTML = '<p class="muted small">No sales recorded yet.</p>';
    return;
  }

  container.innerHTML = `
    <table style="width:100%">
      <thead>
        <tr>
          <th>Month</th><th>Sales</th><th>Revenue</th><th>Platform Fees</th><th>COGS</th><th>Shipping Out</th><th>Net Profit</th><th>Margin</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(([mo, d]) => {
          const margin = d.revenue > 0 ? ((d.net / d.revenue) * 100).toFixed(1) + '%' : '—';
          return `<tr>
            <td class="cinzel small">${mo}</td>
            <td class="muted small">${d.count}</td>
            <td class="cinzel">$${d.revenue.toFixed(2)}</td>
            <td class="small muted">$${d.fees.toFixed(2)}</td>
            <td class="small muted">$${d.cogs.toFixed(2)}</td>
            <td class="small muted">$${d.shipping.toFixed(2)}</td>
            <td class="cinzel ${d.net >= 0 ? 'green' : 'red'}">${d.net >= 0 ? '+' : ''}$${d.net.toFixed(2)}</td>
            <td class="small ${d.net >= 0 ? '' : 'red'}">${margin}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// ─── Inventory Value by Set (top 10 · TCG Low × qty, in CAD) ─────────────────

async function getSetValueRows() {
  const all = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/card_inventory?tcg_low_price=gt.0` +
      `&select=card_number,tcg_low_price,tcg_price_cad,qty_total&limit=${PAGE}&offset=${offset}`,
      { headers: DB_HEADERS_RETURN }
    );
    if (!res.ok) break;
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function renderSetValue(rows, cadRate) {
  const container = document.getElementById('report-set-value');
  if (!container) return;

  if (!rows.length) {
    container.innerHTML = '<p class="muted small">No priced cards yet. Run the Bulk Price Updater first.</p>';
    return;
  }

  const sets = {};
  rows.forEach(c => {
    const setCode = (c.card_number || '').split('-')[0];
    if (!setCode) return;
    if (!sets[setCode]) sets[setCode] = { valueCad: 0, cards: 0 };
    const qty    = c.qty_total || 0;
    const low    = parseFloat(c.tcg_low_price) || 0;
    const cad    = c.tcg_price_cad ? parseFloat(c.tcg_price_cad) : _cad(low, cadRate);
    sets[setCode].valueCad += qty * cad;
    sets[setCode].cards++;
  });

  const sorted = Object.entries(sets)
    .filter(([, d]) => d.valueCad > 0)
    .sort((a, b) => b[1].valueCad - a[1].valueCad)
    .slice(0, 10);

  if (!sorted.length) {
    container.innerHTML = '<p class="muted small">No inventory value data. Run the Bulk Price Updater first.</p>';
    return;
  }

  const maxVal = sorted[0][1].valueCad;
  container.innerHTML = sorted.map(([code, d], i) => {
    const pct = Math.round((d.valueCad / maxVal) * 100);
    return `
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
          <span class="cinzel" style="font-size:0.85rem;color:var(--txt)">${code}</span>
          <span class="cinzel" style="color:var(--gold2);font-size:0.9rem">C$${d.valueCad.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
        </div>
        <div class="progress-wrap">
          <div class="progress-bar" style="width:${pct}%;background:${i === 0 ? 'var(--gold2)' : 'var(--b2)'}"></div>
        </div>
        <div class="muted small" style="margin-top:2px">${d.cards.toLocaleString()} priced print${d.cards !== 1 ? 'ings' : 'ing'}</div>
      </div>`;
  }).join('');
}

// ─── Download utilities ───────────────────────────────────────────────────────

function downloadTableCSV(filename, tableEl) {
  if (!tableEl) return;
  const rows = [...tableEl.querySelectorAll('tr')].map(tr =>
    [...tr.querySelectorAll('th,td')]
      .map(cell => `"${cell.textContent.trim().replace(/"/g, '""')}"`)
      .join(',')
  );
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function downloadText(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

window.dlReport = function(sectionId, filename) {
  const table = document.querySelector(`#${sectionId} table`);
  if (table) { downloadTableCSV(filename, table); return; }
  const txt = document.querySelector(`#${sectionId} [data-dl-content]`);
  if (txt) { downloadText(filename, txt.dataset.dlContent, 'text/markdown'); return; }
  if (typeof showToast === 'function') showToast('No data to download — wait for report to load');
};

// ─── Price Movers (week / month / year toggle) ────────────────────────────────

async function getPriceMovers(period) {
  const daysMap = { week: 7, month: 30, year: 365 };
  const days    = daysMap[period] || 7;

  // Latest snapshot
  const latestRes = await fetch(
    `${SUPABASE_URL}/rest/v1/price_history?select=snapshot_date&order=snapshot_date.desc&limit=1`,
    { headers: DB_HEADERS_RETURN }
  );
  if (!latestRes.ok) return null;
  const latestRows = await latestRes.json();
  if (!latestRows.length) return { hasData: false };
  const latestDate = latestRows[0].snapshot_date;

  // Nearest snapshot before the lookback target
  const target = new Date(latestDate);
  target.setDate(target.getDate() - days);
  const targetStr = target.toISOString().split('T')[0];

  const priorRes = await fetch(
    `${SUPABASE_URL}/rest/v1/price_history?snapshot_date=lte.${targetStr}&select=snapshot_date&order=snapshot_date.desc&limit=1`,
    { headers: DB_HEADERS_RETURN }
  );
  if (!priorRes.ok) return { hasData: true, latestDate, priorDate: null };
  const priorRows = await priorRes.json();
  if (!priorRows.length) return { hasData: true, latestDate, priorDate: null, noPrior: true };
  const priorDate = priorRows[0].snapshot_date;

  const [recentRes, olderRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/price_history?snapshot_date=eq.${latestDate}&select=card_number,card_name,rarity,tcg_low_price&limit=10000`, { headers: DB_HEADERS_RETURN }),
    fetch(`${SUPABASE_URL}/rest/v1/price_history?snapshot_date=eq.${priorDate}&select=card_number,rarity,tcg_low_price&limit=10000`,           { headers: DB_HEADERS_RETURN }),
  ]);
  if (!recentRes.ok || !olderRes.ok) return null;

  return {
    hasData: true, latestDate, priorDate,
    recent:  await recentRes.json(),
    older:   await olderRes.json(),
  };
}

async function loadPriceMovers(period) {
  const container = document.getElementById('report-price-movers');
  if (!container) return;
  container.innerHTML = '<p class="muted small">Loading…</p>';
  try {
    const data = await getPriceMovers(period);
    renderPriceMovers(data, period);
  } catch (e) {
    container.innerHTML = `<p class="red small">Error: ${e.message}</p>`;
  }
}

window.switchPriceMovers = function(period) {
  document.querySelectorAll('.pm-toggle-btn').forEach(b => {
    b.style.background = b.dataset.period === period ? 'var(--gold)' : 'var(--b1)';
    b.style.color      = b.dataset.period === period ? '#1a1530'     : 'var(--muted)';
  });
  loadPriceMovers(period);
};

function renderPriceMovers(data, period = 'week') {
  const container = document.getElementById('report-price-movers');
  if (!container) return;

  const periodLabel = { week: '1 Week', month: '1 Month', year: '1 Year' };

  const toggleHtml = `
    <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
      ${['week','month','year'].map(p => `
        <button class="pm-toggle-btn" data-period="${p}" onclick="switchPriceMovers('${p}')"
          style="padding:4px 14px;border-radius:6px;border:none;cursor:pointer;font-size:0.78rem;font-weight:600;
                 background:${p === period ? 'var(--gold)' : 'var(--b1)'};
                 color:${p === period ? '#1a1530' : 'var(--muted)'}">
          ${periodLabel[p]}
        </button>`).join('')}
      <button onclick="dlReport('report-price-movers','price-movers-${period}.csv')"
        style="margin-left:auto;padding:4px 12px;border-radius:6px;border:1px solid var(--b2);
               background:transparent;color:var(--muted);font-size:0.75rem;cursor:pointer">
        Download CSV
      </button>
    </div>`;

  if (!data || !data.hasData) {
    container.innerHTML = toggleHtml + `<p class="muted small">Run the Bulk Price Updater at least once to seed price history, then again next week to see movement.</p>`;
    return;
  }
  if (data.noPrior || !data.priorDate) {
    container.innerHTML = toggleHtml + `<p class="muted small">No snapshot found from ${periodLabel[period].toLowerCase()} ago yet — need more history. Latest snapshot: ${data.latestDate}.</p>`;
    return;
  }
  if (!data.recent?.length || !data.older?.length) {
    container.innerHTML = toggleHtml + `<p class="muted small">Only one price snapshot found. Need at least two to compare movement.</p>`;
    return;
  }

  const priorMap = new Map();
  data.older.forEach(r => {
    const key = `${r.card_number}|${r.rarity || ''}`;
    if (!priorMap.has(key)) priorMap.set(key, parseFloat(r.tcg_low_price) || 0);
  });

  const allMovers = data.recent
    .map(r => {
      const key  = `${r.card_number}|${r.rarity || ''}`;
      const now  = parseFloat(r.tcg_low_price) || 0;
      const then = priorMap.get(key) || 0;
      if (now <= 0 || then <= 0) return null;
      const pct = ((now - then) / then) * 100;
      if (Math.abs(pct) < 10) return null;
      return { card_number: r.card_number, card_name: r.card_name, rarity: r.rarity, now, then, pct };
    })
    .filter(Boolean);

  const gainers = allMovers.filter(r => r.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 20);
  const losers  = allMovers.filter(r => r.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 20);

  if (!gainers.length && !losers.length) {
    container.innerHTML = toggleHtml + `<p class="muted small">No significant price moves (±10%) between ${data.priorDate} and ${data.latestDate}.</p>`;
    return;
  }

  const mkTable = (rows, color) => rows.length === 0 ? '<p class="muted small">None this period.</p>' : `
    <div style="overflow-x:auto">
    <table style="width:100%">
      <thead><tr><th>Card</th><th>Rarity</th><th>Prior</th><th>Now</th><th>Change</th></tr></thead>
      <tbody>
        ${rows.map(c => `<tr>
          <td>
            <span style="font-weight:500;font-size:0.85rem">${_e(c.card_name || c.card_number)}</span>
            <span class="cinzel muted" style="font-size:0.68rem;display:block">${_e(c.card_number)}</span>
          </td>
          <td><span class="badge ${getRarityBadgeClass(c.rarity)}">${_e(c.rarity || '')}</span></td>
          <td class="cinzel small muted">$${c.then.toFixed(2)}</td>
          <td class="cinzel small">$${c.now.toFixed(2)}</td>
          <td class="cinzel" style="color:${color};font-weight:700">${c.pct >= 0 ? '+' : ''}${c.pct.toFixed(0)}%</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;

  container.innerHTML = `
    ${toggleHtml}
    <div class="muted small" style="margin-bottom:12px">${data.priorDate} → ${data.latestDate}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <div style="font-size:0.78rem;font-weight:600;color:var(--green);margin-bottom:8px;letter-spacing:0.05em">GAINERS</div>
        ${mkTable(gainers, 'var(--green)')}
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:600;color:var(--red);margin-bottom:8px;letter-spacing:0.05em">LOSERS</div>
        ${mkTable(losers, 'var(--red)')}
      </div>
    </div>`;
}

// ─── Weekly AI Report ─────────────────────────────────────────────────────────

async function loadWeeklyReport() {
  const container = document.getElementById('report-weekly-ai');
  if (!container) return;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/weekly_reports?select=report_date,report_md&order=report_date.desc&limit=1`,
      { headers: DB_HEADERS_RETURN }
    );
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    const rows = await res.json();
    if (!rows.length) {
      container.innerHTML = '<p class="muted small">No weekly report yet — will appear here after the first Monday morning run.</p>';
      return;
    }
    renderWeeklyReport(rows[0]);
  } catch (e) {
    container.innerHTML = `<p class="red small">Error loading report: ${e.message}</p>`;
  }
}

function renderWeeklyReport(row) {
  const container = document.getElementById('report-weekly-ai');
  if (!container) return;

  const md      = row.report_md || '';
  const date    = row.report_date || '';
  const html    = markdownToHtml(md);
  const dlName  = `ygoexclusives-market-report-${date}.md`;

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <span class="muted small">Generated: ${date}</span>
      <button onclick="dlReport('report-weekly-ai','${dlName}')"
        style="padding:4px 12px;border-radius:6px;border:1px solid var(--b2);
               background:transparent;color:var(--muted);font-size:0.75rem;cursor:pointer">
        Download .md
      </button>
    </div>
    <div data-dl-content="${_e(md)}" style="display:none"></div>
    <div class="report-md-body">${html}</div>`;
}

// Minimal markdown → HTML (headings, bold, bullets, paragraphs, tables)
function markdownToHtml(md) {
  if (!md) return '';
  let html = _e(md);

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h4 style="color:var(--gold2);font-family:\'Cinzel\',serif;font-size:0.82rem;letter-spacing:0.06em;margin:18px 0 8px">$1</h4>');
  html = html.replace(/^## (.+)$/gm,  '<h3 style="color:var(--gold2);font-family:\'Cinzel\',serif;font-size:0.88rem;letter-spacing:0.06em;margin:22px 0 10px">$1</h3>');
  html = html.replace(/^# (.+)$/gm,   '<h2 style="color:var(--gold2);font-family:\'Cinzel\',serif;font-size:1rem;letter-spacing:0.06em;margin:0 0 14px">$1</h2>');

  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g,     '<em>$1</em>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--b2);margin:16px 0">');

  // Tables (pipe-delimited) — basic support
  html = html.replace(/((?:^\|.+\|\n)+)/gm, (block) => {
    const rows = block.trim().split('\n').filter(l => !/^\|[-: |]+\|$/.test(l));
    return '<div style="overflow-x:auto"><table style="width:100%;font-size:0.8rem">' +
      rows.map((row, i) => {
        const cells = row.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        const tag   = i === 0 ? 'th' : 'td';
        return '<tr>' + cells.map(c => `<${tag} style="padding:5px 8px">${c.trim()}</${tag}>`).join('') + '</tr>';
      }).join('') +
      '</table></div>';
  });

  // Bullet lists
  html = html.replace(/((?:^[-*] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /, '')}</li>`).join('');
    return `<ul style="margin:6px 0 10px;padding-left:20px;line-height:1.7">${items}</ul>`;
  });

  // Paragraphs (double newline)
  html = html.replace(/\n{2,}/g, '</p><p style="margin:0 0 10px;line-height:1.7">');
  html = `<p style="margin:0 0 10px;line-height:1.7">${html}</p>`;
  html = html.replace(/<p[^>]*>\s*(<(?:h[2-4]|ul|div|hr|table)[^>]*>)/g, '$1');
  html = html.replace(/(<\/(?:h[2-4]|ul|div|hr|table)>)\s*<\/p>/g, '$1');
  html = html.replace(/\n/g, ' ');

  return html;
}
