"""
Facebook Messenger → acquisition_imports parser
Reads inbox threads from the Facebook ZIP export, uses Claude Haiku to
extract YGO card purchases (where Ryan is the BUYER), and inserts rows
into the acquisition_imports staging table.

Usage:
    python scripts/parse_facebook_messages.py
    python scripts\parse_facebook_messages.py --dry-run     # no DB writes
    python scripts\parse_facebook_messages.py --limit 10    # first N threads
    python scripts\parse_facebook_messages.py --thread bryce  # single thread keyword
"""

import zipfile, json, re, time, datetime, argparse, sys, requests, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
BASE = Path(r"D:\CoworkOS\YGO Project")
ZIP_PATH = BASE / "facebook-Persaud19-2026-06-01-OHj1PQA0.zip"

with open(BASE / "backups" / "config.json", encoding="utf-8-sig") as f:
    cfg = json.load(f)

SUPABASE_URL = cfg["supabase_url"]
SERVICE_KEY = cfg["service_role_key"]
ANTHROPIC_KEY = cfg["anthropic_api_key"]

SB_HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

# ── Exclusions ────────────────────────────────────────────────────────────────
PERSONAL_NAMES = {
    "Andrew Persaud", "Austin Persaud", "Sabrina Persaud", "Sarah Veinotte",
    "Calvin Kostka", "Neil Kelkar", "Fawaz Khan", "Christopher Ro",
    "Monika Dinwoodie",
}
SKIP_THREAD_KEYWORDS = [
    "dragonworldcardsgamesandcollectibles",   # handled via email parser
    "ygosingles",                              # family group chat
    "yugiohtourn",                             # planning, not buying
    "wastefull", "groomsmen", "bachelor",      # personal
]

# YGO keywords to classify a thread as relevant
YGO_KEYWORDS = [
    "yugioh","yu-gi-oh","ygo","rare","claim","playset","secret","ultra","holo",
    "common","booster","tcg","singles","binder","ghostrare","starlight",
    "collector","prismatic","quarter century","first edition","unlimited",
    "card","cards",
]

# ── Claude Haiku extraction prompt ────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert at extracting YuGiOh card purchase records from casual Facebook Messenger conversations.

Ryan Persaud is a YuGiOh card resale business owner. You are looking for instances where RYAN IS THE BUYER — he paid someone for YuGiOh cards.

Extract ONLY purchases (Ryan buying), NOT sales (Ryan selling to others).

For each card purchase found, return a JSON array of objects with:
- card_name: string (full card name if known, otherwise best guess)
- rarity: string or null (e.g. "Secret Rare", "Ultra Rare", "Collector's Rare", "Ghost Rare", "Starlight Rare", "Quarter Century Secret Rare", "Common", etc.)
- quantity: integer (default 1 if not specified)
- price_per_card: float or null (ALWAYS assume CAD unless the seller explicitly states USD — the vast majority of these are Canadian sellers pricing in CAD)
- total_cost: float or null (total for this card line)
- acquisition_date: string ISO date "YYYY-MM-DD" (use message timestamp of agreement/payment, or best estimate)
- notes: string or null (any extra context like set name, condition, edition)

Rules:
- If the conversation has NO purchases by Ryan, return an empty array []
- If price is only mentioned as a total (e.g. "here is your invoice for $45"), set total_cost and leave price_per_card null
- If a "lot" or "bundle" is purchased for one price, list it as one entry with card_name describing the lot
- Ignore shipping costs — only card prices
- If a deal is negotiated but never confirmed (Ryan says "I'll pass" or no agreement), do NOT include it
- Return ONLY valid JSON — no markdown fences, no explanation

Example output for a conversation where Ryan bought 2 cards:
[{"card_name": "Ash Blossom & Joyous Spring", "rarity": "Secret Rare", "quantity": 3, "price_per_card": 8.00, "total_cost": 24.00, "acquisition_date": "2022-03-15", "notes": "PHRA first edition"},
 {"card_name": "Nibiru, the Primal Being", "rarity": "Ultra Rare", "quantity": 1, "price_per_card": 12.00, "total_cost": 12.00, "acquisition_date": "2022-03-15", "notes": null}]"""

def format_thread_for_claude(messages, seller_name):
    """Format messages into a readable conversation string for Claude."""
    lines = []
    for m in messages:
        ts = datetime.datetime.fromtimestamp(m.get("timestamp_ms", 0) / 1000)
        date_str = ts.strftime("%Y-%m-%d")
        sender = m.get("sender_name", "Unknown")
        # Fix mojibake encoding (Facebook exports in latin1 sometimes)
        content = m.get("content", "")
        if content:
            try:
                content = content.encode("latin1").decode("utf-8")
            except (UnicodeDecodeError, UnicodeEncodeError):
                pass
        if content:
            lines.append(f"[{date_str}] {sender}: {content[:300]}")
        # Include photo descriptions
        for photo in m.get("photos", []):
            lines.append(f"[{date_str}] {sender}: [shared a photo]")

    return "\n".join(lines)

def call_claude_haiku(thread_text, seller_name):
    """Call Claude Haiku to extract purchase records from a thread."""
    user_msg = f"""Seller/other party name: {seller_name}

Conversation:
{thread_text[:12000]}

Extract all YuGiOh card purchases where Ryan Persaud is the buyer. Return JSON array only."""

    payload = {
        "model": "claude-haiku-4-5",
        "max_tokens": 2000,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_msg}],
    }
    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=payload,
        timeout=60,
    )
    r.raise_for_status()
    resp = r.json()
    raw = resp["content"][0]["text"].strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)

    try:
        return json.loads(raw), resp.get("usage", {})
    except json.JSONDecodeError:
        return [], {}

def insert_staging_rows(rows, thread_title, seller_name, dry_run=False):
    """Insert extracted purchase rows into acquisition_imports staging table."""
    if not rows:
        return 0

    records = []
    for row in rows:
        record = {
            "source": "facebook_messenger",
            "status": "needs_review",
            "card_name": row.get("card_name") or "Unknown",
            "rarity": row.get("rarity"),
            "purchased_from": seller_name or thread_title or "Facebook",
            "acquisition_date": row.get("acquisition_date"),
            "price_per_card": row.get("price_per_card"),
            "quantity": row.get("quantity") or 1,
            "total_cost": row.get("total_cost"),
            "card_id": None,
            "card_number": None,
            "set_name": None,
            "candidates": json.dumps([]),
        }
        # notes stored via card_name if it has context
        if row.get("notes"):
            record["card_name"] = f"{record['card_name']} [{row['notes']}]"
        records.append(record)

    if dry_run:
        for r in records:
            print(f"    [DRY RUN] Would insert: {r['card_name']} | {r['rarity']} | qty={r['quantity']} | ${r['price_per_card']} | {r['acquisition_date']}")
        return len(records)

    # Batch insert
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/acquisition_imports",
        headers=SB_HEADERS,
        json=records,
        timeout=30,
    )
    if not r.ok:
        print(f"    WARN Insert failed: {r.status_code} {r.text[:200]}")
        return 0
    return len(records)

def is_ygo_relevant(title, messages):
    """Quick check if a thread is YGO-related based on title + sample messages."""
    sample = messages[:8] + messages[-8:]
    combined = title.lower() + " " + " ".join(m.get("content", "").lower() for m in sample)
    return any(kw in combined for kw in YGO_KEYWORDS)

def get_seller_name(participants):
    """Get the non-Ryan participant's name."""
    others = [p.get("name", "") for p in participants if p.get("name") not in ("Ryan Persaud", "")]
    return others[0] if others else ""

def load_thread_messages(z, folder_prefix):
    """Load and sort all messages from a thread (may span multiple message_N.json files)."""
    names = z.namelist()
    files = sorted([n for n in names if n.startswith(folder_prefix) and n.endswith(".json") and "/message_" in n])
    all_msgs = []
    for f in files:
        d = json.loads(z.read(f))
        all_msgs.extend(d.get("messages", []))
    all_msgs.sort(key=lambda m: m.get("timestamp_ms", 0))
    return all_msgs

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Don't write to DB")
    parser.add_argument("--limit", type=int, default=0, help="Max threads to process")
    parser.add_argument("--thread", type=str, default="", help="Filter by folder name keyword")
    args = parser.parse_args()

    print(f"Opening ZIP: {ZIP_PATH}")
    z = zipfile.ZipFile(ZIP_PATH)
    all_names = z.namelist()

    # Build list of all inbox + e2ee_cutover message_1.json files
    inbox_msg1s = [n for n in all_names if "messages/inbox/" in n and n.endswith("message_1.json")]
    e2ee_msg1s  = [n for n in all_names if "messages/e2ee_cutover/" in n and n.endswith("message_1.json")]
    msg1s = inbox_msg1s + e2ee_msg1s
    print(f"Found {len(inbox_msg1s)} inbox threads + {len(e2ee_msg1s)} e2ee_cutover threads = {len(msg1s)} total\n")

    threads_processed = 0
    threads_skipped = 0
    total_purchases = 0
    total_tokens_in = 0
    total_tokens_out = 0

    for path in msg1s:
        folder = path.rsplit("/", 1)[0] + "/"
        # path = your_facebook_activity/messages/inbox/<folder>/message_1.json
        # or     your_facebook_activity/messages/e2ee_cutover/<folder>/message_1.json
        folder_name = path.split("/")[3].lower()  # index 3 = the thread subfolder name

        # Apply thread keyword filter
        if args.thread and args.thread.lower() not in folder_name:
            continue

        # Load first file to read metadata
        d = json.loads(z.read(path))
        title = d.get("title", "")
        participants = d.get("participants", [])
        seller_name = get_seller_name(participants)
        part_names = {p.get("name", "") for p in participants}

        # Skip personal threads
        if part_names & PERSONAL_NAMES:
            threads_skipped += 1
            continue

        # Skip known non-card threads
        if any(kw in folder_name for kw in SKIP_THREAD_KEYWORDS):
            threads_skipped += 1
            continue

        # Load all messages
        all_msgs = load_thread_messages(z, folder)

        # Check YGO relevance
        if not is_ygo_relevant(title, all_msgs):
            threads_skipped += 1
            continue

        if args.limit and threads_processed >= args.limit:
            break

        threads_processed += 1
        msg_count = len(all_msgs)
        print(f"[{threads_processed}] {title or folder_name!r}  ({msg_count} msgs)  seller={seller_name!r}")

        # Format for Claude
        thread_text = format_thread_for_claude(all_msgs, seller_name)

        # Call Claude Haiku
        try:
            purchases, usage = call_claude_haiku(thread_text, seller_name)
            tin = usage.get("input_tokens", 0)
            tout = usage.get("output_tokens", 0)
            total_tokens_in += tin
            total_tokens_out += tout
        except Exception as e:
            print(f"    ERROR Claude: {e}")
            time.sleep(2)
            continue

        if purchases:
            print(f"    OK {len(purchases)} purchase(s) found  [tokens: {tin}in/{tout}out]")
            for p in purchases:
                print(f"       • {p.get('card_name')} | {p.get('rarity')} | qty={p.get('quantity')} | ${p.get('price_per_card') or p.get('total_cost')} | {p.get('acquisition_date')}")
            n_inserted = insert_staging_rows(purchases, title, seller_name, dry_run=args.dry_run)
            total_purchases += n_inserted
        else:
            print(f"    — No purchases found  [tokens: {tin}in/{tout}out]")

        # Rate limit: ~60 req/min for Haiku
        time.sleep(0.5)

    # Cost estimate (claude-haiku-4-5 pricing)
    cost_in  = total_tokens_in  * 0.80 / 1_000_000
    cost_out = total_tokens_out * 4.00 / 1_000_000
    total_cost = cost_in + cost_out

    print()
    print("=" * 60)
    print(f"Threads processed : {threads_processed}")
    print(f"Threads skipped   : {threads_skipped}")
    print(f"Purchases staged  : {total_purchases}")
    print(f"Tokens in/out     : {total_tokens_in:,} / {total_tokens_out:,}")
    print(f"Estimated cost    : ${total_cost:.4f} USD")
    if args.dry_run:
        print("(DRY RUN — nothing written to DB)")

if __name__ == "__main__":
    main()
