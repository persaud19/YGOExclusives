import win32com.client
import time

outlook = win32com.client.Dispatch("Outlook.Application")
ns = outlook.GetNamespace("MAPI")

search = outlook.AdvancedSearch(
    "Inbox",
    'urn:schemas:httpmail:subject LIKE "%Dragon World%"',
    True,
    "DWSearch"
)

print("Searching... waiting 15 seconds for results")
time.sleep(15)

results = search.Results
print("Results found:", results.Count)
for i in range(1, min(11, results.Count + 1)):
    msg = results.Item(i)
    print(str(msg.ReceivedTime)[:10], "|", str(msg.Subject)[:70])
