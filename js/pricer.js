// js/pricer.js — Deal Checker tab
// Looks up TCG Low price from card_inventory, converts USD→CAD, applies negotiation scale %.
// No eBay. No external market data. Just your database + a live exchange rate.

let _pricerInitDone = false;
let _pricerTcgLow   = null;   // { usd, cad } | null
let _usdCadRate     = null;
let _usdCadRateTime = 0;
const RATE_CACHE_MS = 60 * 60 * 1000; // cache rate for 1 hour

// ── USD → CAD ─────────────────────────────────────────────────────────────────
async function getPricerUsdCadRate() {
  const now = Date.now();
  if (_usdCadRate && (now - _usdCadRateTime) < RATE_CACHE_MS) return _usdCadRate;
  try {
    const res  = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data?.rates?.CAD) { _usdCadRate = data.rates.CAD; _usdCadRateTime = now; return _usdCadRate; }
  } catch (_) {}
  try {
    const res  = await fetch('https://api.frankfurter.app/latest?from=USD&to=CAD');
    const data = await res.json();
    if (data?.rates?.CAD) { _usdCadRate = data.rates.CAD; _usdCadRateTime = now; return _usdCadRate; }
  } catch (_) {}
  return (_usdCadRate || 1.38);
}

// ── DB lookup: TCG Low for card_number + rarity ───────────────────────────────
async function lookupTcgLow(cardNumber, rarity, cadRate) {
  const params = new URLSearchParams({
    card_number: `eq.${cardNumber}`,
    rarity:      `eq.${rarity}`,
    select:      'card_name,tcg_low_price,tcg_price_cad',
    limit:       1,
  });
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/card_inventory?${params}`,
    { headers: DB_HEADERS_RETURN }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const row  = rows[0];
  if (!row || !(parseFloat(row.tcg_low_price) > 0)) return null;
  const usd = parseFloat(row.tcg_low_price);
  const cad = row.tcg_price_cad ? parseFloat(row.tcg_price_cad) : +(usd * cadRate).toFixed(2);
  return { usd, cad, card_name: row.card_name || '' };
}

// ── Shipping cost ─────────────────────────────────────────────────────────────
function pricerShipping(sellPriceCAD, dest) {
  if (sellPriceCAD < 30) return 2.00;
  return { ontario: 5.00, canada: 12.00, usa: 13.50 }[dest] ?? 12.00;
}

// ── Profit calculation ────────────────────────────────────────────────────────
function calcDeal(sellPriceCAD, costCAD, dest) {
  if (!sellPriceCAD || sellPriceCAD <= 0) return null;
  const ebayFee   = +(sellPriceCAD * 0.15).toFixed(2);
  const shipping  = +pricerShipping(sellPriceCAD, dest).toFixed(2);
  const net       = +(sellPriceCAD - ebayFee - shipping - costCAD).toFixed(2);
  const margin    = +((net / sellPriceCAD) * 100).toFixed(1);
  const roi       = costCAD > 0 ? Math.round((net / costCAD) * 100) : null;
  const breakEven = +(sellPriceCAD * 0.85 - shipping).toFixed(2);
  return { sellPrice: +sellPriceCAD.toFixed(2), ebayFee, shipping, cost: costCAD, net, margin, roi, breakEven };
}

// ── Verdict ───────────────────────────────────────────────────────────────────
function pricerVerdict(calc) {
  if (!calc) return 'nodata';
  if (calc.net >= 15 && calc.margin >= 35) return 'strong';
  if (calc.net > 0) return 'marginal';
  return 'skip';
}

// ── Init ──────────────────────────────────────────────────────────────────────
function initPricer() {
  if (_pricerInitDone) return;
  _pricerInitDone = true;

  const rarSel = document.getElementById('pricer-rarity');
  if (typeof RARITIES !== 'undefined') {
    RARITIES.forEach(r => {
      const o = document.createElement('option');
      o.value = r; o.textContent = r;
      rarSel.appendChild(o);
    });
  }

  document.getElementById('pricer-check-btn').addEventListener('click', runPricerCheck);
  document.getElementById('pricer-card-number').addEventListener('keydown', e => {
    if (e.key === 'Enter') runPricerCheck();
  });

  document.getElementById('pricer-cost').addEventListener('input', () => {
    if (_pricerTcgLow) renderPricerResults();
  });
  document.getElementById('pricer-ship-dest').addEventListener('change', () => {
    if (_pricerTcgLow) renderPricerResults();
  });
  document.getElementById('pricer-scale-pct').addEventListener('input', onScaleChange);
}

// ── Scale % handler ───────────────────────────────────────────────────────────
function onScaleChange() {
  if (!_pricerTcgLow) return;
  const pct   = parseFloat(document.getElementById('pricer-scale-pct').value) || 0;
  const offer = pct > 0 ? +(_pricerTcgLow.cad * pct / 100).toFixed(2) : 0;

  const offerEl = document.getElementById('p-offer-price');
  if (offerEl) offerEl.textContent = offer > 0 ? `C$${offer.toFixed(2)}` : '—';

  // Auto-fill cost and re-render profit table
  const costEl = document.getElementById('pricer-cost');
  if (costEl && offer > 0) {
    costEl.value = offer.toFixed(2);
    renderPricerResults();
  }
}

// ── Main fetch ────────────────────────────────────────────────────────────────
async function runPricerCheck() {
  const cardNum = document.getElementById('pricer-card-number').value.trim().toUpperCase();
  const rarity  = document.getElementById('pricer-rarity').value;

  if (!cardNum) { showToast('Enter a card number'); return; }
  if (!rarity)  { showToast('Select a rarity');     return; }

  setPricerState('loading');
  _pricerTcgLow = null;

  try {
    const rate    = await getPricerUsdCadRate();
    _pricerTcgLow = await lookupTcgLow(cardNum, rarity, rate);

    if (!_pricerTcgLow) {
      setPricerState('error',
        `No TCG Low price found for ${cardNum} — ${rarity}.\n` +
        `Make sure the card exists in your collection and the Bulk Price Updater has been run.`
      );
      return;
    }

    document.getElementById('pricer-cost').value      = '';
    document.getElementById('pricer-scale-pct').value = '80';

    const banner = document.getElementById('pricer-card-name-banner');
    if (banner && _pricerTcgLow.card_name) {
      document.getElementById('pricer-card-name-text').textContent = _pricerTcgLow.card_name;
      document.getElementById('pricer-card-rarity-text').textContent = `${cardNum} · ${rarity}`;
      banner.style.display = '';
    } else if (banner) {
      banner.style.display = 'none';
    }

    setPricerState('results');
    renderPricerResults();
    onScaleChange(); // pre-fill cost at 80%

    setTimeout(() => document.getElementById('pricer-scale-pct').focus(), 50);

  } catch (e) {
    setPricerState('error', 'Lookup failed: ' + e.message);
  }
}

function setPricerState(state, msg = '') {
  document.getElementById('pricer-loading').style.display   = state === 'loading' ? 'flex'  : 'none';
  document.getElementById('pricer-results').style.display   = state === 'results' ? 'block' : 'none';
  document.getElementById('pricer-error-box').style.display = state === 'error'   ? 'block' : 'none';
  if (state === 'error') document.getElementById('pricer-error-box').textContent = msg;
  document.getElementById('pricer-check-btn').disabled = (state === 'loading');
}

// ── Render results ────────────────────────────────────────────────────────────
function renderPricerResults() {
  if (!_pricerTcgLow) return;
  const cost = parseFloat(document.getElementById('pricer-cost').value) || 0;
  const dest = document.getElementById('pricer-ship-dest').value;
  const rate = _usdCadRate || 1.38;

  // TCG Low panel
  document.getElementById('p-tcglow-rate').textContent = `1 USD = C$${rate.toFixed(4)}`;
  document.getElementById('p-tcglow-usd').textContent  = `$${_pricerTcgLow.usd.toFixed(2)} USD`;
  document.getElementById('p-tcglow-cad').textContent  = `C$${_pricerTcgLow.cad.toFixed(2)}`;

  // Refresh offer price display
  const pct   = parseFloat(document.getElementById('pricer-scale-pct').value) || 0;
  const offer = pct > 0 ? +(_pricerTcgLow.cad * pct / 100).toFixed(2) : 0;
  const offerEl = document.getElementById('p-offer-price');
  if (offerEl) offerEl.textContent = offer > 0 ? `C$${offer.toFixed(2)}` : '—';

  // Profit table — sell at TCG Low CAD
  const calc   = calcDeal(_pricerTcgLow.cad, cost, dest);
  const tbody  = document.getElementById('pricer-tbody');
  tbody.innerHTML = '';

  if (calc) {
    const sign     = calc.net >= 0 ? '+' : '';
    const netColor = calc.net >= 15 && calc.margin >= 35 ? 'var(--green)'
                   : calc.net > 0                         ? 'var(--yellow)'
                   : 'var(--red)';
    const roiColor  = (calc.roi ?? 0) > 0 ? 'var(--green)' : 'var(--red)';
    const shipLabel = calc.shipping === 2 ? 'letter mail' : 'tracked';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong style="color:var(--gold2)">Sell at TCG Low</strong><br>
        <span class="muted small">TCGPlayer lowest listed price</span>
      </td>
      <td class="cinzel" style="font-size:1.05rem;white-space:nowrap">C$${calc.sellPrice.toFixed(2)}</td>
      <td style="color:var(--red);white-space:nowrap">−C$${calc.ebayFee.toFixed(2)}</td>
      <td style="color:var(--red);white-space:nowrap">
        −C$${calc.shipping.toFixed(2)}<br>
        <span class="muted small">${shipLabel}</span>
      </td>
      <td style="color:var(--muted);white-space:nowrap">−C$${calc.cost.toFixed(2)}</td>
      <td style="color:${netColor};font-weight:700;font-size:1.1rem;white-space:nowrap">${sign}C$${calc.net.toFixed(2)}</td>
      <td style="color:${netColor};white-space:nowrap">${calc.margin.toFixed(1)}%</td>
      <td style="color:${roiColor};white-space:nowrap">${calc.roi !== null ? calc.roi + '%' : '—'}</td>
    `;
    tbody.appendChild(tr);
  } else {
    tbody.innerHTML = `<tr><td colspan="8" class="muted text-center" style="padding:20px">Enter your cost above to see profit breakdown</td></tr>`;
  }

  // Break-even
  const beBox = document.getElementById('pricer-breakeven');
  if (calc && calc.breakEven > 0) {
    beBox.style.display = 'flex';
    document.getElementById('p-breakeven').textContent = `C$${calc.breakEven.toFixed(2)}`;
    let beNote;
    if (cost <= 0)                   beNote = 'Max you can pay and still break even at TCG Low';
    else if (cost <= calc.breakEven) beNote = `Your cost C$${cost.toFixed(2)} is C$${(calc.breakEven - cost).toFixed(2)} under break-even ✓`;
    else                             beNote = `Your cost C$${cost.toFixed(2)} is C$${(cost - calc.breakEven).toFixed(2)} OVER break-even ✗`;
    document.getElementById('p-be-note').textContent = beNote;
  } else {
    beBox.style.display = 'none';
  }

  renderPricerVerdict(pricerVerdict(calc), calc, cost);
}

// ── Verdict panel ─────────────────────────────────────────────────────────────
function renderPricerVerdict(verdict, calc, cost) {
  const panel = document.getElementById('pricer-verdict');
  const cfgs = {
    strong:   { icon: '✅', label: 'STRONG BUY', color: 'var(--green)',  bg: 'rgba(61,184,122,0.08)',   border: 'rgba(61,184,122,0.25)'  },
    marginal: { icon: '⚠️', label: 'MARGINAL',   color: 'var(--yellow)', bg: 'rgba(232,176,48,0.07)',   border: 'rgba(232,176,48,0.25)'  },
    skip:     { icon: '❌', label: 'SKIP',        color: 'var(--red)',    bg: 'rgba(224,72,72,0.07)',    border: 'rgba(224,72,72,0.25)'   },
    nodata:   { icon: '❓', label: 'NO DATA',     color: 'var(--muted)', bg: 'rgba(255,255,255,0.02)',   border: 'rgba(255,255,255,0.07)' },
  };
  const cfg = cfgs[verdict] || cfgs.nodata;

  let desc = '';
  if (verdict === 'strong')
    desc = `You pocket <strong style="color:var(--green)">C$${calc.net.toFixed(2)}</strong> after all fees and shipping — ${calc.margin.toFixed(1)}% margin${calc.roi !== null ? ', ' + calc.roi + '% ROI' : ''}.`;
  if (verdict === 'marginal')
    desc = `Thin profit of <strong style="color:var(--yellow)">C$${calc.net.toFixed(2)}</strong> at ${calc.margin.toFixed(1)}% margin. Worth it only if you can negotiate lower or it moves quickly.`;
  if (verdict === 'skip' && calc)
    desc = `You'd <strong style="color:var(--red)">lose C$${Math.abs(calc.net).toFixed(2)}</strong> selling at TCG Low. Break-even cost is C$${calc.breakEven.toFixed(2)} — don't pay more than that.`;
  if (verdict === 'nodata')
    desc = 'Adjust the % scale or enter your cost manually to see the profit breakdown.';

  panel.style.cssText = `display:block;background:${cfg.bg};border:1px solid ${cfg.border};border-radius:12px;padding:18px 22px;margin-top:20px`;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-size:1.55rem;line-height:1">${cfg.icon}</span>
      <span class="cinzel" style="font-size:1.25rem;color:${cfg.color};letter-spacing:0.06em">${cfg.label}</span>
    </div>
    <p style="color:var(--txt);margin:0;line-height:1.65;font-size:0.95rem">${desc}</p>
  `;
}
