// ─── dashboard.js — Dashboard Tab (instant analysis) ─────────────────────────
// One paginated scan of card_inventory feeds every section.
// Price basis per row: max(tcg_price_cad, ebay_low_cad) — "best known" CAD value.
// Category taxonomy (precedence: Nostalgia > Staples > Individual):
//   Nostalgia — card NAME ever printed in the first 10 boosters (LOB → IOC,
//               names fetched from YGOPRODeck once and cached in localStorage)
//               PLUS curated DM/GX anime aces & gods.
//   Staples   — curated modern competitive generics (hand traps, board
//               breakers, generic draw/search, splashable extra deck).
//   Individual — everything else.

let dashboardInitialized = false;
let _dashRows  = null;   // full card_inventory scan
let _dashScope = 'all';  // 'all' | 'binder'

const DASH_NOSTALGIA_CACHE_KEY = 'ygx_nostalgia_names_v1';

// First 10 booster sets (Magic Ruler + Spell Ruler are the same set, both names live on YGOPRODeck)
const DASH_FIRST10_SETS = [
  'Legend of Blue Eyes White Dragon', 'Metal Raiders', 'Magic Ruler', 'Spell Ruler',
  "Pharaoh's Servant", 'Labyrinth of Nightmare', 'Legacy of Darkness',
  'Pharaonic Guardian', "Magician's Force", 'Dark Crisis', 'Invasion of Chaos',
];
// Fallback prefix match if the YGOPRODeck fetch fails (catches copies FROM those sets only)
const DASH_FIRST10_CODES = new Set(['LOB','MRD','MRL','SRL','PSV','LON','LOD','PGD','MFC','DCR','IOC']);

// DM + GX anime aces, gods & signature cards (nostalgia even when the card debuted later)
const DASH_ANIME_ACES = new Set([
  // Egyptian Gods + Sacred Beasts
  'Slifer the Sky Dragon','Obelisk the Tormentor','The Winged Dragon of Ra',
  'The Winged Dragon of Ra - Sphere Mode','Uria, Lord of Searing Flames',
  'Hamon, Lord of Striking Thunder','Raviel, Lord of Phantasms',
  // Yugi
  'Dark Magician of Chaos','Magician of Black Chaos','Black Luster Soldier',
  'Black Luster Soldier - Envoy of the Beginning','Black Luster Soldier - Legendary Swordsman',
  'Toon Black Luster Soldier','Buster Blader','Gaia the Fierce Knight','Swift Gaia the Fierce Knight',
  'Gaia the Dragon Champion','Dragon Master Knight','Dragon Knight Draco-Equiste','Exodia Necross',
  'The Unstoppable Exodia Incarnate','Silent Magician LV8',"Queen's Knight","Jack's Knight",'Kuriboh',
  'Celtic Guardian','Obnoxious Celtic Guardian','Curse of Dragon','Valkyrion the Magna Warrior',
  'Alpha The Magnet Warrior','Beta The Magnet Warrior','Gamma the Magnet Warrior',
  'Chaos Emperor Dragon - Envoy of the End','Magic Cylinder','Gyakutenno Megami','Gemini Elf',
  'Injection Fairy Lily','Catapult Turtle','Big Shield Gardna',
  // Kaiba
  'Blue-Eyes Ultimate Dragon','Blue-Eyes Alternative White Dragon','Blue-Eyes Toon Dragon',
  'Lord of D.','XYZ-Dragon Cannon','Vorse Raider','Ring of Destruction','Crush Card Virus','Kaiser Glider',
  // Joey / Mai
  'Red-Eyes B. Dragon','Red-Eyes Black Metal Dragon','Red-Eyes Dark Dragoon',
  'Red-Eyes Black Fullmetal Dragon','Red-Eyes Flare Metal Dragon','Thousand Dragon','Panther Warrior',
  'Rocket Warrior','Insect Queen','Gearfried the Iron Knight','Gilti-Gearfried the Magical Steel Knight',
  "Harpie's Pet Baby Dragon",'Harpie Conductor',
  // Pegasus / Bakura / Rex / Keith
  'Relinquished','Thousand-Eyes Restrict','Millennium-Eyes Restrict','Dark Sage','Dark Necrofear',
  'Change of Heart','Serpent Night Dragon','Barrel Dragon','Blowback Dragon','Beast of Talwar',
  // GX
  'Cyber Dragon','Elemental HERO Neos','Elemental HERO Neos Kluger','Destiny HERO - Celestial',
  'Destiny HERO - Dasher','Destiny HERO - Destroyer Phoenix Enforcer','Masked HERO Dark Law','Fusion Destiny',
]);

// Modern competitive generics
const DASH_STAPLES = new Set([
  // hand traps
  'Effect Veiler','Infinite Impermanence','Ghost Belle & Haunted Mansion','Ghost Ogre & Snow Rabbit',
  'Ghost Mourner & Moonlit Chill','Ghost Reaper & Winter Cherries','Ghost Sister & Spooky Dogwood',
  'D.D. Crow','Droll & Lock Bird','Nibiru, the Primal Being','Skull Meister','Artifact Lancea',
  'Dimension Shifter','PSY-Framegear Gamma','Mulcharmy Fuwalos','Mulcharmy Meowls','Retaliating "C"',
  'Fantastical Dragon Phantazmay','Shared Ride','Maxx "C"','Ash Blossom & Joyous Spring',
  // generic disruption spells/traps
  'Called by the Grave','Crossout Designator','Solemn Judgment','Solemn Strike','Solemn Warning',
  'Torrential Tribute','Compulsory Evacuation Device',"Ice Dragon's Prison",'Dimensional Barrier',
  'There Can Be Only One','Summon Limit','Skill Drain','Anti-Spell Fragrance','Rivalry of Warlords',
  'Gozen Match','Imperial Iron Wall','Breakthrough Skill','Lost Wind','Trap Trick',
  // board breakers / going second
  'Forbidden Droplet','Dark Ruler No More','Evenly Matched','Lightning Storm',"Harpie's Feather Duster",
  'Super Polymerization','Raigeki','Dark Hole','Cosmic Cyclone','Twin Twisters','Mystical Space Typhoon',
  'Galaxy Cyclone','Lava Golem','Gameciel, the Sea Turtle Kaiju','Gadarla, the Mystery Dust Kaiju',
  'Dogoran, the Mad Flame Kaiju','Dinowrestler Pankratops',
  // generic draw / search / consistency
  'Pot of Desires','Pot of Extravagance','Pot of Prosperity','Pot of Duality','Pot of Greed','Pot of Avarice',
  'Upstart Goblin','Trade-In','Terraforming','Foolish Burial','Foolish Burial Goods','Gold Sarcophagus',
  'Small World','Reasoning','Instant Fusion','Triple Tactics Talent','Triple Tactics Thrust','Duality',
  'Preparation of Rites','Emergency Teleport',
  // splashable extra deck
  'Accesscode Talker','Apollousa, Bow of the Goddess','I:P Masquerena','S:P Little Knight',
  'Divine Arsenal AA-ZEUS - Sky Thunder','Baronne de Fleur','Borreload Savage Dragon','Relinquished Anima',
  'Knightmare Unicorn','Castel, the Skyblaster Musketeer','Abyss Dweller',
  'Number 41: Bagooska the Terribly Tired Tapir','Downerd Magician','Linkuriboh',
  'Mekk-Knight Crusadia Avramax','Artemis, the Magistus Moon Maiden','Number 101: Silent Honor ARK',
  'Time Thief Redoer','Naturia Beast','Super Starslayer TY-PHON - Sky Crisis',
]);

// ─── Init / refresh ───────────────────────────────────────────────────────────

function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;
  loadDashboard();
}

function refreshDashboard() {
  const btn = document.getElementById('refresh-dash-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Refreshing…'; }
  _dashRows = null;
  ['dash-stats','dash-dna','dash-concentration'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<p class="muted small">Loading…</p>';
  });
  loadDashboard().finally(() => {
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Refresh'; }
  });
}

function setDashScope(scope) {
  _dashScope = scope;
  document.querySelectorAll('.dash-scope-btn').forEach(b => {
    b.classList.toggle('btn-primary',  b.dataset.scope === scope);
    b.classList.toggle('btn-secondary', b.dataset.scope !== scope);
  });
  if (_dashRows) {
    renderDashDNA(_dashRows);
    renderDashConcentration(_dashRows);
  }
}

async function loadDashboard() {
  try {
    const [rows] = await Promise.all([fetchDashRows(), fetchNostalgiaNames()]);
    _dashRows = rows;
    renderDashStats(rows);
    renderDashDNA(rows);
    renderDashConcentration(rows);
  } catch (e) {
    console.error('dashboard', e);
    const el = document.getElementById('dash-stats');
    if (el) el.innerHTML = `<p class="red small">Error loading dashboard: ${e.message}</p>`;
  }
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function fetchDashRows() {
  const all = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/card_inventory` +
      `?select=card_number,card_name,qty_total,qty_binder_fe_nm,qty_binder_un_nm,tcg_price_cad,ebay_low_cad,listed` +
      `&limit=${PAGE}&offset=${offset}`,
      { headers: DB_HEADERS_RETURN }
    );
    if (!res.ok) throw new Error(`card_inventory scan failed (${res.status})`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

let _nostalgiaNames = null; // Set of card names printed in the first 10 boosters

async function fetchNostalgiaNames() {
  if (_nostalgiaNames) return _nostalgiaNames;
  try {
    const cached = localStorage.getItem(DASH_NOSTALGIA_CACHE_KEY);
    if (cached) {
      _nostalgiaNames = new Set(JSON.parse(cached));
      return _nostalgiaNames;
    }
  } catch (_) {}

  try {
    const results = await Promise.all(DASH_FIRST10_SETS.map(async setName => {
      const res = await fetch(
        `https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=${encodeURIComponent(setName)}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map(c => c.name);
    }));
    const names = new Set(results.flat());
    if (names.size > 500) { // sanity check before caching
      try { localStorage.setItem(DASH_NOSTALGIA_CACHE_KEY, JSON.stringify([...names])); } catch (_) {}
    }
    _nostalgiaNames = names;
  } catch (e) {
    console.warn('Nostalgia name fetch failed — falling back to set-code prefix match', e);
    _nostalgiaNames = new Set();
  }
  return _nostalgiaNames;
}

// ─── Classification helpers ───────────────────────────────────────────────────

const _dashEsc  = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const _dashBase = name => String(name || '').replace(/\s*\(.*\)$/, ''); // strip "(7th Art)" etc.
const _dashMoney = v => 'C$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 });

function dashRowPrice(r) {
  const tcg  = parseFloat(r.tcg_price_cad) || 0;
  const ebay = parseFloat(r.ebay_low_cad)  || 0;
  return Math.max(tcg, ebay);
}

function dashRowQty(r) {
  if (_dashScope === 'binder') return (r.qty_binder_fe_nm || 0) + (r.qty_binder_un_nm || 0);
  return r.qty_total || 0;
}

function dashCategory(r) {
  const base   = _dashBase(r.card_name);
  const prefix = String(r.card_number || '').split('-')[0].toUpperCase();
  const isNost = (_nostalgiaNames && _nostalgiaNames.size > 0)
    ? (_nostalgiaNames.has(base) || _nostalgiaNames.has(r.card_name) || DASH_ANIME_ACES.has(base))
    : (DASH_FIRST10_CODES.has(prefix) || DASH_ANIME_ACES.has(base));
  if (isNost) return 'nostalgia';
  if (DASH_STAPLES.has(base)) return 'staple';
  return 'individual';
}

// ─── KPI row ──────────────────────────────────────────────────────────────────

function renderDashStats(rows) {
  const el = document.getElementById('dash-stats');
  if (!el) return;

  let totalVal = 0, totalQty = 0, binderVal = 0, binderQty = 0;
  let listedCount = 0, listedVal = 0;

  for (const r of rows) {
    const price = dashRowPrice(r);
    const qty   = r.qty_total || 0;
    const bQty  = (r.qty_binder_fe_nm || 0) + (r.qty_binder_un_nm || 0);
    totalQty  += qty;
    totalVal  += qty * price;
    binderQty += bQty;
    binderVal += bQty * price;
    if (r.listed) { listedCount++; listedVal += price; }
  }

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-value cinzel" style="color:var(--gold2)">${_dashMoney(totalVal)}</div>
      <div class="stat-label">Total Value (CAD)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value cinzel">${totalQty.toLocaleString()}</div>
      <div class="stat-label">Total Cards</div>
    </div>
    <div class="stat-card">
      <div class="stat-value cinzel" style="color:var(--gold2)">${_dashMoney(binderVal)}</div>
      <div class="stat-label">Binder Value</div>
    </div>
    <div class="stat-card">
      <div class="stat-value cinzel">${binderQty.toLocaleString()}</div>
      <div class="stat-label">Binder Cards</div>
    </div>
    <div class="stat-card">
      <div class="stat-value cinzel" style="color:var(--green)">${listedCount.toLocaleString()}</div>
      <div class="stat-label">Listed on eBay (${_dashMoney(listedVal)})</div>
    </div>
    <div class="stat-card">
      <div class="stat-value cinzel">${rows.length.toLocaleString()}</div>
      <div class="stat-label">Unique Printings</div>
    </div>`;
}

// ─── Collection DNA — Nostalgia / Staples / Individual ────────────────────────

function renderDashDNA(rows) {
  const el = document.getElementById('dash-dna');
  if (!el) return;

  const cats = {
    nostalgia:  { label: 'Nostalgia',  color: 'var(--purple)', val: 0, qty: 0 },
    staple:     { label: 'Staples',    color: 'var(--gold2)',  val: 0, qty: 0 },
    individual: { label: 'Individual', color: 'var(--dim)',    val: 0, qty: 0 },
  };

  let totalVal = 0;
  for (const r of rows) {
    const qty = dashRowQty(r);
    if (!qty) continue;
    const line = qty * dashRowPrice(r);
    const c = cats[dashCategory(r)];
    c.val += line;
    c.qty += qty;
    totalVal += line;
  }

  if (totalVal <= 0) {
    el.innerHTML = '<p class="muted small">No priced cards in this scope.</p>';
    return;
  }

  const seg = c => {
    const pct = (c.val / totalVal) * 100;
    return `<div style="width:${pct.toFixed(2)}%;background:${c.color};height:100%;display:inline-block;vertical-align:top" title="${c.label} — ${pct.toFixed(1)}%"></div>`;
  };
  const legend = c => {
    const pct = (c.val / totalVal) * 100;
    return `<span>
      <span style="display:inline-block;width:10px;height:10px;background:${c.color};border-radius:2px;margin-right:5px;vertical-align:middle"></span>
      <strong style="color:${c.color === 'var(--dim)' ? 'var(--muted)' : c.color}">${c.label}</strong>
      &mdash; ${_dashMoney(c.val)} · ${pct.toFixed(1)}% · ${c.qty.toLocaleString()} cards
    </span>`;
  };

  el.innerHTML = `
    <div style="background:var(--b1);border-radius:8px;overflow:hidden;height:22px;margin-bottom:10px;white-space:nowrap">
      ${seg(cats.nostalgia)}${seg(cats.staple)}${seg(cats.individual)}
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:0.82rem">
      ${legend(cats.nostalgia)}${legend(cats.staple)}${legend(cats.individual)}
    </div>
    <div class="muted small" style="margin-top:8px">
      Nostalgia = printed in the first 10 boosters (LOB → IOC) or DM/GX anime ace &middot;
      Staples = modern competitive generics &middot; overlaps count as Nostalgia &middot;
      value = qty × best of TCG CAD / eBay Low CAD
    </div>`;
}

// ─── Value concentration — top 10 names, segmented by set ─────────────────────

const DASH_SEG_COLORS = ['var(--gold2)','var(--blue)','var(--purple)','var(--green)','var(--red)','var(--yellow)','#7a6fd0','#4a9d9a','#b0763a','#5f5e8a'];

function renderDashConcentration(rows) {
  const el = document.getElementById('dash-concentration');
  if (!el) return;

  const byName = new Map();
  let totalVal = 0;

  for (const r of rows) {
    const qty = dashRowQty(r);
    if (!qty) continue;
    const line = qty * dashRowPrice(r);
    totalVal += line;
    const base = _dashBase(r.card_name) || '(unknown)';
    let entry = byName.get(base);
    if (!entry) { entry = { val: 0, qty: 0, sets: new Map() }; byName.set(base, entry); }
    entry.val += line;
    entry.qty += qty;
    const prefix = String(r.card_number || '').split('-')[0].toUpperCase() || '??';
    const s = entry.sets.get(prefix) || { val: 0, qty: 0 };
    s.val += line; s.qty += qty;
    entry.sets.set(prefix, s);
  }

  if (totalVal <= 0) {
    el.innerHTML = '<p class="muted small">No priced cards in this scope.</p>';
    return;
  }

  const top = [...byName.entries()].sort((a, b) => b[1].val - a[1].val).slice(0, 10);
  const maxVal = top.length ? top[0][1].val : 1;
  const topSum = top.reduce((s, [, e]) => s + e.val, 0);

  const setColor = new Map();
  let ci = 0;
  for (const [, entry] of top) {
    for (const prefix of [...entry.sets.keys()].sort((a, b) => entry.sets.get(b).val - entry.sets.get(a).val)) {
      if (!setColor.has(prefix)) setColor.set(prefix, DASH_SEG_COLORS[ci++ % DASH_SEG_COLORS.length]);
    }
  }

  const rowsHtml = top.map(([name, entry]) => {
    const pct   = (entry.val / totalVal) * 100;
    const width = (entry.val / maxVal) * 100;
    const segs  = [...entry.sets.entries()].filter(([, s]) => s.val > 0).sort((a, b) => b[1].val - a[1].val).map(([prefix, s]) => {
      const segPct = (s.val / entry.val) * 100;
      const title  = `${prefix} · ${s.qty} card${s.qty === 1 ? '' : 's'} · ${_dashMoney(s.val)}`;
      const label  = segPct > 14 ? `<span style="font-size:0.62rem;color:#fff;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap">${_dashEsc(prefix)}</span>` : '';
      return `<div style="flex:${s.val.toFixed(2)} 0 0;background:${setColor.get(prefix)};position:relative;border-right:2px solid var(--bg)" title="${_dashEsc(title)}">${label}</div>`;
    }).join('');
    return `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:4px">
          <span style="font-size:0.86rem;font-weight:600">${_dashEsc(name)}</span>
          <span class="muted" style="font-size:0.78rem;white-space:nowrap">${_dashMoney(entry.val)} · ${pct.toFixed(1)}% · ${entry.qty.toLocaleString()} cards</span>
        </div>
        <div style="display:flex;height:18px;width:${width.toFixed(2)}%;min-width:3px;border-radius:4px;overflow:hidden;background:var(--b1)">${segs}</div>
      </div>`;
  }).join('');

  el.innerHTML = `
    ${rowsHtml}
    <div class="muted small" style="margin-top:4px">
      Top 10 of ${byName.size.toLocaleString()} names &middot; together ${_dashMoney(topSum)} = ${((topSum / totalVal) * 100).toFixed(1)}% of ${_dashScope === 'binder' ? 'binder' : 'total'} value &middot;
      bar segments = sets (hover for detail) &middot; alternate arts merged into base name
    </div>`;
}
