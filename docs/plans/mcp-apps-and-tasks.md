# Plan: MCP Apps + MCP Tasks Support in LibreChat

**Status:** Draft / scoping document — no code in this PR.
**Owner:** TBD
**Target branch:** `claude/mcp-apps-spec-support-rEi7X`
**Revision:** v2 — incorporates review feedback on protocol versioning,
browser isolation, CSP/permissions enforcement mechanisms, Tasks persistence
model, initialization handshake semantics, and pre-implementation security
inputs.

## Goal

Bring LibreChat to parity with the official Model Context Protocol extensions
for interactive UIs (**MCP Apps**, SEP-1865, stable 2026-01-26) and
long-running operations (**MCP Tasks**, 2025-11-25, experimental). Together
these unlock server-rendered interactive applications inside the chat surface
and reliable half-hour-plus jobs that survive disconnects.

## Decisions required before coding starts

These four decisions change the architecture and must be made first. Coding
that begins before they are answered will be rewritten.

1. **Strict spec parity vs useful v1 compatibility.** The stable Apps spec
   requires a cross-origin sandbox proxy for web hosts. A same-origin
   `iframe + sandbox + CSP` shell is a known weaker mode and is not parity.
   This document defaults to **strict parity** as the target; the same-origin
   mode is explicitly an interim non-parity fallback that must be labeled as
   such in operator docs and capability output.
2. **Pinned protocol versions.** The implementation targets:
   - Apps: dated spec **`2026-01-26`** (stable).
   - Tasks: dated spec **`2025-11-25`** (experimental).
   - ext-apps types: a **pinned** package release rather than `main`. `main`
     already exposes draft additions (e.g. `ui/download-file`,
     `HostCapabilities.downloadFile`, `message`,
     `updateModelContext` modality declarations) that are not in the stable
     prose. Fixtures and contract tests are written against the pinned
     release, not whatever is current at build time.
3. **File export approach for the CAD use case.** Three options; pick one
   before Phase 2:
   - (a) Use `ui/open-link` to navigate to a presigned URL (works on stable
     spec, leaves the user-visible download UX to the browser).
   - (b) Adopt draft-era `ui/download-file` and accept that this is beyond
     the stable spec.
   - (c) Defer host-mediated downloads from v1; CAD app shows a copy-link
     affordance only.
   The worked example currently assumes (a).
4. **Server creation policy and transport allowlist.** Following the early
   2026 stdio-RCE advisory, expanding the MCP surface needs explicit operator
   defaults: who can register servers, which transports each role may use,
   per-user task quotas, and result-size caps. Defaults lean toward denial.

## Background

### MCP Apps (extension `io.modelcontextprotocol/ui`)

- Servers expose HTML resources at `ui://...` URIs with MIME
  `text/html;profile=mcp-app`.
- **Tools link to a UI resource via `_meta.ui = { resourceUri, visibility }`.
  This is the source of truth — UI resources may be omitted from
  `resources/list`, so the host must discover them through tool metadata and
  fetch them via `resources/read`.** Plain text fallback when Apps are
  unavailable is mandatory.
- Resource `_meta.ui` (returned by `resources/read`, **not** the tool
  definition) carries CSP (`connectDomains`, `resourceDomains`,
  `frameDomains`, `baseUriDomains`), iframe `permissions`, sandbox `domain`,
  and `prefersBorder`. This split affects where validation, persistence, and
  cache keys live.
- The host renders the resource in a sandboxed iframe and exchanges JSON-RPC
  messages with the view over `window.postMessage`.
- **Web-host architecture is constrained:** the spec requires an intermediate
  sandbox proxy that lives on a **different origin** from the host. The
  sandbox proxy loads the raw HTML view and forwards allowed messages.
  Same-origin rendering is not parity.
- Initialization handshake: the view sends `ui/initialize` with `appInfo`,
  `appCapabilities`, and a protocol version; the host returns
  `protocolVersion`, `hostInfo`, `hostCapabilities`, and `hostContext`. The
  host must not send arbitrary view messages before initialization completes.
- View → Host: `ui/open-link`, `ui/message`, `ui/request-display-mode`,
  `ui/update-model-context`, plus standard MCP `tools/call`, `resources/read`,
  `notifications/message`, `ping`. (Draft-era: `ui/download-file`.)
- Host → View: `ui/initialize` (returns `HostContext`), notifications for
  `tool-input`, `tool-input-partial`, `tool-result`, `tool-cancelled`,
  `host-context-changed`, `size-changed`, plus `ui/resource-teardown`.
- Display modes are negotiated: app declares supported modes, host declares
  supported modes, host must not switch to undeclared modes, and the response
  to `ui/request-display-mode` returns the actual resulting mode.
- `ui/update-model-context` semantics: each update **overwrites** the
  previous context; hosts typically forward only the last update before the
  next user message. Persistence/restoration of view state across remounts is
  explicitly out of MVP scope and is a host product decision.

Reference: <https://github.com/modelcontextprotocol/ext-apps>

### MCP Tasks (capability `tasks`)

- Augments standard requests (most relevantly `tools/call`) with task
  semantics. The server returns immediately with a task handle.
- **Two-level negotiation.** The server advertises
  `capabilities.tasks.requests.tools.call` etc., but each tool independently
  declares `execution.taskSupport` as `forbidden`, `optional`, or `required`.
  Ignoring the per-tool field is an interoperability bug.
- Status lifecycle: `working` → (`input_required`) → `completed` | `failed` |
  `cancelled`.
- **Task object** carries `taskId`, `status`, `createdAt`, `lastUpdatedAt`,
  `ttl`, optional `pollInterval`. The receiver may override the requested TTL,
  may delete state after TTL expires, and may delete cancelled tasks
  immediately. Treat server-supplied values as authoritative.
- Methods: `tasks/get`, `tasks/list`, `tasks/result`, `tasks/cancel`.
- `tasks/result` blocks until terminal state. On Streamable HTTP the client
  may disconnect from the stream and reconnect later. When not actively
  blocking, requestors should poll `tasks/get` at the server's `pollInterval`.
- All correlated requests, notifications, and responses carry
  `_meta["io.modelcontextprotocol/related-task"] = { taskId }` — **except**
  `tasks/get`, `tasks/result`, and `tasks/cancel`, which use the `taskId`
  parameter as the source of truth and ignore the meta tag if present.
- Status notifications are **optional**; clients must not depend on them.
  Rich progress reporting uses the standard `progressToken` mechanism, which
  remains valid for the entire task lifetime.
- Servers may return `_meta["io.modelcontextprotocol/model-immediate-response"]`
  — a model-facing string letting the model continue reasoning while the task
  runs. Important for required-task tools.
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
| **MCP Apps capability negotiation** | Missing | — |
| **`_meta.ui.resourceUri`-driven discovery** | Missing | — |
| **Cross-origin sandbox proxy (web host)** | Missing | new infra surface |
| **Full JSON-RPC postMessage bridge with origin validation** | Missing | — |
| **`ui/initialize` handshake + truthful capability declaration** | Missing | — |
| **HostContext + display mode negotiation** | Missing | — |
| **CSP via response headers + `Permissions-Policy` integration** | Missing | — |
| **Streaming `tool-input-partial`** | Missing | requires changes in `@librechat/agents` |
| **MCP Tasks (server + per-tool negotiation, lifecycle, persistence)** | Missing | — |
| **`progressToken` propagation through agent loop + bridge** | Missing | — |
| **`model-immediate-response` handling** | Missing | — |
| **Background task UI (running-jobs surface, paginated)** | Missing | — |

## Workspace boundaries (per CLAUDE.md)

- All new backend code is **TypeScript** in `/packages/api`.
- DB-shared logic in `/packages/data-schemas`.
- Shared API types/endpoints/data-service in `/packages/data-provider`.
- `/api` (legacy JS) gets the absolute minimum — thin wrappers only.
- Frontend in `/client/src` consuming `packages/data-provider`.
- All user-facing strings via `useLocalize()` with English keys in
  `client/src/locales/en/translation.json`.

## Browser isolation model

This section is upgraded from "Phase 3 polish" to a Phase 1/2 architectural
input because the spec requires it for web hosts.

### Required architecture (strict parity)

- **Cross-origin sandbox proxy.** The host page hosts the conversation. It
  embeds an iframe served from a **separate origin** (e.g. `apps.example.com`
  vs `example.com`). That iframe is the sandbox proxy and itself loads the
  view's HTML. Origin separation is what makes the iframe sandbox attribute
  meaningful — same-origin frames with `allow-scripts` and `allow-same-origin`
  set together can defeat sandboxing.
- **Two-stage `postMessage` routing.** Host ↔ proxy and proxy ↔ view are
  distinct channels. The proxy forwards allowed messages and does not invent
  message semantics; host policy enforcement (origin checks, permission
  decisions, link gating) lives in the host.
- **Initialization barrier.** The host must not send arbitrary view messages
  before `ui/initialize` completes. The bridge has an explicit `initialized`
  state machine.
- **Strict `postMessage` validation.** Senders specify an exact target origin
  (no `*`). Receivers validate `event.origin` against an allowlist (exact
  match, no partial / suffix matches), validate `event.source` where
  applicable, validate the JSON-RPC envelope schema, and log rejected
  messages. Sandboxed frames may produce `null` origins; that case has its
  own explicit handling rule (accept only when expected, never when not).

### Operator deployment

- A new `MCP_SANDBOX_ORIGIN` config is required for parity mode. It must
  resolve to a different eTLD+1 (or at minimum a different subdomain with
  appropriate `Document.domain` defaults; subdomain-only is weaker and
  documented as such).
- The sandbox origin serves a single static `proxy.html` plus the runtime
  bundle. No application content lives there.

### Interim non-parity mode

- A same-origin shell exists for development and for operators who cannot
  configure a second origin. It is feature-flagged
  (`MCP_APPS_ALLOW_SAME_ORIGIN=true`), reported as such in
  `hostCapabilities`, and emits a server log warning at startup.

## CSP, permissions, and downloads

### CSP enforcement

- The primary delivery mechanism is the **HTTP `Content-Security-Policy`
  response header** served alongside the proxy/view HTML. Per-resource policy
  is built from `_meta.ui.csp`.
- Meta-tag CSP is a fallback, but several directives — including `sandbox` —
  are not supported in `<meta>`. The iframe `csp` attribute is experimental
  and not baseline; do not rely on it for security-critical enforcement.
- Default policy when `_meta.ui.csp` is absent or partial:
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
- **All declared origins must be enumerated, including the origin serving the
  view's bundled JS/CSS** (e.g. `localhost` in dev, CDN in prod). Validation
  refuses to load a view whose CSP would block its own static assets.
- `connect-src`, `img-src`, `frame-src`, and `base-uri` are derived from
  `_meta.ui.csp.{connectDomains, resourceDomains, frameDomains,
  baseUriDomains}` respectively, intersected with the host's deny list.

### Permissions

- The iframe `allow` attribute only **further restricts** what the page's
  top-level `Permissions-Policy` already permits. The plan therefore must
  audit and ship a default `Permissions-Policy` header on the LibreChat
  application response that whitelists the union of permissions an MCP App
  could ever legitimately request. Anything not allowed at the top level
  cannot be granted to the iframe regardless of `_meta.ui.permissions`.
- The host reports the **actually-grantable** permission set (not the
  requested set) back through `hostCapabilities.sandbox` so apps can degrade
  gracefully.

### File downloads

- Default for v1: option (a) above — `ui/open-link` to a presigned URL. The
  host validates the link's origin against `_meta.ui.csp.connectDomains` (or
  a separate `downloadDomains` allowlist if introduced) before navigation.
- Option (b), `ui/download-file`, is documented as a draft-era extension and
  is gated behind a separate feature flag if added later.

## Phased plan

### Phase 1 — Spec types, capability negotiation, sandbox proxy scaffold (≈1–2 weeks)

After this phase, compliant servers are detected, the sandbox proxy origin is
served (even if no app is rendered yet), and the postMessage bridge is wired
end-to-end with origin validation. Existing `mcp-ui` rendering still drives
production until Phase 2.

- Types in `packages/data-provider`:
  - `McpAppsExtensionCapability`, `McpUiResourceMeta`, `McpToolUiMeta`
    (`resourceUri`, `visibility`).
  - `TasksCapability`, `TaskExecution` (per-tool `taskSupport` enum),
    `TaskHandle`, `TaskStatus`, `RelatedTaskMeta`, `ProgressToken`,
    `ModelImmediateResponseMeta`.
  - `HostCapabilities`, `HostContext`, `AppCapabilities`, `AppInfo`,
    `HostInfo`, `DisplayMode`.
  - Reuse existing MCP types where they exist; do not duplicate.
- `packages/api/src/mcp/connection.ts`:
  - Advertise `capabilities.extensions["io.modelcontextprotocol/ui"]` and
    `capabilities.tasks` in `initialize`.
  - Read negotiated values back from the server response and store on
    `MCPConnection`.
  - Read per-tool `execution.taskSupport` during tool listing and store
    alongside the tool definition.
- `packages/api/src/mcp/MCPManager.ts`: surface per-server **and per-tool**
  capability flags so the agent and frontend can branch on them.
- Plumb `_meta.ui` through `parsers.ts` end-to-end for both tool definitions
  and tool results.
- Sandbox proxy infrastructure:
  - New static asset bundle served from `MCP_SANDBOX_ORIGIN` (or same-origin
    interim mode behind a flag).
  - Two-stage `postMessage` bridge skeleton with strict origin validation,
    initialization barrier, and rejected-message logging. No view loaded yet.
- Tests with `mongodb-memory-server` + real `@modelcontextprotocol/sdk`
  (CLAUDE.md "real logic over mocks"). Bridge tests use real cross-origin
  iframes via Playwright.

### Phase 2 — `ui://` discovery, view rendering, core View↔Host methods (≈1–2 weeks)

After this phase, MCP Apps render correctly with the minimum viable
interaction set. Existing `mcp-ui` rendering becomes a fallback behind a
feature gate.

- New module `client/src/components/Chat/MCPApp/`:
  - `Bridge.ts` — JSON-RPC over `postMessage` with the Phase 1 bridge.
  - `Frame.tsx` — iframe lifecycle inside the proxy origin.
  - `useMcpApp.ts` — fetch resource via `resources/read` (driven by tool
    `_meta.ui.resourceUri`), mount, send `ui/initialize`, hold connection
    until teardown.
- **Discovery is tool-driven**, not resource-list-driven. UI resources are
  resolved by following `_meta.ui.resourceUri` from a tool definition or
  tool result and calling `resources/read`. `resources/list` may legitimately
  omit them.
- Implement Host-side handlers:
  - `ui/open-link` — gated by allowlist + `connectDomains` check.
  - `ui/message` — inject into chat input via existing input store.
  - `ui/request-display-mode` — return actually-resulting mode (inline only
    is a valid response in Phase 2 if `hostCapabilities` declares only inline).
  - `ui/update-model-context` — write to a per-conversation context store with
    overwrite semantics; only the last update before the next user message is
    forwarded to the LLM.
  - Proxied `tools/call`, `resources/read`, `ping`.
- Implement Host-side notifications: `tool-input`, `tool-result`,
  `tool-cancelled`, `host-context-changed` (theme/size).
  `tool-input-partial` deferred to Phase 4.
- Implement `ui/resource-teardown` request/response cycle.
- `ui/initialize` returns `hostCapabilities` that **truthfully** reflects
  what's implemented; do not advertise `pip`/`fullscreen` or unsupported
  modalities until Phase 3 lands them.
- Migrate UI resource lookup from content-hashed IDs to `ui://` URIs from
  `_meta.ui.resourceUri`. Keep the legacy path behind a feature gate.

### Phase 3 — HostContext richness, display modes, permissions polish (≈1 week)

- Full `HostContext`: theme tokens (CSS variables), display mode, container
  dimensions, locale, timezone, platform, safe-area insets. Source from
  existing theme + i18n providers.
- Display modes: implement `fullscreen` and `pip` if product confirms LibreChat
  web UI supports them; otherwise leave them off `hostCapabilities` and
  document that explicitly. The contract requires the host not to switch to
  undeclared modes.
- `host-context-changed` notifications on theme/locale/dimension changes.
- `size-changed` handler (resize iframe to view-reported dimensions).
- Top-level `Permissions-Policy` header rollout; sandbox `permissions` mapping
  to iframe `allow`; honest `hostCapabilities.sandbox` reporting.
- Per-resource CSP response headers wired up end-to-end.

### Phase 4 — Streaming tool input (≈1 week, riskier)

- Surface partial tool-call arguments through the agent loop so the view sees
  `tool-input-partial` notifications during streaming.
- Coordinate with `@librechat/agents` (`/home/danny/agentus`) — likely a new
  event on the streaming pipeline.
- This phase is optional for v1 of the CAD app.

### Phase 5 — MCP Tasks support (≈2 weeks; can run parallel to Phases 2–3)

- `packages/api/src/mcp/`:
  - Honor per-tool `execution.taskSupport`:
    - `forbidden` — never task-augment; reject server attempts to escalate.
    - `optional` — agent or operator policy decides.
    - `required` — always task-augment; reject synchronous attempts.
  - Submit/poll/cancel/get implementations with strict
    `_meta["io.modelcontextprotocol/related-task"]` rules:
    - Add the meta on all task-related requests, notifications, responses.
    - **Do not** add it on `tasks/get`, `tasks/result`, `tasks/cancel`.
  - Long-wait ownership: a backend worker process owns the blocking
    `tasks/result` call, not the browser. The browser observes status via the
    existing data-provider channels. This survives user logout and tab close.
  - Reconnect logic: on connection loss, re-issue `tasks/result` (which
    re-blocks until terminal) or fall back to `tasks/get` polling at the
    server's `pollInterval`. Respect server-issued expiry; treat
    "task not found" as terminal-with-error.
  - Persistence in `packages/data-schemas` — new collection storing
    `(userId, serverName, taskId, status, createdAt, lastUpdatedAt, ttl,
    pollInterval, progressToken, modelImmediateResponse, lastSeen,
    correlationConversationId)`. Treat the server as authoritative; this is a
    cache, not a source of truth.
  - Progress token plumbing: generate on submit if the agent wants progress;
    route `notifications/progress` from the server through the agent loop and
    through the postMessage bridge to mounted views. Status notifications are
    optional and treated as a UI hint, not state of record.
  - Honor `model-immediate-response`: pass through to the agent as the
    synchronous tool result so the model can continue reasoning. If absent,
    synthesize a neutral placeholder; per-model overrides may suppress it.
- Agent integration: when a tool call returns a task handle, the agent emits a
  task-started message with the `taskId`; on completion, the result is
  appended to the conversation. Errors propagate verbatim from the underlying
  request type.
- Frontend running-jobs surface in `client/src/components/SidePanel/`:
  cursor-paginated list, status badges, progress bars (when `progressToken`
  is present), cancel button (disabled for terminal tasks), deep-link back
  to the originating conversation. Localize under `com_ui_mcp_task_*`.
- Wire `_meta["io.modelcontextprotocol/related-task"]` through the
  postMessage bridge so views can subscribe to their own task progress.

### Phase 6 — Hardening, threat model, operator docs (≈1 week)

- Threat model write-up referenced from this doc, covering:
  malicious-HTML rendering, sandbox escape attempts, CSP bypass via
  cross-origin assets or meta-tag fallbacks, postMessage spoofing,
  unauthorized tool execution from views, data exfiltration via
  `connect-src`, phishing-style UI behavior, long-running task abuse
  (resource exhaustion, quota evasion, result-size DoS).
- Operator docs:
  - Sandbox origin setup (`MCP_SANDBOX_ORIGIN`, DNS, TLS).
  - CSP defaults and how to whitelist additional origins.
  - `Permissions-Policy` header changes and what they affect.
  - Per-user task quotas, result-size caps, transport allowlists by role.
  - Migration story for existing users tuning timeouts: long-running MCP
    operations should now be modeled as Tasks, not as raised proxy timeouts.
- E2E + interop test matrix (see Testing).

## Worked example: CAD generative-design app

This is the motivating use case driving the plan. It exercises every primitive
above.

1. User selects the CAD MCP server in LibreChat. The chat invokes a tool
   whose definition carries `_meta.ui.resourceUri = "ui://upload"`. The host
   reads that URI via `resources/read` and renders the resulting HTML in the
   sandbox proxy origin (Phase 1 + 2).
2. View shows an upload dialog. It calls `cad.create_upload_url` (a regular
   MCP tool, declared `taskSupport: forbidden`) for a presigned PUT URL. The
   view PUTs the file directly to blob storage (CSP `connect-src` whitelists
   the storage origin from `_meta.ui.csp.connectDomains`). It then calls
   `cad.ingest({ key })`, which is `taskSupport: required` and runs as a
   task (Phase 5). View renders progress from `notifications/progress`
   correlated by `related-task`.
3. On completion, the task's `tasks/result` returns a tessellated GLTF (with
   B-Rep face IDs from OCCT) plus a feature list. The view receives this via
   `ui/notifications/tool-result` and transitions from "uploading" to
   "viewer" without remount.
4. User picks holes/faces (Three.js raycasting; face IDs come from `_meta`),
   selects material from a dropdown, and clicks **Finish**. Selection state
   lives in the view's JS plus is mirrored to the host via
   `ui/update-model-context` so the LLM can reason about the current
   selection on its next turn.
5. View calls `cad.submit_job({ partId, selections, material })` —
   `taskSupport: required`, expected runtime ~30 minutes. Server accepts,
   forwards to the external REST API (auth lives server-side), receives a
   job ID, and returns a task handle. The submit task may also return a
   `model-immediate-response` like "Job submitted, ID 12345; results in ~30
   minutes" so the model can confirm to the user without waiting.
6. The result of the submit task, when delivered, is itself a UI resource —
   a "job status" card. While mounted, it renders progress from
   `notifications/progress`. After the user closes the chat, the backend
   worker keeps the `tasks/result` blocking call alive (Phase 5) or polls
   `tasks/get` at the server's `pollInterval`.
7. User comes back. The agent calls `tasks/list` (or the user clicks the
   running-jobs sidebar). `tasks/result` returns the completed result with
   the S3 presigned URL. The result UI resource shows a download button
   that uses `ui/open-link` to navigate to the URL (file-export option (a)),
   and an inline GLTF preview of the output (CSP `connect-src` whitelists
   the S3 bucket).

## Risks / open questions

- **Sandbox origin operator burden.** Strict parity needs a second origin.
  Some operators won't or can't configure one. The interim same-origin mode
  is documented as non-parity but may become sticky.
- **Top-level `Permissions-Policy` change.** Adding policy headers can break
  unrelated features that quietly relied on permissive defaults. Audit
  before shipping.
- **`tool-input-partial` (Phase 4)** requires changes to `@librechat/agents`.
  Coordinate early or defer indefinitely.
- **Out-of-band notification** ("email me when the job's done") is not
  solved by Tasks — it stays in the external REST API's domain via webhook
  → email.
- **SEP-2669 (pause/resume/steer)** and **SEP-2268 (subtasks)** are still in
  review. Plan for Tasks v1 only; revisit when those land.
- **Task expiry semantics** are still being refined per the 2026 MCP roadmap.
  Treat server-supplied TTL/expiry as authoritative; do not assume results
  are durable beyond TTL.
- **`ui/update-model-context` does not persist view state by spec.** If the
  CAD app needs selection state to survive iframe remount or session
  restart, that's a host-side feature requiring server-side persistence
  keyed by something stable (e.g. partId) — not free.
- **ext-apps `main` drift.** Pinning a release means we deliberately ignore
  some new fields. A periodic refresh cadence is needed (quarterly?) to
  re-evaluate the pinned version.
- **Stdio-RCE precedent.** Conservative defaults on server creation,
  transport allowlists, and per-user quotas are non-negotiable inputs, not
  late-stage hardening.

## Testing matrix

CLAUDE.md says real logic over mocks. The interop matrix below uses real
`@modelcontextprotocol/sdk` servers in-process and a Playwright harness for
the cross-origin iframe layer.

### MCP Apps

- Capability negotiation: presence/absence of
  `extensions["io.modelcontextprotocol/ui"]`.
- Discovery: tool with `_meta.ui.resourceUri` for a resource omitted from
  `resources/list` is still rendered; resource without `_meta.ui` falls back
  to text.
- Cross-server isolation: an app from server A cannot call tools from server
  B unless explicitly authorized.
- CSP enforcement: undeclared `connect-src` origin is blocked at the network
  layer; declared origin succeeds.
- `Permissions-Policy` interaction: iframe `allow` cannot exceed top-level
  policy; granted-vs-requested reported in `hostCapabilities.sandbox`.
- Initialization ordering: host messages sent before `ui/initialize` are
  rejected by the bridge.
- `ui/request-display-mode` for an undeclared mode returns the actual mode
  (declined gracefully, not error).
- `size-changed` and `host-context-changed` round-trip.
- Malformed JSON-RPC over `postMessage`: rejected, logged, no host crash.
- `postMessage` from wrong origin: rejected.
- `null`-origin `postMessage` from the sandbox: accepted only when the
  sandbox is the expected source.

### MCP Tasks

- Per-tool `taskSupport: required` rejects synchronous calls.
- Per-tool `taskSupport: forbidden` rejects task-augmented calls.
- `input_required` state surfaces an elicitation/sampling correlated by
  `related-task`.
- Cancellation after terminal state returns the existing terminal status.
- Cursor pagination of `tasks/list` traverses correctly across pages.
- Disconnect during `tasks/result` → reconnect → resume returns the same
  terminal result.
- Optional status notifications are tolerated as hints; their absence does
  not stall the UI.
- `progressToken` propagates from agent through bridge to view.
- `model-immediate-response` is delivered to the model verbatim.
- `related-task` meta is **omitted** on `tasks/get` / `tasks/result` /
  `tasks/cancel`.
- Server-issued expiry → cached state cleared; "task not found" treated as
  terminal-with-error.

## Effort summary

Estimates revised upward in v2 to reflect added scope (sandbox proxy infra,
top-level `Permissions-Policy`, task persistence, progress tokens, test
matrix).

| Phase | Estimate |
|---|---|
| 1 — Types + capability negotiation + sandbox proxy scaffold | 1–2 weeks |
| 2 — postMessage bridge + `ui://` rendering + handshake | 1–2 weeks |
| 3 — HostContext + display modes + permissions polish | 1 week |
| 4 — Streaming `tool-input-partial` | 1 week (risk) |
| 5 — MCP Tasks (parallel with 2–3) | 2 weeks |
| 6 — Hardening + threat model + ops docs | 1 week |
| **Total (serial, excl. parallelism)** | **~7–9 weeks** |
| **Phase 1 + 2 + 5** (functional CAD app, parity sandbox) | **~5 weeks** |

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
