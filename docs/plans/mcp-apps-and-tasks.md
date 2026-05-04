# Plan: MCP Apps + MCP Tasks Support in LibreChat

**Status:** Draft / scoping document — no code in this PR.
**Owner:** TBD
**Target branch:** `claude/mcp-apps-spec-support-rEi7X`
**Revision:** v14. See
[`mcp-apps-and-tasks-changelog.md`](./mcp-apps-and-tasks-changelog.md)
for the per-revision decision history. This file describes
the current frozen state; implementers do not need to read
the changelog to act on this plan.

## Active decisions (carried forward, with track-tags)

Legend: **[P]** = applies when `MCP_APPS_MODE="preview"`.
**[H]** = applies when `MCP_APPS_MODE="hardened"`.
**[T]** = Tasks track. **[A]** = applies to all (including
`MCP_APPS_MODE="disabled"` where relevant).

- **[A]** Single `MCP_APPS_MODE = "disabled" | "preview" |
  "hardened"` enum + independent `MCP_TASKS_ENABLED`.
- **[A]** Default-deny `sandboxPermissions=''` on the legacy
  renderer regardless of mode (immediate safety improvement).
- **[A]** New Apps path renders **only on the live chat
  surface** when mode is `"preview"` or `"hardened"`. Non-chat
  surfaces fall back to text. Legacy `UIResourceRenderer` is
  unreachable when mode is not `"disabled"`.
- **[T]** Cancellation after terminal returns `-32602` invalid
  params.
- **[T]** `input_required` preserves server status; host marks
  `hostHandlingState = "unsupported_lifecycle"`; no fake
  `failed` envelope. Documented as a deliberate subset
  decision against the spec's preemptive-`tasks/result` rule.
- **[T]** Shared in-process fan-out poller keyed by
  `(taskId, authContextHash)`; no per-subscriber loops; no
  API-process background poller; no durable subscriber
  registry.
- **[A]** `_meta.ui.domain` unsupported; single
  `MCP_SANDBOX_ORIGIN` is required when
  `MCP_APPS_MODE !== "disabled"`. **Both Preview and
  Hardened use the same outer-sandbox topology** (v11
  unified this).
- **[A]** **Single authoring profile across modes (v13).**
  Self-contained HTML (inline scripts/styles, `data:`
  images), **no** external assets (relative or absolute),
  **no** direct browser networking (`connect-src 'none'` in
  the inner CSP), bridge-routed only (`tools/call` /
  `resources/read` / `ui/open-link`). This applies to both
  Preview and Hardened. App authors build to one profile.
- **[H]** Wasm and `eval`/`new Function`-using runtimes are
  blocked at the CSP level. (Preview allows them via a
  relaxed inner CSP that adds `wasm-unsafe-eval` and
  `'unsafe-eval'`; everything else in the CSP is identical
  across modes.)
- **[H]** Hardened is documented as the LibreChat Hardened
  App Profile, not as parity with stable Apps.
- **[A]** PostMessage transport wrapper around `AppBridge`
  sends to **explicit target origins** in both modes (since
  v11's unified topology eliminates the `'*'`-on-data-URL
  fallback). The wrapper preserves SDK receive validation.
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
- **[A]** One outer sandbox proxy iframe per app instance; no
  pooling. (Already true upstream; verified in Preview, kept
  in Hardened.)
- **[A]** Host construction-order invariant.
- **[A]** Model-path vs view-path data boundary; `_meta`
  preserved on the view path.
- **[T]** Status-only jobs panel; `tasks/result` on detail
  entry or explicit wait — nothing else. Progress UI deferred
  to upstream PR #12535 reuse.
- **[T]** Tasks UX is **capability-conditional** (v12). The
  jobs panel, cancel affordance, and cross-session task
  recovery all condition on the server's negotiated
  `tasks.list` / `tasks.cancel` sub-capabilities. When a
  capability is absent, the corresponding affordance is not
  rendered. This honors the spec's explicit warning that
  servers without a stable requestor identity should not
  advertise `tasks.list`.
- **[A]** Lazy-loaded `AppBridge` runtime on the client.
- **[A]** Sizing fallback height + `shrinkWrap: false` opt-out.
  (Preview also accepts upstream `maxHeight`.)
- **[A]** Remount is derived from the inherited `mcp_app`
  artifact (extended with `manifestHash` + `authContextHash`).
  No separate `MCPAppInstance` collection. Preview relies on
  `stableMCPAppRef` for parent-re-render survival; cross-load
  remount uses the artifact. **Hydration is lazy by
  visibility** — only artifacts in or near the viewport
  hydrate on conversation open; older artifacts hydrate on
  scroll or expand.
- **[A]** `resources/read` may return a `contents[]`
  array; the host requires **exactly one** entry whose
  `uri` matches the declared `resourceUri` and whose MIME
  parses as `text/html;profile=mcp-app` (v13). Zero or
  more than one matching entry is a review error.
  Non-matching entries are logged and ignored. No blanket
  multi-content rejection.
- **[T]** `MCPTask` holds **task metadata only** (v12). No
  cached terminal result envelope, no blob offload, no
  rehydration persistence. `tasks/result` is fetched **live**
  on explicit detail entry or explicit wait. Bounded by
  `createdAt + ttl`. No request-envelope persistence, no
  subscriber durability, no progress checkpointing.
- **[T]** Tasks-only over Streamable HTTP.
- **[T]** Outstanding-task revalidation on HTTP 404 lives in
  Phase 4 (Tasks-specific), not Phase 0.
- **[T]** **No blocking `tasks/result` waiter in v1 (v13).**
  Earlier revisions modeled "wait for result" as suspend
  poller + issue blocking `tasks/result` + handle session
  loss mid-wait. v13 cuts the blocking waiter entirely.
  "Wait for result" is a UI mode on top of the **shared
  poller**: the host keeps polling at `pollInterval`,
  the UI shows a waiting state, and on the first terminal
  status the host issues exactly one `tasks/result` to
  fetch the envelope. Latency cost: at most one
  `pollInterval` of extra completion delay. Code cost
  saved: the entire wait-restart state machine, concurrent
  wait/poll duality, and the dedicated re-init/retry
  budget. Session re-init during polling uses the same
  outstanding-task revalidation path as everywhere else
  (Phase 4 work).
- **[A]** Advisory manifest divergence **auto-repins** (v12).
  In the default (advisory) mode, the host renders the new
  manifest immediately, repins it, and surfaces a host-
  controlled banner that names the server, the manifest
  short-prefix, and what changed. There is **no** blocking
  re-acknowledge click. Hard refuse is reserved for
  `MCP_APPS_HASH_PINNING_REQUIRED=true` (strict pinning).
- **[A]** **Native navigation, forms, and refresh redirects
  are blocked under sandbox + `srcdoc` (v14).** The Apps
  spec's CSP surface and the iframe sandbox attribute do
  not cleanly cover native navigation under `about:srcdoc`:
  forms render but do not submit; sandboxed frames block
  top-level navigation by default; relative URLs resolve
  against `MCP_SANDBOX_ORIGIN`. v14 makes the host's
  behavior explicit:
  - The validator rejects `<form action>`, `<form method>`,
    `<meta http-equiv="refresh">`, `target="_blank"` /
    `target="_top"` link attributes, and any other
    declarative construct that needs a sandbox flag the
    host refuses to grant.
  - The proxy injects an anchor click interceptor: any
    `<a href>` activation is captured before default
    navigation and routed through `ui/open-link` against
    the host navigation allowlist.
  - The runtime CSP `form-action 'none'` and
    `base-uri 'none'` defenses remain.
  Without these rules, app authors get dead forms, dead
  links, or inner-frame self-navigation surprises rather
  than the host-controlled `ui/open-link` flow.
- **[A]** Sequential release train: Apps Preview → Tasks v1 →
  Apps Hardened.
- **[A]** Phase 1 pins a specific commit SHA on
  `KyleKincer:feat/mcp-apps` and a specific
  `@modelcontextprotocol/ext-apps` package release.
- **[A]** **Vendored Apps and Tasks generated schemas
  (v13).** Generated TypeScript types and JSON Schemas for
  both extensions are vendored into the repo
  (`packages/data-provider/src/mcp-apps/schemas/` and
  `packages/data-provider/src/mcp-tasks/schemas/`),
  pinned to spec dates `2026-01-26` (Apps stable) and
  `2025-11-25` (Tasks experimental), and updated only via
  reviewed PRs. v11 vendored Apps; v13 extends this to
  Tasks because the experimental nature of the Tasks
  surface and the precision of its ownership/metadata/
  error semantics make drift a real risk.
- **[A]** **Bootstrap trust is fail-closed (v13).** The
  sandbox proxy never derives the host origin from
  `document.referrer`, never accepts or sends `*` as
  `targetOrigin`, and refuses to initialize if the
  host-controlled bootstrap inputs (host origin, view ID,
  per-view nonce) are absent or malformed. Operators are
  required to deploy `proxy.html` with `frame-ancestors`
  set to the LibreChat application origin; a startup
  health check verifies the response header before Apps
  capability is enabled.
- **[A]** **Exactly-one matching `contents[]` entry
  (v13).** `resources/read` may return a `contents[]`
  array. The host picks the entry whose `uri` matches
  the declared `resourceUri` and whose MIME parses as
  `text/html;profile=mcp-app`. **Zero matches** is an
  error. **More than one matching HTML entry** is also an
  error. Non-matching extras are logged at info level and
  ignored. v11's "log extras and ignore" rule remains for
  non-matching entries; v13 closes the duplicate-match
  ambiguity.
- **[A]** **Required text fallback contract (v13).** Any
  tool that declares `_meta.ui.resourceUri` MUST also
  return a human-meaningful text summary in the
  `CallToolResult.content` field. The host renders that
  text on every non-render path: non-chat surfaces,
  failed relay probes, unsupported browsers, and the
  fallback card on session loss. If a server returns
  empty or trivial `content`, the host renders a generic
  "App is unavailable on this surface" card with
  `toolInfo` rather than synthesizing data the model has
  not seen. This contract is documented in the operator
  guide and in the Apps server-author docs.
- **[T]** **`model-immediate-response` is model plumbing,
  not a user-visible assistant message (v13).** The
  server-supplied string is fed into the model context as
  the immediate tool result for the in-flight task call,
  matching the spec's narrow scope for this provisional
  metadata. The host does **not** emit an assistant-visible
  placeholder, does not suppress the model from speaking
  for that turn, and does not stage a separate "final
  result" message that overwrites the placeholder. Users
  see standard task-card chrome in the running-jobs UI.
- **[T]** **Implicit wait-mode for model-started required
  tasks (v14).** When the **agent** invokes a tool with
  `taskSupport: "required"` during a chat turn, the host
  defaults that originating turn into the same "wait for
  result" UI state used by explicit waits: the shared
  poller keeps running, the chat shows a waiting
  indicator, and on the first terminal status the host
  issues exactly one `tasks/result` and returns the
  envelope on both the model path and the chat surface.
  Without this default, model-started long-running tools
  would terminate without the result ever reaching chat
  unless the user manually opened the jobs panel — the
  task spec puts the actual result behind `tasks/result`
  and reduces the immediate response to a provisional
  hint. Implicit wait does not apply to tasks created
  from inside a mounted app view (those keep status-only
  semantics in the panel) and does not apply to manually
  re-opened detail rows on prior turns.
- **[A]** **Single bridge: SDK `AppBridge` only (v14).**
  Upstream PR #11799 carries both a custom JSON-RPC
  bridge and an optional SDK-based `AppBridge` adapter
  from `@modelcontextprotocol/ext-apps`. v14 standardizes
  on the SDK path and **deletes the custom bridge** in
  Phase 1. The transport shim (explicit target origins,
  proxy-stamped per-view nonce on inbound) wraps the SDK
  path; receive validation is the SDK's. Keeping both
  bridges doubles the test matrix and guarantees drift;
  deleting the custom bridge is on-thesis with the
  upstream Apps rationale of reusing MCP infrastructure.
- **[A]** **Oversize result on the view path is hard-fail,
  not lossy truncation (v14).** Earlier revisions said
  view-bound `tool-result` over
  `MCP_APPS_MAX_TOOL_RESULT_BYTES_TO_VIEW` would be
  truncated with a marker and forwarded. The Apps spec
  defines `ui/notifications/tool-result` as a standard
  `CallToolResult`, and the Tasks spec says terminal
  `tasks/result` MUST equal what the underlying request
  would have returned — including correlation `_meta`
  like `related-task`. Lossy truncation breaks both
  contracts. v14 instead refuses to deliver an oversize
  envelope to the view, surfaces a host-chrome error
  ("The app sent a result that was too large to render
  here. Server authors should return an artifact handle
  or a follow-up resource instead."), and keeps the
  model-path truncation marker as a model-side
  concession. The view-bound path is contract-faithful
  or it does not render.
- **[A]** **MCP capability profile marker (v14).** The
  host advertises the LibreChat single-authoring-profile
  marker in two places at MCP capability negotiation:
  - `capabilities.experimental["io.modelcontextprotocol/ui"].profile = "librechat-self-contained"`
    (or operator-elected variant) inside the MCP
    initialize response, so server-side tool registration
    can react before any tool-with-app metadata is
    advertised back to the host.
  - `hostCapabilities.experimental.profile =
    "librechat-self-contained"` inside `ui/initialize`
    response, so view code that already has
    `hostCapabilities` available can also branch.
  Servers that explicitly opt in to the profile suppress
  external-asset and `connectDomains` declarations at
  registration time; servers that do not opt in still
  work but get text fallback for any tool that declares
  `_meta.ui.resourceUri` with disallowed metadata.
  Without this marker, stable-conformant servers
  register UI-enabled tools that look compatible and
  then fail at review time for reasons they could not
  predict.
- **[A]** **Persistence keys off `mcpServerId`, never
  display name (v14).** `MCPResourceReview`,
  manifest-pinning records, the `mcp_app` artifact's
  manifest binding, and any per-server task ownership
  index key off the immutable `mcpServerId`. Display
  name and other cosmetic fields are explicitly
  non-auth-relevant per decision 4 / decision 18 and
  must not appear in any persistence key, lest renames
  drop approvals or collide records.
- **[T]** **Task TTL uses a derived `expiresAt` field with
  a single-field MongoDB TTL index (v14).** MongoDB TTL
  indexes are single-field; you cannot index
  `createdAt + ttl` as an expression. v14 computes
  `expiresAt = createdAt + ttl` at write time, stores
  it on the `MCPTask` row, and indexes that field with
  `expireAfterSeconds: 0`. TTL deletion is performed by a
  background monitor and is not instantaneous; UI and
  tests must not assume hard expiry at the millisecond
  boundary. Reads check `now < expiresAt` directly rather
  than relying on the index for consistency at the read
  edge.
- **[T]** **`input_required` parks the poller (v14).**
  When a task transitions to server-reported
  `status: "input_required"`, the shared poller stops
  issuing further `tasks/get` for that task. The UI
  surfaces the unsupported-lifecycle chrome; cancel
  remains available **only** when the server advertises
  `tasks.cancel`; the poller does not resume on its own.
  Manual refresh from the user re-issues a single
  `tasks/get` and resumes parking on the same status.
  The Tasks spec says requestors should poll until
  terminal **or until `input_required`**; v14 honors
  that termination condition explicitly.
- **[A]** **Operator-facing review console is post-v1
  (v14).** The Apps rationale supports host review of
  templates and pinning of reviewed assets, but a
  fully-fledged admin UI is not on the v1 release path.
  v1 ships log-and-auto-allow plus pinning behavior
  (advisory by default, hard refuse under
  `MCP_APPS_HASH_PINNING_REQUIRED=true`); operators read
  review activity from logs. A first-class admin UI
  comes in a later release without changing user-facing
  UX.
- **[A]** **Display modes: `inline` only in v1 (v14).**
  v1 advertises `availableDisplayModes = ["inline"]` in
  both Preview and Hardened. Earlier revisions allowed
  Preview to honor `appSettings.allowFullscreen` and
  expose `fullscreen` in `availableDisplayModes`; v14
  cuts that until trust-chrome-under-fullscreen is
  validated, so the truthful-subset principle for
  HostContext is consistent across modes. Fullscreen is
  re-evaluated post-v1 with the trust-chrome validation.

## Goal

Bring LibreChat to a useful, conformant subset of the MCP extensions for
interactive UIs (**MCP Apps**, SEP-1865, stable 2026-01-26) and long-running
operations (**MCP Tasks**, 2025-11-25, experimental). v13 collapsed Apps
Preview and Apps Hardened to a **single authoring profile**
(self-contained HTML, no external assets, bridge-routed networking).
v14 extends that profile with an explicit wire-level marker (so servers
learn the profile during MCP capability negotiation, not at review-time
failure), makes the host's behavior under sandbox + `srcdoc` explicit
(no native navigation, no native forms, no native refresh redirects;
anchors are intercepted and routed through `ui/open-link`), strips
fullscreen from v1 entirely (truthful `availableDisplayModes` =
`["inline"]` in both modes), and tightens persistence keys to
`mcpServerId` rather than display name. v14 also closes a Tasks UX
hole: model-started `taskSupport: "required"` calls default to
**implicit wait-mode** for the originating turn, so a normal chat tool
that takes minutes still yields its result in chat without forcing the
user to open the jobs panel. Apps Hardened remains a stricter
**LibreChat Hardened App Profile**, not stable-spec parity (decision
22). Tasks v1 is a deliberately narrow, capability-conditional,
polling-only subset — there is no blocking `tasks/result` waiter
(decision 30, v13).

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
4. **Authorization context identifier (v13 derived
   snapshot shape).** v1 binds task ownership to a stable
   `authContextHash` over **stable identity inputs plus
   the auth-relevant server-config snapshot**, not over
   live bearer-token bytes and not over every server-config
   edit. Inputs: `userId`, `mcpServerId`,
   `credentialSource`, `oauthSubject || apiKeyFingerprint`,
   and the **derived auth-relevant config snapshot**
   covering server URL, transport type, OAuth issuer,
   OAuth client_id, sorted OAuth scopes, API key reference
   (opaque mapping ID, never the key bytes), and
   per-user credential mapping policy.
   `headerAuthFingerprint` (over the live `Authorization`
   header value) was in v10 and is **removed in v11**.
   `configRevision` (every server-config edit) was in v11
   and is **replaced in v12** by `authRevision`.
   `authRevision` (a manually-bumped counter) is itself
   **replaced in v13** by the derived snapshot — managing
   a counter that must bump on auth-relevant edits and
   never on cosmetic edits is exactly the kind of rule
   that rots in maintenance, and a missed bump leaks
   access to tasks that should be hidden. The v13 shape
   hashes the auth-relevant fields directly, so the
   ownership invariant is structural, not procedural.
   Token rotation does **not** change `authContextHash`.
   Identity-level or auth-relevant config changes (user
   logout, server URL changed, transport type changed,
   OAuth issuer/client/scopes changed, API key rotated
   or remapped, credential mapping policy changed) **do**
   change the hash and invalidate ownership. Display
   name, description, icon, docs, default UI settings,
   and fallback height are **not** in the snapshot and do
   **not** orphan in-flight tasks. The human-readable
   tuple `(userId, mcpServerId, oauthSubject ||
   apiKeyFingerprint)` is kept for logs and UI; the
   binding key is the hash.
5. **`_meta.ui.domain` in v1.** Explicitly **unsupported**. Resources
   declaring `domain` are rejected at review time with a clear error
   message. v1 collapses everything to one `MCP_SANDBOX_ORIGIN`.
6. **Asset policy: self-contained HTML in both modes
   (v13).** v1 approves **bytes**, not origins, in both
   Preview and Hardened. The resource HTML must be
   self-contained: inline `<script>` and `<style>`,
   `data:` images permitted, and **no** `<script src>`,
   `<link href>`, `<img src>`, frame `src`,
   `<source>`/`<track>`/`<video>`/`<audio>` `src`, or
   ES module `import` to remote origins (relative or
   absolute), and **no** `<base>`. Earlier revisions
   allowed Preview to honor absolute HTTPS URLs via
   `_meta.ui.csp.resourceDomains`; v13 cuts that surface
   because it is the single biggest source of "works in
   Preview, breaks in Hardened" cases under the unified
   `srcdoc` topology, and the supply-chain attack surface
   on remote assets is at odds with the bytes-not-origins
   approval model. The review pipeline rejects any
   forbidden construct at review time. `resourceDomains`,
   `frameDomains`, and `baseUriDomains` metadata is parsed
   but **never** installed in the rendered CSP in either
   mode.
6a. **Network policy: bridge-routed only in both modes
    (v13).** v1 sets `connect-src 'none'` in the inner CSP
    in **both** Preview and Hardened. The inner view
    cannot `fetch`, XHR, or open a WebSocket directly.
    `_meta.ui.csp.connectDomains` is parsed but **never**
    installed in the rendered CSP in either mode.
    Earlier revisions allowed Preview to honor
    `connectDomains` per upstream; v13 cuts that surface
    because the unified `srcdoc` topology forces an
    opaque-origin (`null`) inner frame, which breaks
    cookies, conservative CORS, OAuth, and origin-based
    API allowlists — `connect-src` ends up being
    best-effort even when populated. App authors route
    through the bridge (`tools/call`, `resources/read`,
    `ui/open-link`) for anything that needs credentials
    or a stable browser-side identity. Re-introducing
    reliable `connect-src` from server metadata is post-v1
    and depends on a stable-origin design.
6b. **Approval is over a launch manifest, not just HTML.**
    `manifestHash` is the canonical hash over: decoded HTML,
    host-filtered effective sandbox flags, effective iframe
    `allow` permissions, effective network policy
    (`connect-src` set, navigation allowlist intersection),
    `resourceUri`, and host trust-policy version. Both review
    and remount records bind to it. Divergence on any policy
    axis (not just bytes) triggers re-approval.
6c. **Content decoding pipeline (v13 exactly-one-match).**
    `resources/read` results are decoded in this fixed
    order: walk the `contents[]` array; collect every
    entry whose `uri` exactly matches
    `_meta.ui.resourceUri` and whose `mimeType` parses as
    `text/html;profile=mcp-app` (parameter order
    normalized); **fail review if zero or more than one
    such entry is present**; for the single matching entry
    log and ignore non-matching siblings; decode `text`
    verbatim or base64-decode `blob` under
    `MCP_APPS_MAX_HTML_BYTES`; UTF-8 validate; run the
    self-contained-HTML validator; compute `manifestHash`.
    v11 accepted multi-content responses with a
    "log extras and ignore" rule; v13 keeps that for
    non-matching entries but closes the duplicate-match
    ambiguity (which would otherwise be nondeterministic
    if two entries shared the same declared URI and MIME
    but carried different bytes).
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
10. **Single `MCP_APPS_MODE` enum, plus independent
    `MCP_TASKS_ENABLED`.** Two operator settings:
    - `MCP_APPS_MODE = "disabled" | "preview" | "hardened"`
      (default `"disabled"`).
      - `"disabled"`: Apps path is off; the legacy
        `UIResourceRenderer` is the only path. Its default
        `sandboxPermissions` is `''` (deny by default) —
        change applied unconditionally regardless of mode.
      - `"preview"`: adopts upstream PR #11799 substantially
        as-is (per-instance chat rendering, `mcp_app`
        artifacts, backend proxies, branch-native config).
        **Inline only** in v1 (v14 strips fullscreen
        entirely; see decision 21 / displayMode rule).
      - `"hardened"`: turns on the v8 security delta on top
        of `"preview"`. Adds dedicated `MCP_SANDBOX_ORIGIN`,
        hop-specific relay validation with proxy-stamped
        nonce, folded-in `ui/initialize` probe,
        `connect-src 'none'`, self-contained-HTML rule,
        `MCPAppLaunchManifest` review, mandatory trust
        chrome (ignores `prefersBorder=false`), Wasm/eval
        runtime exclusion.
    - `MCP_TASKS_ENABLED` — independent of `MCP_APPS_MODE`.
    Deprecated `MCP_APPS_ENABLED=true` is mapped to
    `MCP_APPS_MODE="preview"` with a startup warning. Any
    other value of the deprecated flag is ignored. Tests
    assert no impossible flag combinations are reachable.
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
13. **Remount derives from the inherited `mcp_app` artifact;
    no parallel store.** PR #11799 already attaches an
    `mcp_app` artifact to the message after the tool call.
    v10 **extends** that artifact with `manifestHash` and
    `authContextHash` fields and uses it for remount. On
    conversation reopen, the host reads `mcp_app` artifacts
    off message history and replays the launch lifecycle for
    each. View-internal state (selection, scroll, in-flight
    SPA navigation) is **not** preserved; the artifact is
    intentionally narrow and is not a state-management store.
    Apps that need durable view state keep it on their MCP
    server. There is no separate `MCPAppInstance` collection.
14. **No host-side terminal-result cache (v12).** Earlier
    revisions cached `tasks/result` payloads under upstream
    TTL with blob offload + semantic-equivalence
    rehydration. v12 **cuts that entire surface from v1**.
    The host stores task **metadata only**; on explicit
    detail entry or explicit wait, the host calls
    `tasks/result` **live** against the server. The server
    is the single source of truth for terminal payloads
    and may legitimately answer "task expired" past
    `createdAt + ttl`. Removing the cache eliminates BSON-
    size management, blob offload, semantic rehydration,
    expiry semantics, and another retention boundary to
    secure. If repeated live fetches prove too slow in
    production, caching can be added later behind the
    same metadata model rather than ahead of it.
15. **Surface matrix by mode (legacy renderer retirement).**
    - `MCP_APPS_MODE = "disabled"`: legacy
      `UIResourceRenderer` is the only path. Renders on
      chat, share, search, and plugin-rendered surfaces as
      today **with the default `sandboxPermissions` change
      applied** (`''` instead of `'allow-popups'`). This is
      the safety net for operators who do not opt in.
    - `MCP_APPS_MODE = "preview"` or `"hardened"`: the new
      Apps path renders **only on the live chat surface**.
      Share, search, plugin-rendered, and any other surface
      that could otherwise mount a UI resource render the
      resource's `content` field as **text fallback**. The
      legacy `UIResourceRenderer` is unreachable in these
      modes; tests assert no entry point still imports or
      mounts it.
    - There is **no** mode in which the new Apps path and
      the legacy renderer both render. There is **no** mode
      in which the new Apps path renders on a non-chat
      surface. Cross-surface support is a post-Hardened-v1
      increment.
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
    - `MCP_TASKS_MAX_RESULT_FORWARD_BYTES = 12 MiB`
      (live forward cap; no cache exists).
    - `MCP_APPS_TEARDOWN_WAIT_MS = 1500`.
    - `MCP_APPS_VIEW_RPC_RATE_PER_MIN = 600` (request
      throttle per view).
    - `MCP_APPS_VIEW_NOTIF_RATE_PER_MIN = 1200`
      (notification throttle per view).
    - `MCP_APPS_INITIALIZE_TIMEOUT_MS = 5000` (the relay
      probe fold-in deadline).
18. **`authContextHash` canonicalization (v13 derived
    snapshot).** Compute as
    `sha256(canonicalJSON(authPayload))` where
    `canonicalJSON` is RFC 8785 JCS-equivalent (sorted
    keys, no whitespace, no insignificant differences)
    and `authPayload` is the union of identity inputs and
    a derived auth-relevant config snapshot:

    ```
    authPayload = {
      userId,
      mcpServerId,
      credentialSource,
      oauthSubject,        // OAuth `sub`, stable across refresh
      apiKeyFingerprint,   // sha256(api_key), stable until rotation
      authConfigSnapshot: {
        serverUrl,         // string
        transportType,     // "streamable-http" | ...
        oauthIssuer,       // string | null
        oauthClientId,     // string | null
        oauthScopes,       // sorted string[] | null
        apiKeyRef,         // opaque mapping ID | null
        credentialMappingPolicy, // "shared" | "per-user" | null
      },
    }
    ```

    All identity fields are required; missing fields are
    explicit `null` so the hash distinguishes "absent"
    from "empty". `oauthSubject` is the OAuth `sub` claim
    captured at task creation; `apiKeyFingerprint` is
    `sha256(api_key)`. **Exactly one of `oauthSubject` or
    `apiKeyFingerprint` is non-null per task** (the other
    is `null`); `credentialSource` says which.
    `authConfigSnapshot` is the **derived** snapshot of
    auth-relevant server config at task creation. The
    snapshot is computed mechanically from the canonical
    config object in `packages/data-schemas`; application
    code never bumps a manual revision counter. Display
    name, description, icon, docs, default UI settings,
    and other cosmetic fields are explicitly **not** in
    the snapshot. `headerAuthFingerprint` is **not** in
    the payload — see decision 4 for why. The function
    lives in `packages/api` and has a dedicated unit-test
    corpus that includes named "OAuth refresh does not
    change the hash", "non-auth config edits do not
    change the hash", and "auth-relevant edits change the
    hash" test cases against fixture configs.
19. **Adopt upstream PR #11799 + `dev` transport fixes as
    the substrate, then layer the Hardened delta.**
    Implementation does not parallel-build. Phase 0 starts
    from `dev` (inheriting PRs #12850, #12853, #12910).
    Phase 2P (Apps Preview) inherits #11799 substantially
    as-is and adds the chat-only narrowing. Phase 2H (Apps
    Hardened) layers the security delta on top. Items
    already implemented upstream (per-instance outer
    iframes, same-server binding via instance state,
    `/api/mcp/sandbox` auth + `appsEnabled` gating,
    `ui://` URI validation, capability advertising gating,
    `mcp_app` artifact plumbing, `stableMCPAppRef`) are
    **inherited; verify with regression tests** rather than
    re-implemented. Phase 1 pins a specific commit SHA on
    `KyleKincer:feat/mcp-apps` (set at Phase 1 start) and
    a specific `@modelcontextprotocol/ext-apps` package
    release; the plan tracks upstream churn against those
    pins instead of continuously rebasing.
20. **First Apps release (both Preview and Hardened) is
    live-chat-only.** Share, search, plugin-rendered, and
    any other non-chat surface fall back to text. The
    surface narrowing is enforced in code regardless of
    mode (when mode is not `"disabled"`).
21. **Display modes: `inline` only in v1 (v14).** Both
    Preview and Hardened advertise
    `availableDisplayModes = ["inline"]` and reject any
    `ui/request-display-mode` request other than `inline`.
    Earlier revisions allowed Preview to honor
    `appSettings.allowFullscreen` and expose `fullscreen`
    in the upstream code path; v14 cuts that for v1
    because trust-chrome-under-fullscreen has not been
    validated and the truthful-subset principle for
    HostContext should not be mode-dependent. Other
    display modes (`pip`, etc.) remain out of scope.
    Fullscreen is re-evaluated post-v1 with the
    trust-chrome-under-fullscreen validation, at which
    point a future operator gate may re-introduce it.
22. **Hardened is documented as the LibreChat Hardened App
    Profile, not as stable spec parity.** Operator docs
    enumerate each stable Apps surface field
    (`connectDomains`, `resourceDomains`, `frameDomains`,
    `baseUriDomains`, `_meta.ui.domain`,
    `_meta.ui.prefersBorder`) and state Hardened's
    behavior for each. App authors targeting Hardened
    build to the profile, not to the wider spec.
23. **Hardened v1 excludes Wasm-heavy and eval-dependent
    runtimes.** Hardened CSP is `script-src 'unsafe-inline'`
    with no `wasm-unsafe-eval` and no `'unsafe-eval'`. That
    rules out Pyodide, Wasm-built frameworks, custom WASM
    kernels, `eval`/`new Function`-using code, and any
    Three.js path that relies on dynamic `Function`
    construction for shaders. Apps that need those run in
    Preview only (where the upstream CSP allows them) or
    wait for a post-v1 Hardened profile that adds opt-in
    relaxations behind per-app review. Tests assert that
    Hardened blocks Wasm instantiation and `eval` at the
    browser level on a fixture page.
24. **Tasks polling uses a shared in-process fan-out
    poller.** A single backend poller per
    `(taskId, authContextHash)` runs while subscribers
    exist; the poller is keyed by that tuple. Subscribers
    (mounted view, jobs panel, chat tab) subscribe to an
    in-process channel and receive fan-out updates;
    duplicates are coalesced. When the subscriber count
    hits zero, the poller stops; the task continues
    server-side. On user return, a new poller is created
    on first subscribe. Per-subscriber loops are an
    anti-pattern in this design.
25. **Review flow is auto-allow + manifest pinning + kill
    switch (v12 auto-repin in advisory mode).** No human
    approval queue, no admin approval UI in v1. The host
    runs the decoding pipeline, computes `manifestHash`,
    stores the manifest under `MCPResourceReview`, and
    renders. On manifest divergence in **advisory** (default)
    mode, the host **auto-repins to the new manifest** and
    renders it; a host-controlled banner above the view
    surfaces the change (server identity, manifestHash
    short-prefix before/after, what changed — bytes,
    sandbox flags, permissions, network policy, URI, or
    trust-policy version). There is **no** blocking
    re-acknowledge click in advisory mode. In **strict**
    mode (`MCP_APPS_HASH_PINNING_REQUIRED=true`) divergence
    is a hard refuse with the same banner content but no
    rendering. `MCP_APPS_KILL_SWITCH` (off by default)
    refuses all Apps rendering instantly if an operator
    needs to disable in flight.
26. **`input_required` is a deliberate restricted profile,
    not protocol-native behavior.** The Tasks spec says
    requestors should preemptively call `tasks/result`
    when a task transitions to `input_required`. v1 does
    **not** do that, because LibreChat cannot satisfy
    elicitation/sampling. v1 keeps the server-reported
    `status: "input_required"` unmodified, surfaces a
    `hostHandlingState = "unsupported_lifecycle"` chrome
    message, and offers cancel. Documented as a named
    subset decision in operator docs and in the Tasks
    operator guide so server authors are not surprised.
27. **Tasks storage is metadata only (v12).** `MCPTask`
    holds task metadata
    (`taskId`, `authContextHash`, `mcpServerId`, `sessionId`,
    `status`, `hostHandlingState`, `createdAt`,
    `lastUpdatedAt`, `ttl`, `pollInterval`,
    `progressToken`, `modelImmediateResponse`, `lastSeen`,
    `correlationConversationId`,
    `serverTasksCapabilities`). **No** terminal result
    envelope is cached in v1; on explicit detail entry or
    explicit wait the host calls `tasks/result` **live**.
    There is no blob offload, no semantic-rehydration
    persistence, no original-request-envelope persistence,
    no durable subscriber registry, no progress
    checkpointing. The MongoDB TTL index on the
    derived `expiresAt = createdAt + ttl` field (v14)
    removes stale metadata
    automatically. Server-reported `tasks.list` /
    `tasks.cancel` capabilities are persisted on the row
    so capability-conditional UX survives reconnect.
28. **Preview HostContext is a deliberate minimum.**
    Preview populates `displayMode`, `availableDisplayModes`,
    `containerDimensions`, `toolInfo`, `theme`, `locale`,
    and `timeZone`. CSS-variable catalogs, safe-area
    insets, deep device-capability surfaces, and platform
    richness are deferred until Hardened or until a real
    app needs them. Truthful subset rather than synthetic
    full surface.
29. **Tasks UX is capability-conditional (v12).** The
    Tasks spec makes `tasks.list` and `tasks.cancel`
    independently negotiated sub-capabilities. The spec
    explicitly warns that servers without a stable
    requestor identity should **not** advertise
    `tasks.list`. v1 honors that:
    - **`tasks.list` absent on a server.** The jobs
      panel does **not** show that server's tasks under a
      "global discovery" rubric. Locally created task
      handles in the user's current conversations are
      still tracked in-memory and via the `MCPTask`
      metadata row; users see a per-conversation jobs
      view, not a cross-session global view, for that
      server. The cross-session global view is shown only
      for servers whose negotiation included `tasks.list`.
    - **`tasks.cancel` absent on a server.** The cancel
      button is **not rendered** for that server's task
      rows. The host does not synthesize a "cancel" path
      against a server that does not advertise the
      capability.
    - The host persists negotiated `tasks.list` /
      `tasks.cancel` on the `MCPTask` row (and on the
      in-process server-capabilities cache) so the UX
      stays consistent across page reloads and reconnects.
    - This makes Tasks v1 honest against servers that
      cannot identify requestors, instead of universally
      promising a global jobs panel that some servers
      cannot safely back.
30. **No blocking `tasks/result` waiter; "wait" is a UI
    mode on top of the shared poller (v13).** Earlier
    revisions modeled "wait for result" as: suspend
    poller, issue blocking `tasks/result`, handle session
    loss mid-wait with a single re-init / `tasks/get` /
    retry budget. v13 cuts the blocking waiter entirely.
    "Wait for result" is a UI state on top of the shared
    poller: the host keeps polling `tasks/get` at
    `pollInterval`, the UI shows a waiting state, and on
    the first terminal status the host issues exactly one
    `tasks/result` to fetch the envelope. Latency cost:
    at most one `pollInterval` of additional completion
    delay. Code cost saved: the entire wait-restart state
    machine, concurrent wait/poll duality, dedicated
    re-init/retry budget, and the test surface around
    them. Session re-init during polling uses the same
    outstanding-task revalidation path as everywhere else
    (Phase 4). This is the largest single Tasks
    simplification in v13.

31. **Bootstrap trust contract (v13).** The sandbox proxy
    (`proxy.html` served from `MCP_SANDBOX_ORIGIN`)
    bootstraps with a **fail-closed** trust contract:
    - The proxy never derives the host origin from
      `document.referrer`, never accepts or sends
      `'*'` as a `targetOrigin`, and never partial-matches
      origins.
    - Host origin, view ID, and the per-view nonce arrive
      through a host-controlled bootstrap channel: a
      single `host-bootstrap` postMessage from the
      LibreChat application origin sent immediately after
      the outer iframe's `load`, validated against an
      operator-configured allowlist of expected host
      origins. The proxy refuses to initialize if the
      message is absent within `MCP_APPS_INITIALIZE_TIMEOUT_MS`,
      malformed, or arrives from any other origin.
    - Operators must deploy `proxy.html` with at minimum:
      `Content-Security-Policy: frame-ancestors
      <librechat-origin>`, `Cache-Control` set to
      no-cache, and `Cross-Origin-Resource-Policy:
      same-site` (or stricter). A startup health check
      fetches `proxy.html` from `MCP_SANDBOX_ORIGIN`,
      verifies these headers, and refuses to enable Apps
      capability advertisement if any required header is
      absent. The check runs on Apps capability boot and
      on every `MCP_SANDBOX_ORIGIN` config reload.
    - Bootstrap errors surface in operator logs with the
      missing field; users see the standard text
      fallback card.
32. **Single authoring profile across modes (v13).**
    Preview and Hardened share one HTML/asset/networking
    contract: self-contained HTML, no external assets, no
    direct browser networking, bridge-routed only. The
    modes differ on **policy strictness only**:
    - Wasm/eval permitted in Preview, blocked at CSP in
      Hardened.
    - Fullscreen optional in Preview behind operator
      gate, stripped in Hardened.
    - Legacy `UIResourceRenderer` retired on chat in
      Preview, retired across all surfaces in Hardened.
    - `manifestHash` review and pinning active in
      Hardened, scaffolded but inactive in Preview
      (Preview ships without manifest review; that is a
      Hardened-only feature).
    - Operator gating: Preview is the default opt-in
      ("turn on Apps"); Hardened is a stricter
      operator-elected mode ("turn on the LibreChat
      Hardened App Profile").
    There is **no** Preview-only authoring contract. App
    authors who target Preview today work without changes
    when an operator promotes to Hardened (modulo Wasm/
    eval and fullscreen, which are documented).
33. **Required text fallback contract (v13).** Servers
    that mark tools with `_meta.ui.resourceUri` MUST also
    return a human-meaningful text summary in
    `CallToolResult.content`. The host renders that text
    on every non-render path:
    - Non-chat surfaces (share, search, plugin-rendered).
    - Failed `ui/initialize` relay probes.
    - Browsers that fail the runtime relay self-test.
    - The bootstrap-trust health-check failure mode.
    - Hardened mode without a passing manifest review.
    Tools that return empty or trivial `content` cause
    the host to render a single generic "App is
    unavailable on this surface" card built from
    `toolInfo`; the host does **not** synthesize content
    on the model's behalf. This contract is documented in
    the operator guide and in the Apps server-author
    docs; it is also the v1 single-fallback-surface rule
    that keeps the client implementation simple.

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
| External assets in resource HTML (both modes, v13) | v1 approves bytes, not origins; HTML must be self-contained in Preview and Hardened |
| `_meta.ui.csp.resourceDomains` / `frameDomains` / `baseUriDomains` (both modes) | Corresponding HTML constructs forbidden in both Preview and Hardened (v13) |
| `_meta.ui.csp.connectDomains` (both modes) | Both modes block direct browser networking; route via `tools/call` / `resources/read` / `ui/open-link` (v13) |
| Direct in-app `fetch` / XHR / WebSocket (both modes) | Cut entirely in both Preview and Hardened (v13); bridge-routed only |
| Blocking `tasks/result` waiter | Cut in v13; "wait for result" is a UI mode on top of the shared poller; final fetch happens once on terminal status |
| User-visible assistant placeholder for `model-immediate-response` | Cut in v13; the field is fed to the model as the immediate tool result per spec, but is not surfaced as an assistant-visible turn |
| `_meta.ui.prefersBorder = false` | Trust chrome is mandatory in v1 |
| Opportunistic terminal-result persistence in Tasks | Cut to reduce hidden retention; `tasks/result` only on detail entry / explicit wait |
| Host-side terminal-result cache (any layer) | Cut in v12; `tasks/result` is fetched live every time. Removes blob offload, semantic-rehydration persistence, and an extra retention boundary |
| Cross-session global jobs panel for servers without `tasks.list` | Tasks UX is capability-conditional; per-conversation jobs only when the server cannot identify requestors |
| Cancel affordance for servers without `tasks.cancel` | Cancel button not rendered when capability is absent |
| Separate relay-probe protocol surface | Folded into the first relayed `ui/initialize` |
| Approval over HTML hash alone | Approval binds to `manifestHash` (HTML + sandbox + permissions + network policy + URI + trust-policy version) |
| Multiplexed / pooled sandbox proxy iframe | One proxy iframe per app instance in v1 |
| User-agent allow/deny list for browser support | Runtime relay self-test (folded into `ui/initialize`) instead |
| Locally cached `tasks/result` (any layer) | No cache exists in v12; live fetch on detail/wait |
| Durable persistence of view-internal app state | Spec defers; remount artifact only re-instantiates the view |
| Coexistence of legacy `UIResourceRenderer` with new Apps path on same message | Legacy path unreachable when `MCP_APPS_MODE !== "disabled"` |
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
| Byte-for-byte `tasks/result` rehydration | N/A in v12 — there is no rehydration; the host fetches `tasks/result` live and forwards it without re-encoding |

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
  task continues server-side. On user return, the jobs panel
  refreshes state via `tasks/get` for each known task; the
  cross-session `tasks/list` call is issued **only** for
  servers that advertise the `tasks.list` sub-capability
  (capability-conditional UX, v12). TTL is surfaced regardless.
- **Jobs panel is status-only.** Opening the panel does **not**
  call `tasks/result` for any row. It loads task state with
  `tasks/get` (and `tasks/list` for capable servers), displays
  status and TTL, and only calls `tasks/result` on (a) explicit
  detail entry or (b) explicit "wait for result" on an
  in-flight task. There
  is **no opportunistic save** path: a subscribed task that
  reaches terminal while the user is present does **not**
  trigger an automatic `tasks/result`. The mounted view that
  produced the task already received the underlying tool
  result via the bridge; the host does not need to re-fetch
  it. Cutting opportunistic save eliminates a hidden
  retention layer and matches the spec's normative status
  path more cleanly.
- **"Wait for result" is a UI mode on top of the shared
  poller (v13).** When the user clicks "wait for result"
  on an in-flight task, the host does **not** issue a
  blocking `tasks/result`. Instead, the UI switches to a
  waiting state and the shared `tasks/get` poller keeps
  running at `pollInterval`; on the first terminal status
  the host issues exactly one `tasks/result` to fetch the
  envelope. This avoids concurrent wait/poll duality and
  removes the entire wait-restart state machine that
  earlier revisions introduced for session loss mid-wait.
  Latency cost: at most one `pollInterval` of additional
  completion delay. UX cost: none — the user sees the
  same waiting affordance.
- **No host-side terminal-result cache (v12).** v1 does
  **not** cache `tasks/result` payloads. The `MCPTask`
  collection holds task **metadata only** (`taskId`,
  status, timings, ttl, capability flags, correlation
  fields). On detail entry or explicit wait the host
  calls `tasks/result` **live** against the server every
  time; the server is the single source of truth and may
  answer "task expired" past `createdAt + ttl`. Removing
  the cache eliminates blob offload, BSON-size
  management, semantic-rehydration logic, and an extra
  retention layer to secure. The MongoDB TTL index on
  `createdAt + ttl` removes stale metadata rows
  automatically.
- **`tasks/cancel` after terminal status.** The spec requires the
  receiver to **reject** with `-32602` invalid params. v1 client
  honors that — the running-jobs cancel button is **only
  rendered for servers that advertise `tasks.cancel`** (v12)
  and is disabled in terminal states; if a race produces a
  late cancel, the `-32602` is surfaced as a no-op to the
  user.
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
- **Result fidelity (v12, retained in v13).** `tasks/result`
  is fetched live from the server and forwarded to the
  requester without host-side rehydration. The server is
  responsible for the same successful result or JSON-RPC
  error shape the underlying request would have produced,
  including `_meta` preservation (see view-path rules in
  the Data boundary section). The host does not re-encode
  or pointerize; nothing is cached, so there is no
  rehydration step. View-path forwarding of the live
  envelope must preserve `_meta` exactly as the server
  returned it, including
  `_meta["io.modelcontextprotocol/related-task"]`. v13
  removes the dedicated blocking-waiter path for
  `tasks/result`; the only contexts that issue
  `tasks/result` are explicit detail entry on a terminal
  row and the shared poller's one-shot terminal fetch
  when "wait for result" is the active UI state.
- Status notifications are optional; `pollInterval` is advisory; the
  host treats both as hints.
- Servers may return
  `_meta["io.modelcontextprotocol/model-immediate-response"]` — a
  provisional, model-facing string letting the model continue
  reasoning while the task runs. **v13 treats this as model
  plumbing only.** When present, the agent passes the string to
  the model as the immediate tool result for that task call;
  there is no user-visible assistant placeholder, no
  model-suppression for the turn, and no separate "final
  result" assistant message that overwrites the placeholder.
  The user sees a normal task card in the running-jobs UI.
- **Authorization context binding via `authContextHash`
  (v13 derived snapshot).** Task access is bound to a stable
  hash over identity inputs and a **derived auth-relevant
  config snapshot** at task creation: `userId`,
  `mcpServerId`, `credentialSource`, exactly one of
  `oauthSubject` or `apiKeyFingerprint`, plus the
  snapshot covering server URL, transport type, OAuth
  issuer/client_id/sorted-scopes, API key reference (opaque
  mapping ID, never key bytes), and per-user credential
  mapping policy. The snapshot is computed mechanically
  from the canonical config object; v13 deliberately
  removes the v12 `authRevision` counter because requiring
  application code to bump exactly once on auth-relevant
  edits and never on cosmetic edits is the kind of
  procedural rule that rots in maintenance — a missed bump
  leaks access to tasks that should be hidden, an extra
  bump makes tasks vanish "mysteriously". Hashing the
  snapshot directly makes the ownership invariant
  structural rather than procedural. Display name,
  description, icon, docs, default UI settings, and
  fallback height are explicitly **not** in the snapshot
  and do **not** orphan in-flight tasks. Token rotation
  does not change the hash. The human-readable tuple
  `(userId, mcpServerId, oauthSubject || apiKeyFingerprint)`
  is kept for logs and UI but is **not** the binding key.
  This guards against the LibreChat-specific risk surface
  around shared server definitions and per-user credential
  leakage flagged by recent advisories, while keeping
  ordinary OAuth refresh and cosmetic config edits
  ownership-stable.
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
  The host **only** invokes `tasks/list` for servers that
  advertise the `tasks.list` sub-capability (v12); for servers
  without it, the host shows a per-conversation handles view
  built from locally tracked launches and `tasks/get` polling
  per known `taskId`.

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
| `appSettings.allowFullscreen` + fullscreen portal | **Stripped in v1 (v14)** — both Preview and Hardened reject `fullscreen` mode; the upstream portal code remains tree-shake-unreachable | upstream branch (disabled) |
| Apps test server scaffold | **Inherited from #11799** | upstream branch |
| Apps Preview capability negotiation (gated by `MCP_APPS_MODE="preview"`) | Phase 2P | — |
| Live-chat-only narrowing (text fallback on share/search/plugin) | Phase 2P | client surfaces |
| Single-ACL `forwardMcpRequestFromView` consolidation refactor | Phase 2P (refactor of inherited binding) | — |
| Dedicated `MCP_SANDBOX_ORIGIN` outer iframe + `frame-ancestors` header | Phase 2H (Hardened GA) | — |
| `AppBridge` wrapper with explicit-origin transport shim, lazy-loaded on client | Phase 2H (Hardened GA) | — |
| Host construction-order invariant for `srcdoc` race | Phase 2H (Hardened GA) | — |
| Hop-specific relay validation + proxy-stamped per-view nonce | Phase 2H (Hardened GA) | — |
| Folded-in `ui/initialize` relay probe + text-only fallback | Phase 2H (Hardened GA) | — |
| Truthful `hostContext` full surface (`toolInfo`, theme, locale, etc.) | Phase 2H (Hardened GA) | — |
| Self-contained-HTML validator (rejects all external assets, `<base>`) | Phase 2H (Hardened GA) | — |
| Content decoding pipeline (MIME, `text`/`blob`, UTF-8, `contents[]` selection) | Phase 2H (Hardened) | — |
| Vendored generated Apps schemas (TypeScript + JSON Schema) for `2026-01-26` spec | Phase 1 | `packages/data-provider/src/mcp-apps/schemas/` |
| `MCPAppLaunchManifest` builder + canonical-JSON hasher (RFC 8785) | Phase 2H (Hardened GA) | — |
| First-launch resource review + manifest pinning (`MCPResourceReview.manifestHash`) | Phase 2H (Hardened GA) | — |
| Extend inherited `mcp_app` artifact with `manifestHash` + `authContextHash` for cross-load remount | Phase 2H (Hardened GA) | — |
| Per-resource CSP via `<meta>` injection (strict; `connect-src 'none'`) | Phase 2H (Hardened GA) | — |
| Operational limits (HTML size, view-bound payload, teardown wait, rate limits, init timeout) | Phase 2H (Hardened GA) | — |
| Trust UX (mandatory chrome; ignore `prefersBorder=false`) | Phase 2H (Hardened GA) | — |
| `authContextHash` canonicalizer + unit-test corpus | Phase 0 (Tasks consumes it; Hardened GA also uses it) | `packages/api` |
| Sizing fallback height + `shrinkWrap: false` opt-out | Phase 2P (alongside upstream `maxHeight`) | — |
| MCP Tasks (per-tool negotiation, active-subscriber polling, single-path wait, `authContextHash` binding, metadata-only storage with live `tasks/result` forwarding, capability-conditional UX) | Missing | — |
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

- **Independent feature flags.** `MCP_APPS_MODE`
  (enum: `"disabled" | "preview" | "hardened"`) and
  `MCP_TASKS_ENABLED` (boolean) are independent operator
  settings. This decouples the Apps release trains (Preview
  / Hardened) from the Tasks (experimental) release train
  so Tasks instability never blocks Apps shipping, and so
  Hardened can be promoted without touching Tasks.
- Apps Preview capability turns on at the end of Phase 2P
  when `MCP_APPS_MODE="preview"`.
- Apps Hardened capability turns on at the end of Phase 2H
  when `MCP_APPS_MODE="hardened"`.
- Tasks capability turns on at the end of Phase 4 when
  `MCP_TASKS_ENABLED=true`. Tasks may stay OFF across
  multiple Apps releases.
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
- **Lazy-loaded on the client with a CI-enforced budget.**
  Importing `AppBridge` + `PostMessageTransport` from
  `@modelcontextprotocol/ext-apps/app-bridge@1.7.1`
  measures ~377 KB minified, dominated by Zod. They are
  dynamic-imported on-demand only when the first Apps view
  in a session is about to mount. CI enforces an 8 KB
  compressed bundle-size budget on the default chat entry
  point delta from `main` when no app is mounted; pull
  requests that exceed the budget fail.
- **Wire flow:**
  1. Proxy emits `ui/notifications/sandbox-proxy-ready`.
  2. Host runs the content-decoding pipeline
     (`contents[]` entry selection + MIME validation +
     `text`/`blob` decode + UTF-8 validate +
     self-contained-HTML validator + manifest construction
     + `manifestHash`), checks the manifest against
     `MCPResourceReview`, and sends
     `ui/notifications/sandbox-resource-ready` with
     `{ html, sandbox, csp, permissions, nonce }`. The
     128-bit `nonce` is per-view and host-generated; the
     proxy stamps it onto every relayed inbound message.
     The inner view never sees it and never echoes it.
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
- v13 policy is **strict by construction in both modes** because
  the authoring profile requires self-contained HTML and bridge-
  routed networking (see Asset policy below).
- **Preview** inner CSP (Wasm/eval permitted):
  ```
  default-src     'none';
  script-src      'unsafe-inline' 'unsafe-eval' wasm-unsafe-eval;
  style-src       'unsafe-inline';
  img-src         data:;
  connect-src     'none';
  base-uri        'none';
  form-action     'none';
  ```
- **Hardened** inner CSP (Wasm/eval blocked):
  ```
  default-src     'none';
  script-src      'unsafe-inline';
  style-src       'unsafe-inline';
  img-src         data:;
  connect-src     'none';
  base-uri        'none';
  form-action     'none';
  ```
- The two policies are identical except for the
  `script-src` `'unsafe-eval' wasm-unsafe-eval` clauses,
  which Hardened removes. Everything else (asset rules,
  network rules, `<base>` rules, form rules) is identical
  across modes.
- `'unsafe-inline'` is necessary because the resource ships
  its scripts and styles inline; with no remote script
  origins permitted, the XSS surface is bounded to whatever
  is in the approved bytes (which is exactly what
  `manifestHash` protects in Hardened).
- **No directive draws from server metadata in v1, in
  either mode (v13).** `_meta.ui.csp.connectDomains`,
  `resourceDomains`, `frameDomains`, and `baseUriDomains`
  are all **ignored**. v1 forbids the HTML constructs the
  latter three would permit, and v1 cuts direct browser
  networking, which is what the former would permit. The
  fields are still parsed (so v2 can re-introduce them)
  but never installed.
- All app network access flows through the bridge:
  `tools/call`, `resources/read`, and `ui/open-link`. Apps
  that need to call out to a third-party API expose that as
  an MCP tool on their own server; the host calls it on
  behalf of the view.
- Documented `<meta>`-CSP limitations: `sandbox`, `frame-ancestors`,
  `report-uri` cannot be expressed. `sandbox` uses the iframe
  attribute; `frame-ancestors` is enforced by the proxy.html
  response header on the sandbox origin (v13 startup health
  check verifies the header is present); `report-uri` is
  unavailable in v1.

### Asset policy (v13: self-contained HTML in both modes)

v13 approves **bytes**, not origins, in **both** Preview and
Hardened. Earlier revisions allowed Preview to honor absolute
HTTPS URLs via `_meta.ui.csp.resourceDomains`; v13 cuts that
surface because it is the single biggest source of "works in
Preview, breaks in Hardened" under the unified `srcdoc`
topology. App authors target one profile.

The review pipeline parses each candidate `ui://` resource as
HTML and **rejects** any of these declarative constructs:

- `<script src=…>` (absolute or relative).
- `<link href=…>` for stylesheets, prefetches, modulepreloads,
  imports, etc.
- `<img src=…>` whose URL is **not** a `data:` URI.
- `<iframe src=…>`, `<frame src=…>`, `<embed>`, `<object>`,
  `<source>`, `<track>`, `<video>`, `<audio>` with remote `src`.
- `<base href=…>` tags (avoid retargeting relative resolution).
- (v14 native-navigation rules) `<form action=…>`,
  `<form method=…>`, `<meta http-equiv="refresh">`,
  `target="_blank"` / `target="_top"` link attributes,
  and any other declarative construct that needs a sandbox
  flag the host refuses to grant. Forms render but do not
  submit under the host sandbox set; refusing them at
  review time is more honest than a silently-broken form.

What the resource **may** include:

- Inline `<script>` and `<style>` blocks (subject to byte
  hashing inside the manifest in Hardened).
- `data:` images.

**Runtime-enforced rules (CSP, not review).** The validator
does **not** try to statically analyze inline JS for dynamic
imports, `fetch`, `eval`, or `WebAssembly.instantiate`. Doing
so reliably is hard and has high false-positive cost. v13
relies on the inner-view CSP at runtime instead:

- Dynamic ES `import()` to remote URLs is blocked because
  `script-src` lacks remote origins.
- `fetch`, XHR, WebSocket are blocked by `connect-src 'none'`.
- `eval` and `new Function` are blocked in Hardened by the
  absence of `'unsafe-eval'`; permitted in Preview.
- `WebAssembly.instantiate` is blocked in Hardened by the
  absence of `wasm-unsafe-eval`; permitted in Preview.

This is cheaper to reason about than a static-analysis pass
and avoids the whole class of "validator fails on a perfectly
safe inline string that happens to contain `import(`" false
positives.

Why bytes-not-origins is the right v1 model: under earlier
"absolute HTTPS in `resourceDomains` is fine" proposals, the
host-side approval was over the HTML only, while the actually-
executing JS could change under a stable URL. That made hash
pinning advisory-at-best and contradicted the "browser
receives an already-approved payload" claim. With external
assets banned in both modes, hash pinning is meaningful in
Hardened: the approved bytes are everything that runs.

App authors bundle their JS and CSS inline. This is a real
constraint, but it removes the entire supply-chain attack
surface from v1 review and lets the host make a truthful
claim about what users actually run.

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
- **Anchor click interceptor (v14).** The proxy installs a
  capture-phase click handler on the inner iframe's
  document that prevents the default action for any
  `<a href>` activation and forwards the URL to the host
  via the bridge as `ui/open-link`. The host applies the
  navigation allowlist; allowed URLs open in a new
  top-level browsing context (host UI, not iframe);
  disallowed URLs surface a user-facing chrome message.
  The interceptor is necessary because:
  - Sandboxed frames block top-level navigation by default
    without `allow-top-navigation`, so a vanilla `<a>`
    click would either fail silently or land somewhere
    unexpected.
  - Relative anchors under `srcdoc` resolve against
    `MCP_SANDBOX_ORIGIN`, not against `ui://`, so even
    same-origin-style anchor patterns from the app would
    misbehave.
  - The host wants `ui/open-link` to be the single
    navigation escape hatch (decision A: iframe sandbox
    hardened defaults; `ui/open-link` is the only
    navigation escape hatch).
- The interceptor is paired with the validator's
  `target="_blank"` / `target="_top"` rejection. The
  validator stops the obviously-broken construct at
  review time; the interceptor stops the runtime case
  where the page's JavaScript builds anchors
  programmatically.

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

UI resources arrive via `resources/read` as a
`{ contents: ResourceContents[] }` envelope. Each
`ResourceContents` entry is either `text` or base64 `blob`
and carries a `uri` and `mimeType`. The Apps payload uses
MIME `text/html;profile=mcp-app`. The review pipeline runs
in this order; any step's failure aborts review with a
clear, operator-loggable error.

1. **`contents[]` selection.** Walk the `contents[]` array
   and pick the entry whose `uri` matches the declared
   `_meta.ui.resourceUri` (exact match) **and** whose
   `mimeType`, after parameter-order normalization, parses
   as `text/html` with the `profile=mcp-app` parameter. If
   no entry matches, abort review. **Extra entries are
   logged at info level and ignored.** v1 does not require
   `contents[]` to be a single-item array (the spec models
   it as a list, and some servers legitimately return
   companion metadata items alongside the HTML payload).
2. **Decode.** `text` is taken verbatim. `blob` is
   base64-decoded inside the `MCP_APPS_MAX_HTML_BYTES` cap
   (default 2 MiB); over-cap payloads fail review without
   further work.
3. **UTF-8 validate** the decoded bytes; reject on invalid
   sequences.
4. **Self-contained-HTML validator** (see Asset policy).
5. **Manifest construction.** Build the canonical
   `MCPAppLaunchManifest` from decoded HTML, host-filtered
   sandbox flags, effective `allow` permissions, effective
   network policy (always `connect-src 'none'` — same in
   Preview and Hardened per v13 / v14 unified profile),
   `resourceUri`, and host trust-policy version.
6. **`manifestHash`** is `sha256(canonicalJSON(manifest))`
   (RFC 8785 JCS-equivalent). The hash is recorded in
   `MCPResourceReview.manifestHash` (keyed by
   `mcpServerId`, never display name — v14) and on the
   `mcp_app` message artifact (per-launch); there is no
   separate `MCPAppInstance` collection.

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
| `MCP_APPS_MAX_TOOL_RESULT_BYTES_TO_VIEW` | 8 MiB | Maximum view-bound `tool-result` payload (v14: hard-fail on the view path with a host-chrome error; never lossy-truncated to the view, since `ui/notifications/tool-result` and `tasks/result` are contractually full envelopes) |
| `MCP_APPS_TEARDOWN_WAIT_MS` | 1500 | Time to wait for `ui/resource-teardown` response before forcing iframe removal |
| `MCP_APPS_INITIALIZE_TIMEOUT_MS` | 5000 | Deadline for the first relayed `ui/initialize` to complete the (folded-in) probe |
| `MCP_APPS_VIEW_RPC_RATE_PER_MIN` | 600 | Inbound JSON-RPC requests per view per minute before throttling/pause |
| `MCP_APPS_VIEW_NOTIF_RATE_PER_MIN` | 1200 | Inbound notifications per view per minute before throttling/pause |
| `MCP_TASKS_MAX_RESULT_FORWARD_BYTES` | 12 MiB | Maximum live `tasks/result` envelope forwarded to a requester before truncation with marker (model path) or chrome-warning truncation (view path). No persistence — v12 cuts the cache. |
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
  oauthSubject: string | null,        // OAuth `sub` claim, stable across refresh
  apiKeyFingerprint: string | null,   // sha256(api_key), stable until rotation
  authConfigSnapshot: {               // derived from server config at task creation
    serverUrl: string | null,         // canonical URL form
    transportType: string | null,     // "streamable-http" | ...
    oauthIssuer: string | null,
    oauthClientId: string | null,
    oauthScopes: string[] | null,     // sorted, deduped
    apiKeyRef: string | null,         // opaque mapping ID, never key bytes
    credentialMappingPolicy:          // policy that decides per-user vs shared credential
      "shared" | "per-user" | null,
  } | null,
}
authContextHash = sha256(canonicalJSON(authPayload))
```

Exactly one of `oauthSubject` and `apiKeyFingerprint` is
non-null per task; the other is `null`. `credentialSource`
identifies which.

The shape **deliberately excludes any value derived from a
live bearer-token byte stream**, because OAuth refresh
rotates that value during normal operation and would orphan
in-flight tasks under v10's earlier shape. v11's identity-
only inputs survive token rollover.

`authConfigSnapshot` (v13) replaces v12's `authRevision`
counter. The v12 shape required application code to bump a
counter exactly once on every auth-relevant config edit and
never on cosmetic edits, which is fragile in maintenance —
a missed bump leaks access to tasks that should be hidden,
an extra bump makes tasks disappear. v13 hashes the
auth-relevant fields directly, so the ownership invariant is
**structural**: if any of the snapshot fields changes, the
hash changes; if none of them change, the hash is stable.

What is **in** the snapshot:

- `serverUrl`: canonicalized server endpoint URL.
- `transportType`: e.g. `"streamable-http"`.
- `oauthIssuer`, `oauthClientId`, `oauthScopes` (sorted,
  deduped).
- `apiKeyRef`: opaque mapping ID; never the key bytes
  themselves.
- `credentialMappingPolicy`: shared vs per-user credential
  policy.

What is **not** in the snapshot (and therefore does not
orphan tasks):

- Display name, description, icon, documentation links.
- Default UI settings (fullscreen permission flag, default
  shrinkWrap, fallback height, etc.).
- Cosmetic admin metadata (created-by, tags, sort order).

`canonicalJSON` follows RFC 8785 JCS: lexicographically sorted
keys, no insignificant whitespace, no trailing commas, UTF-8
output. Missing fields are explicit `null`, never omitted, so
"absent" and "empty" are distinguishable. The function lives in
`packages/api` with a dedicated unit-test corpus covering field
permutations, null vs missing, round-trip equality, and named
"OAuth refresh does not change `authContextHash`",
"cosmetic config edits do not change `authContextHash`", and
"auth-relevant edits do change `authContextHash`" test cases
against fixture configs.

## Data boundary rules

A `CallToolResult` (or live `tasks/result` envelope forwarded
from the server) flows along **two distinct paths** with
opposite preservation rules.

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
- The same rule applies to live `tasks/result` forwarding on
  the view path: the live envelope from the server keeps its
  `_meta`, including `related-task`. There is no host-side
  rehydration step in v12; the host forwards what the server
  returned.

### Implementation invariant

Two helpers, not one:

- `toModelView(result)` — strips `structuredContent` and `_meta`
  for model context, persistence into model-visible payloads, and
  replay on the model side.
- `toViewSurface(result)` — preserves the full envelope for
  bridge delivery to the view; identical handling for live
  `tasks/result` forwarding (no rehydration step).

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
  stores `(mcpServerId, resourceUri, manifestHash, manifest,
  firstSeen, authContextHashSeen)` in `MCPResourceReview`
  (v14: keyed by the immutable `mcpServerId`, never the
  display `serverName`). Operator policy decides auto-allow
  vs manual-review. Until approved, the tool falls back to
  text-only. v14 makes this log-and-auto-allow by default
  in v1; the operator-facing review console is post-v1.
- **Manifest pinning is required when configured, advisory by
  default.** Operators may set
  `MCP_APPS_HASH_PINNING_REQUIRED=true`, in which case any
  manifest divergence on subsequent launches is a hard refuse.
  Because the manifest covers HTML + sandbox flags + permissions
  + network policy + URI + trust-policy version, divergence
  catches policy drift, not just byte drift.
- **No proactive crawl** of `_meta.ui.resourceUri` after every
  `tools/list`. That is product polish and out of v1.

## Remount via the inherited `mcp_app` artifact

Remount uses the `mcp_app` artifact already attached to the
message by upstream PR #11799. v10 extends that artifact
rather than introducing a parallel store. The artifact exists
for one job: re-rendering the same approved view when a
conversation is reopened. It is **not** a state-management
store, **not** model-visible, and **not** a generic launch
log.

- v10 additions to the existing artifact:
  `manifestHash`, `authContextHash` (Hardened only).
- One artifact per launched app view, attached to the message
  it was launched from.
- **Hydration is lazy by visibility.** On chat reload or
  navigation back, the host does **not** eagerly replay the
  launch lifecycle for every `mcp_app` artifact in the
  conversation. Each artifact renders a placeholder card.
  An `IntersectionObserver` (default 200 px above and below
  the viewport, configurable via
  `MCP_APPS_REMOUNT_HYDRATION_MARGIN_PX`) hydrates an app
  the first time its placeholder enters the threshold;
  hydrating performs the lifecycle (fetch resource → decode
  → validate → manifest → manifest-pin check → render proxy
  → fold-in initialize). The user can also force-hydrate by
  clicking the placeholder. Long threads with many app
  messages do not pay the iframe / `resources/read` /
  initialize cost up front.
- View-internal state (selection, scroll inside the app,
  in-flight SPA navigation) is **not** preserved across
  hydration cycles.
- Apps that need durable view state keep it on their MCP
  server (e.g. via a server-defined session ID surfaced to
  the view through `tools/call`); LibreChat does not own a
  second state-management surface.
- If `manifestHash` no longer matches on rehydrate (server
  upgraded the app or changed its policy), the host surfaces
  a "this app has been updated since you opened the
  conversation" notice with a one-click re-acknowledge
  action; the new manifest is pinned. When
  `MCP_APPS_HASH_PINNING_REQUIRED=true`, divergence is a hard
  refuse instead of a notice.
- There is no `MCPAppInstance` collection. Earlier revisions
  proposed one; v10 cuts it.

## Legacy `UIResourceRenderer` migration

LibreChat currently ships
`client/src/components/MCPUIResource/MCPUIResource.tsx`, which
mounts `UIResourceRenderer` from `@mcp-ui/client` with
`sandboxPermissions: 'allow-popups'`. This component is
reachable from chat, share, and search views (and any plugin
path that renders MCP UI resources). Leaving it active
alongside the strict Apps path would mean two competing
security models in production.

- **When `MCP_APPS_MODE="preview"` or `"hardened"`:** the
  new Apps path renders **only on the live chat surface**.
  Share, search, and plugin-rendered surfaces fall back to
  text rendering for resources that carry
  `_meta.ui.resourceUri`. The legacy renderer is
  unreachable in these modes (Hardened additionally
  enforces tree-shake unreachability of the import).
- **When `MCP_APPS_MODE="disabled"`:** the legacy renderer
  remains in place across chat, share, search, and
  plugin-rendered surfaces. Its default `sandboxPermissions`
  is `''` (deny by default) regardless of mode — that
  change applies even when an operator has not opted into
  Apps at all. A chrome banner explains the migration path.
- Phase 1 includes a cross-surface audit listing every
  entry point that can render `UIResourceRenderer`, with
  tests asserting each one routes to the Apps path or
  text fallback when `MCP_APPS_MODE !== "disabled"` and
  uses the legacy renderer with deny-default sandbox when
  it is `"disabled"`.
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

### Phase 1 — Patch #11799, unify topology, unified authoring profile, relay validation, scaffold Hardened delta (≈2.5–3 weeks)

End of phase: PR #11799 patched onto the working branch with
the unified topology applied (v11 decision); sandbox bootstrap green for
authenticated users in an end-to-end test; `MCP_APPS_MODE`
enum exists but defaults OFF; share / search / plugin surfaces
fall back to text; **hop-specific relay validation,
proxy-stamped per-view nonce, and the folded-in
`ui/initialize` probe are live in Preview** (v12 — promoted
from former Phase 2H because Preview now shares the unified
topology); **`_meta` passthrough end-to-end is verified in
Preview** (v12); Hardened delta scaffolds (manifest hasher,
content decoder, self-contained-HTML validator) land disabled.
**No capability advertised yet.**

**#11799 is a local patchset, not a clean inheritance.**
End-to-end testing on `#11799` (May 2 2026) flagged a
release-blocking bug: authenticated users hit 401 on
`/api/mcp/sandbox` because the client fetched the sandbox
template with raw `fetch()` while auth lived in an axios
interceptor. Phase 1 fixes this and similar bootstrap issues
locally; we do not block on upstream cleanup.

**Required patches on top of #11799:**

- **Authenticated sandbox bootstrap fix.** Route the sandbox
  template fetch through the same auth-aware HTTP client as
  the rest of the app (axios with the JWT interceptor) — or,
  preferably, eliminate the bootstrap fetch entirely by
  serving `proxy.html` as a static asset on
  `MCP_SANDBOX_ORIGIN` (see topology change below).
- **Unified outer-sandbox topology**: replace the upstream
  `data:`-URL-on-app-origin outer iframe with a static
  `proxy.html` served from `MCP_SANDBOX_ORIGIN` for **both**
  Preview and Hardened. The split between modes is policy
  only (CSP, asset constraints, manifest review, fullscreen,
  Wasm/eval) — never topology. This removes the bootstrap
  401 class of bugs at the source and matches the spec's
  different-origin proxy expectation.
- **Explicit-target-origin transport** in both modes. The
  upstream `postMessage(..., '*')` send becomes unreachable
  once the outer iframe is on a different origin; the
  transport shim is required for the host to talk to the
  proxy at all. Preview and Hardened share the shim; only
  the proxy validation policy and the inner CSP differ.
- **End-to-end Playwright test**: sign in → open chat →
  trigger a tool with `_meta.ui.resourceUri` → assert the
  Apps view mounts, `ui/initialize` completes, and the
  first `tool-result` is delivered. This test is the
  Phase 1 Preview gate; Preview is **not** shippable until
  it is green for both authenticated and just-signed-in
  states.
- **Hop-specific relay validation + proxy-stamped per-view
  nonce, in Preview (v12).** The host accepts inbound
  postMessage **only** from the proxy at exact
  `MCP_SANDBOX_ORIGIN`, with `event.source` matching the
  bound proxy window, JSON-RPC envelope schema validating,
  and the proxy-stamped per-view nonce matching. The host
  rejects `null`-origin messages. The proxy accepts only
  opaque-origin messages from its bound inner iframe and
  stamps the per-view nonce before forwarding. The inner
  view never sees the nonce. This work was Phase 2H in
  v11; v12 promotes it to Phase 1 because both modes now
  share the unified topology and the WebKit/Safari
  `event.source === window` bug otherwise surfaces in
  Preview.
- **Folded-in `ui/initialize` relay probe, in Preview
  (v12).** The first relayed `ui/initialize` is the relay
  self-test: schema-valid + correct proxy-stamped nonce +
  within `MCP_APPS_INITIALIZE_TIMEOUT_MS` ⇒ mount passes.
  Failure tears down the iframe and falls back to
  text-only with a clear chrome message. No separate ping
  protocol surface.
- **`_meta` passthrough end-to-end, verified in Preview
  (v12).** `ui/notifications/tool-result` forwards the full
  `CallToolResult` to the view including `content`,
  `structuredContent`, and `_meta`, with
  `_meta["io.modelcontextprotocol/related-task"]` and
  server-defined `_meta` keys outside the reserved
  namespace preserved intact. Regression test fails if the
  inherited bridge drops `_meta`.

**Inherit + adapt:**

- Rebase / cherry-pick PR #11799 (at the pinned commit SHA)
  onto Phase 0's branch state.
- Vendor generated Apps schemas (TypeScript types + JSON
  Schemas) for the stable `2026-01-26` spec into
  `packages/data-provider/src/mcp-apps/schemas/`. Commit
  them. Validation uses the vendored schemas, not whatever
  `@modelcontextprotocol/ext-apps` currently exports.
- `packages/api/src/mcp/connection.ts` reads per-tool
  `execution.taskSupport` (does not advertise Apps or Tasks).
- Add `MCP_APPS_MODE` enum and `MCP_TASKS_ENABLED`.
  Deprecate the older `MCP_APPS_ENABLED` (alias to Preview
  only, with a startup warning).
- **Live-chat-only narrowing**: in
  `client/src/components/MCPUIResource/MCPUIResource.tsx`
  and any other `UIResourceRenderer` mount, when
  `MCP_APPS_MODE` is `"preview"` or `"hardened"` and the
  surface is non-chat (share, search, plugin-rendered),
  render text fallback for resources that carry
  `_meta.ui.resourceUri`. Chat keeps the Apps path. When
  `MCP_APPS_MODE="disabled"`, every surface still uses the
  legacy renderer (with the deny-default change applied).
- **Default deny `sandboxPermissions`**: change the legacy
  renderer default from `'allow-popups'` to `''` regardless
  of mode. Add the migration banner.
- **Multi-content `resources/read` handling**: the inherited
  fetch path is updated to walk `contents[]`, pick the
  matching `(uri, mimeType)` entry, log extras, and proceed.
- **Verify-with-regression-tests** for upstream items the
  plan no longer differentiates on:
  - Per-instance outer iframes (`MCPAppContainer` actually
    one-per-app).
  - Same-server binding for `tools/call` and
    `resources/read`.
  - `/api/mcp/sandbox` removed (replaced by static
    `proxy.html`); `appsEnabled` gating moves to capability
    advertise.
  - `ui://` URI validation rejects non-`ui://` schemes on
    forwarded `resources/read`.
  - `stableMCPAppRef` survives parent re-renders.
- **Lazy-load** the bridge runtime on the client; CI
  bundle-size budget on the default chat entry (max +8 KB
  compressed delta from `main` when no app is mounted).
  Reference: importing `AppBridge` +
  `PostMessageTransport` from
  `@modelcontextprotocol/ext-apps/app-bridge@1.7.1` measures
  ~377 KB minified, dominated by Zod.

**Authoring-profile enforcement (active in both modes,
v13):**

- Self-contained-HTML validator + content-decoding pipeline
  (MIME, `text`/`blob`, UTF-8, exactly-one-match
  `contents[]` selection). Active in Preview and Hardened.
- Inner-view CSP injection: Preview profile
  (`'unsafe-inline' 'unsafe-eval' wasm-unsafe-eval` on
  `script-src`), Hardened profile (`'unsafe-inline'`
  only). `connect-src 'none'` and `default-src 'none'`
  identical across modes.
- Server metadata `_meta.ui.csp.connectDomains`,
  `resourceDomains`, `frameDomains`, `baseUriDomains`
  parsed but never installed in either mode.

**Hardened delta scaffolds (land disabled, no UX impact in
Preview):**

- `MCPResourceReview` collection scaffold +
  `MCPAppLaunchManifest` builder + canonical-JSON hasher
  (RFC 8785). Unit tests cover determinism across field
  orderings against a fixture corpus. Review/pin behavior
  gated behind `MCP_APPS_MODE="hardened"` (no-op when
  off); the validator and decoding pipeline above are
  always on.
- Extend the inherited `mcp_app` artifact schema in
  `packages/data-provider` and `packages/data-schemas` with
  optional `manifestHash` and `authContextHash` fields. Only
  Hardened writes to them; Preview leaves them unset.
- Operational-limits parser. Settings present even though
  most enforcement points are gated on Hardened.
- `authContextHash` canonicalizer (`packages/api`) over the
  v13 derived snapshot + unit-test corpus (OAuth-refresh
  invariance, cosmetic-edit invariance, auth-relevant-edit
  sensitivity).
- Tests with `mongodb-memory-server` + real
  `@modelcontextprotocol/sdk` + Playwright cross-origin
  iframes.

**Bootstrap trust contract (active, v13):**

- Sandbox proxy `proxy.html` ships with the fail-closed
  bootstrap: a `host-bootstrap` postMessage from the
  LibreChat application origin delivers host origin, view
  ID, and per-view nonce; the proxy refuses to initialize
  if the message is absent within
  `MCP_APPS_INITIALIZE_TIMEOUT_MS` or arrives from a
  non-allowed origin; no `document.referrer` derivation;
  no `*` `targetOrigin`.
- Startup health check fetches `proxy.html` from
  `MCP_SANDBOX_ORIGIN` and verifies required response
  headers (`frame-ancestors`, `Cache-Control`,
  `Cross-Origin-Resource-Policy`); refuses to enable
  Apps capability advertisement on missing/incorrect
  headers; logs the missing field for operators.

**Required text fallback contract (active, v13):**

- The single fallback card UI (built from `toolInfo` and
  `CallToolResult.content`) replaces the legacy
  `UIResourceRenderer` on non-chat surfaces, failed relay
  probes, unsupported browsers, and bootstrap health
  failures. When the server's `content` is empty or
  trivial, the card surfaces a generic "App is unavailable
  on this surface" message rather than synthesizing
  content.

**Vendored Apps + Tasks schemas (v11 + v13 extension):**

- Vendor generated TypeScript types and JSON Schemas for
  Apps stable `2026-01-26` into
  `packages/data-provider/src/mcp-apps/schemas/` (v11
  baseline).
- Vendor generated TypeScript types and JSON Schemas for
  Tasks experimental `2025-11-25` into
  `packages/data-provider/src/mcp-tasks/schemas/` (v13).
- Both updated only via reviewed PRs; package upgrades
  are independent of schema updates.

Phase 1 exit criteria:

1. Authenticated end-to-end test passes:
   sign-in → chat → app launch → `tool-result`. (Replaces
   the silent 401 failure mode upstream.)
2. Inherited PR #11799 substrate runs green on chat with
   `MCP_APPS_MODE="preview"` against the static
   `MCP_SANDBOX_ORIGIN` outer iframe.
3. Share, search, and plugin-rendered surfaces never mount
   `UIResourceRenderer` for resources carrying
   `_meta.ui.resourceUri`; they always render text.
4. Legacy renderer default is `sandboxPermissions=''` in
   every mode.
5. Default chat bundle size delta is within the budget when
   no app is mounted.
6. Manifest hasher is deterministic across reorderings and
   matches fixture vectors byte-for-byte.
7. Self-contained-HTML validator rejects every external-asset
   construct in the test corpus and is **active on the Preview
   render path** (v14 — the unified authoring profile applies
   in both modes from Phase 1). The validator additionally
   rejects `<form action>`, `<form method>`,
   `<meta http-equiv="refresh">`, and `target="_blank"`/
   `target="_top"` link attributes (v14 native-navigation
   rule). The proxy's anchor click interceptor routes
   allowed `<a href>` activations through `ui/open-link`.
8. `authContextHash` unit tests pass against fixture
   configs: OAuth-refresh invariance, cosmetic-edit
   invariance, and auth-relevant-edit sensitivity (v13
   derived snapshot).
9. **Construction-order invariant** is enforced and tested
   in CI for both the outer host → proxy and proxy → inner
   iframe orderings; a fixture flipping the order
   reproduces a dropped `ui/initialize`.
10. **Hop-specific relay validation + proxy-stamped per-view
    nonce** are live in **Preview** as well as Hardened
    (v12 promotion). Both modes run on the same unified
    topology, so the WebKit/Safari `event.source === window`
    bug surfaces in Preview if the nonce is not stamped.
    Tests assert the nonce path on Chromium, Firefox, and
    WebKit/Safari.
11. **Folded-in `ui/initialize` relay probe** is live in
    Preview as well as Hardened (v12 promotion). Probe
    failure (timeout / schema / nonce) tears down the
    iframe and falls back to text-only with a clear chrome
    message.
12. **`_meta` passthrough** is verified end-to-end in
    Preview (v12 promotion): `ui/notifications/tool-result`
    forwards the full `CallToolResult` to the view
    including `content`, `structuredContent`, and `_meta`,
    with `_meta["io.modelcontextprotocol/related-task"]`
    and server-defined `_meta` keys outside the reserved
    namespace preserved intact. A regression test fails if
    the inherited bridge drops `_meta` (this is a known
    upstream regression in basic Apps hosts).
13. **Bootstrap trust health check (v13)** runs at Apps
    capability boot: the host fetches `proxy.html` from
    `MCP_SANDBOX_ORIGIN` and verifies that the response
    carries `Content-Security-Policy: frame-ancestors
    <librechat-origin>`, `Cache-Control: no-cache` (or
    equivalent), and `Cross-Origin-Resource-Policy:
    same-site` (or stricter). Any missing required header
    refuses to enable Apps capability advertisement and
    logs the missing field for operators.
14. **Sandbox proxy fail-closed bootstrap (v13)**: the
    proxy never falls back to `document.referrer` for
    parent-origin discovery, never sends or accepts `*` as
    `targetOrigin`, and refuses to initialize if the
    `host-bootstrap` postMessage from the LibreChat
    application origin is absent within
    `MCP_APPS_INITIALIZE_TIMEOUT_MS` or arrives from any
    other origin. Tests assert this on Chromium, Firefox,
    and WebKit/Safari.
15. **Required text fallback (v13)**: when an app-launching
    tool returns empty or trivial `content`, the host
    renders a single generic "App is unavailable on this
    surface" card built from `toolInfo` rather than
    synthesizing content. The test fixture is a server
    that explicitly returns empty `content` plus a
    `_meta.ui.resourceUri`; the assertion is that the card
    renders identically across non-chat surfaces, failed
    relay probes, unsupported browsers, and bootstrap
    health-check failures.
16. **Exactly-one-match `contents[]` selection (v13)**:
    a fixture server that returns two `contents[]` entries
    matching the same declared `(uri, mimeType)` triggers
    a review-time error; a fixture with one match plus
    several non-matching companion entries succeeds and
    logs the extras at info level.

### Phase 2P — Apps Preview release (≈1–1.5 weeks)

End of phase: Apps capability advertised when
`MCP_APPS_MODE="preview"`; live-chat-only Apps render
**inline only** under the **unified authoring profile**
(self-contained HTML, no external assets, `connect-src
'none'`); Wasm/eval permitted in Preview's CSP;
fullscreen disabled in v1 (decision 21); legacy renderer
still serves share/search/plugin surfaces; manifestHash
review and full legacy retirement remain Hardened-only.

(v13 estimate is shorter than v12 because the asset
validator and `connect-src 'none'` policy moved into Phase 1
with the unified authoring profile; Phase 2P now does the
visibility/HostContext/rate-limit work and turns on
capability advertisement.)

- Live-chat path adopts upstream PR #11799's
  `MCPAppContainer` and backend proxies as the rendering
  substrate. The bridge layer is **standardized on the
  SDK-based `AppBridge`** from
  `@modelcontextprotocol/ext-apps` (v14); the upstream
  custom `MCPAppBridge.ts` JSON-RPC bridge is **removed
  in Phase 1**. The transport shim wraps the SDK path
  with explicit target origins, the proxy-stamped
  per-view nonce on inbound, and the SDK's receive-side
  envelope validation. Keeping both bridges doubles the
  test matrix and guarantees drift; the v14 single-bridge
  decision matches the upstream Apps rationale of reusing
  MCP infrastructure.
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
    mode; only `inline` is honored in v1 (v14). Any
    other requested mode is rejected with a clear
    error.
  - `ui/update-model-context` — overwrite semantics.
- Host-side notifications: `tool-input`, `tool-result`,
  `tool-cancelled`, `host-context-changed`, `size-changed`,
  `ui/resource-teardown`.
- **Truthful HostContext (minimum subset).** Preview
  populates exactly: `displayMode = "inline"`,
  `availableDisplayModes = ["inline"]` (v14 strips
  fullscreen), `containerDimensions`, `toolInfo`, `theme`,
  `locale`, `timeZone`. CSS-variable catalogs, safe-area
  insets, deep device-capability surfaces, and platform
  richness are **not** synthesized in v1; they are added
  later when a real app needs them. Truthful subset, not
  synthetic full surface.
- `host-context-changed` notifications on theme / locale /
  dimension changes.
- **Two helpers** for the data boundary (`toModelView`,
  `toViewSurface`). Tests assert
  `structuredContent`/`_meta` never leak to the model path,
  and `_meta` (including `io.modelcontextprotocol/related-task`
  and server-defined keys) is preserved on the view path.
- **View-bound oversize is hard-fail (v14)**. View-bound
  results over `MCP_APPS_MAX_TOOL_RESULT_BYTES_TO_VIEW`
  refuse to render and surface a host-chrome error;
  the view is not given a truncated envelope. Model-path
  truncation continues to apply with a marker as the
  model-side concession.
- **Sizing fallback** alongside upstream `maxHeight`:
  `MCP_APPS_FALLBACK_HEIGHT_PX` until the first non-zero
  `size-changed`; `shrinkWrap: false` per-server opt-out.
- **Per-view rate limits** enforced
  (`MCP_APPS_VIEW_RPC_RATE_PER_MIN`,
  `MCP_APPS_VIEW_NOTIF_RATE_PER_MIN`); over-limit views are
  paused with a clear chrome message.
- **Live-chat narrowing locked in.** Tests assert that
  share / search / plugin surfaces never mount the new Apps
  path even when `MCP_APPS_MODE="preview"`.
- **End of phase**: enable Apps capability advertisement
  when `MCP_APPS_MODE="preview"` and the Preview
  interop matrix passes. Hardened-GA delta scaffolds remain
  inactive (`MCP_APPS_MODE!="hardened"`). Tasks may
  still be OFF.

### Phase 2H — Apps Hardened (≈1.5–2 weeks, follow-up release)

End of phase: with `MCP_APPS_MODE="hardened"`, the Apps path
adds policy hardening on top of Phase 1's already-unified
topology and Phase 1's relay validation — `connect-src
'none'`, self-contained HTML, manifest-hash review, Wasm/eval
exclusion, fullscreen disabled, and full retirement of
`UIResourceRenderer`. Phase 2H is **policy-only**; the outer
sandbox topology landed in Phase 1, and the hop-specific
relay validation, proxy-stamped per-view nonce, and folded-in
`ui/initialize` probe were promoted to Phase 1 in v12 (they
apply to Preview as well, since both modes share the unified
topology).

(v12 estimate is shorter than v11 because the relay
validation work moved to Phase 1. The remaining Phase 2H
delta is policy-only.)

- **Policy delta — content decoding + self-contained HTML.**
  Activate the Phase 1 scaffolds. Reject MIME mismatch,
  base64-decode `blob` under `MCP_APPS_MAX_HTML_BYTES`,
  UTF-8 validate, pick the matching `contents[]` entry,
  run the self-contained-HTML validator.
- **Policy delta — `MCPAppLaunchManifest` review +
  pinning.** First-launch review computes `manifestHash`
  and stores it in `MCPResourceReview`. Subsequent launches
  pin against the manifest. Default advisory; hard refuse
  when `MCP_APPS_HASH_PINNING_REQUIRED=true`. Divergence
  covers HTML, sandbox flags, permissions, network policy,
  URI, and trust-policy version. Persistence stays minimal:
  `manifestHash`, normalized manifest summary, timestamps,
  and just enough metadata to explain why a re-ack is
  required.
- (Note: `connect-src 'none'` already lands in Phase 1
  for both modes per v13 / v14, so it is **not** a
  Phase 2H delta. The Hardened-specific `connect-src`
  delta from v11 has been absorbed into the Phase 1
  unified authoring profile. This entry is intentionally
  retained as a no-op marker so reviewers tracking the
  v11 delta know it has moved up.)
- **Policy delta — Wasm + eval exclusion.** CSP omits
  `wasm-unsafe-eval` and `'unsafe-eval'`. Browser blocks
  `WebAssembly.instantiate(...)`, `eval(...)`, and
  `new Function(...)` at runtime. Hardened tests assert.
- **Policy delta — fullscreen stripped.**
  `displayMode="fullscreen"` is rejected by the host;
  `availableDisplayModes` reports `["inline"]` regardless
  of `appSettings.allowFullscreen`. Re-evaluated post-v1
  once trust-chrome-under-fullscreen is validated.
- **Policy delta — full legacy renderer retirement.** When
  `MCP_APPS_MODE="hardened"`, the `UIResourceRenderer`
  import is no longer reachable from any surface (chat,
  share, search, plugin). Tests assert this across every
  entry point.
- **Replacement delta — `mcp_app` artifact extension is
  written** by Hardened launches: `manifestHash` and
  `authContextHash` are populated on the existing artifact
  attached by upstream PR #11799. Re-opening the
  conversation rehydrates by walking artifacts and replaying
  the launch lifecycle against the same `manifestHash`.
  Divergence surfaces "this app has been updated" with a
  one-click re-acknowledge action; manifest is re-pinned.
  No new collection. Still narrow: no view-internal state.
- **Replacement delta — trust chrome mandatory.**
  `_meta.ui.prefersBorder=false` is ignored. Border +
  identity chrome must remain visible. Hardened v1 strips
  fullscreen entirely (`displayMode="fullscreen"` rejected
  by the host) until the trust-chrome-under-fullscreen
  validation lands.
- **Replacement delta — `_meta.ui.domain` rejection** with a
  clear error message in the review pipeline.
- **`ui/resource-teardown`** wait timeout
  (`MCP_APPS_TEARDOWN_WAIT_MS`); on timeout, force-remove
  the iframe and log.
- **End of phase**: enable Hardened GA capability
  advertisement when `MCP_APPS_MODE="hardened"` and
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
  - **Shared in-process fan-out poller (node-local
    dedup).** A single backend poller per
    `(taskId, authContextHash)` runs while at least one
    subscriber exists; subscribers (mounted view, open jobs
    panel, active conversation) connect to an in-process
    channel and receive fan-out updates. When subscriber
    count drops to zero, the poller stops; the task
    continues server-side. On user return, a new poller
    starts on first subscribe. Per-subscriber loops are an
    anti-pattern in this design.
    **Scaling caveat (v1):** deduplication is **node-local**.
    In horizontally scaled deployments, each API process
    runs its own poller for the same task if it has its
    own subscribers; this is fan-out per process, not
    globally once. Operators who need globally-once polling
    use sticky sessions (so a given user's subscribers
    land on the same node) or wait for the post-v1
    distributed coordination layer. Documented as a
    deployment contract.
    `tasks/result` is invoked **only** on explicit detail
    entry or explicit "wait for result". There is **no
    opportunistic save**: a task that reaches terminal
    while the user is present does **not** trigger an
    automatic `tasks/result`. No API-process background
    poller. Opening the jobs panel never eagerly fetches
    `tasks/result` for terminal rows.
  - **"Wait for result" is a UI mode on top of the shared
    poller (v13).** When the user clicks "wait for
    result" on an in-flight task, the UI switches to a
    waiting state and the shared poller keeps running.
    On the first terminal status the host issues exactly
    **one** `tasks/result` to fetch the envelope. There
    is no blocking-waiter, no concurrent wait/poll
    duality, and no dedicated wait-restart state machine
    on session loss — re-init during polling uses the
    standard outstanding-task revalidation path.
  - **Implicit wait-mode for model-started required tasks
    (v14).** When the agent invokes a tool with
    `taskSupport: "required"` during a chat turn, the
    host defaults the originating turn into the same
    "wait for result" UI state described above. The
    chat surface shows a waiting indicator, the shared
    poller continues at `pollInterval`, and on the first
    terminal status the host issues exactly one
    `tasks/result` and returns the envelope on both the
    model path (truncated with marker if oversize) and
    the chat surface (hard-fail with chrome error if
    oversize, per v14 view-path rule). Implicit wait
    does **not** apply to tasks created from inside a
    mounted app view (those keep status-only semantics
    and the view receives `tool-result` directly when
    terminal); does **not** apply to manually re-opened
    detail rows on prior turns. Without this rule, a
    model-started long-running tool would terminate
    server-side without the result ever reaching chat
    unless the user manually clicked detail.
  - **`input_required` parks the poller (v14).** When
    a task transitions to server-reported
    `status: "input_required"`, the shared poller stops
    issuing further `tasks/get` for that task. The UI
    surfaces the unsupported-lifecycle chrome (decision
    26); cancel remains available **only** when the
    server advertises `tasks.cancel` (decision 29). The
    user can manually refresh, which issues a single
    `tasks/get`; if the server is still in
    `input_required`, parking resumes. The Tasks spec
    says requestors should poll until terminal **or
    until `input_required`**, so parking is the correct
    termination condition; v1 does not synthesize an
    `tasks/result` call against an `input_required`
    task because LibreChat cannot satisfy elicitation
    or sampling.
  - **Subscriber registry is in-memory per connected session.**
    On reconnect, subscribers re-register and reload from
    `tasks/get` via the shared poller. No durable subscriber
    state.
  - **`MCPTask` is metadata only (v12).**
    Stores task metadata indexed by
    `(authContextHash, userId, mcpServerId, taskId,
    sessionId, status, hostHandlingState, createdAt,
    lastUpdatedAt, ttl, pollInterval, progressToken,
    modelImmediateResponse, lastSeen,
    correlationConversationId, serverTasksCapabilities)`.
    There is **no** cached terminal response/error
    envelope; on detail entry or explicit wait the host
    calls `tasks/result` **live** every time. The
    derived `expiresAt = createdAt + ttl` field (v14) is
    written at task creation; a single-field MongoDB TTL
    index on `expiresAt` (`expireAfterSeconds: 0`)
    removes stale metadata rows on the background
    monitor's cadence. Application reads check
    `now < expiresAt` directly to avoid race-edge
    inconsistency. **No** request-envelope persistence,
    **no** blob offload, **no**
    semantic-equivalence rehydration, **no** durable
    subscriber state, **no** progress checkpointing.
    `serverTasksCapabilities` records the negotiated
    `tasks.list` / `tasks.cancel` sub-capabilities for
    capability-conditional UX.
  - **`tasks/result` is forwarded live (v12).** Removed the
    rehydration step. The host issues `tasks/result`
    against the server on detail entry or explicit wait,
    forwards the live envelope to the requester (model
    path: stripped per the data-boundary helpers; view
    path: full envelope including `_meta`). The server is
    the single source of truth and may answer "task
    expired" past `createdAt + ttl`.
  - Strict related-task metadata rules:
    - Add on all task-related requests, notifications, and
      responses *except* on `tasks/get` / `tasks/result` /
      `tasks/cancel` **requests**.
    - **Add on `tasks/result` response.**
  - **Cancellation after terminal returns `-32602`** invalid
    params. UI disables the cancel button on terminal tasks; if a
    race produces a late cancel, surface as a no-op.
  - **`input_required` handling**:
    - Persist server-reported `status: "input_required"`
      unmodified.
    - Set `hostHandlingState = "unsupported_lifecycle"`.
    - Surface in running-jobs UI with a **named "Unsupported
      lifecycle" state**, not "failed" / "error" copy.
      Default copy: "This task is waiting for interactive
      input that LibreChat cannot provide yet." The chrome
      explicitly distinguishes this state from a server-side
      failure so users do not file bug reports against the
      server author.
    - Do not invoke `tasks/result` on it (the spec says
      requestors should preemptively call `tasks/result`;
      v1 deliberately diverges — see decision 26).
    - Do not fabricate a `failed` envelope.
    - Allow `tasks/cancel` on user request **only** when the
      server advertises `tasks.cancel` (capability-conditional
      UX, v12). When `tasks.cancel` is absent, no cancel
      button is rendered and the user is documented to
      contact the server author.
    - Operator docs ship a named "Unsupported lifecycle
      states" section that enumerates this profile so
      server authors can recognize the subset.
  - **`authContextHash` binding** at task creation; verify on
    every retrieval. `tasks/list` is filtered by current
    `authContextHash` (and is only invoked at all when the
    server advertises the `tasks.list` sub-capability, per
    decision 29). Tasks created under a prior auth-relevant
    configuration become invisible (and unfetchable) when
    any field of the v13 derived `authConfigSnapshot`
    changes (server URL, transport type, OAuth issuer/
    client_id/scopes, API key reference, credential
    mapping policy), or when the user's identity changes,
    or when `oauthSubject` or `apiKeyFingerprint` rotates.
  - **Streamable HTTP only.** Persist `MCP-Session-Id` per task.
    HTTP 404 → start a new MCP session, **revalidate
    outstanding `taskId`s via `tasks/get`** (this work moved
    from Phase 0 to here in v7 because it is Tasks-specific).
    Treat "task not found" as terminal-with-error.
  - **Session loss during polling (v13).** Because v13
    has no blocking-waiter, session loss during the
    "wait for result" UI state is the same case as
    session loss during normal polling: the host
    re-initializes, runs the standard outstanding-task
    `tasks/get` revalidation against the new session, and
    resumes polling. There is no dedicated re-init/retry
    budget for waits and no risk of duplicate concurrent
    waiters.
  - **Capability-conditional Tasks UX (v12).** The host
    persists negotiated `tasks.list` / `tasks.cancel`
    capabilities on `MCPTask` and on the in-process
    server-capabilities cache. The jobs panel renders a
    cross-session global view **only** for servers that
    advertise `tasks.list`; servers without it surface a
    per-conversation jobs view (locally tracked handles
    only) instead. The cancel button is **not rendered**
    for servers without `tasks.cancel`.
  - **Metadata reads check expiry.** Any read from the
    `MCPTask` metadata (jobs panel, detail view) checks
    `createdAt + ttl`. Expired rows are surfaced as
    expired (no cached payload exists in v12). On detail
    entry the host issues `tasks/result` live; the server
    may legitimately return "task expired".
- `progressToken` correlated by the related-task meta and routed
  through the bridge to active subscribers. **No durable
  subscriber registry**; subscribers are session-scoped.
- **`model-immediate-response` runtime (v13: model plumbing
  only)**:
  - When present, the agent passes the server-supplied
    string into the model context as the immediate tool
    result for the in-flight task call. This matches the
    spec's narrow scope for the provisional metadata
    field.
  - The host does **not** emit an assistant-visible
    placeholder message, does **not** suppress the model
    for the turn, and does **not** stage a separate
    "final result" message that overwrites a placeholder.
  - When absent, the model receives a neutral
    "task-in-progress" string that the agent loop owns.
  - Users see standard task-card chrome in the
    running-jobs UI; final results render via the same
    task-card flow when the task terminates.
- Frontend running-jobs surface in
  `client/src/components/SidePanel/`: cursor-paginated, status
  badges, **status-only by default** (no progress bars in
  v1 — those reuse upstream PR #12535 once it lands and is
  not a Phase 4 dependency), **capability-conditional UX**:
  the cross-session global panel is shown for servers that
  advertise `tasks.list`; servers without it surface only
  a per-conversation handles view. The cancel button is
  rendered **only** for servers that advertise
  `tasks.cancel` and is disabled for terminal and
  `input_required` states even when present. Deep-link to
  originating conversation. Localize under
  `com_ui_mcp_task_*`. The `progressToken` is still
  correlated and propagated through the bridge to mounted
  views; the SidePanel just doesn't render progress bars
  itself in v1.
- **Tasks feature flag** (`MCP_TASKS_ENABLED`) added; OFF by
  default. Independent of `MCP_APPS_MODE` enum and
  `MCP_APPS_MODE="hardened"`. Tasks may ship before, after,
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

## Worked example: CAD generative-design app (Hardened mode)

The app is **one predeclared `ui://cad-app` resource** linked from a
single `cad.workbench` tool. The same view persists for the entire
session and refreshes itself by calling other CAD-server tools as
the user navigates. This walkthrough assumes
`MCP_APPS_MODE="hardened"`. The Preview path is identical except
that the inner CSP permits Wasm and `eval` and (when
`appSettings.allowFullscreen`) fullscreen is offered; the
authoring profile is the same in both modes (v13).

The B-Rep kernel **runs server-side** in this design. The
browser receives only pre-tessellated GLTF + face IDs as
`structuredContent`, which Three.js renders inline without
`eval`, `new Function`, or Wasm. This is necessary for
Hardened v1: the CSP forbids Wasm-unsafe-eval and
unsafe-eval, so a browser-side WASM B-Rep kernel would fail
to instantiate.

1. User runs the CAD MCP server. The `cad.workbench` tool's
   definition carries `_meta.ui.resourceUri = "ui://cad-app"`.
   The view bundle is **Three.js inline** (with shader source
   compiled at build time to avoid runtime `Function`
   construction) — no `<script src>` to a CDN, no
   `<link href>` to a font host, no Wasm. The host fetches
   the resource server-side via `resources/read`; the content
   pipeline validates MIME (`text/html;profile=mcp-app`),
   decodes (`text` or `blob`), UTF-8 validates, runs the
   self-contained-HTML validator, builds the
   `MCPAppLaunchManifest`, and computes `manifestHash`. With
   the manifest auto-allowed (or pinned), the host injects
   the strict `<meta>` CSP (`connect-src 'none'`) and sends
   `sandbox-resource-ready`. The host instantiates a fresh
   per-instance proxy iframe (outer
   `sandbox="allow-scripts allow-same-origin"`, inner sandbox
   without `allow-same-origin`), runs the construction-order
   sequence, and waits for the relayed `ui/initialize`. On
   success the inner iframe is alive and the bridge is open;
   on timeout, schema failure, or nonce failure the host
   falls back to a text-only summary and explains why. The
   `mcp_app` artifact upstream attaches to the message is
   extended with `manifestHash` and `authContextHash`,
   so re-opening this conversation later re-renders the app
   off message-history artifacts without storing anything in
   model context.
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
   ID 12345 — results in ~30 minutes". Because this call was
   issued from inside a mounted app view (not from the agent
   on a chat turn), v14's implicit-wait default does **not**
   apply; the view receives standard `tool-result`
   notifications when the task terminates and updates its
   own UI accordingly. The `model-immediate-response` is
   fed into the model as the immediate tool result for the
   call (v13 — model plumbing only); the user sees a
   standard task card in the running-jobs UI, not a
   separate assistant placeholder turn.

   (Contrast: if the same `cad.submit_job` had been
   invoked by the model in a normal chat turn — for
   example, the user wrote "submit my CAD job for me" —
   v14's implicit wait-mode default would put the chat
   turn into a waiting state and the host would issue
   one `tasks/result` on the first terminal status,
   returning the envelope on the chat surface. The
   in-app path here keeps the user in the app view
   instead.)
6. The view transitions to a "job status" panel — same `ui://`
   resource. While mounted, the panel polls. After the user
   closes the chat, polling stops; the task continues
   server-side.
7. User comes back. Because the CAD server advertises
   `tasks.list` and `tasks.cancel`, the host renders the
   cross-session jobs panel and a cancel affordance for
   in-flight rows. The panel calls `tasks/list` (filtered
   by `authContextHash`). The panel is status-only and does
   not eagerly call `tasks/result`. The task row shows
   `completed` and a TTL countdown. The user clicks "open
   detail", at which point the host issues one **live**
   `tasks/result` against the server (v12/v13 — no cache,
   no rehydration). The envelope's structured content
   carries an **artifact handle** (`{ artifactId,
   objectKey }`), not a presigned URL — presigned URLs are
   time-limited and would already be dead. If the user had
   returned past `createdAt + ttl`, the server may
   legitimately answer "task expired" and the user sees a
   clear notice instead of stale data. When the user
   clicks Download, the view calls a
   `cad.get_download_url(artifactId)` MCP tool that mints
   a fresh short-TTL presigned URL; the view then opens
   it via `ui/open-link` against the host navigation
   allowlist.

   If the user had clicked "wait for result" while the
   task was still in-flight, the v13 path is: the UI
   shows a waiting state, the shared `tasks/get` poller
   keeps running, and on the first terminal status the
   host issues exactly one `tasks/result` to fetch the
   envelope — no blocking-waiter, no concurrent
   wait/poll.

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
  authors (both modes, v13).** Both Preview and Hardened
  forbid external scripts, styles, fonts, images, and
  frames; both block direct browser networking. App
  authors target one profile and ship inline-bundled
  assets. The trade is loss of supply-chain attack surface
  and a clean migration path between modes.
- **No direct browser networking in either mode (v13).**
  v1 cuts in-app `fetch` / XHR / WebSocket from view JS in
  both Preview and Hardened. The bridge (`tools/call` /
  `resources/read` / `ui/open-link`) is the only network
  path. Apps that depend on credentialed direct browser
  networking expose those calls as MCP tools on their own
  server. Re-introducing reliable `connect-src` is
  post-v1 and depends on a stable-origin design.
- **`model-immediate-response` is model plumbing only
  (v13).** The provisional metadata field is fed into the
  model's tool-result context as the spec narrowly
  envisions; v1 does not turn it into an assistant-visible
  placeholder turn or apply any agent-loop suppression
  rules. UX risk: server authors who expected a
  user-visible "your job is queued" assistant message
  will not see one. Operator docs explain the contract.
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
- **Inheritance risk: PR #11799 is not a clean drop-in.**
  v11 acknowledges this explicitly. The May 2 401 sandbox
  bootstrap bug is one example of "looks inherited on
  paper, breaks in product"; there will likely be others.
  v11 treats #11799 as a local patchset: vendor the schemas,
  pin a commit SHA, replace the data-URL outer iframe with
  the static `MCP_SANDBOX_ORIGIN` proxy in Phase 1, and
  gate Preview release on a green authenticated end-to-end
  test. If #11799 stalls or is rejected upstream, the plan
  still cherry-picks; that doubles upstream-sync cost but
  does not block shipping Preview.
- **Tasks dedup is node-local in v1.** Operators running
  multiple API processes without sticky sessions will see
  one `tasks/get` poller per process per task per
  authContextHash with active subscribers — i.e. dedup
  fan-out is per process, not globally once. Documented as
  a deployment contract; sticky sessions or a post-v1
  distributed coordination layer give globally-once
  polling.
- **Vendored Apps schemas can drift from upstream.** v11
  vendors the generated TypeScript types and JSON Schemas
  into the repo for the stable `2026-01-26` spec.
  Upstream will continue evolving (`ui/download-file` is
  already on `main`). Planned mitigation: a quarterly
  review PR that diffs vendored schemas against upstream
  and intentionally either pulls in the changes or notes
  why they are deferred. Drift is intentional; surprise
  drift is what the vendoring guards against.
- **Lazy remount can hide errors at scroll.** Because
  remount runs only when a placeholder enters the
  viewport, manifest-divergence notices and resource-fetch
  failures appear progressively as the user scrolls
  rather than all at once on conversation open. This is
  the right product trade for long threads but will
  occasionally surprise operators looking for problems.
  Logging captures every hydration attempt with timing
  and outcome.
- **Operational limits may surprise app authors.**
  `MCP_APPS_MAX_HTML_BYTES = 2 MiB` rules out giant
  pre-bundled apps; rate limits cap chatty views. Limits are
  operator-tunable, but the defaults bias toward safety.
- **WebKit/Safari relay risk handled by runtime probe.** No
  user-agent allow/deny list. The probe runs on every mount;
  when WebKit fails it, the user sees a clear text-only
  fallback message. If upstream lands a fix, support resumes
  automatically without a code change.
- **No host-side terminal-result cache (v12).** Removing
  the cache simplifies the retention surface but makes
  every detail-entry / explicit-wait click a live
  `tasks/result` round-trip. If repeat fetches become a
  product-perceptible latency or load issue, caching can
  be re-introduced later behind the metadata model. The
  jobs panel surfaces TTL so users can see when a result
  will expire and explicitly fetch it before then. Past
  TTL the server may legitimately respond "task expired"
  and the host surfaces that without inventing a fallback.
- **`authContextHash` invalidation can hide tasks.** If a user
  rotates credentials or an operator changes any
  **auth-relevant** snapshot field (server URL, transport
  type, OAuth issuer/client/scopes, API key reference,
  credential mapping policy), tasks created under the prior
  context become invisible by design. v13's derived snapshot
  replaces v12's `authRevision` counter so the trigger is
  structural rather than procedural; cosmetic edits cannot
  orphan tasks. The UI must still explain the invalidation
  rather than show an empty list as if no tasks exist;
  otherwise the user thinks the system silently dropped
  their work.
- **Tasks UX is capability-conditional.** v12 does not
  promise a global jobs panel against servers that do not
  advertise `tasks.list`, and does not render cancel
  controls against servers that do not advertise
  `tasks.cancel`. App-affordance UX therefore varies by
  server. Operator docs explain why; the chrome labels the
  per-conversation handles view as such so users do not
  expect cross-session recovery on capability-limited
  servers.
- **No blocking `tasks/result` waiter in v1 (v13).**
  "Wait for result" is implemented on top of the shared
  poller; the host issues `tasks/result` once on the first
  terminal status. Latency cost: at most one
  `pollInterval` of additional completion delay. Code cost
  saved: an entire wait-restart state machine and the
  concurrent wait/poll edges that come with it. If a
  future use case demands sub-`pollInterval` wait latency,
  a blocking waiter can be added behind a flag with its
  own restart contract.
- **Implicit wait-mode for model-started required tasks
  (v14).** Without this default, model-started long-
  running tools terminate without their result reaching
  chat unless the user manually opens detail or wait.
  v14 makes implicit wait the chat-turn default; risk:
  if `pollInterval` is large, the chat surface can sit
  in a waiting state for a while. Operator docs explain
  the trade and the `pollInterval` floor; user-facing
  chrome makes the wait state visible (status badge,
  optional cancel where supported).
- **MCP capability profile marker (v14).** Servers that
  ignore the marker and continue to register tools with
  external-asset or `connectDomains` metadata still get
  text fallback at review time, but the failure point
  is later than ideal. Operator docs explain the marker
  and its semantics; the host logs every tool that hits
  text fallback because of disallowed metadata so server
  authors can find and fix their registrations.
- **Native-navigation behavior under sandbox + `srcdoc`
  (v14).** Apps that try to use `<form>` for submission,
  `<meta http-equiv="refresh">` for redirects, or
  `target="_blank"` anchors will be rejected at review
  time. Apps that try to use `window.location =` or
  programmatically constructed anchors are caught by
  the proxy's anchor click interceptor at runtime.
  Operator docs spell out the supported navigation
  surface (`ui/open-link` only).
- **Lossy truncation has been removed from the view path
  (v14).** Apps and Tasks specs both define the view-
  bound payload as a contract-faithful envelope; v14
  refuses to deliver an oversize partial envelope rather
  than break that contract. Risk: a server that
  consistently exceeds the cap will see its app fail
  to render. Mitigation: the host-chrome error names
  the cap and suggests artifact-handle or follow-up-
  resource patterns the worked example demonstrates.
- **TTL deletion is approximate (v14).** v14 fixes the
  v12/v13 misuse of MongoDB TTL indexes by deriving
  `expiresAt` and using a single-field index, but TTL
  deletion is performed by a background monitor on its
  own cadence. UI and tests must check `now < expiresAt`
  directly rather than rely on the monitor for read-
  edge consistency.
- **`authContextHash` is now a derived snapshot (v13).**
  The ownership invariant is structural — auth-relevant
  config edits change the hash; cosmetic edits do not.
  Risk: the snapshot's "what counts as auth-relevant" rule
  is set at one place (`packages/data-schemas`); a
  schema change that adds a new auth-relevant field
  without updating the snapshot definition could leak
  cross-context access until the schema is updated. The
  unit-test corpus tests for sensitivity to each field
  individually so adding a field without updating the
  snapshot definition fails CI.
- **Remount is not state preservation.** The extended
  `mcp_app` artifact guarantees the view re-renders against
  the same approved bytes. It does **not** preserve internal
  state — selection, scroll, in-flight SPA navigation are
  all gone. Apps that need state durability persist it on
  their own MCP server.
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
- `authContextHash` computed at connection time over the v13
  derived `authConfigSnapshot` plus identity inputs;
  immutable across the connection's lifetime; auth-relevant
  changes invalidate task ownership; **OAuth refresh does
  not change the hash**; **cosmetic config edits (display
  name, description, icon, docs, default UI settings,
  fallback height) do not change the hash**;
  **auth-relevant edits (server URL, transport type,
  OAuth issuer/client/scopes, API key reference,
  credential mapping policy) do change the hash**.
- (Regression-only) 307/308 redirect handling and credential
  stripping on cross-origin redirects: spot-check that public
  `main` behavior has not regressed.

### MCP Apps

Tests are tagged **[P]** (Preview), **[H]** (Hardened GA), or
**[A]** (both). Some tests have different shapes per track and
are listed twice.

- **[A]** Capability negotiation truthfully gated by
  `MCP_APPS_MODE` (none when `"disabled"`; Preview when
  `"preview"`; Hardened when `"hardened"`).
- **[A]** Discovery: tool `_meta.ui.resourceUri` for a
  resource omitted from `resources/list` still renders;
  resource without `_meta.ui` falls back to text.
- **[A]** Surface matrix:
  - With `MCP_APPS_MODE="preview"` or `"hardened"`,
    share / search / plugin surfaces never mount the new
    Apps path; they always render text. The new Apps path
    only renders on the live chat surface.
  - With `MCP_APPS_MODE="disabled"`, every surface uses
    the legacy renderer (no Apps path mounts at all).
  - There is **no** mode in which both paths render the
    same message.
- **[A]** Default `sandboxPermissions=''` on the legacy
  renderer regardless of mode. Test asserts no entry
  point still uses `'allow-popups'`.
- **[P], [H]** Full retirement of `UIResourceRenderer`
  import reachability. With
  `MCP_APPS_MODE !== "disabled"`, no surface (chat,
  share, search, plugin) can mount the legacy renderer
  for resources carrying `_meta.ui.resourceUri`. Tree-
  shake / module-graph test asserts the legacy renderer
  is not exercised.
- **[A]** Flag enum validation: `MCP_APPS_MODE` accepts
  only `"disabled"`, `"preview"`, `"hardened"`; deprecated
  `MCP_APPS_ENABLED=true` maps to `"preview"` with a
  warning; other deprecated values are ignored. No
  combination produces an impossible state.
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
- **[A] Self-contained-HTML validator (both modes, v13)**:
  HTML containing **any** `<script src>` (relative or
  absolute), `<link href>`, `<img src>` to a non-`data:`
  URL, `<iframe src>`, `<object>`/`<embed>`, remote
  `<source>`/`<track>`/`<video>`/`<audio>` URL, or
  `<base>` is rejected at review time in both Preview
  and Hardened. Inline `<script>` and `<style>` are
  accepted; `data:` images are accepted. The validator
  does **not** statically analyze inline JS for dynamic
  imports, `fetch`, `eval`, or `WebAssembly.instantiate`;
  those are runtime CSP concerns (v13 simplification).
- **One proxy iframe per app instance**: a conversation with N
  app messages renders N proxy iframes, not one shared proxy.
  Teardown of one instance does not affect siblings.
- **`mcp_app` artifact extension**: a successful Hardened
  launch populates `manifestHash` + `authContextHash` on the
  inherited message artifact. Reopening the conversation
  re-renders the view by replaying the launch lifecycle off
  message-history artifacts without writing to model
  context; manifest divergence shows the "app updated"
  notice. No separate `MCPAppInstance` collection exists.
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
- **[A] CSP `connect-src 'none'` enforcement (both modes,
  v13)**: any in-app `fetch` / XHR / WebSocket attempt is
  blocked by the browser. The view must route network
  access via `tools/call`, `resources/read`, or
  `ui/open-link`. Test asserts that even a server
  explicitly setting `connectDomains` does **not** install
  any `connect-src` origin in the rendered CSP — the
  field is parsed but ignored in both modes.
- **[A] MCP capability profile marker (v14)**: at MCP
  initialize, the host advertises
  `capabilities.experimental["io.modelcontextprotocol/ui"].profile
  = "librechat-self-contained"` (or operator-elected
  variant). At `ui/initialize`, the host advertises
  `hostCapabilities.experimental.profile` to the same
  value. A fixture server reads the marker at MCP init
  and suppresses `connectDomains` / `resourceDomains` in
  its tool registrations; a second fixture server
  ignores the marker and registers a tool with
  `connectDomains` set, and the host falls back to text
  for that tool with a clear chrome message.
- **[A] Anchor click interceptor + form rejection (v14)**:
  - Validator rejects HTML containing `<form action>`,
    `<form method>`, `<meta http-equiv="refresh">`,
    `target="_blank"`, or `target="_top"`.
  - Runtime: a fixture page with a programmatically
    constructed `<a href="https://example.com">` triggers
    the proxy's anchor click interceptor; the URL is
    forwarded to the host as `ui/open-link`; the host
    applies the navigation allowlist; the inner iframe
    does not navigate.
  - Runtime: a fixture page that calls
    `window.location = "https://attacker.example"` is
    blocked because the inner sandbox set excludes
    `allow-top-navigation` and the inner iframe is the
    only navigable frame.
- **[A] Hard-fail oversize on view path (v14)**: a
  fixture tool that returns a >8 MiB
  `CallToolResult.content` causes the host to refuse
  rendering on the view path and surface a chrome
  error; no truncated envelope reaches the view. The
  same test asserts the model path receives a
  truncate-with-marker version (model-side concession).
- **[H] Wasm exclusion (Hardened)**: a fixture page that
  calls `WebAssembly.instantiate(...)` is rejected by the
  CSP at runtime (`script-src 'unsafe-inline'` without
  `wasm-unsafe-eval`). The host logs the violation; the
  view sees the failure and can degrade gracefully.
- **[H] `eval` exclusion (Hardened)**: a fixture page
  that calls `eval('1+1')` or `new Function('return 1+1')()`
  is rejected by the CSP at runtime (no `'unsafe-eval'`).
- **[P] Wasm and `eval` permitted (Preview)**: the same
  fixtures succeed in Preview because the Preview inner
  CSP adds `wasm-unsafe-eval` and `'unsafe-eval'` to
  `script-src`. The Preview-vs-Hardened test matrix
  makes the difference visible.
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
    `MCP_APPS_MAX_TOOL_RESULT_BYTES_TO_VIEW` **hard-fails
    on the view path** (v14): the host refuses to deliver
    a partial envelope, surfaces a chrome error
    (suggesting an artifact handle or follow-up
    resource), and logs the decision. Model-path
    truncation with a marker is unaffected on the model
    path.
  - Live `tasks/result` envelope over
    `MCP_TASKS_MAX_RESULT_FORWARD_BYTES` is truncated with
    a marker on the model path; on the view path it
    **hard-fails the render** (v14) with the same chrome
    message as oversize `tool-result`. Nothing is
    persisted on either path (no cache in v12+).
  - `ui/resource-teardown` honored within
    `MCP_APPS_TEARDOWN_WAIT_MS`; otherwise iframe is
    force-removed.
  - View exceeding `MCP_APPS_VIEW_RPC_RATE_PER_MIN` /
    `MCP_APPS_VIEW_NOTIF_RATE_PER_MIN` is paused with a
    chrome message.
- **Content decoding**: `text` and `blob` payloads both
  succeed; oversize `blob` rejected; non-`text/html;profile
  =mcp-app` MIME falls back to text. Multi-content
  `resources/read` responses are accepted: the host
  requires **exactly one** matching `(uri, mimeType)`
  `contents[]` entry (v13). Zero matches errors; **two
  or more matches errors**; non-matching siblings are
  logged at info level and ignored.
- **[A] Exactly-one-match `contents[]` rule (v13)**: a
  fixture server that returns two `contents[]` entries
  with the same declared `(uri, mimeType)` triggers a
  review-time error with a clear "duplicate matching
  HTML entry" message. A fixture with one match plus
  several non-matching companion entries succeeds.
- **[A] Bootstrap trust health check (v13)**: at boot,
  the host fetches `proxy.html` from
  `MCP_SANDBOX_ORIGIN` and refuses to enable Apps
  capability advertisement when any of the required
  response headers (`frame-ancestors`,
  `Cross-Origin-Resource-Policy`, no-cache
  `Cache-Control`) is missing. Tests cover each missing
  header and assert the failure mode.
- **[A] Sandbox proxy fail-closed bootstrap (v13)**: the
  proxy refuses to initialize when the `host-bootstrap`
  postMessage is absent within
  `MCP_APPS_INITIALIZE_TIMEOUT_MS`, when it arrives from
  any origin other than the configured LibreChat
  application origin, and when its payload is malformed.
  Tests assert this on Chromium, Firefox, and
  WebKit/Safari. A fixture deliberately attempts to use
  `document.referrer` as the host origin and verifies
  the proxy does not consume it.
- **[A] Required text fallback (v13)**: a server that
  returns empty `content` plus a `_meta.ui.resourceUri`
  causes the host to render the generic "App is
  unavailable on this surface" card built from
  `toolInfo`. The card renders identically across:
  - non-chat surfaces (share, search, plugin),
  - failed `ui/initialize` relay probes,
  - browsers that fail the runtime relay self-test,
  - bootstrap trust health-check failures.
  Hardened additionally renders the same card when the
  manifest fails review or hash pinning refuses.
- **Manifest hash determinism**: shuffling JSON key order
  in any manifest field yields an identical
  `manifestHash`; modifying any covered field changes it.
- **Trust chrome mandatory**: a resource declaring
  `prefersBorder: false` still renders inside host chrome.
- **Legacy renderer gating**:
  - With `MCP_APPS_MODE` in `"preview"` or `"hardened"`,
    every chat entry point routes UI-resource messages to
    the Apps path; share, search, and plugin-rendered
    surfaces render text — neither hits
    `UIResourceRenderer`.
  - With `MCP_APPS_MODE="disabled"`, the legacy path's
    default `sandboxPermissions` is `''`, not
    `'allow-popups'` (deny-default applies in every mode).
  - Hardened additionally enforces tree-shake
    unreachability: a module-graph test asserts the
    `@mcp-ui/client` `UIResourceRenderer` import is not in
    the rendered bundle when
    `MCP_APPS_MODE="hardened"`.
- **Sizing fallback**: with no `size-changed` notification, the
  view renders at the operator-configured fallback height; once
  a non-zero `size-changed` arrives the host honors it; the
  `shrinkWrap: false` opt-out pins the view at the fallback
  height even if the SDK suggests shrinking.
- First-launch resource review: `manifestHash` stored;
  manifest divergence (HTML, sandbox, permissions, network
  policy, URI, or trust-policy version) refused at next
  launch when `MCP_APPS_HASH_PINNING_REQUIRED=true`. In
  advisory (default) mode (v12) the host **auto-repins**
  to the new manifest, renders, and surfaces a host
  banner naming server, manifestHash short-prefix, and
  what changed; there is no blocking re-acknowledge
  click in advisory mode. Tests assert both modes.
- **Data boundary — model path**: `structuredContent` and
  `_meta` never appear in model-bound serialization, including
  across live `tasks/result` forwarding.
- **Data boundary — view path** (Phase 1 / Preview gate,
  v12): `_meta` (including
  `io.modelcontextprotocol/related-task` and server-defined
  keys outside the reserved namespace) is preserved on
  `ui/notifications/tool-result` to the view, and on
  view-path live `tasks/result` forwarding. A regression
  test fails if the inherited bridge drops `_meta`. This
  is verified in Preview, not deferred to Hardened.

### MCP Tasks

- Per-tool `taskSupport: required` rejects synchronous calls.
- Per-tool `taskSupport: forbidden` rejects task-augmented calls.
- v1 augmentation policy: only `required` tools become tasks;
  `optional` and `forbidden` run synchronously. No operator
  allowlist promotes `optional` to task.
- **Independent feature flags**: `MCP_APPS_MODE="preview"`
  with `MCP_TASKS_ENABLED=false` advertises Apps capability
  without Tasks capability; the inverse also works; same
  for `MCP_APPS_MODE="hardened"`.
- **`tasks/result` response carries `related-task` meta**.
- `tasks/get`/`result`/`cancel` requests with the meta present:
  receiver ignores meta, uses param.
- **Cancellation after terminal status returns `-32602` invalid
  params**. UI disables the cancel button on terminal tasks.
- **Capability-conditional UX (v12)**:
  - For a server advertising both `tasks.list` and
    `tasks.cancel`: jobs panel renders cross-session view,
    cancel button rendered (and disabled on terminal /
    `input_required`).
  - For a server advertising `tasks.list` but not
    `tasks.cancel`: jobs panel renders, cancel button is
    **not rendered** for that server's rows.
  - For a server advertising `tasks.cancel` but not
    `tasks.list`: cross-session global view does **not**
    list that server's tasks; per-conversation handles
    view shows them; cancel button rendered.
  - For a server advertising neither: per-conversation
    handles view only; no cancel control.
  - Negotiated capabilities persist on `MCPTask` rows and
    survive page reload.
- Cursor pagination of `tasks/list` traverses correctly
  for servers that advertise it; the test does **not** run
  for servers that do not advertise `tasks.list`.
- **Shared in-process poller**: when N subscribers (mounted
  view + jobs panel + chat tab) all subscribe to the same
  `(taskId, authContextHash)`, exactly **one** outbound
  `tasks/get` per `pollInterval` is observed; all N receive
  fan-out updates. When subscriber count drops to zero,
  the poller stops; no `tasks/get` is generated.
- **Per-subscriber loops are an anti-pattern**: a regression
  test asserts the implementation does not ever spawn one
  loop per subscriber (e.g. by counting outbound requests
  per subscriber attach).
- **No background poller**: with no subscribers, no
  `tasks/get` traffic is generated.
- **Jobs panel is status-only on open**: opening the panel calls
  `tasks/list` + `tasks/get` to refresh state and TTL, and does
  **not** call `tasks/result` for any row.
- **Detail entry triggers `tasks/result`**: opening a terminal
  task's detail row, or clicking "wait for result" on an
  in-flight task, calls `tasks/result` exactly once.
- **Poller-based wait UI (v13)**: clicking "wait for
  result" on an in-flight task does **not** issue a
  blocking `tasks/result` and does **not** suspend the
  shared poller. The UI switches to a waiting state; the
  shared poller continues at `pollInterval`; on the
  first terminal status the host issues exactly **one**
  `tasks/result` and resolves the wait. A test asserts
  no blocking `tasks/result` is in flight while the wait
  is active and that the terminal-trigger fetch happens
  exactly once. Latency: at most one `pollInterval` of
  additional completion delay.
- **Implicit wait-mode for model-started required tasks
  (v14)**: when the agent invokes a `taskSupport:
  "required"` tool during a chat turn, the originating
  turn enters wait-mode automatically; on terminal status
  exactly one `tasks/result` is issued and the envelope
  is delivered to both the model path (truncated marker
  if oversize) and the chat surface (hard-fail with
  chrome message if oversize). Tests cover: (a) terminal
  arrives during the same turn — result lands in chat;
  (b) terminal arrives after the turn closes — result
  still lands as a follow-up message correlated to the
  originating tool call; (c) view-mounted invocations of
  the same tool do **not** trigger implicit wait — the
  view receives `tool-result` directly.
- **`input_required` parks the poller (v14)**: a fixture
  task that transitions to `input_required` causes the
  shared poller to **stop** issuing further `tasks/get`.
  The unsupported-lifecycle chrome renders. Cancel is
  available only when the server advertises
  `tasks.cancel`. A user-triggered manual refresh issues
  exactly one `tasks/get`; if status is still
  `input_required`, the poller does not resume.
- **Derived `expiresAt` TTL (v14)**: `MCPTask` documents
  carry a derived `expiresAt = createdAt + ttl` field.
  A single-field MongoDB TTL index on `expiresAt` is
  configured with `expireAfterSeconds: 0`. Tests assert
  (a) the derived field is computed at write time and
  matches `createdAt + ttl`; (b) application reads check
  `now < expiresAt` directly (no reliance on TTL
  monitor for read-time consistency); (c) the TTL
  monitor eventually deletes expired rows but does not
  do so synchronously at the millisecond boundary.
- **No opportunistic save**: a subscribed task that
  transitions to terminal while the user is present does
  **not** trigger any `tasks/result`; the test asserts no
  such call is issued unless the user explicitly clicks
  detail or "wait for result".
- **No host-side cache (v12)**: `tasks/result` is **not**
  cached by the host. Every detail-entry / explicit-wait
  click issues a live `tasks/result` against the server.
  A test asserts the `MCPTask` row carries no terminal
  envelope after termination, and that two consecutive
  detail entries against the same terminal task issue two
  `tasks/result` calls. Past `createdAt + ttl` the server
  may legitimately answer "task expired"; the host
  surfaces that without inventing a fallback. The
  derived `expiresAt` single-field TTL index (v14)
  removes expired metadata rows on the background
  monitor's cadence; application reads check
  `now < expiresAt` directly because the monitor is not
  synchronous.
- Disconnect during polling → subscriber resubscribes after
  reconnect via `tasks/list` + `tasks/get`.
- HTTP 404 for `MCP-Session-Id` → new session,
  **outstanding-task revalidation** runs (Phase 4 work, not
  Phase 0): each known `taskId` is queried via `tasks/get` on
  the new session; "not found" becomes terminal-with-error.
- **Session loss during polling (v13, generalized from
  the cut wait-restart path)**: HTTP 404 on `tasks/get`
  triggers re-init and the standard outstanding-task
  revalidation; "not found" becomes terminal-with-error;
  the poller resumes against the new session. Because
  v13 has no blocking-waiter, the same test covers the
  "wait for result" UI state — no separate wait-restart
  state machine is required or asserted.
- `progressToken` propagates through bridge to active subscribers
  via in-memory mapping.
- `model-immediate-response` (v13: model plumbing only):
  the agent passes the server-supplied string into the
  model context as the immediate tool result for the
  in-flight task call. Tests assert: (a) the string
  reaches the model; (b) **no** assistant-visible
  placeholder turn is emitted; (c) the model is **not**
  suppressed for the same call; (d) the final task
  result renders as a normal task card, not as an
  overwrite of a placeholder turn.
- **`authContextHash` binding (v13 derived snapshot)**:
  `tasks/list` from a different context returns empty;
  `tasks/get` for another context's task returns
  not-found. A test mutates an **auth-relevant** field of
  the v13 `authConfigSnapshot` mid-flight (e.g. operator
  changes the server URL or rotates the OAuth client_id)
  and verifies the hash changes and prior tasks become
  invisible.
- **`authContextHash` OAuth-refresh invariance**: a test
  refreshes the OAuth access token mid-flight (without
  changing `oauthSubject` or any other identity field) and
  verifies `authContextHash` is unchanged and the
  in-flight task is still visible / fetchable. (v11
  regression guard against the v10 shape that included
  live bearer-token bytes.)
- **`authContextHash` cosmetic-edit invariance (v13)**:
  a test mutates cosmetic server config (display name,
  description, icon, docs, default UI settings, fallback
  height) and verifies `authContextHash` is unchanged
  and prior tasks remain visible / fetchable. v13's
  derived snapshot replaces v11's `configRevision`
  counter and v12's `authRevision` counter, so this
  test now asserts a **structural** invariant rather
  than a procedural one.
- **`authContextHash` per-field auth-relevance (v13)**:
  one test per snapshot field (server URL, transport
  type, OAuth issuer, OAuth client_id, OAuth scopes,
  API key reference, credential mapping policy) flips
  exactly that field and asserts the hash changes. A
  schema change that adds a new auth-relevant field
  without updating the snapshot definition fails the
  per-field test.
- **Shared in-process poller dedup**: with N subscribers
  on the same `(taskId, authContextHash)` in one process,
  exactly one outbound `tasks/get` is observed per
  `pollInterval`; all N receive fan-out updates.
  Cross-process dedup is **not** asserted (deliberately —
  it is a node-local contract; tests document the limit).
- **`tasks/result` is forwarded live (v12)**: there is no
  rehydration step. The host issues `tasks/result` against
  the server on detail entry / explicit wait and forwards
  the envelope to the requester. Tests assert: (a) the
  response is the server's envelope verbatim on the view
  path including `_meta` (with `related-task`); (b) the
  model path strips `structuredContent` and `_meta`; (c)
  no `MCPTask` row stores the envelope (cache-cut
  invariant from v12).
- **`input_required` runtime (v14 parking)**:
  - Server transitions a task to `input_required`.
  - Host preserves `status: "input_required"` and sets
    `hostHandlingState = "unsupported_lifecycle"`.
  - Running-jobs UI surfaces the unsupported-lifecycle message.
  - Host does not call `tasks/result` on it; does not write a
    `failed` envelope.
  - **Shared poller stops issuing `tasks/get` for that
    task (v14)**; no further outbound polling traffic
    is observed.
  - User-triggered `tasks/cancel` succeeds **only** when
    the server advertises `tasks.cancel` (decision 29).
  - User-triggered manual refresh issues exactly one
    `tasks/get`; if still `input_required`, parking
    resumes.

## Effort summary

Estimates assume implementation starts from `dev` (so PRs
#12850 / #12853 / #12910 are inherited) and that PR #11799 is
the Apps Preview substrate. They have shrunk significantly
versus v8 because v9 stops parallel-building the Apps
substrate.

| Phase | Estimate |
|---|---|
| 0 — Transport reliability + auth-context (inherits `dev` fixes) | 2–4 days |
| 1 — Patch #11799 (incl. authenticated bootstrap fix), unify topology, **single authoring profile (v13)**, **single bridge (v14: SDK only, custom bridge deleted)**, **MCP capability profile marker (v14)**, hop-specific relay + proxy-stamped nonce + folded init probe + `_meta` passthrough (Preview gate), bootstrap trust health check (v13), required text fallback (v13), exactly-one-match `contents[]` (v13), **anchor click interceptor + form/refresh rejection (v14)**, **hard-fail oversize on view path (v14)**, **fullscreen stripped (v14)**, vendor Apps + Tasks schemas, lazy bridge with budget, Hardened scaffolds (manifest review keyed by `mcpServerId`, hash, artifact extension), default-deny legacy renderer, live-chat narrowing, lazy remount | 2.5–3 weeks (v14: relay + bridge unification offsets the new wire-marker and navigation work) |
| 2P — Apps Preview release (single-ACL refactor, truthful HostContext minimum subset (`inline` only), rate limits, capability turn-on) | 1–1.5 weeks (v14: fullscreen gate work removed) |
| 2H — Apps Hardened (policy-only delta: manifest review activation, `mcp_app` artifact extension write-through, full legacy retirement, Hardened CSP variant without Wasm/eval) | 1.5 weeks (separate release; v14: fullscreen-strip already in Phase 1) |
| 3 — `tool-input-partial` (optional) | 1 week (risk) |
| 4 — MCP Tasks v1 (capability-conditional status-only jobs panel; metadata-only storage with live `tasks/result`; **poller-based wait UI (v13: no blocking waiter)**; **implicit wait-mode for model-started required tasks (v14)**; **`input_required` parks the poller (v14)**; **derived `expiresAt` TTL (v14)**; `model-immediate-response` as model plumbing; progress UI deferred to #12535 reuse) | 1.5–2 weeks (v14: implicit wait + parking are tiny additions on top of the v13 shared poller) |
| 5 — Hardening + browser matrix + ops docs | 1 week |

**Sequential release order: Apps Preview → Tasks v1 → Apps
Hardened.** Mixing Preview (inherited #11799 substrate, plus
local patches) with Tasks (greenfield control plane) in the
same release trades short-term coupling for very little
user-visible synergy. Three releases is cleaner.

| Release | Phases | Estimate (sequential) |
|---|---|---|
| **R1: Apps Preview (chat)** | 0 + 1 + 2P | **~4–5 weeks** (v13; Phase 1 absorbs the unified authoring profile) |
| **R2: Tasks v1 (capability-conditional status-first jobs panel; cancel where supported; poller-based wait UI; live detail fetch)** | 4 | **~1.5–2 weeks** after R1 |
| **R3: Apps Hardened** (LibreChat Hardened App Profile) | 2H | **~1.5 weeks** after R2 (v13; Hardened delta is policy-only) |

If staffing allows independent tracks, Tasks (R2) can run in
parallel with R1 because the only shared touchpoint is
`authContextHash`, which lands in Phase 0. The default
sequencing keeps inherited code and greenfield control-plane
work in separate user-visible trains.

R1 (Apps Preview) provides interactive app rendering on the
chat surface using the upstream #11799 trust model. Weaker
than Hardened, but materially better than the current legacy
renderer's `'allow-popups'` default — and the deny-default
change applies even when an operator stays on
`MCP_APPS_MODE="disabled"`.

R3 (Apps Hardened) is documented as the **LibreChat Hardened
App Profile**: a stricter subset of the stable Apps spec, not
parity with it. Operator docs enumerate the profile's
behavior on each `_meta.ui` field and call out the Wasm/eval
runtime exclusion. App authors targeting Hardened build to the
profile.

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
