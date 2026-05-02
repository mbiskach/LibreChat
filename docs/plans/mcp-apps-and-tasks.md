# Plan: MCP Apps + MCP Tasks Support in LibreChat

**Status:** Draft / scoping document — no code in this PR.
**Owner:** TBD
**Target branch:** `claude/mcp-apps-spec-support-rEi7X`
**Revision:** v3 — fixes protocol bugs (`tasks/result` response meta,
`ui/message` semantics, `displayMode` location, `ui/notifications/initialized`
barrier), reconciles the sandbox CSP plan with the message-driven
`sandbox-resource-ready` flow, and adds the resource-review pipeline, data
boundary rules, authorization-context binding, raw-envelope task persistence,
truthful capability gating, browser support matrix, and explicit scope
exclusions for `input_required` until sampling lands.

## Goal

Bring LibreChat to parity with the official MCP extensions for interactive UIs
(**MCP Apps**, SEP-1865, stable 2026-01-26) and long-running operations
(**MCP Tasks**, 2025-11-25, experimental). Together these enable
server-rendered interactive applications inside the chat surface and reliable
half-hour-plus jobs that survive disconnects.

## Decisions required before coding starts

1. **Strict spec parity vs useful v1 compatibility.** Default: strict parity.
   Same-origin sandbox is documented as a labeled non-parity fallback.
2. **Pinned protocol versions.** Apps `2026-01-26` (stable);
   Tasks `2025-11-25` (experimental). ext-apps types from a pinned package
   release, not `main` (which already exposes draft-era additions like
   `ui/download-file`).
3. **File export approach.** Default: `ui/open-link` to a presigned URL.
   `ui/download-file` is gated behind a separate flag if added later.
4. **Server creation policy and transport allowlist.** Following the early
   2026 stdio-RCE advisory, defaults lean toward denial: who can register
   servers, which transports each role may use, per-user task quotas,
   result-size caps, and resource-ingestion review.
5. **`_meta.ui.domain` policy.** v1 honors the field only when its origin
   matches the configured sandbox origin's scheme/host policy. Otherwise the
   resource is rejected with a host-side error. A future phase may support
   per-resource sub-origins.
6. **Cookie / session model at the sandbox origin.** The sandbox origin runs
   no application authentication. It serves view documents only. All
   authenticated calls go through the postMessage bridge to the host. This
   removes the third-party-cookie problem entirely and the need for CSRF on
   sandbox-origin endpoints (which never receive credentialed writes).
7. **Truthful capability gating.** LibreChat does **not** advertise
   `extensions["io.modelcontextprotocol/ui"]` or `capabilities.tasks` on
   `initialize` until the implementation behind that flag is end-to-end
   functional and passes the interop matrix. Phase 1 negotiates absent
   capabilities; advertisement turns on in Phases 2 and 5 respectively.
8. **`input_required` scope for v1.** Tasks reaching `input_required`
   require elicitation/sampling, which is not implemented in LibreChat
   today. v1 supports `working` → `completed`/`failed`/`cancelled` only.
   The host advertises `tasks` *without* `input_required` support and
   rejects task augmentation for tools whose server signals it requires
   input. A separate work item adds elicitation/sampling and lifts that
   gate.

## Background

### MCP Apps (extension `io.modelcontextprotocol/ui`)

- Servers expose HTML resources at `ui://...` URIs with MIME
  `text/html;profile=mcp-app`.
- **Tools link to a UI resource via `_meta.ui = { resourceUri, visibility }`
  on the tool definition. This is the source of truth — UI resources may be
  omitted from `resources/list`, so the host must discover them through tool
  metadata and fetch them via `resources/read`.** Plain text fallback when
  Apps are unavailable is mandatory.
- Resource `_meta.ui` (returned by `resources/read`, **not** the tool
  definition) carries CSP (`connectDomains`, `resourceDomains`,
  `frameDomains`, `baseUriDomains`), iframe `permissions`, sandbox `domain`,
  and `prefersBorder`.
- **Web-host sandbox flow** (mandatory for parity):
  1. Host renders a sandbox-proxy iframe served from the **sandbox origin**
     (different from the host origin).
  2. Proxy emits `ui/notifications/sandbox-proxy-ready`.
  3. Host responds with `ui/notifications/sandbox-resource-ready` carrying
     `{ html, sandbox, csp, permissions }`.
  4. Proxy renders the view per the document-delivery model (see "Web-host
     architecture" below).
- **Initialization sequence** (host must respect both barriers):
  1. View sends `ui/initialize` request with `appInfo`, `appCapabilities`,
     `protocolVersion`.
  2. Host returns `protocolVersion`, `hostInfo`, `hostCapabilities`,
     `hostContext`.
  3. **View sends `ui/notifications/initialized` notification.**
  4. Only after step 3 may the host send other requests/notifications such
     as `tool-input`.
- **`HostContext` carries** `theme`, CSS variables, `displayMode` (active),
  `availableDisplayModes`, `containerDimensions`, `locale`, `timeZone`,
  `platform`, `deviceCapabilities`, `safeAreaInsets`, and **`toolInfo`** —
  metadata about the tool call that instantiated the view (provenance,
  replay).
- **`HostCapabilities` carries** sandbox grants (actually-grantable
  permissions), modality declarations (e.g. `message`,
  `updateModelContext`), and host-feature flags. **It does *not* carry the
  display mode set** — that's `HostContext.availableDisplayModes`.
- View → Host requests/notifications: `ui/open-link`, `ui/message`,
  `ui/request-display-mode`, `ui/update-model-context`, plus standard MCP
  `tools/call`, `resources/read`, `notifications/message`, `ping`.
  (Draft-era: `ui/download-file`.)
- Host → View: `ui/initialize` (host responds), notifications for
  `tool-input`, `tool-input-partial`, `tool-result`, `tool-cancelled`,
  `host-context-changed`, `size-changed`, plus `ui/resource-teardown`.
- Display modes negotiate via `appCapabilities.displayModes` and
  `hostContext.availableDisplayModes`. Host must not switch to undeclared
  modes; `ui/request-display-mode` returns the actual resulting mode (which
  may decline the request).
- **`ui/message` semantics**: the host adds a message to the conversation
  context with the role specified by the app (typically `user`, but the spec
  permits other roles) and may require user consent before doing so. **This
  is not "inject text into the chat input"** — that mismatch was a v2
  protocol error.
- **`ui/update-model-context` semantics**: each update overwrites the
  previous; the host typically forwards only the last update before the next
  user message. Persistence/restoration of view state across remounts is
  out of MVP scope and is a host product feature.
- **App-only tool visibility** (`visibility: ["app"]`): app-only tools must
  not appear in the agent's tool list, may only be called by views whose
  visibility includes `"app"`, and **cross-server app-tool calls are
  blocked** — a view bound to server A cannot call an app-only tool on
  server B.
- `listChanged` notifications for proxied tools/resources: scope decision in
  this plan is **out of v1**. The host does not advertise `listChanged` on
  app-exposed tools and ignores incoming `listChanged` from servers for the
  app surface (the existing tool-list refresh path covers regular tools).

Reference: <https://github.com/modelcontextprotocol/ext-apps>

### MCP Tasks (capability `tasks`)

- Augments standard requests (most relevantly `tools/call`) with task
  semantics. The server returns immediately with a task handle.
- **Two-level negotiation.** Server advertises
  `capabilities.tasks.requests.tools.call` etc. Each tool independently
  declares `execution.taskSupport` as `forbidden`, `optional`, or
  `required`. Both must be honored.
- **Capability declarations are exhaustive and directional.** A client
  advertises a `tasks.requests.<method>` flag only when it actually supports
  that direction; if absent, peers must not attempt task creation in that
  direction.
- Status lifecycle: `working` → (`input_required` — out of v1 scope) →
  `completed` | `failed` | `cancelled`.
- **Task object** carries `taskId`, `status`, `createdAt`, `lastUpdatedAt`,
  `ttl`, optional `pollInterval`. Receivers may override the requested TTL,
  delete state after TTL expires, and delete cancelled tasks immediately.
  Treat server-supplied values as authoritative.
- Methods: `tasks/get`, `tasks/list`, `tasks/result`, `tasks/cancel`.
- `tasks/result` blocks until terminal state. On Streamable HTTP the client
  may disconnect from the stream and reconnect later; while not actively
  blocking, requestors should poll `tasks/get` at the server's
  `pollInterval`.
- **Related-task metadata rules** (corrected from v2):
  - All requests, notifications, and responses related to a task carry
    `_meta["io.modelcontextprotocol/related-task"] = { taskId }` *except* as
    noted below.
  - `tasks/get`, `tasks/result`, `tasks/cancel` **requests** use the
    `taskId` parameter as source of truth; receivers ignore the meta tag if
    present on those requests.
  - `tasks/get` and `tasks/cancel` **responses** return Task objects that
    already carry `taskId` — meta tag not required.
  - **`tasks/result` *response* MUST carry the meta tag**, because its
    payload is the underlying request's result envelope, which has no
    `taskId` of its own.
- **Result fidelity.** `tasks/result` must return exactly what the
  underlying request would have returned — successful JSON-RPC result *or*
  JSON-RPC error envelope. Tool results with `isError: true` correspond to
  `failed` status. The host must therefore **persist the raw terminal
  envelope verbatim**, not derived columns, to replay it without drift.
- Status notifications are **optional**; clients must not depend on them.
  Rich progress reporting uses the standard `progressToken` mechanism, which
  remains valid for the entire task lifetime.
- Servers may return
  `_meta["io.modelcontextprotocol/model-immediate-response"]` — a
  model-facing string letting the model continue reasoning while the task
  runs. Important for `taskSupport: required` tools.
- **Authorization context binding.** Task access is bound to the
  authorization context that created the task. `tasks/list` must only return
  tasks within that same context. The host stores
  `(userId, oauthSubject, scopeFingerprint)` per task and refuses retrieval
  when the current context doesn't match.
- **Streamable HTTP session affinity.** When the transport assigns
  `MCP-Session-Id`, the client carries it on all subsequent requests and
  also sends `MCP-Protocol-Version`. On HTTP 404 for the session, the
  client starts a new MCP session and treats outstanding taskIds as
  potentially stale — verify via `tasks/get` before assuming continuity.
- `tasks/list` is cursor-paginated and surfaces underlying JSON-RPC errors
  verbatim.

Reference:
<https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks>

## Current state of LibreChat MCP integration

| Area | Status | Location |
|---|---|---|
| MCP client + transports (stdio/WS/SSE/streamable HTTP) | Done | `packages/api/src/mcp/` |
| Tools, resources, prompts | Done (sampling/roots not impl.) | `packages/api/src/mcp/connection.ts` |
| OAuth 2.0 + dynamic client registration + PKCE | Done | `packages/api/src/mcp/oauth/` |
| MCP server management UI | Done | `client/src/components/SidePanel/MCPBuilder/` |
| Sandboxed iframe UI rendering (mcp-ui ad-hoc protocol) | Done | `client/src/components/MCPUIResource/` via `@mcp-ui/client` |
| Tool-result → UI resource extraction | Done | `packages/api/src/mcp/parsers.ts` |
| `\ui{resourceId}` markdown markers + carousel | Done | `client/src/components/MCPUIResource/plugin.ts` |
| Sampling / elicitation | **Missing** | blocks `input_required` |
| MCP Apps capability negotiation (truthfully gated) | Missing | — |
| `_meta.ui.resourceUri`-driven discovery | Missing | — |
| Cross-origin sandbox proxy + per-view document delivery | Missing | new infra surface |
| Full JSON-RPC postMessage bridge with origin validation + `initialized` barrier | Missing | — |
| `ui/initialize` handshake + truthful `hostContext` / `hostCapabilities` | Missing | — |
| App-only tool visibility enforcement (model-list filter, bridge ACL, cross-server block) | Missing | — |
| Resource ingestion + hash review pipeline | Missing | — |
| Per-resource CSP via response headers + `Permissions-Policy` integration | Missing | — |
| Trust UX (sandbox boundary chrome, app-vs-host identity) | Missing | — |
| Streaming `tool-input-partial` | Missing | requires `@librechat/agents` changes |
| MCP Tasks (server + per-tool negotiation, raw-envelope persistence, auth-context binding, session affinity) | Missing | — |
| `progressToken` durable mapping (request → progressToken → taskId → subscribers) | Missing | — |
| `model-immediate-response` runtime behavior | Missing | — |
| Background task UI (running-jobs surface, cursor-paginated) | Missing | — |

## Workspace boundaries (per CLAUDE.md)

- New backend code in **TypeScript** under `/packages/api`.
- DB-shared logic in `/packages/data-schemas`.
- Shared API types/endpoints/data-service in `/packages/data-provider`.
- `/api` (legacy JS) gets thin wrappers only.
- Frontend in `/client/src` consuming `packages/data-provider`.
- All user-facing strings via `useLocalize()` with English keys in
  `client/src/locales/en/translation.json`.

## Capability advertisement and version gating

A single rule, repeated because it's load-bearing: **LibreChat advertises
each capability only after its end-to-end implementation passes the relevant
interop matrix**. Concretely:

- Apps capability (`extensions["io.modelcontextprotocol/ui"]`) turns on at
  the end of Phase 2, gated behind a feature flag and an interop test gate.
- Tasks capability (`capabilities.tasks`) turns on at the end of Phase 5.
  Phase 5 also publishes the per-direction sub-flags exhaustively
  (e.g. `tasks.requests.tools.call`); flags for unimplemented directions are
  omitted.
- Phase 1 changes never set these flags. They build types, scaffolding, and
  the bridge skeleton without false advertisement.
- `hostCapabilities` returned from `ui/initialize` is similarly truthful:
  if `pip` and `fullscreen` aren't shipped yet, `availableDisplayModes`
  in the returned `HostContext` lists only `inline`.

## Web-host architecture

This section reconciles the sandbox flow with header-based CSP. v2 was
incoherent here — a static `proxy.html` cannot attach per-resource CSP
headers to HTML arriving over `postMessage`.

### Two-stage architecture

**Outer:** the host page on the LibreChat origin embeds a single iframe
served from the **sandbox origin** (`MCP_SANDBOX_ORIGIN`, different host).
That iframe is the *sandbox proxy*. It loads a static `proxy.html` shipped
by LibreChat. Its only responsibilities are: emit
`ui/notifications/sandbox-proxy-ready`, receive
`ui/notifications/sandbox-resource-ready`, and create the *inner* iframe.

**Inner:** the inner iframe is the actual view. Its `src` points at a
**dynamic per-view endpoint on the sandbox origin** that returns the view's
HTML *with* the appropriate `Content-Security-Policy` and
`Permissions-Policy` response headers. The endpoint is a thin route on a
small sandbox-origin backend (or an edge worker) whose only job is to
look up a short-lived view token, render the resource HTML the host already
fetched via `resources/read`, and return it with computed headers.

### Per-view document delivery

- When the host receives `sandbox-proxy-ready`, it generates a one-time
  view token bound to `(viewSessionId, resourceUri, csp, permissions, html
  hash)`, stores it on the host backend, and sends
  `sandbox-resource-ready` to the proxy with the token (not the HTML).
- The proxy creates the inner iframe with `src =
  https://<sandbox-origin>/view/<token>`.
- The sandbox-origin endpoint exchanges the token with the host backend
  (server-to-server, mTLS or signed request), gets the HTML and policy
  spec, and returns the document with:
  - `Content-Security-Policy: <built from _meta.ui.csp + defaults>`
  - `Permissions-Policy: <intersection of operator policy and
    _meta.ui.permissions>`
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp` (where the page can
    tolerate it)
  - Cache-Control disabling caching.
- Tokens are single-use, short-TTL, and bound to the proxy iframe's
  `viewSessionId` (the proxy adds it as a sibling header / query param).
  No cookies, no CSRF surface — the endpoint never accepts credentialed
  writes.
- The static-`proxy.html` interim mode (no dynamic endpoint) is documented
  as **non-parity**: it injects HTML via `srcdoc` and a `<meta
  http-equiv="Content-Security-Policy">`, accepting the documented
  meta-tag limitations (no `sandbox` directive, no `frame-ancestors`, no
  `report-uri`) and weaker isolation. It exists for development only.

### `postMessage` bridge

- Two distinct channels: host ↔ proxy and proxy ↔ inner view. The proxy
  forwards allowed messages and does not invent host policy.
- `event.origin` validated against an exact allowlist (no partial / suffix
  match). Sender always specifies an exact target origin (no `*`).
- `event.source` validated against the expected window reference where
  applicable.
- Sandboxed inner iframes may emit `null` origins. The bridge accepts
  `null` only when the source matches the expected proxy-controlled inner
  window reference, never otherwise.
- All inbound messages validated against the JSON-RPC envelope schema
  before dispatch. Schema validation rejects unknown methods and malformed
  payloads with structured logs.
- **Initialization barrier:** the host queues outbound requests until both
  (a) the `ui/initialize` response has been sent, and (b) the view's
  `ui/notifications/initialized` has been received. Premature outbound
  attempts are buffered and flushed on barrier release.

### Cookie / session model

- The sandbox origin runs **no application authentication**. Static
  delivery, view tokens, and inner HTML all flow without cookies.
- All authenticated MCP traffic (`tools/call`, `resources/read`, etc.)
  goes through the postMessage bridge to the host backend, where the
  user's existing session applies.
- Operators choosing a **subdomain** sandbox origin (cheaper, same eTLD+1)
  must deploy `__Host-` or `Secure; HttpOnly; SameSite=Lax` cookies on the
  LibreChat origin and set `Cross-Origin-Resource-Policy: same-site` on
  the bridge endpoints to prevent leakage to the sandbox subdomain.
- Operators choosing a **separate eTLD+1** sandbox origin gain stronger
  isolation but no extra auth complexity, because the sandbox origin
  remains stateless.

### Sandbox origin operator config

- `MCP_SANDBOX_ORIGIN` (URL) — required for parity mode.
- `MCP_SANDBOX_VIEW_ENDPOINT` (path) — defaults to `/view/:token`.
- `MCP_APPS_ALLOW_SAME_ORIGIN` (bool) — interim non-parity mode. Logs a
  warning at startup. `hostCapabilities` reports `sandbox: same-origin`.

## CSP, permissions, downloads

### CSP enforcement

- Primary mechanism: **HTTP `Content-Security-Policy` response header**
  served by the sandbox-origin per-view endpoint.
- Per-resource policy is built from `_meta.ui.csp` (`connectDomains`,
  `resourceDomains`, `frameDomains`, `baseUriDomains`), intersected with a
  host deny list.
- Default policy when `_meta.ui.csp` is absent:
  ```
  default-src 'none';
  script-src 'self' 'unsafe-inline';
  style-src  'self' 'unsafe-inline';
  img-src    'self' data:;
  connect-src 'none';
  base-uri   'none';
  form-action 'none';
  frame-ancestors 'self';
  ```
- All declared origins must be enumerated, including the origin that
  serves the view's bundled JS/CSS (e.g. a CDN). Validation refuses to
  load a view whose CSP would block its own static assets.
- `<meta>` CSP is fallback-only and explicitly cannot deliver `sandbox`,
  `frame-ancestors`, or `report-uri`. The iframe `csp` attribute is
  experimental and not relied on for security.

### Permissions

- Top-level `Permissions-Policy` on the LibreChat application response
  must whitelist the union of permissions an MCP App could ever
  legitimately request — iframe `allow` only further restricts what the
  page already permits.
- The sandbox-origin per-view response carries its own `Permissions-Policy`
  intersecting `_meta.ui.permissions` with operator policy.
- The host reports the actually-grantable permission set in
  `hostCapabilities.sandbox`.

### Downloads

- Default v1: `ui/open-link` to a presigned URL. The host validates the
  link's origin against `_meta.ui.csp.connectDomains` (or a separate
  `downloadDomains` allowlist) before navigation.
- `ui/download-file` (draft-era) is gated behind a separate feature flag
  and out of scope for v1.

## Data boundary rules

The Apps spec is explicit and the agent loop must enforce it consistently:

- **`content`** on a tool result → conversation context (model-visible).
- **`structuredContent`** → UI rendering only. **Never** added to model
  context, never persisted into chat history's model-visible payload.
- **`_meta`** → not for model context.
- **`ui/update-model-context`** → the latest update before the next user
  message is folded into model context. Earlier updates are discarded.
- Task results follow the same rules: the underlying tool result's
  `content` reaches the model; `structuredContent` and `_meta` do not.
- The agent loop, the persistence layer (`packages/data-schemas`), and the
  rehydration / replay path all share a single helper that strips
  non-model fields before model exposure. Tests assert that
  `structuredContent` and `_meta` never appear in any model-bound
  serialization.

## Resource ingestion and trust review

The Apps security guidance assumes the host can review and hash resources
before users launch them. Concretely:

- **After `tools/list`** on every connected MCP server, the host crawls
  each tool's `_meta.ui.resourceUri`, calls `resources/read` proactively,
  and stores the HTML keyed by `(serverName, resourceUri, sha256(html))`.
- A new `MCPResourceReview` collection in `packages/data-schemas` stores
  hashes, first-seen / last-seen times, operator allow/block status, and
  a content excerpt for review.
- An admin surface in `client/src/components/SidePanel/MCPBuilder/` lists
  resources awaiting review (operator-policy decision: auto-allow,
  manual-review, hash-pinned).
- On view launch the host re-reads, re-hashes, and refuses to render if
  the hash diverges from the operator-approved pin (when configured).
- Resource fetch failures during review do **not** disable the underlying
  tools — the tool simply falls back to text-only mode.

## Trust UX

Host-controlled chrome that cannot be styled by the app:

- A persistent border / header on every view labeled "App from
  `<server name>`" with a click-through to server identity, OAuth scopes,
  and the resource's hash.
- The label uses LibreChat-controlled fonts and colors that no app CSS can
  override (rendered outside the view iframe).
- Permission prompts (`ui/message` consent, `ui/open-link` confirmation
  for unfamiliar domains) appear in host chrome, not inside the view.
- A host-rendered "exit app" affordance always available, independent of
  view content.

## Phased plan

### Phase 1 — Types + sandbox infra + bridge skeleton (≈2 weeks)

After this phase, the sandbox origin serves view documents, the bridge
exchanges messages with origin/source/schema validation, and types exist —
**but no capability is advertised**. Existing rendering still drives prod.

- Types in `packages/data-provider`:
  - Apps: `McpAppsExtensionCapability`, `McpUiResourceMeta`,
    `McpToolUiMeta`, `HostContext` (incl. `displayMode`,
    `availableDisplayModes`, `toolInfo`), `HostCapabilities`,
    `AppCapabilities`, `AppInfo`, `HostInfo`, `DisplayMode`, `Visibility`.
  - Tasks: `TasksCapability`, `TaskExecution`, `TaskHandle`, `Task`,
    `TaskStatus`, `RelatedTaskMeta`, `ProgressToken`,
    `ModelImmediateResponseMeta`.
  - Reuse existing MCP types where they exist.
- `packages/api/src/mcp/connection.ts`:
  - Read per-tool `execution.taskSupport` during tool listing.
  - **Do not advertise** Apps or Tasks capabilities yet.
- Sandbox infrastructure:
  - Static `proxy.html` served from `MCP_SANDBOX_ORIGIN`.
  - Per-view endpoint (`/view/:token`) that exchanges tokens with the
    host backend and returns view HTML with CSP + Permissions-Policy
    response headers.
  - Token exchange: server-to-server, signed/short-TTL.
  - Same-origin interim mode behind `MCP_APPS_ALLOW_SAME_ORIGIN`.
- `postMessage` bridge with origin/source/schema validation and the
  initialization barrier (waiting for both `ui/initialize` response and
  `ui/notifications/initialized` notification).
- Resource review pipeline (basic): crawl `_meta.ui.resourceUri` after
  `tools/list`, store hashes in `MCPResourceReview`. UI surfacing comes in
  Phase 2.
- Tests: `mongodb-memory-server` + real `@modelcontextprotocol/sdk`. Bridge
  tests use real cross-origin iframes via Playwright with mocked sandbox
  origin.

### Phase 2 — Apps end-to-end with truthful capability turn-on (≈2 weeks)

End of Phase 2: Apps capability advertised; views render with the minimum
viable interaction set.

- New module `client/src/components/Chat/MCPApp/`:
  - `Bridge.ts` — JSON-RPC over `postMessage` with the Phase 1 bridge.
  - `ProxyFrame.tsx` — outer sandbox-proxy iframe.
  - `useMcpApp.ts` — fetch resource via `resources/read` (driven by tool
    `_meta.ui.resourceUri`), generate view token, hand off to proxy,
    handle init handshake, hold connection until teardown.
- Discovery is tool-driven; UI resources resolved from
  `_meta.ui.resourceUri`. `resources/list` may legitimately omit them.
- Implement Host-side handlers:
  - `ui/open-link` — gated by allowlist + `connectDomains` check; user
    confirmation in host chrome for unfamiliar domains.
  - **`ui/message` — adds a message to the conversation context with the
    role declared by the app, after host-chrome user consent. *Not*
    inserted into the chat input box.**
  - `ui/request-display-mode` — returns the actual resulting mode (which
    may decline the request); only modes in `hostCapabilities` /
    `hostContext.availableDisplayModes` honored.
  - `ui/update-model-context` — overwrite semantics; only the most recent
    update before the next user message is forwarded to the LLM.
  - Proxied `tools/call`, `resources/read`, `ping`.
- App-only tool visibility enforcement (three points, all required):
  - **Model-facing tool list filter**: app-only tools removed from the
    list passed to the LLM.
  - **Bridge ACL on `tools/call`**: tools/call from a view rejected
    unless tool's `_meta.ui.visibility` includes `"app"`.
  - **Cross-server isolation**: a view bound to server A's connection
    cannot call tools on server B; `tools/call` from a view is dispatched
    to A's connection only.
- Implement Host-side notifications: `tool-input`, `tool-result`,
  `tool-cancelled`, `host-context-changed`, `size-changed`. Implement
  `ui/resource-teardown` request/response.
- Resource review UI surface in `MCPBuilder/`.
- Trust UX chrome around every view.
- Data-boundary helper plumbed through agent tool-result handling and
  persistence; tests assert no `structuredContent`/`_meta` leaks to the
  model.
- Migrate UI resource lookup from content-hashed IDs to `ui://` URIs.
  Legacy mcp-ui path behind a feature gate.
- **End of phase**: enable Apps capability advertisement on `initialize`,
  gated by interop matrix passing.

### Phase 3 — HostContext richness, display modes, permissions polish (≈1 week)

- Full `HostContext`: theme tokens (CSS variables), locale, timezone,
  platform, safe-area insets, `toolInfo`. Sourced from existing theme +
  i18n providers and the in-flight tool call.
- Display modes: `fullscreen` and `pip` if product confirms; otherwise
  `availableDisplayModes` stays `["inline"]`.
- `host-context-changed` notifications on theme/locale/dimension changes.
- Top-level `Permissions-Policy` rollout audit + change.
- Per-view `Permissions-Policy` headers from the sandbox endpoint.

### Phase 4 — Streaming `tool-input-partial` (≈1 week, optional)

- Surface partial tool-call arguments through the agent loop so views see
  `tool-input-partial`.
- Coordinate with `@librechat/agents` (`/home/danny/agentus`).

### Phase 5 — MCP Tasks support (≈2–3 weeks; can run parallel to Phases 2–3)

End of Phase 5: Tasks capability advertised, with sub-flags omitted for
unimplemented directions and `input_required` excluded.

- `packages/api/src/mcp/`:
  - Honor per-tool `execution.taskSupport`:
    - `forbidden` — never task-augment; reject server escalations.
    - `optional` — agent or operator policy decides.
    - `required` — always task-augment; reject synchronous attempts.
  - **Task envelope persistence (raw):** new `MCPTask` collection in
    `packages/data-schemas` storing the raw original-request envelope and
    raw terminal-response/error envelope verbatim, plus indexed columns
    `(userId, oauthSubject, scopeFingerprint, serverName, taskId,
    sessionId, status, createdAt, lastUpdatedAt, ttl, pollInterval,
    progressToken, modelImmediateResponse, lastSeen,
    correlationConversationId)`. Replay returns the stored envelope
    byte-for-byte.
  - Strict related-task metadata rules:
    - Add on all task-related requests, notifications, and responses
      *except* on `tasks/get` / `tasks/result` / `tasks/cancel`
      **requests**.
    - **Add on `tasks/result` response** (because the underlying request's
      result envelope has no taskId of its own).
  - **Authorization context binding**: persist the auth context at task
    creation and verify on every retrieval. `tasks/list` filters to the
    current context.
  - **Streamable HTTP session affinity**: persist `MCP-Session-Id` per
    task. On HTTP 404 for the session, start a new MCP session and
    revalidate outstanding `taskId`s via `tasks/get`. Treat
    "task not found" as terminal-with-error.
  - Long-wait ownership: a backend worker process owns the blocking
    `tasks/result` call. The browser observes status via the existing
    data-provider channels. This survives user logout and tab close.
  - Reconnect logic: on connection loss, re-issue `tasks/result` (which
    re-blocks until terminal) or fall back to `tasks/get` polling at the
    server's `pollInterval`.
- **`progressToken` durable mapping**: stable persistent map from initial
  request → `progressToken` → `taskId` → set of UI subscribers (views,
  running-jobs panels). `notifications/progress` from the server are
  routed via this map, not via iframe-only listeners.
- **`model-immediate-response` runtime**:
  - When present, the agent emits an intermediate assistant-visible
    message labeled as a server-supplied placeholder ("Job submitted, ID
    12345 — results in ~30 minutes").
  - The model is told the task is in flight and is suppressed from
    speaking its own placeholder for the same call.
  - When the final task result arrives, it is appended as a separate
    message; the placeholder is never overwritten.
  - When absent, the agent uses a neutral default; per-model overrides
    may suppress.
- Reject task augmentation for tools whose server signals
  `input_required`-only flows (out of v1 scope). Document the limitation
  in operator + developer docs.
- Frontend running-jobs surface in `client/src/components/SidePanel/`:
  cursor-paginated, status badges, progress bars (when `progressToken` is
  present), cancel button (disabled for terminal tasks), deep-link to the
  originating conversation. Localize under `com_ui_mcp_task_*`.
- Wire `_meta["io.modelcontextprotocol/related-task"]` through the
  postMessage bridge so views can subscribe to their own task progress.
- **End of phase**: enable Tasks capability advertisement, with
  `tasks.requests.*` flags published exhaustively for implemented
  directions only.

### Phase 6 — Hardening, threat model, browser matrix, ops docs (≈1 week)

- Threat model write-up referenced from this doc.
- **Browser support matrix**:
  - Chromium-based (Chrome / Edge ≥ stable - 2): full support.
  - Firefox ≥ ESR: full support; `Permissions-Policy` is limited
    availability — document which features degrade.
  - Safari ≥ 17: cross-site cookies / storage-partitioning quirks force
    operators choosing separate-eTLD+1 to verify their session model
    works there. The stateless-sandbox-origin policy in this plan
    sidesteps the worst of it.
  - Document degradation behavior per browser.
- Operator docs:
  - `MCP_SANDBOX_ORIGIN` setup (DNS, TLS, edge worker / backend route).
  - CSP defaults and override surface.
  - `Permissions-Policy` header changes.
  - Per-user task quotas, result-size caps, transport allowlists by
    role, resource-review policy.
  - Migration story: long-running operations belong on Tasks, not on
    raised proxy timeouts.
- E2E + interop test matrix (see Testing).

## Worked example: CAD generative-design app

1. User selects the CAD MCP server. The chat invokes a tool whose
   definition carries `_meta.ui.resourceUri = "ui://upload"`. The host
   fetches that URI via `resources/read`, looks up its review hash, and —
   if approved — generates a view token. The proxy iframe (sandbox origin)
   loads, emits `sandbox-proxy-ready`, and receives `sandbox-resource-ready`
   with the token. The inner view is fetched from the sandbox-origin
   per-view endpoint with CSP + Permissions-Policy headers.
2. View shows an upload dialog. It calls `cad.create_upload_url`
   (`taskSupport: forbidden`) for a presigned PUT URL via the bridge.
   View PUTs the file directly to blob storage (CSP `connect-src`
   whitelists the storage origin from `_meta.ui.csp.connectDomains`).
   It then calls `cad.ingest({ key })` (`taskSupport: required`), which
   runs as a task. View renders progress from `notifications/progress`
   correlated via durable `progressToken` mapping.
3. Task completes. The result envelope (a tessellated GLTF with B-Rep
   face IDs from OCCT plus a feature list) is persisted raw. The view
   receives `ui/notifications/tool-result` and transitions from "uploading"
   to "viewer" without remount.
4. User picks holes/faces (Three.js raycasting; face IDs from `_meta`),
   selects material, clicks Finish. Selection state lives in the view's
   JS plus is mirrored to the host via `ui/update-model-context` (with
   overwrite semantics) so the next LLM turn knows the current selection.
   `structuredContent` describing the selection stays UI-only and never
   reaches the model.
5. View calls `cad.submit_job(...)` (`taskSupport: required`, ~30 min).
   Server returns a task handle plus
   `_meta["io.modelcontextprotocol/model-immediate-response"]` of "Job
   submitted, ID 12345 — results in ~30 minutes". Agent emits that as an
   intermediate assistant message; the model is suppressed from speaking
   its own placeholder.
6. The submit task's eventual result is itself a UI resource — a
   "job status" card. While mounted, it renders progress from
   `notifications/progress`. After the user closes the chat, the backend
   worker keeps the `tasks/result` blocking call alive. On HTTP 404 for
   the MCP session, the worker re-establishes the session and revalidates
   the task via `tasks/get`.
7. User comes back. `tasks/list` (filtered by auth context) returns the
   task; on completion, `tasks/result` returns the raw stored terminal
   envelope. The result UI resource shows a download button using
   `ui/open-link` to a presigned S3 URL, plus an inline GLTF preview
   (CSP `connect-src` whitelists the S3 bucket).

## Risks / open questions

- **Sandbox-origin backend cost.** Parity now requires a small dynamic
  endpoint at the sandbox origin. For self-hosters this is one more
  process to run. Document a serverless / edge-function path.
- **Browser policy drift.** `Permissions-Policy` and third-party-cookie
  semantics differ across vendors and change yearly. The browser matrix
  in Phase 6 needs ownership.
- **`tool-input-partial`** requires changes to `@librechat/agents`.
  Coordinate or defer.
- **Out-of-band notification** stays in the external REST API's domain
  via webhook → email; not solved by Tasks.
- **SEP-2669 (pause/resume/steer)** and **SEP-2268 (subtasks)** still in
  review. Plan for Tasks v1 only.
- **Task expiry semantics** still being refined per the 2026 MCP roadmap.
  Treat server-supplied TTL as authoritative.
- **`ui/update-model-context` does not persist view state by spec.** If
  the CAD app needs selection state to survive iframe remount or session
  restart, that's a host feature requiring server-side persistence keyed
  by something stable (e.g. `partId`).
- **`input_required` excluded from v1.** Tools requiring it can't run as
  tasks until elicitation/sampling is implemented.
- **ext-apps `main` drift.** Pinning a release means we deliberately
  ignore some new fields. Quarterly refresh cadence to re-evaluate.
- **Stdio-RCE precedent.** Conservative defaults on server creation,
  transport allowlists, and per-user quotas are non-negotiable design
  inputs, not late hardening.

## Testing matrix

CLAUDE.md says real logic over mocks. The matrix uses real
`@modelcontextprotocol/sdk` servers in-process and Playwright for the
cross-origin iframe layer.

### MCP Apps

- Capability negotiation **truthfully gated**: capability absent until
  Phase 2 ships; presence/absence both tested.
- Discovery: tool with `_meta.ui.resourceUri` for a resource omitted from
  `resources/list` is still rendered; resource without `_meta.ui` falls
  back to text.
- App-only tool visibility:
  - Tool with `visibility: ["app"]` not in model-facing tool list.
  - `tools/call` from a view succeeds when visibility includes `"app"`,
    rejected otherwise.
  - View bound to server A cannot call any tool on server B.
- **`ui/message` semantics**: adds a message to conversation context with
  declared role; consent prompt appears in host chrome.
- **`displayMode` and `availableDisplayModes` reach the view via
  `HostContext`**, not `HostCapabilities`. Host doesn't switch to
  undeclared modes; `ui/request-display-mode` returns the actual
  resulting mode.
- **Initialization barrier**: host messages sent before
  `ui/notifications/initialized` are buffered and flushed on barrier
  release; nothing leaks before the barrier.
- CSP enforcement: undeclared `connect-src` blocked; declared origin
  succeeds. `<meta>` CSP path tested for the documented limitations.
- `Permissions-Policy` interaction: iframe `allow` cannot exceed top-level
  policy; granted-vs-requested reported in `hostCapabilities.sandbox`.
- `size-changed` and `host-context-changed` round-trip.
- Malformed JSON-RPC over `postMessage`: rejected, logged, no host crash.
- `postMessage` from wrong origin: rejected.
- `null`-origin `postMessage` from sandbox: accepted only when source
  matches the proxy-controlled inner window reference.
- Resource review: ingest after `tools/list`, hash stored, divergent hash
  refused at launch.
- Data boundary: `structuredContent` and `_meta` never appear in
  model-bound serialization, including across rehydration.

### MCP Tasks

- Per-tool `taskSupport: required` rejects synchronous calls.
- Per-tool `taskSupport: forbidden` rejects task-augmented calls.
- **`tasks/result` response carries `related-task` meta**.
- `tasks/get`, `tasks/result`, `tasks/cancel` requests with the meta
  present: server ignores meta, uses param.
- Cancellation after terminal state returns the existing terminal status.
- Cursor pagination of `tasks/list` traverses correctly across pages.
- Disconnect during `tasks/result` → reconnect → resume returns the same
  terminal result.
- HTTP 404 for `MCP-Session-Id` → new session started, outstanding
  taskIds revalidated via `tasks/get`.
- Optional status notifications tolerated as hints; absence does not
  stall the UI.
- `progressToken` propagates from agent through bridge to view; mapping
  durable across reconnects.
- `model-immediate-response`: emitted as intermediate assistant message;
  model suppressed; final result appended without overwriting.
- Authorization-context binding: `tasks/list` from a different auth
  context returns empty; `tasks/get` for another user's task returns
  not-found.
- **Raw envelope replay**: `tasks/result` returns byte-for-byte the
  stored terminal envelope (success and error cases both).
- `input_required` task: server signal causes task augmentation to be
  refused at submit time (v1 scope).

## Effort summary

| Phase | Estimate |
|---|---|
| 1 — Types + sandbox infra + bridge skeleton | 2 weeks |
| 2 — Apps end-to-end + capability turn-on | 2 weeks |
| 3 — HostContext + display modes + permissions polish | 1 week |
| 4 — Streaming `tool-input-partial` (optional) | 1 week (risk) |
| 5 — MCP Tasks (parallel with 2–3) | 2–3 weeks |
| 6 — Hardening + browser matrix + ops docs | 1 week |
| **Total (serial, excl. parallelism)** | **~9–11 weeks** |
| **Phase 1 + 2 + 5** (functional CAD app, parity sandbox) | **~6 weeks** |

## References

- MCP Apps spec (stable 2026-01-26):
  <https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx>
- MCP Apps repo + SDK: <https://github.com/modelcontextprotocol/ext-apps>
- SEP-1865 (MCP Apps):
  <https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865>
- MCP Tasks spec (2025-11-25):
  <https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks>
- SEP-1686 (Tasks):
  <https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1686>
- SEP-2669 (Task interaction — pause/resume/steer):
  <https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2669>
- SEP-2268 (Subtasks):
  <https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2268>
- 2026 MCP roadmap:
  <https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/>
- MDN: iframe sandbox guidance
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe>
- MDN: Content-Security-Policy and meta-tag limitations
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP>
- MDN: Permissions-Policy
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy>
- MDN: Window.postMessage origin validation
  <https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage>
