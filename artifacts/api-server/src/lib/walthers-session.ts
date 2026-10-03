const ORIGIN = "https://dealers.walthers.com";

/** Short-lived, server-only session. Credentials and cookies are never logged. */
export async function createWalthersSession() {
  const email = process.env.WALTHERS_EMAIL;
  const password = process.env.WALTHERS_PASSWORD;
  if (!email || !password) throw new Error("Walthers dealer credentials are not configured");
  const cookies = new Map<string, string>();

  async function request(path: string, options: RequestInit = {}, redirects = 0): Promise<Response> {
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || redirects > 5) throw new Error("Unexpected Walthers portal redirect");
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(url, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      headers: {
        "X-SC-Touchpoint": "checkout",
        "X-Requested-With": "XMLHttpRequest",
        Origin: ORIGIN,
        Referer: `${ORIGIN}/scs/checkout.ssp`,
        Accept: "application/json, text/javascript, */*; q=0.01",
        ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
        ...options.headers,
      },
        });
      } catch (error) {
        if (options.method === "POST" || attempt === 2) {
          throw new Error("Walthers portal network request failed; please retry", { cause: error });
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
        continue;
      }
      if (options.method !== "POST" && [429, 502, 503, 504].includes(response.status) && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1_000 : 2_000 * (attempt + 1)));
        continue;
      }
      break;
    }
    if (!response) throw new Error("Walthers portal network request failed");
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      // Never forward a login body across a redirect.
      if (options.method === "POST") throw new Error("Unexpected Walthers login redirect");
      const location = response.headers.get("location");
      if (!location) throw new Error("Walthers redirect is missing its location");
      await response.body?.cancel();
      return request(new URL(location, url).href, options, redirects + 1);
    }
    return response;
  }

  // SuiteCommerce requires a storefront/checkout session before login; calling
  // the login service without those cookies returns ERR_INVALID_ORIGIN.
  for (const path of ["/", "/scs/checkout.ssp"]) {
    const response = await request(path);
    if (!response.ok) throw new Error(`Walthers session initialization returned HTTP ${response.status}`);
    await response.body?.cancel();
  }
  const environmentResponse = await request("/scs/services/CheckoutEnvironment.Service.ss?lang=en_US&cur=USD&X-SC-Touchpoint=checkout");
  if (!environmentResponse.ok) throw new Error(`Walthers configuration returned HTTP ${environmentResponse.status}`);
  const environment = await environmentResponse.json() as {
    ENVIRONMENT?: { siteSettings?: { siteid?: unknown }; baseUrl?: string };
    CONFIGURATION?: unknown;
  };
  const siteId = Number(environment?.ENVIRONMENT?.siteSettings?.siteid);
  if (!Number.isSafeInteger(siteId) || siteId <= 0) throw new Error("Walthers dealer site identifier is unavailable");

  const loginResponse = await request(`/scs/services/Account.Login.Service.ss?n=${siteId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginResponse.ok) throw new Error(`Walthers dealer login returned HTTP ${loginResponse.status}`);
  const login = await loginResponse.json() as { user?: { isLoggedIn?: string; isGuest?: string } };
  if (login?.user?.isLoggedIn !== "T" || login?.user?.isGuest === "T") {
    // Do not include the upstream response: it can contain private account data.
    throw new Error("Walthers dealer login failed; verify the saved dealer credentials");
  }

  function serviceUrl(path: string, suiteScript2 = false) {
    const template = environment?.ENVIRONMENT?.baseUrl;
    if (typeof template !== "string" || !template.includes("/{{file}}")) {
      throw new Error("Walthers service configuration is unavailable");
    }
    return suiteScript2 ? template.replace("/{{file}}", `_ss2/${path}`) : template.replace("{{file}}", path);
  }

  return { siteId, serviceUrl, get: (path: string) => request(path), configuration: environment.CONFIGURATION };
}