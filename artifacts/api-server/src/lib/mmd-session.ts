const ORIGIN = "https://mmdmodels.com";

/** Dealer credentials and session cookies stay on the server. */
export async function createMmdSession() {
  const email = process.env.MMD_EMAIL;
  const password = process.env.MMD_PASSWORD;
  if (!email || !password) throw new Error("MMD/Squadron dealer credentials are not configured");
  const cookies = new Map<string, string>();

  async function request(path: string, options: RequestInit = {}, redirects = 0): Promise<Response> {
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || redirects > 5) throw new Error("Unexpected MMD dealer portal redirect");
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(url, {
      ...options, redirect: "manual", signal: AbortSignal.timeout(60_000),
      headers: {
        Origin: ORIGIN, Referer: `${ORIGIN}/login.php`,
        ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
        ...options.headers,
      },
        });
      } catch {
        if (options.method === "POST" || attempt === 2) throw new Error("MMD portal network request failed; please retry");
        await new Promise(resolve => setTimeout(resolve, 1_000 * (attempt + 1)));
        continue;
      }
      if (options.method !== "POST" && [429, 502, 503, 504].includes(response.status) && attempt < 2) {
        const delay = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, Number.isFinite(delay) && delay > 0 ? Math.min(delay, 60) * 1000 : 2_000 * (attempt + 1)));
        continue;
      }
      break;
    }
    if (!response) throw new Error("MMD portal network request failed");
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("MMD portal redirect is missing its location");
      await response.body?.cancel();
      // Redirect to a GET; never forward the login body or credentials.
      return request(new URL(location, url).href, {}, redirects + 1);
    }
    return response;
  }

  const initial = await request("/login.php");
  if (!initial.ok) throw new Error(`MMD session initialization returned HTTP ${initial.status}`);
  await initial.body?.cancel();
  const login = await request("/login.php?action=check_login", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ login_email: email, login_pass: password }).toString(),
  });
  if (!login.ok) throw new Error(`MMD dealer login returned HTTP ${login.status}`);
  const html = await login.text();
  if (!/action=logout|action&#x3D;logout|action=sign_out/i.test(html)) {
    throw new Error("MMD dealer login could not be verified; check the saved credentials and dealer account access");
  }
  return { get: (path: string, headers?: Record<string, string>) => request(path, { headers }) };
}