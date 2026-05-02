# Plan: MCP Apps + MCP Tasks Support in LibreChat

**Status:** Draft / scoping document — no code in this PR.
**Owner:** TBD
**Target branch:** `claude/mcp-apps-spec-support-rEi7X`
**Revision:** v4 — substantial scope cuts and architecture corrections after
review:

- **Wire-format compliance.** v3 invented a tokenized `/view/:token`
  delivery path that diverged from the stable spec's
  `ui/notifications/sandbox-resource-ready` shape (which carries raw
  `html`). v4 conforms to the wire format. Hardened delivery is
  redocumented as a future, explicitly-labeled host extension.
- **Apps v1 scope cut to predeclared, single-resource, inline-only.** No
  result-time UI-resource switching; the CAD example is rewritten
  accordingly. `listChanged`, multi-resource responses, state restoration,
  and `ui/download-file` are explicitly deferred.
- **Use the official `@modelcontextprotocol/ext-apps` `AppBridge`.** Do not
  hand-roll a bridge.
- **`ui/message` is `role: "user"` only** per stable spec.
- **`connectDomains` is not a navigation/download allowlist.** v4 adds a
  separate host-controlled navigation allowlist for `ui/open-link`.
- **Tasks v1 is polling-first**, not worker-first. `tasks/get` polling at
  the server's `pollInterval` is the primary UX. `tasks/result` is called
  only when the user is actively waiting or explicitly opens a job detail.
- **`input_required` handling corrected.** No tool-level signal
  pre-announces it; v4 enables Tasks only for `taskSupport: required` tools
  (or an operator allowlist) and aborts at runtime if a task transitions
  to `input_required`.
- **Persistence relaxed from byte-for-byte to canonical JSON envelopes**
  with blob offload for oversized payloads (16 MiB BSON limit).
- **Streamable HTTP only for Tasks**, gated on a Phase 0 transport
  reliability fix.
- **Drop `Permissions-Policy` / COEP from v1 critical path.** Iframe
  `sandbox` + CSP is the real boundary; the others are defense-in-depth.
- **Drop the same-origin fallback.** Single cross-origin sandbox path for
  production; dev-mode is dev-mode.

## Goal

Bring LibreChat to a useful, conformant subset of the MCP extensions for
interactive UIs (**MCP Apps**, SEP-1865, stable 2026-01-26) and long-running
operations (**MCP Tasks**, 2025-11-25, experimental). The intent is parity
with the stable subset of Apps and a deliberately narrow polling-first
Tasks v1.

## Closed go/no-go decisions

1. **Sandbox wire format.** The host implements the stable wire format —
   `ui/notifications/sandbox-resource-ready` carries raw `html`, plus
   optional sandbox/CSP metadata. The proxy renders the inner iframe via
   `srcdoc` with iframe `sandbox` attribute and a `<meta>` CSP injected
   into the HTML. We accept the documented meta-CSP limitations (no
   `sandbox`, no `frame-ancestors`, no `report-uri` directives) and
   compensate where we can — `frame-ancestors` is enforced via the
   proxy.html response header on the sandbox origin; `sandbox` flags use
   the iframe attribute; `report-uri` is unavailable in v1.
2. **Apps resource model.** v1 supports exactly **one predeclared `ui://`
   resource per tool**, discovered via `_meta.ui.resourceUri` on the tool
   definition and fetched with `resources/read`. Result-time UI-resource
   switching, embedded resources, resource-link UI transport, and
   multi-resource responses are out of v1.
3. **Tasks ownership model.** v1 is **polling-first**: `tasks/get` at the
   server's `pollInterval`. `tasks/result` is called only when a user is
   actively waiting or has explicitly opened a job's detail view. No
   backend-owned blocking workers in v1.
4. **Authorization context identifier.** v1 binds task ownership to a
   tuple of `(userId, mcpServerId, oauthSubject || apiKeyFingerprint)`,
   computed once at connection time and treated as immutable for the
   lifetime of that connection. Anything that changes the tuple
   invalidates the task list for that context.

## Pinned protocol versions

- Apps: stable dated spec **`2026-01-26`**.
- Tasks: dated spec **`2025-11-25`** (experimental).
- ext-apps types: a **pinned** package release (currently
  `@modelcontextprotocol/ext-apps@<latest stable matching 2026-01-26>`).
  `main` is excluded — it carries draft additions like `ui/download-file`
  and `HostCapabilities.downloadFile` that are not in the stable prose.
- Validators are generated from the pinned release. No hand-typed schemas
  for the wire surface.

## Out of v1 scope (explicit)

| Feature | Why deferred |
|---|---|
| `ui/download-file` | Not in stable Apps |
| `listChanged` for app-exposed tools | Out of stable Apps; uses existing tool-list refresh |
| Multi-resource tool responses | Stable spec defers this |
| Result-time UI-resource switching | Stable spec defers this |
| State restoration across remounts | Stable spec defers this |
| `ui/message` with non-`user` roles | Stable spec is `role: "user"` only |
| `fullscreen` / `pip` display modes | Inline only in v1 |
| `tool-input-partial` streaming | Requires `@librechat/agents` changes |
| `input_required` task lifecycle | Depends on elicitation/sampling, not implemented |
| `tasks.requests.sampling` / `elicitation` | Same |
| Backend-owned blocking `tasks/result` workers | Not a protocol prerequisite |
| Same-origin sandbox fallback for production | Dropped — dev-mode only |
| Top-level `Permissions-Policy` rollout | Defense-in-depth, not v1 critical path |
| `Cross-Origin-Embedder-Policy: require-corp` | Same |
| Tokenized `/view/:token` hardened delivery | Future host extension, post-v1 |
| Proactive `_meta.ui.resourceUri` crawl after every `tools/list` | First-launch review + hash pinning is enough |

## Background

### MCP Apps (extension `io.modelcontextprotocol/ui`) — stable subset only

- Servers expose HTML resources at `ui://...` URIs with MIME
  `text/html;profile=mcp-app`.
- Tools link to a UI resource via `_meta.ui = { resourceUri, visibility }`
  on the tool definition. UI resources may be omitted from
  `resources/list`; discovery flows through tool metadata. Plain text
  fallback when Apps are unavailable is mandatory.
- Resource `_meta.ui` (returned by `resources/read`) carries CSP
  (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`),
  iframe `permissions`, sandbox `domain`, and `prefersBorder`.
  `connectDomains` governs **fetch / XHR / WebSocket** from view JS — it
  is **not** a navigation allowlist.
- **Web-host sandbox flow** (stable wire format):
  1. Host renders a sandbox-proxy iframe served from the sandbox origin
     (different origin from the host).
  2. Proxy emits `ui/notifications/sandbox-proxy-ready`.
  3. Host responds with `ui/notifications/sandbox-resource-ready`
     carrying `{ html, sandbox?, csp?, permissions? }`.
  4. Proxy renders the inner iframe with `srcdoc=html`, `sandbox` flags
     from the message, and a CSP `<meta>` tag derived from `csp`.
- **Initialization sequence** (host respects both barriers):
  1. View sends `ui/initialize` request with `appInfo`, `appCapabilities`,
     `protocolVersion`.
  2. Host returns `protocolVersion`, `hostInfo`, `hostCapabilities`,
     `hostContext`.
  3. **View sends `ui/notifications/initialized` notification.**
  4. Only after step 3 may the host send `tool-input`, `tool-result`, etc.
- **`HostContext` carries** `theme`, CSS variables, **`displayMode`**
  (active), **`availableDisplayModes`**, `containerDimensions`, `locale`,
  `timeZone`, `platform`, `deviceCapabilities`, `safeAreaInsets`, and
  **`toolInfo`** — metadata about the tool call that instantiated the
  view.
- **`HostCapabilities` carries** sandbox grants (actually-grantable
  permissions) and modality declarations — **not** the display mode set.
- View → Host (v1 subset): `ui/open-link`, `ui/message`,
  `ui/request-display-mode`, `ui/update-model-context`, plus standard MCP
  `tools/call`, `resources/read`, `notifications/message`, `ping`.
- Host → View (v1 subset): `ui/initialize` (response), notifications for
  `tool-input`, `tool-result`, `tool-cancelled`, `host-context-changed`,
  `size-changed`, plus `ui/resource-teardown`. (`tool-input-partial`
  deferred.)
- **`ui/message` semantics**: the host adds a message to the conversation
  context with **`role: "user"`** (stable spec). The host may require
  user consent before doing so.
- **`ui/update-model-context` semantics**: each update overwrites the
  previous; the host typically forwards only the last update before the
  next user message.
- **App-only tool visibility** (`visibility: ["app"]`): app-only tools
  must not appear in the agent's tool list, may only be called by views
  whose visibility includes `"app"`, and **cross-server app-tool calls
  are blocked**.
- **Use the official host SDK.** v1 wraps `AppBridge` and
  `PostMessageTransport` from `@modelcontextprotocol/ext-apps` rather
  than reimplementing them.

Reference: <https://github.com/modelcontextprotocol/ext-apps>

### MCP Tasks (capability `tasks`) — polling-first subset

- Augments standard requests (most relevantly `tools/call`) with task
  semantics. Server returns immediately with a task handle.
- **Two-level negotiation.** Server advertises
  `capabilities.tasks.requests.tools.call` etc. Each tool independently
  declares `execution.taskSupport` as `forbidden`, `optional`, or
  `required`. Both must be honored.
- **Capability declarations are exhaustive and directional.** Advertise
  only what is implemented.
- Status lifecycle relevant to v1: `working` → `completed` | `failed` |
  `cancelled`. **`input_required` is not supported in v1**: if a task
  transitions to `input_required` at runtime, the host abandons it,
  surfaces an unsupported-status error to the user, and refuses
  `tasks/result` on it.
- **Task object** carries `taskId`, `status`, `createdAt`,
  `lastUpdatedAt`, `ttl`, optional `pollInterval`. Treat server-supplied
  values as authoritative.
- Methods: `tasks/get`, `tasks/list`, `tasks/result`, `tasks/cancel`.
- **Polling-first** (corrected from v3): the host polls `tasks/get` at
  `pollInterval` while a task is in flight. `tasks/result` is invoked
  only when the user is actively viewing the task or explicitly opens
  its detail card.
- **Related-task metadata rules**:
  - All requests, notifications, and responses related to a task carry
    `_meta["io.modelcontextprotocol/related-task"] = { taskId }` *except*
    as noted below.
  - `tasks/get`, `tasks/result`, `tasks/cancel` **requests** use the
    `taskId` parameter as source of truth; receivers ignore the meta tag
    if present on those requests.
  - `tasks/get` and `tasks/cancel` **responses** carry Task objects with
    their own `taskId` — meta tag not required.
  - **`tasks/result` *response* MUST carry the meta tag**, because the
    underlying request's result envelope has no `taskId` of its own.
- **Result fidelity.** `tasks/result` returns the same successful result
  or JSON-RPC error the underlying request would have produced.
  `isError: true` corresponds to `failed` status. v1 stores **canonical
  JSON envelopes** preserving enough metadata to reconstruct the
  semantic response; oversized payloads (>~12 MiB to leave headroom
  under the 16 MiB BSON limit) and binary blobs offload to immutable
  blob storage with the envelope referencing them by URL/hash.
- Status notifications are optional; the host treats them as hints.
- Servers may return
  `_meta["io.modelcontextprotocol/model-immediate-response"]` — a
  model-facing string letting the model continue reasoning while the
  task runs. Important for `taskSupport: required` tools.
- **Authorization context binding.** Task access bound to
  `(userId, mcpServerId, oauthSubject || apiKeyFingerprint)`, captured
  at task creation, refused at retrieval if the current context's tuple
  doesn't match.
- **Streamable HTTP only.** v1 does not run Tasks over stdio, WS, or
  SSE. The transport must reuse `MCP-Session-Id`, send
  `MCP-Protocol-Version`, and handle HTTP 404 → new MCP session and
  revalidation of outstanding `taskId`s. Phase 0 lands the transport
  fixes that block this.
- `tasks/list` is cursor-paginated and surfaces underlying JSON-RPC
  errors verbatim, filtered by authorization context.

Reference:
<https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks>

## Current state of LibreChat MCP integration

| Area | Status | Location |
|---|---|---|
| MCP client + transports | Done | `packages/api/src/mcp/` |
| Tools, resources, prompts | Done (sampling/roots not impl.) | `packages/api/src/mcp/connection.ts` |
| OAuth 2.0 + dynamic client registration + PKCE | Done | `packages/api/src/mcp/oauth/` |
| MCP server management UI | Done | `client/src/components/SidePanel/MCPBuilder/` |
| Sandboxed iframe UI rendering (mcp-ui ad-hoc) | Done | `client/src/components/MCPUIResource/` via `@mcp-ui/client` |
| Tool-result → UI resource extraction | Done | `packages/api/src/mcp/parsers.ts` |
| Sampling / elicitation | **Missing** | blocks `input_required` |
| **Streamable HTTP reliability** (307/308 handling, session reuse, immediate-disconnect bugs) | **Buggy** — Phase 0 prerequisite | transport layer |
| Per-user header/token scoping (recent advisory) | **Hardening required** before Tasks | transport layer |
| Apps capability negotiation (truthfully gated) | Missing | — |
| `_meta.ui.resourceUri`-driven discovery | Missing | — |
| Cross-origin sandbox proxy + stable wire-format flow | Missing | — |
| Bridge using official `AppBridge` | Missing | — |
| `ui/initialize` handshake + truthful `hostContext` | Missing | — |
| App-only tool visibility enforcement | Missing | — |
| First-launch resource review + hash pinning | Missing | — |
| Per-resource CSP via meta-tag injection | Missing | — |
| Trust UX (sandbox boundary chrome) | Missing | — |
| MCP Tasks (per-tool negotiation, polling-first, auth-context binding, canonical-envelope persistence) | Missing | — |
| `progressToken` mapping (request → progressToken → taskId → subscribers) | Missing | — |
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

LibreChat advertises each capability only after its end-to-end
implementation passes the relevant interop matrix.

- Apps capability turns on at the end of Phase 2.
- Tasks capability turns on at the end of Phase 5.
- `tasks.requests.*` published exhaustively for implemented directions
  only.
- Phase 0 and Phase 1 changes never set these flags.
- `hostCapabilities` and `hostContext.availableDisplayModes` returned
  from `ui/initialize` are similarly truthful: v1 lists only `inline`.

## Web-host architecture

### Wire-format-compliant flow (v1)

- **Outer:** the host page on LibreChat's origin embeds a single iframe
  served from `MCP_SANDBOX_ORIGIN` (different origin). That iframe is
  the sandbox proxy and loads a static `proxy.html` shipped by
  LibreChat. The sandbox-origin response includes
  `Content-Security-Policy: frame-ancestors <librechat-origin>;` and
  caching disabled. **No application authentication runs at the sandbox
  origin** — it serves only static `proxy.html` plus its bundle. No
  CSRF surface.
- **Bridge:** the host wraps `@modelcontextprotocol/ext-apps`
  `AppBridge` (host side) and `PostMessageTransport`. The proxy uses
  the same SDK. v1 does not reimplement these.
- **Wire flow:**
  1. Proxy emits `ui/notifications/sandbox-proxy-ready` once mounted.
  2. Host fetches the resource via `resources/read`, applies a
     `<meta http-equiv="Content-Security-Policy">` derived from
     `_meta.ui.csp` to the HTML, and sends
     `ui/notifications/sandbox-resource-ready` with
     `{ html, sandbox, csp, permissions }` per the stable shape.
  3. Proxy creates an inner iframe with `srcdoc=html`, `sandbox=<flags>`,
     and `allow=<permissions intersected with the iframe-allow set>`.
  4. The inner view runs the standard initialization handshake (request
     + `initialized` notification) before the host sends `tool-input`,
     `tool-result`, etc.

### `postMessage` validation (host and proxy)

- Senders specify exact target origins (no `*`).
- Receivers validate `event.origin` against an exact allowlist (no
  partial / suffix match), `event.source` against expected window
  refs where applicable, and the JSON-RPC envelope schema before
  dispatch.
- Sandboxed `null` origins accepted only when the source matches the
  proxy-controlled inner window.
- **Initialization barrier**: outbound host requests are queued until
  both the `ui/initialize` response is sent and the view's
  `ui/notifications/initialized` is received. Premature attempts are
  buffered and flushed on barrier release.

### Sandbox origin operator config

- `MCP_SANDBOX_ORIGIN` (URL) — required. Must be a different origin from
  the LibreChat application origin. A subdomain on the same eTLD+1 is
  sufficient and is the recommended default.
- No `MCP_APPS_ALLOW_SAME_ORIGIN`. Same-origin operation is dev-only and
  reachable only when `NODE_ENV !== "production"`.

### Future hardened delivery (post-v1)

A tokenized `/view/:token` flow that swaps raw-HTML transport for a
sandbox-origin endpoint returning the inner document with
**response-header CSP** (which can carry `sandbox`, `frame-ancestors`,
`report-uri`) is documented as a deliberate, labeled host extension —
not parity. It is out of v1 scope and called out in operator docs only
as a future option.

## CSP, permissions, downloads

### CSP (v1)

- The inner view's CSP is delivered via `<meta http-equiv=
  "Content-Security-Policy">` injected before the closing `</head>` of
  the `html` payload before sending `sandbox-resource-ready`.
- Per-resource policy is built from `_meta.ui.csp` (`connectDomains` →
  `connect-src`; `resourceDomains` → `img-src`/`font-src`/`media-src`;
  `frameDomains` → `frame-src`; `baseUriDomains` → `base-uri`),
  intersected with a host deny list.
- Default policy when `_meta.ui.csp` is absent:
  ```
  default-src 'none';
  script-src 'self' 'unsafe-inline';
  style-src  'self' 'unsafe-inline';
  img-src    'self' data:;
  connect-src 'none';
  base-uri   'none';
  form-action 'none';
  ```
- **Documented limitations of `<meta>` CSP**: `sandbox` (handled via
  iframe attribute instead), `frame-ancestors` (handled via the
  proxy.html response header on the sandbox origin), and `report-uri`
  (unavailable in v1) cannot be expressed.
- All declared origins must be enumerated, including bundle hosts
  (CDN, dev `localhost`). The injector refuses HTML whose CSP would
  block its own static assets.

### Iframe sandbox flags

- The iframe `sandbox` attribute is the real sandbox-flags carrier (not
  meta CSP). Defaults: `allow-scripts` only. `allow-same-origin` is
  never set together with `allow-scripts` on the inner frame, since the
  combination defeats the sandbox.
- `allow-popups`, `allow-forms`, `allow-modals`, etc. are added only
  when present in the resource's `_meta.ui.sandbox` set and on the host
  allowlist.

### Permissions

- `_meta.ui.permissions` maps to the iframe `allow` attribute,
  intersected with what the host considers safe to grant in the chat
  surface.
- Top-level `Permissions-Policy` rollout is **out of v1**.
  `Cross-Origin-Embedder-Policy: require-corp` is **out of v1**. They
  are tracked as defense-in-depth follow-ups.

### Navigation and downloads

- `ui/open-link` is gated against a **separate host navigation
  allowlist** (`MCP_APPS_NAVIGATION_ALLOWLIST` env or operator config),
  *not* `_meta.ui.csp.connectDomains` — `connectDomains` exists for
  fetch/XHR/WebSocket from view JS, which is the wrong policy boundary
  for top-level navigation.
- Default v1 download UX: `ui/open-link` to a presigned URL whose
  origin is in the navigation allowlist. The user's browser handles
  the download.
- `ui/download-file` is out of v1.

## Data boundary rules

The Apps spec is explicit and the agent loop must enforce it
consistently:

- **`content`** on a tool result → conversation context (model-visible).
- **`structuredContent`** → UI rendering only. Never added to model
  context, never persisted into model-visible payloads.
- **`_meta`** → not for model context.
- **`ui/update-model-context`** → the latest update before the next
  user message is folded into model context. Earlier updates are
  discarded.
- Task results follow the same rules; the underlying tool result's
  `content` reaches the model; `structuredContent` and `_meta` do not.
- The agent loop, persistence layer (`packages/data-schemas`), and
  rehydration / replay path share a single helper that strips
  non-model fields. Tests assert that `structuredContent` and `_meta`
  never appear in any model-bound serialization.

## Resource review (v1)

Slimmed from v3:

- **First-launch review.** The first time a tool with `_meta.ui.
  resourceUri` is invoked, the host fetches via `resources/read`,
  hashes the HTML, and stores
  `(serverName, resourceUri, sha256, firstSeen)` in
  `MCPResourceReview`. Operator policy decides auto-allow vs
  manual-review. Until approved, the tool falls back to text-only.
- **Hash pinning.** On subsequent launches, the host re-reads, re-hashes,
  and refuses to render if the hash diverges from the operator-approved
  pin (when configured).
- **No proactive crawl** of `_meta.ui.resourceUri` after every
  `tools/list`. That is product polish and out of v1.

## Trust UX

Host-controlled chrome that cannot be styled by the app:

- Persistent border + header on every view labeled "App from
  `<server name>`" with click-through to server identity, OAuth scopes,
  and resource hash.
- Label uses LibreChat-controlled fonts/colors rendered **outside** the
  view iframe so app CSS cannot override.
- Permission prompts (`ui/message` consent, `ui/open-link` confirmation
  for navigation-allowlist domains marked "ask") appear in host chrome.
- Host-rendered "exit app" affordance always available.

## Security and transport prerequisites (Phase 0)

Apps and Tasks compound the existing MCP surface. Phase 0 is gating:

- Resolve documented Streamable HTTP issues (immediate-disconnect,
  307/308 redirect handling), wire `MCP-Session-Id` reuse and
  `MCP-Protocol-Version` headers consistently, and implement HTTP 404
  → new MCP session with outstanding-task revalidation.
- Close per-user header/token scoping for shared server definitions
  (subject of the recent advisory). Define and enforce the
  authorization-context tuple
  `(userId, mcpServerId, oauthSubject || apiKeyFingerprint)`.
- Operator policy defaults for server creation, transport allowlists,
  per-user task quotas, result-size caps. Defaults lean toward denial.

## Phased plan

### Phase 0 — Transport reliability + auth-context substrate (≈1 week)

Prerequisite for both Apps and Tasks. Lands purely in
`packages/api/src/mcp/`.

- Streamable HTTP fixes (redirects, session reuse, disconnect
  semantics).
- Authorization-context tuple computed at connection time, threaded
  through tool calls and task storage.
- Operator policy defaults.

### Phase 1 — Types + sandbox infra + bridge wrapper (≈1 week)

End of phase: sandbox origin serves static `proxy.html`; bridge
handshake works end-to-end against a fixture server; **no capability
advertised**.

- Types in `packages/data-provider`, generated from the pinned
  ext-apps release.
- `packages/api/src/mcp/connection.ts` reads per-tool
  `execution.taskSupport`. **Does not advertise** Apps or Tasks.
- Sandbox infrastructure: static `proxy.html` served from
  `MCP_SANDBOX_ORIGIN` with `frame-ancestors <librechat-origin>`
  CSP header.
- Wrap official `AppBridge` + `PostMessageTransport` from
  `@modelcontextprotocol/ext-apps`. Add origin/source/schema
  validation in front of the SDK transport.
- `MCPResourceReview` collection scaffold.
- Tests with `mongodb-memory-server` + real
  `@modelcontextprotocol/sdk` + Playwright cross-origin iframes.

### Phase 2 — Apps v1 end-to-end + capability turn-on (≈2 weeks)

End of phase: Apps capability advertised; minimum-viable Apps render
inline.

- New `client/src/components/Chat/MCPApp/`:
  - `ProxyFrame.tsx` — outer iframe at sandbox origin.
  - `useMcpApp.ts` — fetch resource via `resources/read` (driven by
    tool `_meta.ui.resourceUri`), inject CSP `<meta>`, send
    `sandbox-resource-ready`, run init handshake, hold connection
    until teardown.
- Single predeclared `ui://` resource per tool. No result-time
  switching.
- Host-side handlers (v1 subset only):
  - `ui/open-link` — gated by host **navigation allowlist** (separate
    from `connectDomains`); user confirmation for unfamiliar domains
    in host chrome.
  - **`ui/message` — `role: "user"` only**, added to conversation
    context after host-chrome user consent.
  - `ui/request-display-mode` — returns the actually-resulting mode;
    only `inline` honored in v1.
  - `ui/update-model-context` — overwrite semantics.
  - Proxied `tools/call`, `resources/read`, `ping`.
- App-only tool visibility enforcement at three named points:
  - **Model-facing tool list filter**.
  - **Bridge ACL on `tools/call`**: rejected unless tool's
    `_meta.ui.visibility` includes `"app"`.
  - **Cross-server isolation**: a view bound to server A cannot call
    tools on server B.
- Host-side notifications: `tool-input`, `tool-result`,
  `tool-cancelled`, `host-context-changed`, `size-changed`. Implement
  `ui/resource-teardown`.
- First-launch resource review; hash pinning; `MCPBuilder/` UI for
  approvals.
- Trust UX chrome around every view.
- Data-boundary helper plumbed through agent tool-result handling and
  persistence; tests assert no `structuredContent`/`_meta` leaks to
  the model.
- **End of phase**: enable Apps capability advertisement, gated by
  interop matrix passing.

### Phase 3 — HostContext richness (≈3–5 days)

- Full `HostContext`: theme tokens (CSS variables), locale, timezone,
  platform, safe-area insets, `toolInfo`. Sourced from existing theme
  + i18n providers and the in-flight tool call.
- `host-context-changed` notifications on theme/locale/dimension
  changes.

### Phase 4 — `tool-input-partial` (≈1 week, optional)

- Surface partial tool-call arguments through the agent loop so views
  see `tool-input-partial`.
- Coordinate with `@librechat/agents` (`/home/danny/agentus`).
- Optional for v1.

### Phase 5 — MCP Tasks v1 (≈2 weeks; can run parallel to Phases 2–3)

End of phase: Tasks capability advertised, sub-flags exhaustive for
implemented directions.

- `packages/api/src/mcp/`:
  - Honor per-tool `execution.taskSupport`. v1 task-augments only
    tools with `taskSupport: required` *or* on an operator allowlist.
    `optional` defaults to synchronous in v1.
  - **Polling-first runtime**: a poller running in the existing API
    process polls `tasks/get` at the server-suggested `pollInterval`
    while a task is in flight. `tasks/result` is invoked only when
    the user is actively waiting (subscribed view, open jobs panel,
    explicit "fetch result" action).
  - **Canonical-envelope persistence**: new `MCPTask` collection in
    `packages/data-schemas` storing canonical JSON of the original
    request and the terminal response/error envelope, plus indexed
    `(userId, mcpServerId, oauthSubject || apiKeyFingerprint,
    taskId, sessionId, status, createdAt, lastUpdatedAt, ttl,
    pollInterval, progressToken, modelImmediateResponse, lastSeen,
    correlationConversationId)`. Payloads >12 MiB or binary-heavy
    blobs offload to immutable blob storage; the envelope references
    them by URL/hash.
  - **Strict related-task metadata rules** (v3 fix preserved):
    - Add on all task-related requests, notifications, responses
      *except* on `tasks/get` / `tasks/result` / `tasks/cancel`
      **requests**.
    - **Add on `tasks/result` response** (its payload has no taskId).
  - **Authorization context binding** at task creation; verify on
    every retrieval. `tasks/list` filtered by current context.
  - **Streamable HTTP only.** Persist `MCP-Session-Id` per task.
    HTTP 404 → start a new MCP session and revalidate outstanding
    `taskId`s via `tasks/get`. Treat "task not found" as
    terminal-with-error.
  - **`input_required` aborts**: if a task transitions to
    `input_required` at runtime, the host abandons it, surfaces an
    "unsupported task lifecycle" error to the user, and writes a
    `failed`-equivalent terminal envelope. Documented limitation
    until elicitation/sampling lands.
- **`progressToken` durable mapping**: persistent map from initial
  request → `progressToken` → `taskId` → subscriber set.
  `notifications/progress` from the server are routed via this map.
- **`model-immediate-response` runtime**:
  - When present, the agent emits an intermediate assistant-visible
    message containing the server-supplied string, clearly marked as
    a preliminary placeholder.
  - The model is suppressed from speaking its own placeholder for the
    same call.
  - Final task result appended as a separate message; placeholder
    never overwritten.
  - When absent, agent uses a neutral default.
- Frontend running-jobs surface in
  `client/src/components/SidePanel/`: cursor-paginated, status
  badges, progress bars (when `progressToken` present), cancel button
  (disabled for terminal tasks), deep-link to originating
  conversation. Localize under `com_ui_mcp_task_*`.
- Wire `_meta["io.modelcontextprotocol/related-task"]` through the
  bridge so views can subscribe to their own task progress.
- **End of phase**: enable Tasks capability advertisement.

### Phase 6 — Hardening, browser matrix, ops docs (≈1 week)

- Threat model write-up.
- Browser support matrix:
  - Chromium ≥ stable - 2: full support.
  - Firefox ≥ ESR: full support.
  - Safari ≥ 17: cross-site cookie / storage-partitioning quirks
    don't affect v1 because the sandbox origin is stateless.
  - Document degradation per browser.
- Operator docs:
  - `MCP_SANDBOX_ORIGIN` setup.
  - CSP defaults and override surface.
  - Navigation allowlist config.
  - Per-user task quotas, result-size caps, transport allowlists,
    resource-review policy.
  - Migration story: long-running operations move from raised proxy
    timeouts to Tasks.
- E2E + interop test matrix.

## Worked example: CAD generative-design app (rewritten for v1 scope)

The app is **one predeclared `ui://cad-app` resource** linked from a
single `cad.workbench` tool. The same view persists for the entire
session and refreshes itself by calling other CAD-server tools as the
user navigates. There is no result-time UI-resource switching.

1. User runs the CAD MCP server. The `cad.workbench` tool's definition
   carries `_meta.ui.resourceUri = "ui://cad-app"`. The host fetches
   the HTML via `resources/read`, applies first-launch review (or
   re-validates the operator-approved hash), injects CSP `<meta>`,
   and sends `sandbox-resource-ready`. The proxy renders the inner
   iframe via `srcdoc` + `sandbox` flags.
2. The view starts in an "upload" panel. It calls `cad.create_upload_url`
   (`taskSupport: forbidden`) over the bridge for a presigned PUT URL.
   The view PUTs the file directly to blob storage (CSP `connect-src`
   from `_meta.ui.csp.connectDomains` whitelists the storage origin).
   It then calls `cad.ingest({ key })` (`taskSupport: required`),
   which runs as a task. The view polls progress via
   `notifications/progress` correlated by `progressToken` /
   `related-task`.
3. When `cad.ingest` completes, its `tools/call` returns a
   `CallToolResult` whose `structuredContent` carries the tessellated
   GLTF + B-Rep face IDs and whose `content` carries a textual
   summary for the model. The view receives this via
   `tool-result`, parses `structuredContent` (UI-only), and switches
   itself from the upload panel to the viewer panel — same `ui://`
   resource, internal SPA navigation. `structuredContent` never
   reaches the model.
4. User picks holes/faces (Three.js raycasting), selects material,
   clicks Finish. Selection state mirrored to the host via
   `ui/update-model-context` (overwrite semantics) so the next LLM
   turn sees the current selection.
5. The view calls `cad.submit_job({ partId, selections, material })`
   (`taskSupport: required`, ~30 min). Server returns a task handle
   plus a `model-immediate-response` like "Job submitted, ID 12345 —
   results in ~30 minutes". Agent emits that as a placeholder; the
   model is suppressed for this turn.
6. The view transitions to a "job status" panel — same `ui://`
   resource, internal navigation. While mounted, it polls task
   progress. After the user closes the chat, polling pauses; the
   task continues server-side. No backend-owned blocking worker.
7. User comes back. `tasks/list` (filtered by auth-context tuple)
   returns the task. The view (or the running-jobs panel) calls
   `tasks/result` because the user is now actively waiting. The
   stored canonical-JSON envelope is returned, with the S3 presigned
   URL inside. The view shows a "Download" button using
   `ui/open-link` against the host navigation allowlist (which
   whitelists the S3 bucket). The browser downloads the zip.

## Risks / open questions

- **`<meta>` CSP limitations** (`sandbox`, `frame-ancestors`,
  `report-uri` not expressible) accepted in v1. Operators wanting
  stricter controls wait for the post-v1 hardened-delivery extension.
- **Operator deployment cost.** A single sandbox subdomain is required.
  Document the simplest setup (subdomain + TLS + static asset host).
- **`tool-input-partial`** requires `@librechat/agents` changes.
  Coordinate or defer.
- **Out-of-band notification** ("email me when the job's done") stays
  in the external REST API's domain via webhook → email; not solved
  by Tasks.
- **SEP-2669 (pause/resume/steer)** and **SEP-2268 (subtasks)** still
  in review. Not in v1.
- **Task TTL semantics** still being refined per the 2026 MCP roadmap.
  Treat server-supplied TTL as authoritative.
- **`ui/update-model-context` does not persist view state by spec.**
  The CAD view's selection state lives in its own JS plus on the CAD
  MCP server (keyed by `partId`). LibreChat does not persist view
  state for it.
- **`input_required` task abort** is a documented limitation. Tools
  that legitimately need elicitation cannot run as v1 tasks.
- **ext-apps `main` drift.** Pinned release intentionally ignores
  draft additions. Quarterly refresh cadence.

## Testing matrix

CLAUDE.md says real logic over mocks. The matrix uses real
`@modelcontextprotocol/sdk` servers in-process and Playwright for the
cross-origin iframe layer.

### Phase 0 (transport)

- 307/308 redirect handling on Streamable HTTP.
- `MCP-Session-Id` reuse across requests.
- HTTP 404 → new MCP session, outstanding-task revalidation.
- Authorization-context tuple captured at connection time and immutable
  across the connection's lifetime.

### MCP Apps

- Capability negotiation truthfully gated.
- Discovery: tool `_meta.ui.resourceUri` for a resource omitted from
  `resources/list` still renders; resource without `_meta.ui` falls
  back to text.
- Stable wire format: `sandbox-resource-ready` carries `{ html,
  sandbox, csp, permissions }`. Proxy renders via `srcdoc` + iframe
  `sandbox` attribute + injected `<meta>` CSP.
- Initialization barrier: outbound host requests buffered until
  `ui/notifications/initialized` received; flushed afterward.
- App-only tool visibility:
  - Tool with `visibility: ["app"]` not in model-facing tool list.
  - `tools/call` from a view succeeds when visibility includes
    `"app"`, rejected otherwise.
  - View bound to server A cannot call any tool on server B.
- **`ui/message` semantics**: `role: "user"` only; non-`user` roles
  rejected; consent prompt in host chrome.
- **`displayMode` / `availableDisplayModes` in `HostContext`**, not
  `HostCapabilities`.
- **`toolInfo` in `HostContext`** populated from the in-flight tool
  call.
- CSP enforcement: undeclared `connect-src` blocked; declared origin
  succeeds. Documented `<meta>`-CSP limitations exercised.
- **`ui/open-link` gated by navigation allowlist**, not
  `connectDomains`.
- `size-changed` and `host-context-changed` round-trip.
- Malformed JSON-RPC over `postMessage`: rejected, logged, no host
  crash.
- `postMessage` from wrong origin: rejected.
- `null`-origin `postMessage` from sandbox: accepted only when source
  matches the proxy-controlled inner window.
- First-launch resource review: hash stored; divergent hash refused
  at next launch.
- Data boundary: `structuredContent` and `_meta` never appear in
  model-bound serialization, including across rehydration.

### MCP Tasks

- Per-tool `taskSupport: required` rejects synchronous calls.
- Per-tool `taskSupport: forbidden` rejects task-augmented calls.
- v1 augmentation policy: only `required` (or operator allowlist)
  tools become tasks; `optional` runs synchronously by default.
- **`tasks/result` response carries `related-task` meta**.
- `tasks/get`/`result`/`cancel` requests with the meta present:
  receiver ignores meta, uses param.
- Cancellation after terminal state returns the existing terminal
  status.
- Cursor pagination of `tasks/list` traverses correctly.
- Polling-first runtime: poller calls `tasks/get` at `pollInterval`
  while no user is actively waiting; `tasks/result` not called.
- User opens jobs panel → `tasks/result` fires.
- Disconnect during polling → poller resumes after reconnect.
- HTTP 404 for `MCP-Session-Id` → new session, outstanding taskIds
  revalidated.
- `progressToken` propagates through bridge to view; mapping durable
  across reconnects.
- `model-immediate-response`: emitted as intermediate message; model
  suppressed for that turn; final result appended without overwriting.
- Authorization-context binding: `tasks/list` from a different context
  returns empty; `tasks/get` for another context's task returns
  not-found.
- **Canonical-envelope replay**: `tasks/result` returns the stored
  envelope (success and error cases). Oversized payloads offloaded
  and rehydrated correctly from blob storage.
- **`input_required` runtime**: server transitions a task to
  `input_required`; host writes failed-equivalent terminal envelope,
  surfaces unsupported-status error, and refuses subsequent
  `tasks/result` on it.

## Effort summary

| Phase | Estimate |
|---|---|
| 0 — Transport reliability + auth-context substrate | 1 week |
| 1 — Types + sandbox infra + bridge wrapper | 1 week |
| 2 — Apps v1 end-to-end + capability turn-on | 2 weeks |
| 3 — HostContext richness | 3–5 days |
| 4 — `tool-input-partial` (optional) | 1 week (risk) |
| 5 — MCP Tasks v1 (parallel with 2–3) | 2 weeks |
| 6 — Hardening + browser matrix + ops docs | 1 week |
| **Total (serial, excl. parallelism)** | **~7–8 weeks** |
| **Phases 0 + 1 + 2 + 5** (functional CAD app, Tasks v1) | **~5 weeks** |

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
- MDN: Window.postMessage origin validation
  <https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage>
