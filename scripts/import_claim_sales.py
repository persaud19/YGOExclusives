import pandas as pd
import requests
import json
from datetime import datetime

SUPABASE_URL = "https://xyhzwmlqmazloyerelas.supabase.co"
with open(r"D:\CoworkOS\YGO Project\backups\config.json", encoding="utf-8-sig") as f:
    cfg = json.load(f)
SERVICE_KEY = cfg["service_role_key"]

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

RARITY_ALIASES = {
    "quarter century rare": "Quarter Century Secret Rare",
    "qcsr": "Quarter Century Secret Rare",
    "quarter century secret": "Quarter Century Secret Rare",
    "collector rare": "Collector's Rare",
    "collectors rare": "Collector's Rare",
    "cr rare": "Collector's Rare",
    "cr": "Collector's Rare",
    "super": "Super Rare",
    "ultra": "Ultra Rare",
    "secret": "Secret Rare",
    "ultimate": "Ultimate Rare",
    "primsatic secret rare": "Prismatic Secret Rare",
    "platnium secret rare": "Platinum Secret Rare",
    "premimum ultimate rare": "Premium Gold Rare",
    "premimum gold rare": "Premium Gold Rare",
    "premimum collector rare": "Collector's Rare",
    "sercret rare": "Secret Rare",
    "pharorhs rare": "Pharaoh's Rare",
    "lart rare": "LART Rare",
    "lart sealed rare": "LART Rare",
}

def normalize_rarity(r):
    if not r or not isinstance(r, str):
        return r
    r = r.strip()
    key = r.lower()
    if key in RARITY_ALIASES:
        return RARITY_ALIASES[key]
    if "rare" not in key and key not in {"common", "short print"}:
        return r + " Rare"
    return r

def fetch_all(table, select="*"):
    rows = []
    offset = 0
    page = 1000
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers={**HEADERS, "Range-Unit": "items", "Range": f"{offset}-{offset+page-1}"},
            params={"select": select}
        )
        batch = r.json()
        if not isinstance(batch, list) or not batch:
            break
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows

def clean(val):
    if val is None:
        return None
    if isinstance(val, float) and val != val:
        return None
    return val

def push_batch(rows):
    cleaned = [{k: clean(v) for k, v in row.items()} for row in rows]
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/acquisition_imports",
        headers={**HEADERS, "Prefer": "return=minimal"},
        json=cleaned
    )
    if not r.ok:
        print(f"  Insert error: {r.status_code} {r.text[:200]}")

# --- Load all inventory into memory ---
print("Loading card inventory...")
inventory = fetch_all("card_inventory", "card_id,card_number,card_name,rarity,set_name")
print(f"  {len(inventory)} cards loaded")

print("Loading sets...")
sets = fetch_all("sets", "set_name,year")
set_years = {s["set_name"].lower(): int(s["year"]) for s in sets if s.get("set_name") and s.get("year")}
print(f"  {len(set_years)} sets loaded")

# Build lookup indexes
by_name_rarity = {}   # (name_lower, rarity_lower) -> [rows]
by_name = {}          # name_lower -> [rows]

for row in inventory:
    name = (row.get("card_name") or "").lower().strip()
    rarity = (row.get("rarity") or "").lower().strip()
    key = (name, rarity)
    by_name_rarity.setdefault(key, []).append(row)
    by_name.setdefault(name, []).append(row)

def filter_by_year(candidates, purchase_date):
    if not purchase_date:
        return candidates
    year = purchase_date.year
    filtered = [c for c in candidates if set_years.get((c.get("set_name") or "").lower(), 9999) <= year]
    return filtered if filtered else candidates

def match_card(card_name, rarity, purchase_date):
    name_key = card_name.lower().strip()
    rarity_key = (rarity or "").lower().strip()

    # 1. Exact name + rarity
    candidates = by_name_rarity.get((name_key, rarity_key), [])
    if candidates:
        filtered = filter_by_year(candidates, purchase_date)
        if len(filtered) == 1:
            return "auto_matched", filtered[0], []
        if len(filtered) > 1:
            return "needs_review", None, filtered
        return "needs_review", None, candidates

    # 2. Fuzzy name (contains first significant word) + rarity
    words = [w for w in card_name.split() if len(w) > 3]
    if words:
        fuzzy_matches = [
            row for row in inventory
            if words[0].lower() in (row.get("card_name") or "").lower()
            and (row.get("rarity") or "").lower() == rarity_key
        ]
        if fuzzy_matches:
            filtered = filter_by_year(fuzzy_matches, purchase_date)
            if len(filtered) == 1:
                return "auto_matched", filtered[0], []
            if len(filtered) > 1:
                return "needs_review", None, filtered[:10]

    # 3. Exact name, any rarity (rarity mismatch)
    name_matches = by_name.get(name_key, [])
    if name_matches:
        return "needs_review", None, name_matches[:10]

    return "no_match", None, []

# --- Process spreadsheet ---
df = pd.read_excel(r"D:\CoworkOS\YGO Project\scripts\claim-sales.xlsx", sheet_name="Sheet1")
df = df[["Card", "Rarity", "Purchased From", "Date", "Price Per", "Quanity", "Total"]].copy()
df.columns = ["card_name", "rarity", "purchased_from", "acquisition_date", "price_per_card", "quantity", "total_cost"]
df = df.dropna(subset=["card_name"])

print(f"\nProcessing {len(df)} rows...")

auto_matched = 0
needs_review = 0
no_match = 0
batch = []
BATCH_SIZE = 250

for i, row in df.iterrows():
    card_name = str(row["card_name"]).strip()
    raw_rarity = row["rarity"] if pd.notna(row["rarity"]) else ""
    rarity = normalize_rarity(raw_rarity) or ""
    purchase_date = row["acquisition_date"]
    if isinstance(purchase_date, pd.Timestamp):
        purchase_date = purchase_date.to_pydatetime()
    elif not isinstance(purchase_date, datetime):
        purchase_date = None

    status, matched, candidates = match_card(card_name, rarity, purchase_date)

    if status == "auto_matched":
        auto_matched += 1
    elif status == "needs_review":
        needs_review += 1
    else:
        no_match += 1

    batch.append({
        "source": "claim_sales_spreadsheet",
        "status": status,
        "card_name": card_name,
        "rarity": rarity,
        "purchased_from": str(row["purchased_from"]) if pd.notna(row["purchased_from"]) else None,
        "acquisition_date": purchase_date.strftime("%Y-%m-%d") if purchase_date and str(purchase_date) != "NaT" else None,
        "price_per_card": float(row["price_per_card"]) if pd.notna(row["price_per_card"]) else None,
        "quantity": int(row["quantity"]) if pd.notna(row["quantity"]) else None,
        "total_cost": float(row["total_cost"]) if pd.notna(row["total_cost"]) else None,
        "card_id": str(matched["card_id"]) if matched and matched.get("card_id") else None,
        "card_number": matched["card_number"] if matched else None,
        "set_name": matched["set_name"] if matched else None,
        "candidates": json.dumps(candidates[:10]) if candidates else None,
    })

    if len(batch) >= BATCH_SIZE:
        push_batch(batch)
        print(f"  Pushed {i+1} rows...")
        batch = []

if batch:
    push_batch(batch)

print(f"\nDone.")
print(f"  Auto-matched:  {auto_matched}")
print(f"  Needs review:  {needs_review}")
print(f"  No match:      {no_match}")
print(f"  Total:         {auto_matched + needs_review + no_match}")
