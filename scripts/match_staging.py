"""
Fuzzy-match all needs_review rows in acquisition_imports against card_inventory.
Populates the candidates field and auto-matches high-confidence hits.

Usage:
    python scripts/match_staging.py
    python scripts/match_staging.py --dry-run
    python scripts/match_staging.py --source facebook_messenger
"""

import requests, json, re, argparse, sys, io
from difflib import SequenceMatcher
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

with open(r'D:\CoworkOS\YGO Project\backups\config.json', encoding='utf-8-sig') as f:
    cfg = json.load(f)

URL = cfg['supabase_url']
KEY = cfg['service_role_key']
H   = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json', 'Prefer': 'return=minimal'}

RARITY_ALIASES = {
    'qcsr': 'Quarter Century Secret Rare',
    'quarter century rare': 'Quarter Century Secret Rare',
    'quarter century secret': 'Quarter Century Secret Rare',
    'cr': "Collector's Rare",
    'collector rare': "Collector's Rare",
    'collectors rare': "Collector's Rare",
    'scr': 'Secret Rare',
    'utr': 'Ultimate Rare',
    'ur': 'Ultra Rare',
    'sr': 'Super Rare',
    'r': 'Rare',
    'c': 'Common',
    'ghost': 'Ghost Rare',
    'starlight': 'Starlight Rare',
    'prismatic': 'Prismatic Secret Rare',
}

def norm_rarity(r):
    if not r: return ''
    k = r.lower().strip()
    return RARITY_ALIASES.get(k, r).lower()

def norm_name(n):
    """Normalize card name for comparison."""
    if not n: return ''
    n = n.lower().strip()
    # Strip bracketed notes Claude adds e.g. "[DUPO 1st]"
    n = re.sub(r'\[.*?\]', '', n).strip()
    # Collapse whitespace
    n = re.sub(r'\s+', ' ', n)
    return n

def fuzzy_score(a, b):
    return SequenceMatcher(None, a, b).ratio()

def fetch_all(table, select='*', extra_params=None):
    rows, offset, page = [], 0, 1000
    while True:
        params = {'select': select}
        if extra_params:
            params.update(extra_params)
        r = requests.get(f'{URL}/rest/v1/{table}', headers={**H, 'Range-Unit': 'items', 'Range': f'{offset}-{offset+page-1}'}, params=params)
        batch = r.json() if r.ok else []
        if not isinstance(batch, list) or not batch: break
        rows.extend(batch)
        if len(batch) < page: break
        offset += page
    return rows

def patch(table, id_col, id_val, updates):
    r = requests.patch(f'{URL}/rest/v1/{table}?{id_col}=eq.{id_val}', headers=H, json=updates)
    return r.ok

# ── Load data ────────────────────────────────────────────────────────────────
print('Loading card_inventory...')
inventory = fetch_all('card_inventory', 'card_id,card_number,card_name,rarity,set_name')
print(f'  {len(inventory)} cards')

# Build indexes
by_name = {}          # norm_name -> [rows]
by_name_rarity = {}   # (norm_name, norm_rarity) -> [rows]
all_norm_names = []   # [(norm_name, row)] for fuzzy scan

for row in inventory:
    nn = norm_name(row.get('card_name', ''))
    nr = norm_rarity(row.get('rarity', ''))
    by_name.setdefault(nn, []).append(row)
    by_name_rarity.setdefault((nn, nr), []).append(row)
    all_norm_names.append((nn, row))

print(f'  Indexes built: {len(by_name)} unique names')

def find_candidates(card_name, rarity):
    """Return list of (score, row) sorted best first."""
    nn  = norm_name(card_name)
    nr  = norm_rarity(rarity)

    # 1. Exact name + exact rarity
    exact = by_name_rarity.get((nn, nr), [])
    if len(exact) == 1:
        return [(1.0, exact[0])]
    if len(exact) > 1:
        return [(1.0, r) for r in exact]

    # 2. Exact name, any rarity
    name_exact = by_name.get(nn, [])
    if name_exact:
        scored = [(0.95 if norm_rarity(r.get('rarity','')) == nr else 0.85, r) for r in name_exact]
        return sorted(scored, key=lambda x: -x[0])[:8]

    # 3. Fuzzy: scan all cards, score by name similarity
    # Only scan cards where first significant word matches (speed optimisation)
    words = [w for w in nn.split() if len(w) > 3]
    if words:
        first = words[0]
        candidates = [(fuzzy_score(nn, inv_nn), row)
                      for inv_nn, row in all_norm_names
                      if first in inv_nn]
    else:
        # Short name — scan everything
        candidates = [(fuzzy_score(nn, inv_nn), row)
                      for inv_nn, row in all_norm_names]

    # Boost score when rarity also matches
    boosted = []
    for score, row in candidates:
        if score < 0.45: continue
        if nr and norm_rarity(row.get('rarity','')) == nr:
            score = min(1.0, score + 0.08)
        boosted.append((score, row))

    boosted.sort(key=lambda x: -x[0])
    return boosted[:8]

# ── Load staging rows ────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--source', default='', help='Filter by source (e.g. facebook_messenger)')
    args = parser.parse_args()

    print('\nLoading needs_review staging rows...')
    extra = {'status': 'eq.needs_review'}
    if args.source:
        extra['source'] = f'eq.{args.source}'
    staging = fetch_all('acquisition_imports',
        'id,card_name,rarity,acquisition_date,source,card_number',
        extra_params=extra)
    print(f'  {len(staging)} rows to process\n')

    AUTO_THRESHOLD   = 0.92   # single top hit at this score → auto_matched
    REVIEW_THRESHOLD = 0.55   # below this → no_match

    stats = {'auto': 0, 'review': 0, 'no_match': 0, 'already_has_number': 0}

    for i, row in enumerate(staging):
        rid        = row['id']
        card_name  = row.get('card_name') or ''
        rarity     = row.get('rarity') or ''
        card_number = row.get('card_number')

        # Skip if already has a card_number (was matched by claim_sales importer)
        if card_number:
            stats['already_has_number'] += 1
            continue

        # Strip Claude notes from card_name before matching
        clean_name = re.sub(r'\[.*?\]', '', card_name).strip()

        scored = find_candidates(clean_name, rarity)

        if not scored or scored[0][0] < REVIEW_THRESHOLD:
            # No match
            if not args.dry_run:
                patch('acquisition_imports', 'id', rid, {'status': 'no_match'})
            stats['no_match'] += 1
            if i < 20 or i % 100 == 0:
                print(f'  [{i+1}] NO_MATCH  {clean_name[:50]}')
            continue

        top_score, top_row = scored[0]
        candidates_json = json.dumps([{
            'card_id':     r.get('card_id'),
            'card_number': r.get('card_number'),
            'card_name':   r.get('card_name'),
            'rarity':      r.get('rarity'),
            'set_name':    r.get('set_name'),
            '_score':      round(s, 3),
        } for s, r in scored])

        # Single high-confidence hit → auto_matched
        # Also auto-match if there's only ONE candidate and rarity matches at ≥0.82
        only_one = len(scored) == 1
        rarity_match = norm_rarity(top_row.get('rarity','')) == norm_rarity(rarity)
        auto = (top_score >= AUTO_THRESHOLD and len([s for s,_ in scored if s >= AUTO_THRESHOLD]) == 1) \
               or (only_one and top_score >= 0.82) \
               or (top_score >= 0.88 and rarity_match and len([s for s,_ in scored if s >= 0.88]) == 1)
        if auto:
            updates = {
                'status':      'auto_matched',
                'card_id':     top_row.get('card_id'),
                'card_number': top_row.get('card_number'),
                'set_name':    top_row.get('set_name'),
                'candidates':  candidates_json,
            }
            if not args.dry_run:
                patch('acquisition_imports', 'id', rid, updates)
            stats['auto'] += 1
            if i < 20 or i % 100 == 0:
                print(f'  [{i+1}] AUTO  {clean_name[:40]:40} -> {top_row.get("card_name")} ({top_row.get("rarity")}) [{top_score:.2f}]')
        else:
            # Multiple candidates or medium confidence → needs_review with candidates populated
            updates = {'candidates': candidates_json}
            if not args.dry_run:
                patch('acquisition_imports', 'id', rid, updates)
            stats['review'] += 1
            if i < 20 or i % 100 == 0:
                top3 = ', '.join(f'{r.get("card_name")} ({round(s,2)})' for s,r in scored[:3])
                print(f'  [{i+1}] REVIEW {clean_name[:35]:35} | top: {top3[:80]}')

        if (i+1) % 50 == 0:
            print(f'  ... {i+1}/{len(staging)} processed')

    print()
    print('=' * 55)
    print(f'Auto-matched  : {stats["auto"]}')
    print(f'Needs review  : {stats["review"]} (candidates populated)')
    print(f'No match      : {stats["no_match"]}')
    print(f'Had card#     : {stats["already_has_number"]} (skipped)')
    if args.dry_run:
        print('(DRY RUN — nothing written)')

if __name__ == '__main__':
    main()
