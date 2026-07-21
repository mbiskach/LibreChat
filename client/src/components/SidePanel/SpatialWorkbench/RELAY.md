# Spatial Workbench — side-channel relay

The workbench renders geometry (glTF) and drives edit verbs from a **truss** MCP
server's HTTP "side-channel". In the cloud that side-channel is a **loopback-only**
server on the host; the browser reaches it through an **authenticated, same-origin
reverse proxy** in this backend — it never touches `127.0.0.1` directly.

Full contract: truss repo `docs/mcp_relay.md`.

## What lives where (this fork)

- **`packages/api/src/mcp/connection.ts`** — at stdio spawn, for servers in
  `SIDE_CHANNEL_STDIO_SERVERS` (`{'truss'}`), allocate a free `127.0.0.1` port,
  store it on `MCPConnection.sideChannelPort`, and inject `TRUSS_GLTF_PORT=<port>`
  + `TRUSS_GLTF_BASE_URL=/api/mcp/truss/side` into the child env. One port per user.
- **`api/server/routes/mcp.js`** — `proxySideChannel`, registered on
  `GET`/`POST /api/mcp/:serverName/side/*`. `requireJwtAuth` + `checkMCPUsePermissions`
  (truss is a config-file server, no DB row, so `canAccessMCPServerResource` would
  404 — this is the config-server auth pattern). Target resolution has two modes:
  **production** — the port comes from the authenticated user's OWN connection
  (`getUserConnections(userId).get(serverName).sideChannelPort`), loopback, per-user
  isolated; **bench/dev** — if `TRUSS_SIDE_CHANNEL_PORT` (+ optional
  `TRUSS_SIDE_CHANNEL_HOST`, e.g. `host.docker.internal`) is set, the proxy targets
  that instead (a single shared truss on the host — no per-user stdio port). Env
  mode is opt-in, so production keeps the per-user path. Streams GET, re-serializes
  POST bodies. `503` if no target; port never user-supplied (no SSRF).
- **`sideChannel.ts`** — `sideChannelBase()`: same-origin `/api/mcp/truss/side` by
  default; `localStorage.truss_gltf_direct` → `http://127.0.0.1:<port>` for running
  standalone truss without LibreChat. Used by `WorkbenchToggle.tsx` (the
  `/latest.json` poll) and `WorkbenchPanel.tsx` (`/op`, `/corpus.json`, `/feedback`,
  `/latest.json`). glTF `url`/`findings_url` need no rewrite — with
  `TRUSS_GLTF_BASE_URL` set they arrive as same-origin relative paths.

## Adding another side-channel MCP server

Add its name to `SIDE_CHANNEL_STDIO_SERVERS` (connection.ts) and to the frontend
base (currently hardcoded `truss`). The server must honour `TRUSS_GLTF_PORT` /
`TRUSS_GLTF_BASE_URL` (or an equivalent) — see the truss contract.

## Test checklist

1. Trigger a truss tool call → backend logs `Allocated side-channel port <n>`.
2. Workbench auto-opens; `GET /api/mcp/truss/side/latest.json` → 200, relative
   `url`; glTF downloads through the proxy.
3. Edit-tab mutation → `POST /api/mcp/truss/side/op` → 200 + scene reloads;
   `/corpus.json`, `/feedback`, STEP export.
4. Auth: no-JWT rejected; user B cannot see user A's geometry.
5. `503` before any truss call, recovers after one.
6. A non-truss stdio MCP server still spawns normally (no injected env).
7. `localStorage.truss_gltf_direct=1` against standalone truss → direct mode works.
