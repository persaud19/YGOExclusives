// ebay-auth-callback.js — Handles eBay OAuth code exchange
// eBay redirects here after user authorizes: ?code=...&expires_in=...
// Returns an HTML page showing the new refresh token.

const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};

  // eBay sends an error if user denied or something went wrong
  if (params.error) {
    return html(`
      <h1 style="color:#e04848">Authorization Failed</h1>
      <p><strong>${params.error}</strong>: ${params.error_description || ''}</p>
      <a href="/ebay-auth.html">← Try again</a>
    `);
  }

  const code = params.code;
  if (!code) {
    return html(`
      <h1 style="color:#e04848">No code received</h1>
      <p>eBay didn't return an authorization code. Go back and try again.</p>
      <a href="/ebay-auth.html">← Try again</a>
    `);
  }

  const appId    = process.env.EBAY_APP_ID;
  const certId   = process.env.EBAY_CERT_ID;
  const ruName   = process.env.EBAY_RU_NAME;

  if (!appId || !certId || !ruName) {
    return html(`
      <h1 style="color:#e04848">Missing env vars</h1>
      <p>Need EBAY_APP_ID, EBAY_CERT_ID, and EBAY_RU_NAME in Netlify.</p>
    `);
  }

  try {
    const creds = Buffer.from(`${appId}:${certId}`).toString('base64');
    const callbackUrl = `https://ygoexclusives.netlify.app/.netlify/functions/ebay-auth-callback`;

    const res = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${creds}`,
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code:         code,
        redirect_uri: ruName,
      }).toString(),
    });

    const data = await res.json();

    if (!data.refresh_token) {
      return html(`
        <h1 style="color:#e04848">Token exchange failed</h1>
        <pre style="background:#1a1a2e;padding:16px;border-radius:8px;overflow:auto">${JSON.stringify(data, null, 2)}</pre>
        <a href="/ebay-auth.html">← Try again</a>
      `);
    }

    return html(`
      <h1 style="color:#3db87a">✓ Authorization Successful</h1>
      <p>Copy your new refresh token and paste it into Netlify as <code>EBAY_REFRESH_TOKEN</code>, then redeploy.</p>

      <div style="margin:24px 0">
        <label style="display:block;font-size:0.8rem;color:#6868a0;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.06em">New Refresh Token</label>
        <div style="display:flex;gap:8px;align-items:stretch">
          <textarea id="token-val" rows="3" readonly style="flex:1;background:#0d0d1e;border:1px solid #2e2e55;border-radius:8px;padding:12px;color:#e0e0f0;font-family:monospace;font-size:0.85rem;resize:none">${data.refresh_token}</textarea>
          <button onclick="copyToken()" style="background:#c8950c;border:none;border-radius:8px;padding:0 20px;color:#000;font-weight:600;cursor:pointer;white-space:nowrap">Copy</button>
        </div>
      </div>

      <div style="background:#131328;border-radius:8px;padding:16px;margin-bottom:24px;font-size:0.85rem">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="color:#6868a0">Scopes granted</span>
          <span style="color:#e0e0f0;max-width:60%;text-align:right;font-size:0.75rem">${(data.scope || '').replace(/ /g,'<br>')}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:#6868a0">Refresh token expires</span>
          <span style="color:#e0e0f0">${data.refresh_token_expires_in ? Math.round(data.refresh_token_expires_in / 86400) + ' days' : '—'}</span>
        </div>
      </div>

      <p style="color:#6868a0;font-size:0.85rem">Once you update the Netlify env var and redeploy, delete this page or restrict access to it.</p>

      <script>
        function copyToken() {
          const el = document.getElementById('token-val');
          el.select();
          document.execCommand('copy');
          event.target.textContent = 'Copied!';
          setTimeout(() => event.target.textContent = 'Copy', 2000);
        }
      </script>
    `);
  } catch (err) {
    return html(`
      <h1 style="color:#e04848">Error</h1>
      <p>${err.message}</p>
      <a href="/ebay-auth.html">← Try again</a>
    `);
  }
};

function html(body) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>eBay Auth — YGOExclusives</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #070710; color: #e0e0f0; font-family: 'DM Sans', system-ui, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #0d0d1e; border: 1px solid #2e2e55; border-radius: 16px; padding: 36px; max-width: 600px; width: 100%; }
    h1 { font-size: 1.4rem; margin-bottom: 16px; }
    p { color: #a0a0c0; line-height: 1.6; margin-bottom: 12px; }
    a { color: #60a0f0; }
    code { background: #1e1e40; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; }
    pre { color: #a0a0c0; font-size: 0.8rem; }
  </style>
</head>
<body><div class="card">${body}</div></body>
</html>`,
  };
}
