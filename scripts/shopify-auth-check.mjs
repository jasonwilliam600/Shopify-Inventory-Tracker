/**
 * Read-only credential-grant validation for a Shopify Dev Dashboard app.
 * Run server-side with Node 18+; does not fetch products or modify inventory.
 * Never logs access tokens, client secrets, or full API error responses.
 */
const id = process.env.SHOPIFY_CLIENT_ID;
const secret = process.env.SHOPIFY_CLIENT_SECRET;
const rawShop = process.env.SHOPIFY_SHOP;

if (!id || !secret || !rawShop) {
  console.error('MISSING_CONFIG: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, or SHOPIFY_SHOP');
  process.exitCode = 1;
} else {
  const shop = rawShop.trim().replace(/^https?:\/\//i, '').replace(/\.myshopify\.com\/?$/i, '').replace(/\/$/, '');
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(shop)) {
    console.error('INVALID_SHOP: Check SHOPIFY_SHOP format');
    process.exitCode = 1;
  } else {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: id,
          client_secret: secret,
        }),
        signal: controller.signal,
      });
      // Intentionally discard response body on failure; some responses may contain sensitive fields.
      if (!response.ok) {
        console.log(`AUTH_FAILED: HTTP ${response.status}`);
        console.log('No store data was read or modified. Confirm the app/store organization pairing and credentials.');
        process.exitCode = 1;
      } else {
        const data = await response.json();
        if (typeof data.access_token !== 'string') {
          console.log('AUTH_FAILED: No token in successful response');
          process.exitCode = 1;
        } else {
          console.log('AUTH_SUCCESS: Shopify issued an access token (not displayed or saved).');
          console.log('No products were queried and no inventory was modified.');
        }
      }
    } catch (err) {
      console.log(err?.name === 'AbortError' ? 'NETWORK_ERROR: Request timed out' : 'NETWORK_ERROR: Shopify authentication request failed');
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  }
}
