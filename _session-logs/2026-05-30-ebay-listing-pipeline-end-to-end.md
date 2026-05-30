# 2026-05-30 — eBay Listing Pipeline End-to-End

## The Goal

Build a fully automated pipeline to push Yu-Gi-Oh card listings from our local app to eBay.ca:
photo folder on disk → listing_queue in Supabase → click "Push to eBay" in the app → card live on eBay with all the right item specifics, business policies, shipping, and condition descriptors → status synced back to Collection tab.

What we ended up building works, but getting there required pivoting once and bashing our heads against eBay's quirks for ~30 iterations. This log exists so the next person doing this (or future me) skips the worst of it.

---

## TL;DR — What Actually Works

- **Pipeline:** Photos in `Card Photos\Cards Processed` → `build-listing-queue.ps1` matches each folder to a card_inventory row, inserts a `listing_queue` row, moves the folder to `Cards Listed`. App's List Queue tab shows the queue, lets you set price/edition/quantity, click "Push to eBay" per row.
- **Per-row button** fires `ygoexclusives://push/{cardNumber}` URI scheme → Windows launches PowerShell → `push-to-ebay.ps1 -CardNumber {x}` → photo uploaded to eBay EPS → inventory item created → offer created → offer published → Supabase updated → Collection tab shows status.
- **API used:** Sell Inventory API (REST, OAuth Bearer). NOT Trading API AddItem (it cannot handle category 183454's required Card Condition aspect).
- **eBay account type:** Business Policies enabled. We use SellerProfiles (shipping/return/payment IDs) instead of inline shipping XML.
- **Category 183454** (CCG Individual Cards) requires `conditionDescriptors` with numeric IDs, not the standard aspects-only approach.

---

## Story / Iteration Log

### Phase 1 — Trading API attempt (failed after ~25 iterations)

Started with the eBay Trading API (`AddItem` XML call) because it was older, simpler-looking, and accepts the old Auth'n'Auth token. Hit error after error:

1. **`invalid_grant`** — OAuth refresh token mismatched the App ID. Fix: regenerate token via developer.ebay.com's "Get a User Token" → click the actual **Sign in to Production for OAuth** button (don't just view the cached token on the page, which is what bit us for 30 min).
2. **`invalid_scope`** — `sell.item` scope wasn't approved on our app. Pivoted to using the **Auth'n'Auth token** directly in the `<eBayAuthToken>` XML field — bypasses OAuth scope approval entirely.
3. **Shipping XML rejected** — `CA_LetterMail` / `CA_RegularParcel` aren't valid eBay.ca service codes. Tried `CA_PostLettermail`, `CA_PostRegularParcel`, `USPSFirstClass` (US-domestic, wrong), `CA_PostInternationalLetterPost`. Each fix produced a new error.
4. **`Seller has opted into business policies`** — Ryan's eBay account uses Business Policies, so we can't send inline `<ShippingDetails>`. Replaced with `<SellerProfiles>` referencing policy IDs. Got policy IDs from `bizpolicies.ebay.ca` URLs.
5. **`No <Item.Location>`** — added `<Location>Guelph, ON</Location>` and `<PostalCode>N1H 3L6</PostalCode>`.
6. **`Condition information 3000 is not valid for category 183454`** — turned out 3000 (Used) is invalid for trading cards. Valid IDs: 2750 (Graded), 4000 (Ungraded). Set `<ConditionID>4000</ConditionID>`.
7. **`Package weight is not valid or is missing`** + dimensions — added `<ShippingPackageDetails>` with weight (10g) and #00 bubble mailer dimensions.
8. **`Invalid shipping package`** — `BubbleMailer`, `Letter`, `PackageThickEnvelope` all rejected. `SmallCanadaPostBubbleMailer` accepted.
9. **`Professional Grader (27501) is a required field`** + `Grade (27502)` — added them as item specifics with `Not Graded` / `Ungraded`. Cleared.
10. **`Card Condition (40001) is a required field`** — sent `Card Condition: Near Mint or Better`. The Browse API showed our inventory item HAS this aspect saved correctly. eBay still rejected the publish.

**This is where we got stuck.** The Trading API's `AddItem` is a legacy code path that doesn't know how to send the `Card Condition (40001)` condition descriptor introduced for trading cards in 2023. It accepts the aspect and stores it but doesn't bind it to the descriptor required for publishing.

**Pivot decision:** Switch from Trading API to the modern **Sell Inventory API (REST)**.

### Phase 2 — Sell Inventory API (success after 6 iterations)

Required steps to migrate:

1. **OAuth refresh token with sell.inventory scope** — used the OAuth authorize URL with `scope=...sell.inventory ...sell.account ...sell.marketing`. The scope was already approved on the app (we discovered this only by trying — it had quietly been auto-approved). Got the code from the redirect URL, exchanged it for a refresh token via `grant_type=authorization_code`.
2. **Discovered payment policy ID** via `GET /sell/account/v1/payment_policy?marketplace_id=EBAY_CA` (managed payments = `290714483014`).
3. **Created merchant location** "YGOE_GUELPH" via `POST /sell/inventory/v1/location/{key}` with Guelph address. The script auto-creates it on first run if missing.
4. **Per-card flow:**
   - `Upload-PhotoToEPS` — kept the Trading API EPS call (it still works fine and Sell Inventory accepts EPS URLs in `imageUrls`).
   - `PUT /sell/inventory/v1/inventory_item/{sku}` — body with `product.title`, `product.description`, `product.aspects`, `product.imageUrls`, `condition`, `conditionDescriptors`, `availability.shipToLocationAvailability.quantity`, `packageWeightAndSize`.
   - `POST /sell/inventory/v1/offer` — body with `sku`, `marketplaceId: EBAY_CA`, `format: FIXED_PRICE`, `categoryId: 183454`, `listingPolicies` (3 policy IDs), `pricingSummary`, `merchantLocationKey`.
   - `POST /sell/inventory/v1/offer/{offerId}/publish` — returns `listingId`.
5. **Cleanup logic:** If a prior run created an offer but failed to publish, the next attempt got `Offer entity already exists`. Fix: before creating, GET offers by SKU and DELETE any orphans.

**The condition descriptor sequence (the actual hard part):**

- `condition: "USED_VERY_GOOD"` → maps to ConditionID 4000 (Ungraded) for category 183454. (Other categories: this enum maps to 4000 = "Very Good".)
- `conditionDescriptors: [{ name: "40001", values: ["400010"] }]` — name is the eBay descriptor ID (40001 = Card Condition), values are the eBay value IDs:
  - **400010** = Near Mint or Better
  - **400011** = Lightly Played (Excellent)
  - **400012** = Moderately Played (Very Good)
  - **400013** = Heavily Played (Poor)

We discovered the IDs by web-searching `eBay condition descriptor 40001 "Near Mint or Better" value ID numeric` — eBay's own docs at developer.ebay.com/api-docs/user-guides/static/mip-user-guide/mip-enum-condition-descriptor-ids-for-trading-cards.html have the full table. The taxonomy API (`get_item_aspects_for_category`) returns the *display names* but NOT the value IDs needed for the write side.

**For graded cards** (future work), the descriptors are:
- Name `27501` = Professional Grader (values are grading company IDs)
- Name `27502` = Grade (values are grade IDs like 10, 9.5, etc.)
- Name `27503` = Certification Number (optional)

---

## Files Touched

### New files
- `backups/push-to-ebay.ps1` — the full pipeline script (Sell Inventory API).
- `backups/push-to-ebay-trading-api.ps1.bak` — the failed Trading API version, kept for reference.
- `backups/build-listing-queue.ps1` — scans `Cards Processed`, matches to inventory, inserts queue rows, moves folders.
- `backups/register-uri-scheme.ps1` — registers `ygoexclusives://` URI scheme in Windows registry. Run once per machine.
- `backups/launch-push.bat` — invoked by the URI scheme. Parses card number from URI (`ygoexclusives://push/TDIL-EN080`) and passes `-CardNumber` to the PS script. Empty card number = push all priced pending.
- `backups/listing-queue-setup.sql` — schema for `listing_queue` table.
- `js/listing-queue.js` — List Queue tab front-end.

### Modified files
- `js/collection.js` — added Status / Listed Price / eBay ID columns.
- `js/db.js` — exposed `listed_price_cad` and `ebay_listing_id` in inventory normalizer.
- `index.html` — added List Queue tab; new Collection columns.
- `js/app.js` — `onTabActivated` hook for List Queue.

### Config additions (`backups/config.json`)
- `ebay_app_id`, `ebay_cert_id`, `ebay_dev_id` — from developer.ebay.com Production keyset.
- `ebay_auth_token` — Auth'n'Auth token (still used for EPS photo upload).
- `ebay_refresh_token` — OAuth refresh token with sell.inventory + sell.account + sell.marketing scopes.
- `ebay_policy_ship_budget` (290714463014), `ebay_policy_ship_premium` (290714469014) — two shipping policies. Script auto-picks budget if price < $40, premium if ≥ $40.
- `ebay_policy_returns` (290714482014).
- `ebay_policy_payment` (290714483014) — eBay Managed Payments.
- `ebay_location_key` (`YGOE_GUELPH`) — merchant location key.
- `ebay_postal_code` (`N1H 3L6`).

### Database changes
- `listing_queue` table — created. Schema includes `qty_inventory` (read-only display) and `qty_list` (editable per-row quantity).
- `card_inventory` — added `listed_price_cad numeric` and `ebay_listing_id text` columns. Set `edition` default to `1st`.

---

## Key Learnings (read this before fighting eBay's APIs)

1. **eBay's Trading API cannot list new trading cards in category 183454.** It accepts the request, stores the aspect, then rejects on publish because it can't bind to the new `conditionDescriptors` requirement. If you're integrating modern eBay categories, **start with the Sell Inventory API (REST), not Trading**.

2. **OAuth scope approval is per-app, per-scope.** Some scopes auto-approve, others need eBay's manual review. Don't assume — try the OAuth authorize URL with the scope, and if you get `invalid_scope` redirect, file for approval. We were lucky `sell.inventory` was auto-approved.

3. **The eBay Developer Portal's "Get a User Token" tool caches the last token.** Looking at the page does NOT generate a new token — you have to click the actual **Sign in to Production for OAuth** button. We wasted ~45 min on a stale token that "looked right" but had been minted against a previous Cert ID.

4. **`get_item_aspects_for_category` is read-only metadata.** It tells you what aspects exist and what display values are valid for *reading*. It does NOT give you the value IDs needed for *writing* condition descriptors. For that you need `get_item_condition_policies` (sell.metadata scope required) or web-search eBay's docs.

5. **Cleanup orphan offers.** If a publish fails after offer creation, the next run gets "Offer entity already exists". Always GET-by-SKU and DELETE any existing offers before POSTing a new one.

6. **Use Business Policies if your account has them enabled.** If your seller account opted into Business Policies you cannot send inline shipping XML — eBay rejects with "Seller has opted into business policies". Use `SellerProfiles` with policy IDs from `bizpolicies.ebay.ca` URLs.

7. **The merchant location is required for offers.** Even if you only ship from one address. Create it once via `POST /sell/inventory/v1/location/{key}` with the address. The script does this lazily.

8. **Title format is hard-capped at 80 chars.** Our builder applies progressive trim: full → no condition → no edition.

9. **EPS (photo hosting) still uses the Trading API.** This is a quirk — the modern Sell Inventory API expects `imageUrls`, but eBay's EPS upload endpoint is still the legacy XML one. That's fine — the EPS URLs work in both APIs.

10. **Sell Inventory error messages are vague.** Error 25001 "Core Inventory Service internal error" can mean *anything*. Always dump the request body to a file when it fails so you can diff against a known-working one.

11. **Don't include aspects that don't apply.** We had `Monster Type: Normal` getting auto-added to a Trap Card listing from YGOPRODeck. eBay didn't outright reject, but it was wrong. Gate monster-only aspects on `cardInfo.type -match 'Monster'`.

12. **ConditionID 4000 (Ungraded) is achieved via `condition: "USED_VERY_GOOD"` in the Sell Inventory API.** This mapping is category-specific and undocumented in the enum table. There is no enum literally called "Ungraded".

---

## What's Not Built Yet

- **Sales sync** — eBay → app. When a card sells, we want it auto-inserted into the `sales` table and the inventory decremented. Plan: GitHub Action polling GetOrders API every X hours, match by `ebay_listing_id`, insert sale row.
- **Graded card listings** — script only handles ungraded. For graded, we'd need to swap the condition enum to `LIKE_NEW` (2750) and send the Professional Grader (27501) + Grade (27502) descriptors.
- **Bulk/calculated shipping for heavier orders** — current policies assume single-card weight. Multi-card combined orders are handled by eBay's combined shipping rules at checkout.
- **The 14 unmatched cards** — 9 WC/WCS World Championship promos not in YGOPRODeck DB, 5 non-standard format card numbers (TP3-006, WC4-001 etc.). Need manual handling or a special-case lookup.

---

## Quick Reference (for the next time)

**To list one card:**
```powershell
cd "D:\CoworkOS\YGO Project\backups"
.\push-to-ebay.ps1 -CardNumber TDIL-EN080
```

**To dry-run (no publish):**
```powershell
.\push-to-ebay.ps1 -CardNumber TDIL-EN080 -DryRun
```

**To push all priced pending:**
```powershell
.\push-to-ebay.ps1
```
Or click the bulk "▶ Push to eBay" button in the app — fires `ygoexclusives://push`.

**To regenerate the OAuth refresh token (when it expires in ~18 months):**
1. Visit the authorize URL with scopes: `sell.inventory sell.account sell.marketing`
2. Sign in with the seller eBay account
3. Copy the redirect URL
4. Run the exchange script (see config rebuild snippet in this session's history)
5. Token gets written into `config.json` automatically

**To create a new card via the pipeline:**
1. Senior helper photographs and Claude-IDs the card → folder ends up in `Card Photos\Cards Processed\`.
2. Ryan runs `.\build-listing-queue.ps1` in the backups dir → matches to inventory, adds to queue, moves folder to `Cards Listed`.
3. Ryan opens the app → List Queue tab → reviews price, sets quantity, sets edition if not 1st.
4. Click "Push to eBay" on that row → PowerShell window pops up → confirm → card listed.
5. Collection tab shows status + eBay link.

---

*Session length: roughly 4 hours of error-chasing followed by a clean Inventory API rewrite. The pivot was the right call. If you find yourself fighting Trading API XML schema errors for a modern category, stop and switch APIs.*
