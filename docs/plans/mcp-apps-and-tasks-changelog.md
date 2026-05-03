# Plan changelog: MCP Apps + MCP Tasks Support in LibreChat

This file is **revision history**, not implementation guidance.
The current plan is in [`mcp-apps-and-tasks.md`](./mcp-apps-and-tasks.md).

The plan went through eleven revisions during scoping and
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

Full per-revision narratives below; full earlier-revision
narratives (v1–v5) are available in git history.

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
