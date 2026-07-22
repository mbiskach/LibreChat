/**
 * Base URL for the truss MCP "side-channel" (geometry + workbench /op verbs).
 *
 * Default: a SAME-ORIGIN relative path that the authenticated LibreChat
 * backend reverse-proxies to the co-located MCP server's loopback HTTP server
 * (see `api/server/routes/mcp.js` → `/:serverName/side/*`). This is what works
 * in cloud, where 127.0.0.1 is unreachable from the browser.
 *
 * Dev escape hatch: set `localStorage.truss_gltf_direct` (any value) to talk to
 * a standalone truss on `http://127.0.0.1:<truss_gltf_port ?? 8714>` directly —
 * for running the workbench against a local truss WITHOUT LibreChat in front.
 */
export function sideChannelBase(): string {
  try {
    if (window.localStorage.getItem('truss_gltf_direct')) {
      const port = window.localStorage.getItem('truss_gltf_port') ?? '8714';
      return `http://127.0.0.1:${port}`;
    }
  } catch {
    /* localStorage unavailable (SSR / privacy mode): fall through to proxy */
  }
  return '/api/mcp/truss/side';
}

/**
 * fetch() a side-channel URL with the right auth.
 *
 * The relay proxy is `requireJwtAuth` (Bearer,
 * `ExtractJwt.fromAuthHeaderAsBearerToken`), so a proxied (same-origin) request
 * MUST carry the JWT or it 401s and no geometry loads. But the Authorization
 * header is attached ONLY for SAME-ORIGIN URLs: a cross-origin absolute URL
 * (e.g. direct `http://127.0.0.1:8714/...`) must not carry it, or the browser
 * fires a CORS preflight the loopback side-channel does not allow. Deciding by
 * the URL's origin (not a mode flag) keeps every combination correct, including
 * a mixed setup where `latest.json` comes via the proxy but its `url` is an
 * absolute direct link.
 */
export function sideChannelFetch(
  url: string,
  token?: string,
  init: RequestInit = {},
): Promise<Response> {
  const sameOrigin =
    url.startsWith('/') ||
    (typeof window !== 'undefined' && url.startsWith(window.location.origin));
  if (token && sameOrigin) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  }
  return fetch(url, init);
}
