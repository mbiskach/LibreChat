# Plan: MCP Apps + MCP Tasks Support in LibreChat

**Status:** Draft / scoping document — no code in this PR.
**Owner:** TBD
**Target branch:** `claude/mcp-apps-spec-support-rEi7X`
**Revision:** v9 — restructures the implementation strategy to
adopt upstream PR #11799 and the `dev`-branch transport fixes
rather than parallel-build, splits Apps into a Preview track
and a Hardened GA track, narrows the first Apps release to
live chat only, defers full-conversation remount out of the
critical path, and trims Tasks v1 to status-first after the
eighth review:

- **Adopt-then-layer, not parallel-build.** Earlier revisions
  framed this plan as a from-scratch Apps implementation that
  happened to live near upstream. v9 explicitly inherits
  upstream [PR #11799](https://github.com/danny-avila/LibreChat/pull/11799)
  (`feat: MCP Apps Extension Support`) as the substrate and
  layers the v8 security/hardening delta on top. Several
  items the plan had been treating as differentiators are
  already implemented upstream and become regression-test
  concerns rather than greenfield work:
  - Per-instance outer iframes (`MCPAppContainer` already
    renders one outer iframe per app instance).
  - Same-server binding for forwarded MCP methods (the
    bridge already binds `tools/call` and `resources/read`
    to the instance's stored `serverName`; a single shared
    ACL function is now a refactor, not a new capability).
  - Backend sandbox endpoint authentication and
    `appsEnabled` gating for `/api/mcp/sandbox`.
  - `ui://` URI validation for `resources/read`.
  - Capability advertising disabled when
    `mcpSettings.apps` is off.
  - `mcp_app` artifact + metadata propagation through tool
    definitions.
  - An Apps test server scaffold for interop coverage.
  - `stableMCPAppRef` for parent-re-render survival in
    active chat.

  These are listed in the Upstream context section as
  **inherited; verify with regression tests** rather than as
  intentional divergences.

- **Apps Preview track + Hardened GA track.** v9 acknowledges
  that the v8 hardening model (dedicated
  `MCP_SANDBOX_ORIGIN`, hop-specific relay validation,
  proxy-stamped nonce, manifest-hash approval, self-contained
  HTML, `connect-src 'none'`, retired legacy renderer) is
  expensive on purpose. To avoid blocking any user-visible
  shipping on all of it at once, v9 splits Apps phasing into
  two named tracks:
  - **Apps Preview** (Phase 2P): adopt #11799 substantially
    as-is — `mcp_app` artifacts, backend proxies,
    per-instance chat rendering, the branch-native config
    (`allowedConnectDomains`, `blockedDomains`, `maxHeight`,
    `allowFullscreen`), the existing bridge/sandbox flow
    behind `mcpSettings.apps` and a new
    `MCP_APPS_PREVIEW_ENABLED` flag. Inline display only,
    chat surface only. No new approval store. No
    `MCP_SANDBOX_ORIGIN`. The legacy `UIResourceRenderer`
    keeps running on share/search/plugin surfaces during
    Preview.
  - **Apps Hardened GA** (Phase 2H, follow-up release):
    layer the v8 security delta on top of Preview —
    dedicated `MCP_SANDBOX_ORIGIN`, explicit-target-origin
    transport, hop-specific validation + proxy-stamped
    nonce, folded-in `ui/initialize` probe,
    `connect-src 'none'`, self-contained-HTML rule,
    `MCPAppLaunchManifest` + `manifestHash` review,
    `MCPAppInstance` remount persistence, full retirement
    of `UIResourceRenderer` across all surfaces, `ui://`
    domain still rejected, `prefersBorder` still ignored,
    operational limits enforced. Gated behind
    `MCP_APPS_HARDENED_ENABLED`.
  This is a real product trade — Preview ships earlier with
  weaker guarantees — and v9 names it explicitly rather than
  hiding it inside "implementation detail."

- **First Apps release narrows to live chat only.** Upstream
  Apps code lives under
  `client/src/components/Chat/Messages/Content/MCPApp/`,
  while `MCPUIResource` is the generic component used by
  share, search, and plugin-rendered messages. v9 makes it a
  hard rule that share, search, and plugin surfaces fall
  back to **text rendering** when an MCP UI resource
  appears, both during Preview and at Hardened GA. Cross-
  surface support is a post-Hardened-GA increment. This cuts
  the audit + test matrix significantly and removes a class
  of "what does this view look like in share?" coupling.

- **`MCPAppInstance` remount persistence moves out of the
  critical path.** Upstream's `stableMCPAppRef` already
  preserves the most common active-chat use case (parent
  re-render does not reset the app). Full-conversation
  remount after refresh — DB-backed, `manifestHash`-pinned,
  divergence-aware — is now a Hardened GA item, not Preview.
  This avoids dragging schema, approval coupling, and
  rehydration logic into the first user-visible release.

- **Tasks v1 trimmed to status-first.** Since there is no
  upstream Tasks WIP to inherit, Phase 4's surface area
  contracts to: per-tool `taskSupport` honoring,
  active-subscriber polling, status-only jobs panel,
  explicit detail / wait-for-result, cancel,
  `authContextHash` ownership, TTL-bounded cache,
  outstanding-task revalidation on 404. Progress bars and
  richer placeholder UI are deferred until upstream
  [PR #12535](https://github.com/danny-avila/LibreChat/pull/12535)
  (real-time `notifications/progress`) lands; reuse it
  rather than rebuild. `model-immediate-response` stays in
  Phase 4 because it is independent of progress UI.

- **Phase 0 inherits the `dev` transport fixes.**
  Implementation starts from `dev`, not the older `main`
  HEAD. Phase 0 inherits PR #12850 (307/308 + credential
  stripping + SSRF), PR #12853 (idle-check trigger), and
  PR #12910 (tool-cache lookup hardening). Phase 0
  plan-original work (session reuse, header consistency,
  basic 404 → re-init, per-user token scoping,
  `authContextHash`, operator policy defaults) stays.

- **Fullscreen decided.** Upstream #11799 already implements
  fullscreen request handling and a fullscreen portal UI
  (`allowFullscreen`, fullscreen iframe). Earlier revisions
  said v1 was inline-only. v9 **accepts upstream fullscreen
  in Preview** behind a per-server operator setting
  (default OFF), and revisits in Hardened GA against the
  same trust-chrome rules (mandatory border + identity
  chrome must be visible even in fullscreen). Stripping it
  from the delta is more work than gating it.

- **Refactor delta vs replacement delta.** v9 distinguishes
  refactor work (e.g. wrap the existing per-instance same-
  server binding into a single `forwardMcpRequestFromView`
  ACL function) from replacement work (e.g. swap the data
  URL outer iframe for a dedicated-origin proxy). The
  former is cheap and lands during Preview as cleanup; the
  latter is Hardened GA. Items are tagged in the phase
  bullets to make the difference obvious.

- **No direct browser networking in v1.** With the inner iframe
  sandboxed without `allow-same-origin`, the browser serializes
  its origin as `null`. With `_meta.ui.domain` rejected in v1,
  there is no stable origin to offer to app servers either.
  Continuing to honor `_meta.ui.csp.connectDomains` for
  `connect-src` while denying both same-origin and a stable
  domain is trying to have it both ways: it works for some
  open public endpoints, but fails on conservative CORS,
  cookies, OAuth callbacks, and origin-bound API allowlists.
  v8 cuts direct browser networking entirely. The default
  inner-view CSP is `connect-src 'none'`. App authors route
  network access through MCP `tools/call`, `resources/read`,
  and `ui/open-link`, all of which the host proxies and
  governs. `_meta.ui.csp.connectDomains` is **ignored** in v1
  for asset loading **and** for `connect-src` synthesis. The
  field stays in the parser so v2 can consider re-introducing
  it once a stable-origin story (e.g. `_meta.ui.domain`,
  per-instance subdomain delegation, or signed-token request
  proxying) exists.
- **Approval binds to a launch manifest, not just HTML bytes.**
  v7's `approvedHash = sha256(html)` is too narrow: a server
  can keep HTML stable while broadening permissions or CSP
  posture. v8 introduces a canonical
  `MCPAppLaunchManifest` whose hash covers the decoded HTML,
  the host-filtered effective sandbox flags, the effective
  iframe `allow` permissions, the effective network policy
  (`connect-src` set, navigation allowlist intersection), the
  resource URI, and a host trust-policy version. Both
  `MCPResourceReview.manifestHash` and
  `MCPAppInstance.manifestHash` use this. Divergence on any
  policy axis triggers re-approval.
- **Legacy `UIResourceRenderer` path is gated, not bypassed.**
  Public `main` ships
  `client/src/components/MCPUIResource/MCPUIResource.tsx` using
  `UIResourceRenderer` from `@mcp-ui/client` with
  `sandboxPermissions: 'allow-popups'`, reachable from chat,
  share, and search views. v7 silently introduced a stricter
  Apps path next to it, leaving a permissive renderer in
  production. v8 makes the migration explicit:
  - When `MCP_APPS_ENABLED=true`, the legacy path is
    **disabled across all surfaces** (chat, share, search,
    plugin-rendered messages). Tools that declare
    `_meta.ui.resourceUri` route through the new Apps path;
    everything else falls back to the existing text
    rendering, not to the legacy renderer.
  - When `MCP_APPS_ENABLED=false`, the legacy path stays as
    today (operators who haven't migrated keep their current
    behavior), but its `allow-popups` default is replaced by
    a deny-by-default `sandboxPermissions: ''` and a banner
    pointing to the Apps migration.
  - There is no mode where both paths are active for the
    same message.
- **Concrete operational limits.** v7 left these to "decide
  during implementation." v8 fixes defaults so the security
  surface is bounded:
  - `MCP_APPS_MAX_HTML_BYTES`: 2 MiB (rejected at review).
  - `MCP_APPS_MAX_TOOL_RESULT_BYTES_TO_VIEW`: 8 MiB (forwarded
    `tool-result` payload to a view; larger results are
    truncated on the view path with a clear marker; the model
    path still sees `content` truncated separately under its
    own existing rules).
  - `MCP_TASKS_MAX_RESULT_ENVELOPE_BYTES`: 12 MiB inline; over
    that, blob-offload (already in plan) kicks in.
  - `MCP_APPS_TEARDOWN_WAIT_MS`: 1500 ms — the host waits for
    `ui/resource-teardown` response before forcibly removing
    the iframe, then removes regardless.
  - `MCP_APPS_VIEW_RPC_RATE_PER_MIN`: 600 inbound JSON-RPC
    messages per view per minute; over that, the view is
    paused with a clear chrome message.
  - `MCP_APPS_VIEW_NOTIF_RATE_PER_MIN`: 1200 inbound
    notifications per view per minute (covers `ping`,
    `notifications/message`, `size-changed` echoes, etc.).
  - `authContextHash` is `sha256(canonicalJSON(authPayload))`
    where `authPayload` is the normalized config (see Auth
    canonicalization below).
- **Content decoding and MIME validation are explicit.** UI
  resources can arrive as `text` or base64 `blob` per the
  Apps spec, with MIME `text/html;profile=mcp-app`. v8's
  review pipeline runs in this order:
  1. Reject if `mimeType` is missing or does not equal
     `text/html;profile=mcp-app` (parameter order
     normalized).
  2. Decode the payload: `text` is taken verbatim; `blob` is
     base64-decoded under the `MCP_APPS_MAX_HTML_BYTES`
     limit and UTF-8 validated.
  3. Reject multi-content responses (only one item per
     `resources/read`).
  4. Run the self-contained-HTML validator on the decoded
     bytes.
  5. Compute the launch-manifest hash.
- **Relay self-test folds into `ui/initialize`.** v7 invented
  a separate ping path. v8 deletes it. The first relayed
  `ui/initialize` is the test: if the host receives a
  schema-valid initialize through the proxy with a
  proxy-stamped per-view nonce within a fixed timeout, the
  mount passes. If the timeout elapses or validation fails,
  the host tears down the iframe and falls back to text-only
  for that mount. Same end-to-end coverage, one fewer
  protocol surface.
- **Trust chrome is mandatory.** `_meta.ui.prefersBorder=false`
  is **ignored** in v1. Every Apps view renders inside a
  host-controlled border with persistent identity chrome
  (server, OAuth scopes, manifest hash short-prefix). The
  Apps spec recommends clear sandbox boundaries; in chat
  transcripts, removing them buys very little UX value and
  weakens the trust boundary. Re-evaluate when there is a
  stronger provenance and permissions surface.
- **Drop opportunistic terminal-result persistence.** v7
  allowed the host to fetch `tasks/result` whenever a
  subscribed task transitioned to terminal while the user
  was present. v8 cuts that. `tasks/result` is invoked only
  on **(a) explicit detail entry** or **(b) explicit "wait
  for result"** — nothing else. This eliminates a hidden
  retention layer, simplifies the cache, removes a class of
  rate-limit interactions, and matches the spec's normative
  status path (`tasks/get` polling) more cleanly. If a user
  watches a task to completion in a mounted view, the view
  itself still receives the underlying tool result via the
  bridge; the host does not need to re-fetch it.
- **Outer-proxy sandbox flags pinned.** v8 makes the split
  with the inner iframe explicit so reviewers don't conflate
  them. The outer `MCP_SANDBOX_ORIGIN` proxy iframe runs with
  `sandbox="allow-scripts allow-same-origin"` (required by
  the Apps spec for proxy hosts). The inner app iframe runs
  with the v6/v7 hardened flag set and **never** `allow-
  same-origin`. These are two different policies on two
  different frames at two different origins.
- **`MCPAppInstance` stays narrow.** It re-instantiates an
  approved view; it is not a generic state-management
  store. Apps that want durable view state keep it on their
  MCP server. v8 makes this explicit because the artifact's
  scope is the place such a store would otherwise creep in.

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

Carried forward (still in force, with track-tags):

Legend: **[P]** = Apps Preview track. **[H]** = Apps Hardened
GA track. **[T]** = Tasks track. **[A]** = applies to all.

- **[T]** Cancellation after terminal returns `-32602` invalid
  params.
- **[T]** `input_required` preserves server status; host marks
  `hostHandlingState = "unsupported_lifecycle"`; no fake
  `failed` envelope.
- **[T]** Active-subscriber polling only; no API-process
  background poller; no durable subscriber registry.
- **[H]** `_meta.ui.domain` unsupported; single
  `MCP_SANDBOX_ORIGIN`. (Preview keeps the upstream `data:`-URL
  outer iframe.)
- **[H]** Self-contained HTML only; approves bytes, not
  origins. (Preview honors upstream
  `allowedConnectDomains` / `blockedDomains` model.)
- **[H]** PostMessage transport wrapper around `AppBridge`
  sends to explicit target origins; preserves SDK receive
  validation. (Preview keeps the upstream `'*'` send.)
- **[A]** Iframe sandbox hardened defaults at the inner frame;
  `ui/open-link` is the only navigation escape hatch.
- **[H]** Hop-specific relay validation; host rejects `null`
  origin; proxy-stamped per-view nonce.
- **[H]** Single ACL function for all forwarded MCP methods.
  (Preview already gets same-server binding via per-instance
  `serverName`; the consolidation is a refactor.)
- **[H]** Resource fetch / decode / manifest / hash / review
  is server-side; browser receives already-approved payloads.
- **[A]** `ui/message` is `user`-only per generated stable schema.
- **[A]** CAD example persists artifact handle, not presigned
  URL.
- **[A]** Independent feature flags: `MCP_APPS_PREVIEW_ENABLED`,
  `MCP_APPS_HARDENED_ENABLED`, `MCP_TASKS_ENABLED`. (`MCP_APPS_ENABLED`
  from earlier revisions is **superseded** by the two-flag
  split; keep the old name as an alias that sets Preview only,
  with a deprecation note.)
- **[A]** One outer sandbox proxy iframe per app instance; no
  pooling. (Already true upstream; verified in Preview, kept
  in Hardened GA.)
- **[A]** Host construction-order invariant.
- **[A]** Model-path vs view-path data boundary; `_meta`
  preserved on the view path.
- **[T]** Status-only jobs panel; `tasks/result` on detail
  entry or explicit wait — nothing else. Progress UI deferred
  to upstream PR #12535 reuse.
- **[A]** Lazy-loaded `AppBridge` runtime on the client.
- **[A]** Sizing fallback height + `shrinkWrap: false` opt-out.
  (Preview also accepts upstream `maxHeight`.)
- **[H]** `MCPAppInstance` artifact for full-conversation
  remount; not a state store. (Preview relies on
  `stableMCPAppRef` for parent-re-render survival; full
  remount is Hardened GA.)
- Local task-result cache bounded by `createdAt + ttl`;
  `MCPTask` is a cache, not durable storage.
- Tasks-only over Streamable HTTP.
- Outstanding-task revalidation on HTTP 404 lives in Phase 4
  (Tasks-specific), not Phase 0.
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
   panel is observing. `tasks/result` is invoked **only** on
   explicit detail entry or explicit "wait for result" — there is
   no opportunistic terminal-result fetch. No background
   API-process poller, no durable subscriber registry.
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
   `_meta.ui.csp.resourceDomains` is **ignored** in v1.
6a. **Network policy: no direct browser networking in v1.**
    The default inner CSP has `connect-src 'none'`. Apps cannot
    call out via `fetch`, XHR, or WebSocket from the view JS.
    `_meta.ui.csp.connectDomains` is **also ignored** in v1;
    the field is parsed but never installed in the runtime CSP.
    All app-driven network access flows through the bridge:
    `tools/call`, `resources/read`, and `ui/open-link`. The
    rationale is that without `allow-same-origin` and without
    `_meta.ui.domain`, the inner frame's network identity is
    `null`, which interacts badly with conservative CORS,
    cookies, OAuth, and origin-based API allowlists. Re-
    introducing `connect-src` from server metadata is post-v1
    and depends on a stable-origin design.
6b. **Approval is over a launch manifest, not just HTML.**
    `manifestHash` is the canonical hash over: decoded HTML,
    host-filtered effective sandbox flags, effective iframe
    `allow` permissions, effective network policy
    (`connect-src` set, navigation allowlist intersection),
    `resourceUri`, and host trust-policy version. Both review
    and remount records bind to it. Divergence on any policy
    axis (not just bytes) triggers re-approval.
6c. **Content decoding pipeline.** `resources/read` results
    are decoded in this fixed order: validate
    `mimeType === "text/html;profile=mcp-app"` (parameter
    order normalized); decode `text` verbatim or
    base64-decode `blob` under `MCP_APPS_MAX_HTML_BYTES`;
    UTF-8 validate; reject multi-content responses; run the
    self-contained-HTML validator; compute `manifestHash`.
6d. **Trust chrome is mandatory.** `_meta.ui.prefersBorder`
    is **ignored** in v1; every Apps view renders inside a
    persistent host-controlled border with identity chrome
    (server, OAuth scopes, manifestHash short-prefix).
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
10. **Apps and Tasks release behind separate feature flags;
    Apps splits into Preview and Hardened GA flags.**
    Three independent flags:
    - `MCP_APPS_PREVIEW_ENABLED` — adopts upstream PR #11799
      substantially as-is (per-instance chat rendering,
      `mcp_app` artifacts, backend proxies, branch-native
      config). Live chat surface only. Inline plus optional
      fullscreen behind `appSettings.allowFullscreen`. The
      legacy `UIResourceRenderer` continues to render UI
      resources on share/search/plugin surfaces during
      Preview.
    - `MCP_APPS_HARDENED_ENABLED` — turns on the v8 security
      delta. Implies Preview is on. Adds dedicated
      `MCP_SANDBOX_ORIGIN`, hop-specific relay validation
      with proxy-stamped nonce, folded-in `ui/initialize`
      probe, `connect-src 'none'`, self-contained-HTML rule,
      `MCPAppLaunchManifest` review, full retirement of
      `UIResourceRenderer` across all surfaces, mandatory
      trust chrome ignoring `prefersBorder=false`.
    - `MCP_TASKS_ENABLED` — independent of both Apps flags.
    Earlier-revision `MCP_APPS_ENABLED` is **deprecated**;
    it is kept as an alias mapping to
    `MCP_APPS_PREVIEW_ENABLED=true` only, with a deprecation
    warning at server start.
11. **One outer sandbox proxy iframe per app instance.** No
    pooling, no multiplexing in v1. Routing, teardown, audit,
    source pinning, and failure handling all simplify; no
    user-visible downside.
12. **Browser support is decided by runtime probe folded into
    `ui/initialize`.** There is **no** separate ping path. The
    first relayed `ui/initialize` is the test: the host
    starts a fixed timeout once `sandbox-resource-ready` is
    sent; if a schema-valid initialize arrives through the
    proxy with a valid proxy-stamped per-view nonce before
    the timeout, the mount passes. Otherwise the host tears
    down the iframe and falls back to text-only for that
    mount. There is no user-agent allow/deny list.
13. **Persistent app-instance artifact for remount (narrow).**
    A new `MCPAppInstance` record carries
    `(conversationId, messageId, mcpServerId, toolName,
    resourceUri, manifestHash, authContextHash, createdAt,
    lastSeen)` so re-opening a conversation can replay the
    host lifecycle around an already-approved manifest
    without inflating model context. View-internal state
    (selection, scroll, in-flight SPA navigation) is **not**
    preserved; the artifact is intentionally narrow and is
    not a state-management store. Apps that need durable view
    state keep it on their MCP server.
14. **Host-cached task results expire at upstream TTL.** Any
    locally cached `tasks/result` payload expires no later
    than `createdAt + ttl` as reported by the server.
    Persistence beyond upstream TTL is post-v1.
15. **Legacy `UIResourceRenderer` path retirement is staged
    by track.**
    - **Preview** (`MCP_APPS_PREVIEW_ENABLED=true`,
      `MCP_APPS_HARDENED_ENABLED=false`): the new Apps path
      handles **chat surface only**. The legacy renderer
      continues to render UI resources on share, search,
      and plugin-rendered surfaces. Its default
      `sandboxPermissions` is changed from
      `'allow-popups'` to `''` (deny by default). A chrome
      banner notes the migration.
    - **Hardened GA** (`MCP_APPS_HARDENED_ENABLED=true`):
      the legacy renderer is **disabled everywhere it can
      render** — chat, share, search, plugin-rendered. Tools
      with `_meta.ui.resourceUri` route through the new Apps
      path; other UI resources fall back to text. There is
      no mode where both paths render the same message.
    - **Disabled** (both flags off): same as today's `main`,
      but with the deny-default `sandboxPermissions` change
      applied. This is the safety net for operators not
      ready to opt in.
16. **Outer-proxy vs inner-iframe sandbox split.** The outer
    sandbox-proxy iframe (loads `proxy.html` from
    `MCP_SANDBOX_ORIGIN`) runs with
    `sandbox="allow-scripts allow-same-origin"` per the
    Apps spec's host-side requirements for proxies. The
    **inner** iframe (the app view, rendered via `srcdoc`)
    runs with the v6/v7 hardened flag set and **never**
    `allow-same-origin`. These are two different policies
    on two different frames at two different origins.
17. **Operational limits (defaults, operator-tunable).**
    - `MCP_APPS_MAX_HTML_BYTES = 2 MiB` (review reject).
    - `MCP_APPS_MAX_TOOL_RESULT_BYTES_TO_VIEW = 8 MiB`
      (view-path truncation with marker; model path
      truncated separately).
    - `MCP_TASKS_MAX_RESULT_ENVELOPE_BYTES = 12 MiB` inline
      (above triggers blob offload).
    - `MCP_APPS_TEARDOWN_WAIT_MS = 1500`.
    - `MCP_APPS_VIEW_RPC_RATE_PER_MIN = 600` (request
      throttle per view).
    - `MCP_APPS_VIEW_NOTIF_RATE_PER_MIN = 1200`
      (notification throttle per view).
    - `MCP_APPS_INITIALIZE_TIMEOUT_MS = 5000` (the relay
      probe fold-in deadline).
18. **`authContextHash` canonicalization.** Compute as
    `sha256(canonicalJSON(authPayload))` where
    `canonicalJSON` is RFC 8785 JCS-equivalent (sorted
    keys, no whitespace, no insignificant differences) and
    `authPayload = { userId, mcpServerId, credentialSource,
    headerAuthFingerprint, configRevision }`. All five
    fields are required; missing fields are explicit
    `null` so the hash distinguishes "absent" from
    "empty". The function lives in `packages/api` and has
    a dedicated unit-test corpus.
19. **Adopt upstream PR #11799 + `dev` transport fixes as
    the substrate, then layer the v8 hardening delta.**
    Implementation does not parallel-build. Phase 0 starts
    from `dev` (inheriting PRs #12850, #12853, #12910).
    Phase 2P (Apps Preview) inherits #11799 substantially
    as-is and adds the live-chat narrowing and the
    deny-default `sandboxPermissions` legacy change.
    Phase 2H (Apps Hardened GA) layers the v8 security
    delta on top. Items already implemented upstream
    (per-instance outer iframes, same-server binding via
    instance state, `/api/mcp/sandbox` auth + `appsEnabled`
    gating, `ui://` URI validation, capability advertising
    gating, `mcp_app` artifact plumbing,
    `stableMCPAppRef`) are **inherited; verify with
    regression tests** rather than re-implemented.
20. **First Apps release (Preview and Hardened GA both)
    is live-chat-only.** Share, search, and plugin-
    rendered surfaces fall back to text rendering even
    after Hardened GA. Cross-surface support is a
    post-Hardened-GA increment. This rule applies even
    when both flags are on; opting in does not unlock
    other surfaces.
21. **Fullscreen accepted in Preview behind operator
    gate.** Upstream #11799 already implements
    `appSettings.allowFullscreen` and the fullscreen
    portal. v9 keeps this code; fullscreen is OFF by
    default per server. Hardened GA re-validates trust
    chrome rules under fullscreen (mandatory border +
    identity chrome must remain visible). Other display
    modes (`pip`, etc.) remain out of scope.

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
| `_meta.ui.csp.connectDomains` | No direct browser networking in v1; route via `tools/call` / `resources/read` / `ui/open-link` |
| Direct in-app `fetch` / XHR / WebSocket | Inner-frame origin is `null`; no stable origin for CORS / cookies / OAuth in v1 |
| `_meta.ui.prefersBorder = false` | Trust chrome is mandatory in v1 |
| Opportunistic terminal-result persistence in Tasks | Cut to reduce hidden retention; `tasks/result` only on detail entry / explicit wait |
| Separate relay-probe protocol surface | Folded into the first relayed `ui/initialize` |
| Approval over HTML hash alone | Approval binds to `manifestHash` (HTML + sandbox + permissions + network policy + URI + trust-policy version) |
| Multiplexed / pooled sandbox proxy iframe | One proxy iframe per app instance in v1 |
| User-agent allow/deny list for browser support | Runtime relay self-test (folded into `ui/initialize`) instead |
| Locally cached `tasks/result` past upstream TTL | Cache, not durable store; persistence beyond TTL is post-v1 |
| Durable persistence of view-internal app state | Spec defers; remount artifact only re-instantiates the view |
| Coexistence of legacy `UIResourceRenderer` with new Apps path on same message | Legacy path disabled when `MCP_APPS_ENABLED=true` |
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
- **Jobs panel is status-only.** Opening the panel does **not**
  call `tasks/result` for any row. It loads task state with
  `tasks/list` / `tasks/get`, displays status and TTL, and
  only calls `tasks/result` on (a) explicit detail entry or
  (b) explicit "wait for result" on an in-flight task. There
  is **no opportunistic save** path: a subscribed task that
  reaches terminal while the user is present does **not**
  trigger an automatic `tasks/result`. The mounted view that
  produced the task already received the underlying tool
  result via the bridge; the host does not need to re-fetch
  it. Cutting opportunistic save eliminates a hidden
  retention layer and matches the spec's normative status
  path more cleanly.
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

## Upstream context and related work

This plan adopts upstream LibreChat work where it exists and
layers the v8 hardening delta on top. It does not parallel-build.

### Direct overlap — MCP Apps (substrate to inherit)

- **PR [#11799](https://github.com/danny-avila/LibreChat/pull/11799)
  — `feat: MCP Apps Extension Support`** (open, branch
  `KyleKincer:feat/mcp-apps`). Implements the
  `io.modelcontextprotocol/ui` substrate end-to-end:
  `_meta.ui.resourceUri` discovery through tool definitions, a
  two-layer sandboxed iframe at
  `client/public/mcp-sandbox.html`, a JSON-RPC bridge
  (`MCPAppBridge.ts` with optional
  `@modelcontextprotocol/ext-apps` SDK adapter), an `mcp_app`
  artifact attachment, backend proxies at
  `/api/mcp/{resources/read, app-tool-call, sandbox}`,
  `mcpSettings.apps` / `appSettings` configuration, dynamic
  CSP synthesis from `connectDomains` / `resourceDomains` /
  `frameDomains` / `baseUriDomains`, fullscreen handling, and
  a `modelTools` vs `allTools` visibility split.
- **Issue [#10641](https://github.com/danny-avila/LibreChat/issues/10641)
  — `Enhancement: Support for MCP Apps`** (open). The
  long-standing tracking issue that #11799 implements against.

#### Inherited from #11799 (regression-test only, not re-implemented)

These items the plan previously listed as differentiators are
already implemented in the upstream branch. v9 does not
re-implement them; Phase 2P relies on them and Phase 1 covers
them with regression tests:

- Per-instance outer iframes (`MCPAppContainer` already renders
  one outer iframe per app, with its own `sandboxSrc` derived
  from the `/api/mcp/sandbox` template).
- Same-server binding for forwarded MCP methods. The bridge
  binds `tools/call` and `resources/read` to the instance's
  stored `serverName`. v9's "single shared ACL" is a
  consolidation refactor (Phase 2P), not a new capability.
- `/api/mcp/sandbox` endpoint authentication and `appsEnabled`
  gating.
- `ui://` URI validation for `resources/read` requests
  forwarded from views.
- Capability advertising disabled when `mcpSettings.apps` is
  off, threaded through connection construction.
- `mcp_app` artifact + metadata propagation through tool
  definitions (`_meta.ui.resourceUri`).
- An Apps test server scaffold for interop coverage.
- `stableMCPAppRef` to preserve app state across parent
  re-renders during active chat.

#### Hardening delta layered on top of #11799 (Phase 2H, intentional)

These items are the ones #11799 does **not** cover and that v8's
security thesis still requires. They become Hardened GA work
rather than parallel implementation:

1. **Self-contained HTML only.** #11799 allows external assets
   via `resourceDomains`-driven CSP. Hardened GA cuts external
   assets entirely so approval can bind to bytes (see
   `manifestHash`).
2. **No direct browser networking.** #11799 honors
   `connectDomains` and lets the view `fetch` directly.
   Hardened GA sets `connect-src 'none'` and routes everything
   through `tools/call` / `resources/read` / `ui/open-link`
   because the `null` inner-frame origin makes credentialed
   browser networking unreliable.
3. **Dedicated `MCP_SANDBOX_ORIGIN`.** #11799 fetches the
   sandbox template from `'/api/mcp/sandbox'` on the
   application origin and converts the HTML to a `data:` URL
   for the outer iframe. Hardened GA replaces this with a
   different-origin static `proxy.html` served from
   `MCP_SANDBOX_ORIGIN`, with `frame-ancestors` enforced via
   response header.
4. **Hop-specific relay validation with proxy-stamped per-view
   nonce.** #11799 validates inbound primarily by
   `event.source`; the custom bridge sends with
   `postMessage(..., '*')`. Hardened GA wraps `AppBridge` with
   an explicit-target-origin transport and adds the
   proxy-stamped nonce so trust does not depend on
   `event.source` alone (this is the WebKit/Safari relay
   bug fix path).
5. **Approval over a launch manifest, not just HTML hash.**
   #11799 has no review/approval store at all. Hardened GA
   binds review and remount to `manifestHash` covering
   sandbox flags, permissions, network policy, URI, and
   trust-policy version.
6. **Construction-order invariant** explicit and tested as a
   Hardened-GA exit criterion (the upstream `srcdoc` race
   discussion and PR #543 in `modelcontextprotocol/ext-apps`).
7. **Trust chrome mandatory; `prefersBorder=false` ignored.**
8. **Full retirement of `MCPUIResource` / `UIResourceRenderer`
   across chat, share, search, and plugin-rendered surfaces.**
   Preview only retires it on chat; Hardened GA finishes the
   migration. There is no mode where both paths render the
   same message at Hardened GA.
9. **Operational limits and rate limits with concrete
   defaults.**
10. **Streamable HTTP–only Tasks support with
    `authContextHash` ownership binding** (separate scope from
    Apps; #11799 does not touch Tasks).

If #11799 lands in `main` before Phase 2P starts, the plan
treats it as a clean inheritance. If #11799 stalls upstream,
Phase 2P cherry-picks it from the open PR.

### Direct overlap — MCP Tasks

- **Issue [#11997](https://github.com/danny-avila/LibreChat/issues/11997)
  — `Enhancement: Support for MCP Tasks`** (open, no PR, no
  branch). Names the SEP-1686 use case (long-running tool
  calls without fixed timeouts) but does not enumerate
  `tasks/get` / `tasks/list` / `tasks/cancel` / `tasks/result`.
  All Tasks control-plane work in this plan is greenfield
  against upstream; cite #11997 as the open ask and the
  natural place to file the eventual PR. Tasks does not
  benefit from any upstream Apps WIP.

### Adjacent — transport reliability (inherit from `dev`)

Phase 0 starts from `dev`, not from the older `main` HEAD,
specifically to inherit these:

- **PR [#12850](https://github.com/danny-avila/LibreChat/pull/12850)
  — `fix: Follow 307/308 redirects in MCP streamable HTTP
  transport`** (merged Apr 29 2026 into `dev`; **not** in
  HEAD `738003b220a91ec724286dab0354080e22f8aac9`).
  Method-preserving 307/308 follow with depth limit 5,
  cross-origin credential stripping (`Authorization`,
  `Cookie`, `mcp-session-id`, configured server headers,
  `Proxy-Authorization`), SSRF revalidation per hop,
  HTTPS→HTTP downgrade block. **Inherited; Phase 0 adds
  regression coverage only.** If implementation accidentally
  starts from `main` HEAD, port these tests/code first.
- **PR [#12853](https://github.com/danny-avila/LibreChat/pull/12853)
  — idle-check trigger fix** (merged Apr 29 2026, transport
  hygiene). **Inherited.**
- **PR [#12910](https://github.com/danny-avila/LibreChat/pull/12910)
  — MCP tool cache lookup failure handling** (merged May 2
  2026, hygiene). **Inherited.**
- **Issue [#12802](https://github.com/danny-avila/LibreChat/issues/12802)
  — proactive MCP OAuth token refresh with per-user jitter**
  (open, adjacent to per-user token scoping). Track upstream
  movement; if a PR lands, fold its progress into Phase 0's
  per-user token-scoping closure.

### Adjacent — Tasks UX reuse, not control plane

- **PR [#12535](https://github.com/danny-avila/LibreChat/pull/12535)
  — MCP progress notifications** (open). Adds real-time
  `notifications/progress` rendering for tool-call cards over
  SSE / streamable transports. Useful for the *presentation*
  side of long-running operations. Does **not** implement
  task creation, polling, wait-for-result, rehydration, TTL,
  `authContextHash`, or 404 revalidation. v9 explicitly
  defers Tasks v1 progress UI until #12535 lands and reuses
  it; building progress UI is **not** a Phase 4 dependency.

### Adjacent — already in HEAD `738003b`

These have already landed and are foundations this plan builds
on (no Phase 0 work required):

- PR #12782 (tenant context in MCP OAuth callback).
- PR #12763 (`WWW-Authenticate` `resource_metadata` hint).
- PR #12755 (validate OAuth protected-resource metadata
  binding).
- PR #12745 (persist/enforce `disable-model-invocation`,
  `user-invocable`, `allowed-tools`).
- PR #12812 (handle unhandled MCP OAuth reconnect rejections).

### Notably absent upstream

There is **no** open PR or issue upstream covering:

- `MCP-Session-Id` reuse correctness, `MCP-Protocol-Version`
  header consistency, or HTTP 404 → re-initialize.
- Per-user header/token scoping for shared server
  definitions (the recent advisory).
- Outstanding-task revalidation after a session re-init.
- Cross-surface retirement of the legacy
  `MCPUIResource` / `UIResourceRenderer` path (#11799 only
  introduces the new path on the chat surface).
- A dedicated `MCP_SANDBOX_ORIGIN` outer iframe (upstream
  uses `data:` URL on the application origin).
- A `manifestHash`-based review/approval store for resource
  bytes + policy.
- Hop-specific relay validation with proxy-stamped per-view
  nonce.

These remain plan-original work — Phase 0 (transport),
Phase 2H (Hardened GA Apps), and Phase 4 (Tasks).

## Current state of LibreChat MCP integration

| Area | Status | Location |
|---|---|---|
| MCP client + transports | Done | `packages/api/src/mcp/` |
| Tools, resources, prompts | Done (sampling/roots not impl.) | `packages/api/src/mcp/connection.ts` |
| OAuth 2.0 + dynamic client registration + PKCE | Done | `packages/api/src/mcp/oauth/` |
| MCP server management UI | Done | `client/src/components/SidePanel/MCPBuilder/` |
| Sandboxed iframe UI rendering (mcp-ui ad-hoc, `allow-popups` default) | Done — Preview retires on chat only, Hardened GA retires across all surfaces | `client/src/components/MCPUIResource/MCPUIResource.tsx` via `@mcp-ui/client` |
| Default deny `sandboxPermissions` on legacy path | Phase 1 (applies even when both Apps flags off) | legacy renderer |
| Cross-surface retirement of `UIResourceRenderer` (chat, share, search, plugin) | Phase 2H (Hardened GA) | client surfaces |
| Sampling / elicitation | Missing | blocks `input_required` |
| 307/308 redirect handling on Streamable HTTP | **Inherited from `dev` (PR #12850)** if implementation starts from `dev`; otherwise port | transport layer |
| Cross-origin credential stripping on redirects | **Inherited from `dev` (PR #12850)** | transport layer |
| Idle-check trigger fix on failed MCP connections | **Inherited from `dev` (PR #12853)** | transport layer |
| MCP tool cache lookup failure handling | **Inherited from `dev` (PR #12910)** | transport layer |
| Streamable HTTP session reuse correctness, header consistency, basic 404 → re-init | Phase 0 (plan-original) | transport layer |
| Per-user header/token scoping (recent advisory) | Phase 0 (plan-original) | transport layer |
| `_meta.ui.resourceUri`-driven discovery + tool-definition propagation | **Inherited from #11799 (Phase 2P)** | upstream branch |
| `mcp_app` artifact + metadata plumbing | **Inherited from #11799 (Phase 2P)** | upstream branch |
| Backend Apps proxies (`/api/mcp/{resources/read, app-tool-call, sandbox}`) | **Inherited from #11799 (Phase 2P)** | upstream branch |
| Per-instance outer iframe (`MCPAppContainer` with own `sandboxSrc`) | **Inherited from #11799 (Phase 2P)** | upstream branch |
| Same-server binding for forwarded methods (per-instance `serverName`) | **Inherited from #11799 (Phase 2P)**; consolidation refactor in Phase 2P | upstream branch |
| `/api/mcp/sandbox` auth + `appsEnabled` gating | **Inherited from #11799 (Phase 2P)** | upstream branch |
| `ui://` URI validation for forwarded `resources/read` | **Inherited from #11799 (Phase 2P)** | upstream branch |
| Capability advertising disabled when `mcpSettings.apps` off | **Inherited from #11799 (Phase 2P)** | upstream branch |
| `stableMCPAppRef` for parent-re-render survival | **Inherited from #11799 (Phase 2P)** | upstream branch |
| `appSettings.allowFullscreen` + fullscreen portal | **Inherited from #11799 (Phase 2P)**, OFF by default per server | upstream branch |
| Apps test server scaffold | **Inherited from #11799** | upstream branch |
| Apps Preview capability negotiation (gated by `MCP_APPS_PREVIEW_ENABLED`) | Phase 2P | — |
| Live-chat-only narrowing (text fallback on share/search/plugin) | Phase 2P | client surfaces |
| Single-ACL `forwardMcpRequestFromView` consolidation refactor | Phase 2P (refactor of inherited binding) | — |
| Dedicated `MCP_SANDBOX_ORIGIN` outer iframe + `frame-ancestors` header | Phase 2H (Hardened GA) | — |
| `AppBridge` wrapper with explicit-origin transport shim, lazy-loaded on client | Phase 2H (Hardened GA) | — |
| Host construction-order invariant for `srcdoc` race | Phase 2H (Hardened GA) | — |
| Hop-specific relay validation + proxy-stamped per-view nonce | Phase 2H (Hardened GA) | — |
| Folded-in `ui/initialize` relay probe + text-only fallback | Phase 2H (Hardened GA) | — |
| Truthful `hostContext` full surface (`toolInfo`, theme, locale, etc.) | Phase 2H (Hardened GA) | — |
| Self-contained-HTML validator (rejects all external assets, `<base>`) | Phase 2H (Hardened GA) | — |
| Content decoding pipeline (MIME, `text`/`blob`, UTF-8, multi-content reject) | Phase 2H (Hardened GA) | — |
| `MCPAppLaunchManifest` builder + canonical-JSON hasher (RFC 8785) | Phase 2H (Hardened GA) | — |
| First-launch resource review + manifest pinning (`MCPResourceReview.manifestHash`) | Phase 2H (Hardened GA) | — |
| `MCPAppInstance` artifact for full-conversation remount | Phase 2H (Hardened GA) | — |
| Per-resource CSP via `<meta>` injection (strict; `connect-src 'none'`) | Phase 2H (Hardened GA) | — |
| Operational limits (HTML size, view-bound payload, teardown wait, rate limits, init timeout) | Phase 2H (Hardened GA) | — |
| Trust UX (mandatory chrome; ignore `prefersBorder=false`) | Phase 2H (Hardened GA) | — |
| `authContextHash` canonicalizer + unit-test corpus | Phase 0 (Tasks consumes it; Hardened GA also uses it) | `packages/api` |
| Sizing fallback height + `shrinkWrap: false` opt-out | Phase 2P (alongside upstream `maxHeight`) | — |
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

- **Outer proxy iframe (per-instance), at `MCP_SANDBOX_ORIGIN`:**
  the host renders **one** iframe per Apps view, served from
  `MCP_SANDBOX_ORIGIN` (different origin from LibreChat). No
  pooling, no multiplexing. The iframe loads a static
  `proxy.html` shipped by LibreChat. The sandbox-origin
  response includes
  `Content-Security-Policy: frame-ancestors <librechat-origin>;`
  and disables caching. The outer proxy iframe attribute is
  `sandbox="allow-scripts allow-same-origin"` per the Apps
  spec's host-side proxy requirements. **No application
  authentication runs at the sandbox origin.**
- **Inner app iframe, opaque origin:** rendered inside the
  proxy via `srcdoc=html`. Sandbox flags use the v6/v7
  hardened set and **never** include `allow-same-origin`.
  This is what produces the `null` origin for the inner
  view; it is intentional and is the reason direct browser
  networking is cut in v1 (see CSP).
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
  2. Host runs the content-decoding pipeline (MIME +
     `text`/`blob` decode + UTF-8 validate + multi-content
     reject + self-contained-HTML validator + manifest
     construction + `manifestHash`), checks the manifest
     against `MCPResourceReview`, and sends
     `ui/notifications/sandbox-resource-ready` with
     `{ html, sandbox, csp, permissions, nonce }`. The
     128-bit `nonce` is per-view and host-generated; the
     proxy stamps it onto every relayed inbound message. The
     inner view never sees it and never echoes it.
  3. Proxy creates the inner iframe with `srcdoc=html`,
     host-filtered `sandbox` flags (no `allow-same-origin`),
     and `allow=<filtered permissions>`. It also starts the
     `MCP_APPS_INITIALIZE_TIMEOUT_MS` clock.
  4. **Relay probe folded into `ui/initialize`.** The view
     sends `ui/initialize` through its postMessage transport;
     the proxy stamps the per-view nonce and forwards to the
     host. If the host receives a schema-valid initialize
     with the correct nonce within the timeout, the mount
     passes and the host responds. Otherwise the host tears
     down the iframe and falls back to text-only for that
     mount with a clear chrome message. There is **no**
     separate ping protocol surface — the spec's normative
     init **is** the test.
  5. The view sends `ui/notifications/initialized`; only then
     may the host emit `tool-input`, `tool-result`, etc.

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

- Browser support is decided by a **runtime relay self-test
  folded into `ui/initialize`**, not by a user-agent allow/
  deny list. The first relayed initialize is the test:
  schema-valid + correct proxy-stamped nonce + within
  `MCP_APPS_INITIALIZE_TIMEOUT_MS` ⇒ mount passes.
- Chromium and Firefox are expected to pass.
- WebKit/Safari currently has an upstream issue around
  sandbox relay `event.source` reporting; the folded-in
  probe detects it because the relay-stamped initialize
  fails to validate. The host falls back to the legacy
  text-only path for that mount and surfaces a chrome
  message ("This browser cannot render this app safely;
  showing a text summary instead."). When upstream resolves
  the issue, support resumes automatically without a code
  change.
- The fallback path is per-mount, not per-session, so a user
  on a half-broken engine can still see other Apps if their
  initializations pass.

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
  required to be self-contained (see Asset policy below) **and**
  no direct browser networking is allowed:
  ```
  default-src 'none';
  script-src  'unsafe-inline';
  style-src   'unsafe-inline';
  img-src     data:;
  connect-src 'none';
  base-uri    'none';
  form-action 'none';
  ```
  `'unsafe-inline'` is necessary because the resource ships its
  scripts and styles inline; with no remote script origins
  permitted, the XSS surface is bounded to whatever is in the
  approved bytes (which is exactly what `manifestHash` protects).
- **No directive draws from server metadata in v1.**
  `_meta.ui.csp.connectDomains`, `resourceDomains`,
  `frameDomains`, and `baseUriDomains` are all **ignored**.
  v1 forbids the HTML constructs the latter three would
  permit, and v1 cuts direct browser networking, which is
  what the former would permit. The fields are still parsed
  (so v2 can re-introduce them) but never installed.
- All app network access flows through the bridge:
  `tools/call`, `resources/read`, and `ui/open-link`. Apps
  that need to call out to a third-party API expose that as
  an MCP tool on their own server; the host calls it on
  behalf of the view.
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
  hashing inside the manifest).
- `data:` images.

What the resource **may not** do over the network:

- Direct `fetch`, XHR, or WebSocket from view JS. The CSP
  default is `connect-src 'none'`. App authors call MCP
  `tools/call` or `resources/read` through the bridge for
  any server interaction, or use `ui/open-link` for
  user-driven navigation/downloads.

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

## Content decoding and MIME validation

UI resources arrive via `resources/read` as either `text` or
base64 `blob`, with MIME type
`text/html;profile=mcp-app`. The review pipeline runs in this
order; any step's failure aborts review with a clear,
operator-loggable error.

1. **MIME validation.** Reject if `mimeType` is missing or, after
   parameter-order normalization, is not
   `text/html;profile=mcp-app`. Other text MIME types (e.g.
   `text/markdown`, `text/plain`) fall back to legacy text
   rendering, not Apps.
2. **Decode.** `text` is taken verbatim. `blob` is base64-decoded
   inside the `MCP_APPS_MAX_HTML_BYTES` cap (default 2 MiB);
   over-cap payloads fail review without further work.
3. **UTF-8 validate** the decoded bytes; reject on invalid
   sequences.
4. **Multi-content rejection.** A `resources/read` response with
   more than one content item is rejected; v1 expects exactly one
   HTML payload per resource.
5. **Self-contained-HTML validator** (see Asset policy).
6. **Manifest construction.** Build the canonical
   `MCPAppLaunchManifest` from decoded HTML, host-filtered
   sandbox flags, effective `allow` permissions, effective
   network policy (always `connect-src 'none'` in v1, plus the
   navigation allowlist intersection), `resourceUri`, and host
   trust-policy version.
7. **`manifestHash`** is `sha256(canonicalJSON(manifest))` (RFC
   8785 JCS-equivalent). This is the hash recorded in
   `MCPResourceReview.manifestHash` and
   `MCPAppInstance.manifestHash`.

Resources that pass all seven steps are eligible for approval
under operator policy; resources that fail are surfaced in the
`MCPBuilder/` admin UI with the failing step.

## Operational limits

These defaults bound the security surface and runtime cost of
Apps and Tasks. All are operator-tunable; defaults lean toward
safety.

| Setting | Default | What it bounds |
|---|---|---|
| `MCP_APPS_MAX_HTML_BYTES` | 2 MiB | Maximum decoded HTML accepted at review |
| `MCP_APPS_MAX_TOOL_RESULT_BYTES_TO_VIEW` | 8 MiB | Maximum view-bound `tool-result` payload (truncated with marker over the limit) |
| `MCP_APPS_TEARDOWN_WAIT_MS` | 1500 | Time to wait for `ui/resource-teardown` response before forcing iframe removal |
| `MCP_APPS_INITIALIZE_TIMEOUT_MS` | 5000 | Deadline for the first relayed `ui/initialize` to complete the (folded-in) probe |
| `MCP_APPS_VIEW_RPC_RATE_PER_MIN` | 600 | Inbound JSON-RPC requests per view per minute before throttling/pause |
| `MCP_APPS_VIEW_NOTIF_RATE_PER_MIN` | 1200 | Inbound notifications per view per minute before throttling/pause |
| `MCP_TASKS_MAX_RESULT_ENVELOPE_BYTES` | 12 MiB | Inline-stored `tasks/result` envelope size before blob-offload |
| `MCP_TASKS_PER_USER_QUOTA` | 100 | Maximum live (non-expired) tasks per `authContextHash` |
| `MCP_APPS_FALLBACK_HEIGHT_PX` | 320 | Fallback iframe height until first non-zero `size-changed` |
| `MCP_APPS_HASH_PINNING_REQUIRED` | `false` | When `true`, manifest divergence is a hard refuse |

Limits are enforced in code; tests assert each limit triggers
the documented behavior at the boundary.

## `authContextHash` canonicalization

```
authPayload = {
  userId: string | null,
  mcpServerId: string | null,
  credentialSource: "user_oauth" | "user_apikey" | "shared_apikey" |
                    "system_oauth" | "anonymous" | null,
  headerAuthFingerprint: string | null,  // sha256 of normalized
                                         // header-auth value, or null
  configRevision: string | null,         // server config monotonic rev
}
authContextHash = sha256(canonicalJSON(authPayload))
```

`canonicalJSON` follows RFC 8785 JCS: lexicographically sorted
keys, no insignificant whitespace, no trailing commas, UTF-8
output. Missing fields are explicit `null`, never omitted, so
"absent" and "empty" are distinguishable. The function lives in
`packages/api` with a dedicated unit-test corpus covering field
permutations, null vs missing, and round-trip equality.

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

- All `_meta.ui.resourceUri` discovery, fetching, content
  decoding, self-contained-HTML validation, manifest
  construction, hashing, CSP synthesis, and caching happens in
  the host backend. The browser receives an **already-approved**
  payload.
- **First-launch review.** The first time a tool with
  `_meta.ui.resourceUri` is invoked, the host runs the full
  decoding pipeline (see "Content decoding and MIME validation"),
  builds the launch manifest, computes `manifestHash`, and
  stores `(serverName, resourceUri, manifestHash, manifest,
  firstSeen, authContextHashSeen)` in `MCPResourceReview`.
  Operator policy decides auto-allow vs manual-review. Until
  approved, the tool falls back to text-only.
- **Manifest pinning is required when configured, advisory by
  default.** Operators may set
  `MCP_APPS_HASH_PINNING_REQUIRED=true`, in which case any
  manifest divergence on subsequent launches is a hard refuse.
  Because the manifest covers HTML + sandbox flags + permissions
  + network policy + URI + trust-policy version, divergence
  catches policy drift, not just byte drift.
- **No proactive crawl** of `_meta.ui.resourceUri` after every
  `tools/list`. That is product polish and out of v1.

## Persisted app-instance artifact (remount)

`MCPAppInstance` exists for one job: re-rendering the same
approved view when a conversation is reopened. It is **not** a
state-management store, **not** model-visible, and **not** a
generic launch log.

- Fields:
  `(_id, conversationId, messageId, mcpServerId, toolName,
  resourceUri, manifestHash, authContextHash, createdAt,
  lastSeen)`.
- One row per launched app view.
- On chat reload or navigation back, the host queries
  `MCPAppInstance` for the conversation and replays the
  view-launch lifecycle (fetch resource → decode → validate →
  manifest → manifest-pin check → render proxy → fold-in
  initialize) for each instance. View-internal state
  (selection, scroll, in-flight SPA navigation) is **not**
  preserved.
- Apps that need durable view state keep it on their MCP
  server (e.g. via a server-defined session ID surfaced to
  the view through `tools/call`); LibreChat does not own a
  second state-management surface.
- If `manifestHash` no longer matches on rehydrate (server
  upgraded the app or changed its policy), the host surfaces
  a "this app has been updated since you opened the
  conversation" notice and offers re-approval via the
  normal review path.

## Legacy `UIResourceRenderer` migration

LibreChat currently ships
`client/src/components/MCPUIResource/MCPUIResource.tsx`, which
mounts `UIResourceRenderer` from `@mcp-ui/client` with
`sandboxPermissions: 'allow-popups'`. This component is
reachable from chat, share, and search views (and any plugin
path that renders MCP UI resources). Leaving it active
alongside the strict Apps path would mean two competing
security models in production.

- **When `MCP_APPS_ENABLED=true`:** the legacy renderer is
  **disabled across every surface that can mount it** —
  `client/src/components/Chat/...`, share-page renderers,
  search-result renderers, plugin-rendered messages. Tools
  declaring `_meta.ui.resourceUri` route through the new
  Apps path; other UI resources fall back to text. There is
  no message in any view where the legacy renderer fires.
- **When `MCP_APPS_ENABLED=false`:** the legacy renderer
  stays as today, but its default `sandboxPermissions` is
  changed from `'allow-popups'` to `''` (deny by default),
  and a chrome banner explains the migration path. This is
  the operator-opt-in fallback, not a parallel rendering
  model.
- Phase 1 includes a cross-surface audit listing every entry
  point that can render `UIResourceRenderer`, with tests
  asserting each one switches to the Apps path (or text
  fallback) when the flag is on.
- There is no shared rendering code between the legacy path
  and the Apps path. The Apps path lives under
  `client/src/components/Chat/MCPApp/`.

## Trust UX

- Persistent border + header on every Apps view labeled
  "App from `<server name>`" with click-through to server
  identity, OAuth scopes, and `manifestHash` short-prefix.
- `_meta.ui.prefersBorder` is **ignored in v1**: trust chrome
  is mandatory regardless of resource preference. Re-evaluate
  when there is a stronger provenance and permissions
  surface.
- Label uses LibreChat-controlled fonts/colors rendered
  **outside** the view iframe so app CSS cannot override.
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

**Upstream redirect-handling work is in `dev`, not in HEAD.**
Earlier revisions of this plan asserted that public `main` already
shipped 307/308 redirect handling and cross-origin credential
stripping. That is not true at HEAD `738003b`. Upstream
[PR #12850](https://github.com/danny-avila/LibreChat/pull/12850)
(merged Apr 29 2026 into `dev`) adds method-preserving
307/308 follow-through with cross-origin credential stripping
(`Authorization`, `Cookie`, `mcp-session-id`, configured
server headers, `Proxy-Authorization`), depth limiting, SSRF
revalidation per hop, and HTTPS→HTTP downgrade blocking.
That work has not yet promoted to `main` as of this revision.

Phase 0 should therefore:

1. **Track upstream merge.** When PR #12850 promotes to
   `main`, treat the redirect/credential-stripping items as
   inherited and write a regression-only Phase 0 spot-check
   for them.
2. **If upstream slips**, port PR #12850 (or fold its tests
   into Phase 0) so this plan does not block on an external
   timeline.
3. Keep the plan-original Phase 0 items below as remaining
   work regardless: session reuse, header consistency, 404 →
   re-init, per-user token scoping, `authContextHash`,
   operator policy defaults.

## Phased plan

### Phase 0 — Transport reliability + auth-context substrate (≈3–5 days)

Implementation starts from `dev`, not `main` HEAD `738003b`,
so several items are inherited rather than built. Work focuses
on what `dev` does **not** cover.

**Inherited from `dev` (regression coverage only):**

- 307/308 redirect handling on Streamable HTTP (PR #12850).
- Cross-origin credential stripping on redirects (PR #12850).
- Idle-check trigger fix on failed MCP connections (PR #12853).
- MCP tool cache lookup failure handling (PR #12910).

**Plan-original work:**

- Session-reuse correctness across requests
  (`MCP-Session-Id` reused, rotated only on re-initialize).
- Consistent `MCP-Protocol-Version` / `MCP-Session-Id`
  headers on every request, matching the server's reported
  values.
- HTTP 404 → re-initialize (basic). Outstanding-task
  revalidation moves to Phase 4.
- Per-user token scoping closure for shared server
  definitions (recent advisory).
- `authContextHash` canonicalizer (`packages/api`) +
  unit-test corpus. Computed at connection time over
  normalized effective auth configuration.
- Operator policy defaults (server creation, transport
  allowlists, per-user task quotas, result-size caps).
  Defaults lean toward denial.

### Phase 1 — Types + Apps Preview substrate adoption + delta scaffolds (≈1 week)

End of phase: upstream PR #11799 substrate is rebased onto
the working branch and tests green on chat surface;
`MCP_APPS_PREVIEW_ENABLED` flag exists but defaults OFF;
share/search/plugin surfaces fall back to text; Hardened-GA
delta scaffolds (manifest hasher, content decoder,
self-contained-HTML validator) land disabled. **No capability
advertised yet.**

**Inherit + adapt:**

- Rebase / cherry-pick PR #11799 onto Phase 0's branch state.
- Types in `packages/data-provider`, generated from the
  pinned `@modelcontextprotocol/ext-apps` release where they
  were not added by #11799.
- `packages/api/src/mcp/connection.ts` reads per-tool
  `execution.taskSupport` (does not advertise Apps or Tasks).
- Add `MCP_APPS_PREVIEW_ENABLED` and
  `MCP_APPS_HARDENED_ENABLED` flags. Deprecate the older
  `MCP_APPS_ENABLED` (alias to Preview only, with a startup
  warning).
- **Live-chat-only narrowing**: in
  `client/src/components/MCPUIResource/MCPUIResource.tsx`
  and any other `UIResourceRenderer` mount, when
  `MCP_APPS_PREVIEW_ENABLED=true` and the surface is share,
  search, or plugin-rendered, render text fallback for
  resources that carry `_meta.ui.resourceUri`. Chat keeps
  the Apps path.
- **Default deny `sandboxPermissions`**: change the legacy
  renderer default from `'allow-popups'` to `''` regardless
  of flag state. Add the migration banner.
- **Verify-with-regression-tests** for the upstream items
  the plan no longer differentiates on:
  - Per-instance outer iframes (`MCPAppContainer` →
    `sandboxSrc`) actually one-per-app.
  - Same-server binding for `tools/call` and
    `resources/read`.
  - `/api/mcp/sandbox` requires auth and `appsEnabled`.
  - `ui://` URI validation rejects non-`ui://` schemes on
    forwarded `resources/read`.
  - Capability advertising disabled when
    `mcpSettings.apps` is off.
  - `stableMCPAppRef` survives parent re-renders.

**Hardened-GA delta scaffolds (land disabled, no UX impact
in Preview):**

- Sandbox infrastructure scaffold: static `proxy.html` served
  from `MCP_SANDBOX_ORIGIN` with `frame-ancestors` CSP
  header. Renderer still uses upstream `data:` URL until
  Phase 2H flips it.
- `AppBridge` wrapper with explicit-target-origin transport
  shim, lazy-loaded on the client. Live behind a runtime
  switch that defaults to the upstream `'*'`-send transport
  in Preview.
- `MCPResourceReview` collection scaffold +
  self-contained-HTML validator + content-decoding pipeline.
  Behind `MCP_APPS_HARDENED_ENABLED` (no-op when off).
- `MCPAppLaunchManifest` builder + canonical-JSON hasher
  (RFC 8785). Unit tests cover determinism across field
  orderings against a fixture corpus.
- `MCPAppInstance` collection scaffold (no write path yet —
  Phase 2H wires it).
- Operational-limits parser. Settings present even though
  most enforcement points are gated on Hardened GA.
- Tests with `mongodb-memory-server` + real
  `@modelcontextprotocol/sdk` + Playwright cross-origin
  iframes.

Phase 1 exit criteria:

1. Inherited PR #11799 substrate runs green on chat with
   `MCP_APPS_PREVIEW_ENABLED=true`.
2. Share, search, and plugin-rendered surfaces never mount
   `UIResourceRenderer` for resources carrying
   `_meta.ui.resourceUri`; they always render text.
3. Legacy renderer default is deny-by-default
   `sandboxPermissions=''` in every flag combination.
4. Manifest hasher is deterministic across reorderings and
   matches fixture vectors byte-for-byte.
5. Self-contained-HTML validator rejects every external-asset
   construct in the test corpus (live behind a flag, not yet
   used in the Preview render path).

### Phase 2P — Apps Preview release (≈1–2 weeks)

End of phase: Apps capability advertised when
`MCP_APPS_PREVIEW_ENABLED=true`; live-chat-only Apps render
inline (and optionally fullscreen behind operator gate); legacy
renderer still serves share/search/plugin surfaces; the
hardening delta is **not yet** active.

- Live-chat path adopts upstream PR #11799's
  `MCPAppContainer`, `MCPAppBridge`, and backend proxies as
  the rendering substrate.
- **Single-ACL `forwardMcpRequestFromView` consolidation
  refactor.** Same-server binding already exists in #11799 via
  the per-instance `serverName`; Phase 2P consolidates the
  enforcement points (`tools/call`, `resources/read`, `ping`,
  `notifications/message`) into one named function and adds
  the v1 forwarding whitelist + app-visibility check for
  `tools/call`. This is a refactor of inherited behavior, not
  a new capability.
- Host-side handlers (Preview subset):
  - `ui/open-link` — gated by host navigation allowlist;
    confirmation in host chrome.
  - `ui/message` — `role: "user"` only; consent in host chrome;
    non-`user` rejected with clear error.
  - `ui/request-display-mode` — returns the actually-resulting
    mode; `inline` and (when `appSettings.allowFullscreen`)
    `fullscreen` honored.
  - `ui/update-model-context` — overwrite semantics.
- Host-side notifications: `tool-input`, `tool-result`,
  `tool-cancelled`, `host-context-changed`, `size-changed`,
  `ui/resource-teardown`.
- **Truthful HostContext** (theme tokens, locale, timezone,
  platform, safe-area insets, `displayMode`, `availableDisplayModes`
  including `fullscreen` only when `appSettings.allowFullscreen`,
  `toolInfo` populated from the in-flight tool call).
- `host-context-changed` notifications on theme / locale /
  dimension changes.
- **Two helpers** for the data boundary (`toModelView`,
  `toViewSurface`). Tests assert
  `structuredContent`/`_meta` never leak to the model path,
  and `_meta` (including `io.modelcontextprotocol/related-task`
  and server-defined keys) is preserved on the view path.
- **View-bound payload truncation** at
  `MCP_APPS_MAX_TOOL_RESULT_BYTES_TO_VIEW` with a clear
  marker.
- **Sizing fallback** alongside upstream `maxHeight`:
  `MCP_APPS_FALLBACK_HEIGHT_PX` until the first non-zero
  `size-changed`; `shrinkWrap: false` per-server opt-out.
- **Per-view rate limits** enforced
  (`MCP_APPS_VIEW_RPC_RATE_PER_MIN`,
  `MCP_APPS_VIEW_NOTIF_RATE_PER_MIN`); over-limit views are
  paused with a clear chrome message.
- **Live-chat narrowing locked in.** Tests assert that
  share / search / plugin surfaces never mount the new Apps
  path even when `MCP_APPS_PREVIEW_ENABLED=true`.
- **End of phase**: enable Apps capability advertisement
  when `MCP_APPS_PREVIEW_ENABLED=true` and the Preview
  interop matrix passes. Hardened-GA delta scaffolds remain
  inactive (`MCP_APPS_HARDENED_ENABLED=false`). Tasks may
  still be OFF.

### Phase 2H — Apps Hardened GA (≈2–3 weeks, follow-up release)

End of phase: with `MCP_APPS_HARDENED_ENABLED=true`, the Apps
path uses the dedicated `MCP_SANDBOX_ORIGIN` proxy, hop-specific
relay validation with proxy-stamped nonce, the folded-in
`ui/initialize` probe, `connect-src 'none'`, self-contained
HTML, manifest-hash review, and full retirement of
`UIResourceRenderer` across chat, share, search, and plugin
surfaces.

- **Replacement delta — sandbox proxy.** Swap the upstream
  `data:`-URL outer iframe (served from `/api/mcp/sandbox`)
  for the dedicated-origin `proxy.html` served from
  `MCP_SANDBOX_ORIGIN`, with `frame-ancestors` enforced via
  response header. Outer-iframe sandbox stays
  `allow-scripts allow-same-origin` per the Apps spec; inner
  app iframe stays without `allow-same-origin`.
- **Replacement delta — explicit-target-origin transport.**
  Flip the `AppBridge` transport to send with explicit
  origins; the upstream `'*'`-send code path becomes
  unreachable when Hardened GA is on.
- **Replacement delta — hop-specific validation +
  proxy-stamped nonce.** Host rejects `null`-origin
  messages; proxy stamps the per-view nonce on relayed
  inbound messages; the inner view never sees or echoes the
  nonce.
- **Replacement delta — folded-in `ui/initialize` probe.**
  The first relayed initialize is the relay self-test;
  failure (timeout / schema / nonce) tears down the iframe
  and falls back to text-only for that mount.
- **Replacement delta — content decoding + self-contained
  HTML.** Activate the Phase 1 scaffolds. Reject MIME
  mismatch, base64-decode `blob` under
  `MCP_APPS_MAX_HTML_BYTES`, UTF-8 validate, reject
  multi-content, run the self-contained-HTML validator.
- **Replacement delta — `MCPAppLaunchManifest` review +
  pinning.** First-launch review computes `manifestHash`
  and stores it in `MCPResourceReview`. Subsequent launches
  pin against the manifest. Default advisory; hard refuse
  when `MCP_APPS_HASH_PINNING_REQUIRED=true`. Divergence
  covers HTML, sandbox flags, permissions, network policy,
  URI, and trust-policy version.
- **Replacement delta — `connect-src 'none'`.** The CSP
  injector ignores `connectDomains` entirely. Inner-view
  network traffic is impossible. App authors route via
  `tools/call` / `resources/read` / `ui/open-link`. The
  upstream `applyAppSettingsToResult` path is retained for
  Preview but bypassed in Hardened GA.
- **Replacement delta — full legacy renderer retirement.**
  When `MCP_APPS_HARDENED_ENABLED=true`, the
  `UIResourceRenderer` import is no longer reachable from
  any surface (chat, share, search, plugin). Tests assert
  this across every entry point.
- **Replacement delta — `MCPAppInstance` write path** lands.
  Every successful Hardened-GA app launch records a row;
  re-opening the conversation rehydrates by replaying the
  launch lifecycle against the same `manifestHash`.
  Divergence surfaces "this app has been updated" with a
  re-approval action. Still narrow: no view-internal state.
- **Replacement delta — trust chrome mandatory.**
  `_meta.ui.prefersBorder=false` is ignored. Border +
  identity chrome must remain visible even in fullscreen.
- **Replacement delta — `_meta.ui.domain` rejection** with a
  clear error message in the review pipeline.
- **`ui/resource-teardown`** wait timeout
  (`MCP_APPS_TEARDOWN_WAIT_MS`); on timeout, force-remove
  the iframe and log.
- **End of phase**: enable Hardened GA capability
  advertisement when `MCP_APPS_HARDENED_ENABLED=true` and
  the Hardened interop matrix passes (incl. cross-engine
  relay tests and full legacy-renderer retirement
  regression).

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
    `tasks/result` is invoked **only** on explicit detail
    entry or explicit "wait for result". There is **no
    opportunistic save** in v1: a subscribed task that reaches
    terminal while the user is present does **not** trigger
    an automatic `tasks/result` fetch. No background
    API-process poller. Opening the jobs panel never eagerly
    fetches `tasks/result` for terminal rows.
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
  badges, **status-only by default** (no progress bars in
  v1 — those reuse upstream PR #12535 once it lands and is
  not a Phase 4 dependency), cancel button (disabled for
  terminal and `input_required` states), deep-link to
  originating conversation. Localize under
  `com_ui_mcp_task_*`. The `progressToken` is still
  correlated and propagated through the bridge to mounted
  views; the SidePanel just doesn't render progress bars
  itself in v1.
- **Tasks feature flag** (`MCP_TASKS_ENABLED`) added; OFF by
  default. Independent of `MCP_APPS_PREVIEW_ENABLED` and
  `MCP_APPS_HARDENED_ENABLED`. Tasks may ship before, after,
  or between Apps Preview and Apps Hardened GA.
- **End of phase**: enable Tasks capability advertisement when
  `MCP_TASKS_ENABLED=true` and the Tasks interop matrix
  passes.

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
   resource server-side via `resources/read`; the content
   pipeline validates MIME (`text/html;profile=mcp-app`),
   decodes (`text` or `blob`), UTF-8 validates, runs the
   self-contained-HTML validator, builds the
   `MCPAppLaunchManifest`, and computes `manifestHash`. With
   the operator-approved pin matching, the host injects the
   strict `<meta>` CSP (`connect-src 'none'` — no direct
   browser networking in v1) and sends
   `sandbox-resource-ready`. The host instantiates a fresh
   per-instance proxy iframe (outer
   `sandbox="allow-scripts allow-same-origin"`, inner sandbox
   without `allow-same-origin`), runs the construction-order
   sequence, and waits for the relayed `ui/initialize`. On
   success the inner iframe is alive and the bridge is
   open; on timeout, schema failure, or nonce failure the
   host falls back to a text-only summary and explains why.
   An `MCPAppInstance` row is written so re-opening this
   conversation later re-renders the app without storing
   anything in model context.
2. The view starts in an "upload" panel. It cannot `fetch` or
   PUT directly to blob storage (CSP `connect-src 'none'`).
   Instead it calls `cad.create_upload_session(file_name,
   size, hash)` (`taskSupport: forbidden`) through the bridge.
   The CAD MCP server hands back a session ID. To upload, the
   view either streams chunks back through `cad.upload_chunk`
   (host proxies, no direct browser fetch) or — the more
   common pattern in v1 — invokes `ui/open-link` against a
   short-TTL presigned URL on the navigation allowlist so the
   user's browser performs the upload natively, then polls
   `cad.get_session_status` until it sees the session
   ingested. It then calls `cad.ingest({ session_id })`
   (`taskSupport: required`), which runs as a task. The
   mounted view subscribes to its own poll loop on
   `tasks/get`.
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
- **Two trust models in production simultaneously.** During
  the window between Apps Preview launch and Apps Hardened
  GA, apps render under the upstream #11799 trust model on
  chat (`'*'`-send postMessage, `event.source` validation,
  `data:`-URL outer iframe, `connectDomains` honored) while
  the legacy `UIResourceRenderer` runs on share/search/plugin
  surfaces (deny-default `sandboxPermissions=''`). This is
  intentional and bounded; Hardened GA closes the window.
  Operators who cannot accept the Preview model on chat keep
  both flags off and rely on the deny-default legacy
  renderer.
- **Self-contained-HTML rule is a real constraint on app
  authors (Hardened GA only).** Hardened GA forbids remote
  scripts, styles, fonts, and images; Preview honors
  upstream `resourceDomains`. Operator docs explain the
  difference so app authors do not ship a Preview-only bundle
  and discover at Hardened GA cutover that it is rejected.
- **No direct browser networking is the bigger Hardened-GA
  constraint.** Hardened GA cuts in-app `fetch` / XHR /
  WebSocket entirely; Preview keeps the upstream
  `connectDomains` model. Apps whose bundle calls a
  third-party API directly will keep working in Preview but
  break at Hardened GA cutover unless they migrate to
  bridge-routed tools. The reason is that without
  `allow-same-origin` on the inner frame and without
  `_meta.ui.domain`, the inner-frame origin is `null`, which
  fails for conservative CORS, cookies, OAuth, and
  origin-based API allowlists. Re-introducing `connect-src`
  is post-Hardened-GA and depends on a stable-origin design.
- **Approval is over a manifest, not just bytes.** Hash
  divergence catches policy drift (sandbox, permissions,
  network policy, URI, trust-policy version), not just byte
  drift. App authors must understand that altering CSP
  metadata or sandbox flags forces re-approval even if the
  HTML is unchanged.
- **Legacy `UIResourceRenderer` retirement is staged across
  Preview → Hardened GA.** Preview retires it only on chat;
  Hardened GA retires it across share, search, and
  plugin-rendered surfaces. The default
  `sandboxPermissions=''` change applies even when both
  Apps flags are off, so operators who never opt in still
  get the deny-default safety improvement.
- **Inheritance risk: PR #11799 changes upstream while we're
  building.** The plan adopts #11799 substantially as-is. If
  upstream rebases, force-pushes, or substantially changes
  the Apps API surface, Phase 1's rebase work expands.
  Mitigation: pin to a known commit on the
  `KyleKincer:feat/mcp-apps` branch and explicitly track
  upstream changes during Phase 1 rather than continuously
  rebasing.
- **Inheritance risk: PR #11799 does not land in `main`.**
  If #11799 stalls or is rejected, the plan still cherry-
  picks it from the open PR. That doubles the maintenance
  burden of upstream syncs but does not block shipping
  Preview.
- **Operational limits may surprise app authors.**
  `MCP_APPS_MAX_HTML_BYTES = 2 MiB` rules out giant
  pre-bundled apps; rate limits cap chatty views. Limits are
  operator-tunable, but the defaults bias toward safety.
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

Tests are tagged **[P]** (Preview), **[H]** (Hardened GA), or
**[A]** (both). Some tests have different shapes per track and
are listed twice.

- **[A]** Capability negotiation truthfully gated by
  `MCP_APPS_PREVIEW_ENABLED` / `MCP_APPS_HARDENED_ENABLED`.
- **[A]** Discovery: tool `_meta.ui.resourceUri` for a
  resource omitted from `resources/list` still renders;
  resource without `_meta.ui` falls back to text.
- **[A]** Live-chat-only narrowing: with Preview on (and any
  Hardened state), share, search, and plugin-rendered
  surfaces never mount the new Apps path; they always render
  text. With both flags off, share/search/plugin still
  fall back to text via the deny-default legacy renderer
  (no popups).
- **[A]** Default `sandboxPermissions=''` on the legacy
  renderer regardless of flag state. Test asserts no entry
  point still uses `'allow-popups'`.
- **[H]** Full retirement of `UIResourceRenderer` import
  reachability. With `MCP_APPS_HARDENED_ENABLED=true`, no
  surface (chat, share, search, plugin) can mount the
  legacy renderer; tree-shake / module-graph test asserts
  the import is unreachable.
- **[A]** Adoption regression for items inherited from
  #11799: per-instance outer iframe, per-instance
  `serverName` binding, `/api/mcp/sandbox` auth +
  `appsEnabled` gate, `ui://` URI validation,
  `stableMCPAppRef` survival across parent re-render,
  `appSettings.allowFullscreen` gating fullscreen mount.
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
- **CSP `connect-src 'none'` enforcement**: any in-app
  `fetch` / XHR / WebSocket attempt is blocked by the
  browser. The view must route network access via
  `tools/call`, `resources/read`, or `ui/open-link`. Test
  asserts that even a server explicitly setting
  `connectDomains` does **not** install any `connect-src`
  origin in the rendered CSP (the field is parsed but
  ignored in v1).
- `<meta>`-CSP limitations exercised (no `sandbox`, no
  `frame-ancestors`, no `report-uri`).
- `ui/open-link` gated by navigation allowlist, separate
  from any CSP directive.
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
- **Folded-in initialize probe**: the first relayed
  `ui/initialize` is the relay test. A fixture induces a
  failure (timeout, missing nonce, malformed schema); the
  host falls back to text-only for that mount with a clear
  chrome message and writes a structured log line. There is
  no separate ping path in the implementation.
- **Outer-vs-inner sandbox split**: rendered DOM has the
  outer proxy iframe with
  `sandbox="allow-scripts allow-same-origin"` at
  `MCP_SANDBOX_ORIGIN`, and the inner app iframe with the
  hardened set excluding `allow-same-origin`. A test
  asserts both attribute strings.
- **Bundle-size regression**: default chat bundle does not
  include `AppBridge` / `PostMessageTransport` / Zod when no
  Apps view is mounted.
- **Operational limits**:
  - HTML over `MCP_APPS_MAX_HTML_BYTES` is rejected at
    review.
  - View-bound `tool-result` over
    `MCP_APPS_MAX_TOOL_RESULT_BYTES_TO_VIEW` is truncated
    with a marker; model-path serialization is unaffected.
  - `ui/resource-teardown` honored within
    `MCP_APPS_TEARDOWN_WAIT_MS`; otherwise iframe is
    force-removed.
  - View exceeding `MCP_APPS_VIEW_RPC_RATE_PER_MIN` /
    `MCP_APPS_VIEW_NOTIF_RATE_PER_MIN` is paused with a
    chrome message.
- **Content decoding**: `text` and `blob` payloads both
  succeed; oversize `blob` rejected; non-`text/html;profile
  =mcp-app` MIME falls back to text; multi-content
  responses rejected.
- **Manifest hash determinism**: shuffling JSON key order
  in any manifest field yields an identical
  `manifestHash`; modifying any covered field changes it.
- **Trust chrome mandatory**: a resource declaring
  `prefersBorder: false` still renders inside host chrome.
- **Legacy renderer gating**:
  - With `MCP_APPS_ENABLED=true`, every entry point
    (chat, share, search, plugin-rendered) routes
    UI-resource messages to the Apps path or text — never
    to `UIResourceRenderer`.
  - With `MCP_APPS_ENABLED=false`, the legacy path's
    default `sandboxPermissions` is `''`, not
    `'allow-popups'`.
- **Sizing fallback**: with no `size-changed` notification, the
  view renders at the operator-configured fallback height; once
  a non-zero `size-changed` arrives the host honors it; the
  `shrinkWrap: false` opt-out pins the view at the fallback
  height even if the SDK suggests shrinking.
- First-launch resource review: `manifestHash` stored;
  manifest divergence (HTML, sandbox, permissions, network
  policy, URI, or trust-policy version) refused at next
  launch when `MCP_APPS_HASH_PINNING_REQUIRED=true` and
  surfaces a notice + re-approval action when advisory.
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
- **No opportunistic save**: a subscribed task that
  transitions to terminal while the user is present does
  **not** trigger any `tasks/result`; the test asserts no
  such call is issued unless the user explicitly clicks
  detail or "wait for result".
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

Estimates assume implementation starts from `dev` (so PRs
#12850 / #12853 / #12910 are inherited) and that PR #11799 is
the Apps Preview substrate. They have shrunk significantly
versus v8 because v9 stops parallel-building the Apps
substrate.

| Phase | Estimate |
|---|---|
| 0 — Transport reliability + auth-context (inherits `dev` fixes) | 2–4 days |
| 1 — Types + Apps Preview substrate adoption + Hardened delta scaffolds + legacy default-deny + live-chat narrowing | ~1 week |
| 2P — Apps Preview release (single-ACL refactor, full HostContext, fullscreen gate, payload truncation, rate limits, capability turn-on) | 1–2 weeks |
| 2H — Apps Hardened GA (sandbox-origin proxy, hop-specific relay + nonce, folded init probe, manifest review, full legacy retirement, MCPAppInstance write path, `connect-src 'none'`) | 2–3 weeks (separate release) |
| 3 — `tool-input-partial` (optional) | 1 week (risk) |
| 4 — MCP Tasks v1 (status-only jobs panel; progress UI deferred to #12535 reuse) | ~2 weeks |
| 5 — Hardening + browser matrix + ops docs | 1 week |

Suggested release tracks:

| Track | Phases | Estimate |
|---|---|---|
| **Apps Preview release (chat)** | 0 + 1 + 2P | **~2.5–3.5 weeks** |
| **Apps Preview + Tasks v1** | 0 + 1 + 2P + 4 | **~3–4 weeks** (4 can run parallel with 2P) |
| **Apps Hardened GA release** | + 2H | **+2–3 weeks** after Preview |
| **Full v1 (Hardened GA + Tasks)** | 0 + 1 + 2P + 2H + 4 | **~5–7 weeks** |

The **Apps Preview** track is now a first-class shipping
option. It provides interactive app rendering on the chat
surface with the upstream #11799 trust model — weaker than
Hardened GA, but materially better than the current legacy
renderer's `'allow-popups'` default. Hardened GA can follow
in a later release without holding Preview's user-visible
experience hostage to the full v8 security delta.

## References

### Specs

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

### Upstream LibreChat (`danny-avila/LibreChat`)

- PR #11799 — `feat: MCP Apps Extension Support` (open):
  <https://github.com/danny-avila/LibreChat/pull/11799>
- Issue #10641 — `Enhancement: Support for MCP Apps` (open):
  <https://github.com/danny-avila/LibreChat/issues/10641>
- Issue #11997 — `Enhancement: Support for MCP Tasks` (open):
  <https://github.com/danny-avila/LibreChat/issues/11997>
- PR #12850 — `fix: Follow 307/308 redirects in MCP streamable
  HTTP transport` (merged to `dev`, not in HEAD):
  <https://github.com/danny-avila/LibreChat/pull/12850>
- PR #12853 — idle-check trigger fix:
  <https://github.com/danny-avila/LibreChat/pull/12853>
- PR #12910 — MCP tool cache lookup failure handling:
  <https://github.com/danny-avila/LibreChat/pull/12910>
- PR #12535 — MCP progress notifications (open, adjacent to
  Tasks UX): <https://github.com/danny-avila/LibreChat/pull/12535>
- Issue #12802 — proactive MCP OAuth token refresh:
  <https://github.com/danny-avila/LibreChat/issues/12802>

### MDN

- iframe sandbox guidance:
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe>
- srcdoc and base URL behavior:
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#attr-srcdoc>
- Content-Security-Policy and meta-tag limitations:
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP>
- Window.postMessage origin validation:
  <https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage>
