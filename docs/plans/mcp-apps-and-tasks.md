# Plan: MCP Apps + MCP Tasks Support in LibreChat

**Status:** Draft / scoping document — no code in this PR.
**Owner:** TBD
**Target branch:** `claude/mcp-apps-spec-support-rEi7X`
**Revision:** v7 — closes the asset-supply-chain contradiction,
adds a remount artifact, splits relay trust hop-by-hop, and ties
host result retention to upstream TTL after the sixth review:

- **v1 approves bytes, not origins.** v6 left a contradiction:
  the plan claimed "browser receives an already-approved
  payload" while still allowing absolute-HTTPS asset URLs from
  `_meta.ui.csp.resourceDomains`. Hash pinning the HTML cannot
  cover external `<script src>` whose bytes can change under a
  stable URL. **v7 cuts external assets out of v1.** The
  resource HTML must be self-contained: inline `<script>` /
  `<style>`, `data:` images permitted, no `<script src>`,
  `<link href>`, `<img src>` to remote origins, no `<base>`.
  `_meta.ui.csp.resourceDomains` is **ignored** in v1 for asset
  loading; it is still honored for `connect-src` lookups via
  `connectDomains` only. App authors bundle their code.
- **Persisted app-instance artifact for remount.** v6 said
  "state restoration across remounts is out of scope," which is
  true at the spec level but collapses into "no reliable
  remount" in practice. v7 introduces an `MCPAppInstance`
  artifact (separate from model-visible message content) that
  records `(conversationId, messageId, mcpServerId, toolName,
  resourceUri, approvedHash, createdAt)`. Re-opening a
  conversation rehydrates the view by replaying the host
  lifecycle around that artifact. View-internal state is still
  not preserved (the spec defers this); the artifact only
  guarantees the view re-instantiates against the same approved
  resource. This unblocks the basic UX of seeing an app render
  again after a refresh without inflating model context.
- **Relay trust split hop-by-hop.** v6 mixed the host-to-proxy
  hop and the proxy-to-inner-frame hop. v7 separates them:
  - **Host ↔ proxy hop**: host accepts messages **only** from
    the proxy window at the exact `MCP_SANDBOX_ORIGIN`. `null`
    origin is **rejected** at the host. Schema validation and
    per-view binding still apply.
  - **Proxy ↔ inner-frame hop**: the proxy runs at a different
    origin, accepts opaque-origin (`null`) messages from its
    own inner iframe, and stamps every relayed message with the
    per-view nonce **before** forwarding to the host. The
    nonce is **proxy-generated and proxy-stamped**, not echoed
    by the app — the app never sees the nonce. The host
    delivers the nonce to the proxy out-of-band on
    `ui/notifications/sandbox-resource-ready` and the proxy
    binds it to the inner window for the lifetime of that view.
  - This makes the nonce a host-vs-proxy trust primitive only,
    immune to a malicious or sloppy app trying to spoof relay
    framing.
- **Host-cached task results expire at upstream TTL.** v6
  allowed opportunistic save while the user is present without
  defining when the host stops trusting that copy. v7 pins the
  rule: any locally cached `tasks/result` payload **must
  expire at or before `createdAt + ttl`** as reported by the
  server. Reading after that window requires a fresh
  `tasks/result` (which the server may answer with "task
  expired"). Persistence beyond upstream TTL is post-v1 and
  requires its own security review; the current `MCPTask`
  collection is a cache, not a durable store.
- **Auth-context binding uses `authContextHash`.** The
  human-readable tuple (`userId`, `mcpServerId`,
  `oauthSubject || apiKeyFingerprint`) stays for logs and
  debugging, but task ownership is bound to a stable
  `authContextHash` over the **normalized effective auth
  configuration** at task creation: user identity, server
  identity, resolved credential source, header/auth
  fingerprint, and config revision. Any change in those
  inputs changes the hash and invalidates task ownership for
  the prior context.
- **One proxy iframe per app instance.** v6's wording was
  ambiguous about whether a single shared proxy could
  multiplex views. v7 mandates one outer sandbox proxy iframe
  per rendered app instance — no pooling, no multiplexing.
  Routing, teardown, audit logging, source pinning, and
  failure handling all simplify, and there is no user-visible
  downside in v1.
- **Single-path "wait for result."** When the user explicitly
  enters a blocking wait (detail-row "wait for result"), the
  host **suspends `tasks/get` for that task** and relies on a
  single `tasks/result` call. Polling resumes only if the
  call fails, is cancelled, or the user leaves the wait
  state. Saves a needless concurrent long-lived request and
  matches the spec's distinction between active and passive
  waiting.
- **Phase 0 split: shared substrate vs Tasks-specific recovery.**
  Outstanding-task revalidation on HTTP 404 is **Tasks-only**
  work — Apps does not need it. v7 keeps only the genuinely
  shared transport substrate (session-reuse correctness,
  consistent `MCP-Session-Id` / `MCP-Protocol-Version`
  headers, basic 404 → re-initialize, per-user token scoping,
  auth-context tuple) in Phase 0; outstanding-task
  revalidation moves into Phase 4. Reduces Apps schedule
  coupling.
- **Safari is decided by runtime relay probe, not user-agent.**
  v6 hinted at falling back "on detected Safari." v7 replaces
  user-agent sniffing with a per-mount relay self-test: the
  host pings the proxy through the relay during initialization
  and verifies the per-view nonce round-trip. If the probe
  fails on any browser (Safari today, anything tomorrow), the
  host falls back to the legacy text-only path for that
  mount with a clear chrome message. This auto-recovers when
  upstream resolves the WebKit issue without a code change.
- **Persisted "approved bytes" hash semantics.** With external
  assets gone, hash pinning becomes meaningful: the
  `approvedHash` is over the full self-contained HTML, and
  divergence means an actual code change. v7 promotes hash
  pinning from advisory to required-when-configured.

- **Host construction order is now an architectural invariant.** The
  `srcdoc` initialization race is real: if HTML is loaded before the
  host's postMessage listener is attached, the view's `ui/initialize`
  is dropped and the bridge silently hangs. v6 pins the only safe
  order — append iframe → grab `contentWindow` from initial
  `about:blank` → construct/connect transport → set `srcdoc` — and
  makes it a Phase 1 exit criterion.
- **Safari/WebKit relay gate.** Upstream has an open issue where the
  sandbox relay sees `event.source === window` instead of
  `inner.contentWindow`, breaking the v5 "match source identity"
  rule. v6 binds inner-frame trust with a per-view nonce
  (`ui/notifications/sandbox-resource-ready` carries it; the inner
  view echoes it through the relay) so source identity is no longer
  the sole trust primitive. Safari ships in v1 only if the relay
  passes its interop matrix; otherwise Safari is documented as
  unsupported for Apps.
- **Data boundary split into model path vs view path.** v5 said
  "strip non-model fields before model exposure," which is correct
  for the model path. v6 adds the inverse rule explicitly: the view
  path **must** preserve the full `CallToolResult` including `_meta`
  for live `tool-result` notifications and for `tasks/result`
  rehydration. Apps and Tasks both depend on this; dropping `_meta`
  to the view breaks `io.modelcontextprotocol/related-task` and
  Apps-server-defined view metadata.
- **`tasks/result` rehydration is semantically equivalent, not
  byte-equivalent.** v5 over-specified this. The spec requires the
  same successful result or JSON-RPC error the underlying request
  would have returned, including `_meta`. It does not require
  preserving JSON key order, whitespace, or original serializer byte
  streams. v6 stores canonical envelopes preserving
  parsed-JSON-RPC structural equivalence and result/error semantics.
- **Jobs panel is status-only by default.** v5's test matrix said
  opening the jobs panel triggers `tasks/result` for every terminal
  task — that contradicts the design text and the spec, which lets
  hosts continue polling and only fetch results on demand. v6 lists
  with `tasks/list`, refreshes with `tasks/get`, surfaces TTL and
  status, and only invokes `tasks/result` on explicit detail entry,
  a "wait for result" action, or an opportunistic save when a
  subscribed task reaches terminal while the user is present.
- **Drop the operator allowlist for `optional` task tools.** The
  protocol-native rule is enough for v1: `required` runs as task,
  `forbidden` does not, `optional` runs synchronously. The
  allowlist added a second policy axis without changing what users
  experience. Removed.
- **AppBridge is lazy-loaded on the client.** Importing
  `AppBridge` + `PostMessageTransport` pulls Zod and adds ~377 KB
  minified to the entry bundle. v6 defers the import until an Apps
  view actually mounts so the default chat bundle stays lean.
- **Phase 0 trimmed.** Public `main` already handles 307/308
  redirects manually and strips credential-bearing headers
  (`authorization`, `cookie`, `mcp-session-id`) on cross-origin
  redirects, matching the Streamable HTTP session-safety guidance.
  Phase 0 now focuses on what actually remains: session-reuse
  correctness, consistent `MCP-Protocol-Version` / `MCP-Session-Id`
  headers, HTTP 404 → re-initialize + outstanding-task
  revalidation, and per-user token scoping.
- **Apps and Tasks release trains decoupled.** Apps are stable;
  Tasks are still experimental. v6 puts each behind its own feature
  flag (`MCP_APPS_ENABLED`, `MCP_TASKS_ENABLED`) so Apps can ship
  first if Tasks slips, without holding back the user-visible UX.
- **Sizing fallback policy added.** Upstream is still carrying a
  fix for default auto-resize collapsing common `height: 100%`
  layouts on first render. v6 defines a host-side fallback height
  policy (minimum 320 px until the first non-zero
  `size-changed`, configurable cap) and an opt-out for aggressive
  shrink-wrap.

Carried forward (still in force):

- Cancellation after terminal returns `-32602` invalid params.
- `input_required` preserves server status; host marks
  `hostHandlingState = "unsupported_lifecycle"`; no fake `failed`
  envelope.
- Active-subscriber polling only; no API-process background
  poller; no durable subscriber registry.
- `_meta.ui.domain` unsupported in v1; single `MCP_SANDBOX_ORIGIN`.
- PostMessage transport wrapper around `AppBridge` sends to
  explicit target origins; preserves SDK receive validation.
- Iframe sandbox hardened defaults; `ui/open-link` is the only
  navigation escape hatch.
- Single ACL for all forwarded MCP methods; cross-server
  forwarding impossible by construction.
- Resource fetch/hash/review is server-side; browser receives
  already-approved payloads (now genuinely true under v7's
  self-contained-HTML rule).
- `ui/message` is `user`-only per generated stable schema.
- CAD example persists artifact handle, not presigned URL.
- Independent feature flags: `MCP_APPS_ENABLED`,
  `MCP_TASKS_ENABLED`.
- Host construction-order invariant.
- Model-path vs view-path data boundary; `_meta` preserved on
  the view path.
- Status-only jobs panel; `tasks/result` on detail entry.
- Lazy-loaded `AppBridge` runtime on the client.
- Sizing fallback height + `shrinkWrap: false` opt-out.
- Tasks-only over Streamable HTTP.
- Phase 3 (`tool-input-partial`) remains optional and post-v1.

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
4. **Authorization context identifier.** v1 binds task ownership
   to a stable `authContextHash` over the normalized effective
   auth configuration at task creation: `userId`, `mcpServerId`,
   resolved credential source, header/auth fingerprint, and
   config revision. The human-readable tuple
   `(userId, mcpServerId, oauthSubject || apiKeyFingerprint)`
   stays in logs and surfaces but is **not** the binding key.
   Anything that changes any input changes the hash and
   invalidates ownership for the prior context.
5. **`_meta.ui.domain` in v1.** Explicitly **unsupported**. Resources
   declaring `domain` are rejected at review time with a clear error
   message. v1 collapses everything to one `MCP_SANDBOX_ORIGIN`.
6. **Asset policy: self-contained HTML only.** v1 approves
   **bytes**, not origins. The resource HTML must be
   self-contained: inline `<script>` and `<style>`, `data:`
   images permitted, and **no** `<script src>`, `<link href>`,
   `<img src>` to remote origins, **no** `<base>`. The review
   pipeline rejects any external-asset reference at review time.
   `_meta.ui.csp.resourceDomains` is **ignored** for asset
   loading in v1 — the resource cannot load remote assets, so
   the field has nothing to permit. `connectDomains` is still
   honored for `connect-src`. This makes hash pinning meaningful
   and lets us truthfully claim the browser receives an
   already-approved payload.
7. **PostMessage transport.** v1 wraps `AppBridge` from
   `@modelcontextprotocol/ext-apps` with a thin transport that sends
   to **explicit target origins** instead of the SDK transport's
   default `*`. The SDK's receive-side validation
   (`event.source`, JSON-RPC envelope schema) is preserved.
8. **Host construction order is an invariant, not a queue.** The
   only safe sequence to render a sandbox-resource view is: append
   the proxy iframe to the DOM → grab its `contentWindow` while it
   is still the initial `about:blank` → construct and connect the
   host transport / message listener → only then deliver `srcdoc`.
   Any other ordering allows the view to send `ui/initialize`
   before the host listens, dropping the handshake silently. This
   is enforced in code and gated as a Phase 1 exit criterion. v6
   does **not** introduce a deferred-target queue inside the
   transport; that approach was rejected upstream as a silent-hang
   risk.
9. **Hop-specific relay trust.** Validation differs by hop:
   - **Host ↔ proxy hop**: host accepts only messages from the
     proxy window at the exact `MCP_SANDBOX_ORIGIN`. `null`
     origin is **rejected** at the host. JSON-RPC envelope
     schema and per-view nonce binding are required.
   - **Proxy ↔ inner-frame hop**: the proxy accepts opaque-
     origin (`null`) messages from its bound inner iframe and
     stamps every relayed inbound message with the **proxy-
     generated, proxy-stamped** per-view nonce before
     forwarding to the host. The app never sees the nonce.
   Mixing the rules across hops was the v6 looseness; v7 keeps
   them separate.
10. **Apps and Tasks release behind separate feature flags.**
    `MCP_APPS_ENABLED` and `MCP_TASKS_ENABLED` are independent.
    Apps may turn on without Tasks; Tasks may stay off through
    multiple Apps minor releases. This keeps the experimental
    Tasks spec from blocking the stable Apps user experience.
11. **One outer sandbox proxy iframe per app instance.** No
    pooling, no multiplexing in v1. Routing, teardown, audit,
    source pinning, and failure handling all simplify; no
    user-visible downside.
12. **Browser support is decided by runtime probe.** A
    per-mount relay self-test (host → proxy → inner →
    proxy → host with the per-view nonce) runs during
    initialization. If it fails, the host falls back to the
    legacy text-only path for that mount with a clear chrome
    message. There is no user-agent allow/deny list.
13. **Persistent app-instance artifact for remount.** A new
    `MCPAppInstance` record carries
    `(conversationId, messageId, mcpServerId, toolName,
    resourceUri, approvedHash, createdAt)` so re-opening a
    conversation can replay the host lifecycle around an
    already-approved resource without inflating model context.
    View-internal state is not preserved (spec defers this).
14. **Host-cached task results expire at upstream TTL.** Any
    locally cached `tasks/result` payload expires no later
    than `createdAt + ttl` as reported by the server.
    Persistence beyond upstream TTL is post-v1.

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
| External assets in resource HTML (relative or absolute) | v1 approves bytes, not origins; HTML must be self-contained |
| `_meta.ui.csp.resourceDomains` / `frameDomains` / `baseUriDomains` | Corresponding HTML constructs forbidden in v1 |
| Multiplexed / pooled sandbox proxy iframe | One proxy iframe per app instance in v1 |
| User-agent allow/deny list for browser support | Runtime relay self-test instead |
| Locally cached `tasks/result` past upstream TTL | Cache, not durable store; persistence beyond TTL is post-v1 |
| Durable persistence of view-internal app state | Spec defers; remount artifact only re-instantiates the view |
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
| Operator allowlist promoting `optional` task tools | One policy axis is enough; only `required` becomes a task in v1 |
| Eager `tasks/result` on jobs-panel open | Status-only by default; detail entry triggers result fetch |
| `PostMessageTransport` deferred-target queue | Upstream-rejected; construction order is the fix |
| Byte-for-byte `tasks/result` rehydration | Spec requires semantic equivalence, not serializer-byte equality |

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
  In v1, only `connectDomains` is meaningful: `resourceDomains`,
  `frameDomains`, and `baseUriDomains` are ignored because v1
  forbids the corresponding HTML constructs (remote scripts/
  styles/fonts/images, frames, `<base>`).
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
  `required`. v1 task-augments only `required` tools. `optional`
  runs synchronously; `forbidden` runs synchronously. No operator
  allowlist for promoting `optional` to task in v1 — that
  introduces a second policy axis without user-visible benefit.
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
  `tasks/list` + `tasks/get` to refresh state and surfaces TTL.
- **Jobs panel is status-only by default.** Opening the panel
  does **not** call `tasks/result` for terminal rows. It loads
  task state with `tasks/list` / `tasks/get`, displays status and
  TTL, and only calls `tasks/result` on (a) explicit detail
  entry, (b) a "wait for result" action on an in-flight task, or
  (c) opportunistic save when a subscribed task transitions to
  terminal while the user is present. This keeps panel-open
  cheap on accounts with many completed tasks and respects
  TTL-bound result retention.
- **Single-path "wait for result."** When the user explicitly
  enters a blocking wait state (detail-row "wait for result"),
  the host **suspends `tasks/get` polling for that task** and
  relies on a single `tasks/result` call. The spec says
  `tasks/result` blocks until terminal status, so polling on
  top of it is wasteful and creates unnecessary concurrent
  long-lived requests. Polling resumes only if (a) the
  `tasks/result` call fails, (b) the user cancels the wait, or
  (c) the user navigates away from the wait state. The user
  sees the same UX either way; the host saves a stream.
- **Host-side cache TTL.** Any locally cached `tasks/result`
  payload **must expire at or before `createdAt + ttl`** as
  reported by the server. Reading after expiry forces a fresh
  `tasks/result` (which the server may answer with "task
  expired"). The current `MCPTask` collection is a **cache**,
  not a durable result store; persistence beyond upstream TTL
  is post-v1 and would require its own security review. This
  matches the Tasks spec's allowance for receivers to delete
  expired tasks and results, and prevents the host from
  accidentally creating a hidden retention layer.
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
  produced, with `_meta` preserved (see view-path rules in the
  Data boundary section). v1 stores **canonical JSON envelopes**
  preserving enough metadata to reconstruct the semantic response.
  Oversized payloads (>~12 MiB to leave headroom under the 16 MiB
  BSON limit) and binary-heavy blobs offload to immutable blob
  storage. **Pointerization is an internal storage detail.** When
  responding to `tasks/result`, the host rehydrates the original
  response shape so it is **semantically equivalent** to what the
  original request would have returned — same JSON-RPC envelope
  type (result vs error), same parsed structure for `content` /
  `structuredContent`, same `_meta`. Byte-for-byte equality of
  serializer output (key order, whitespace, spacing) is not
  required; structural and semantic equivalence is. Pointerized
  blob references must not leak into the caller-visible payload.
- Status notifications are optional; `pollInterval` is advisory; the
  host treats both as hints.
- Servers may return
  `_meta["io.modelcontextprotocol/model-immediate-response"]` — a
  model-facing string letting the model continue reasoning while the
  task runs.
- **Authorization context binding via `authContextHash`.** Task
  access is bound to a stable hash over the **normalized
  effective auth configuration** at task creation: user
  identity, server identity, resolved credential source,
  header/auth fingerprint, and config revision. The
  human-readable tuple
  `(userId, mcpServerId, oauthSubject || apiKeyFingerprint)`
  is kept for logs and UI but is **not** the binding key. Any
  change in the underlying configuration changes the hash,
  invalidating ownership for the prior context. This guards
  against the LibreChat-specific risk surface around shared
  server definitions and per-user credential leakage that
  recent advisories flagged.
- **Streamable HTTP only.** v1 does not run Tasks over stdio, WS, or
  SSE. Transport reuses `MCP-Session-Id`, sends
  `MCP-Protocol-Version`, and handles HTTP 404 → new MCP session.
  **Outstanding-task revalidation on 404 is Tasks-specific** and
  lands in Phase 4, not Phase 0. Phase 0 lands the
  Apps-and-Tasks-shared transport substrate (session reuse,
  header consistency, basic 404 → re-init, per-user token
  scoping).
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
| 307/308 redirect handling on Streamable HTTP | Done on `main` | transport layer |
| Cross-origin credential stripping on redirects | Done on `main` | transport layer |
| Streamable HTTP session reuse correctness, header consistency, 404 → re-init | Phase 0 | transport layer |
| Per-user header/token scoping (recent advisory) | Phase 0 | transport layer |
| Apps capability negotiation (gated by `MCP_APPS_ENABLED`) | Missing | — |
| `_meta.ui.resourceUri`-driven discovery (server-side) | Missing | — |
| Cross-origin sandbox proxy + stable wire-format flow | Missing | — |
| `AppBridge` wrapper with explicit-origin transport shim, lazy-loaded on client | Missing | — |
| Host construction-order invariant for `srcdoc` race | Missing | — |
| Hop-specific relay validation + proxy-stamped per-view nonce | Missing | — |
| Runtime relay self-test + text-only fallback (no UA sniff) | Missing | — |
| `ui/initialize` handshake + truthful `hostContext` (full surface) | Missing | — |
| Single-ACL forwarded-method enforcement (incl. cross-server isolation) | Missing | — |
| Self-contained-HTML validator (rejects all external assets, `<base>`) | Missing | — |
| First-launch resource review + `sha256(html)` hash pinning | Missing | — |
| `MCPAppInstance` artifact for remount (separate from model context) | Missing | — |
| Per-resource CSP via `<meta>` injection (strict; only `connectDomains` honored) | Missing | — |
| Sizing fallback height + `shrinkWrap: false` opt-out | Missing | — |
| Trust UX (sandbox boundary chrome) | Missing | — |
| MCP Tasks (per-tool negotiation, active-subscriber polling, single-path wait, `authContextHash` binding, TTL-bounded cache, semantic-equivalence rehydration) | Missing | — |
| Tasks capability negotiation (gated by `MCP_TASKS_ENABLED`) | Missing | — |
| `model-immediate-response` runtime behavior | Missing | — |
| Status-only running-jobs UI (cursor-paginated; `tasks/result` on detail entry) | Missing | — |
| Outstanding-task revalidation on HTTP 404 → re-init | Phase 4 | — |

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
implementation passes the relevant interop matrix **and** its
feature flag is on.

- **Independent feature flags.** `MCP_APPS_ENABLED` and
  `MCP_TASKS_ENABLED` are independent operator settings; either
  one can be on without the other. This decouples the Apps
  (stable) release train from the Tasks (experimental) release
  train so Tasks instability never blocks Apps shipping.
- Apps capability turns on at the end of Phase 2 when
  `MCP_APPS_ENABLED=true`.
- Tasks capability turns on at the end of Phase 4 when
  `MCP_TASKS_ENABLED=true`. Tasks may stay OFF through multiple
  Apps minor releases.
- `tasks.requests.*` published exhaustively for implemented
  directions only.
- `hostCapabilities` and `hostContext.availableDisplayModes` are
  truthful: v1 lists only `inline`.

## Web-host architecture

### Wire-format-compliant flow

- **Outer (per-instance):** the host renders **one** iframe per
  rendered Apps view, served from `MCP_SANDBOX_ORIGIN` (different
  origin from the LibreChat application). No proxy pooling, no
  multiplexing of multiple app instances through a shared
  proxy. Each iframe loads a static `proxy.html` shipped by
  LibreChat. The sandbox-origin response includes
  `Content-Security-Policy: frame-ancestors <librechat-origin>;`
  and disables caching. **No application authentication runs at
  the sandbox origin.**
- **Bridge wrapper.** The host wraps `AppBridge` from
  `@modelcontextprotocol/ext-apps`. The transport layer is a thin
  shim around `PostMessageTransport`'s receive logic that sends with
  **explicit target origins** instead of the SDK default of `*`. The
  SDK's `event.source` and JSON-RPC envelope validation is preserved.
- **Lazy-loaded on the client.** `AppBridge` and the transport
  pull Zod and add ~377 KB minified to the bundle. They are
  imported on-demand only when the first Apps view in a session
  is about to mount. The default chat bundle does not pay for
  Apps when no app is in use.
- **Wire flow:**
  1. Proxy emits `ui/notifications/sandbox-proxy-ready`.
  2. Host fetches the resource server-side via `resources/read`,
     runs the resource through the review pipeline (self-
     contained-HTML validation, hash check, `<meta>` CSP
     synthesis), and sends
     `ui/notifications/sandbox-resource-ready` with
     `{ html, sandbox, csp, permissions, nonce }`. The
     128-bit `nonce` is per-view and host-generated. It is
     **proxy-stamped** onto every relayed inbound message;
     the inner view never sees it and never echoes it.
  3. Proxy creates an inner iframe with `srcdoc=html`, host-filtered
     `sandbox` flags, and `allow=<filtered permissions>`.
  4. **Relay self-test.** Before completing initialization, the
     host pings the proxy through the relay (host → proxy →
     bound inner window → proxy → host) with the per-view
     nonce. If the nonce does not round-trip correctly, the
     host tears down the iframe and falls back to the legacy
     text-only path for that mount with a clear chrome
     message. This replaces user-agent sniffing.
  5. The view runs the standard initialization handshake before the
     host sends `tool-input`, `tool-result`, etc.

### Host construction order (invariant)

The `srcdoc` initialization race is real: if the view's HTML loads
before the host's postMessage listener is wired up, `ui/initialize`
is dropped and the bridge silently hangs. Inside the proxy iframe,
the **only** safe ordering for materializing the inner view is:

1. Append the inner iframe element to the proxy's DOM.
2. While its `contentWindow` is still the initial `about:blank`,
   capture the reference.
3. Construct and connect the host-side transport / message
   listener against that reference.
4. **Only now** assign `srcdoc` (or set `src`).

The proxy implementation in `proxy.html` enforces this ordering;
the host implementation enforces the analogous ordering for the
outer proxy iframe. Both orderings are checked in Phase 1 tests
and their correctness is a Phase 1 exit criterion. v6 explicitly
rejects the alternative of patching `PostMessageTransport` with a
deferred-target queue: upstream rejected that approach because it
turns a forgotten `setTarget` into a silent hang and widens the
trust boundary by accepting messages before the source is pinned.

### `postMessage` validation

Validation is **hop-specific**. The host and the proxy do
different jobs and accept different things.

#### Host ↔ proxy hop (host-side)

- Senders specify exact target origins (no `*`).
- The host accepts inbound messages **only** when:
  - `event.origin === MCP_SANDBOX_ORIGIN` (exact match, no
    partial / suffix matching).
  - `event.source` matches the proxy window reference for the
    specific view.
  - JSON-RPC envelope schema validates.
  - The proxy-stamped per-view nonce matches.
- `null` origins are **rejected** at the host. The host never
  talks directly to the inner sandboxed view; the proxy is the
  only valid sender.
- Outbound host requests are queued until both
  `ui/initialize` response is sent and the view's
  `ui/notifications/initialized` is received.

#### Proxy ↔ inner-frame hop (proxy-side)

- The proxy lives at `MCP_SANDBOX_ORIGIN`, separate from the
  host application origin.
- The proxy accepts opaque-origin (`null`) messages **only**
  from its bound inner iframe `contentWindow`. Messages from
  any other source are dropped.
- Before forwarding inbound messages to the host, the proxy
  **stamps** the per-view nonce. The nonce is generated by the
  host, delivered to the proxy on
  `ui/notifications/sandbox-resource-ready`, and held inside
  the proxy. The inner view never receives it, never sees it,
  and cannot spoof it.
- The proxy validates the JSON-RPC envelope schema before
  forwarding.

#### Per-view nonce

- 128-bit, generated by the host per view, delivered out-of-
  band to the proxy.
- **Proxy-stamped on inbound, not app-echoed.** This makes the
  nonce a host-vs-proxy trust primitive that survives whatever
  the inner view does (including a malicious or buggy app
  trying to spoof relay framing).
- Reason this exists: WebKit/Safari is known to surface
  `event.source === window` for sandbox-relayed messages
  (upstream issue), so raw source-identity matching is not
  reliable on that engine. Combining hop separation with a
  proxy-stamped nonce means inner-frame trust does not depend
  on `event.source` alone, on either hop.

### Browser support stance

- Browser support is decided by a **runtime relay self-test**,
  not by a user-agent allow/deny list. The probe runs on every
  view mount during initialization and verifies the per-view
  nonce round-trips through the host → proxy → inner window
  → proxy → host loop.
- Chromium and Firefox are expected to pass.
- WebKit/Safari currently has an upstream issue around
  sandbox relay `event.source` reporting; the probe will
  detect it. If WebKit fails the probe, the host falls back
  to the legacy text-only path for that mount and surfaces a
  chrome message ("This browser cannot render this app
  safely; showing a text summary instead."). When upstream
  resolves the issue, support resumes automatically without
  a code change.
- The fallback path is per-mount, not per-session, so a user
  on a half-broken engine can still see other Apps if their
  relay probes pass.

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
- v1 policy is **strict by construction** because the resource is
  required to be self-contained (see Asset policy below):
  ```
  default-src 'none';
  script-src  'unsafe-inline';
  style-src   'unsafe-inline';
  img-src     data:;
  connect-src <derived from _meta.ui.csp.connectDomains>;
  base-uri    'none';
  form-action 'none';
  ```
  `'unsafe-inline'` is necessary because the resource ships its
  scripts and styles inline; with no remote script origins
  permitted, the XSS surface is bounded to whatever is in the
  approved bytes (which is exactly what hash pinning protects).
- `connect-src` is the only directive that draws from server
  metadata. `_meta.ui.csp.connectDomains` is honored verbatim,
  intersected with a host deny list. **`resourceDomains`,
  `frameDomains`, and `baseUriDomains` are ignored in v1**
  because v1 forbids the corresponding HTML constructs (remote
  assets, frames, `<base>`).
- The injector refuses HTML whose declared `connectDomains`
  would still block its own initialization (e.g. a self-call
  required by the bridge).
- Documented `<meta>`-CSP limitations: `sandbox`, `frame-ancestors`,
  `report-uri` cannot be expressed. `sandbox` uses the iframe
  attribute; `frame-ancestors` is enforced by the proxy.html
  response header on the sandbox origin; `report-uri` is unavailable
  in v1.

### Asset policy (v1: self-contained HTML only)

v1 approves **bytes**, not origins. The review pipeline parses
each candidate `ui://` resource and **rejects** any of:

- `<script src=…>` (absolute or relative).
- `<link href=…>` for stylesheets, prefetches, modulepreloads,
  imports, etc.
- `<img src=…>` whose URL is **not** a `data:` URI.
- `<iframe src=…>`, `<frame src=…>`, `<embed>`, `<object>`,
  `<source>`, `<track>`, `<video>`, `<audio>` with remote `src`.
- `<base href=…>` tags (avoid retargeting relative resolution).
- ES module `import` / dynamic `import()` to remote URLs (the
  CSP `script-src` already blocks them at runtime; the review
  pipeline rejects them at review time so the failure is
  explicit, not a runtime mystery).

What the resource **may** include:

- Inline `<script>` and `<style>` blocks (subject to byte
  hashing).
- `data:` images.
- `connect-src` calls to origins in
  `_meta.ui.csp.connectDomains` (XHR/fetch/WebSocket only).

Why this is tighter than v6: under v6's "absolute HTTPS in
`resourceDomains` is fine" rule, the host-side approval was over
the HTML only, while the actually-executing JS could change
under a stable URL. That made hash pinning advisory-at-best and
contradicted the "browser receives an already-approved payload"
claim. Under v7, hash pinning is meaningful: the approved bytes
are everything that runs.

App authors bundle their JS and CSS inline. This is a real
constraint on app authors, but it removes the entire
supply-chain attack surface from v1 review and lets the host
make a truthful claim about what users actually run.

`about:srcdoc` resolves relative URLs against the embedding
document, not against `ui://`. With external assets banned,
this is no longer a footgun, just a reason there is nothing
external to resolve.

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

### Sizing and `containerDimensions`

- The Apps spec requires hosts using flexible dimensions to listen
  for `ui/notifications/size-changed` and surface
  `containerDimensions` via `HostContext`. v1 does both.
- **Initial-render fallback.** Upstream is still carrying a fix
  for default auto-resize collapsing common `height: 100%`
  layouts on first render. To avoid a "view appears as a sliver"
  failure mode in v1, the host applies a fallback height
  (default 320 px, configurable via
  `MCP_APPS_FALLBACK_HEIGHT_PX`) until the first non-zero
  `size-changed` notification arrives. Width follows the host
  container.
- **Aggressive shrink-wrap opt-out.** A per-server
  operator setting (`shrinkWrap: false`) disables auto-shrink
  behavior entirely and pins the view at the fallback height; the
  view can still grow through `size-changed`. This is the safe
  setting for app authors whose layouts are known to misbehave
  with the SDK's default measurement.
- `host-context-changed` fires when the user resizes the host
  shell so the view sees fresh `containerDimensions`.

## Data boundary rules

A `CallToolResult` (or rehydrated `tasks/result` envelope) flows
along **two distinct paths** with opposite preservation rules.

### Model path (host → LLM)

- **`content`** is the only model-visible surface and goes into
  conversation context.
- **`structuredContent`** is stripped before model exposure.
  Never added to model context, never persisted into
  model-visible payloads.
- **`_meta`** is stripped before model exposure.
- **`ui/update-model-context`** layers on top: the latest update
  before the next user message is folded into model context;
  earlier updates are discarded.

### View path (host → app view)

- The host **must** forward the full `CallToolResult` to the view
  via `ui/notifications/tool-result`, including `content`,
  `structuredContent`, **and `_meta`**. The Apps spec defines the
  payload as a standard `CallToolResult`, not a host-sanitized
  subset.
- `_meta["io.modelcontextprotocol/related-task"]` must reach the
  view intact for Tasks correlation; dropping it breaks
  task-aware Apps.
- Server-defined `_meta` keys outside the reserved namespace must
  also be preserved so app authors can rely on them.
- The same rule applies to `tasks/result` rehydration on the view
  path: the rehydrated envelope keeps its `_meta`, including
  `related-task`.

### Implementation invariant

Two helpers, not one:

- `toModelView(result)` — strips `structuredContent` and `_meta`
  for model context, persistence into model-visible payloads, and
  replay/rehydration on the model side.
- `toViewSurface(result)` — preserves the full envelope for
  bridge delivery and view-side rehydration.

Tests assert both directions: `structuredContent` and `_meta`
never appear in model-bound serialization, **and** they always
appear in view-bound serialization when the server provided them.

## Resource review (server-side)

- All `_meta.ui.resourceUri` discovery, fetching, self-contained-
  HTML validation, hashing, CSP synthesis, and caching happens in
  the host backend. The browser receives an **already-approved**
  payload — and under v7's self-contained-HTML rule, this is
  literally true: there are no external bytes that can change
  under the host's feet.
- **First-launch review.** The first time a tool with
  `_meta.ui.resourceUri` is invoked, the host fetches via
  `resources/read`, runs the self-contained-HTML validator (see
  Asset policy), computes `sha256(html)`, and stores
  `(serverName, resourceUri, sha256, firstSeen)` in
  `MCPResourceReview`. Operator policy decides auto-allow vs
  manual-review. Until approved, the tool falls back to text-only.
- **Hash pinning is required when configured, advisory by
  default.** Operators may set
  `MCP_APPS_HASH_PINNING_REQUIRED=true`, in which case any hash
  divergence on subsequent launches is a hard refuse. With
  external assets gone, divergence means an actual code change
  in the resource itself, so this is no longer noisy. Default
  for v1 is advisory (warn + auto-approve under operator policy)
  to ease initial onboarding.
- **No proactive crawl** of `_meta.ui.resourceUri` after every
  `tools/list`. That is product polish and out of v1.

## Persisted app-instance artifact (remount)

- `MCPAppInstance` is a new collection holding
  `(_id, conversationId, messageId, mcpServerId, toolName,
  resourceUri, approvedHash, createdAt, lastSeen,
  authContextHash)`.
- One `MCPAppInstance` is created per launched app view.
- On chat reload or navigation back to a conversation
  containing app messages, the host queries
  `MCPAppInstance` for the conversation and replays the
  view-launch lifecycle (fetch resource → review → approve →
  render proxy iframe → run handshake) for each instance.
- View-internal state (selection, scroll position, in-flight
  internal SPA navigation) is **not** preserved — the spec
  defers this in v1. The artifact only guarantees the view
  re-instantiates against the same approved bytes so the user
  sees the app instead of an empty placeholder.
- The artifact is **not** model-visible. It is a host-side
  rendering descriptor, separate from message content.
- If `approvedHash` no longer matches when the host re-fetches
  the resource (e.g. server upgraded the app), the host
  surfaces a "this app has been updated since you opened the
  conversation" notice and offers to re-approve via the normal
  review path.

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

Phase 0 is the genuinely shared substrate between Apps and
Tasks. v7 trims it further: outstanding-task revalidation on
HTTP 404 is **Tasks-specific** and moves to Phase 4, since Apps
does not need it. Phase 0 keeps only what both workstreams
actually share.

- **Session-reuse correctness.** Verify `MCP-Session-Id` is
  reused across requests within a session and rotated only on
  re-initialize. Add tests for the cases public `main` doesn't
  currently cover.
- **Header consistency.** Ensure `MCP-Protocol-Version` and
  `MCP-Session-Id` are sent on every request (initialize and
  subsequent), and that they match what the server returned.
- **HTTP 404 → re-initialize (basic).** When a server returns
  404 for a session, the client opens a new MCP session.
  Outstanding-task revalidation specifically — re-querying
  `taskId`s after a session re-init — is **Tasks-specific** and
  lives in Phase 4.
- **Per-user token scoping.** Close the recent advisory: shared
  server definitions must not leak per-user tokens across users.
  Compute the `authContextHash` over the normalized effective
  auth configuration at connection time; treat it as immutable
  for that connection's lifetime.
- **Operator policy defaults.** Defaults for server creation,
  transport allowlists, per-user task quotas, result-size caps —
  defaults lean toward denial.

Items already landed on `main` are explicitly **not** Phase 0
work: 307/308 redirect handling and credential-stripping on
cross-origin redirects. Spot-check no regression and move on.

## Phased plan

### Phase 0 — Transport reliability + auth-context substrate (≈3–5 days)

- Session-reuse correctness across requests.
- Consistent `MCP-Protocol-Version` / `MCP-Session-Id` headers.
- HTTP 404 → re-initialize (basic). Outstanding-task
  revalidation moves to Phase 4.
- Per-user token scoping closure.
- `authContextHash` computed at connection time.
- Operator policy defaults.

### Phase 1 — Types + sandbox infra + bridge wrapper (≈1 week)

End of phase: sandbox origin serves static `proxy.html`; bridge
handshake works against a fixture server; construction-order
invariant verified; runtime relay self-test gracefully falls
back to text on engines where the relay is unsafe; **no
capability advertised**.

- Types in `packages/data-provider`, generated from the pinned
  ext-apps release.
- `packages/api/src/mcp/connection.ts` reads per-tool
  `execution.taskSupport`. Does not advertise Apps or Tasks.
- Sandbox infrastructure: static `proxy.html` served from
  `MCP_SANDBOX_ORIGIN` with `frame-ancestors` CSP header. **One
  proxy iframe per app instance** (no pooling).
- Wrap `AppBridge`. Implement the explicit-origin transport shim
  around `PostMessageTransport`'s receive logic. Add hop-
  specific validation: host rejects `null` origin; proxy stamps
  per-view nonce on relayed inbound messages.
- **Lazy-load** the bridge runtime on the client; verify the
  default chat bundle does not include `AppBridge` /
  `PostMessageTransport` / Zod when no Apps view is mounted.
- **Construction-order test**: a fixture proves that flipping
  the order (`srcdoc` before listener attach) reliably reproduces
  a dropped handshake, and the production code path always uses
  the safe order.
- **Hop-separated relay test (proxy-stamped nonce)**: messages
  relayed through the proxy carry the proxy-stamped nonce; the
  app cannot read or forge it; messages from the inner frame to
  the host directly (bypassing the proxy) are rejected. Run on
  Chromium, Firefox, and WebKit/Safari.
- **Runtime relay self-test**: per-mount probe that simulates
  the round-trip; on failure, the host tears down the iframe
  and falls back to legacy text-only rendering for that mount.
- `MCPResourceReview` collection + **self-contained-HTML
  validator** (rejects `<script src>`, `<link href>`,
  `<img src>` to remote, `<base>`, etc.).
- `MCPAppInstance` collection scaffold for remount.
- Tests with `mongodb-memory-server` + real
  `@modelcontextprotocol/sdk` + Playwright cross-origin iframes.

Phase 1 exit criteria:

1. Construction-order test passes on every supported engine.
2. Hop-separated relay test passes; runtime probe reliably
   detects engines where the relay is unsafe and triggers
   text-only fallback.
3. Default chat bundle size does not regress by more than a
   small known delta from `main` when Apps is not in use.
4. Self-contained-HTML validator rejects every external-asset
   construct in the test corpus.

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
- First-launch resource review (self-contained-HTML validation);
  `sha256(html)` hash recorded; `MCPBuilder/` UI for approvals.
- **Hash pinning** wired through `MCPResourceReview` and
  `MCPAppInstance.approvedHash`; default advisory in v1, hard
  refuse when `MCP_APPS_HASH_PINNING_REQUIRED=true`.
- **`MCPAppInstance` write path**: every successful app launch
  records an instance record so re-opening the conversation
  re-renders the app without inflating model context. Hash
  divergence on rehydrate surfaces a "this app has been updated"
  notice with a re-approval action.
- Trust UX chrome around every view (sandbox-rendered chrome
  shows server identity, OAuth scopes, `approvedHash`, and an
  exit-app affordance).
- Reject resources declaring `_meta.ui.domain` with a clear error.
- **Two helpers, not one** for the data boundary
  (`toModelView`, `toViewSurface`). Plumb both through agent
  tool-result handling, persistence, and view delivery. Tests
  assert (a) `structuredContent`/`_meta` never leak to the model
  path, **and** (b) `_meta` (including
  `io.modelcontextprotocol/related-task` and server-defined
  keys) is preserved on the view path.
- Sizing fallback: apply `MCP_APPS_FALLBACK_HEIGHT_PX` until the
  first non-zero `size-changed`; honor the `shrinkWrap: false`
  per-server opt-out.
- **Apps feature flag** (`MCP_APPS_ENABLED`) added; OFF by
  default until interop matrix passes. Toggle is independent of
  Tasks.
- **End of phase**: enable Apps capability advertisement when
  `MCP_APPS_ENABLED=true` and interop matrix passes. Tasks may
  still be OFF at this point.

### Phase 3 — `tool-input-partial` (≈1 week, optional)

- Surface partial tool-call arguments through the agent loop so
  views see `tool-input-partial`.
- Coordinate with `@librechat/agents`. Optional for v1.

### Phase 4 — MCP Tasks v1 (≈2 weeks; can run parallel to Phase 2)

End of phase: Tasks capability advertised, sub-flags exhaustive
for implemented directions.

- `packages/api/src/mcp/`:
  - Honor per-tool `execution.taskSupport`. v1 task-augments only
    `taskSupport: required` tools. `optional` runs synchronously;
    `forbidden` runs synchronously. No operator-allowlist promotion
    of `optional` to task.
  - **Active-subscriber polling.** Each subscriber (mounted view,
    open jobs panel, active conversation) owns its own poll
    against `tasks/get` while present. When no subscriber is
    observing, polling stops; the task continues server-side.
    `tasks/result` is invoked only on explicit detail entry, a
    "wait for result" action, or opportunistic save when a
    subscribed task reaches terminal with the user present. No
    background API-process poller. Opening the jobs panel never
    eagerly fetches `tasks/result` for terminal rows.
  - **Single-path "wait for result."** When the user enters a
    blocking wait, the host suspends `tasks/get` for that task
    and relies on a single `tasks/result` call. Polling
    resumes only on call failure, user-cancelled wait, or
    navigation away from the wait state.
  - **Subscriber registry is in-memory per connected session.**
    On reconnect, subscribers re-register and reload from
    `tasks/get`. No durable subscriber state.
  - **`MCPTask` collection is a TTL-bounded cache.** Stores
    canonical JSON of the original request and the terminal
    response/error envelope, plus indexed
    `(authContextHash, userId, mcpServerId, taskId, sessionId,
    status, hostHandlingState, createdAt, lastUpdatedAt, ttl,
    pollInterval, progressToken, modelImmediateResponse,
    lastSeen, correlationConversationId, mcpAppInstanceId?)`.
    The MongoDB TTL index on `createdAt + ttl` removes stale
    cache rows automatically. Payloads >12 MiB or binary-heavy
    blobs offload to immutable blob storage with the envelope
    referencing them by URL/hash. **Persistence beyond
    upstream TTL is post-v1**; the row's lifetime is bounded
    by the server-reported TTL.
  - **`tasks/result` rehydration**: on retrieval, the host
    rehydrates the original response shape so it is
    **semantically equivalent** to what the original underlying
    request would have returned — same envelope type (result vs
    error), same parsed structure for `content` /
    `structuredContent`, and same `_meta` (incl. the
    `related-task` tag). Byte-for-byte serializer equality is not
    required. Pointerization is a storage detail and must not
    leak into the response.
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
  - **`authContextHash` binding** at task creation; verify on
    every retrieval. `tasks/list` is filtered by current
    `authContextHash`. Tasks created under a prior context
    become invisible (and unfetchable) when the underlying
    auth configuration changes.
  - **Streamable HTTP only.** Persist `MCP-Session-Id` per task.
    HTTP 404 → start a new MCP session, **revalidate
    outstanding `taskId`s via `tasks/get`** (this work moved
    from Phase 0 to here in v7 because it is Tasks-specific).
    Treat "task not found" as terminal-with-error.
  - **Cache reads check expiry.** Any read from the `MCPTask`
    cache (jobs panel, detail view, rehydration) checks
    `createdAt + ttl`. Expired rows are not served; the host
    reissues `tasks/result` (which may legitimately return
    "task expired"). The cache never extends a result's
    lifetime past the server's stated TTL.
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
- **Tasks feature flag** (`MCP_TASKS_ENABLED`) added; OFF by
  default. Independent of `MCP_APPS_ENABLED` so Apps may have
  shipped already.
- **End of phase**: enable Tasks capability advertisement when
  `MCP_TASKS_ENABLED=true` and the Tasks interop matrix passes.

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
   The CAD app ships its viewer (Three.js + WASM B-Rep kernel)
   as inline JS bundled into the HTML — no `<script src>` to a
   CDN, no `<link href>` to a font host. The host fetches the
   HTML server-side via `resources/read`, runs the
   self-contained-HTML validator, computes `sha256(html)`,
   validates against the operator-approved pin, injects the
   strict `<meta>` CSP (`connect-src` from
   `_meta.ui.csp.connectDomains`), and sends
   `sandbox-resource-ready`. The host instantiates a fresh
   per-instance proxy iframe, runs the construction-order
   sequence and the runtime relay self-test; on success the
   inner iframe renders via `srcdoc`. On any probe failure
   the host falls back to a text-only summary and explains why.
   An `MCPAppInstance` row is written so re-opening this
   conversation later re-renders the app without storing
   anything in model context.
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
   by `authContextHash`). The panel is status-only and does
   not eagerly call `tasks/result`. The task row shows
   `completed` and a TTL countdown. The user clicks "open
   detail" (single-path wait), at which point the host
   suspends `tasks/get` for that task and issues one
   `tasks/result`. The cached envelope (still within
   upstream TTL) rehydrates semantically to the original
   response shape; its structured content carries an
   **artifact handle** (`{ artifactId, objectKey }`), not a
   presigned URL — presigned URLs are time-limited and would
   already be dead. If the user had returned after upstream
   TTL, the cache would no longer serve and the server would
   answer "task expired"; the user would see a clear notice
   instead of stale data. When the user clicks Download, the
   view calls a `cad.get_download_url(artifactId)` MCP tool
   that mints a fresh short-TTL presigned URL; the view then
   opens it via `ui/open-link` against the host navigation
   allowlist.

## Risks / open questions

- **`<meta>`-CSP limitations** accepted in v1. Operators wanting
  stricter controls wait for the post-v1 hardened-delivery
  extension.
- **Operator deployment cost.** A single sandbox subdomain is
  required.
- **Self-contained-HTML rule is a real constraint on app
  authors.** v1 forbids remote scripts, styles, fonts, and
  images. App authors must bundle. This is the cost of letting
  the host truthfully claim it has approved the bytes the user
  runs. Operator docs make this rule prominent so app authors
  hit it at design time, not deploy time.
- **WebKit/Safari relay risk handled by runtime probe.** No
  user-agent allow/deny list. The probe runs on every mount;
  when WebKit fails it, the user sees a clear text-only
  fallback message. If upstream lands a fix, support resumes
  automatically without a code change.
- **TTL-bound result retention is now an explicit invariant.**
  Local cache cannot extend a result's lifetime past the
  server's `createdAt + ttl`. The jobs panel surfaces TTL so
  users can see when a result will expire and explicitly
  fetch it before then. Persistence beyond upstream TTL is
  post-v1 and would require its own security review.
- **`authContextHash` invalidation can hide tasks.** If a user
  rotates credentials or an operator changes the server
  config in a way that affects the auth fingerprint, tasks
  created under the prior context become invisible by design.
  The UI must explain this rather than show an empty list as
  if no tasks exist; otherwise the user thinks the system
  silently dropped their work.
- **Remount is not state preservation.** `MCPAppInstance`
  guarantees the view re-renders against the same approved
  bytes. It does **not** preserve internal state — selection,
  scroll, in-flight SPA navigation are all gone. Apps that
  need state durability persist it on their own MCP server.
- **One proxy iframe per instance has a memory cost** if a
  conversation contains many app messages. v1 accepts this in
  exchange for trivial routing/teardown semantics. Pooling
  may be revisited post-v1 with explicit security analysis.
- **Default chat bundle size.** Lazy-loading `AppBridge` keeps
  the bundle lean today, but a future change to non-Apps code
  paths could accidentally re-import the bridge eagerly. The
  bundle-size regression test guards against that.
- **Sizing default behavior is still upstream-unstable.** The
  fallback height policy and shrink-wrap opt-out are explicit
  product surface so app authors can route around the SDK
  default measurement until upstream lands a fix.
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
- **Phase 0 scope vs. private branch.** Phase 0 was sized
  against public `main`. If the working branch contains
  divergent transport changes that haven't been picked up here,
  re-scope Phase 0 against that branch's actual diff before
  starting.

## Testing matrix

CLAUDE.md says real logic over mocks. The matrix uses real
`@modelcontextprotocol/sdk` servers in-process and Playwright for
the cross-origin iframe layer.

### Phase 0

- `MCP-Session-Id` reuse across requests within a session.
- Consistent `MCP-Protocol-Version` / `MCP-Session-Id` headers
  on every request.
- HTTP 404 → new MCP session (basic). Outstanding-task
  revalidation is **Phase 4**.
- Per-user token scoping for shared server definitions.
- `authContextHash` computed at connection time over normalized
  effective auth configuration; immutable across the
  connection's lifetime; changes invalidate task ownership.
- (Regression-only) 307/308 redirect handling and credential
  stripping on cross-origin redirects: spot-check that public
  `main` behavior has not regressed.

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
- **Self-contained-HTML validator**: HTML containing **any**
  `<script src>` (relative or absolute), `<link href>`,
  `<img src>` to a non-`data:` URL, `<iframe src>`,
  `<object>`/`<embed>`, remote `<source>`/`<track>`/`<video>`/
  `<audio>` URL, `<base>`, or remote ES `import`/dynamic
  `import()` is rejected at review time. Inline `<script>` and
  `<style>` are accepted; `data:` images are accepted.
- **One proxy iframe per app instance**: a conversation with N
  app messages renders N proxy iframes, not one shared proxy.
  Teardown of one instance does not affect siblings.
- **`MCPAppInstance` artifact**: a successful launch creates an
  instance row; reopening the conversation re-renders the view
  by replaying the launch lifecycle without writing to model
  context; hash divergence shows the "app updated" notice.
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
- **Hop-specific origin validation**:
  - Host **rejects** any `null`-origin message; only
    `MCP_SANDBOX_ORIGIN` is accepted.
  - Proxy accepts opaque-origin messages **only** from its
    bound inner iframe.
- **Proxy-stamped per-view nonce**: every inbound message
  forwarded by the proxy carries the proxy-stamped nonce; an
  inner-frame attempt to spoof or read the nonce fails
  because the inner frame never sees it.
- **PostMessage transport shim**: outbound sends use exact target
  origins, never `*`.
- **Construction-order invariant**: a fixture deliberately
  flipping the order (set `srcdoc` before listener attach)
  reproduces a dropped `ui/initialize`; production code path
  attaches the listener first and the bridge initializes
  reliably. Asserted on Chromium, Firefox, and WebKit/Safari.
- **Runtime relay self-test**: every mount runs the host →
  proxy → inner → proxy → host probe; failure triggers
  legacy text-only fallback for that mount and surfaces a
  clear chrome message; success completes initialization.
- **Bundle-size regression**: default chat bundle does not
  include `AppBridge` / `PostMessageTransport` / Zod when no
  Apps view is mounted.
- **Sizing fallback**: with no `size-changed` notification, the
  view renders at the operator-configured fallback height; once
  a non-zero `size-changed` arrives the host honors it; the
  `shrinkWrap: false` opt-out pins the view at the fallback
  height even if the SDK suggests shrinking.
- First-launch resource review: `sha256(html)` stored;
  divergent hash refused at next launch when
  `MCP_APPS_HASH_PINNING_REQUIRED=true` (and surfaces a
  notice + re-approval action when hash pinning is advisory).
- **Data boundary — model path**: `structuredContent` and
  `_meta` never appear in model-bound serialization, including
  across rehydration.
- **Data boundary — view path**: `_meta` (including
  `io.modelcontextprotocol/related-task` and server-defined
  keys outside the reserved namespace) is preserved on
  `ui/notifications/tool-result` to the view, and on
  view-path `tasks/result` rehydration.

### MCP Tasks

- Per-tool `taskSupport: required` rejects synchronous calls.
- Per-tool `taskSupport: forbidden` rejects task-augmented calls.
- v1 augmentation policy: only `required` tools become tasks;
  `optional` and `forbidden` run synchronously. No operator
  allowlist promotes `optional` to task.
- **Independent feature flags**: `MCP_APPS_ENABLED` ON +
  `MCP_TASKS_ENABLED` OFF advertises Apps capability without
  Tasks capability; the inverse also works.
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
- **Jobs panel is status-only on open**: opening the panel calls
  `tasks/list` + `tasks/get` to refresh state and TTL, and does
  **not** call `tasks/result` for any row.
- **Detail entry triggers `tasks/result`**: opening a terminal
  task's detail row, or clicking "wait for result" on an
  in-flight task, calls `tasks/result` exactly once.
- **Single-path wait**: entering "wait for result" on an
  in-flight task **suspends `tasks/get` polling for that
  task**; only `tasks/result` is in flight. Polling resumes
  on call failure, user cancel, or navigation away.
- **Opportunistic save**: a task subscribed by an active observer
  that transitions to terminal while the user is present
  triggers a single `tasks/result` and the result is cached.
- **TTL-bounded cache**: a cached `tasks/result` row is served
  only while `now < createdAt + ttl`; afterwards the cache
  refuses and a fresh `tasks/result` is issued (which may
  legitimately answer "task expired"). MongoDB TTL index
  removes expired rows automatically.
- Disconnect during polling → subscriber resubscribes after
  reconnect via `tasks/list` + `tasks/get`.
- HTTP 404 for `MCP-Session-Id` → new session,
  **outstanding-task revalidation** runs (Phase 4 work, not
  Phase 0): each known `taskId` is queried via `tasks/get` on
  the new session; "not found" becomes terminal-with-error.
- `progressToken` propagates through bridge to active subscribers
  via in-memory mapping.
- `model-immediate-response`: emitted as intermediate message;
  model suppressed; final result appended without overwriting.
- **`authContextHash` binding**: `tasks/list` from a different
  context returns empty; `tasks/get` for another context's
  task returns not-found. A test deliberately mutates the
  underlying auth configuration mid-flight and verifies the
  hash changes and prior tasks become invisible (with a UI
  message explaining the binding).
- **`tasks/result` rehydration**: response is semantically
  equivalent to the original request's — same envelope type
  (result vs error), same parsed structure, `_meta` preserved
  including `related-task`. Pointerized blob offloads rehydrated
  back to inline shape (or original CallToolResult linkage)
  before responding. Byte-for-byte serializer equality is not
  asserted.
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
| 0 — Transport reliability + auth-context substrate | 3–5 days |
| 1 — Types + sandbox infra + bridge wrapper (incl. construction-order + nonce relay tests) | 1 week |
| 2 — Apps v1 end-to-end + full HostContext + capability turn-on | 2–3 weeks |
| 3 — `tool-input-partial` (optional) | 1 week (risk) |
| 4 — MCP Tasks v1 (parallel with 2) | 2 weeks |
| 5 — Hardening + browser matrix + ops docs | 1 week |
| **Total (serial, excl. parallelism)** | **~5.5–7.5 weeks** |
| **Phases 0 + 1 + 2** (Apps shipped, Tasks deferred) | **~3.5–4.5 weeks** |
| **Phases 0 + 1 + 2 + 4** (functional CAD app, Tasks v1) | **~3.5–5 weeks** |

The **Apps-only** track is now a first-class option because Apps
and Tasks are gated by independent feature flags. If Tasks slips
past v1 cut, Apps still ships.

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
