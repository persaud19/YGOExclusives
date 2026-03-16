// ─── inventory.js — Excel-style grid ──────────────────────────────────────────

let invInitialized = false;
const saveTimers = {};

function initInventory() {
  if (invInitialized) return;
  invInitialized = true;

  const searchInput = document.getElementById('inv-search-input');
  const cardCount   = document.getElementById('inv-card-count');

  searchInput.focus();

  let searchDebounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      const val = searchInput.value.trim().toUpperCase();
      if (val.length >= 2) {
        loadInventoryCards(val, cardCount);
      } else {
        document.getElementById('inv-tbody').innerHTML = '';
        document.getElementById('inv-table').style.display = 'none';
        document.getElementById('inv-empty').style.display = 'none';
        cardCount.textContent = '';
      }
    }, 300);
  });
}

async function loadInventoryCards(setCode, countEl) {
  const tbody = document.getElementById('inv-tbody');
  const table = document.getElementById('inv-table');
  const empty = document.getElementById('inv-empty');

  tbody.innerHTML = '';
  table.style.display = 'none';
  empty.style.display = 'none';
  countEl.textContent = '';

  try {
    const cards = await getCardsBySet(setCode);
    countEl.textContent = cards.length
      ? `${cards.length} card${cards.length !== 1 ? 's' : ''} found`
      : '';

    if (!cards.length) {
      empty.textContent = `No cards found for set code "${setCode}"`;
      empty.className = 'muted text-center';
      empty.style.display = '';
      return;
    }

    // Sort by numeric part of card number
    cards.sort((a, b) => {
      const numA = parseInt((a.card_number.match(/[-‐](\d+)/) || [, '0'])[1], 10);
      const numB = parseInt((b.card_number.match(/[-‐](\d+)/) || [, '0'])[1], 10);
      return numA - numB;
    });

    const fragment = document.createDocumentFragment();
    cards.forEach(card => fragment.appendChild(buildCardRow(card)));
    tbody.appendChild(fragment);
    table.style.display = '';
  } catch (e) {
    empty.textContent = 'Error: ' + e.message;
    empty.className = 'red text-center';
    empty.style.display = '';
  }
}

function buildCardRow(card) {
  const tr = document.createElement('tr');
  tr.className = 'inv-row';
  tr.dataset.cardId = card.id;

  const rarityBadge = getRarityBadgeClass(card.rarity);
  const hasHR = !!(card.higher_rarity && card.higher_rarity !== 'None' && card.higher_rarity !== '');

  const feNm = card.fe_nm     || 0;
  const feLp = card.fe_lp     || 0;
  const feMp = card.fe_mp     || 0;
  const unNm = card.un_nm     || 0;
  const unLp = card.un_lp     || 0;
  const unMp = card.un_mp     || 0;
  const hrNm = card.hr_qty_nm || 0;
  const hrLp = card.hr_qty_lp || 0;

  tr.innerHTML = `
    <td class="inv-td-img">
      ${card.api_id
        ? `<img class="inv-thumb" src="${CARD_IMG(card.api_id)}" alt="" loading="lazy" onerror="this.style.opacity=0">`
        : '<div class="inv-thumb-ph"></div>'}
    </td>
    <td class="inv-td-num">${escHtml(card.card_number)}</td>
    <td class="inv-td-name">${escHtml(card.card_name)}</td>
    <td class="inv-td-rarity"><span class="badge ${rarityBadge}">${escHtml(card.rarity || '')}</span></td>
    ${buildQtyCell('fe_nm',     feNm, card.id, 0, true)}
    ${buildQtyCell('fe_lp',     feLp, card.id, 1, false)}
    ${buildQtyCell('fe_mp',     feMp, card.id, 2, false)}
    <td class="inv-td-total" id="fe-total-${card.id}">${feNm + feLp + feMp}</td>
    ${buildQtyCell('un_nm',     unNm, card.id, 3, true)}
    ${buildQtyCell('un_lp',     unLp, card.id, 4, false)}
    ${buildQtyCell('un_mp',     unMp, card.id, 5, false)}
    <td class="inv-td-total" id="un-total-${card.id}">${unNm + unLp + unMp}</td>
    <td class="inv-td-select">
      <select class="inv-select" data-field="location" data-card="${card.id}">
        ${LOCATIONS.map(l => `<option value="${l}" ${card.location === l ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </td>
    <td class="inv-td-select">
      <select class="inv-select" data-field="higher_rarity" data-card="${card.id}">
        ${HR_OPTIONS.map(r => `<option value="${r === 'None' ? '' : r}" ${(card.higher_rarity || '') === (r === 'None' ? '' : r) ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
    </td>
    ${buildQtyCell('hr_qty_nm', hrNm, card.id, 6, true,  !hasHR)}
    ${buildQtyCell('hr_qty_lp', hrLp, card.id, 7, false, !hasHR)}
    <td class="inv-td-status" id="inv-status-${card.id}"></td>
  `;

  requestAnimationFrame(() => wireRowEvents(tr, card.id));
  return tr;
}

function buildQtyCell(field, val, cardId, colIdx, groupStart, disabled = false) {
  const dis = disabled ? 'disabled' : '';
  return `
    <td class="inv-qty-cell${groupStart ? ' inv-qty-group-start' : ''}${disabled ? ' inv-qty-disabled' : ''}">
      <input class="inv-qty-input" type="text" inputmode="numeric" pattern="[0-9]*"
             value="${val}" data-field="${field}" data-card="${cardId}" data-col-idx="${colIdx}" ${dis}>
    </td>`;
}

function wireRowEvents(tr, cardId) {
  // Direct qty input + keyboard navigation
  tr.querySelectorAll('.inv-qty-input').forEach(input => {
    // Select all on focus (Excel behaviour)
    input.addEventListener('focus', () => input.select());

    input.addEventListener('input', () => {
      updateRowTotals(tr, cardId);
      scheduleSave(cardId, tr);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Move to same column in next row
        const colIdx = input.dataset.colIdx;
        const nextRow = tr.nextElementSibling;
        if (nextRow) {
          const next = nextRow.querySelector(`.inv-qty-input[data-col-idx="${colIdx}"]:not([disabled])`);
          if (next) next.focus();
        }
      }
    });
  });

  // Location / HR type dropdowns
  tr.querySelectorAll('select[data-card]').forEach(sel => {
    sel.addEventListener('change', () => {
      if (sel.dataset.field === 'higher_rarity') {
        toggleHrCells(tr, !!sel.value);
      }
      scheduleSave(cardId, tr);
    });
  });
}

function toggleHrCells(tr, enabled) {
  ['hr_qty_nm', 'hr_qty_lp'].forEach(field => {
    const cell  = tr.querySelector(`.inv-qty-input[data-field="${field}"]`)?.closest('td');
    const input = tr.querySelector(`.inv-qty-input[data-field="${field}"]`);
    if (cell)  cell.classList.toggle('inv-qty-disabled', !enabled);
    if (input) input.disabled = !enabled;
  });
}

function updateRowTotals(tr, cardId) {
  const v = f => parseInt(tr.querySelector(`.inv-qty-input[data-field="${f}"]`)?.value, 10) || 0;
  const feEl = document.getElementById(`fe-total-${cardId}`);
  const unEl = document.getElementById(`un-total-${cardId}`);
  if (feEl) feEl.textContent = v('fe_nm') + v('fe_lp') + v('fe_mp');
  if (unEl) unEl.textContent = v('un_nm') + v('un_lp') + v('un_mp');
}

function scheduleSave(cardId, tr) {
  clearTimeout(saveTimers[cardId]);
  setRowStatus(cardId, 'saving');
  saveTimers[cardId] = setTimeout(() => doSave(cardId, tr), 800);
}

async function doSave(cardId, tr) {
  const getVal = f => {
    const inp = tr.querySelector(`.inv-qty-input[data-field="${f}"]`);
    return inp ? (parseInt(inp.value, 10) || 0) : 0;
  };
  const getSel = f => {
    const sel = tr.querySelector(`select[data-field="${f}"]`);
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
    setRowStatus(cardId, 'saved');
    setTimeout(() => setRowStatus(cardId, ''), 1800);
  } catch (e) {
    setRowStatus(cardId, '');
    showToast('Save failed: ' + e.message);
  }
}

function setRowStatus(cardId, status) {
  const el = document.getElementById(`inv-status-${cardId}`);
  if (!el) return;
  if (status === 'saving') el.innerHTML = '<span class="inv-status-dot saving">●</span>';
  else if (status === 'saved') el.innerHTML = '<span class="inv-status-dot saved">✓</span>';
  else el.innerHTML = '';
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
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
