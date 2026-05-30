// ebay-list.js — Netlify serverless function
// Creates a fixed-price GTC listing on eBay.ca via Trading API
// Fetches item specifics from YGOPRODeck automatically at push time
//
// POST /.netlify/functions/ebay-list
// Body: multipart/form-data
//   queue_id       text  (uuid)
//   inventory_id   text  (uuid)
//   card_number    text
//   card_name      text
//   set_name       text
//   rarity         text
//   condition      text  NM | LP | MP
//   edition        text  1st | unlimited
//   price_cad      text  e.g. "14.99"
//   photo_0        file  (required)
//   photo_1        file  (optional)
//
// Response: { success, ebay_listing_id, listing_url } | { error }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

const EBAY_API_URL   = 'https://api.ebay.com/ws/api.dll';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_SITE_ID   = '2';     // eBay Canada
const EBAY_CURRENCY  = 'CAD';
const EBAY_CATEGORY  = '2536';  // Trading Card Games > Yu-Gi-Oh!
const EBAY_CONDITION = '3000';  // Used

// Envelope dimensions: 13cm x 23cm x 1cm, 10g (Size 00 bubble mailer)
const PKG_LENGTH_IN = '9.1';
const PKG_WIDTH_IN  = '5.1';
const PKG_DEPTH_IN  = '0.5';
const PKG_WEIGHT_OZ = '1';

// ── OAuth token exchange ───────────────────────────────────────────────────────
async function getAccessToken(appId, certId, refreshToken) {
  const creds = Buffer.from(`${appId}:${certId}`).toString('base64');
  const scope = [
    'https://api.ebay.com/oauth/api_scope/sell.item',
    'https://api.ebay.com/oauth/api_scope/sell.item.draft',
  ].join(' ');

  const res  = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&scope=${encodeURIComponent(scope)}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Upload photo to eBay EPS ───────────────────────────────────────────────────
async function uploadPhoto(accessToken, appId, photoBuffer) {
  const boundary = `----------${Date.now()}`;
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${accessToken}</eBayAuthToken></RequesterCredentials>
  <PictureName>ygo-card</PictureName>
</UploadSiteHostedPicturesRequest>`;

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="XML Payload"\r\nContent-Type: text/xml;charset=utf-8\r\n\r\n`),
    Buffer.from(xml),
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="card.jpg"\r\nContent-Type: image/jpeg\r\nContent-Transfer-Encoding: binary\r\n\r\n`),
    photoBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res  = await fetch(EBAY_API_URL, {
    method:  'POST',
    headers: {
      'X-EBAY-API-CALL-NAME':           'UploadSiteHostedPictures',
      'X-EBAY-API-SITEID':              EBAY_SITE_ID,
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-APP-NAME':            appId,
      'Content-Type':                   `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const text  = await res.text();
  const match = text.match(/<FullURL>(https?:\/\/[^<]+)<\/FullURL>/);
  if (!match) throw new Error(`EPS upload failed: ${text.substring(0, 500)}`);
  return match[1];
}

// ── Fetch card specifics from YGOPRODeck ──────────────────────────────────────
async function fetchCardSpecifics(cardName) {
  try {
    const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(cardName)}&misc=yes`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0] || null;
  } catch {
    return null;
  }
}

// ── Build NameValueList item specifics XML ────────────────────────────────────
function buildItemSpecifics(cardInfo, cardName, cardNumber, setName, rarity, edition, condition) {
  const condMap = { NM: 'Near Mint or Better', LP: 'Lightly Played', MP: 'Moderately Played' };
  const edLabel = edition === '1st' ? '1st Edition' : 'Unlimited Edition';

  const specifics = [
    ['Card Name',    cardName],
    ['Set',          setName || ''],
    ['Card Number',  cardNumber],
    ['Rarity',       rarity || ''],
    ['Edition',      edLabel],
    ['Condition',    condMap[condition?.toUpperCase()] || 'Near Mint or Better'],
    ['Language',     'English'],
    ['Game',         'Yu-Gi-Oh!'],
    ['Graded',       'No'],
    ['Country/Region of Manufacture', 'Japan'],
  ];

  if (cardInfo) {
    const type = cardInfo.type || '';
    specifics.push(['Type', type]);

    if (type.toLowerCase().includes('monster')) {
      if (cardInfo.race)      specifics.push(['Monster Type',  cardInfo.race]);
      if (cardInfo.attribute) specifics.push(['Attribute',     cardInfo.attribute]);
      if (cardInfo.level != null && !type.toLowerCase().includes('link')) {
        const levelLabel = type.toLowerCase().includes('xyz') ? 'Rank' : 'Level';
        specifics.push([levelLabel, String(cardInfo.level)]);
      }
      if (cardInfo.linkval != null) specifics.push(['Link Rating', String(cardInfo.linkval)]);
      if (cardInfo.atk != null)     specifics.push(['ATK',         String(cardInfo.atk)]);
      if (cardInfo.def != null)     specifics.push(['DEF',         String(cardInfo.def)]);
    }
  }

  return specifics
    .filter(([, v]) => v)
    .map(([n, v]) => `
    <NameValueList>
      <Name>${escXml(n)}</Name>
      <Value>${escXml(v)}</Value>
    </NameValueList>`)
    .join('');
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Build eBay title (80 char max) ─────────────────────────────────────────────
function buildTitle(cardName, cardNumber, rarity, edition, condition) {
  const edLabel   = edition === '1st' ? '1st Ed' : 'Unlimited';
  const condLabel = (condition || 'NM').toUpperCase();
  const full      = `${cardName} ${cardNumber} ${rarity} ${edLabel} ${condLabel} YuGiOh`;
  return full.length <= 80 ? full : full.slice(0, 80);
}

// ── Build HTML description ────────────────────────────────────────────────────
function buildDescription(cardName, cardNumber, setName, rarity, edition, condition, cardInfo) {
  const edLabel  = edition === '1st' ? '1st Edition' : 'Unlimited Edition';
  const condFull = { NM: 'Near Mint (NM)', LP: 'Lightly Played (LP)', MP: 'Moderately Played (MP)' }[(condition || 'NM').toUpperCase()] || condition;

  let monsterRows = '';
  if (cardInfo && (cardInfo.type || '').toLowerCase().includes('monster')) {
    const lvLabel = (cardInfo.type || '').toLowerCase().includes('xyz') ? 'Rank'
                  : (cardInfo.type || '').toLowerCase().includes('link') ? 'Link Rating'
                  : 'Level';
    const lvVal   = cardInfo.linkval ?? cardInfo.level;
    monsterRows = `
  ${cardInfo.attribute ? `<tr style="background:#f5f0ff"><td style="font-weight:bold;width:140px">Attribute</td><td>${escXml(cardInfo.attribute)}</td></tr>` : ''}
  ${lvVal != null ? `<tr><td style="font-weight:bold">${lvLabel}</td><td>${lvVal}</td></tr>` : ''}
  ${cardInfo.atk != null ? `<tr style="background:#f5f0ff"><td style="font-weight:bold">ATK / DEF</td><td>${cardInfo.atk} / ${cardInfo.def ?? '?'}</td></tr>` : ''}`;
  }

  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1a1a1a">
<h2 style="color:#4a0080;margin-bottom:12px">${escXml(cardName)}</h2>
<table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:14px">
  <tr><td style="font-weight:bold;width:140px">Card Name</td><td>${escXml(cardName)}</td></tr>
  <tr style="background:#f5f0ff"><td style="font-weight:bold">Card Number</td><td>${escXml(cardNumber)}</td></tr>
  <tr><td style="font-weight:bold">Set</td><td>${escXml(setName || '')}</td></tr>
  <tr style="background:#f5f0ff"><td style="font-weight:bold">Rarity</td><td>${escXml(rarity || '')}</td></tr>
  <tr><td style="font-weight:bold">Edition</td><td>${escXml(edLabel)}</td></tr>
  <tr style="background:#f5f0ff"><td style="font-weight:bold">Condition</td><td>${escXml(condFull)}</td></tr>
  <tr><td style="font-weight:bold">Language</td><td>English</td></tr>${monsterRows}
</table>
<br>
<p style="font-size:14px">
  Card ships securely in a <strong>toploader + bubble mailer</strong>.<br>
  <strong>Canadian buyers:</strong> Free letter mail included. Tracked shipping available at checkout.<br>
  <strong>US &amp; international buyers:</strong> Tracked shipping via eBay International Shipping.
</p>
<p style="font-size:14px">Combined shipping available — message us!<br>
Thank you for shopping at <strong>YGOExclusives</strong>!</p>
</div>`;

  return `<![CDATA[${html}]]>`;
}

// ── Build AddItem XML ─────────────────────────────────────────────────────────
function buildAddItemXml(accessToken, appId, params) {
  const { title, description, priceCad, pictureUrls, itemSpecifics } = params;

  return `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${accessToken}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>${escXml(title)}</Title>
    <Description>${description}</Description>
    <PrimaryCategory>
      <CategoryID>${EBAY_CATEGORY}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="${EBAY_CURRENCY}">${Number(priceCad).toFixed(2)}</StartPrice>
    <ConditionID>${EBAY_CONDITION}</ConditionID>
    <Country>CA</Country>
    <Currency>${EBAY_CURRENCY}</Currency>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <Quantity>1</Quantity>
    <PictureDetails>
      ${pictureUrls.map(u => `<PictureURL>${u}</PictureURL>`).join('\n      ')}
    </PictureDetails>
    <ItemSpecifics>
      ${itemSpecifics}
    </ItemSpecifics>
    <ShipToLocations>CA</ShipToLocations>
    <ShipToLocations>US</ShipToLocations>
    <ShipToLocations>Worldwide</ShipToLocations>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <!-- Free letter mail within Canada (untracked) -->
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>CA_LetterMail</ShippingService>
        <FreeShipping>true</FreeShipping>
      </ShippingServiceOptions>
      <!-- Tracked upgrade within Canada -->
      <ShippingServiceOptions>
        <ShippingServicePriority>2</ShippingServicePriority>
        <ShippingService>CA_RegularParcel</ShippingService>
        <ShippingServiceCost currencyID="CAD">0.00</ShippingServiceCost>
      </ShippingServiceOptions>
      <!-- eBay International Shipping handles US + worldwide -->
      <GlobalShipping>true</GlobalShipping>
    </ShippingDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>
  </Item>
</AddItemRequest>`;
}

// ── Parse eBay response ────────────────────────────────────────────────────────
function parseListingId(xml) {
  const m = xml.match(/<ItemID>(\d+)<\/ItemID>/);
  return m ? m[1] : null;
}

function parseErrors(xml) {
  const errors = [];
  const re = /<ShortMessage>([^<]+)<\/ShortMessage>/g;
  let m;
  while ((m = re.exec(xml)) !== null) errors.push(m[1]);
  return errors;
}

// ── Parse multipart/form-data body ────────────────────────────────────────────
function parseMultipart(body, boundary, isBase64Encoded) {
  const buf  = isBase64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'binary');
  const sep  = Buffer.from(`--${boundary}`);
  const parts = {};
  let pos = 0;

  while (pos < buf.length) {
    const start = bufFind(buf, sep, pos);
    if (start === -1) break;
    pos = start + sep.length;
    if (buf[pos] === 45 && buf[pos + 1] === 45) break;
    if (buf[pos] === 13) pos += 2;

    const hEnd = bufFind(buf, Buffer.from('\r\n\r\n'), pos);
    if (hEnd === -1) break;
    const headers = buf.slice(pos, hEnd).toString('utf8');
    pos = hEnd + 4;

    const next    = bufFind(buf, sep, pos);
    const dataEnd = next === -1 ? buf.length : next - 2;
    const nameM   = headers.match(/name="([^"]+)"/);
    if (!nameM) continue;
    const name = nameM[1];

    if (headers.includes('filename=')) {
      parts[name] = { data: buf.slice(pos, dataEnd), isFile: true };
    } else {
      parts[name] = { value: buf.slice(pos, dataEnd).toString('utf8'), isFile: false };
    }
    pos = next === -1 ? buf.length : next;
  }
  return parts;
}

function bufFind(buf, search, start = 0) {
  for (let i = start; i <= buf.length - search.length; i++) {
    let ok = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

// ── Update Supabase after listing ─────────────────────────────────────────────
async function updateSupabase(supabaseUrl, serviceKey, queueId, inventoryId, listingId) {
  const h = {
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type':  'application/json',
  };
  await fetch(`${supabaseUrl}/rest/v1/listing_queue?id=eq.${queueId}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ status: 'pushed', pushed_at: new Date().toISOString(), ebay_listing_id: listingId }),
  });
  if (inventoryId) {
    await fetch(`${supabaseUrl}/rest/v1/card_inventory?id=eq.${inventoryId}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ listed: true }),
    });
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'POST only' }) };

  const EBAY_APP_ID        = process.env.EBAY_APP_ID;
  const EBAY_CERT_ID       = process.env.EBAY_CERT_ID;
  const EBAY_REFRESH_TOKEN = process.env.EBAY_REFRESH_TOKEN;
  const SUPABASE_URL       = process.env.SUPABASE_URL;
  const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY;

  if (!EBAY_APP_ID || !EBAY_CERT_ID || !EBAY_REFRESH_TOKEN) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'eBay env vars not set in Netlify' }) };
  }

  try {
    const ct = event.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    if (!bm) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'multipart/form-data required' }) };

    const parts = parseMultipart(event.body, bm[1].trim(), event.isBase64Encoded);

    const cardNumber  = parts.card_number?.value  || '';
    const cardName    = parts.card_name?.value    || '';
    const setName     = parts.set_name?.value     || '';
    const rarity      = parts.rarity?.value       || '';
    const condition   = parts.condition?.value    || 'NM';
    const edition     = parts.edition?.value      || 'unlimited';
    const priceCad    = parseFloat(parts.price_cad?.value || '0');
    const inventoryId = parts.inventory_id?.value || '';
    const queueId     = parts.queue_id?.value     || '';

    if (!cardNumber || !cardName || priceCad <= 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'card_number, card_name, price_cad required' }) };
    }

    // Fetch card specifics from YGOPRODeck and get access token in parallel
    const [accessToken, cardInfo] = await Promise.all([
      getAccessToken(EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN),
      fetchCardSpecifics(cardName),
    ]);

    // Upload photos
    const pictureUrls = [];
    for (const key of ['photo_0', 'photo_1']) {
      if (parts[key]?.isFile && parts[key].data.length > 0) {
        const url = await uploadPhoto(accessToken, EBAY_APP_ID, parts[key].data);
        pictureUrls.push(url);
      }
    }
    if (pictureUrls.length === 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'At least one photo required' }) };
    }

    // Build listing
    const title        = buildTitle(cardName, cardNumber, rarity, edition, condition);
    const description  = buildDescription(cardName, cardNumber, setName, rarity, edition, condition, cardInfo);
    const itemSpecifics = buildItemSpecifics(cardInfo, cardName, cardNumber, setName, rarity, edition, condition);
    const xml          = buildAddItemXml(accessToken, EBAY_APP_ID, { title, description, priceCad, pictureUrls, itemSpecifics });

    const ebayRes  = await fetch(EBAY_API_URL, {
      method:  'POST',
      headers: {
        'X-EBAY-API-CALL-NAME':           'AddItem',
        'X-EBAY-API-SITEID':              EBAY_SITE_ID,
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
        'X-EBAY-API-APP-NAME':            EBAY_APP_ID,
        'Content-Type':                   'text/xml',
      },
      body: xml,
    });

    const responseText = await ebayRes.text();
    const listingId    = parseListingId(responseText);
    const errors       = parseErrors(responseText);

    if (!listingId) {
      return {
        statusCode: 422, headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'eBay rejected listing', details: errors, raw: responseText.substring(0, 1000) }),
      };
    }

    if (SUPABASE_URL && SUPABASE_KEY && queueId) {
      await updateSupabase(SUPABASE_URL, SUPABASE_KEY, queueId, inventoryId, listingId);
    }

    return {
      statusCode: 200, headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        ebay_listing_id: listingId,
        listing_url: `https://www.ebay.ca/itm/${listingId}`,
        title,
        card_type: cardInfo?.type || null,
        warnings: errors.length > 0 ? errors : undefined,
      }),
    };

  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
