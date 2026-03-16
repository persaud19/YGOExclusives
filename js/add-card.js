// ─── add-card.js — List Card Tab ─────────────────────────────────────────────

const LC_KEY_STORAGE = 'shadowrealm_anthropic_key';
const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages';

let addCardInitialized = false;
let lcCardData = null;   // identified card info from Claude
let lcDbCard   = null;   // matched card from Supabase
let lcPhotos   = [];     // array of { b64, mimeType, name }

function initAddCard() {
  if (addCardInitialized) return;
  addCardInitialized = true;
  lcInitKeyUI();
}

// ─── API Key ──────────────────────────────────────────────────────────────────
function lcInitKeyUI() {
  const saved = localStorage.getItem(LC_KEY_STORAGE);
  if (saved) {
    document.getElementById('lc-apikey-saved-row').style.display = 'flex';
    document.getElementById('lc-apikey-input-row').style.display = 'none';
  }
}

function lcSaveKey() {
  const val = (document.getElementById('lc-key-input')?.value || '').trim();
  if (!val.startsWith('sk-ant-')) { showToast('Key should start with sk-ant-'); return; }
  localStorage.setItem(LC_KEY_STORAGE, val);
  document.getElementById('lc-apikey-saved-row').style.display = 'flex';
  document.getElementById('lc-apikey-input-row').style.display = 'none';
  showToast('API key saved');
}

function lcChangeKey() {
  document.getElementById('lc-apikey-saved-row').style.display = 'none';
  document.getElementById('lc-apikey-input-row').style.display = 'flex';
  const inp = document.getElementById('lc-key-input');
  if (inp) { inp.value = ''; inp.focus(); }
}

// ─── File Upload ──────────────────────────────────────────────────────────────
function lcOnFile(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  let loaded = 0;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = evt => {
      const dataUrl = evt.target.result;
      lcPhotos.push({
        b64:      dataUrl.split(',')[1],
        mimeType: file.type || 'image/jpeg',
        name:     file.name,
        dataUrl,
      });
      loaded++;
      if (loaded === files.length) lcRenderPreviews();
    };
    reader.readAsDataURL(file);
  });

  // Reset file input so same files can be re-selected
  e.target.value = '';
  lcReset(2);
}

function lcRenderPreviews() {
  const ph        = document.getElementById('lc-drop-ph');
  const previewEl = document.getElementById('lc-previews');
  if (ph)        ph.style.display        = 'none';
  if (previewEl) {
    previewEl.style.display = '';
    previewEl.innerHTML = lcPhotos.map((p, i) => `
      <div class="lc-thumb-wrap">
        <img src="${p.dataUrl}" class="lc-thumb-img" alt="${escHtml(p.name)}">
        <button class="lc-thumb-del" onclick="lcRemovePhoto(${i})" title="Remove">✕</button>
      </div>`).join('');
  }

  const identBtn  = document.getElementById('lc-identify-btn');
  const addMoreBtn = document.getElementById('lc-add-more-btn');
  if (identBtn)   identBtn.style.display   = '';
  if (addMoreBtn) addMoreBtn.style.display = '';
}

function lcRemovePhoto(idx) {
  lcPhotos.splice(idx, 1);
  if (lcPhotos.length === 0) {
    const ph        = document.getElementById('lc-drop-ph');
    const previewEl = document.getElementById('lc-previews');
    if (ph)        ph.style.display        = '';
    if (previewEl) previewEl.style.display = 'none';
    const identBtn   = document.getElementById('lc-identify-btn');
    const addMoreBtn = document.getElementById('lc-add-more-btn');
    if (identBtn)   identBtn.style.display   = 'none';
    if (addMoreBtn) addMoreBtn.style.display = 'none';
  } else {
    lcRenderPreviews();
  }
}

function lcReset(fromStep) {
  if (fromStep <= 1) {
    lcPhotos = [];
    const ph        = document.getElementById('lc-drop-ph');
    const previewEl = document.getElementById('lc-previews');
    if (ph)        ph.style.display        = '';
    if (previewEl) { previewEl.style.display = 'none'; previewEl.innerHTML = ''; }
    const identBtn   = document.getElementById('lc-identify-btn');
    const addMoreBtn = document.getElementById('lc-add-more-btn');
    if (identBtn)   identBtn.style.display   = 'none';
    if (addMoreBtn) addMoreBtn.style.display = 'none';
  }
  if (fromStep <= 2) {
    const s2 = document.getElementById('lc-step2');
    const mc = document.getElementById('lc-match-card');
    if (s2) s2.style.display = 'none';
    if (mc) mc.innerHTML = '';
    lcCardData = null;
    lcDbCard   = null;
  }
  if (fromStep <= 3) {
    const s3 = document.getElementById('lc-step3');
    if (s3) s3.style.display = 'none';
  }
  if (fromStep <= 4) {
    const s4 = document.getElementById('lc-step4');
    if (s4) s4.style.display = 'none';
  }
  const msg = document.getElementById('lc-identify-msg');
  if (msg) { msg.textContent = ''; msg.style.color = ''; }
}

// ─── Claude Vision ────────────────────────────────────────────────────────────
async function lcIdentify() {
  const apiKey = localStorage.getItem(LC_KEY_STORAGE);
  if (!apiKey) { showToast('Enter your Anthropic API key first'); return; }
  if (!lcPhotos.length) { showToast('Upload at least one photo first'); return; }

  const btn = document.getElementById('lc-identify-btn');
  const msg = document.getElementById('lc-identify-msg');
  btn.disabled    = true;
  btn.textContent = 'Identifying…';
  if (msg) {
    msg.textContent = `Sending ${lcPhotos.length} photo${lcPhotos.length > 1 ? 's' : ''} to Claude Vision…`;
    msg.style.color = '';
  }
  lcReset(2);

  try {
    // Build content array: all images first, then the prompt
    const imageBlocks = lcPhotos.map(p => ({
      type: 'image',
      source: { type: 'base64', media_type: p.mimeType, data: p.b64 },
    }));

    const body = {
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: `You are analyzing ${lcPhotos.length > 1 ? 'multiple photos of the same Yu-Gi-Oh! trading card' : 'a Yu-Gi-Oh! trading card image'}. Use all provided images together to identify the card and assess its condition. Respond ONLY with a raw JSON object — no markdown, no code fences, no extra text.

{
  "card_name": "exact name printed on the card",
  "card_number": "set code and number e.g. LOB-EN001",
  "rarity": "rarity as printed e.g. Ultra Rare",
  "edition": "1st Edition or Unlimited",
  "condition": "NM or LP or MP",
  "condition_reason": "one sentence describing visible wear based on all photos",
  "lore_text": "the card effect or flavor text verbatim"
}`,
          },
        ],
      }],
    };

    const res = await fetch(ANTHROPIC_URL, {
      method:  'POST',
      headers: {
        'Content-Type':                             'application/json',
        'x-api-key':                                apiKey,
        'anthropic-version':                        '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    // Parse JSON from Claude's response
    let parsed;
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse Claude response');
      parsed = JSON.parse(match[0]);
    }

    lcCardData = parsed;
    if (msg) msg.textContent = '';

    await lcLookupCard(parsed);

  } catch (e) {
    if (msg) { msg.textContent = 'Error: ' + e.message; msg.style.color = 'var(--red)'; }
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Identify with Claude Vision';
  }
}

// ─── DB Lookup ────────────────────────────────────────────────────────────────
async function lcLookupCard(identified) {
  const msg = document.getElementById('lc-identify-msg');
  if (msg) { msg.textContent = 'Searching your collection…'; msg.style.color = ''; }

  try {
    let card = null;

    // Try card_number exact match first (case-insensitive)
    if (identified.card_number) {
      const res  = await fetch(
        `${SUPABASE_URL}/rest/v1/cards?card_number=ilike.${encodeURIComponent(identified.card_number)}&limit=1&select=*`,
        { headers: DB_HEADERS_RETURN }
      );
      const rows = await res.json();
      card = rows?.[0] || null;
    }

    // Fall back to card name match
    if (!card && identified.card_name) {
      const res  = await fetch(
        `${SUPABASE_URL}/rest/v1/cards?card_name=ilike.${encodeURIComponent(identified.card_name)}&limit=1&select=*`,
        { headers: DB_HEADERS_RETURN }
      );
      const rows = await res.json();
      card = rows?.[0] || null;
    }

    if (!card) {
      if (msg) {
        msg.textContent = `"${identified.card_name || identified.card_number}" not found in your collection.`;
        msg.style.color = 'var(--red)';
      }
      return;
    }

    lcDbCard = card;
    if (msg) msg.textContent = '';
    lcShowMatch(identified, card);

  } catch (e) {
    if (msg) { msg.textContent = 'DB lookup error: ' + e.message; msg.style.color = 'var(--red)'; }
  }
}

// ─── Show Match ───────────────────────────────────────────────────────────────
function lcShowMatch(identified, card) {
  const matchEl = document.getElementById('lc-match-card');
  if (matchEl) {
    matchEl.innerHTML = `
      <div class="lc-match-inner">
        ${card.api_id
          ? `<img src="${CARD_IMG(card.api_id)}" alt="" class="lc-match-thumb" onerror="this.style.display='none'">`
          : ''}
        <div class="lc-match-info">
          <div class="lc-match-name">${escHtml(card.card_name)}</div>
          <div class="lc-match-meta">${escHtml(card.card_number || '')}${card.rarity ? ' · ' + escHtml(card.rarity) : ''}</div>
          ${card.set_name ? `<div class="lc-match-meta">${escHtml(card.set_name)}</div>` : ''}
          <div class="lc-match-ok">✓ Found in your collection</div>
        </div>
      </div>`;
  }
  const s2 = document.getElementById('lc-step2');
  if (s2) s2.style.display = '';

  // Pre-fill condition and edition from Claude
  const condSel = document.getElementById('lc-cond');
  const edSel   = document.getElementById('lc-edition');
  if (condSel && identified.condition && ['NM','LP','MP'].includes(identified.condition)) {
    condSel.value = identified.condition;
  }
  if (edSel && identified.edition) {
    edSel.value = identified.edition.includes('1st') ? '1st Edition' : 'Unlimited';
  }

  // Condition note from Claude
  const condNote = document.getElementById('lc-cond-note');
  if (condNote) {
    condNote.textContent = identified.condition_reason
      ? `Claude: "${identified.condition_reason}"`
      : '';
  }

  // Populate rarity select — pre-select Claude's identified rarity
  const raritySel  = document.getElementById('lc-rarity');
  const rarityNote = document.getElementById('lc-rarity-note');
  if (raritySel) {
    const claudeRarity  = (identified.rarity || '').trim();
    const dbRarity      = (card.rarity       || '').trim();
    // Build options from master RARITIES list
    raritySel.innerHTML = '<option value="">— select rarity —</option>' +
      RARITIES.map(r => `<option value="${r}"${r === claudeRarity ? ' selected' : ''}>${r}</option>`).join('');
    // Show a note if Claude's rarity differs from DB rarity
    if (rarityNote) {
      if (claudeRarity && dbRarity && claudeRarity.toLowerCase() !== dbRarity.toLowerCase()) {
        rarityNote.textContent = `(DB: ${dbRarity} · Claude detected: ${claudeRarity})`;
      } else {
        rarityNote.textContent = claudeRarity ? `Claude detected: ${claudeRarity}` : '';
      }
    }
  }

  // Price reference: TCG Market + eBay Low
  lcUpdatePriceRef(card);

  // Auto-fill price with TCG market
  const priceEl = document.getElementById('lc-price');
  if (priceEl && card.tcg_market_price > 0) {
    priceEl.value = Number(card.tcg_market_price).toFixed(2);
  }

  const s3 = document.getElementById('lc-step3');
  if (s3) s3.style.display = '';
}

// ─── Price ref helper ─────────────────────────────────────────────────────────
function lcUpdatePriceRef(card) {
  const tcg  = card.tcg_market_price > 0 ? `TCG Market: $${Number(card.tcg_market_price).toFixed(2)}` : null;
  const ebay = card.ebay_low_price   > 0 ? `eBay Low: $${Number(card.ebay_low_price).toFixed(2)}`     : null;
  const priceRef = document.getElementById('lc-price-ref');
  if (priceRef) {
    priceRef.textContent = [tcg, ebay].filter(Boolean).join('  ·  ') || 'No price data on file';
    priceRef.style.color = '';
  }
}

// ─── Rarity Change → re-lookup price ──────────────────────────────────────────
async function lcOnRarityChange() {
  if (!lcCardData) return;
  const sel            = document.getElementById('lc-rarity');
  const selectedRarity = sel?.value?.trim();
  if (!selectedRarity) return;

  const priceRef = document.getElementById('lc-price-ref');
  if (priceRef) { priceRef.textContent = 'Looking up price for this rarity…'; priceRef.style.color = ''; }

  try {
    let card = null;

    // 1. Try card_number + rarity
    if (lcCardData.card_number) {
      const res  = await fetch(
        `${SUPABASE_URL}/rest/v1/cards?card_number=ilike.${encodeURIComponent(lcCardData.card_number)}&rarity=ilike.${encodeURIComponent(selectedRarity)}&limit=1&select=*`,
        { headers: DB_HEADERS_RETURN }
      );
      const rows = await res.json();
      card = rows?.[0] || null;
    }

    // 2. Fall back: card_name + rarity
    if (!card && lcCardData.card_name) {
      const res  = await fetch(
        `${SUPABASE_URL}/rest/v1/cards?card_name=ilike.${encodeURIComponent(lcCardData.card_name)}&rarity=ilike.${encodeURIComponent(selectedRarity)}&limit=1&select=*`,
        { headers: DB_HEADERS_RETURN }
      );
      const rows = await res.json();
      card = rows?.[0] || null;
    }

    if (card) {
      lcDbCard = card;
      lcUpdatePriceRef(card);
      // Auto-update asking price
      const priceEl = document.getElementById('lc-price');
      if (priceEl && card.tcg_market_price > 0) {
        priceEl.value = Number(card.tcg_market_price).toFixed(2);
      }
    } else {
      if (priceRef) {
        priceRef.textContent = `No "${selectedRarity}" entry found in collection — price not updated`;
        priceRef.style.color = 'var(--yellow)';
      }
    }
  } catch (e) {
    if (priceRef) { priceRef.textContent = 'Rarity lookup error: ' + e.message; priceRef.style.color = 'var(--red)'; }
  }
}

// ─── Generate Listing ─────────────────────────────────────────────────────────
function lcGenerateListing() {
  if (!lcDbCard || !lcCardData) return;

  const cond    = document.getElementById('lc-cond')?.value    || 'NM';
  const edition = document.getElementById('lc-edition')?.value || 'Unlimited';

  const title = generateEbayTitle(lcDbCard, { condition: cond, edition });
  const desc  = generateEbayDescription(lcDbCard, {
    condition:      cond,
    edition,
    conditionNotes: lcCardData.condition_reason || '',
    loreText:       lcCardData.lore_text        || '',
  });

  const titleEl = document.getElementById('lc-title');
  const descEl  = document.getElementById('lc-desc');
  if (titleEl) titleEl.value = title;
  if (descEl)  descEl.value  = desc;
  lcUpdateTitleChars();

  const s4 = document.getElementById('lc-step4');
  if (s4) {
    s4.style.display = '';
    s4.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function lcUpdateTitleChars() {
  const el  = document.getElementById('lc-title');
  const out = document.getElementById('lc-title-chars');
  if (!el || !out) return;
  const len = el.value.length;
  out.textContent = `${len}/80`;
  out.style.color = len > 75 ? 'var(--yellow)' : '';
}

// ─── List It ──────────────────────────────────────────────────────────────────
async function lcListIt() {
  const title = document.getElementById('lc-title')?.value || '';
  const desc  = document.getElementById('lc-desc')?.value  || '';
  const price = document.getElementById('lc-price')?.value || '';

  // 1. Copy listing to clipboard
  const full = `TITLE:\n${title}\n\nPRICE: $${price}\n\nDESCRIPTION:\n${desc}`;
  try { await navigator.clipboard.writeText(full); } catch { /* silent fail */ }

  // 2. Mark card as listed in DB
  if (lcDbCard?.id) {
    updateCard({ id: lcDbCard.id, listed: true, updated_at: new Date().toISOString() })
      .catch(e => console.warn('Could not mark card as listed:', e));
  }

  // 3. Open eBay sell page
  window.open('https://www.ebay.com/sell/chooselisting', '_blank');

  showToast('Listing copied! Opening eBay…');
}
