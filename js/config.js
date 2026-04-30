// ─── Supabase Config ─────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://xyhzwmlqmazloyerelas.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5aHp3bWxxbWF6bG95ZXJlbGFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MTE3NTEsImV4cCI6MjA5MzA4Nzc1MX0.dNaWuZUwX8eFqpFk0mp_cvGpYzOycuBGn7wUii8U0-E';

const DB_HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Prefer':        'resolution=merge-duplicates,return=minimal',
};

const DB_HEADERS_RETURN = {
  'Content-Type':  'application/json',
  'apikey':        SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Prefer':        'return=representation',
};

// ─── YGOPRODeck API ───────────────────────────────────────────────────────────
const YGOPRO_API = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const CARD_IMG   = id => `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`;

// ─── App Constants ────────────────────────────────────────────────────────────
const DEFAULT_PIN = '1234';

const LOCATIONS = ['Basement Box', 'Binder', 'Deck'];

const RARITIES = [
  'Common', 'Rare', 'Short Print', 'Super Rare', 'Ultra Rare', 'Secret Rare',
  'Ultimate Rare', 'Ghost Rare', 'Mosaic Rare', 'Starfoil Rare', 'Shatterfoil Rare',
  'Alternate Rare', 'Gold Rare', 'Gold Secret Rare', 'Ghost/Gold Rare',
  'Prismatic Secret Rare', 'Starlight Rare', "Collector's Rare",
  '10000 Secret Rare', 'Duel Terminal Normal Parallel Rare',
  'Duel Terminal Ultra Parallel Rare',
  'Platinum Rare', 'Platinum Secret Rare', 'Premium Gold Rare',
  "Pharaoh's Rare", "Prismatic Collector's Rare", 'Prismatic Ultimate Rare',
  'Quarter Century Secret Rare',
];

const HR_OPTIONS = ['None', ...RARITIES];

const PLATFORMS = ['eBay', 'Facebook', 'Cash'];

// ─── Price auto-fill multipliers ──────────────────────────────────────────────
const PRICE_MULT = {
  first_ed_nm:  1.20,
  first_ed_lp:  0.90,
  first_ed_mp:  0.60,
  unlimited_nm: 1.00,
  unlimited_lp: 0.75,
  unlimited_mp: 0.50,
};

// ─── eBay fee default ─────────────────────────────────────────────────────────
const EBAY_FEE_PCT = 0.1325;
