// ─── sales.js — Multi-channel sales log ───────────────────────────────────────

// EBAY_FEE_PCT is defined in config.js
const STORE_PROC_PCT   = 0.029;
const STORE_PROC_FIXED = 0.30;

const CHANNEL_META = {
  ebay:      { label: 'eBay',       badge: 'badge-blue',   hasShipping: true  },
  facebook:  { label: 'Facebook',   badge: 'badge-purple', hasShipping: true  },
  in_person: { label: 'In-Person',  badge: 'badge-green',  hasShipping: false },
  ygo_store: { label: 'YGO Store',  badge: 'badge-gold',   hasShipping: true  },
};

let salesInitialized = false;
let salesPage        = 0;
let activeSaleChannel = 'ebay';
const SALES_PAGE_SIZE = 50;

// ─── Init ─────────────────────────────────────────────────────────────────────

function initSales() {
  if (salesInitialized) return;
  salesInitialized = true;
  document.getElementById('sale-date').value = new Date().toISOString().slice(0, 10);
  wireSaleChannelTabs();
  wireSaleFormInputs();
  document.getElementById('sale-form').addEventListener('submit', submitSale);
  document.getElementById('sales-prev-btn').addEventListener('click', () => {
    if (salesPage > 0) { salesPage--; loadSalesPage(); }
  });
  document.getElementById('sales-next-btn').addEventListener('click', () => {
    salesPage++; loadSalesPage();
  });
  switchSaleChannel('ebay');
  loadSalesPage();
}

// ─── Channel tab switching ────────────────────────────────────────────────────

function wireSaleChannelTabs() {
  document.querySelectorAll('.sale-ch-tab').forEach(btn => {
    btn.addEventListener('click', () => switchSaleChannel(btn.dataset.ch));
  });
}

function switchSaleChannel(ch) {
  activeSaleChannel = ch;

  // Update tab active state
  document.querySelectorAll('.sale-ch-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ch === ch);
  });

  // Channel-specific field rows: show only those matching active channel
  // A field with class sale-ch-X is shown when X === ch
  document.querySelectorAll('[class*="sale-ch-"]').forEach(el => {
    if (el.classList.contains('sale-ch-tab')) return; // skip the tab buttons
    const channels = [...el.classList]
      .filter(c => c.startsWith('sale-ch-') && c !== 'sale-ch-field')
      .map(c => c.replace('sale-ch-', ''));
    if (channels.length) {
      el.style.display = channels.includes(ch) ? '' : 'none';
    }
  });

  // Shipping section visibility
  const meta = CHANNEL_META[ch];
  document.getElementById('sale-shipping-section').style.display =
    meta.hasShipping ? '' : 'none';

  // Buyer username label + visibility
  const usernameWrap = document.getElementById('sale-buyer-username-wrap');
  const usernameLbl  = document.getElementById('sale-buyer-username-lbl');
  if (ch === 'ebay') {
    usernameWrap.style.display = '';
    usernameLbl.textContent = 'eBay Username';
  } else if (ch === 'facebook') {
    usernameWrap.style.display = '';
    usernameLbl.textContent = 'FB Profile Name';
  } else {
    usernameWrap.style.display = 'none';
  }

  // Country field only relevant for eBay + store (shipping dest matters)
  const countryWrap = document.getElementById('sale-buyer-country-wrap');
  countryWrap.style.display = (ch === 'ebay' || ch === 'ygo_store') ? '' : 'none';

  // Auto-calc FVF and processor fee when price changes
  recalcNetPreview();
}

// ─── Live input wiring ────────────────────────────────────────────────────────

function wireSaleFormInputs() {
  const priceEl = document.getElementById('sale-price');
  const fvfEl   = document.getElementById('sale-fvf');
  const procEl  = document.getElementById('sale-processor-fee');

  priceEl.addEventListener('input', () => {
    const price = parseFloat(priceEl.value) || 0;

    if (activeSaleChannel === 'ebay' && fvfEl) {
      fvfEl.value = (price * EBAY_FEE_PCT).toFixed(2);
    }
    if (activeSaleChannel === 'ygo_store' && procEl) {
      procEl.value = (price * STORE_PROC_PCT + STORE_PROC_FIXED).toFixed(2);
    }
    recalcNetPreview();
  });

  // Recalc whenever any relevant field changes
  ['sale-acq-cost','sale-shipping-charged','sale-shipping-out',
   'sale-fvf','sale-pl-fee','sale-processor-fee'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', recalcNetPreview);
  });
}

function recalcNetPreview() {
  const net = calcNetProfit();
  const el  = document.getElementById('sale-net-preview');
  el.textContent = (net >= 0 ? '+' : '') + '$' + Math.abs(net).toFixed(2);
  el.style.color = net >= 0 ? 'var(--green)' : 'var(--red)';
}

function calcNetProfit() {
  const price      = parseFloat(document.getElementById('sale-price')?.value)          || 0;
  const acqCost    = parseFloat(document.getElementById('sale-acq-cost')?.value)       || 0;
  const shipCharged= parseFloat(document.getElementById('sale-shipping-charged')?.value)|| 0;
  const shipOut    = parseFloat(document.getElementById('sale-shipping-out')?.value)    || 0;
  const fvf        = parseFloat(document.getElementById('sale-fvf')?.value)            || 0;
  const plFee      = parseFloat(document.getElementById('sale-pl-fee')?.value)         || 0;
  const procFee    = parseFloat(document.getElementById('sale-processor-fee')?.value)  || 0;

  switch (activeSaleChannel) {
    case 'ebay':
      return price + shipCharged - fvf - plFee - shipOut - acqCost;
    case 'facebook':
      return price + shipCharged - shipOut - acqCost;
    case 'in_person':
      return price - acqCost;
    case 'ygo_store':
      return price + shipCharged - procFee - shipOut - acqCost;
    default:
      return 0;
  }
}

// ─── Load & render ────────────────────────────────────────────────────────────

async function loadSalesPage() {
  const tbody = document.getElementById('sales-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="muted text-center">Loading…</td></tr>';
  try {
    const { rows, total } = await getSalesPage({ page: salesPage, pageSize: SALES_PAGE_SIZE });
    renderSalesRows(rows, tbody);
    const info = document.getElementById('sales-page-info');
    const hasPrev = document.getElementById('sales-prev-btn');
    const hasNext = document.getElementById('sales-next-btn');
    info.textContent = total
      ? `${salesPage * SALES_PAGE_SIZE + 1}–${Math.min((salesPage + 1) * SALES_PAGE_SIZE, total)} of ${total}`
      : '0 sales';
    hasPrev.disabled = salesPage === 0;
    hasNext.disabled = (salesPage + 1) * SALES_PAGE_SIZE >= total;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="red text-center">Error: ${escHtml(e.message)}</td></tr>`;
  }
}

function renderSalesRows(rows, tbody) {
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted text-center" style="padding:24px">No sales yet</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(s => {
    const profit  = parseFloat(s.net_profit) || 0;
    const ch      = s.platform || 'ebay';
    const meta    = CHANNEL_META[ch] || CHANNEL_META.ebay;
    const profitCls = profit >= 0 ? 'var(--green)' : 'var(--red)';
    const tracking  = s.tracking_number
      ? `<span class="small" style="font-family:monospace;color:var(--muted)">${escHtml(s.tracking_number)}</span>`
      : '<span class="muted small">—</span>';
    return `<tr>
      <td class="small muted">${s.sale_date}</td>
      <td style="max-width:160px">
        <div style="font-weight:500">${escHtml(s.card_name)}</div>
        ${s.card_number ? `<div class="small muted">${escHtml(s.card_number)}</div>` : ''}
      </td>
      <td><span class="badge ${meta.badge}">${meta.label}</span></td>
      <td class="cinzel" style="text-align:right">$${Number(s.sale_price||0).toFixed(2)}</td>
      <td class="cinzel" style="text-align:right;color:${profitCls}">
        ${profit >= 0 ? '+' : ''}$${Math.abs(profit).toFixed(2)}
      </td>
      <td>${tracking}</td>
      <td class="small muted">${escHtml(s.buyer_name || '')}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteSaleRow('${s.id}')">✕</button>
      </td>
    </tr>`;
  }).join('');
}

// ─── Submit ───────────────────────────────────────────────────────────────────

async function submitSale(e) {
  e.preventDefault();
  const get    = id => document.getElementById(id)?.value?.trim() || '';
  const getNum = id => parseFloat(document.getElementById(id)?.value) || 0;
  const ch     = activeSaleChannel;

  const shared = {
    id:               crypto.randomUUID(),
    platform:         ch,
    source:           'manual',
    sale_date:        get('sale-date') || new Date().toISOString().slice(0, 10),
    card_name:        get('sale-card-name'),
    card_number:      get('sale-card-number') || null,
    set_name:         get('sale-set-name')    || null,
    rarity:           get('sale-rarity')      || null,
    quantity:         parseInt(document.getElementById('sale-qty')?.value) || 1,
    sale_price:       getNum('sale-price'),
    acquisition_cost: getNum('sale-acq-cost'),
    buyer_name:       get('sale-buyer-name')  || null,
    buyer_username:   get('sale-buyer-username') || null,
    buyer_city:       get('sale-buyer-city')  || null,
    buyer_country:    get('sale-buyer-country') || null,
    net_profit:       calcNetProfit(),
    created_at:       new Date().toISOString(),
  };

  // Channel-specific fields
  const channelFields = {};

  if (ch === 'ebay') {
    Object.assign(channelFields, {
      final_value_fee:      getNum('sale-fvf'),
      promoted_listing_fee: getNum('sale-pl-fee'),
      platform_fee:         getNum('sale-fvf') + getNum('sale-pl-fee'),
      shipping_charged:     getNum('sale-shipping-charged'),
      shipping_cost_out:    getNum('sale-shipping-out'),
      shipping_service:     get('sale-shipping-service') || null,
      tracking_number:      get('sale-tracking')  || null,
      ebay_order_id:        get('sale-ebay-order-id') || null,
    });
  } else if (ch === 'facebook') {
    Object.assign(channelFields, {
      platform_fee:      0,
      shipping_charged:  getNum('sale-shipping-charged'),
      shipping_cost_out: getNum('sale-shipping-out'),
      shipping_service:  get('sale-shipping-service') || null,
      tracking_number:   get('sale-tracking')  || null,
      fb_group_name:     get('sale-fb-group')  || null,
      payment_method:    get('sale-payment-method') || null,
    });
  } else if (ch === 'in_person') {
    Object.assign(channelFields, {
      platform_fee:        0,
      shipping_charged:    0,
      shipping_cost_out:   0,
      in_person_location:  get('sale-location') || null,
      payment_method:      get('sale-payment-method') || null,
    });
  } else if (ch === 'ygo_store') {
    Object.assign(channelFields, {
      payment_processor_fee: getNum('sale-processor-fee'),
      platform_fee:          getNum('sale-processor-fee'),
      shipping_charged:      getNum('sale-shipping-charged'),
      shipping_cost_out:     getNum('sale-shipping-out'),
      shipping_service:      get('sale-shipping-service') || null,
      tracking_number:       get('sale-tracking') || null,
      payment_method:        get('sale-payment-method') || null,
    });
  }

  const sale = { ...shared, ...channelFields };

  try {
    await saveSale(sale);
    salesPage = 0;
    loadSalesPage();
    document.getElementById('sale-form').reset();
    document.getElementById('sale-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('sale-net-preview').textContent = '$0.00';
    document.getElementById('sale-net-preview').style.color = 'var(--green)';
    switchSaleChannel(ch); // re-apply channel visibility after reset
    showToast('Sale logged!');
  } catch (err) {
    showToast('Failed: ' + err.message);
  }
}

// ─── eBay Sync trigger ────────────────────────────────────────────────────────

async function triggerEbaySync() {
  const btn    = document.getElementById('ebay-sync-btn');
  const status = document.getElementById('ebay-sync-status');
  btn.disabled = true;
  status.textContent = 'Syncing…';
  status.style.color = 'var(--muted)';

  try {
    const apiKey = localStorage.getItem('ygoexclusives_sync_key') || '';
    const res    = await fetch(`/.netlify/functions/ebay-sync?api_key=${encodeURIComponent(apiKey)}`);
    const data   = await res.json();

    if (!res.ok) throw new Error(data.error || res.status);

    status.textContent = `✓ Synced ${data.upserted || 0} orders from eBay (${data.orders_fetched || 0} fetched)`;
    status.style.color = 'var(--green)';
    salesPage = 0;
    loadSalesPage();
  } catch (err) {
    status.textContent = `✗ Sync failed: ${err.message}`;
    status.style.color = 'var(--red)';
  } finally {
    btn.disabled = false;
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

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
