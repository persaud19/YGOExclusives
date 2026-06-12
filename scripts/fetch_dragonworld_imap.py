import imaplib
import email
import re
import csv
from email.header import decode_header

EMAIL = "persaud_19@hotmail.com"
PASSWORD = "pjwqtkovveacniyv"
IMAP_SERVER = "imap-mail.outlook.com"

LINE_RE = re.compile(
    r'-\s+(\d+)x\s+(.+?)\s+-\s+([A-Z0-9]+-EN\d+[A-Z]?)\s+-\s+(.+?)\s+-\s+(1st Edition|Unlimited|Limited)',
    re.IGNORECASE
)
PRICE_RE = re.compile(r'Condition:\s*(.+?),\s*CAD\$\s*([\d.]+)')
TOTAL_RE = re.compile(r'^Total:\s*CAD\$\s*([\d.]+)', re.MULTILINE)

print("Connecting to IMAP...")
mail = imaplib.IMAP4_SSL(IMAP_SERVER)
mail.login(EMAIL, PASSWORD)
print("Logged in.")

# List all folders to find where Dragon World emails live
print("\nAvailable folders:")
_, folders = mail.list()
for f in folders:
    print(" ", f.decode())
