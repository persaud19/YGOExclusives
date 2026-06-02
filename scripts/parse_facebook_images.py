"""
Facebook Messenger image → acquisition_imports parser
Scans all photos in inbox + e2ee_cutover threads, sends each to Claude Haiku
vision to extract card purchase invoices, inserts into acquisition_imports.

Usage:
    python scripts/parse_facebook_images.py
    python scripts/parse_facebook_images.py --dry-run
    python scripts/parse_facebook_images.py --limit 50      # test first 50 images
    python scripts/parse_facebook_images.py --thread kennishi  # single thread
"""

import zipfile, json, re, time, base64, datetime, argparse, sys, requests, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from pathlib import Path

BASE = Path(r"D:\CoworkOS\YGO Project")
ZIP_PATH = BASE / "facebook-Persaud19-2026-06-01-OHj1PQA0.zip"

with open(BASE / "backups" / "config.json", encoding="utf-8-sig") as f:
    cfg = json.load(f)

SUPABASE_URL = cfg["supabase_url"]
SERVICE_KEY  = cfg["service_role_key"]
ANTHROPIC_KEY = cfg["anthropic_api_key"]

SB_HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

PERSONAL_NAMES = {
    "Andrew Persaud", "Austin Persaud", "Sabrina Persaud", "Sarah Veinotte",
    "Calvin Kostka", "Neil Kelkar", "Fawaz Khan", "Christopher Ro", "Monika Dinwoodie",
}
SKIP_FOLDER_KEYWORDS = [
    "dragonworldcardsgamesandcollectibles",
    "ygosingles",
    "yugiohtournamentplan",
    "wastefull", "groomsmen", "bachelor",
]

IMAGE_SYSTEM = """You are extracting YuGiOh card purchase invoice data from images shared in Facebook Messenger.

Ryan Persaud is a YuGiOh card resale business owner. You are looking for images that show purchase invoices, price lists, or card lists sent from a seller to Ryan (where Ryan is BUYING).

If this image contains a card purchase invoice or price list, extract each line item as JSON:
[
  {
    "card_name": "full card name",
    "rarity": "rarity or null",
    "quantity": integer or null,
    "price_per_card": float or null,
    "total_cost": float or null,
    "notes": "any extra info like set code, edition, condition"
  }
]

Rules:
- Currency is ALWAYS CAD unless the image explicitly says USD
- Do NOT include shipping cost lines — only card prices
- If the image is NOT a card purchase invoice, return exactly: []
  NOT invoices: card photos, shipping labels/envelopes with addresses, Canada Post/USPS tracking photos, bubble mailer photos, memes, selfies, packing slips, order confirmation emails
- If it's an invoice but you can't read specific card names, return: [{"card_name": "unreadable invoice", "total_cost": <total if visible>}]
- Return ONLY valid JSON array, no markdown fences, no explanation"""

def get_image_media_type(filename):
    ext = filename.lower().rsplit(".", 1)[-1]
    return {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")

def call_claude_vision(image_bytes, filename, sender_name, msg_date):
    b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
    media_type = get_image_media_type(filename)

    payload = {
        "model": "claude-haiku-4-5",
        "max_tokens": 1000,
        "system": IMAGE_SYSTEM,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                {"type": "text", "text": f"Sender: {sender_name}\nDate: {msg_date}\n\nExtract card purchase data from this image. Return JSON array only."}
            ]
        }]
    }

    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json=payload,
        timeout=60,
    )
    r.raise_for_status()
    resp = r.json()
    raw = resp["content"][0]["text"].strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
    try:
        return json.loads(raw), resp.get("usage", {})
    except json.JSONDecodeError:
        return [], {}

def build_image_map(z, all_names):
    """
    Build a map of image path → (thread_folder, sender_name, msg_date, thread_title)
    by reading each message file and finding photo attachments.
    """
    image_info = {}  # image_path → (seller_name, msg_date, thread_title, thread_folder)

    msg_files = [n for n in all_names if
                 ("messages/inbox/" in n or "messages/e2ee_cutover/" in n)
                 and n.endswith(".json") and "/message_" in n]

    for path in msg_files:
        try:
            d = json.loads(z.read(path))
        except Exception:
            continue

        participants = d.get("participants", [])
        title = d.get("title", "")
        part_names = {p.get("name", "") for p in participants}
        if part_names & PERSONAL_NAMES:
            continue

        # Determine thread folder name for skip check
        parts = path.split("/")
        folder_name = parts[3].lower()
        if any(kw in folder_name for kw in SKIP_FOLDER_KEYWORDS):
            continue

        # Seller = non-Ryan participant
        others = [p.get("name", "") for p in participants if p.get("name") not in ("Ryan Persaud", "")]
        seller = others[0] if others else title or "Facebook"

        for msg in d.get("messages", []):
            sender = msg.get("sender_name", "")
            ts = msg.get("timestamp_ms", 0) / 1000
            dt = datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d")

            for photo in msg.get("photos", []):
                uri = photo.get("uri", "")
                if uri in all_names:
                    image_info[uri] = (seller, dt, title, folder_name)

    return image_info

def insert_staging_rows(rows, seller_name, msg_date, dry_run=False):
    if not rows:
        return 0
    records = []
    for row in rows:
        name = row.get("card_name") or "Unknown"
        if row.get("notes"):
            name = f"{name} [{row['notes']}]"
        records.append({
            "source": "facebook_image",
            "status": "needs_review",
            "card_name": name,
            "rarity": row.get("rarity"),
            "purchased_from": seller_name,
            "acquisition_date": msg_date,
            "price_per_card": row.get("price_per_card"),
            "quantity": row.get("quantity") or 1,
            "total_cost": row.get("total_cost"),
            "card_id": None,
            "card_number": None,
            "set_name": None,
            "candidates": json.dumps([]),
        })

    if dry_run:
        for r in records:
            print(f"    [DRY RUN] {r['card_name'][:50]} | {r['rarity']} | qty={r['quantity']} | ppc=${r['price_per_card']} tc=${r['total_cost']} | {r['acquisition_date']}")
        return len(records)

    r = requests.post(f"{SUPABASE_URL}/rest/v1/acquisition_imports", headers=SB_HEADERS, json=records, timeout=30)
    if not r.ok:
        print(f"    WARN Insert failed: {r.status_code} {r.text[:200]}")
        return 0
    return len(records)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--thread", type=str, default="")
    args = parser.parse_args()

    print(f"Opening ZIP: {ZIP_PATH}")
    z = zipfile.ZipFile(ZIP_PATH)
    all_names = set(z.namelist())

    print("Building image → thread map (scanning message files)...")
    image_info = build_image_map(z, all_names)
    print(f"Found {len(image_info)} images with thread context\n")

    # Apply thread filter
    if args.thread:
        image_info = {k: v for k, v in image_info.items() if args.thread.lower() in v[3]}
        print(f"Filtered to {len(image_info)} images for thread '{args.thread}'\n")

    images_checked = 0
    invoices_found = 0
    rows_staged = 0
    total_in = 0
    total_out = 0

    for img_path, (seller, dt, title, folder) in image_info.items():
        if args.limit and images_checked >= args.limit:
            break

        # Skip files not in zip (stale references)
        if img_path not in all_names:
            continue

        # Skip large images (>2MB) — likely card photos not invoices
        info = z.getinfo(img_path)
        if info.file_size > 2_000_000:
            continue

        images_checked += 1
        filename = img_path.rsplit("/", 1)[-1]

        try:
            image_bytes = z.read(img_path)
        except Exception as e:
            print(f"  SKIP {filename}: read error {e}")
            continue

        try:
            results, usage = call_claude_vision(image_bytes, filename, seller, dt)
            tin  = usage.get("input_tokens", 0)
            tout = usage.get("output_tokens", 0)
            total_in  += tin
            total_out += tout
        except Exception as e:
            print(f"  ERROR {filename}: {e}")
            time.sleep(2)
            continue

        if results:
            invoices_found += 1
            print(f"[{images_checked}] INVOICE  {seller:25} {dt}  {filename}")
            for r in results:
                print(f"    • {r.get('card_name','?')[:45]:45} | {str(r.get('rarity',''))[:18]:18} | qty={r.get('quantity')} | ${r.get('price_per_card')} / ${r.get('total_cost')}")
            n = insert_staging_rows(results, seller, dt, dry_run=args.dry_run)
            rows_staged += n
        else:
            if images_checked % 50 == 0:
                print(f"[{images_checked}] ... {invoices_found} invoices so far, ${(total_in*0.80+total_out*4.00)/1_000_000:.4f} spent")

        time.sleep(0.3)

    cost = (total_in * 0.80 + total_out * 4.00) / 1_000_000
    print()
    print("=" * 60)
    print(f"Images checked    : {images_checked}")
    print(f"Invoices found    : {invoices_found}  ({invoices_found/max(images_checked,1)*100:.0f}%)")
    print(f"Rows staged       : {rows_staged}")
    print(f"Tokens in/out     : {total_in:,} / {total_out:,}")
    print(f"Estimated cost    : ${cost:.4f} USD")
    if args.dry_run:
        print("(DRY RUN)")

if __name__ == "__main__":
    main()
