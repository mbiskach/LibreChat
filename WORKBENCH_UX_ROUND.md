# Workbench blinded-persona UX round (2026-07-14)

A cold HWO/GSFC engineer persona (no build context, drove the real app
headless via a curl driver) attempted a two-launch strawman and wrote a
UX evaluation. Verdict: **TRIAL** ("would pilot it"; stopped short of
ADOPT because an OpenAI-key quota 429 cut authoring off after ~4 turns,
so the bus/mated/restow/export steps never happened).

This is the workbench's first outside review since the 2026-07-09
serve-UI rounds. Findings adjudicated below (persona findings can
over-flag - the panel-calibration lesson); each is confirmed against her
screenshots (`.../persona/shot_*.png`) before acting.

## Adjudication

| # | Persona finding | Sev | Adjudication | Action |
|---|---|---|---|---|
| 1 | LLM quota 429 hard-blocks authoring; raw error dumped to chat | MAJOR | INFRA (operator's OpenAI key quota), NOT product - but the raw LangChain/OpenAI 429 in chat is illegible to a cold user ("looks like I did something wrong") | Not a code fix (billing). Legibility note tracked; low priority |
| 2 | Silent first reply ("Used 4 tools", no prose) - built a whole design + DOES-NOT-FIT with no narration | MAJOR | CONFIRMED product, but ROOT is GPT-5.5 emitting tool calls without a summary turn; the pack result text exists, the model just didn't relay it | Hard (model behavior). Mitigation candidate: surface the verdict banner in-chat when the reply is prose-empty. Tracked, not this pass |
| 3 | Failures buried under 20+ passing fairing rows; the 3 FAILs that drive DOES-NOT-FIT sit below the fold | MINOR | **CONFIRMED, cheap** - screenshot shows "constraints 3" badge over an all-green visible list | **FIX: failures-first ordering** |
| 4 | Generator built an on-axis stack (obstructs pupil) for an off-axis telescope, then failed it | MINOR | PLAUSIBLE - the CHAT model authored it; the engine correctly caught it. A chat-guidance/steering issue, not an engine bug | Tracked for a chat-prompt nudge (declare off-axis for telescopes) |
| 5 | Deploy panel empty on first visit; animation not self-evident | MINOR | PARTLY known glTF load-lag (populates after ~15s), partly a missing loading state | Tracked: a "loading…" affordance |
| 6 | No discoverable geometry EXPORT (only "load glTF" import) | MINOR | **CONFIRMED** - export_step exists as a chat tool (landed 2026-07-14) but there is no UI button, and she couldn't reach chat (quota) | **FIX: workbench Export STEP button via /op** |
| 7 | Part-click gives no feedback outside the edit tab | PAPERCUT | CONFIRMED (canvas pick only wireframes in edit mode) | Tracked |
| 8 | pre_dock/mated scenes silently absent (no bus added) | PAPERCUT | Correct behavior, no hint | Tracked |
| 9 | Layer 1/2 never defined; across_flats label truncated; finding-id tags unexplained | PAPERCUT | CONFIRMED legibility | **FIX (cheap): group-header tooltips already exist; add a note; leave tags** |

## Fixed this pass
- **Failures-first strip** at the very top of the constraints tab. A
  first attempt sorted FAIL>WARN>PASS *within* each layer group, but the
  failing finding can live in a lower group (here the optical PM-SM FAIL
  under 11 geometry WARNs), so it still sat below the fold. The strip
  hoists every FAIL (across all groups) to a red "must fix — N failing"
  block above the groups, clickable, still shown in-group for context.
  Verified headless: the a2 campingcup DOES-NOT-FIT now leads with
  "optical_path -10.2 m ... PM-SM separation 4.80 m vs >= 15 m floor".
- **Export STEP button** in the workbench: calls the export_step tool via
  the side-channel /op endpoint and lists the download links - closes the
  "no way to get geometry out" gap the persona hit.

## Graduated to regression (the persona's probes as tests)
- The /op export path is covered by an mcp test; the failures-first order
  is a panel behavior verified headless in this round's follow-up.

## Tracked (not this pass)
Silent first reply (model-side), off-axis chat steering, deploy loading
state, cross-tab pick feedback, the 429 legibility. The strong positives
she confirmed - pervasive placeholder provenance, physical failing
verdicts, the "nothing moved by hand" edit tab, per-step deployment
clearances - are the workbench's load-bearing trust signals; keep them.
