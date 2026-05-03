# Plan: MCP Apps + MCP Tasks Support in LibreChat

**Status:** Draft / scoping document — no code in this PR.
**Owner:** TBD
**Target branch:** `claude/mcp-apps-spec-support-rEi7X`
**Revision:** v5 — corrects protocol bugs and tightens v1 scope after the
fourth review:

- **Cancellation after terminal state returns `-32602` invalid params**, not
  "existing terminal status." v4's test matrix had this wrong.
- **`input_required` preserves the server's actual task status.** v4 wrote a
  fake failed envelope, which invented protocol state. v5 keeps the
  server-reported `input_required` status and marks a separate host-local
  field `hostHandlingState = "unsupported_lifecycle"`.
- **Drop the API-process background poller.** Active-subscriber polling
  only: a chat tab, a mounted view, or an open jobs panel each runs its
  own poll while present. When the user is gone, polling stops; on return
  the jobs panel reloads via `tasks/list` / `tasks/get`.
- **Drop the durable subscriber registry.** Subscriber sets stay in memory
  per connected client session. On reconnect, resubscribe and reload from
  `tasks/get`.
- **`tasks/result` rehydrates the underlying response shape.** Pointerized
  blob-offload is an internal storage detail; the response wire shape is
  byte-equivalent to what the original request would have returned.
- **`_meta.ui.domain` is explicitly unsupported in v1.** Resources that
  declare it are rejected at review time with a clear error.
- **Asset URL policy.** v1 accepts only self-contained HTML (inline JS/CSS)
  or absolute HTTPS URLs covered by `_meta.ui.csp.resourceDomains`. The
  review pipeline rejects relative asset URLs because `about:srcdoc`
  resolves them against the embedding document, not against the original
  `ui://` URI.
- **PostMessage transport shim.** v4 said "use the official
  `PostMessageTransport`" *and* "no `*` target origins." The SDK's current
  transport sends with `*`. v5 wraps `AppBridge` in a thin transport that
  sends to explicit origins; the SDK's receive validation is preserved.
- **Iframe sandbox flags hardened.** v1 never grants `allow-popups`,
  `allow-top-navigation`, `allow-top-navigation-by-user-activation`, or
  `allow-forms`, regardless of the resource's `_meta.ui.sandbox` request.
  `ui/open-link` is the single navigation escape hatch.
- **Single ACL for all forwarded MCP methods.** Every proxied request from
  a view (`tools/call`, `resources/read`, `ping`, `notifications/message`)
  goes through one central ACL bound to the view's originating MCP server
  connection. Cross-server forwarding is impossible by construction.
- **Resource fetch/hash/review is server-side.** The browser receives an
  already-approved payload; it does not orchestrate `resources/read` or
  hashing.
- **`ui/message` schema-vs-prose note.** The generated stable schema
  literals `role: "user"`. The prose page still says "preserve the
  specified role." We follow the schema and keep `user`-only.
- **CAD example: persist artifact handle, not presigned URL.** Presigned
  URLs are time-limited; storing them in durable task results breaks
  return-later UX.
- **Phase 3 collapsed into Phase 2.** `toolInfo`, theme, locale, timezone,
  `displayMode`, and `availableDisplayModes` are basic HostContext surface;
  shipping Apps without them creates avoidable app-compat churn.

## Goal

Bring LibreChat to a useful, conformant subset of the MCP extensions for
interactive UIs (**MCP Apps**, SEP-1865, stable 2026-01-26) and long-running
operations (**MCP Tasks**, 2025-11-25, experimental). The intent is parity
with the stable subset of Apps and a deliberately narrow polling-first
Tasks v1.

## Closed go/no-go decisions

1. **Sandbox wire format.** Stable wire format only —
   `ui/notifications/sandbox-resource-ready` carries raw `html` plus
   optional sandbox/CSP metadata. The proxy renders the inner iframe via
   `srcdoc` with the iframe `sandbox` attribute and a `<meta>` CSP
   injected into the HTML. Documented `<meta>`-CSP limitations
   (no `sandbox`, no `frame-ancestors`, no `report-uri`) are accepted
   in v1; `sandbox` flags use the iframe attribute, `frame-ancestors`
   is enforced via the proxy.html response header on the sandbox
   origin, `report-uri` is unavailable in v1.
2. **Apps resource model.** Exactly **one predeclared `ui://` resource
   per tool**, discovered via `_meta.ui.resourceUri` on the tool
   definition and fetched server-side with `resources/read`.
   Result-time UI-resource switching, embedded resources,
   resource-link UI transport, and multi-resource responses are out
   of v1.
3. **Tasks ownership model.** v1 is **active-subscriber polling**:
   `tasks/get` runs only while a chat tab, mounted view, or jobs
   panel is observing. `tasks/result` is invoked only when the user
   is actively waiting or has explicitly opened a job's detail view.
   No background API-process poller, no durable subscriber registry.
4. **Authorization context identifier.** v1 binds task ownership to
   `(userId, mcpServerId, oauthSubject || apiKeyFingerprint)`,
   captured at connection time and treated as immutable for that
   connection's lifetime. Anything that changes the tuple invalidates
   the task list for that context.
5. **`_meta.ui.domain` in v1.** Explicitly **unsupported**. Resources
   declaring `domain` are rejected at review time with a clear error
   message. v1 collapses everything to one `MCP_SANDBOX_ORIGIN`.
6. **Asset URL policy.** v1 accepts self-contained HTML (inline
   JS/CSS) or absolute HTTPS asset URLs whose origins are in
   `_meta.ui.csp.resourceDomains`. The review pipeline rejects
   resources that contain relative asset URLs in `<script src>`,
   `<link href>`, `<img src>`, etc.
7. **PostMessage transport.** v1 wraps `AppBridge` from
   `@modelcontextprotocol/ext-apps` with a thin transport that sends
   to **explicit target origins** instead of the SDK transport's
   default `*`. The SDK's receive-side validation
   (`event.source`, JSON-RPC envelope schema) is preserved.

## Pinned protocol versions

- Apps: stable dated spec **`2026-01-26`**.
- Tasks: dated spec **`2025-11-25`** (experimental).
- ext-apps types: a pinned package release matching the stable Apps
  spec date. `main` is excluded; it carries draft additions
  (`ui/download-file`, `HostCapabilities.downloadFile`) that are not
  in the stable prose.
- Validators are generated from the pinned release. No hand-typed
  schemas for the wire surface.

### Note on `ui/message` role

The generated stable schema makes `role` a literal `"user"`. The
spec prose page still contains a sentence saying the host should
"preserve the specified role." We follow the generated schema, which
the spec site treats as authoritative for normative requirements.
v1 rejects non-`user` roles with a clear error.

## Out of v1 scope (explicit)

| Feature | Why deferred |
|---|---|
| `_meta.ui.domain` | Single sandbox origin in v1 |
| `ui/download-file` | Not in stable Apps |
| `listChanged` for app-exposed tools | Out of stable Apps |
| Multi-resource tool responses | Stable spec defers |
| Result-time UI-resource switching | Stable spec defers |
| State restoration across remounts | Stable spec defers |
| `ui/message` with non-`user` roles | Stable schema is `user`-only |
| Relative asset URLs in resource HTML | `srcdoc` resolves against embedder |
| `allow-popups` / `allow-top-navigation` / `allow-forms` sandbox flags | `ui/open-link` is the single navigation/escape path |
| `fullscreen` / `pip` display modes | Inline only in v1 |
| `tool-input-partial` streaming | Requires `@librechat/agents` changes |
| `input_required` lifecycle support | Depends on elicitation/sampling |
| `tasks.requests.sampling` / `elicitation` | Same |
| API-process background poller | Active-subscriber polling instead |
| Durable subscriber registry | In-memory per session instead |
| Same-origin sandbox in production | Cross-origin only |
| Top-level `Permissions-Policy` rollout | Defense-in-depth, not v1 critical path |
| `Cross-Origin-Embedder-Policy: require-corp` | Same |
| Tokenized `/view/:token` hardened delivery | Future, post-v1 host extension |
| Proactive `_meta.ui.resourceUri` crawl after every `tools/list` | First-launch review + hash pinning is enough |

## Background

### MCP Apps (extension `io.modelcontextprotocol/ui`) — stable subset

- Tools link to a UI resource via `_meta.ui = { resourceUri, visibility }`
  on the tool definition. UI resources may be omitted from
  `resources/list`; discovery flows through tool metadata. Plain text
  fallback when Apps are unavailable is mandatory.
- Resource `_meta.ui` (returned by `resources/read`) carries CSP
  (`connectDomains`, `resourceDomains`, `frameDomains`,
  `baseUriDomains`), iframe `permissions`, sandbox `domain`, and
  `prefersBorder`. `connectDomains` governs **fetch / XHR / WebSocket**
  from view JS — it is **not** a navigation/download allowlist.
- **Web-host sandbox flow** (stable wire format):
  1. Host renders a sandbox-proxy iframe served from
     `MCP_SANDBOX_ORIGIN` (different origin from the host).
  2. Proxy emits `ui/notifications/sandbox-proxy-ready`.
  3. Host (after server-side review of the resource HTML) sends
     `ui/notifications/sandbox-resource-ready` with
     `{ html, sandbox?, csp?, permissions? }`.
  4. Proxy renders the inner iframe with `srcdoc=html`,
     `sandbox=<flags>` (host-filtered, see hardened defaults below),
     and `allow=<permissions intersected with host policy>`.
- **Initialization sequence** (host respects both barriers):
  1. View sends `ui/initialize` with `appInfo`, `appCapabilities`,
     `protocolVersion`.
  2. Host returns `protocolVersion`, `hostInfo`, `hostCapabilities`,
     `hostContext`.
  3. View sends `ui/notifications/initialized` notification.
  4. Only after step 3 may the host send `tool-input`, `tool-result`,
     etc.
- **`HostContext` carries** `theme`, CSS variables, `displayMode`
  (active), `availableDisplayModes`, `containerDimensions`, `locale`,
  `timeZone`, `platform`, `deviceCapabilities`, `safeAreaInsets`, and
  `toolInfo` — metadata about the tool call that instantiated the view.
- **`HostCapabilities` carries** sandbox grants and modality
  declarations — **not** the display mode set.
- View → Host (v1 subset): `ui/open-link`, `ui/message`,
  `ui/request-display-mode`, `ui/update-model-context`, plus standard
  MCP `tools/call`, `resources/read`, `notifications/message`, `ping`.
- Host → View (v1 subset): `ui/initialize` response, notifications for
  `tool-input`, `tool-result`, `tool-cancelled`, `host-context-changed`,
  `size-changed`, plus `ui/resource-teardown`.
- **`ui/message`**: `role: "user"` only. Adds a message to the
  conversation context after host-chrome user consent.
- **`ui/update-model-context`**: each update overwrites the previous;
  the host typically forwards only the last update before the next
  user message.
- **Same-server binding for all forwarded MCP methods.** Every method
  proxied from a view (`tools/call`, `resources/read`, `ping`,
  `notifications/message`) is dispatched to the MCP server connection
  the view was launched against — never another. Enforced by a single
  central ACL function (no per-method enforcement).
- **App-only tool visibility** (`visibility: ["app"]`): app-only tools
  are filtered out of the model-facing tool list and rejected by the
  central ACL when called from a view whose visibility doesn't
  include `"app"`.

Reference: <https://github.com/modelcontextprotocol/ext-apps>

### MCP Tasks (capability `tasks`) — polling-first subset

- Augments standard requests with task semantics. Server returns
  immediately with a task handle.
- **Two-level negotiation.** Server advertises
  `capabilities.tasks.requests.tools.call`. Each tool independently
  declares `execution.taskSupport` as `forbidden`, `optional`, or
  `required`. v1 task-augments only `required` tools or an explicit
  operator allowlist.
- Status lifecycle relevant to v1: `working` → `completed` |
  `failed` | `cancelled`.
- **`input_required` handling.** It's a non-terminal status the host
  cannot fulfill in v1 (depends on elicitation/sampling). When the
  server transitions a task into `input_required`, the host:
  - Persists the server's actual `status: "input_required"`
    unmodified.
  - Sets a separate host-local field `hostHandlingState =
    "unsupported_lifecycle"`.
  - Surfaces a clear "this server requires interactive input that
    LibreChat cannot provide yet" message in the running-jobs UI.
  - Does not invoke `tasks/result` on it (which would block).
  - May call `tasks/cancel` on user request.
  - Does **not** fabricate a `failed` terminal envelope.
- **Task object** carries `taskId`, `status`, `createdAt`,
  `lastUpdatedAt`, `ttl`, optional `pollInterval`. Server-supplied
  values are authoritative.
- Methods: `tasks/get`, `tasks/list`, `tasks/result`, `tasks/cancel`.
- **Active-subscriber polling.** A poll is owned by an active
  observer (a mounted view, an open jobs panel, an active chat tab
  watching its task). When no observer exists, polling stops; the
  task continues server-side. On user return, the jobs panel uses
  `tasks/list` + `tasks/get` to refresh state.
- **`tasks/cancel` after terminal status.** The spec requires the
  receiver to **reject** with `-32602` invalid params. v1 client
  honors that — the running-jobs cancel button is disabled in
  terminal states; if a race produces a late cancel, the
  `-32602` is surfaced as a no-op to the user.
- **Related-task metadata rules**:
  - All requests, notifications, and responses related to a task
    carry `_meta["io.modelcontextprotocol/related-task"] =
    { taskId }` *except* as noted below.
  - `tasks/get`, `tasks/result`, `tasks/cancel` **requests** use the
    `taskId` parameter as source of truth; receivers ignore the meta
    tag if present on those requests.
  - `tasks/get` and `tasks/cancel` **responses** carry Task objects
    with their own `taskId` — meta tag not required.
  - **`tasks/result` *response* MUST carry the meta tag** because the
    underlying request's result envelope has no `taskId` of its own.
- **Result fidelity.** `tasks/result` returns the same successful
  result or JSON-RPC error the underlying request would have
  produced. v1 stores **canonical JSON envelopes** preserving enough
  metadata to reconstruct the semantic response. Oversized payloads
  (>~12 MiB to leave headroom under the 16 MiB BSON limit) and
  binary-heavy blobs offload to immutable blob storage.
  **Pointerization is an internal storage detail.** When responding
  to `tasks/result`, the host rehydrates the original response shape
  byte-equivalent to what the original request would have returned —
  it does not return host-invented URL/hash structures to the caller.
- Status notifications are optional; `pollInterval` is advisory; the
  host treats both as hints.
- Servers may return
  `_meta["io.modelcontextprotocol/model-immediate-response"]` — a
  model-facing string letting the model continue reasoning while the
  task runs.
- **Authorization context binding.** Task access bound to the
  authorization-context tuple captured at task creation; refused at
  retrieval if the tuple doesn't match.
- **Streamable HTTP only.** v1 does not run Tasks over stdio, WS, or
  SSE. Transport reuses `MCP-Session-Id`, sends
  `MCP-Protocol-Version`, and handles HTTP 404 → new MCP session +
  outstanding-task revalidation. Phase 0 lands the transport fixes
  that block this.
- `tasks/list` is cursor-paginated, filtered by authorization
  context, and surfaces underlying JSON-RPC errors verbatim.

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
| Sampling / elicitation | Missing | blocks `input_required` |
| Streamable HTTP reliability (307/308, session reuse, immediate-disconnect) | Buggy — Phase 0 | transport layer |
| Per-user header/token scoping (recent advisory) | Hardening required | transport layer |
| Apps capability negotiation | Missing | — |
| `_meta.ui.resourceUri`-driven discovery (server-side) | Missing | — |
| Cross-origin sandbox proxy + stable wire-format flow | Missing | — |
| `AppBridge` wrapper with explicit-origin transport shim | Missing | — |
| `ui/initialize` handshake + truthful `hostContext` (full surface) | Missing | — |
| Single-ACL forwarded-method enforcement (incl. cross-server isolation) | Missing | — |
| First-launch resource review (server-side) + hash pinning + asset-URL validator | Missing | — |
| Per-resource CSP via `<meta>` injection | Missing | — |
| Trust UX (sandbox boundary chrome) | Missing | — |
| MCP Tasks (per-tool negotiation, active-subscriber polling, auth-context binding, canonical-envelope persistence with shape rehydration) | Missing | — |
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
- Tasks capability turns on at the end of Phase 4.
- `tasks.requests.*` published exhaustively for implemented
  directions only.
- `hostCapabilities` and `hostContext.availableDisplayModes` are
  truthful: v1 lists only `inline`.

## Web-host architecture

### Wire-format-compliant flow

- **Outer:** the host page on LibreChat's origin embeds a single
  iframe served from `MCP_SANDBOX_ORIGIN` (different origin). That
  iframe loads a static `proxy.html` shipped by LibreChat. The
  sandbox-origin response includes `Content-Security-Policy:
  frame-ancestors <librechat-origin>;` and disables caching. **No
  application authentication runs at the sandbox origin.**
- **Bridge wrapper.** The host wraps `AppBridge` from
  `@modelcontextprotocol/ext-apps`. The transport layer is a thin
  shim around `PostMessageTransport`'s receive logic that sends with
  **explicit target origins** instead of the SDK default of `*`. The
  SDK's `event.source` and JSON-RPC envelope validation is preserved.
- **Wire flow:**
  1. Proxy emits `ui/notifications/sandbox-proxy-ready`.
  2. Host fetches the resource server-side via `resources/read`,
     runs the resource through the review pipeline (asset-URL
     validation, hash check, CSP synthesis), and sends
     `ui/notifications/sandbox-resource-ready` with
     `{ html, sandbox, csp, permissions }`.
  3. Proxy creates an inner iframe with `srcdoc=html`, host-filtered
     `sandbox` flags, and `allow=<filtered permissions>`.
  4. The view runs the standard initialization handshake before the
     host sends `tool-input`, `tool-result`, etc.

### `postMessage` validation

- Senders specify exact target origins (no `*`).
- Receivers validate `event.origin` against an exact allowlist (no
  partial / suffix match), `event.source` against expected window
  refs where applicable, and the JSON-RPC envelope schema before
  dispatch.
- Sandboxed `null` origins accepted only when the source matches the
  proxy-controlled inner window.
- Initialization barrier: outbound host requests are queued until
  both `ui/initialize` response is sent and the view's
  `ui/notifications/initialized` is received.

### Iframe sandbox flags (hardened defaults)

The host filters `_meta.ui.sandbox` requests against an allowlist:

- **Always granted (when requested):** `allow-scripts`,
  `allow-modals`, `allow-pointer-lock`, `allow-orientation-lock`,
  `allow-presentation`.
- **Never granted in v1, regardless of request:**
  - `allow-popups`, `allow-popups-to-escape-sandbox` — would let the
    view spawn windows outside the consent flow.
  - `allow-top-navigation`,
    `allow-top-navigation-by-user-activation` — would let the view
    navigate the parent.
  - `allow-forms` — the Apps CSP metadata has no form-action
    allowlist; deferred until one exists.
  - `allow-same-origin` — combined with `allow-scripts` defeats the
    sandbox.

`ui/open-link` is the only navigation escape hatch and runs through
the host navigation allowlist.

### Single ACL for forwarded MCP methods

All proxied MCP requests from a view flow through one function:

```
forwardMcpRequestFromView(view, request)
```

It enforces:

- The method is in the v1 forwarding whitelist (`tools/call`,
  `resources/read`, `ping`, `notifications/message`).
- For `tools/call`: target tool's `_meta.ui.visibility` includes
  `"app"`.
- The dispatched MCP server connection is **always** the connection
  the view was launched against. Cross-server forwarding is
  impossible by construction.
- Logs every forwarded request for audit.

### Sandbox origin operator config

- `MCP_SANDBOX_ORIGIN` (URL) — required. Different origin from the
  LibreChat application origin. A subdomain on the same eTLD+1 is
  sufficient and is the recommended default.
- No `MCP_APPS_ALLOW_SAME_ORIGIN`. Same-origin operation is dev-only
  and reachable only when `NODE_ENV !== "production"`.

## CSP, permissions, downloads

### CSP

- Inner-view CSP delivered via `<meta http-equiv="Content-Security-
  Policy">` injected before the closing `</head>` of the `html`
  payload.
- Per-resource policy built from `_meta.ui.csp` (`connectDomains` →
  `connect-src`; `resourceDomains` → `img-src`/`font-src`/`media-src`/
  `script-src`/`style-src`; `frameDomains` → `frame-src`;
  `baseUriDomains` → `base-uri`), intersected with a host deny list.
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
- All declared origins must be enumerated, including bundle hosts.
  The injector refuses HTML whose CSP would block its own static
  assets.
- Documented `<meta>`-CSP limitations: `sandbox`, `frame-ancestors`,
  `report-uri` cannot be expressed. `sandbox` uses the iframe
  attribute; `frame-ancestors` is enforced by the proxy.html
  response header on the sandbox origin; `report-uri` is unavailable
  in v1.

### Asset URL validation

The review pipeline (server-side) parses each candidate `ui://`
resource and rejects:

- Any `<script src=…>`, `<link href=…>`, `<img src=…>`,
  `<iframe src=…>`, etc. whose URL is **relative** (`./foo.js`,
  `/foo.js`, `foo.js`).
- Any absolute URL whose origin is not in
  `_meta.ui.csp.resourceDomains`.
- Any `<base href=…>` tag (avoids attempts to retarget relative
  resolution).

`about:srcdoc` resolves relative URLs against the embedding
document, not against `ui://`, so apps relying on relative paths
silently break. v1 makes that an explicit error at review time
rather than a runtime mystery.

### Permissions

- `_meta.ui.permissions` maps to the iframe `allow` attribute,
  intersected with what the host considers safe.
- Top-level `Permissions-Policy` rollout and
  `Cross-Origin-Embedder-Policy: require-corp` are out of v1.

### Navigation and downloads

- `ui/open-link` is gated against a separate
  `MCP_APPS_NAVIGATION_ALLOWLIST` host config — **not**
  `_meta.ui.csp.connectDomains`.
- Default v1 download UX: `ui/open-link` to a presigned URL whose
  origin is in the navigation allowlist. The user's browser handles
  the download.
- `ui/download-file` is out of v1.

## Data boundary rules

- **`content`** on a tool result → conversation context
  (model-visible).
- **`structuredContent`** → UI rendering only. Never added to model
  context, never persisted into model-visible payloads.
- **`_meta`** → not for model context.
- **`ui/update-model-context`** → the latest update before the next
  user message is folded into model context. Earlier updates are
  discarded.
- Task results follow the same rules.
- The agent loop, persistence layer, and rehydration / replay path
  share a single helper that strips non-model fields before model
  exposure. Tests assert that `structuredContent` and `_meta` never
  appear in any model-bound serialization.

## Resource review (server-side)

- All `_meta.ui.resourceUri` discovery, fetching, asset-URL
  validation, hashing, CSP synthesis, and caching happens in the
  host backend. The browser receives an **already-approved**
  payload.
- **First-launch review.** The first time a tool with `_meta.ui.
  resourceUri` is invoked, the host fetches via `resources/read`,
  validates asset URLs, hashes the HTML, and stores
  `(serverName, resourceUri, sha256, firstSeen)` in
  `MCPResourceReview`. Operator policy decides auto-allow vs
  manual-review. Until approved, the tool falls back to text-only.
- **Hash pinning.** On subsequent launches, the host re-reads,
  re-hashes, and refuses to render if the hash diverges from the
  operator-approved pin (when configured).
- **No proactive crawl** of `_meta.ui.resourceUri` after every
  `tools/list`. That is product polish and out of v1.

## Trust UX

- Persistent border + header on every view labeled "App from
  `<server name>`" with click-through to server identity, OAuth
  scopes, and resource hash.
- Label uses LibreChat-controlled fonts/colors rendered **outside**
  the view iframe so app CSS cannot override.
- Permission prompts (`ui/message` consent, `ui/open-link`
  confirmation) appear in host chrome.
- Host-rendered "exit app" affordance always available.

## Security and transport prerequisites (Phase 0)

Phase 0 is gating both Apps and Tasks:

- Resolve documented Streamable HTTP issues (immediate-disconnect,
  307/308 redirect handling), wire `MCP-Session-Id` reuse and
  `MCP-Protocol-Version` headers consistently, implement HTTP 404
  → new MCP session with outstanding-task revalidation.
- Close per-user header/token scoping for shared server definitions
  (the recent advisory). Define and enforce the
  authorization-context tuple
  `(userId, mcpServerId, oauthSubject || apiKeyFingerprint)`.
- Operator policy defaults for server creation, transport
  allowlists, per-user task quotas, result-size caps. Defaults lean
  toward denial.

## Phased plan

### Phase 0 — Transport reliability + auth-context substrate (≈1 week)

- Streamable HTTP fixes (redirects, session reuse, disconnect).
- Authorization-context tuple computed at connection time.
- Operator policy defaults.

### Phase 1 — Types + sandbox infra + bridge wrapper (≈1 week)

End of phase: sandbox origin serves static `proxy.html`; bridge
handshake works against a fixture server; **no capability
advertised**.

- Types in `packages/data-provider`, generated from the pinned
  ext-apps release.
- `packages/api/src/mcp/connection.ts` reads per-tool
  `execution.taskSupport`. Does not advertise Apps or Tasks.
- Sandbox infrastructure: static `proxy.html` served from
  `MCP_SANDBOX_ORIGIN` with `frame-ancestors` CSP header.
- Wrap `AppBridge`. Implement the explicit-origin transport shim
  around `PostMessageTransport`'s receive logic. Add
  origin/source/schema validation in front of the SDK transport.
- `MCPResourceReview` collection scaffold + asset-URL validator.
- Tests with `mongodb-memory-server` + real
  `@modelcontextprotocol/sdk` + Playwright cross-origin iframes.

### Phase 2 — Apps v1 end-to-end + capability turn-on (≈2–3 weeks)

End of phase: Apps capability advertised; minimum-viable Apps
render inline with full HostContext.

- New `client/src/components/Chat/MCPApp/` (`ProxyFrame.tsx`,
  `useMcpApp.ts`).
- Single predeclared `ui://` resource per tool. Server-side
  fetch + review + CSP synthesis. No result-time switching.
- Host-side handlers (v1 subset):
  - `ui/open-link` — gated by host navigation allowlist;
    confirmation in host chrome.
  - `ui/message` — `role: "user"` only; consent in host chrome;
    non-`user` rejected with clear error.
  - `ui/request-display-mode` — returns the actually-resulting
    mode; only `inline` honored.
  - `ui/update-model-context` — overwrite semantics.
- **Single-ACL `forwardMcpRequestFromView` for `tools/call`,
  `resources/read`, `ping`, `notifications/message`** — enforces
  whitelist, app visibility for `tools/call`, and same-server
  binding for **all** methods.
- Host-side notifications: `tool-input`, `tool-result`,
  `tool-cancelled`, `host-context-changed`, `size-changed`.
  Implement `ui/resource-teardown`.
- **Full HostContext on initialize**: theme tokens (CSS variables),
  locale, timezone, platform, safe-area insets, `displayMode`
  (`inline`), `availableDisplayModes` (`["inline"]`), `toolInfo`
  populated from the in-flight tool call.
- `host-context-changed` notifications on theme/locale/dimension
  changes.
- First-launch resource review (incl. asset-URL validation); hash
  pinning; `MCPBuilder/` UI for approvals.
- Trust UX chrome around every view.
- Reject resources declaring `_meta.ui.domain` with a clear error.
- Data-boundary helper plumbed through agent tool-result handling
  and persistence; tests assert no `structuredContent`/`_meta`
  leaks to the model.
- **End of phase**: enable Apps capability advertisement, gated
  by interop matrix passing.

### Phase 3 — `tool-input-partial` (≈1 week, optional)

- Surface partial tool-call arguments through the agent loop so
  views see `tool-input-partial`.
- Coordinate with `@librechat/agents`. Optional for v1.

### Phase 4 — MCP Tasks v1 (≈2 weeks; can run parallel to Phase 2)

End of phase: Tasks capability advertised, sub-flags exhaustive
for implemented directions.

- `packages/api/src/mcp/`:
  - Honor per-tool `execution.taskSupport`. v1 task-augments only
    `taskSupport: required` tools or operator allowlist.
  - **Active-subscriber polling.** Each subscriber (mounted view,
    open jobs panel, active conversation) owns its own poll
    against `tasks/get` while present. When no subscriber is
    observing, polling stops; the task continues server-side.
    `tasks/result` is invoked only when the user is actively
    waiting or opens a job detail. No background API-process
    poller.
  - **Subscriber registry is in-memory per connected session.**
    On reconnect, subscribers re-register and reload from
    `tasks/get`. No durable subscriber state.
  - **Canonical-envelope persistence** in a new `MCPTask`
    collection, storing canonical JSON of the original request
    and the terminal response/error envelope, plus indexed
    `(userId, mcpServerId, oauthSubject || apiKeyFingerprint,
    taskId, sessionId, status, hostHandlingState, createdAt,
    lastUpdatedAt, ttl, pollInterval, progressToken,
    modelImmediateResponse, lastSeen, correlationConversationId)`.
    Payloads >12 MiB or binary-heavy blobs offload to immutable
    blob storage with the envelope referencing them by URL/hash.
  - **`tasks/result` rehydration**: on retrieval, the host
    rehydrates the original response shape byte-equivalent to
    what the original underlying request would have returned.
    Pointerization is a storage detail and must not leak into the
    response.
  - Strict related-task metadata rules:
    - Add on all task-related requests, notifications, and
      responses *except* on `tasks/get` / `tasks/result` /
      `tasks/cancel` **requests**.
    - **Add on `tasks/result` response.**
  - **Cancellation after terminal returns `-32602`** invalid
    params. UI disables the cancel button on terminal tasks; if a
    race produces a late cancel, surface as a no-op.
  - **`input_required` handling**:
    - Persist server-reported `status: "input_required"` unmodified.
    - Set `hostHandlingState = "unsupported_lifecycle"`.
    - Surface in running-jobs UI as "this server requires
      interactive input that LibreChat cannot provide yet."
    - Do not invoke `tasks/result` on it. Do not fabricate a
      `failed` envelope.
    - Allow `tasks/cancel` on user request.
  - **Authorization context binding** at task creation; verify on
    every retrieval. `tasks/list` filtered by current context.
  - **Streamable HTTP only.** Persist `MCP-Session-Id` per task.
    HTTP 404 → start a new MCP session, revalidate outstanding
    `taskId`s via `tasks/get`. Treat "task not found" as
    terminal-with-error.
- `progressToken` correlated by the related-task meta and routed
  through the bridge to active subscribers. **No durable
  subscriber registry**; subscribers are session-scoped.
- **`model-immediate-response` runtime**:
  - When present, agent emits an intermediate assistant-visible
    message containing the server-supplied string, clearly marked
    as a preliminary placeholder.
  - Model is suppressed from speaking its own placeholder for the
    same call.
  - Final task result appended as a separate message; placeholder
    never overwritten.
  - When absent, agent uses a neutral default.
- Frontend running-jobs surface in
  `client/src/components/SidePanel/`: cursor-paginated, status
  badges, progress bars (when `progressToken` present), cancel
  button (disabled for terminal and `input_required` states),
  deep-link to originating conversation. Localize under
  `com_ui_mcp_task_*`.
- **End of phase**: enable Tasks capability advertisement.

### Phase 5 — Hardening, browser matrix, ops docs (≈1 week)

- Threat model write-up.
- Browser support matrix:
  - Chromium ≥ stable - 2: full support.
  - Firefox ≥ ESR: full support.
  - Safari ≥ 17: cross-site cookie / storage-partitioning quirks
    don't affect v1 (sandbox origin is stateless).
- Operator docs: `MCP_SANDBOX_ORIGIN` setup, CSP defaults and
  override surface, navigation allowlist config, per-user task
  quotas, result-size caps, transport allowlists,
  resource-review policy, migration story (long-running →
  Tasks).
- E2E + interop test matrix.

## Worked example: CAD generative-design app

The app is **one predeclared `ui://cad-app` resource** linked from a
single `cad.workbench` tool. The same view persists for the entire
session and refreshes itself by calling other CAD-server tools as
the user navigates.

1. User runs the CAD MCP server. The `cad.workbench` tool's
   definition carries `_meta.ui.resourceUri = "ui://cad-app"`.
   The host fetches the HTML server-side via `resources/read`,
   runs the asset-URL validator (rejecting any relative URLs),
   re-hashes and validates against the operator-approved pin,
   injects CSP `<meta>`, and sends `sandbox-resource-ready`.
   The proxy renders the inner iframe via `srcdoc` + filtered
   sandbox flags.
2. The view starts in an "upload" panel. It calls
   `cad.create_upload_url` (`taskSupport: forbidden`) over the
   bridge for a presigned PUT URL. The view PUTs the file
   directly to blob storage (CSP `connect-src` from
   `_meta.ui.csp.connectDomains` whitelists the storage origin).
   It then calls `cad.ingest({ key })` (`taskSupport: required`),
   which runs as a task. The mounted view subscribes to its own
   poll loop on `tasks/get`.
3. When `cad.ingest` completes, its `tools/call` returns a
   `CallToolResult` whose `structuredContent` carries the
   tessellated GLTF + B-Rep face IDs and whose `content` carries
   a textual summary for the model. The view receives this via
   `tool-result` and switches itself from the upload panel to
   the viewer panel — same `ui://` resource, internal SPA
   navigation. `structuredContent` never reaches the model.
4. User picks holes/faces, selects material, clicks Finish.
   Selection state is mirrored to the host via
   `ui/update-model-context` (overwrite semantics) so the next
   LLM turn sees the current selection.
5. The view calls `cad.submit_job(...)`
   (`taskSupport: required`, ~30 min). Server returns a task
   handle plus a `model-immediate-response` like "Job submitted,
   ID 12345 — results in ~30 minutes". Agent emits that as a
   placeholder; model suppressed for this turn.
6. The view transitions to a "job status" panel — same `ui://`
   resource. While mounted, the panel polls. After the user
   closes the chat, polling stops; the task continues
   server-side.
7. User comes back. The jobs panel calls `tasks/list` (filtered
   by auth-context tuple) and resubscribes its poll. When the
   task is `completed`, the panel calls `tasks/result` because
   the user is now actively waiting. The stored canonical
   envelope rehydrates to the original response shape; its
   structured content carries an **artifact handle**
   (`{ artifactId, objectKey }`), not a presigned URL — presigned
   URLs are time-limited and would already be dead. When the user
   clicks Download, the view calls a `cad.get_download_url(
   artifactId)` MCP tool that mints a fresh short-TTL presigned
   URL; the view then opens it via `ui/open-link` against the
   host navigation allowlist.

## Risks / open questions

- **`<meta>`-CSP limitations** accepted in v1. Operators wanting
  stricter controls wait for the post-v1 hardened-delivery
  extension.
- **Operator deployment cost.** A single sandbox subdomain is
  required.
- **Asset URL strictness may reject otherwise-valid app bundles.**
  Document the rule clearly so app authors ship self-contained or
  absolute-HTTPS HTML.
- **`tool-input-partial`** requires `@librechat/agents` changes.
- **Out-of-band notification** stays in the external system's
  domain via webhook → email; not solved by Tasks.
- **SEP-2669 (pause/resume/steer)** and **SEP-2268 (subtasks)**
  still in review. Not in v1.
- **`input_required` is a documented limitation.** Tools that
  legitimately need elicitation cannot complete as v1 tasks; users
  see the unsupported-lifecycle message and can cancel.
- **`ui/update-model-context` does not persist view state by
  spec.** Apps that need durable state keep it on their own MCP
  server.
- **ext-apps `main` drift.** Pinned release intentionally ignores
  draft additions. Quarterly refresh cadence.

## Testing matrix

CLAUDE.md says real logic over mocks. The matrix uses real
`@modelcontextprotocol/sdk` servers in-process and Playwright for
the cross-origin iframe layer.

### Phase 0

- 307/308 redirect handling on Streamable HTTP.
- `MCP-Session-Id` reuse across requests.
- HTTP 404 → new MCP session, outstanding-task revalidation.
- Authorization-context tuple captured at connection time and
  immutable across the connection's lifetime.

### MCP Apps

- Capability negotiation truthfully gated.
- Discovery: tool `_meta.ui.resourceUri` for a resource omitted
  from `resources/list` still renders; resource without
  `_meta.ui` falls back to text.
- Stable wire format: `sandbox-resource-ready` carries
  `{ html, sandbox, csp, permissions }`. Proxy renders via
  `srcdoc` + filtered iframe `sandbox` attribute + injected
  `<meta>` CSP.
- **Iframe sandbox flag filter**: requested `allow-popups`,
  `allow-top-navigation`, `allow-forms`, `allow-same-origin`
  stripped at host before render.
- **Asset URL validator**: HTML containing `<script src="./x">`,
  `<link href="/x">`, `<base>`, or absolute URLs not in
  `resourceDomains` is rejected at review time.
- **`_meta.ui.domain`**: resources declaring it are rejected with
  a clear error.
- Initialization barrier: outbound host requests buffered until
  `ui/notifications/initialized` received; flushed afterward.
- App-only tool visibility:
  - Tool with `visibility: ["app"]` not in model-facing tool list.
  - Bridge ACL accepts when visibility includes `"app"`, rejects
    otherwise.
  - **Cross-server isolation for ALL forwarded methods**: a view
    bound to server A cannot call `tools/call` *or*
    `resources/read` against server B.
- **`ui/message`**: `role: "user"` accepted; any other role
  rejected with a clear error; consent prompt in host chrome.
- **`displayMode` / `availableDisplayModes` in `HostContext`**.
- **`toolInfo`** populated in `HostContext`.
- CSP enforcement: undeclared `connect-src` blocked; declared
  origin succeeds. `<meta>`-CSP limitations exercised.
- `ui/open-link` gated by navigation allowlist, not
  `connectDomains`.
- `size-changed` and `host-context-changed` round-trip.
- Malformed JSON-RPC over `postMessage`: rejected, logged, no
  host crash.
- `postMessage` from wrong origin: rejected.
- `null`-origin `postMessage` from sandbox: accepted only when
  source matches the proxy-controlled inner window.
- **PostMessage transport shim**: outbound sends use exact target
  origins, never `*`.
- First-launch resource review: hash stored; divergent hash
  refused at next launch.
- Data boundary: `structuredContent` and `_meta` never appear in
  model-bound serialization, including across rehydration.

### MCP Tasks

- Per-tool `taskSupport: required` rejects synchronous calls.
- Per-tool `taskSupport: forbidden` rejects task-augmented calls.
- v1 augmentation policy: only `required` (or operator
  allowlist) tools become tasks; `optional` runs synchronously.
- **`tasks/result` response carries `related-task` meta**.
- `tasks/get`/`result`/`cancel` requests with the meta present:
  receiver ignores meta, uses param.
- **Cancellation after terminal status returns `-32602` invalid
  params**. UI disables the cancel button on terminal tasks.
- Cursor pagination of `tasks/list` traverses correctly.
- **Active-subscriber polling**: poll runs while observer
  mounted; stops when observer leaves; resumes on return.
- **No background poller**: with no subscribers, no
  `tasks/get` traffic is generated.
- User opens jobs panel → `tasks/result` fires for terminal
  tasks; `tasks/get` resumes for in-flight tasks.
- Disconnect during polling → subscriber resubscribes after
  reconnect via `tasks/list` + `tasks/get`.
- HTTP 404 for `MCP-Session-Id` → new session, outstanding
  taskIds revalidated.
- `progressToken` propagates through bridge to active subscribers
  via in-memory mapping.
- `model-immediate-response`: emitted as intermediate message;
  model suppressed; final result appended without overwriting.
- Authorization-context binding: `tasks/list` from a different
  context returns empty; `tasks/get` for another context's task
  returns not-found.
- **`tasks/result` rehydration**: response shape byte-equivalent
  to original request's; pointerized blob offloads rehydrated
  back to inline shape (or original CallToolResult linkage)
  before responding.
- **`input_required` runtime**:
  - Server transitions a task to `input_required`.
  - Host preserves `status: "input_required"` and sets
    `hostHandlingState = "unsupported_lifecycle"`.
  - Running-jobs UI surfaces the unsupported-lifecycle message.
  - Host does not call `tasks/result` on it; does not write a
    `failed` envelope.
  - User-triggered `tasks/cancel` succeeds.

## Effort summary

| Phase | Estimate |
|---|---|
| 0 — Transport reliability + auth-context substrate | 1 week |
| 1 — Types + sandbox infra + bridge wrapper | 1 week |
| 2 — Apps v1 end-to-end + full HostContext + capability turn-on | 2–3 weeks |
| 3 — `tool-input-partial` (optional) | 1 week (risk) |
| 4 — MCP Tasks v1 (parallel with 2) | 2 weeks |
| 5 — Hardening + browser matrix + ops docs | 1 week |
| **Total (serial, excl. parallelism)** | **~6–8 weeks** |
| **Phases 0 + 1 + 2 + 4** (functional CAD app, Tasks v1) | **~4–5 weeks** |

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
- 2026 MCP roadmap:
  <https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/>
- MDN: iframe sandbox guidance
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe>
- MDN: srcdoc and base URL behavior
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#attr-srcdoc>
- MDN: Content-Security-Policy and meta-tag limitations
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP>
- MDN: Window.postMessage origin validation
  <https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage>
