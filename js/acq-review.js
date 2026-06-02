// Acquisition Import Review
// Keyboard: ↑↓ navigate candidates · Enter accept · S skip · N no match
// When no candidates: type to search inventory, Escape to clear search

(function () {
  const H = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  let queue = [];
  let queueIndex = 0;
  let resolvedCount = 0;
  let selectedCandidate = 0;   // index into candidates list OR search results
  let currentFilter = 'needs_review';
  let initialized = false;
  let searchResults = [];       // live search results when no candidates
  let searchTimeout = null;

  const el = id => document.getElementById(id);

  // ── API helpers ───────────────────────────────────────────────────────────
  async function fetchQueue(filter) {
    const params = new URLSearchParams({
      status: `eq.${filter}`,
      order: 'created_at.asc',
      limit: 300,
      select: 'id,source,card_name,rarity,purchased_from,acquisition_date,price_per_card,quantity,total_cost,card_id,card_number,set_name,candidates',
    });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/acquisition_imports?${params}`, { headers: H });
    return r.ok ? r.json() : [];
  }

  async function fetchCounts() {
    const statuses = ['needs_review', 'no_match', 'auto_matched'];
    const counts = {};
    await Promise.all(statuses.map(async s => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/acquisition_imports?status=eq.${s}&select=id`,
        { headers: { ...H, 'Prefer': 'count=exact', 'Range': '0-0' } }
      );
      counts[s] = parseInt((r.headers.get('content-range') || '0/0').split('/')[1] || '0', 10);
    }));
    return counts;
  }

  async function searchInventory(query) {
    if (!query || query.length < 2) return [];
    const params = new URLSearchParams({
      card_name: `ilike.*${query}*`,
      select: 'card_id,card_number,card_name,rarity,set_name',
      order: 'card_name.asc',
      limit: 8,
    });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/card_inventory?${params}`, { headers: H });
    return r.ok ? r.json() : [];
  }

  async function patchRow(id, updates) {
    await fetch(`${SUPABASE_URL}/rest/v1/acquisition_imports?id=eq.${id}`, {
      method: 'PATCH', headers: H, body: JSON.stringify(updates),
    });
  }

  async function pushToAcquisitions(row) {
    const body = {
      card_id: row.card_id || null,
      card_number: row.card_number || null,
      card_name: row.card_name,
      rarity: row.rarity,
      purchased_from: row.purchased_from || null,
      quantity: row.quantity || 1,
      price_per_card: row.price_per_card || null,
      total_cost: row.total_cost || null,
      acquisition_date: row.acquisition_date || null,
      edition: null,
      condition: 'Near Mint',
    };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/acquisitions`, {
      method: 'POST', headers: H, body: JSON.stringify(body),
    });
    return r.ok;
  }

  // ── Source badge ──────────────────────────────────────────────────────────
  function sourceBadge(source) {
    const map = {
      claim_sales:         { label: 'Claim Sale',  color: 'var(--purple)' },
      facebook_messenger:  { label: 'FB Messenger', color: '#1877f2' },
      facebook_image:      { label: 'FB Image',    color: '#1877f2' },
      dragon_world:        { label: 'Dragon World', color: 'var(--green)' },
    };
    const s = map[source] || { label: source || 'Import', color: 'var(--muted)' };
    return `<span style="font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:12px;background:${s.color};color:#fff;letter-spacing:.04em">${s.label}</span>`;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderCard(item) {
    el('review-loading').style.display = 'none';
    el('review-empty').style.display = 'none';
    el('review-card').style.display = 'block';

    // Price display
    let priceStr = '—';
    const ppc = item.price_per_card ? parseFloat(item.price_per_card) : null;
    const tc  = item.total_cost     ? parseFloat(item.total_cost)     : null;
    const qty = item.quantity || 1;
    if (ppc && tc) {
      const expected = parseFloat((ppc * qty).toFixed(2));
      if (Math.abs(expected - tc) < 0.02) {
        // They agree — show formula
        priceStr = qty > 1 ? `$${ppc.toFixed(2)} × ${qty} = $${tc.toFixed(2)}` : `$${tc.toFixed(2)}`;
      } else {
        // They disagree — show both without implying equality
        priceStr = `$${ppc.toFixed(2)}/card · $${tc.toFixed(2)} total`;
      }
    } else if (ppc) {
      priceStr = qty > 1 ? `$${ppc.toFixed(2)} × ${qty}` : `$${ppc.toFixed(2)}`;
    } else if (tc) {
      priceStr = `$${tc.toFixed(2)} total`;
    }

    el('review-card-name').innerHTML = `${sourceBadge(item.source)} &nbsp;${item.card_name || '—'}`;
    el('review-card-rarity').textContent = item.rarity || '—';
    el('review-card-price').textContent = priceStr;
    el('review-card-meta').textContent = [
      item.purchased_from,
      item.acquisition_date ? item.acquisition_date.slice(0, 10) : null,
    ].filter(Boolean).join(' · ');

    el('review-position').textContent = `${queueIndex + 1} of ${queue.length}`;

    // Candidates
    let candidates = [];
    try { candidates = item.candidates ? JSON.parse(item.candidates) : []; } catch (_) {}
    if (!candidates.length && item.card_number) {
      candidates = [{ card_id: item.card_id, card_number: item.card_number, card_name: item.card_name, rarity: item.rarity, set_name: item.set_name }];
    }

    const container = el('review-candidates');
    container.innerHTML = '';
    searchResults = [];

    if (candidates.length) {
      // ── Has candidates (claim_sales style) ──
      el('review-search-box').style.display = 'none';
      renderCandidateList(candidates, container);
      selectedCandidate = 0;
    } else {
      // ── No candidates: show search box ──
      el('review-search-box').style.display = 'block';
      el('review-search-input').value = '';
      container.innerHTML = `<div style="color:var(--muted);font-size:0.85rem;padding:10px 0">
        Search inventory above to link this to a card — or press <kbd style="background:var(--surf2);padding:1px 6px;border-radius:4px;font-size:0.8rem">Enter</kbd> to save as historical record without a match.
      </div>`;
      selectedCandidate = -1;
    }

    updateProgress();
  }

  function renderCandidateList(list, container) {
    list.forEach((c, i) => {
      const div = document.createElement('div');
      div.className = 'review-candidate';
      div.dataset.index = i;
      div.style.cssText = `
        padding:12px 16px;border-radius:8px;cursor:pointer;margin-bottom:4px;
        border:2px solid ${i === 0 ? 'var(--gold)' : 'var(--b1)'};
        background:${i === 0 ? 'var(--surf2)' : 'var(--surf)'};
        display:flex;justify-content:space-between;align-items:center;
        transition:border-color .15s,background .15s;
      `;
      div.innerHTML = `
        <div>
          <div style="font-weight:600;color:var(--txt)">${c.card_name || '—'}</div>
          <div style="font-size:0.78rem;color:var(--muted);margin-top:2px">${c.card_number || ''} · ${c.set_name || ''}</div>
        </div>
        <div style="font-size:0.82rem;color:var(--gold);font-weight:600;text-align:right">${c.rarity || ''}</div>
      `;
      div.addEventListener('click', () => selectCandidate(i));
      div.addEventListener('dblclick', () => { selectCandidate(i); acceptCurrent(); });
      container.appendChild(div);
    });
  }

  function selectCandidate(i) {
    document.querySelectorAll('.review-candidate').forEach((c, idx) => {
      const active = idx === i;
      c.style.borderColor = active ? 'var(--gold)' : 'var(--b1)';
      c.style.background   = active ? 'var(--surf2)' : 'var(--surf)';
    });
    selectedCandidate = i;
  }

  // ── Live inventory search ─────────────────────────────────────────────────
  function onSearchInput(e) {
    const q = e.target.value.trim();
    clearTimeout(searchTimeout);
    if (!q) {
      el('review-candidates').innerHTML = `<div style="color:var(--muted);font-size:0.85rem;padding:10px 0">
        Type to search inventory, or press Enter to save without a match.
      </div>`;
      searchResults = [];
      selectedCandidate = -1;
      return;
    }
    searchTimeout = setTimeout(async () => {
      searchResults = await searchInventory(q);
      const container = el('review-candidates');
      container.innerHTML = '';
      if (!searchResults.length) {
        container.innerHTML = `<div style="color:var(--muted);font-size:0.85rem;padding:10px 0">No results for "${q}" — Enter to save without inventory match.</div>`;
        selectedCandidate = -1;
      } else {
        renderCandidateList(searchResults, container);
        selectedCandidate = 0;
      }
    }, 220);
  }

  // ── Progress ──────────────────────────────────────────────────────────────
  function updateProgress() {
    const total = queue.length;
    const pct = total > 0 ? Math.round((resolvedCount / total) * 100) : 0;
    el('review-progress-bar').style.width = pct + '%';
    el('review-progress-badge').textContent = `${resolvedCount} resolved · ${total - resolvedCount} remaining`;
  }

  function showEmpty() {
    el('review-card').style.display = 'none';
    el('review-loading').style.display = 'none';
    el('review-empty').style.display = 'block';
  }

  function advance() {
    resolvedCount++;
    queueIndex++;
    if (queueIndex >= queue.length) showEmpty();
    else renderCard(queue[queueIndex]);
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  async function acceptCurrent() {
    const item = queue[queueIndex];
    if (!item) return;

    // Determine which candidate/search result was chosen
    let chosen = null;
    const hasCandidates = (() => {
      try { return (item.candidates ? JSON.parse(item.candidates) : []).length > 0; } catch(_){ return false; }
    })() || !!item.card_number;

    if (hasCandidates && selectedCandidate >= 0) {
      const candidates = (() => {
        try { return item.candidates ? JSON.parse(item.candidates) : []; } catch(_){ return []; }
      })();
      const effective = candidates.length ? candidates
        : [{ card_id: item.card_id, card_number: item.card_number, card_name: item.card_name, rarity: item.rarity, set_name: item.set_name }];
      chosen = effective[selectedCandidate] || null;
    } else if (!hasCandidates && searchResults.length > 0 && selectedCandidate >= 0) {
      chosen = searchResults[selectedCandidate] || null;
    }
    // chosen = null → save as-is (historical record, no inventory link)

    const updated = chosen
      ? { ...item, card_id: chosen.card_id, card_number: chosen.card_number, card_name: chosen.card_name, rarity: chosen.rarity || item.rarity, set_name: chosen.set_name }
      : item;

    const ok = await pushToAcquisitions(updated);
    if (!ok) { showToast('Failed to save — try again', 'error'); return; }

    await patchRow(item.id, {
      status: 'imported',
      card_id: updated.card_id || null,
      card_number: updated.card_number || null,
      set_name: updated.set_name || null,
    });
    advance();
  }

  async function skipCurrent() {
    const item = queue[queueIndex];
    if (!item) return;
    await patchRow(item.id, { status: 'skipped' });
    advance();
  }

  async function noMatchCurrent() {
    const item = queue[queueIndex];
    if (!item) return;
    await patchRow(item.id, { status: 'no_match_confirmed' });
    advance();
  }

  // ── Push all auto-matched ─────────────────────────────────────────────────
  async function pushAutoMatched() {
    const btn = el('review-push-matched-btn');
    btn.disabled = true;
    btn.textContent = 'Pushing...';
    const params = new URLSearchParams({ status: 'eq.auto_matched', limit: 1000, select: '*' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/acquisition_imports?${params}`, { headers: H });
    const rows = await r.json();
    let success = 0, fail = 0;
    for (const row of rows) {
      const ok = await pushToAcquisitions(row);
      if (ok) { await patchRow(row.id, { status: 'imported' }); success++; }
      else fail++;
    }
    btn.textContent = `Done — ${success} pushed${fail ? `, ${fail} failed` : ''}`;
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Push Auto-Matched to Acquisitions'; }, 4000);
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  function onKeyDown(e) {
    if (!document.getElementById('tab-acq-review').classList.contains('active')) return;
    const tag = document.activeElement.tagName;

    // When search box is focused: only handle Escape (clear) and Enter (accept)
    if (document.activeElement === el('review-search-input')) {
      if (e.key === 'Escape') { el('review-search-input').value = ''; onSearchInput({ target: el('review-search-input') }); }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (selectedCandidate > 0) selectCandidate(selectedCandidate - 1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); const max = document.querySelectorAll('.review-candidate').length - 1; if (selectedCandidate < max) selectCandidate(selectedCandidate + 1); }
      if (e.key === 'Enter') { e.preventDefault(); acceptCurrent(); }
      return;
    }

    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const cards = document.querySelectorAll('.review-candidate');
    switch (e.key) {
      case 'ArrowUp':   e.preventDefault(); if (selectedCandidate > 0) selectCandidate(selectedCandidate - 1); break;
      case 'ArrowDown': e.preventDefault(); if (selectedCandidate < cards.length - 1) selectCandidate(selectedCandidate + 1); break;
      case 'Enter':     e.preventDefault(); acceptCurrent(); break;
      case 's': case 'S': skipCurrent(); break;
      case 'n': case 'N': noMatchCurrent(); break;
      case '/':
        // Focus search box if visible
        if (el('review-search-box').style.display !== 'none') {
          e.preventDefault();
          el('review-search-input').focus();
        }
        break;
    }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'info') {
    if (window.showToast) { window.showToast(msg, type); return; }
    console.log(msg);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    if (initialized) return;
    initialized = true;

    const counts = await fetchCounts();
    const filterEl = el('review-filter');
    filterEl.innerHTML = `
      <option value="needs_review">Needs Review (${counts.needs_review || 0})</option>
      <option value="no_match">No Match (${counts.no_match || 0})</option>
      <option value="auto_matched">Auto Matched (${counts.auto_matched || 0})</option>
    `;

    await loadQueue('needs_review');

    filterEl.addEventListener('change', e => loadQueue(e.target.value));
    el('review-skip-btn').addEventListener('click', skipCurrent);
    el('review-nomatch-btn').addEventListener('click', noMatchCurrent);
    el('review-push-matched-btn').addEventListener('click', pushAutoMatched);
    el('review-search-input').addEventListener('input', onSearchInput);
    document.addEventListener('keydown', onKeyDown);
  }

  async function loadQueue(filter) {
    currentFilter = filter;
    queueIndex = 0;
    resolvedCount = 0;
    el('review-card').style.display = 'none';
    el('review-empty').style.display = 'none';
    el('review-loading').style.display = 'block';
    queue = await fetchQueue(filter);
    if (!queue.length) showEmpty();
    else renderCard(queue[0]);
  }

  // ── Tab activation ────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'acq-review') { initialized = false; init(); }
      });
    });
  });
})();
