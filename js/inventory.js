// ─── inventory.js — Excel-style grid ──────────────────────────────────────────

let invInitialized = false;
const saveTimers = {};
const _editionShownSets = new Set();

function initInventory() {
  if (invInitialized) return;
  invInitialized = true;

  const searchInput = document.getElementById('inv-search-input');
  const cardCount   = document.getElementById('inv-card-count');

  searchInput.focus();

  // Populate bulk rarity dropdown from RARITIES constant
  const bulkRarSel = document.getElementById('inv-bulk-rarity');
  if (bulkRarSel && bulkRarSel.options.length <= 1) {
    RARITIES.forEach(r => {
      const o = document.createElement('option');
      o.value = r; o.textContent = r;
      bulkRarSel.appendChild(o);
    });
  }

  // Select-all checkbox
  const selectAll = document.getElementById('inv-select-all');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      document.querySelectorAll('.inv-row-check').forEach(cb => {
        cb.checked = selectAll.checked;
        cb.closest('tr').classList.toggle('inv-row-selected', selectAll.checked);
      });
      updateBulkBar();
    });
  }

  // Bulk apply button
  const bulkApply = document.getElementById('inv-bulk-apply');
  if (bulkApply) bulkApply.addEventListener('click', bulkApplyRarity);

  // Bulk clear button
  const bulkClear = document.getElementById('inv-bulk-clear');
  if (bulkClear) {
    bulkClear.addEventListener('click', () => {
      document.querySelectorAll('.inv-row-check').forEach(cb => {
        cb.checked = false;
        cb.closest('tr').classList.remove('inv-row-selected');
      });
      if (selectAll) selectAll.checked = false;
      updateBulkBar();
    });
  }

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

function updateBulkBar() {
  const checked = document.querySelectorAll('.inv-row-check:checked');
  const bar     = document.getElementById('inv-bulk-bar');
  const countEl = document.getElementById('inv-bulk-count');
  if (!bar) return;
  if (checked.length > 0) {
    bar.style.display = '';
    countEl.textContent = `${checked.length} card${checked.length !== 1 ? 's' : ''} selected`;
  } else {
    bar.style.display = 'none';
  }
}

async function bulkApplyRarity() {
  const checked  = [...document.querySelectorAll('.inv-row-check:checked')];
  const newRarity = document.getElementById('inv-bulk-rarity').value;
  if (!newRarity) { showToast('Pick a rarity first'); return; }
  if (!checked.length) return;

  const applyBtn = document.getElementById('inv-bulk-apply');
  applyBtn.disabled = true;
  applyBtn.textContent = 'Saving…';

  let ok = 0, fail = 0;
  for (const cb of checked) {
    const cardId = cb.dataset.card;
    const tr     = cb.closest('tr');
    try {
      await updateCard({ id: cardId, rarity: newRarity, updated_at: new Date().toISOString() });
      // Update the inline dropdown to reflect the new value
      const rarSel = tr.querySelector('select[data-field="rarity"]');
      if (rarSel) rarSel.value = newRarity;
      setRowStatus(cardId, 'saved');
      setTimeout(() => setRowStatus(cardId, ''), 1800);
      ok++;
    } catch (e) {
      fail++;
    }
  }

  applyBtn.disabled = false;
  applyBtn.textContent = 'Apply';
  showToast(fail === 0
    ? `Updated rarity on ${ok} card${ok !== 1 ? 's' : ''}`
    : `${ok} updated, ${fail} failed`);
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

    // Staff reminder: show once per session when set has both editions
    if (cards.length) {
      const { has_unlimited, has_first_ed } = cards[0];
      if (has_unlimited && has_first_ed && !_editionShownSets.has(setCode)) {
        _editionShownSets.add(setCode);
        showToast('Check the bottom-left corner for a 1st Edition stamp. No stamp = Unlimited.');
      }
    }
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
  tr.dataset.hasUnlimited = card.has_unlimited === false ? 'false' : 'true';

  const feNm      = card.fe_nm         || 0;
  const feLp      = card.fe_lp         || 0;
  const feMp      = card.fe_mp         || 0;
  const unNm      = card.un_nm         || 0;
  const unLp      = card.un_lp         || 0;
  const unMp      = card.un_mp         || 0;
  const binderFe  = card.binder_fe_nm  || 0;
  const binderUn  = card.binder_un_nm  || 0;
  const altFeNm   = card.alt_fe_nm     || 0;
  const altUnNm   = card.alt_un_nm     || 0;
  const hasAlt    = card.has_alt_art   || false;

  tr.innerHTML = `
    <td class="inv-td-check">
      <input type="checkbox" class="inv-row-check" data-card="${card.id}" title="Select for bulk edit">
    </td>
    <td class="inv-td-img">
      ${card.api_id
        ? `<img class="inv-thumb" src="${CARD_IMG(card.api_id)}" alt="" loading="lazy" onerror="this.style.opacity=0">`
        : '<div class="inv-thumb-ph"></div>'}
    </td>
    <td class="inv-td-num">${escHtml(card.card_number)}</td>
    <td class="inv-td-name">${escHtml(card.card_name)}</td>
    <td class="inv-td-rarity">
      <span class="badge ${getRarityBadgeClass(card.rarity)}" style="font-size:0.7rem;white-space:nowrap">${escHtml(card.rarity || '')}</span>
    </td>
    ${buildQtyCell('fe_nm',        feNm,     card.id, 0, true)}
    ${buildQtyCell('fe_lp',        feLp,     card.id, 1, false)}
    ${buildQtyCell('fe_mp',        feMp,     card.id, 2, false)}
    <td class="inv-td-total" id="fe-total-${card.id}">${feNm + feLp + feMp}</td>
    ${buildQtyCell('un_nm',        unNm,     card.id, 3, true,  !card.has_unlimited)}
    ${buildQtyCell('un_lp',        unLp,     card.id, 4, false, !card.has_unlimited)}
    ${buildQtyCell('un_mp',        unMp,     card.id, 5, false, !card.has_unlimited)}
    <td class="inv-td-total" id="un-total-${card.id}">${unNm + unLp + unMp}</td>
    ${buildQtyCell('binder_fe_nm', binderFe, card.id, 6, true)}
    ${buildQtyCell('binder_un_nm', binderUn, card.id, 7, false, !card.has_unlimited)}
    <td class="inv-td-alt">
      <input type="checkbox" class="inv-alt-check" data-card="${card.id}" ${hasAlt ? 'checked' : ''} title="Has alternate art">
    </td>
    ${buildAltCell('alt_fe_nm', altFeNm, card.id, 8, hasAlt)}
    ${buildAltCell('alt_un_nm', altUnNm, card.id, 9, hasAlt, !card.has_unlimited)}
    <td class="inv-td-total-end" id="all-total-${card.id}">${feNm + feLp + feMp + unNm + unLp + unMp + binderFe + binderUn + altFeNm + altUnNm}</td>
    <td class="inv-td-review">
      <input type="checkbox" class="inv-review-check" data-card="${card.id}" ${card.needs_review ? 'checked' : ''} title="Flag for review">
    </td>
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

function buildAltCell(field, val, cardId, colIdx, hasAlt, disabled = false) {
  const off = !hasAlt || disabled;
  return `
    <td class="inv-qty-cell inv-qty-group-start inv-td-alt-qty${off ? ' inv-alt-hidden' : ''}" id="alt-cells-${field === 'alt_fe_nm' ? 'fe' : 'un'}-${cardId}">
      <input class="inv-qty-input" type="text" inputmode="numeric" pattern="[0-9]*"
             value="${val}" data-field="${field}" data-card="${cardId}" data-col-idx="${colIdx}" ${off ? 'disabled' : ''}>
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

  // Dropdowns (none remain in new schema but keep for safety)
  tr.querySelectorAll('select[data-card]').forEach(sel => {
    sel.addEventListener('change', () => scheduleSave(cardId, tr));
  });

  // Row selection checkbox (for bulk rarity edit)
  const rowCheck = tr.querySelector('.inv-row-check');
  if (rowCheck) {
    rowCheck.addEventListener('change', () => {
      tr.classList.toggle('inv-row-selected', rowCheck.checked);
      updateBulkBar();
    });
  }

  // Alt Art checkbox — toggle alt qty fields visibility
  const altCheck = tr.querySelector('.inv-alt-check');
  if (altCheck) {
    altCheck.addEventListener('change', async () => {
      const on = altCheck.checked;
      const feTd = document.getElementById(`alt-cells-fe-${cardId}`);
      const unTd = document.getElementById(`alt-cells-un-${cardId}`);
      if (feTd) {
        feTd.classList.toggle('inv-alt-hidden', !on);
        feTd.classList.remove('inv-qty-disabled');
        feTd.querySelector('.inv-qty-input').disabled = !on;
      }
      if (unTd) {
        const unlimDisabled = tr.dataset.hasUnlimited === 'false';
        unTd.classList.toggle('inv-alt-hidden', !on);
        if (!unlimDisabled) unTd.classList.remove('inv-qty-disabled');
        unTd.querySelector('.inv-qty-input').disabled = !on || unlimDisabled;
      }
      try { await updateCard({ id: cardId, has_alt_art: on }); } catch (_) {}
    });
  }

  // Needs Review checkbox
  const reviewCheck = tr.querySelector('.inv-review-check');
  if (reviewCheck) {
    reviewCheck.addEventListener('change', async () => {
      try {
        await updateCard({ id: cardId, needs_review: reviewCheck.checked });
      } catch (e) {
        showToast('Failed to save flag: ' + e.message);
        reviewCheck.checked = !reviewCheck.checked; // revert
      }
    });
  }
}


function updateRowTotals(tr, cardId) {
  const v = f => parseInt(tr.querySelector(`.inv-qty-input[data-field="${f}"]`)?.value, 10) || 0;
  const feEl  = document.getElementById(`fe-total-${cardId}`);
  const unEl  = document.getElementById(`un-total-${cardId}`);
  const allEl = document.getElementById(`all-total-${cardId}`);
  const feSum     = v('fe_nm') + v('fe_lp') + v('fe_mp');
  const unSum     = v('un_nm') + v('un_lp') + v('un_mp');
  const binderSum = v('binder_fe_nm') + v('binder_un_nm');
  const altSum    = v('alt_fe_nm') + v('alt_un_nm');
  if (feEl)  feEl.textContent  = feSum;
  if (unEl)  unEl.textContent  = unSum;
  if (allEl) allEl.textContent = feSum + unSum + binderSum + altSum;
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

  const firstEdOnly = tr.dataset.hasUnlimited === 'false';
  const patch = {
    id:            cardId,
    fe_nm:         getVal('fe_nm'),
    fe_lp:         getVal('fe_lp'),
    fe_mp:         getVal('fe_mp'),
    un_nm:         firstEdOnly ? 0 : getVal('un_nm'),
    un_lp:         firstEdOnly ? 0 : getVal('un_lp'),
    un_mp:         firstEdOnly ? 0 : getVal('un_mp'),
    binder_fe_nm:  getVal('binder_fe_nm'),
    binder_un_nm:  firstEdOnly ? 0 : getVal('binder_un_nm'),
    alt_fe_nm:     tr.querySelector('.inv-alt-check')?.checked ? getVal('alt_fe_nm') : 0,
    alt_un_nm:     tr.querySelector('.inv-alt-check')?.checked && !firstEdOnly ? getVal('alt_un_nm') : 0,
    needs_review:  !!(tr.querySelector('.inv-review-check')?.checked),
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
