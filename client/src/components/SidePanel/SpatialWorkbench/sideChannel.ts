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
 * Wrap a fetch init with the auth the side-channel needs. In RELAY (proxy) mode
 * the fetch goes through the LibreChat backend, whose route is `requireJwtAuth`
 * (Bearer, `ExtractJwt.fromAuthHeaderAsBearerToken`); a raw `fetch` sends no
 * Authorization header, so the proxy 401s and no geometry loads. Add the Bearer
 * token here. In DIRECT mode (`truss_gltf_direct`) the loopback side-channel
 * needs no auth, so leave the request untouched (and never send a cross-origin
 * Authorization header, which would force a CORS preflight the side-channel
 * doesn't answer).
 */
export function sideChannelInit(token?: string, init: RequestInit = {}): RequestInit {
  try {
    if (window.localStorage.getItem('truss_gltf_direct')) {
      return init;
    }
  } catch {
    /* localStorage unavailable: treat as proxy mode */
  }
  if (!token) {
    return init;
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}
