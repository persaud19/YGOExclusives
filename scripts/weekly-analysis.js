// scripts/weekly-analysis.js
// Runs via GitHub Actions every Monday after price-update completes (~8:30am EST).
// - Reads price_history for 1W / 1M / 1Y deltas
// - Cross-references card_inventory (what Ryan owns)
// - Calls Claude API to generate sell/hold/buy recommendations
// - Saves markdown report to weekly_reports table in Supabase

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_KEY, or ANTHROPIC_API_KEY');
  process.exit(1);
}

const HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
};

// ── Date helpers ──────────────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

async function findNearestSnapshot(targetDate) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/price_history?snapshot_date=lte.${targetDate}&select=snapshot_date&order=snapshot_date.desc&limit=1`,
    { headers: HEADERS }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.snapshot_date || null;
}

// ── Data fetchers ─────────────────────────────────────────────────────────────
async function fetchSnapshot(date) {
  const all = [];
  let offset = 0;
  const PAGE = 2000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/price_history?snapshot_date=eq.${date}&select=card_number,card_name,rarity,tcg_low_price&limit=${PAGE}&offset=${offset}`,
      { headers: HEADERS }
    );
    if (!res.ok) break;
    const page = await res.json();
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function fetchInventory() {
  const all = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/card_inventory?qty_total=gt.0&select=card_number,card_name,rarity,qty_total,tcg_low_price,acquisition_cost&limit=${PAGE}&offset=${offset}`,
      { headers: HEADERS }
    );
    if (!res.ok) break;
    const page = await res.json();
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── Delta calculation ─────────────────────────────────────────────────────────
function calcDeltas(current, prior) {
  const priorMap = new Map();
  for (const r of prior) {
    priorMap.set(`${r.card_number}|${r.rarity || ''}`, parseFloat(r.tcg_low_price) || 0);
  }

  return current
    .map(r => {
      const now  = parseFloat(r.tcg_low_price) || 0;
      const then = priorMap.get(`${r.card_number}|${r.rarity || ''}`) || 0;
      if (now <= 0 || then <= 0 || Math.abs((now - then) / then * 100) < 5) return null;
      return {
        card_number: r.card_number,
        card_name:   r.card_name,
        rarity:      r.rarity,
        now,
        then,
        pct: (now - then) / then * 100,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct);
}

// ── Format delta table for Claude prompt ─────────────────────────────────────
function formatTable(rows, ownedMap) {
  if (!rows.length) return '_No significant movers._';
  const lines = ['| Card | Rarity | Prior | Now | Δ% | You Own |'];
  lines.push('|---|---|---|---|---|---|');
  for (const r of rows.slice(0, 20)) {
    const owned = ownedMap.get(`${r.card_number}|${r.rarity || ''}`);
    const qty   = owned?.qty_total || 0;
    const cost  = owned ? ` @ $${parseFloat(owned.acquisition_cost || 0).toFixed(2)} cost` : '';
    lines.push(
      `| ${r.card_name} (${r.card_number}) | ${r.rarity || '—'} | $${r.then.toFixed(2)} | $${r.now.toFixed(2)} | ${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(0)}% | ${qty > 0 ? `**${qty} copies${cost}**` : '—'} |`
    );
  }
  return lines.join('\n');
}

// ── Claude API call ───────────────────────────────────────────────────────────
async function generateReport(data) {
  const prompt = `You are a YuGiOh card market analyst for YGOExclusives, a resale business in Guelph, Ontario run by Ryan. He holds ~32,500 cards and sells primarily on eBay and Facebook. Shipping via Chit Chats: $5.50–6.50 CAD tracked to the US. Segments:
- High-End: TCG Low ≥$50
- Bread & Butter: $5–49
- Bulk: <$5

Today: ${data.today}

## 1-WEEK MOVERS (${data.week1Prior} → ${data.today})
Gainers:
${data.week1Gainers}

Losers:
${data.week1Losers}

## 1-MONTH MOVERS (${data.month1Prior} → ${data.today})
Gainers:
${data.month1Gainers}

Losers:
${data.month1Losers}

## 1-YEAR MOVERS (${data.year1Prior} → ${data.today})
Long-term Gainers:
${data.year1Gainers}

Long-term Losers:
${data.year1Losers}

Cards Ryan owns are marked in bold in the "You Own" column (with qty and acquisition cost).

Write a weekly market report in clean markdown. Include these sections:

### Executive Summary
2–3 sentences. The biggest story this week.

### 🔥 Sell Now
Cards Ryan owns that are peaking, declining, or have strong recent gains he should capitalize on. Give price targets and reasoning.

### 📈 Hold Tight
Cards Ryan owns that are actively rising — advise not to undercut himself.

### 💰 Buy Opportunities
Cards not in Ryan's inventory that have spiked — he may find these underpriced at local shops or on Facebook. Focus on cards with sustainable demand, not one-day spikes.

### 📉 Watch & Protect
Cards Ryan owns that are in structural decline (especially year-over-year). Advise whether to sell now, hold, or bulk out.

### ✅ This Week's Action Items
Bulleted list, max 5 items. Specific and actionable.

Be specific about card names and dollar amounts. Think like someone who understands the YGO secondary market and Ryan's business model.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API failed: ${res.status} ${await res.text()}`);
  const out = await res.json();
  return out.content[0].text;
}

// ── Save report to Supabase ───────────────────────────────────────────────────
async function saveReport(date, markdown) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/weekly_reports`,
    {
      method:  'POST',
      headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
      body:    JSON.stringify({ report_date: date, report_md: markdown }),
    }
  );
  if (!res.ok) throw new Error(`Save report failed: ${await res.text()}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`\n=== Weekly Analysis: ${today} ===\n`);

  // Find nearest available snapshot for each lookback period
  const [week1Prior, month1Prior, year1Prior] = await Promise.all([
    findNearestSnapshot(daysAgo(7)),
    findNearestSnapshot(daysAgo(30)),
    findNearestSnapshot(daysAgo(365)),
  ]);
  console.log(`Snapshot dates — 1W: ${week1Prior}, 1M: ${month1Prior}, 1Y: ${year1Prior}`);

  // Fetch all data in parallel
  const [latestSnap, week1Snap, month1Snap, year1Snap, inventory] = await Promise.all([
    fetchSnapshot(today),
    week1Prior  ? fetchSnapshot(week1Prior)  : Promise.resolve([]),
    month1Prior ? fetchSnapshot(month1Prior) : Promise.resolve([]),
    year1Prior  ? fetchSnapshot(year1Prior)  : Promise.resolve([]),
    fetchInventory(),
  ]);

  console.log(`Snapshots — latest: ${latestSnap.length}, 1W: ${week1Snap.length}, 1M: ${month1Snap.length}, 1Y: ${year1Snap.length}`);
  console.log(`Inventory: ${inventory.length} cards with qty > 0`);

  if (!latestSnap.length) {
    throw new Error('No price snapshot found for today — did price-update.js run first?');
  }

  // Build owned lookup map
  const ownedMap = new Map();
  for (const c of inventory) {
    ownedMap.set(`${c.card_number}|${c.rarity || ''}`, c);
  }

  // Calculate deltas for each period
  const week1Deltas  = week1Snap.length  ? calcDeltas(latestSnap, week1Snap)  : [];
  const month1Deltas = month1Snap.length ? calcDeltas(latestSnap, month1Snap) : [];
  const year1Deltas  = year1Snap.length  ? calcDeltas(latestSnap, year1Snap)  : [];

  const data = {
    today,
    week1Prior:   week1Prior  || 'N/A (insufficient history)',
    month1Prior:  month1Prior || 'N/A (insufficient history)',
    year1Prior:   year1Prior  || 'N/A (insufficient history)',
    week1Gainers:  formatTable(week1Deltas.filter(r => r.pct > 0),           ownedMap),
    week1Losers:   formatTable([...week1Deltas.filter(r => r.pct < 0)].reverse(), ownedMap),
    month1Gainers: formatTable(month1Deltas.filter(r => r.pct > 0),          ownedMap),
    month1Losers:  formatTable([...month1Deltas.filter(r => r.pct < 0)].reverse(), ownedMap),
    year1Gainers:  formatTable(year1Deltas.filter(r => r.pct > 0),           ownedMap),
    year1Losers:   formatTable([...year1Deltas.filter(r => r.pct < 0)].reverse(), ownedMap),
  };

  console.log('\nCalling Claude API for market analysis...');
  const reportMd = await generateReport(data);
  console.log('Report generated successfully');

  // Prepend header with metadata
  const fullReport = `# YGOExclusives Weekly Market Report\n**Date:** ${today}\n\n---\n\n${reportMd}`;

  await saveReport(today, fullReport);
  console.log('Report saved to weekly_reports table');
  console.log('\n=== Weekly Analysis Complete ===\n');
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
