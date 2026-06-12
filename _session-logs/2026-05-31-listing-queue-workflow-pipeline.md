# Session Log — Listing Queue Workflow Pipeline
**Date:** 2026-05-31  
**Feature:** Photo processing + queue builder buttons wired into the app UI

---

## What Was Built

Two previously built PowerShell scripts were surfaced inside the app as a 3-step visual workflow pipeline on the Listing Queue tab.

### Before
- Scripts existed and worked but had to be run manually from the terminal
- No in-app entry point for the photo-to-queue pipeline
- Users had to know the scripts existed

### After
- A 3-panel pipeline strip sits between the header and the stats bar on the Listing Queue tab
- Each step has a description and a button that launches the right script
- Full end-to-end workflow is visible in one place

---

## The Three Steps

| Step | Button | Script | What it does |
|------|--------|--------|--------------|
| 1 | 📷 Process Photos | `backups/process-photos.ps1` | Reads photos from `Card Photos/Incoming/`, sends each to Claude Vision (2 images: full card + cropped set-code region), sorts into named folders in `Cards Processed/`, logs to `_logs/` CSV |
| 2 | 📋 Build Queue | `backups/build-listing-queue.ps1` | Scans `Cards Processed/` folders, matches each to `card_inventory` by card number, inserts `listing_queue` rows, moves folders to `Cards Listed/` |
| 3 | ▶ Push to eBay | `backups/push-to-ebay.ps1` | Takes priced pending queue entries, uploads photos to eBay EPS, creates inventory items + offers via Sell Inventory API, publishes listings |

---

## Files Changed

### `backups/launch-push.bat`
- **Was:** only handled `ygoexclusives://push` and `ygoexclusives://push/CARD`
- **Now:** also dispatches `ygoexclusives://process-photos` → `process-photos.ps1` and `ygoexclusives://build-queue` → `build-listing-queue.ps1`
- URI scheme handler that Windows calls when the app fires a `ygoexclusives://` link

### `index.html` (Listing Queue tab)
- Added 3-column pipeline strip between header and stats bar
- Removed duplicate "Push to eBay" button from the old header row (it now lives in Step 3 of the pipeline)
- "↺ eBay Prices" stays in the top-right header controls

### `js/listing-queue.js`
- Added `lqLaunchScript(action, label)` function
- Fires `window.location.href = 'ygoexclusives://${action}'`
- Shows a confirm dialog with plain-English description of what the script will do
- Disables the button for 15s while PowerShell runs, then re-enables and refreshes the queue (only on `build-queue` since that actually writes to the DB)

---

## Architecture Pattern Used: Windows URI Scheme

This is the integration pattern for triggering local PowerShell scripts from a browser-hosted web app without a backend.

```
Browser button click
  → window.location.href = 'ygoexclusives://process-photos'
  → Windows registry (HKCU:\SOFTWARE\Classes\ygoexclusives)
  → launches launch-push.bat with the URI as %1
  → bat dispatches on URI path → runs correct .ps1
  → PowerShell window opens, user sees live output
```

**Register once per machine (run as Administrator):**
```
.\backups\register-uri-scheme.ps1
```
This writes the registry entry pointing to `launch-push.bat`. Must be re-run if `launch-push.bat` is moved.

**Why this approach:**
- App is a static HTML/JS file served locally — no Node, no backend
- Netlify functions can't run PowerShell
- URI scheme is the standard Windows pattern for browser→local-app communication (same as VS Code, Spotify, Zoom links)
- PowerShell stays open (`-NoExit`) so user can review output

**Limitations:**
- Output only visible in PowerShell window, not in the app
- Windows only (works fine since this is a single-machine owner app)
- URI scheme must be registered once per machine

---

## UI Pattern: Workflow Pipeline Strip

For multi-step sequential workflows, a horizontal pipeline communicates the flow better than separate buttons scattered around the header.

```html
<div style="display:flex;align-items:stretch;gap:0;border:1px solid var(--b1);border-radius:8px;overflow:hidden">
  <!-- Each step -->
  <div style="flex:1;padding:12px 16px;background:var(--surf);border-right:1px solid var(--b1)">
    <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase">Step 1 — Label</div>
    <div style="font-size:0.8rem;color:var(--txt);margin-bottom:10px">Description of what happens.</div>
    <button>Action</button>
  </div>
  <!-- Arrow divider -->
  <div style="display:flex;align-items:center;padding:0 10px;color:var(--muted)">→</div>
  <!-- Next step... -->
</div>
```

Works well when:
- Steps must happen in order
- Each step has a clear trigger
- User needs to understand what they're doing before clicking
- The last step already existed elsewhere and can be unified here

---

## Pending / Future

- **Log viewer in app**: scripts already write CSV logs to `Card Photos/_logs/`. A "View Last Run" button could read the most recent log file and display inline. Deferred — not needed while it's a single-operator workflow.
- **Incoming photo count**: could show a live badge on the Process Photos button showing how many files are waiting in `Incoming/`. Would need a Netlify function or local file-system access (neither straightforward in a static app).

---

## Quick Reference — URI Scheme Actions

| URI | Script |
|-----|--------|
| `ygoexclusives://process-photos` | `backups/process-photos.ps1` |
| `ygoexclusives://build-queue` | `backups/build-listing-queue.ps1` |
| `ygoexclusives://push` | `backups/push-to-ebay.ps1` (all priced pending) |
| `ygoexclusives://push/CARD-EN001` | `backups/push-to-ebay.ps1 -CardNumber CARD-EN001` |
