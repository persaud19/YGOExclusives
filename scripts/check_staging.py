import requests, json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
with open(r'D:\CoworkOS\YGO Project\backups\config.json', encoding='utf-8-sig') as f:
    cfg = json.load(f)
H = {'apikey': cfg['service_role_key'], 'Authorization': 'Bearer ' + cfg['service_role_key']}
url = cfg['supabase_url']

# Count by source+status
for source in ['claim_sales', 'facebook_messenger', 'dragon_world']:
    r = requests.get(url + f'/rest/v1/acquisition_imports?source=eq.{source}&select=id',
        headers={**H, 'Prefer': 'count=exact', 'Range': '0-0'})
    total = r.headers.get('content-range', '0/0').split('/')[1]
    print(f'{source}: {total} rows')

print()
# Show last 10 FB messenger rows
r2 = requests.get(url + '/rest/v1/acquisition_imports?source=eq.facebook_messenger&order=created_at.desc&limit=10&select=card_name,rarity,purchased_from,price_per_card,total_cost,acquisition_date', headers=H)
rows = r2.json()
print(f'Last {len(rows)} facebook_messenger rows:')
for row in rows:
    name = (row.get('card_name') or '')[:45]
    rarity = (row.get('rarity') or '')[:18]
    seller = (row.get('purchased_from') or '')[:18]
    ppc = row.get('price_per_card')
    tc = row.get('total_cost')
    dt = row.get('acquisition_date') or ''
    print(f'  {name:45} | {rarity:18} | {seller:18} | ppc=${ppc} tc=${tc} | {dt}')
