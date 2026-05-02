# Plan: MCP Apps + MCP Tasks Support in LibreChat

**Status:** Draft / scoping document — no code in this PR.
**Owner:** TBD
**Target branch:** `claude/mcp-apps-spec-support-rEi7X`

## Goal

Bring LibreChat to parity with the official Model Context Protocol extensions for
interactive UIs (**MCP Apps**, SEP-1865, stable 2026-01-26) and long-running
operations (**MCP Tasks**, 2025-11-25, experimental). Together these unlock
server-rendered interactive applications inside the chat surface and reliable
half-hour-plus jobs that survive disconnects.

## Background

### MCP Apps (extension `io.modelcontextprotocol/ui`)

- Servers expose HTML resources at `ui://...` URIs with MIME
  `text/html;profile=mcp-app`.
- Tools link to a UI resource via `_meta.ui = { resourceUri, visibility }`.
- The host renders the resource in a sandboxed iframe and exchanges JSON-RPC
  messages with the view over `window.postMessage`.
- View → Host: `ui/open-link`, `ui/message`, `ui/request-display-mode`,
  `ui/update-model-context`, plus standard MCP `tools/call`, `resources/read`,
  `notifications/message`, `ping`.
- Host → View: `ui/initialize` (returns `HostContext`), notifications for
  `tool-input`, `tool-input-partial`, `tool-result`, `tool-cancelled`,
  `host-context-changed`, `size-changed`, plus `ui/resource-teardown`.
- Resource `_meta.ui` carries CSP (`connectDomains`, `resourceDomains`,
  `frameDomains`, `baseUriDomains`), iframe `permissions`, sandbox `domain`,
  and `prefersBorder`.

Reference: <https://github.com/modelcontextprotocol/ext-apps>

### MCP Tasks (capability `tasks`)

- Augments standard requests (most relevantly `tools/call`) with task semantics.
  The server returns immediately with `{ taskId, status }`.
- Status lifecycle: `working` → (`input_required`) → `completed` | `failed` |
  `cancelled`.
- Methods: `tasks/get`, `tasks/list`, `tasks/result`, `tasks/cancel`.
- `tasks/result` blocks until terminal — works across reconnects, so a user can
  close the chat and come back hours later.
- All correlated messages carry
  `_meta["io.modelcontextprotocol/related-task"] = { taskId }`, enabling a UI
  view to subscribe to its own task's progress.

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
| **`_meta.ui.resourceUri` on tools** | Missing | — |
| **Full JSON-RPC postMessage bridge (View↔Host)** | Missing | — |
| **HostContext + display modes** | Missing | — |
| **CSP + permissions enforcement from `_meta.ui`** | Missing | — |
| **Streaming `tool-input-partial`** | Missing | requires changes in `@librechat/agents` |
| **MCP Tasks (capability + methods)** | Missing | — |
| **Background task UI (running-jobs surface)** | Missing | — |

## Workspace boundaries (per CLAUDE.md)

- All new backend code is **TypeScript** in `/packages/api`.
- DB-shared logic in `/packages/data-schemas`.
- Shared API types/endpoints/data-service in `/packages/data-provider`.
- `/api` (legacy JS) gets the absolute minimum — thin wrappers only.
- Frontend in `/client/src` consuming `packages/data-provider`.
- All user-facing strings via `useLocalize()` with English keys in
  `client/src/locales/en/translation.json`.

## Phased plan

### Phase 1 — Spec types + capability negotiation (≈3–5 days)

Backward-compatible groundwork. After this phase, compliant servers are
detected but rendering still flows through the existing `mcp-ui` path.

- Add types to `packages/data-provider`:
  - `McpAppsExtensionCapability`, `McpUiResourceMeta`, `McpToolUiMeta`
    (`resourceUri`, `visibility`).
  - `RelatedTaskMeta`, `TaskStatus`, `TaskHandle`, `TasksCapability`.
  - Reuse existing MCP types — do not duplicate (CLAUDE.md rule).
- `packages/api/src/mcp/connection.ts`: advertise
  `capabilities.extensions["io.modelcontextprotocol/ui"]` and
  `capabilities.tasks` in `initialize`. Read negotiated values back from the
  server response and store on `MCPConnection`.
- `packages/api/src/mcp/MCPManager.ts`: surface per-server capability flags so
  the frontend can branch on them.
- Plumb `_meta.ui` through `parsers.ts` so tool definitions and tool results
  preserve UI metadata end-to-end.
- Tests with `mongodb-memory-server` + real `@modelcontextprotocol/sdk` (per
  CLAUDE.md "real logic over mocks").

### Phase 2 — JSON-RPC postMessage bridge + UI resources from `ui://` (≈1–2 weeks)

Replaces the current `onUIAction` callback with a full bidirectional bridge.
After this phase, MCP Apps render correctly with the minimum viable interaction
set; the existing `mcp-ui`-style flow keeps working as a fallback.

- New module `client/src/components/Chat/MCPApp/`:
  - `Bridge.ts` — JSON-RPC over `postMessage`, request/notification routing,
    correlation by `id`.
  - `Frame.tsx` — sandboxed iframe with CSP headers from `_meta.ui.csp`,
    permissions from `_meta.ui.permissions`, and a dedicated origin where
    configured.
  - `useMcpApp.ts` — lifecycle hook: fetch resource, mount, send
    `ui/initialize`, hold a connection until teardown.
- Implement Host-side handlers for: `ui/open-link` (gated by allowlist),
  `ui/message` (inject into chat input via existing input store),
  `ui/request-display-mode` (inline only in this phase),
  `ui/update-model-context` (write to a per-conversation context store), plus
  `tools/call` and `resources/read` proxied to the existing MCP manager.
- Implement Host-side notifications: `tool-input`, `tool-result`,
  `tool-cancelled`. (`tool-input-partial` deferred to Phase 4.)
- Migrate UI resource lookup from content-hashed IDs to `ui://` URIs from
  `_meta.ui.resourceUri`. Keep the legacy path behind a feature gate.
- `packages/data-provider`: add endpoints/types for any new chat-side data
  flows (likely none; postMessage is browser-only).

### Phase 3 — HostContext, display modes, CSP polish (≈1 week)

- `HostContext`: theme tokens (CSS variables), display mode, container
  dimensions, locale, timezone, platform, safe-area insets. Source from
  existing theme + i18n providers.
- Display modes: `inline`, `fullscreen`, `pip`. New UI shells in
  `client/src/components/Chat/MCPApp/`.
- `host-context-changed` notifications on theme/locale/dimension changes.
- `size-changed` handler (resize iframe to view-reported dimensions).
- CSP enforcement: build a per-resource CSP header from `_meta.ui.csp` with a
  restrictive default
  (`default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none';`).
- Optional: dedicated sandbox origin via a separately-served subdomain. Document
  the operator config; ship a single-origin fallback.
- `ui/resource-teardown` request/response cycle.

### Phase 4 — Streaming tool input (≈1 week, riskier)

- Surface partial tool-call arguments through the agent loop so the view sees
  `tool-input-partial` notifications during streaming.
- Coordinate with `@librechat/agents` (`/home/danny/agentus`) — likely a new
  event on the streaming pipeline.

### Phase 5 — MCP Tasks support (≈1–2 weeks; can run parallel to Phases 2–3)

- `packages/api/src/mcp/`:
  - Wrap `MCPManager.callTool` to detect server-supplied
    `_meta["io.modelcontextprotocol/related-task"]` and route follow-up calls
    through `tasks/get` / `tasks/result` / `tasks/cancel`.
  - Persistence: store `(userId, serverName, taskId, status, lastSeen)` so the
    long-poll on `tasks/result` can resume across user sessions. New collection
    in `packages/data-schemas`.
  - Re-issue `tasks/result` on reconnect; respect server expiry.
- Agent integration: when a tool call returns a task handle, the agent emits a
  "task started" message with the `taskId`; on completion (via `tasks/result`
  or notification) the result is appended to the conversation.
- Frontend running-jobs surface in `client/src/components/SidePanel/`:
  small list, status badges, cancel button, deep-link back to the originating
  conversation. Localize all strings under `com_ui_mcp_task_*`.
- Wire `_meta["io.modelcontextprotocol/related-task"]` through the postMessage
  bridge so MCP App views can subscribe to their own task progress.

### Phase 6 — Hardening & docs (≈3–5 days)

- Operator docs: dedicated sandbox origin setup, CSP defaults, task expiry
  guidance.
- Threat model write-up: iframe escape, CSP bypass, postMessage origin
  validation, long-running task abuse.
- E2E tests covering: capability negotiation, render, postMessage round-trip,
  task submission → reconnect → result retrieval.

## Worked example: CAD generative-design app

This is the motivating use case driving the plan. It exercises every primitive
above.

1. User selects the CAD MCP server in LibreChat. The chat sends a tool that
   returns a `ui://upload` resource (Phase 1 + 2).
2. View shows an upload dialog. It calls `cad.create_upload_url` (a regular
   MCP tool) for a presigned PUT URL, uploads the file directly to blob
   storage (CSP `connect-src` allows the storage origin), then calls
   `cad.ingest({ key })` which runs as a **task** (Phase 5). View renders
   progress from task notifications correlated by `related-task`.
3. On completion, the server pushes a `ui/notifications/tool-result` carrying
   a tessellated GLTF (with B-Rep face IDs from OCCT) plus a feature list. The
   same iframe transitions from "uploading" to "viewer" without remount
   (Phase 2).
4. User picks holes/faces (Three.js raycasting, `_meta` carries face IDs),
   selects material from a dropdown, and clicks **Finish**.
5. View calls `cad.submit_job({ partId, selections, material })` as a task. The
   submit task can be hours long. The MCP server forwards to the external
   REST API (auth lives server-side), receives a job ID, and persists it.
6. The result of the submit task is itself a UI resource — a "job status"
   card. While mounted, it streams progress from task notifications. After
   user closes the chat, the task keeps running on the server.
7. User comes back. The agent calls `tasks/list` (or the user clicks the
   running-jobs sidebar from Phase 5). Either way, `tasks/result` returns the
   completed result with the S3 presigned URL. The result UI resource shows
   a download button and an inline GLTF preview of the output (CSP
   `connect-src` whitelists the S3 bucket).

## Risks / open questions

- **Dedicated sandbox origin** is the only piece that affects deployment, not
  just code. Single-origin with strict CSP is acceptable for v1 but weaker
  isolation than ChatGPT/Claude Desktop.
- **`tool-input-partial` (Phase 4)** requires changes to `@librechat/agents`.
  Coordinate early or defer indefinitely.
- **Out-of-band notification** ("email me when the job's done") is not solved
  by Tasks — it stays in the external REST API's domain via webhook → email.
- **SEP-2669 (pause/resume/steer)** and **SEP-2268 (subtasks)** are still in
  review. Plan for Tasks v1 only; revisit when those land.
- **Task result expiry** semantics are still being refined per the 2026 MCP
  roadmap. Treat server-supplied expiry as authoritative; do not assume
  results are durable.
- **Persistence of `ui/update-model-context` payloads** across turns: current
  `useConversationUIResources` stores resources but not view-pushed context.
  Phase 2 needs a small hook extension to round-trip selection state into the
  next LLM turn.

## Effort summary

| Phase | Estimate |
|---|---|
| 1 — Types + capability negotiation | 3–5 days |
| 2 — postMessage bridge + `ui://` rendering | 1–2 weeks |
| 3 — HostContext + display modes + CSP | 1 week |
| 4 — Streaming `tool-input-partial` | 1 week (risk) |
| 5 — MCP Tasks (parallel with 2–3) | 1–2 weeks |
| 6 — Hardening + docs | 3–5 days |
| **Total (serial, excl. parallelism)** | **~5–7 weeks** |
| **Phase 1 + minimum of 2 + 5** (functional CAD app) | **~3–4 weeks** |

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
