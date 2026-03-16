// ─── inventory.js — Inventory Mode Logic ─────────────────────────────────────

let invInitialized = false;
const saveTimers = {}; // cardId → timeout handle

function initInventory() {
  if (invInitialized) return;
  invInitialized = true;

  const searchInput = document.getElementById('inv-search-input');
  const cardsContainer = document.getElementById('inv-cards');
  const cardCount = document.getElementById('inv-card-count');

  searchInput.focus();

  let searchDebounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      const val = searchInput.value.trim().toUpperCase();
      if (val.length >= 2) {
        loadInventoryCards(val, cardsContainer, cardCount);
      } else {
        cardsContainer.innerHTML = '';
        cardCount.textContent = '';
      }
    }, 300);
  });
}

async function loadInventoryCards(setCode, container, countEl) {
  container.innerHTML = '<p class="muted text-center mt-16">Loading…</p>';
  countEl.textContent = '';
  try {
    const cards = await getCardsBySet(setCode);
    countEl.textContent = cards.length ? `${cards.length} card${cards.length !== 1 ? 's' : ''} found` : '';
    if (!cards.length) {
      container.innerHTML = `<p class="muted text-center mt-16">No cards found for set code <strong>${setCode}</strong></p>`;
      return;
    }
    // Sort by numeric part of card number (e.g. LOB-004 → 4)
    cards.sort((a, b) => {
      const numA = parseInt((a.card_number.match(/[-‐](\d+)/) || [, '0'])[1], 10);
      const numB = parseInt((b.card_number.match(/[-‐](\d+)/) || [, '0'])[1], 10);
      return numA - numB;
    });
    container.innerHTML = '';
    cards.forEach(card => container.appendChild(buildCardRow(card)));
  } catch (e) {
    container.innerHTML = `<p class="red text-center mt-16">Error: ${e.message}</p>`;
  }
}

function buildCardRow(card) {
  const el = document.createElement('div');
  el.className = 'inv-card';
  el.dataset.cardId = card.id;

  const rarityBadge = getRarityBadgeClass(card.rarity);
  const hasHR = card.higher_rarity && card.higher_rarity !== 'None' && card.higher_rarity !== '';

  el.innerHTML = `
    <div class="save-flash" id="flash-${card.id}">✓ Saved</div>
    <div class="inv-card-header">
      ${card.api_id
        ? `<img class="inv-card-img" src="${CARD_IMG(card.api_id)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <div class="inv-card-img-placeholder" ${card.api_id ? 'style="display:none"' : ''}>IMG</div>
      <div class="inv-card-info">
        <div class="inv-card-number">${escHtml(card.card_number)}</div>
        <div class="inv-card-name">${escHtml(card.card_name)}</div>
        ${card.rarity ? `<span class="badge ${rarityBadge}">${escHtml(card.rarity)}</span>` : ''}
      </div>
    </div>

    <!-- 1st Edition -->
    <div class="edition-row">
      <div class="edition-label-row">
        <span class="edition-pill first">1st Edition</span>
        <span class="edition-total" id="fe-total-${card.id}">${(card.fe_nm||0)+(card.fe_lp||0)+(card.fe_mp||0)}</span>
      </div>
      <div class="qty-controls">
        ${buildQtyGroup('fe_nm', 'NM', card.fe_nm || 0, card.id)}
        ${buildQtyGroup('fe_lp', 'LP', card.fe_lp || 0, card.id)}
        ${buildQtyGroup('fe_mp', 'MP', card.fe_mp || 0, card.id)}
      </div>
    </div>

    <!-- Unlimited -->
    <div class="edition-row">
      <div class="edition-label-row">
        <span class="edition-pill unlimited">Unlimited</span>
        <span class="edition-total" id="un-total-${card.id}">${(card.un_nm||0)+(card.un_lp||0)+(card.un_mp||0)}</span>
      </div>
      <div class="qty-controls">
        ${buildQtyGroup('un_nm', 'NM', card.un_nm || 0, card.id)}
        ${buildQtyGroup('un_lp', 'LP', card.un_lp || 0, card.id)}
        ${buildQtyGroup('un_mp', 'MP', card.un_mp || 0, card.id)}
      </div>
    </div>

    <!-- Footer -->
    <div class="inv-card-footer">
      <div class="inv-footer-row">
        <select class="input" id="loc-${card.id}" data-field="location" data-card="${card.id}">
          ${LOCATIONS.map(l => `<option value="${l}" ${card.location === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select class="input" id="hr-${card.id}" data-field="higher_rarity" data-card="${card.id}">
          ${HR_OPTIONS.map(r => `<option value="${r === 'None' ? '' : r}" ${(card.higher_rarity || '') === (r === 'None' ? '' : r) ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>
      <!-- HR quantity row (shown when HR selected) -->
      <div class="hr-qty-row" id="hr-qty-${card.id}" ${hasHR ? '' : 'style="display:none"'}>
        <div class="hr-qty-group">
          <div class="qty-label">HR NM</div>
          ${buildQtyRow('hr_qty_nm', card.hr_qty_nm || 0, card.id)}
        </div>
        <div class="hr-qty-group">
          <div class="qty-label">HR LP</div>
          ${buildQtyRow('hr_qty_lp', card.hr_qty_lp || 0, card.id)}
        </div>
      </div>
    </div>
  `;

  // Wire events after insertion
  requestAnimationFrame(() => wireCardEvents(el, card));
  return el;
}

function buildQtyGroup(field, label, val, cardId) {
  return `
    <div class="qty-group">
      <div class="qty-label">${label}</div>
      ${buildQtyRow(field, val, cardId)}
    </div>`;
}

function buildQtyRow(field, val, cardId) {
  return `
    <div class="qty-row">
      <button class="qty-btn" data-action="minus" data-field="${field}" data-card="${cardId}">−</button>
      <input class="qty-input" type="text" inputmode="numeric" pattern="[0-9]*"
             id="${field}-${cardId}" data-field="${field}" data-card="${cardId}" value="${val}">
      <button class="qty-btn" data-action="plus" data-field="${field}" data-card="${cardId}">+</button>
    </div>`;
}

function wireCardEvents(el, card) {
  const cardId = card.id;

  // +/- buttons
  el.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { action, field } = btn.dataset;
      const input = el.querySelector(`[data-field="${field}"][data-card="${cardId}"].qty-input`);
      if (!input) return;
      let v = parseInt(input.value, 10) || 0;
      v = action === 'plus' ? v + 1 : Math.max(0, v - 1);
      input.value = v;
      updateEditionTotals(el, cardId);
      scheduleSave(cardId, el);
    });
  });

  // Direct qty input
  el.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('input', () => {
      updateEditionTotals(el, cardId);
      scheduleSave(cardId, el);
    });
  });

  // Location / HR selects
  el.querySelectorAll('select[data-card]').forEach(sel => {
    sel.addEventListener('change', () => {
      if (sel.dataset.field === 'higher_rarity') {
        const hrRow = document.getElementById(`hr-qty-${cardId}`);
        hrRow.style.display = sel.value ? '' : 'none';
      }
      scheduleSave(cardId, el);
    });
  });
}

function updateEditionTotals(el, cardId) {
  const feTotal = ['fe_nm', 'fe_lp', 'fe_mp']
    .reduce((sum, f) => sum + (parseInt(el.querySelector(`[data-field="${f}"].qty-input`)?.value, 10) || 0), 0);
  const unTotal = ['un_nm', 'un_lp', 'un_mp']
    .reduce((sum, f) => sum + (parseInt(el.querySelector(`[data-field="${f}"].qty-input`)?.value, 10) || 0), 0);
  const feEl = document.getElementById(`fe-total-${cardId}`);
  const unEl = document.getElementById(`un-total-${cardId}`);
  if (feEl) feEl.textContent = feTotal;
  if (unEl) unEl.textContent = unTotal;
}

function scheduleSave(cardId, el) {
  clearTimeout(saveTimers[cardId]);
  el.classList.add('saving');
  el.classList.remove('saved');
  saveTimers[cardId] = setTimeout(() => doSave(cardId, el), 800);
}

async function doSave(cardId, el) {
  const getVal = field => {
    const inp = el.querySelector(`[data-field="${field}"].qty-input`);
    return inp ? (parseInt(inp.value, 10) || 0) : 0;
  };
  const getSel = field => {
    const sel = el.querySelector(`select[data-field="${field}"]`);
    return sel ? sel.value : null;
  };

  const patch = {
    id:            cardId,
    fe_nm:         getVal('fe_nm'),
    fe_lp:         getVal('fe_lp'),
    fe_mp:         getVal('fe_mp'),
    un_nm:         getVal('un_nm'),
    un_lp:         getVal('un_lp'),
    un_mp:         getVal('un_mp'),
    hr_qty_nm:     getVal('hr_qty_nm'),
    hr_qty_lp:     getVal('hr_qty_lp'),
    location:      getSel('location'),
    higher_rarity: getSel('higher_rarity'),
    updated_at:    new Date().toISOString(),
  };

  try {
    await updateCard(patch);
    el.classList.remove('saving');
    el.classList.add('saved');
    const flash = document.getElementById(`flash-${cardId}`);
    if (flash) {
      flash.classList.add('show');
      setTimeout(() => { flash.classList.remove('show'); el.classList.remove('saved'); }, 1800);
    }
  } catch (e) {
    el.classList.remove('saving');
    showToast('Save failed: ' + e.message);
  }
}

// ─── Rarity badge helper ──────────────────────────────────────────────────────
function getRarityBadgeClass(rarity) {
  if (!rarity) return 'badge-muted';
  const r = rarity.toLowerCase();
  if (r.includes('starlight') || r.includes('quarter century') || r.includes('10000')) return 'badge-purple';
  if (r.includes('secret') || r.includes('ghost') || r.includes('prismatic')) return 'badge-blue';
  if (r.includes('ultra') || r.includes('ultimate') || r.includes('collector')) return 'badge-gold';
  if (r.includes('super')) return 'badge-blue';
  if (r.includes('rare') || r.includes('gold')) return 'badge-gold';
  return 'badge-muted';
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
