// ─── listing.js — Listing Generators ─────────────────────────────────────────

function generateEbayTitle(card, opts = {}) {
  const feTotal = (card.fe_nm || 0) + (card.fe_lp || 0) + (card.fe_mp || 0);
  const edition = opts.edition   || (feTotal > 0 ? '1st Edition' : 'Unlimited');
  const cond    = opts.condition || 'NM';
  const parts   = [card.card_name, card.card_number, card.rarity, edition, cond].filter(Boolean);
  return parts.join(' - ').slice(0, 80);
}

function generateEbayDescription(card, opts = {}) {
  const feTotal  = (card.fe_nm || 0) + (card.fe_lp || 0) + (card.fe_mp || 0);
  const edition  = opts.edition   || (feTotal > 0 ? '1st Edition' : 'Unlimited');
  const cond     = opts.condition || 'NM';
  const condFull = { NM: 'Near Mint (NM)', LP: 'Lightly Played (LP)', MP: 'Moderately Played (MP)' }[cond] || cond;

  const lines = [
    'Yu-Gi-Oh! Card Details:',
    `• Card Name: ${card.card_name}`,
    `• Card Number: ${card.card_number}`,
    `• Set: ${card.set_name || '—'}`,
    `• Rarity: ${card.rarity || '—'}`,
    `• Condition: ${condFull}`,
    `• Edition: ${edition}`,
  ];

  if (opts.conditionNotes) {
    lines.push('', 'Condition Notes:', opts.conditionNotes);
  }

  if (opts.loreText) {
    lines.push('', 'Card Effect / Lore:', opts.loreText);
  }

  lines.push(
    '',
    'Card ships securely in a toploader + bubble mailer with tracking.',
    'Combined shipping available — contact us!',
    '',
    'Thank you for shopping at YGOExclusives!'
  );

  return lines.join('\n');
}

function generateFBPost(card) {
  return `
🔥 FOR SALE — YuGiOh! 🔥

📛 ${card.card_name}
📦 Set: ${card.set_name} (${card.card_number})
✨ Rarity: ${card.rarity}
💎 Condition: Near Mint (NM)
💰 Price: $${Number(card.unlimited_nm || 0).toFixed(2)} + shipping

📬 Ships in toploader + bubble mailer w/ tracking
📦 Combined shipping available

Comment or DM to purchase!

#yugioh #yugiohtcg #yugiohtrade #${(card.set_name || '').replace(/\s+/g,'')} #tcg
  `.trim();
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => showToast('Copied to clipboard!'))
    .catch(() => showToast('Copy failed — select and copy manually'));
}
