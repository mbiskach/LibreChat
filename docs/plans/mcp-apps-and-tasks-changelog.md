# Plan changelog: MCP Apps + MCP Tasks Support in LibreChat

This file is **revision history**, not implementation guidance.
The current plan is in [`mcp-apps-and-tasks.md`](./mcp-apps-and-tasks.md).

The plan went through fourteen revisions during scoping and
review, each in response to a specific gap or contradiction
caught in review. Implementers should read the plan; this
file is for reviewers, future maintainers, and anyone trying
to understand why a particular decision is the way it is.

## Revision history (brief)

| Rev | Theme | Major decisions still in force |
|---|---|---|
| v6 | Browser/runtime edge cases | Construction-order invariant; lazy-load bridge; sizing fallback |
| v7 | Bytes vs origins | Self-contained HTML (Hardened); manifest-hash approval (Hardened); TTL-bound result cache |
| v8 | Apps + Tasks decoupling, Preview/Hardened split first appearance | Independent flags; data-boundary helpers; status-only jobs |
| v9 | Adopt upstream PR #11799 substrate | "Adopt-then-layer," not parallel-build; pin commit SHAs |
| v10 | Decisions frozen | Single `MCP_APPS_MODE` enum; chat-only surface matrix; Hardened as LibreChat profile; Wasm/eval excluded in Hardened; drop separate `MCPAppInstance`; shared fan-out Tasks poller |
| v11 | Reality check | Unified outer-sandbox topology; #11799 is a local patchset; stable-identity `authContextHash`; lazy remount; multi-content `resources/read` accepted; vendor generated schemas |
| v12 | Implementation prep | Preview compatibility clause; relay validation promoted to Phase 1; `_meta` passthrough as Preview gate; capability-conditional Tasks UX; `authRevision` replaces `configRevision`; host-side terminal-result cache cut entirely; auto-repin advisory pinning; deterministic wait-restart on session loss |
| v13 | Delete the compatibility theater | One authoring profile across modes (no external assets, `connect-src 'none'` in both); blocking `tasks/result` waiter cut entirely (poller-based wait UI); `authContextHash` derives from a snapshot, not a counter; bootstrap trust is fail-closed; exactly-one-match `contents[]` rule; required text fallback contract; `model-immediate-response` is model plumbing only; vendor Tasks schemas; validator drops static JS inspection |
| v14 | Wire it up correctly | Single bridge (SDK only); MCP capability profile marker so servers learn the profile at registration time; implicit wait-mode for model-started required tasks; `input_required` parks the poller; native navigation/forms/refresh blocked under sandbox + `srcdoc`; oversize results hard-fail on the view path; fullscreen stripped from v1 entirely; persistence keys off `mcpServerId`; derived `expiresAt` for MongoDB TTL; review console deferred post-v1 |

Full per-revision narratives below; full earlier-revision
narratives (v1–v5) are available in git history.

---

## v14 — Wire it up correctly

A third external review confirmed the v13 simplifications were
correct in spirit but caught two design mismatches and a pile
of remaining contradictions that would have made the plan hard
to implement without re-deciding things at the keyboard. v14
fixes the design mismatches, unblocks model-started long-running
tools (which v13 left without a path back into chat), tightens
the Apps wire contract so server authors learn the host's
profile at MCP capability negotiation rather than at review-time
failure, and makes the host's behavior under `srcdoc` + sandbox
explicit. v13's frozen decisions remain in force; v14 only
adjusts where review found leftover ambiguity or design bugs.

**v14 decisions (binding; supersede v13 where they conflict):**

- **Single bridge, SDK only.** Upstream PR #11799 carries
  both a custom `MCPAppBridge.ts` JSON-RPC bridge and an
  optional adapter for the SDK-based `AppBridge` from
  `@modelcontextprotocol/ext-apps`. v14 standardizes on
  the SDK path and **deletes the custom bridge** in
  Phase 1. The transport shim wraps the SDK with
  explicit target origins and a proxy-stamped per-view
  nonce; receive validation is the SDK's. This matches
  the upstream Apps rationale of reusing MCP
  infrastructure and removes a parallel test matrix.

- **MCP capability profile marker.** v13 collapsed
  Preview and Hardened to one authoring profile but did
  not give servers a way to learn about that profile
  during MCP capability negotiation. v14 advertises the
  profile twice: once in the MCP initialize response
  (`capabilities.experimental["io.modelcontextprotocol/ui"]
  .profile = "librechat-self-contained"`) so server-side
  tool registration can react before any tool with
  `_meta.ui.resourceUri` is advertised, and once in
  `ui/initialize` (`hostCapabilities.experimental.profile`)
  so view code can branch. Servers that ignore the
  marker still work but get text fallback for any tool
  that registers with disallowed metadata.

- **Implicit wait-mode for model-started required
  tasks.** v13's "wait for result" UI mode lives on top
  of the shared poller, but v13 left model-started
  long-running tools without a path back into chat — a
  user typing "submit my CAD job" would see the model
  send the call and never receive the actual result
  unless they manually opened the jobs panel. v14 makes
  implicit wait the default for the originating turn
  whenever the agent invokes a `taskSupport: "required"`
  tool: the chat surface shows a waiting state, the
  shared poller continues, and on the first terminal
  status the host issues exactly one `tasks/result` and
  delivers the envelope on both the model path and the
  chat surface. Implicit wait does not apply to tasks
  created from inside a mounted app view (those keep
  status-only semantics) or to manually re-opened
  detail rows on prior turns.

- **`input_required` parks the poller.** The Tasks
  spec says requestors should poll until terminal **or
  until `input_required`**. v13 documented unsupported-
  lifecycle chrome but did not specify what the shared
  poller does. v14 makes parking explicit: on first
  `input_required`, the shared poller stops issuing
  `tasks/get` for that task; the UI surfaces the
  unsupported-lifecycle state; cancel remains available
  only when the server advertises `tasks.cancel`; a
  user-triggered manual refresh issues exactly one
  `tasks/get` and resumes parking on the same status.

- **Native navigation, forms, and refresh redirects
  are blocked.** Under `srcdoc` + the host's hardened
  sandbox set, `<form>` renders but does not submit,
  sandboxed frames block top-level navigation, and
  relative URLs resolve against `MCP_SANDBOX_ORIGIN`.
  v13's CSP defenses cover `connect-src` and
  `form-action` but did not address native-navigation
  surprises. v14 makes the contract explicit:
  - The validator rejects `<form action>`, `<form
    method>`, `<meta http-equiv="refresh">`,
    `target="_blank"`, `target="_top"`, and anything
    else that needs a sandbox flag the host refuses.
  - The proxy injects an anchor click interceptor that
    routes `<a href>` activations through `ui/open-link`
    against the host's navigation allowlist.
  - The runtime CSP defenses (`form-action 'none'`,
    `base-uri 'none'`) remain.

- **Oversize results hard-fail on the view path.** v13
  carried v11/v12's "truncate with marker" rule for
  view-bound `tool-result` payloads over the cap. The
  Apps spec defines `ui/notifications/tool-result` as a
  standard `CallToolResult`, and the Tasks spec says
  terminal `tasks/result` MUST equal what the underlying
  request would have returned — including correlation
  metadata like `_meta["io.modelcontextprotocol/related-task"]`.
  Lossy truncation breaks both contracts. v14 refuses
  to deliver an oversize partial envelope to the view
  and surfaces a host-chrome error instead. Model-path
  truncation with a marker is unaffected on the model
  path.

- **Fullscreen stripped from v1.** v11/v13 still let
  Preview honor `appSettings.allowFullscreen` and
  expose `fullscreen` in `availableDisplayModes`. v14
  cuts that for v1 entirely — both Preview and
  Hardened advertise `availableDisplayModes =
  ["inline"]` and reject any other requested mode —
  because trust-chrome-under-fullscreen has not been
  validated and the truthful-subset principle for
  HostContext should not be mode-dependent. Fullscreen
  is re-evaluated post-v1 with the trust-chrome
  validation.

- **Persistence keys off `mcpServerId`, never display
  name.** v13 already treated display name as cosmetic
  in the `authContextHash` derived snapshot but had not
  tightened that rule across `MCPResourceReview`,
  manifest-pinning records, the `mcp_app` artifact's
  manifest binding, or the per-server task ownership
  index. v14 uses the immutable `mcpServerId`
  everywhere review, pinning, or task-ownership
  persistence depends on a server identity, so renames
  cannot drop approvals or collide records.

- **Task TTL uses a derived `expiresAt` field with a
  single-field MongoDB TTL index.** v12/v13
  repeatedly described "MongoDB TTL index on `createdAt
  + ttl`" — that is not how TTL indexes work. MongoDB
  TTL indexes are single-field; you cannot index an
  expression. v14 computes `expiresAt = createdAt +
  ttl` at write time, stores it on `MCPTask`, and
  indexes that field with `expireAfterSeconds: 0`.
  Application reads check `now < expiresAt` directly
  because the TTL monitor runs on a background cadence
  and is not synchronous at the millisecond boundary.

- **Operator-facing review console is post-v1.** The
  Apps rationale supports host review of templates and
  pinning of reviewed assets, but a fully-fledged admin
  UI is not on the v1 release path. v14 ships
  log-and-auto-allow plus pinning behavior (advisory
  by default, hard refuse under
  `MCP_APPS_HASH_PINNING_REQUIRED=true`); operators
  read review activity from logs. A first-class admin
  UI comes in a later release without changing
  user-facing UX.

- **Stale prose deleted.** v12/v13 still carried
  contradictory paragraphs in places: Preview honoring
  `connectDomains` or `resourceDomains`, Phase 1 exit
  criterion saying the validator was "behind a flag,
  not yet used in the Preview render path," manifest
  divergence auto-repinning described as all-mode
  while Preview lacked manifest review. v14 deletes
  every leftover sentence that contradicts v13's
  unified-profile decision so implementers do not have
  to decide which paragraph is authoritative.

---

## v13 — Delete the compatibility theater

A second external review observed that v12 still carried two
expensive structures that the chosen architecture had already
made unnecessary, plus several places where security-sensitive
implementation details had been left implicit. v13 deletes the
compatibility theater (Preview as a "looser" stable Apps mode
with its own asset / networking story, and a dedicated blocking
`tasks/result` waiter with its own restart state machine), and
makes the implicit security details explicit (bootstrap trust,
exactly-one-match selection, required text fallback). v12's
frozen decisions remain in force; v13 only adjusts where the
review found leftover complexity worth cutting.

**v13 decisions (binding; supersede v12 where they conflict):**

- **Single authoring profile across modes.** Once Phase 1
  unifies Preview and Hardened onto `srcdoc` under
  `MCP_SANDBOX_ORIGIN`, treating Preview as a partial,
  upstream-honoring asset / networking story is a
  net-negative. v13 collapses the modes onto one authoring
  profile: self-contained HTML in both, no external assets
  in either, `connect-src 'none'` in both, bridge-routed
  network access in both. The modes differ only on policy
  strictness: Wasm/eval permitted in Preview's CSP and
  blocked in Hardened's; fullscreen optional in Preview
  behind operator gate, stripped in Hardened; legacy
  `UIResourceRenderer` retired on chat in Preview, retired
  across all surfaces in Hardened; `manifestHash` review
  active in Hardened, scaffolded but inactive in Preview.
  App authors target one profile; the migration path
  between modes does not change asset or networking
  contracts.

- **No blocking `tasks/result` waiter in v1.** The Tasks
  spec supports a blocking `tasks/result` call but does not
  require host UIs to back "wait for result" with one. v13
  cuts the dedicated blocking waiter and implements "wait
  for result" as a UI mode on top of the shared poller:
  the host keeps polling at `pollInterval`, the UI shows a
  waiting state, and on the first terminal status the host
  issues exactly one `tasks/result` to fetch the envelope.
  This deletes the entire wait-restart state machine that
  v12 introduced for session loss mid-wait, the concurrent
  wait/poll duality, and the dedicated re-init / retry
  budget. Latency cost: at most one `pollInterval` of
  additional completion delay. Code cost saved: an entire
  protocol corner that mostly served a feature users
  experience as "keep watching this task until it
  finishes."

- **`authContextHash` binds to a derived snapshot, not a
  counter.** v12's `authRevision` field placed the
  ownership invariant on a manually-bumped counter that
  has to bump on every auth-relevant config edit and
  never on cosmetic edits — the kind of procedural rule
  that rots in maintenance, where a missed bump leaks
  access to tasks that should be hidden. v13 hashes the
  auth-relevant config snapshot directly (server URL,
  transport type, OAuth issuer/client_id/sorted-scopes,
  API key reference, credential mapping policy), making
  the invariant structural rather than procedural.
  Cosmetic fields (display name, description, icon,
  docs, default UI settings, fallback height) are
  explicitly outside the snapshot. Per-field tests
  guarantee a schema change that adds a new auth-relevant
  field cannot silently leak across contexts.

- **Bootstrap trust contract is fail-closed.** v13 makes
  the sandbox proxy's bootstrap explicit: never derive
  the host origin from `document.referrer`, never accept
  or send `'*'` as `targetOrigin`, refuse to initialize
  if the host-controlled `host-bootstrap` postMessage
  (delivering host origin, view ID, per-view nonce) is
  absent or arrives from any unexpected origin. A
  startup health check verifies that `proxy.html` from
  `MCP_SANDBOX_ORIGIN` carries the required response
  headers (`Content-Security-Policy: frame-ancestors`,
  `Cache-Control` no-cache, `Cross-Origin-Resource-Policy`)
  and refuses to enable Apps capability advertisement
  otherwise.

- **Exactly-one-match `contents[]` rule.** v11 accepted
  multi-content `resources/read` responses with a
  "log extras and ignore" rule. v13 keeps that for
  non-matching entries but **fails review** when two or
  more entries match the declared `(uri, mimeType)`
  pair; the silent "pick one" path was the lone source
  of nondeterminism in the decoding pipeline.

- **Required text fallback contract.** Servers that mark
  tools with `_meta.ui.resourceUri` MUST also return a
  human-meaningful text summary in `CallToolResult.content`.
  The host renders that text on every non-render path —
  non-chat surfaces, failed `ui/initialize` relay probes,
  unsupported browsers, bootstrap health-check failures,
  and Hardened review refusals. When `content` is empty
  or trivial, the host renders a single generic "App is
  unavailable on this surface" card built from `toolInfo`
  rather than synthesizing data the model has not seen.
  This collapses three subtly-different fallback
  experiences into one client-side surface and matches
  the Apps spec's expectation that app-launching tools
  also behave as standard tools when the host cannot
  render UI.

- **`model-immediate-response` is model plumbing only.**
  The provisional metadata field is fed into the model
  context as the immediate tool result for the in-flight
  task call — the spec's narrow scope. v13 explicitly
  cuts the v12 behavior that turned it into an
  assistant-visible placeholder turn with model
  suppression and overwrite-on-final logic. Users see a
  standard task card in the running-jobs UI; the agent
  loop has nothing extra to do.

- **Vendor Tasks generated schemas, not just Apps.**
  Tasks is explicitly experimental and the ownership /
  metadata / error semantics are precise enough that
  drift between the package and the host implementation
  will hurt. v13 vendors generated TypeScript types and
  JSON Schemas for Tasks `2025-11-25` into
  `packages/data-provider/src/mcp-tasks/schemas/`,
  alongside the Apps schemas v11 already vendored.
  Package upgrades remain independent of schema updates.

- **Validator drops static JS inspection.** v12's
  validator tried to reject inline JS containing dynamic
  `import()` to remote URLs at review time. v13 cuts
  that — it is hard to do reliably, the false-positive
  cost is real, and the inner-view CSP at runtime
  already blocks dynamic imports, `fetch`, `eval`, and
  `WebAssembly.instantiate` per the Hardened/Preview
  policy split. The validator now rejects only the
  declarative URL-bearing tags (`<script src>`,
  `<link href>`, etc.) and `<base>`. Cheaper to reason
  about; fewer false positives.

- **Effort rebalance.** Phase 1 grows from ~2–2.5 weeks
  to ~2.5–3 weeks because the unified authoring profile
  moves the validator and `connect-src 'none'`
  enforcement up. Phase 2P shrinks accordingly. Phase 4
  shrinks from ~2 weeks to ~1.5–2 weeks because the
  blocking-waiter state machine is gone.

---

## v12 — Implementation prep

Final scoping pass before implementation begins. v12
addresses an external review that flagged six implementation
blockers in v11: an underspecified Preview compatibility
contract under the unified `srcdoc` topology, capability
unrealism in the Tasks UX, an `authContextHash` input that
would orphan tasks on cosmetic edits, an unnecessary
host-side terminal-result cache, an undefined session-restart
path during a blocking wait, and ecosystem failure modes
(Safari relay, `_meta` drop) parked as Hardened polish even
though they affect Preview the moment topology unifies.
v12 closes each issue, simplifies the advisory-pinning state
machine, and removes residual contradictory prose. v11's
frozen decisions remain in force; v12 only adjusts where
external review forced changes.

**v12 decisions (binding; supersede v11 where they conflict):**

- **Preview compatibility clause.** Once Phase 1 unifies
  Preview and Hardened onto `srcdoc` under
  `MCP_SANDBOX_ORIGIN`, two upstream-style behaviors stop
  being reliable in Preview and are explicitly cut:
  - **Relative external asset URLs** (`<script src>`,
    `<link href>`, `<img src>`, frame `src`) inside the
    resource HTML are rejected at review time in Preview
    too, because `about:srcdoc` resolves relative URLs
    against the embedding document, not against `ui://`.
    Absolute HTTPS URLs covered by `resourceDomains` remain
    accepted in Preview; Hardened ignores `resourceDomains`
    entirely.
  - **Direct browser networking** from the inner frame is
    documented as best-effort, unsupported in production
    in Preview. The opaque-origin (`null`) inner frame
    breaks cookies, conservative CORS, OAuth, and
    origin-based API allowlists. App authors are
    documented to route via `tools/call` /
    `resources/read` / `ui/open-link` for any production
    networking. Preview is **not** positioned as a natural
    first step toward Hardened; apps targeting Hardened
    build to the Hardened profile directly.

- **Hop-specific relay validation, proxy-stamped per-view
  nonce, folded `ui/initialize` probe, and `_meta`
  passthrough are all Preview gates (Phase 1) in v12, not
  Hardened polish.** The unified topology means
  WebKit/Safari's `event.source === window` regression
  affects Preview the moment Phase 1 lands. The proxy-
  stamped per-view nonce is the host-vs-proxy trust
  primitive that survives whatever the inner view does, so
  it must apply on the same hop in both modes. The folded
  init probe is the relay self-test that detects engines
  where this trust primitive cannot be enforced. `_meta`
  passthrough is the contract every task-aware app
  depends on, and the basic Apps host has a known
  upstream regression that drops `_meta` from
  `tool-result`. v12 promotes all four to Phase 1 exit
  criteria; Phase 2H is now a policy-only delta.

- **Tasks UX is capability-conditional.** The Tasks spec
  makes `tasks.list` and `tasks.cancel` independently
  negotiated sub-capabilities and explicitly warns that
  servers without a stable requestor identity should not
  advertise `tasks.list`. v12 conditions the jobs panel,
  cancel affordance, and cross-session task discovery on
  the negotiated capabilities:
  - Without `tasks.list`: per-conversation handles view
    only, no global cross-session view, no `tasks/list`
    invocation against that server.
  - Without `tasks.cancel`: cancel button is not rendered
    for that server's task rows.
  - Negotiated capabilities are persisted on the `MCPTask`
    row (`serverTasksCapabilities`) so the UX stays
    consistent across reload and reconnect.

- **`authContextHash` binds to `authRevision`, not
  `configRevision`.** v11's payload included
  `configRevision`, a counter that bumped on every
  server-config edit. Cosmetic edits (display name, docs,
  icon, default UI settings, fallback height) would
  therefore have orphaned in-flight tasks even though the
  effective authorization context did not change. v12
  replaces that input with `authRevision`, a counter that
  bumps **only** on auth-relevant config changes (server
  URL, transport, auth scheme, OAuth issuer/client/scopes,
  API key reference, per-user credential mapping policy).
  Display, docs, icon, and default UI settings do not
  affect the hash. The unit-test corpus adds a named
  "non-auth config edits do not change the hash" case to
  guard against regressions.

- **No host-side terminal-result cache.** v11's Tasks
  storage was metadata + an optional cached terminal
  envelope materialized on explicit detail entry, with
  blob offload and semantic-equivalence rehydration. The
  spec already says `tasks/result` returns the underlying
  final result for terminal tasks, blocks for
  non-terminal, and lets receivers purge after TTL. v12
  cuts the cache entirely. `MCPTask` holds **metadata
  only**; on detail entry or explicit wait the host calls
  `tasks/result` **live** every time. This removes
  BSON-size management, blob offload, semantic
  rehydration, expiry semantics, and an extra retention
  boundary. If repeat fetches become a latency or load
  issue in production, caching can be re-introduced
  later behind data rather than ahead of it.

- **Wait-restart on session loss is deterministic.** A
  blocking `tasks/result` wait that fails with HTTP 404 /
  session-lost triggers exactly **one** re-init +
  revalidate + retry budget: re-init the MCP session,
  call `tasks/get` once on the new session, then either
  retry `tasks/result` (non-terminal), forward the
  terminal envelope (terminal), or mark
  terminal-with-error (not found). A second
  `tasks/result` failure surfaces a clear error; the host
  does **not** retry further and does **not** silently
  downgrade to polling. Goal: no duplicate concurrent
  waiters, no surprise polling of a wait the user did not
  reopen.

- **Advisory manifest divergence auto-repins.** v11
  required a one-click re-acknowledge on every advisory-
  mode divergence, which adds friction without security
  upside. v12 changes advisory mode to auto-repin the
  new manifest, render it, and surface a host-controlled
  banner naming the server, the manifestHash short-prefix
  before/after, and what changed (bytes, sandbox flags,
  permissions, network policy, URI, trust-policy
  version). Hard refuse is reserved for strict pinning
  (`MCP_APPS_HASH_PINNING_REQUIRED=true`).

- **`MCP_TASKS_MAX_RESULT_ENVELOPE_BYTES` becomes
  `MCP_TASKS_MAX_RESULT_FORWARD_BYTES`.** With no cache,
  the limit no longer governs inline storage vs blob
  offload. It now caps a live `tasks/result` envelope at
  forward time: model-path serializations are truncated
  with a marker; view-path forwards surface a chrome
  warning. Nothing is persisted.

- **Goal language tightened.** v11 still described the
  intent as "parity with the stable subset of Apps."
  Decision 22 has redefined Hardened as the LibreChat
  Hardened App Profile (a stricter subset, not parity);
  v12 removes the residual "parity" wording so
  implementers stop chasing a contradiction.

- **Effort estimates rebalanced.** Phase 1 grows from
  ~1.5–2 weeks to ~2–2.5 weeks because relay validation,
  the proxy-stamped nonce, the folded init probe, and
  `_meta` passthrough verification all moved up from
  Phase 2H. Phase 2H shrinks correspondingly to ~1.5–2
  weeks. The total Apps work is approximately unchanged;
  v12 redistributes it across phases so Preview ships
  with the security-relevant relay primitives in place.

---

## v11 — Reality check

Clears the residual ambiguity in v10 by unifying outer-sandbox
topology across modes, treating PR #11799 as a local patchset
rather than a clean inheritance, revising `authContextHash` so
OAuth refresh does not orphan tasks, making remount lazy-by-
visibility, accepting multi-content `resources/read` responses,
vendoring generated Apps schemas, and collapsing the v6–v9
historical narrative into a brief revision log so implementers
stop tripping over stale text. v10's frozen decisions remain
in force; v11 only adjusts where reality forced changes.

**v11 decisions (binding; supersede v10 where they conflict):**

- **Outer-sandbox topology is unified across modes.** Earlier
  revisions had Preview render the inner iframe via a `data:`
  URL on the LibreChat application origin (inheriting the
  upstream `#11799` model) and Hardened swap to a dedicated
  `MCP_SANDBOX_ORIGIN`. v11 collapses this: **both** modes
  serve the outer proxy from `MCP_SANDBOX_ORIGIN`. The split
  between Preview and Hardened is **policy only** (CSP,
  external assets, manifest review, fullscreen, Wasm/eval),
  not architecture. This eliminates an entire architecture
  swap between releases, removes a class of authenticated
  bootstrap bugs, and aligns earlier with the stable Apps
  spec's different-origin proxy model. Operators must
  configure `MCP_SANDBOX_ORIGIN` whenever
  `MCP_APPS_MODE !== "disabled"`, including Preview.

- **PR #11799 is a local patchset, not a clean inheritance.**
  As of May 2 2026, end-to-end testing on `#11799` surfaced
  a release-blocking bug: authenticated users hit 401 on
  `/api/mcp/sandbox` because the client fetched the sandbox
  template with raw `fetch()` while auth lived in an axios
  interceptor. Phase 1 must (a) port `#11799` onto our
  branch, (b) replace the data-URL-on-app-origin model with
  the unified `MCP_SANDBOX_ORIGIN` outer proxy, (c) confirm
  no remaining authenticated bootstrap path is broken, and
  (d) add an end-to-end Playwright test covering the
  authenticated mount through to first `tool-result`. Until
  those are green, Preview is not shippable. Phase 1's
  estimate has been bumped to reflect this.

- **`authContextHash` binds to stable identity, not live
  bearer-token bytes.** v10's payload included
  `headerAuthFingerprint` over the live header value;
  ordinary OAuth refresh would change that fingerprint and
  orphan in-flight tasks even though the human user, MCP
  server, and authorization principal are unchanged.
  LibreChat already has issue #12802 about synchronized
  OAuth-expiry storms and proactive refresh, so this is a
  real production risk. v11 redefines `authPayload` as
  `{ userId, mcpServerId, credentialSource,
  oauthSubject || apiKeyFingerprint, configRevision }`.
  The `headerAuthFingerprint` field is removed entirely.
  `oauthSubject` is the OAuth `sub` claim (stable across
  refresh); `apiKeyFingerprint` is the SHA-256 of the
  long-lived API key (stable until rotation). Token-rotation
  events do **not** change `authContextHash`.

- **Remount is lazy-by-visibility, not eager-on-open.** v10
  said "walk all `mcp_app` artifacts on conversation reopen
  and replay each launch lifecycle." For long threads with
  many app messages that is the wrong default: it costs N
  iframes, N `resources/read` calls, and N initialize probes
  before the user even scrolls. v11 hydrates only artifacts
  in or near the viewport (intersection-observer threshold,
  default 200 px above and below); older artifacts hydrate on
  scroll, expand, or explicit click. The artifact persistence
  model is unchanged; only the default-loading model
  changes.

- **`resources/read` accepts a `contents[]` array.** The
  Apps spec models `resources/read` as
  `{ contents: ResourceContents[] }` — there is no
  protocol requirement that the array contain exactly one
  item. v10's blanket "reject multi-content responses" rule
  was an unnecessary host policy. v11 picks the
  `contents[]` item whose `uri` matches the declared
  `resourceUri` and whose MIME parses as `text/html` with
  profile `mcp-app`; extras are logged and ignored. Apps
  servers that legitimately return additional metadata
  contents alongside the HTML payload now work without
  changes.

- **Generated Apps schemas are vendored, not just package-
  pinned.** Earlier revisions said "pin a specific
  `@modelcontextprotocol/ext-apps` package release."
  Upstream has version negotiation logic but host behavior
  does not yet vary by negotiated version, and `main`
  already carries draft additions like
  `ui/download-file` / `HostCapabilities.downloadFile`. To
  keep the host surface deliberate, v11 vendors the
  generated schemas (TypeScript types + JSON Schemas)
  matching the stable `2026-01-26` spec into
  `packages/data-provider/src/mcp-apps/schemas/`, commits
  them, and updates them via reviewed PRs. Package upgrades
  are independent of schema updates; the host validates
  against vendored schemas, not whatever the package
  currently exports.

- **Bridge runtime is lazy-loaded on the client, with a
  hard bundle budget.** Importing `AppBridge` plus
  `PostMessageTransport` from
  `@modelcontextprotocol/ext-apps/app-bridge` at
  `ext-apps@1.7.1` measures ~377 KB minified, dominated by
  Zod. v11 adds a CI-enforced bundle-size budget on the
  default chat entry point (max delta from `main` when no
  app is mounted: 8 KB compressed) and dynamic-imports the
  bridge only when a view is about to render.

- **Shared in-process Tasks poller is documented as node-
  local dedup.** The shared fan-out poller deduplicates
  `tasks/get` traffic per process. In horizontally scaled
  deployments without sticky sessions, each process runs
  its own poller; that is acceptable for v1 but must be
  documented as the deployment contract. Operators who want
  strictly-once polling either use sticky sessions or wait
  for a post-v1 distributed coordination layer.

- **`input_required` is a named "unsupported lifecycle"
  state in UI copy and operator docs.** v10 already
  documented this as a deliberate restricted profile. v11
  pins the user-visible string contract: the running-jobs
  panel surfaces "This task is waiting for interactive
  input that LibreChat cannot provide yet" rather than
  generic "failed" / "error" copy. Operator docs include a
  named "Unsupported lifecycle states" section so server
  authors can recognize the subset.

- **Use the upstream-preferred host construction pattern.**
  v10's construction-order invariant remains. v11 commits
  to consuming the upstream construction-order helper when
  upstream PR for it lands; until then, the host
  implements the same safe pattern locally (append iframe
  → grab `contentWindow` from initial `about:blank` →
  connect transport → set `srcdoc`). v11 explicitly does
  not invent additional queue semantics.

- **Stale historical narrative collapsed into a revision
  log.** v6–v9 changelog blocks have been replaced with a
  short revision log table. The full v10 changelog and
  this v11 changelog remain inline (here, in this file).
  Decision drift between revisions was confusing
  implementers and driving wrong test choices.

---

## v10 — Decisions frozen

Closed the surface-matrix contradiction inherited from v9,
collapsed Apps flags to a single mode enum, declared Hardened
explicitly as a hardened LibreChat profile (not spec parity),
excluded Wasm/eval-dependent runtimes from Hardened v1,
dropped the duplicate persistence store in favor of extending
the inherited `mcp_app` artifact, switched Tasks polling to a
shared fan-out model, simplified the review flow, and
reordered the release train to sequential Preview → Tasks →
Hardened after the ninth review.

**Decisions frozen by v10 (not subject to further drift):**

- **Single Apps-mode enum.** Replace the two-boolean
  `MCP_APPS_PREVIEW_ENABLED` / `MCP_APPS_HARDENED_ENABLED`
  scheme with one operator setting:
  `MCP_APPS_MODE = "disabled" | "preview" | "hardened"`.
  Default `disabled`. The deprecated `MCP_APPS_ENABLED=true`
  legacy value maps to `"preview"` with a startup warning.
  This eliminates impossible flag combinations and the
  "what does Hardened-without-Preview mean" question.

- **Surface matrix resolved.** Whenever
  `MCP_APPS_MODE !== "disabled"`, the new Apps path renders
  **only on the live chat surface**. Share, search, plugin-
  rendered messages, and any other non-chat surface that
  could otherwise render a UI resource fall back to
  **deterministic text rendering** of the resource's
  `content` field. This holds in both Preview and Hardened.
  When `MCP_APPS_MODE === "disabled"`, the legacy
  `UIResourceRenderer` is the only path; its default
  `sandboxPermissions` flips from `'allow-popups'` to `''`
  in this revision regardless of mode (immediate safety
  improvement for operators who do not opt in). There is no
  configuration in which the new Apps path renders on a
  non-chat surface or in which both paths render the same
  message.

- **Hardened is a hardened LibreChat profile, not stable
  spec parity.** The stable Apps spec exposes
  `connectDomains`, `resourceDomains`, `frameDomains`,
  `baseUriDomains`, `_meta.ui.domain`, and
  `_meta.ui.prefersBorder`. Hardened v1 ignores or rejects
  most of those by design. This is a valid host policy, but
  it is not what an arbitrary stable-Apps app might assume.
  Hardened is documented as the **LibreChat Hardened App
  Profile** in operator docs, with explicit per-field
  behavior and an explicit list of stable-spec features it
  intentionally does not honor in v1. App authors targeting
  Hardened build to the profile, not to the wider spec.

- **Hardened v1 excludes Wasm-heavy and eval-dependent
  runtimes.** The Hardened CSP is `script-src 'unsafe-inline'`
  with no `wasm-unsafe-eval` and no `'unsafe-eval'`. That
  rules out Wasm-based runtimes (Pyodide, Wasm-built
  frameworks, B-Rep kernels, etc.) and any framework that
  uses `eval` or `new Function` (some Three.js shader paths,
  some templating engines). Apps that need those runtimes
  either ship under Preview only or wait for a post-v1
  Hardened profile that adds opt-in CSP relaxations behind
  per-app review. The CAD worked example is revised
  accordingly (B-Rep kernel runs server-side; the view
  renders pre-tessellated GLTF in Three.js without Wasm).

- **No separate `MCPAppInstance` collection.** Upstream
  PR #11799 already creates an `mcp_app` artifact attached
  to the message after the tool call. v10 **extends that
  artifact** with `manifestHash` and `authContextHash`
  fields rather than introducing a parallel store.
  Re-opening a conversation reads `mcp_app` artifacts off
  message history and replays the launch lifecycle for each
  one. `MCPResourceReview` (server-keyed manifest review)
  remains a separate concern; the host artifact is per-
  message and per-launch.

- **Tasks polling uses a shared in-process fan-out poller.**
  Replace v9's "each subscriber owns its own poll" with a
  single backend poller keyed by
  `(taskId, authContextHash)`. Subscribers (mounted view,
  jobs panel, chat tab) subscribe to the in-process channel
  and receive fan-out from the one poll loop. When the
  subscriber count drops to zero, the loop terminates and
  the task continues server-side. This removes duplicate
  `tasks/get` traffic, race edges between observers, and
  the implementation cost of N independent loops, with
  identical user UX.

- **Review flow simplified to auto-allow + manifestHash
  pinning + kill switch.** Drop the human approval queue
  and `MCPBuilder/` admin UI from v1. The host runs the
  decoding pipeline, computes `manifestHash`, stores the
  manifest, and renders. On manifest divergence the user
  sees a "this app has been updated" notice with a one-
  click re-acknowledge action. Operators can flip a
  `MCP_APPS_KILL_SWITCH` (off by default) to refuse all
  Apps rendering instantly. `MCP_APPS_HASH_PINNING_REQUIRED`
  remains as the strict mode for operators who want
  divergence to be a hard refuse.

- **`input_required` is a deliberate restricted profile.**
  The Tasks spec says requestors should preemptively call
  `tasks/result` when a task transitions to
  `input_required`. v10 does **not** do that, because
  LibreChat cannot satisfy elicitation/sampling in v1. v10
  documents this as a named subset decision rather than
  silently diverging from spec; servers that hard-require
  `input_required` interactions will not work end-to-end
  until the elicitation/sampling track lands.

- **Tasks storage is metadata + on-demand result cache,
  nothing more.** Drop persistence of original request
  envelopes, subscriber state, and progress UI state. The
  `MCPTask` collection holds task metadata and an optional
  terminal result envelope cached only after the user
  fetches it through the explicit detail path; it expires
  at upstream TTL. No request-replay, no subscriber durability,
  no progress checkpointing.

- **Preview HostContext is a deliberate minimum.** Preview
  populates `displayMode`, `availableDisplayModes`,
  `containerDimensions`, `toolInfo`, `theme`, `locale`, and
  `timeZone`. CSS-variable catalogs, safe-area insets, deep
  device-capability surfaces, and platform richness are
  deferred until Hardened (or until a real app needs them).
  Truthful subset rather than synthetic full surface.

- **Sequential release train: Preview → Tasks → Hardened.**
  Mixing Preview (inherited from #11799) and Tasks
  (greenfield control plane) in the same user-facing train
  trades short-term coupling for very little UX synergy.
  v10 ships them in three releases instead. Tasks remains
  independent of Apps mode at runtime; the ordering is just
  about delivery sequencing.

- **Phase 1 pins specific upstream artifacts.** Pin a
  specific commit SHA on `KyleKincer:feat/mcp-apps` (TBD at
  Phase 1 start). Pin `@modelcontextprotocol/ext-apps` to a
  specific package release. The plan tracks upstream
  changes during Phase 1 against those pins instead of
  continuously rebasing — Safari relay, `_meta` forwarding,
  and bundle-size issues are all open upstream and the
  pinning isolates implementation from churn.
