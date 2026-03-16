// ─── listing.js — Phase 7: Listing Generators ────────────────────────────────
// TODO: Phase 7

function generateEbayTitle(card) {
  const cond = 'NM';
  const title = `${card.card_name} - ${card.rarity} - ${card.card_number} - ${card.set_name} - ${cond} YuGiOh`;
  return title.slice(0, 80);
}

function generateEbayDescription(card) {
  return `
YuGiOh! Card Details:
• Card Name: ${card.card_name}
• Card Number: ${card.card_number}
• Set: ${card.set_name}
• Rarity: ${card.rarity}
• Condition: Near Mint (NM)
• 1st Edition: ${(card.fe_nm + card.fe_lp + card.fe_mp) > 0 ? 'Yes' : 'No'}

Card ships securely in a toploader + bubble mailer with tracking.
Combined shipping available — contact us!

Thank you for shopping at Shadowrealm Emporium!
  `.trim();
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
