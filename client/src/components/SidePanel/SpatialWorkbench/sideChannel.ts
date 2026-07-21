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
