/** Read-only Shopify connectivity probe. No inventory writes or persistence. */
const apiVersion = "2026-07";
const cacheMs = 60_000;
let cached: { at: number; value: { shopifyConnected: boolean; shopifyStoreName: string | null } } | undefined;
let pending: Promise<{ shopifyConnected: boolean; shopifyStoreName: string | null }> | undefined;

async function checkShopify(): Promise<{ shopifyConnected: boolean; shopifyStoreName: string | null }> {
  const shop = process.env.SHOPIFY_SHOP?.trim().replace(/^https?:\/\//i, "").replace(/\.myshopify\.com\/?$/i, "").replace(/\/$/, "");
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const disconnected = { shopifyConnected: false, shopifyStoreName: null };
  if (!shop || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(shop) || !clientId || !clientSecret) return disconnected;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const auth = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
        signal: controller.signal,
      });
      if (!auth.ok) return disconnected;
      const authData: unknown = await auth.json();
      const token = (authData as { access_token?: unknown } | null)?.access_token;
      if (typeof token !== "string" || !token) return disconnected;

      const graphql = await fetch(`https://${shop}.myshopify.com/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query: "query TSHShopConnectivity { shop { name } }" }),
        signal: controller.signal,
      });
      if (!graphql.ok) return disconnected;
      const data: unknown = await graphql.json();
      const result = data as { data?: { shop?: { name?: unknown } }; errors?: unknown } | null;
      if (result?.errors || typeof result?.data?.shop?.name !== "string") return disconnected;
      return { shopifyConnected: true, shopifyStoreName: result.data.shop.name };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Do not log credentials, tokens, or potentially sensitive API responses.
    return disconnected;
  }
}

export async function shopifyConnectivity() {
  if (cached && Date.now() - cached.at < cacheMs) return cached.value;
  if (!pending) {
    pending = checkShopify().then((value) => {
      cached = { at: Date.now(), value };
      return value;
    }).finally(() => { pending = undefined; });
  }
  return pending;
}
