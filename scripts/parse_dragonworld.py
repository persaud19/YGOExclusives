import win32com.client
import re
import csv

LINE_RE = re.compile(
    r'-\s+(\d+)x\s+(.+?)\s+-\s+([A-Z0-9]+-EN\d+[A-Z]?)\s+-\s+(.+?)\s+-\s+(1st Edition|Unlimited|Limited)',
    re.IGNORECASE
)
PRICE_RE = re.compile(r'Condition:\s*(.+?),\s*CAD\$\s*([\d.]+)')
TOTAL_RE = re.compile(r'^Total:\s*CAD\$\s*([\d.]+)', re.MULTILINE)

outlook = win32com.client.Dispatch("Outlook.Application")
ns = outlook.GetNamespace("MAPI")
inbox = ns.GetDefaultFolder(6)

# Find Purchases > YUGIOH folder
yugioh = None
for f in inbox.Folders:
    if f.Name == "Purchases":
        for sf in f.Folders:
            if sf.Name == "YUGIOH":
                yugioh = sf

folders = [inbox]
if yugioh:
    folders.append(yugioh)
    print(f"Found YUGIOH folder with {yugioh.Items.Count} emails")

records = []
order_count = 0
seen = set()

for folder in folders:
    for msg in folder.Items:
        try:
            sender = str(msg.SenderEmailAddress) if msg.SenderEmailAddress else ""
            body   = str(msg.Body) if msg.Body else ""
            subj = str(msg.Subject) if msg.Subject else ""
            is_dragon = (
                "crystalcommerce" in sender.lower() or
                ("Dragon World" in subj and "Order #" in subj)
            )
            if not is_dragon:
                continue
            if "Order Contents" not in body:
                continue
            entry_id = str(msg.EntryID)
            if entry_id in seen:
                continue
            seen.add(entry_id)

            order_count += 1
            received = str(msg.ReceivedTime)[:10]
            total_m  = TOTAL_RE.search(body)
            order_total = total_m.group(1) if total_m else ""

            lines = body.split("\n")
            i = 0
            while i < len(lines):
                lm = LINE_RE.match(lines[i].strip())
                if lm:
                    qty         = lm.group(1)
                    card_name   = lm.group(2).strip()
                    card_number = lm.group(3).strip()
                    rarity      = lm.group(4).strip()
                    edition     = lm.group(5).strip()
                    condition   = ""
                    price_per   = ""
                    for j in range(i + 1, min(i + 3, len(lines))):
                        pm = PRICE_RE.search(lines[j])
                        if pm:
                            condition = pm.group(1).strip()
                            price_per = pm.group(2).strip()
                            break
                    try:
                        total_cost = str(round(float(price_per) * int(qty), 2)) if price_per and qty else ""
                    except:
                        total_cost = ""
                    records.append({
                        "card_name":        card_name,
                        "card_number":      card_number,
                        "rarity":           rarity,
                        "edition":          edition,
                        "condition":        condition,
                        "quantity":         qty,
                        "price_per_card":   price_per,
                        "total_cost":       total_cost,
                        "purchased_from":   "Dragon World Games",
                        "acquisition_date": received,
                        "order_total":      order_total,
                    })
                i += 1
        except Exception as e:
            print(f"Error: {e}")
            continue

print(f"Orders parsed:      {order_count}")
print(f"Line items found:   {len(records)}")

out = r"D:\CoworkOS\YGO Project\scripts\dragon-world-acquisitions.csv"
fields = ["card_name","card_number","rarity","edition","condition","quantity",
          "price_per_card","total_cost","purchased_from","acquisition_date","order_total"]
with open(out, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(records)

print(f"Written to {out}")
if records:
    print(f"\nSample rows:")
    for r in records[:3]:
        print(r)
