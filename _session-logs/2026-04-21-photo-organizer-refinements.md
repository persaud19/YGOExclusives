# Session Log: 2026-04-21 — Photo Organizer Script Refinements

**Focus**: Hardening process-photos.ps1 for production use
**Status**: Script functionally solid, ready for full batch testing
**Key file**: `D:\CoworkOS\YGO Project\backups\process-photos.ps1`

---

## Session Summary

Extended debugging and refinement of the card photo organizer script. Started from a working but inaccurate base and iterated through multiple issues until reaching a reliable state.

---

## Issues Encountered & Fixed (in order)

### 1. Claude returning wrong card number (DPLS-EN053 vs TDIL-EN085)
**Root cause**: Claude Vision (haiku-4-5) too weak for small-text OCR on busy card images  
**Fix attempt 1**: Added YGOPRODeck `cardsetsinfo.php` validation → broke everything (endpoint unreliable, all cards returned HALLUCINATED)  
**Fix attempt 2**: Replaced with set prefix validation from `cardsets.php` → still all HALLUCINATED  
**Root fix**: Upgraded model to `claude-sonnet-4-5` + simplified approach

### 2. Claude returning full reasoning instead of formatted answer
**Symptom**: Responses like "INEEDTOCAREFULLYREADTHECARDNAME..." (wall of text)  
**Root cause**: Model ignoring output format instructions  
**Fix**: Added `system` parameter to API call forcing single-line output; shorter, more direct prompt; regex fallback to scan verbose responses for valid set code pattern

### 3. UTF-8 encoding error ("surrogates not allowed")
**Root cause**: Em dash `—` characters in here-string prompt encoded incorrectly by Windows code page  
**Fix**: Replaced `@'...'@` here-strings with ASCII-only string concatenation; explicitly encode request body as UTF-8 bytes: `[System.Text.Encoding]::UTF8.GetBytes($body)`

### 4. Holographic/foil cards classified as DETAIL instead of FRONT
**Example**: "The Hidden City" (TDIL-EN085) routed to wrong folder because Claude couldn't read through the foil glare  
**Fix**: Added third response type `CARDNAME|UNKNOWN` (front visible but set code unreadable) → routes to `_unmatched` instead of grouping with previous card  
**Routing logic**:
- `CARDNAME|SETCODE` → FRONT folder
- `CARDNAME|UNKNOWN` → `_unmatched` (manual review)
- `DETAIL` → group with previous card (back/edge shot)

### 5. Set code location — wrong crop region
**First attempt**: Cropped bottom 45% of image → wrong, set code isn't at the bottom  
**Correction**: Set code sits just BELOW the artwork frame, ABOVE the text box, on the RIGHT side — roughly middle-right of the card  
**Final crop**: 55-100% width, 52-78% height (26% vertical band in the middle-right)

### 6. Format validation too permissive (GLD96-EN076 hallucination)
**Root cause**: Old regex `'^[A-Z0-9]{2,6}-...'` allowed numbers in prefix  
**Fix**: New regex `'^([A-Z]{4}|[A-Z]{3}[0-9]?|[A-Z]{2}[0-9]{0,2})-EN[0-9]{3}$'`  
**Rules encoded**:
- 4 letters: TDIL, BLMM, CYHO ✅
- 3 letters + optional 1 digit: TDG, LOB, GLD5 ✅
- 2 letters + up to 2 digits: RA01, RA02 ✅ (Ra Yellow Mega Pack — already in inventory)
- GLD96 (3 letters + 2 digits) → rejected ❌

---

## Final Script Architecture

### Two-image API call per photo
```
Image 1: Full card (orientation corrected)
          → Claude uses for front/back detection + card name
Image 2: Cropped bottom-right band (55-100% width, 52-78% height)
          → Claude uses for set code reading only
```
Single API call, two images, best of both.

### Three-level routing
```
Test-CardNum passes  → FRONT  → "TDIL-EN085 - The Hidden City\" folder
vision == UNKNOWN    → UNREADABLE → _unmatched\ (front seen, code unreadable)
vision == DETAIL     → group with previous card (back/edge/texture)
else                 → UNMATCHED → _unmatched\
```

### Pre-rotation pass
Before scanning, all images in Incoming are physically rotated based on EXIF and saved back to disk with orientation tag reset to 1. Files moved to Cards Processed and _unmatched are always correctly oriented.

### Folder naming
`TDIL-EN085 - The Hidden City` (Card Number - Title Case Card Name)

### Response parsing fallback chain
1. Check for `DETAIL` → return DETAIL
2. Check for `|` separator → parse CARDNAME|SETCODE or CARDNAME|UNKNOWN
3. Try full response as bare set code
4. Regex scan anywhere in response for valid set code pattern
5. Return raw string (will fail Test-CardNum → UNMATCHED)

---

## Key Constants (tunable at top of script)

```powershell
$CROP_X1 = 0.55   # left edge of set code crop (fraction of image width)
$CROP_Y1 = 0.52   # top edge of set code crop (fraction of image height)
$CROP_Y2 = 0.78   # bottom edge of set code crop (fraction of image height)
```

If crop misses set codes on certain cards, nudge these values.

---

## API Details

- **Model**: `claude-sonnet-4-5` (upgraded from haiku-4-5)
- **Cost**: ~$0.003-0.005/photo (two images per call)
- **max_tokens**: 60
- **System prompt**: "Output one line only: CARDNAME|SETCODE, CARDNAME|UNKNOWN, or DETAIL. No explanations."
- **Encoding**: Body explicitly encoded as UTF-8 bytes before sending

---

## Folder Structure

```
D:\Card Photos\
├── Incoming\                    ← drop photos here
├── Cards Processed\
│   ├── TDIL-EN085 - The Hidden City\
│   ├── TDG-EN070 - Psychic Overload\
│   └── ...
├── Cards Listed\                ← future: after eBay push
├── _unmatched\                  ← manual review
└── _logs\                       ← CSV audit trail per run
```

---

## Usage

```powershell
cd D:\CoworkOS\YGO Project\backups

# Preview (no files moved)
.\process-photos.ps1 -DryRun -Verbose

# Real run
.\process-photos.ps1
```

---

## Pending / Known Limitations

- **Playset photos** (3 copies of same card): handled in prompt, but if cards are spread across frame the crop might not capture the set code of the best-visible copy
- **Non-EN cards** (Japanese, Korean): will UNMATCHED correctly (no EN in code)
- **Crop calibration**: if certain card types still miss, adjust `$CROP_Y1`/`$CROP_Y2`
- **listing_queue table**: must exist in Supabase before running without -DryRun (SQL in CLAUDE.md)
- **Cards Listed workflow**: moving processed cards to Cards Listed after eBay push not yet built

---

## What a Good Run Looks Like

```
[13:00:05] Loading YGOPRODeck set list... (removed - validation simplified)
[13:00:07] Found 11 photo(s) - sorting by EXIF DateTaken...
[13:00:07] Sorted. Pre-rotating images to correct orientation on disk...

[2026-02-13 12:59:25]  20260213_125925.jpg  FRONT  -> TDGS-EN039 - Nitro Warrior Synchro Effect
[2026-02-13 12:59:31]  20260213_125932.jpg  DETAIL -> TDGS-EN039
[2026-02-13 13:00:19]  20260213_130019.jpg  FRONT  -> TDG-EN070 - Psychic Overload
[2026-02-13 13:00:25]  20260213_130025.jpg  UNREADABLE (Psychic Overload) -> _unmatched
[2026-02-13 13:00:30]  20260213_130031.jpg  DETAIL -> TDG-EN070

Cards identified   : 2
Detail shots filed : 2
Unmatched          : 1  <- check _unmatched\
```
