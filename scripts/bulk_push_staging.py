"""
Bulk push all needs_review + auto_matched rows from acquisition_imports
straight to the acquisitions table as-is (no inventory matching needed).
This is a cost ledger — card_name/rarity as extracted is good enough.

Filters applied before push:
  - Must have at least one of: price_per_card, total_cost
  - card_name must not be a known-bad/vague pattern
"""
import requests, json, io, sys, time, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

BAD_NAMES = {
    'unknown', 'unknown card', 'unreadable invoice', 'unreadable',
    'multiple cards claim lot', 'claim sale cards', 'claim sale',
    'various cards', 'various', 'cards', 'card', 'n/a', '',
}

def is_bad_name(name):
    if not name: return True
    clean = re.sub(r'\[.*?\]', '', name).strip().lower()
    if clean in BAD_NAMES: return True
    # Generic catch-alls: very short or purely numeric
    if len(clean) < 3: return True
    return False

def has_value(row):
    ppc = row.get('price_per_card')
    tc  = row.get('total_cost')
    return (ppc and float(ppc) > 0) or (tc and float(tc) > 0)

with open(r'D:\CoworkOS\YGO Project\backups\config.json', encoding='utf-8-sig') as f:
    cfg = json.load(f)
H = {'apikey': cfg['service_role_key'], 'Authorization': 'Bearer ' + cfg['service_role_key'],
     'Content-Type': 'application/json', 'Prefer': 'return=minimal'}
url = cfg['supabase_url']

def fetch_all_staging(status):
    rows, offset = [], 0
    while True:
        params = {'status': f'eq.{status}', 'select': '*', 'order': 'created_at.asc'}
        r = requests.get(f'{url}/rest/v1/acquisition_imports', headers={**H, 'Range-Unit': 'items', 'Range': f'{offset}-{offset+999}'}, params=params)
        batch = r.json() if r.ok else []
        if not isinstance(batch, list) or not batch: break
        rows.extend(batch)
        if len(batch) < 1000: break
        offset += 1000
    return rows

def push_batch(acq_rows):
    """Insert batch into acquisitions table."""
    records = []
    for row in acq_rows:
        # Clean card_name: strip bracketed Claude notes
        import re
        name = re.sub(r'\[.*?\]', '', row.get('card_name') or '').strip() or row.get('card_name') or 'Unknown'
        records.append({
            'card_id':          row.get('card_id') or None,
            'card_number':      row.get('card_number') or None,
            'card_name':        name,
            'rarity':           row.get('rarity') or None,
            'purchased_from':   row.get('purchased_from') or None,
            'quantity':         row.get('quantity') or 1,
            'price_per_card':   row.get('price_per_card') or None,
            'total_cost':       row.get('total_cost') or None,
            'acquisition_date': row.get('acquisition_date') or None,
            'edition':          None,
            'condition':        'Near Mint',
        })
    r = requests.post(f'{url}/rest/v1/acquisitions', headers=H, json=records)
    return r.ok, r.status_code

def mark_imported(ids):
    # Supabase REST can't do IN easily for large sets — patch in chunks
    for i in range(0, len(ids), 100):
        chunk = ids[i:i+100]
        id_list = ','.join(f'"{x}"' for x in chunk)
        r = requests.patch(
            f'{url}/rest/v1/acquisition_imports?id=in.({id_list})',
            headers=H, json={'status': 'imported'})

total_pushed = 0
total_failed = 0

for status in ['auto_matched', 'needs_review']:
    rows = fetch_all_staging(status)

    # Filter: must have a value AND a sensible card name
    good  = [r for r in rows if has_value(r) and not is_bad_name(r.get('card_name'))]
    bad   = [r for r in rows if not has_value(r) or is_bad_name(r.get('card_name'))]
    print(f'\n{status}: {len(good)} rows to push  (skipping {len(bad)} bad/valueless)')
    rows = good

    # Mark skipped rows so they don't show up again
    skip_ids = [r['id'] for r in bad]
    if skip_ids:
        for i in range(0, len(skip_ids), 100):
            chunk = skip_ids[i:i+100]
            id_list = ','.join(f'"{x}"' for x in chunk)
            requests.patch(f'{url}/rest/v1/acquisition_imports?id=in.({id_list})',
                           headers=H, json={'status': 'skipped'})
        print(f'  → marked {len(skip_ids)} as skipped')

    # Process in batches of 200
    for i in range(0, len(rows), 200):
        batch = rows[i:i+200]
        ok, code = push_batch(batch)
        if ok:
            mark_imported([r['id'] for r in batch])
            total_pushed += len(batch)
            print(f'  pushed {i+len(batch)}/{len(rows)} ({code})')
        else:
            total_failed += len(batch)
            print(f'  FAILED batch {i}-{i+len(batch)}: {code}')
        time.sleep(0.2)

print(f'\nDone. Pushed: {total_pushed}  Failed: {total_failed}')
