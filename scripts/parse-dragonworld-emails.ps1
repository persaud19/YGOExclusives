# Dragon World Games email parser
# Reads emails from Outlook (Inbox + YuGiOh subfolder), extracts order line items
# Output: dragon-world-acquisitions.csv

Add-Type -AssemblyName Microsoft.Office.Interop.Outlook 2>$null

$pythonScript = @'
import win32com.client
import re
import csv
import sys
from datetime import datetime

outlook = win32com.client.Dispatch("Outlook.Application")
ns = outlook.GetNamespace("MAPI")
inbox = ns.GetDefaultFolder(6)  # 6 = Inbox

# Collect folders to search
folders_to_search = [inbox]
try:
    for folder in inbox.Folders:
        if "yugioh" in folder.Name.lower() or "ygo" in folder.Name.lower():
            folders_to_search.append(folder)
            print(f"Also searching subfolder: {folder.Name}", file=sys.stderr)
except:
    pass

LINE_RE = re.compile(
    r'-\s+(\d+)x\s+(.+?)\s+-\s+([A-Z0-9]+-[A-Z]{2}\d+[A-Z]?)\s+-\s+(.+?)\s+-\s+(1st Edition|Unlimited|Limited),?\s*\d{4}',
    re.IGNORECASE
)
PRICE_RE = re.compile(r'Condition:\s*(.+?),\s*CAD\$\s*([\d.]+)')
TOTAL_RE = re.compile(r'Total:\s*CAD\$\s*([\d.]+)')
DATE_RE  = re.compile(r'(\w+ \d+, \d{4})')

records = []
seen_orders = set()

for folder in folders_to_search:
    messages = folder.Items
    messages.Sort("[ReceivedTime]", True)
    count = 0
    for msg in messages:
        try:
            subject = str(msg.Subject) if msg.Subject else ""
            sender  = str(msg.SenderEmailAddress) if msg.SenderEmailAddress else ""
            if "dragon" not in sender.lower() and "dragon" not in subject.lower():
                continue
            body = str(msg.Body)
            if "Order Contents" not in body:
                continue

            received = msg.ReceivedTime
            order_date = received.strftime("%Y-%m-%d") if received else ""
            order_id   = str(msg.EntryID)
            if order_id in seen_orders:
                continue
            seen_orders.add(order_id)

            # Extract total
            total_match = TOTAL_RE.search(body)
            order_total = total_match.group(1) if total_match else ""

            # Split into line items (each starts with " - Nx ")
            section = body.split("Order Contents:")[1].split("---")[1] if "Order Contents:" in body else body
            lines = section.split("\n")

            i = 0
            while i < len(lines):
                line = lines[i].strip()
                lm = LINE_RE.match(line)
                if lm:
                    qty         = lm.group(1)
                    card_name   = lm.group(2).strip()
                    card_number = lm.group(3).strip()
                    rarity      = lm.group(4).strip()
                    edition     = lm.group(5).strip()
                    # Next non-empty line should be Condition/Price
                    condition = ""
                    price_per = ""
                    for j in range(i+1, min(i+3, len(lines))):
                        pm = PRICE_RE.search(lines[j])
                        if pm:
                            condition = pm.group(1).strip()
                            price_per = pm.group(2).strip()
                            break
                    records.append({
                        "card_name":    card_name,
                        "card_number":  card_number,
                        "rarity":       rarity,
                        "edition":      edition,
                        "condition":    condition,
                        "quantity":     qty,
                        "price_per_card": price_per,
                        "total_cost":   str(float(price_per) * int(qty)) if price_per and qty else "",
                        "purchased_from": "Dragon World Games",
                        "acquisition_date": order_date,
                        "order_total":  order_total,
                    })
                i += 1
            count += 1
        except Exception as e:
            print(f"Error on message: {e}", file=sys.stderr)
            continue
    print(f"Processed {count} Dragon World orders from '{folder.Name}'", file=sys.stderr)

# Write CSV
out = r"D:\CoworkOS\YGO Project\scripts\dragon-world-acquisitions.csv"
fields = ["card_name","card_number","rarity","edition","condition","quantity",
          "price_per_card","total_cost","purchased_from","acquisition_date","order_total"]
with open(out, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(records)

print(f"Done. {len(records)} line items written to {out}")
'@

$pythonScript | python
