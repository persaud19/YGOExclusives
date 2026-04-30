// ─── sales.js — Phase 5: Sales Log ───────────────────────────────────────────
// TODO: Phase 5

let salesInitialized = false;
let salesPage = 0;
const SALES_PAGE_SIZE = 50;

function initSales() {
  if (salesInitialized) return;
  salesInitialized = true;
  loadSalesPage();
  wireSalesForm();
}

function wireSalesForm() {
  // Auto-calc eBay fee
  const priceEl = document.getElementById('sale-price');
  const platformEl = document.getElementById('sale-platform');
  const feeEl = document.getElementById('sale-fee');

  const autoFee = () => {
    if (platformEl?.value === 'eBay' && priceEl?.value) {
      const fee = (parseFloat(priceEl.value) || 0) * EBAY_FEE_PCT;
      if (feeEl) feeEl.value = fee.toFixed(2);
    }
  };
  priceEl?.addEventListener('input', autoFee);
  platformEl?.addEventListener('change', autoFee);

  document.getElementById('sale-form')?.addEventListener('submit', submitSale);

  document.getElementById('sales-prev-btn')?.addEventListener('click', () => {
    if (salesPage > 0) { salesPage--; loadSalesPage(); }
  });
  document.getElementById('sales-next-btn')?.addEventListener('click', () => {
    salesPage++; loadSalesPage();
  });
}

async function loadSalesPage() {
  const tbody = document.getElementById('sales-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" class="muted text-center">Loading…</td></tr>';
  try {
    const { rows, total } = await getSalesPage({ page: salesPage, pageSize: SALES_PAGE_SIZE });
    renderSalesRows(rows, tbody);
    document.getElementById('sales-page-info').textContent =
      total ? `${salesPage * SALES_PAGE_SIZE + 1}–${Math.min((salesPage+1)*SALES_PAGE_SIZE, total)} of ${total}` : '0 sales';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" class="red text-center">Error: ${escHtml(e.message)}</td></tr>`;
  }
}

function renderSalesRows(rows, tbody) {
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="muted text-center" style="padding:24px">No sales yet</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(s => {
    const profit = parseFloat(s.net_profit) || 0;
    return `<tr>
      <td class="small muted">${s.sale_date}</td>
      <td style="max-width:150px">${escHtml(s.card_name)}</td>
      <td class="small muted">${escHtml(s.set_name||'')}</td>
      <td><span class="badge badge-muted">${escHtml(s.platform||'')}</span></td>
      <td class="cinzel">$${Number(s.sale_price).toFixed(2)}</td>
      <td class="small muted">$${Number(s.platform_fee||0).toFixed(2)}</td>
      <td class="small muted">$${Number(s.acquisition_cost||0).toFixed(2)}</td>
      <td class="cinzel ${profit >= 0 ? 'profit-positive' : 'profit-negative'}">
        ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}
      </td>
      <td class="small muted">${escHtml(s.buyer_name||'')}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteSaleRow('${s.id}')">✕</button>
      </td>
    </tr>`;
  }).join('');
}

async function submitSale(e) {
  e.preventDefault();
  const get = id => document.getElementById(id)?.value?.trim() || '';
  const getNum = id => parseFloat(document.getElementById(id)?.value) || 0;

  const sale = {
    id:               crypto.randomUUID(),
    sale_date:        get('sale-date') || new Date().toISOString().slice(0,10),
    card_name:        get('sale-card-name'),
    card_number:      get('sale-card-number'),
    set_name:         get('sale-set-name'),
    rarity:           get('sale-rarity'),
    platform:         get('sale-platform'),
    sale_price:       getNum('sale-price'),
    shipping_charged: getNum('sale-shipping-charged'),
    platform_fee:     getNum('sale-fee'),
    shipping_cost_out:getNum('sale-shipping-out'),
    acquisition_cost: getNum('sale-acq-cost'),
    buyer_name:       get('sale-buyer-name') || null,
    created_at:       new Date().toISOString(),
  };

  try {
    await saveSale(sale);
    salesPage = 0;
    loadSalesPage();
    document.getElementById('sale-form').reset();
    showToast('Sale logged!');
  } catch (e) {
    showToast('Failed: ' + e.message);
  }
}

async function deleteSaleRow(id) {
  if (!confirm('Delete this sale record?')) return;
  try {
    await deleteSale(id);
    loadSalesPage();
    showToast('Sale deleted');
  } catch (e) {
    showToast('Failed: ' + e.message);
  }
}
