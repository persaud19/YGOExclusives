// js/pricer.js — Deal Checker tab
// Fetches live eBay data, converts USD→CAD, shows break-even + profit breakdown + verdict

let _pricerInitDone = false;
let _pricerEbayData = null;   // { lowestCAD, medianCAD, activeCount, soldCount, usdRate }
let _usdCadRate     = null;
let _usdCadRateTime = 0;
const RATE_CACHE_MS = 60 * 60 * 1000; // 1 hour

// ── USD → CAD ────────────────────────────────────────────────────────────────
async function getPricerUsdCadRate() {
  const now = Date.now();
  if (_usdCadRate && (now - _usdCadRateTime) < RATE_CACHE_MS) return _usdCadRate;
  try {
    const res  = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data?.rates?.CAD) {
      _usdCadRate     = data.rates.CAD;
      _usdCadRateTime = now;
      return _usdCadRate;
    }
  } catch (_) {}
  return _usdCadRate || 1.38; // last cached or hardcoded fallback
}

// ── Shipping cost ─────────────────────────────────────────────────────────────
// Under $30 CAD sale price: letter mail $2
// $30+ CAD: tracked — Ontario $5 / Canada-wide $12 / USA $13.50
function pricerShipping(sellPriceCAD, dest) {
  if (sellPriceCAD < 30) return 2.00;
  const map = { ontario: 5.00, canada: 12.00, usa: 13.50 };
  return map[dest] ?? 12.00;
}

// ── Profit calculation ────────────────────────────────────────────────────────
function calcDeal(sellPriceCAD, costCAD, dest) {
  if (!sellPriceCAD || sellPriceCAD <= 0) return null;
  const ebayFee  = +(sellPriceCAD * 0.15).toFixed(2);
  const shipping = +pricerShipping(sellPriceCAD, dest).toFixed(2);
  const net      = +(sellPriceCAD - ebayFee - shipping - costCAD).toFixed(2);
  const margin   = +((net / sellPriceCAD) * 100).toFixed(1);
  const roi      = costCAD > 0 ? Math.round((net / costCAD) * 100) : null;
  // Break-even: max you can pay and still profit $0
  // sellPrice × 0.85 − shipping = breakEven
  const breakEven = +(sellPriceCAD * 0.85 - shipping).toFixed(2);
  return { sellPrice: +sellPriceCAD.toFixed(2), ebayFee, shipping, cost: costCAD, net, margin, roi, breakEven };
}

// ── Verdict ───────────────────────────────────────────────────────────────────
// Strong Buy:  net ≥ $15 AND margin ≥ 35%
// Marginal:    net > $0 (but doesn't hit strong threshold)
// Skip:        net ≤ $0
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

  // Populate rarity dropdown from config.js RARITIES array
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

  // Live recalc when cost or destination changes (while results are showing)
  document.getElementById('pricer-cost').addEventListener('input', () => {
    if (_pricerEbayData) renderPricerResults();
  });
  document.getElementById('pricer-ship-dest').addEventListener('change', () => {
    if (_pricerEbayData) renderPricerResults();
  });
}

// ── Fetch & render ────────────────────────────────────────────────────────────
async function runPricerCheck() {
  const cardNum = document.getElementById('pricer-card-number').value.trim().toUpperCase();
  const rarity  = document.getElementById('pricer-rarity').value;

  if (!cardNum) { showToast('Enter a card number'); return; }
  if (!rarity)  { showToast('Select a rarity');     return; }

  setPricerState('loading');

  try {
    const [rate, raw] = await Promise.all([
      getPricerUsdCadRate(),
      fetch(
        `/.netlify/functions/ebay-prices` +
        `?card_number=${encodeURIComponent(cardNum)}` +
        `&rarity=${encodeURIComponent(rarity)}`
      ).then(r => r.json()),
    ]);

    if (raw.error === 'rate_limit') {
      setPricerState('error', 'eBay rate limit reached — resets at midnight PT. Try again tomorrow.');
      return;
    }
    if (raw.error) {
      setPricerState('error', raw.message || raw.error);
      return;
    }

    _pricerEbayData = {
      lowestCAD:   raw.lowestListed     ? +(raw.lowestListed     * rate).toFixed(2) : null,
      medianCAD:   raw.recentSoldMedian ? +(raw.recentSoldMedian * rate).toFixed(2) : null,
      activeCount: raw.activeCount || 0,
      soldCount:   raw.soldCount   || 0,
      usdRate: rate,
    };

    // Reset cost field for the new card, then focus it so user can type immediately
    document.getElementById('pricer-cost').value = '';

    setPricerState('results');
    renderPricerResults();

    // Focus cost input after a tick so the results div is visible
    setTimeout(() => document.getElementById('pricer-cost').focus(), 50);

  } catch (e) {
    setPricerState('error', 'Fetch failed: ' + e.message);
  }
}

function setPricerState(state, msg = '') {
  document.getElementById('pricer-loading').style.display  = state === 'loading' ? 'flex'  : 'none';
  document.getElementById('pricer-results').style.display  = state === 'results' ? 'block' : 'none';
  document.getElementById('pricer-error-box').style.display = state === 'error'  ? 'block' : 'none';
  if (state === 'error') document.getElementById('pricer-error-box').textContent = msg;
  document.getElementById('pricer-check-btn').disabled = (state === 'loading');
}

// ── Render results ────────────────────────────────────────────────────────────
function renderPricerResults() {
  const d    = _pricerEbayData;
  const cost = parseFloat(document.getElementById('pricer-cost').value) || 0;
  const dest = document.getElementById('pricer-ship-dest').value;

  // Rate badge
  document.getElementById('pricer-rate-badge').textContent = `1 USD = $${d.usdRate.toFixed(4)} CAD`;

  // Market stat boxes
  document.getElementById('p-lowest').textContent = d.lowestCAD  ? `$${d.lowestCAD.toFixed(2)}`  : '—';
  document.getElementById('p-median').textContent = d.medianCAD  ? `$${d.medianCAD.toFixed(2)}`  : '—';
  document.getElementById('p-active').textContent = d.activeCount ?? '—';
  document.getElementById('p-sold').textContent   = d.soldCount  ?? '—';

  // Scenarios — compete at lowest + sell at median
  const scenarios = [
    { label: 'Compete at lowest',  sub: 'Floor the active market',  price: d.lowestCAD  },
    { label: 'Sell at median',     sub: 'Recent sold transactions',  price: d.medianCAD  },
  ].filter(s => s.price != null);

  const tbody = document.getElementById('pricer-tbody');
  tbody.innerHTML = '';
  let mainCalc = null;

  scenarios.forEach((s, i) => {
    const c = calcDeal(s.price, cost, dest);
    if (i === 0) mainCalc = c;
    if (!c) return;

    const sign     = c.net >= 0 ? '+' : '';
    const netColor = c.net >= 15 && c.margin >= 35 ? 'var(--green)'
                   : c.net > 0                      ? 'var(--yellow)'
                   : 'var(--red)';
    const roiColor  = (c.roi ?? 0) > 0 ? 'var(--green)' : 'var(--red)';
    const shipLabel = c.shipping === 2 ? 'letter mail' : 'tracked';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong style="color:var(--gold2)">${s.label}</strong><br>
        <span class="muted small">${s.sub}</span>
      </td>
      <td class="cinzel" style="font-size:1.05rem;white-space:nowrap">$${c.sellPrice.toFixed(2)} CAD</td>
      <td style="color:var(--red);white-space:nowrap">−$${c.ebayFee.toFixed(2)}</td>
      <td style="color:var(--red);white-space:nowrap">
        −$${c.shipping.toFixed(2)}<br>
        <span class="muted small">${shipLabel}</span>
      </td>
      <td style="color:var(--muted);white-space:nowrap">−$${c.cost.toFixed(2)}</td>
      <td style="color:${netColor};font-weight:700;font-size:1.1rem;white-space:nowrap">${sign}$${c.net.toFixed(2)}</td>
      <td style="color:${netColor};white-space:nowrap">${c.margin.toFixed(1)}%</td>
      <td style="color:${roiColor};white-space:nowrap">${c.roi !== null ? c.roi + '%' : '—'}</td>
    `;
    tbody.appendChild(tr);
  });

  if (!scenarios.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="muted text-center" style="padding:20px">
          No eBay listings found for this card + rarity combo
        </td>
      </tr>`;
  }

  // Break-even highlight
  const beBox = document.getElementById('pricer-breakeven');
  if (mainCalc && mainCalc.breakEven > 0) {
    beBox.style.display = 'flex';
    document.getElementById('p-breakeven').textContent = `$${mainCalc.breakEven.toFixed(2)} CAD`;

    let beNote;
    if (cost <= 0) {
      beNote = 'Max you can pay and still break even at lowest listed';
    } else if (cost <= mainCalc.breakEven) {
      const upside = (mainCalc.breakEven - cost).toFixed(2);
      beNote = `Your cost $${cost.toFixed(2)} is $${upside} under break-even ✓`;
    } else {
      const over = (cost - mainCalc.breakEven).toFixed(2);
      beNote = `Your cost $${cost.toFixed(2)} is $${over} OVER break-even ✗`;
    }
    document.getElementById('p-be-note').textContent = beNote;
  } else {
    beBox.style.display = 'none';
  }

  // Verdict
  renderPricerVerdict(pricerVerdict(mainCalc), mainCalc, cost);
}

// ── Verdict panel ─────────────────────────────────────────────────────────────
function renderPricerVerdict(verdict, calc, cost) {
  const panel = document.getElementById('pricer-verdict');
  const cfgs = {
    strong:   { icon: '✅', label: 'STRONG BUY', color: 'var(--green)',  bg: 'rgba(61,184,122,0.08)',  border: 'rgba(61,184,122,0.25)'  },
    marginal: { icon: '⚠️', label: 'MARGINAL',   color: 'var(--yellow)', bg: 'rgba(232,176,48,0.07)', border: 'rgba(232,176,48,0.25)'  },
    skip:     { icon: '❌', label: 'SKIP',        color: 'var(--red)',    bg: 'rgba(224,72,72,0.07)',  border: 'rgba(224,72,72,0.25)'   },
    nodata:   { icon: '❓', label: 'NO DATA',     color: 'var(--muted)', bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.07)' },
  };
  const cfg = cfgs[verdict] || cfgs.nodata;

  let desc = '';
  if (verdict === 'strong')
    desc = `You pocket <strong style="color:var(--green)">$${calc.net.toFixed(2)}</strong> after all fees and shipping — ${calc.margin.toFixed(1)}% margin${calc.roi !== null ? ', ' + calc.roi + '% ROI on your cost' : ''}.`;
  if (verdict === 'marginal')
    desc = `Thin profit of <strong style="color:var(--yellow)">$${calc.net.toFixed(2)}</strong> at ${calc.margin.toFixed(1)}% margin. Worth it only if you can price above the floor or it moves quickly.`;
  if (verdict === 'skip' && calc)
    desc = `You'd <strong style="color:var(--red)">lose $${Math.abs(calc.net).toFixed(2)}</strong> at current market prices. Break-even is $${calc.breakEven.toFixed(2)} CAD — don't pay more than that.`;
  if (verdict === 'skip' && !calc)
    desc = 'No eBay data found for this card.';
  if (verdict === 'nodata')
    desc = 'No eBay listings found. Enter your acquisition cost to see the break-even analysis once market data is available.';

  panel.style.cssText = [
    `display:block`,
    `background:${cfg.bg}`,
    `border:1px solid ${cfg.border}`,
    `border-radius:12px`,
    `padding:18px 22px`,
    `margin-top:20px`,
  ].join(';');

  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-size:1.55rem;line-height:1">${cfg.icon}</span>
      <span class="cinzel" style="font-size:1.25rem;color:${cfg.color};letter-spacing:0.06em">${cfg.label}</span>
    </div>
    <p style="color:var(--txt);margin:0;line-height:1.65;font-size:0.95rem">${desc}</p>
  `;
}
