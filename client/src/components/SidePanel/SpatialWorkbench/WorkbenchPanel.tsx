/**
 * Spatial Workbench (spike): a persistent 3D panel beside the chat.
 *
 * Renders a glTF produced by a domain tool (first domain: truss concept
 * strawmen). The glTF carries the whole viewer protocol:
 *   - scenes = domain configurations (truss: lifecycle states; label in
 *     scene extras - NEVER parse three.js-sanitized names)
 *   - node extras.id = the domain's stable component id
 *   - node extras.entities = canonically named sub-entities (faces /
 *     edges / vertices) with world geometry, so picking resolves to ids
 *     like `bus.edge(+x,+y)` that stay meaningful across regeneration.
 *
 * The host stays domain-agnostic: it renders, picks, and reports ids.
 * three.js is imported dynamically so the chunk never loads unless the
 * panel is used.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useChatFormContext } from '~/Providers';

type PickEntry = {
  ref: string;
  component: string;
  entity: string | null;
  scene: string;
};

const ACCENT = 0xb23a2f;
const MENTION = 0xd99a2b; // refs the model cited in its latest reply

function entityDistance(THREE: any, p: any, e: any): number {
  if (e.type === 'face' && e.center) {
    // faces carry {center, normal} (strawman topology): distance is the
    // perpendicular gap to the face plane, so the ray-hit face wins
    const c = new THREE.Vector3(...e.center);
    const n = new THREE.Vector3(...(e.normal ?? [0, 0, 1])).normalize();
    return Math.abs(p.clone().sub(c).dot(n));
  }
  if (e.type === 'vertex' && e.point) {
    return p.distanceTo(new THREE.Vector3(...e.point));
  }
  if (e.type === 'edge' && e.poly) {
    let best = Infinity;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const line = new THREE.Line3();
    const q = new THREE.Vector3();
    for (let i = 0; i < e.poly.length - 1; i++) {
      a.set(...(e.poly[i] as [number, number, number]));
      b.set(...(e.poly[i + 1] as [number, number, number]));
      line.set(a, b);
      line.closestPointToPoint(p, true, q);
      best = Math.min(best, p.distanceTo(q));
    }
    return best;
  }
  if (e.type === 'edge' && e.circle) {
    const c = new THREE.Vector3(...e.circle.center);
    const axis = new THREE.Vector3(...e.circle.axis).normalize();
    const v = p.clone().sub(c);
    const along = v.dot(axis);
    const perp = v.clone().addScaledVector(axis, -along);
    if (perp.lengthSq() < 1e-12) {
      return Math.sqrt(e.circle.radius ** 2 + along ** 2);
    }
    const closest = c.clone().addScaledVector(perp.normalize(), e.circle.radius);
    return p.distanceTo(closest);
  }
  return Infinity;
}

function entityOverlay(THREE: any, e: any, size: number, color: number = ACCENT): any {
  const mat = new THREE.LineBasicMaterial({ color });
  if (e.type === 'face' && e.center) {
    // a small disc + normal stub at the face center (faces carry no
    // polygon at strawman fidelity, so mark the plane, not the outline)
    const g = new THREE.Group();
    const n = new THREE.Vector3(...(e.normal ?? [0, 0, 1])).normalize();
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.05, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35,
        side: THREE.DoubleSide }),
    );
    disc.position.set(...(e.center as [number, number, number]));
    disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    g.add(disc);
    const tip = new THREE.Vector3(...e.center).addScaledVector(n, size * 0.06);
    g.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...e.center), tip]), mat));
    return g;
  }
  if (e.type === 'vertex' && e.point) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.012, 12, 12),
      new THREE.MeshBasicMaterial({ color }),
    );
    s.position.set(...(e.point as [number, number, number]));
    return s;
  }
  let pts: number[][] = [];
  if (e.poly) {
    pts = e.poly;
  } else if (e.circle) {
    const c = new THREE.Vector3(...e.circle.center);
    const axis = new THREE.Vector3(...e.circle.axis).normalize();
    const u = new THREE.Vector3(1, 0, 0);
    if (Math.abs(u.dot(axis)) > 0.9) {
      u.set(0, 1, 0);
    }
    const e1 = u.clone().cross(axis).normalize();
    const e2 = axis.clone().cross(e1).normalize();
    for (let i = 0; i <= 48; i++) {
      const t = (2 * Math.PI * i) / 48;
      pts.push(
        c
          .clone()
          .addScaledVector(e1, e.circle.radius * Math.cos(t))
          .addScaledVector(e2, e.circle.radius * Math.sin(t))
          .toArray(),
      );
    }
  }
  const geo = new THREE.BufferGeometry().setFromPoints(
    pts.map((q) => new THREE.Vector3(...(q as [number, number, number]))),
  );
  return new THREE.Line(geo, mat);
}

export default function WorkbenchPanel() {
  const mountRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<any>({});
  const [scenes, setScenes] = useState<string[]>([]);
  const [active, setActive] = useState('');
  const [picks, setPicks] = useState<PickEntry[]>([]);
  const [selMode, setSelMode] = useState<'part' | 'face' | 'edge' | 'point'>('part');
  const [status, setStatus] = useState('Load a .gltf (truss: pack --out writes packed.gltf)');
  // feedback widget: shown after a tool publishes geometry; the
  // model-independent channel that calibrates the in-band record_feedback
  // tool (widget-negatives without a tool-filed negative = under-reporting)
  const [rated, setRated] = useState<'' | 'up' | 'down' | 'sent'>('');
  const [why, setWhy] = useState('');
  const [mentionCount, setMentionCount] = useState(0);
  // deployment scrubber: shown when the active configuration carries a
  // deploy animation (glTF animation named `deploy · <scene label>`)
  const [hasDeploy, setHasDeploy] = useState(false);
  const [deployT, setDeployT] = useState(1);
  const [playing, setPlaying] = useState(false);
  // the ordered deploy steps of the active configuration (one per stage/
  // chain leg), each with the timeline window it plays in and its
  // tightest engine-sampled clearance - the "all steps for this payload"
  // list, click to jump
  const [steps, setSteps] = useState<
    Array<{ label: string; component: string; w0: number; w1: number;
            jumpT: number; clear: number | null; color: string;
            members?: string[] }>
  >([]);
  const [stripBg, setStripBg] = useState('');
  const [interferences, setInterferences] = useState<Array<[number, number, string]>>([]);
  const [ghost, setGhost] = useState(false);
  // one color per major system (from glTF extras.system/system_color -
  // twins and mosaic segments share their subsystem's color)
  const [legend, setLegend] = useState<
    Array<{ system: string; color: string; kind?: string; count: number }>
  >([]);
  // UI-refresh spike: tabs are MODES. The viewport stays visible always;
  // the active mode contributes a side data pane (constraints: the
  // engine's findings with corpus ids; deploy: the step list) and, for
  // deploy, the scrubber overlay under the viewport. '' = viewport only.
  const [mode, setMode] = useState<'' | 'constraints' | 'deploy' | 'edit'>('');
  const [findings, setFindings] = useState<any[]>([]);
  const [verdict, setVerdict] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [selOnly, setSelOnly] = useState(false);
  const [findingIx, setFindingIx] = useState(-1);
  // corpus deep-links: /corpus.json is the read-only window into
  // constraints.yaml (id -> title/statement/source/status)
  const [corpus, setCorpus] = useState<any>(null);
  const [openCid, setOpenCid] = useState('');
  // edit mode: dimensions of the first picked part, edited via the
  // side-channel /op endpoint - the SAME narrow verbs the model uses
  const [dims, setDims] = useState<any>(null);
  const [dimEdits, setDimEdits] = useState<Record<string, string>>({});
  const [dimWin, setDimWin] = useState<any>(null);
  const [opStatus, setOpStatus] = useState('');
  const [busyOp, setBusyOp] = useState('');
  // feedback layers (truss docs/layers.md): disciplines collapsed by default
  const [showL3, setShowL3] = useState(false);
  // STEP export (blinded-persona round: the workbench had no way to get
  // geometry OUT). Drives the export_step tool through the /op endpoint.
  const [exporting, setExporting] = useState(false);
  const [stepLinks, setStepLinks] = useState<Array<{ name: string; url: string; kb: number }>>([]);
  // guided first-mission tutorial: teaches the trust loop (author -> the
  // engine judges -> nothing moved by hand) by DOING, and directly
  // answers the confusions the blinded-persona round surfaced (buried
  // failures, undefined layers, where's export). 0 = off/done; steps
  // auto-advance on the state they teach, so it's a coach not a wall.
  const [tutStep, setTutStep] = useState(0);

  /** POST a whitelisted operation to the tool side-channel. The panel
   * never authors geometry: every edit is a narrow spec operation the
   * engine re-verifies, identical to the model's tool path. */
  async function opPost(tool: string, args: Record<string, unknown>): Promise<any> {
    const port = window.localStorage.getItem('truss_gltf_port') ?? '8714';
    const r = await fetch(`http://127.0.0.1:${port}/op`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args }),
    });
    return r.json();
  }

  // the guided mission: each step teaches by pointing at a real control
  // and (where it can) auto-advances when the user does the thing. `done`
  // reads live state; steps without `done` advance on the Next button.
  const TUT_STEPS: Array<{ text: string; done?: () => boolean }> = [
    { text: 'Welcome. This workbench shows a spacecraft concept across its whole lifecycle in 3D — drag to orbit it. You design in plain language in the chat; the deterministic engine checks every configuration. This 9-step tour takes a couple of minutes.' },
    { text: 'Top-right is the ENGINE\'s verdict — FITS or DOES NOT FIT — with a "placeholder-graded" count (findings checked against stand-in envelope data). The chat only AUTHORS the design; the deterministic engine judges it. That split is why you can trust the verdict.' },
    { text: 'The buttons above the 3D view switch lifecycle configurations — stowed, deployed, and (for two-launch designs) pre_dock and mated. These folds and deployments came from motions someone DESCRIBED in the chat — they are not fixed demo states. Click through to watch them, then you\'ll author your own.',
      done: () => active !== '' && active !== scenes[0] },
    { text: 'Now make your own motion. In the chat, type: "add an instrument boom that folds flat against the bus for launch and swings out 90° when deployed." Watch a new part appear and animate across the stowed→deployed buttons — you described intent in plain English and the engine BUILT and swept the motion. That is the difference between a viewer and a workbench. Then make it yours — try a mast that extends, or a panel that hinges.' },
    { text: 'Open the CONSTRAINTS tab. Findings group by layer: geometry (true at any scale), declared intent (optics/motion you declared), and disciplines (advisory). Any FAILURE is hoisted to the red "must fix" strip on top.',
      done: () => mode === 'constraints' },
    { text: 'Notice every fairing fit says "needs SME verification" — those are the PLACEHOLDER envelopes the badge counted. The honest rule: trust the relative margins and what\'s driving them, verify the absolute numbers with a real envelope. Click a finding to outline its parts.' },
    { text: 'The "window" button is the one to remember: it turns a red X into an actionable RANGE, sweeping a dimension to show where the design still fits. The EDIT tab is for that fine-tuning — pick a part in the 3D view, change a dimension, and the engine RE-VERIFIES (nothing is moved by hand). Chat ADDS and composes parts and their motion; Edit tunes what is already there.',
      done: () => mode === 'edit' },
    { text: 'Open the DEPLOY tab and press play: the mated scene plays the whole mission end to end — deploys, the docking descent, post-mate stages — with live clearance readouts.',
      done: () => mode === 'deploy' },
    { text: 'When you\'re ready to hand geometry to CAD, "export STEP" (top-right) writes one AP214 file per configuration. That closes the loop: you author in plain language, the engine judges every state, you export. You\'re set — go build.' },
  ];

  function endTour() {
    setTutStep(0);
    try { window.localStorage.setItem('truss_wb_tut_v1', 'done'); } catch { /* ok */ }
  }

  // start the tour on the FIRST design a new user ever loads (once)
  useEffect(() => {
    if (tutStep === 0 && scenes.length > 0) {
      let done = 'done';
      try { done = window.localStorage.getItem('truss_wb_tut_v1') ?? ''; } catch { /* ok */ }
      if (done !== 'done') { setTutStep(1); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes.length]);

  // auto-advance is EDGE-triggered: capture whether the step's condition
  // was ALREADY satisfied when it opened, and only advance on a
  // false->true transition. A level-triggered check advanced immediately
  // whenever a step opened already-satisfied (starting on step 2, and
  // double-jumping on Next). A step with no `done` never auto-advances.
  const tutBaseRef = useRef(true);
  useEffect(() => {
    if (tutStep >= 1 && tutStep <= TUT_STEPS.length) {
      const cond = TUT_STEPS[tutStep - 1].done;
      tutBaseRef.current = cond ? cond() : true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutStep]);
  useEffect(() => {
    if (tutStep < 1 || tutStep > TUT_STEPS.length) { return; }
    const cond = TUT_STEPS[tutStep - 1].done;
    if (cond && !tutBaseRef.current && cond()) {
      const t = setTimeout(() => setTutStep((s) => Math.min(s + 1, TUT_STEPS.length + 1)), 700);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, active, scenes.length]);

  async function exportStep() {
    setExporting(true);
    setStepLinks([]);
    try {
      const r = await opPost('export_step', {});
      // the tool returns lines like "- stowed.step (7 solids, 42 KB): <url>"
      const links: Array<{ name: string; url: string; kb: number }> = [];
      for (const ln of String(r.text ?? '').split('\n')) {
        const m = ln.match(/^- (\S+\.step) \((\d+) solids, (\d+) KB\): (\S+)$/);
        if (m) {
          links.push({ name: m[1], kb: parseInt(m[3], 10), url: m[4] });
        }
      }
      setStepLinks(links);
      if (!links.length) {
        setStatus(String(r.text ?? 'export failed').slice(0, 200));
      }
    } catch {
      setStatus('STEP export failed (is a design loaded?)');
    } finally {
      setExporting(false);
    }
  }

  // lazy corpus fetch the first time the constraints tab opens
  useEffect(() => {
    if (mode !== 'constraints' || corpus) {
      return;
    }
    const port = window.localStorage.getItem('truss_gltf_port') ?? '8714';
    fetch(`http://127.0.0.1:${port}/corpus.json`)
      .then((r) => r.json())
      .then((j) => setCorpus(j.constraints ?? {}))
      .catch(() => setCorpus({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // edit mode follows the first picked part
  const editTarget = picks.length ? picks[0].component : '';
  useEffect(() => {
    if (mode !== 'edit' || !editTarget) {
      setDims(null);
      return;
    }
    setDims(null);
    setDimWin(null);
    setOpStatus('');
    opPost('dimensions', { component: editTarget }).then((r) => {
      if (r.ok) {
        setDims(r.data);
        const init: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.data.dims ?? {})) {
          init[k] = v == null ? '' : String(v);
        }
        setDimEdits(init);
      } else {
        setOpStatus(r.text);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editTarget]);

  async function applyDim(param: string) {
    const v = parseFloat(dimEdits[param]);
    if (!isFinite(v)) {
      return;
    }
    setBusyOp(param);
    const r = await opPost('set_dimension', {
      component: dims.component,
      parameter: param,
      value: v,
    });
    setBusyOp('');
    setOpStatus(r.text.split('\n')[0]);
    // geometry + findings reload via the /latest.json poll on the new stamp
  }

  async function windowDim(param: string) {
    const v = parseFloat(dimEdits[param]) || 1;
    setBusyOp('win:' + param);
    const r = await opPost('find_window', {
      component: dims.component,
      parameter: param,
      low: Math.max(0.01, v * 0.25),
      high: Math.max(v * 2.5, v + 1),
      samples: 7,
    });
    setBusyOp('');
    if (r.ok) {
      setDimWin({ param, low: Math.max(0.01, v * 0.25), high: Math.max(v * 2.5, v + 1), res: r.data });
    } else {
      setOpStatus(r.text.split('\n')[0]);
    }
  }

  async function sendFeedback(rating: number, comment?: string) {
    const port = window.localStorage.getItem('truss_gltf_port') ?? '8714';
    try {
      await fetch(`http://127.0.0.1:${port}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment }),
      });
    } catch {
      /* corpus is best-effort */
    }
  }

  useEffect(() => {
    return () => {
      const c = ctx.current;
      if (c.raf) {
        cancelAnimationFrame(c.raf);
      }
      if (c.playRaf) {
        cancelAnimationFrame(c.playRaf);
      }
      if (c.renderer) {
        c.renderer.dispose();
      }
      if (c.obs) {
        c.obs.disconnect();
      }
    };
  }, []);

  // auto-load from the truss MCP side-channel: when a pack_concept tool
  // call publishes new geometry, the panel picks it up within ~3 s -
  // spike wiring; the production path is a message/artifact renderer hook
  useEffect(() => {
    // dev override so a second tool instance (tests, demos) can feed the
    // panel without disturbing the host-owned default channel
    const port = window.localStorage.getItem('truss_gltf_port') ?? '8714';
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/latest.json`);
        if (!r.ok) {
          return;
        }
        const j = await r.json();
        if (j.stamp && j.stamp !== ctx.current.lastStamp) {
          ctx.current.lastStamp = j.stamp;
          const g = await fetch(j.url);
          loadText(`${j.spec_name} (${j.verdict})`, await g.text());
          setRated('');
          setWhy('');
          setVerdict(j.verdict ?? '');
          setFindingIx(-1);
          ctx.current.findingSel = null;
          // findings ride a sibling content-addressed JSON so the poll
          // stays small; older servers just have no constraints data
          if (j.findings_url) {
            try {
              const fr = await fetch(j.findings_url);
              const fd = await fr.json();
              setFindings(fd.findings ?? []);
            } catch {
              setFindings([]);
            }
          } else {
            setFindings([]);
          }
        }
      } catch {
        /* no tool server running - the file input still works */
      }
    }, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFile(file: File) {
    loadText(file.name, await file.text());
  }

  async function loadText(name: string, text: string) {
    setStatus(`parsing ${name}…`);
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
    new GLTFLoader().parse(
      text,
      '',
      (gltf: any) => {
        const c = ctx.current;
        c.THREE = THREE;
        c.gltf = gltf;
        if (!c.renderer && mountRef.current) {
          const el = mountRef.current;
          c.renderer = new THREE.WebGLRenderer({ antialias: true });
          c.renderer.setPixelRatio(window.devicePixelRatio);
          el.appendChild(c.renderer.domElement);
          c.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
          c.camera.up.set(0, 0, 1); // domain worlds are z-up
          c.controls = new OrbitControls(c.camera, c.renderer.domElement);
          const fit = () => {
            const w = el.clientWidth || 300;
            const h = Math.max(el.clientHeight, 260);
            c.renderer.setSize(w, h);
            c.camera.aspect = w / h;
            c.camera.updateProjectionMatrix();
          };
          fit();
          c.obs = new ResizeObserver(fit);
          c.obs.observe(el);
          c.renderer.domElement.addEventListener('pointerdown', (ev: PointerEvent) => {
            c.downAt = [ev.clientX, ev.clientY];
          });
          c.renderer.domElement.addEventListener('pointerup', (ev: PointerEvent) => {
            const d = c.downAt
              ? Math.hypot(ev.clientX - c.downAt[0], ev.clientY - c.downAt[1])
              : 99;
            if (d < 5) {
              pick(ev);
            }
          });
          // double-click a feature -> reference it straight into the chat
          // (per the active selector: part / edge / point). No "-> message"
          // step needed; each double-click appends one reference.
          c.renderer.domElement.addEventListener('dblclick', (ev: PointerEvent) => {
            const rec = resolvePick(ev);
            if (!rec) {
              return;
            }
            setPicks((prev) => {
              const has = prev.some(
                (p) => p.component === rec.component && p.entity === rec.entity && p.scene === rec.scene,
              );
              const next = has ? prev : [...prev, rec];
              rebuildOverlay(next);
              return next;
            });
            insertOneRef(rec);
          });
          const loop = () => {
            c.raf = requestAnimationFrame(loop);
            if (c.scene) {
              c.controls.update();
              c.renderer.render(c.scene, c.camera);
            }
          };
          loop();
        }
        // the mention matcher's vocabulary: every component id and
        // canonical entity id in the model (envelopes are scenery -
        // a cited fairing would just box the whole view)
        const compIds = new Set<string>();
        const entIds = new Map<string, Set<string>>();
        for (const s of gltf.scenes) {
          s.traverse((o: any) => {
            const ud = o.userData || {};
            if (ud.id && !ud.envelope) {
              compIds.add(ud.id);
              if (ud.entities) {
                const set = entIds.get(ud.id) ?? new Set<string>();
                for (const e of ud.entities) {
                  set.add(e.id);
                }
                entIds.set(ud.id, set);
              }
            }
          });
        }
        c.compIds = compIds;
        c.entIds = entIds;
        c.mentions = [];
        c.lastMentionText = null; // rescan against the fresh vocabulary
        const labels = gltf.scenes.map(
          (s: any) => (s.userData && s.userData.label) || s.name || 'scene',
        );
        setScenes(labels);
        setStatus(`${name}: ${gltf.scenes.length} configurations`);
        const first = (gltf.scene.userData && gltf.scene.userData.label) || labels[0];
        showScene(first);
      },
      (err: any) => setStatus(`glTF parse failed: ${err}`),
    );
  }

  function sceneByLabel(label: string) {
    const c = ctx.current;
    return (
      c.gltf.scenes.find((s: any) => ((s.userData && s.userData.label) || s.name) === label) ||
      c.gltf.scene
    );
  }

  function showScene(label: string) {
    const c = ctx.current;
    const THREE = c.THREE;
    const scene = sceneByLabel(label);
    if (!scene.userData._lit) {
      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const sun = new THREE.DirectionalLight(0xffffff, 2.0);
      sun.position.set(4, -8, 6);
      scene.add(sun);
      scene.background = new THREE.Color(0x14181e);
      scene.userData._lit = true;
    }
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    c.sceneSize = size;
    c.activeLabel = label; // pick() runs in a listener: read via ref, not state
    c.camera.position.set(center.x + size * 0.8, center.y - size * 0.8, center.z + size * 0.5);
    c.controls.target.copy(center);
    c.scene = scene;
    setActive(label);
    rebuildOverlay(picks); // re-show highlights for picks made in this scene
    rebuildMentionOverlay(); // reply citations follow the active scene
    rebuildFindingOverlay(); // a clicked finding's outlines follow too

    const seen = new Map<string, string>();
    const compColor = new Map<string, string>();
    // logical-unit grouping (engine extras.unit = {id, kind}): a generator's
    // members (fold panels, mosaic segments) collapse to ONE legend entry and
    // ONE deployment row instead of N loose parts.
    const compUnit = new Map<string, { id: string; kind?: string }>();
    const unitMeta = new Map<string, { kind?: string; count: number }>();
    scene.traverse((o: any) => {
      const ud = o.userData || {};
      if (ud.system && ud.system_color && !ud.envelope) {
        if (!seen.has(ud.system)) {
          seen.set(ud.system, ud.system_color);
        }
        if (ud.id) {
          compColor.set(ud.id, ud.system_color);
          if (ud.unit && ud.unit.id) {
            compUnit.set(ud.id, ud.unit);
          }
        }
        const meta = unitMeta.get(ud.system) || { count: 0 };
        meta.count += 1;
        if (ud.unit && ud.unit.kind) {
          meta.kind = ud.unit.kind;
        }
        unitMeta.set(ud.system, meta);
      }
    });
    setLegend(
      [...seen.entries()].map(([system, color]) => ({
        system,
        color,
        kind: unitMeta.get(system)?.kind,
        count: unitMeta.get(system)?.count ?? 1,
      })),
    );
    c.compColor = compColor;
    c.compUnit = compUnit;

    // deployment: per-t clearance curves ride the scene extras; the
    // animation (if any) is named after the scene label
    c.deployCurves = (scene.userData && scene.userData.deployment) || null;
    stopPlay();
    if (c.mixer) {
      c.mixer.stopAllAction();
      c.mixer = null;
    }
    const anims = (c.gltf && c.gltf.animations) || [];
    const clip = anims.find(
      (a: any) => a.name === `deploy · ${label}` || a.name.endsWith(label),
    );
    if (clip) {
      c.mixer = new THREE.AnimationMixer(scene);
      c.mixer.clipAction(clip).play();
      c.clipDur = clip.duration || 1;
      seekT(c, 1); // rest at the deployed pose (avoid the loop-wrap at t=dur)
      c.lastDeployT = 1;
      setHasDeploy(true);
      setDeployT(1);
      buildStrip();
      buildSteps();
      if (c.ghostOn) {
        buildGhost();
      }
    } else {
      clearGhost();
      setHasDeploy(false);
      setStripBg('');
      setInterferences([]);
      setSteps([]);
    }
  }

  /** Enumerate the active configuration's deploy steps (one per stage /
   * chain leg), in play order, each mapped to the timeline window it
   * animates in and its tightest clearance - the "view all steps for
   * this payload" list. */
  function buildSteps() {
    const c = ctx.current;
    const curves = (c.deployCurves as any[] | null) ?? [];
    const compColor: Map<string, string> = c.compColor ?? new Map();
    const rows = curves
      .map((cv) => {
        const [w0, w1] = (cv.window as [number, number] | undefined) ?? [0, 1];
        const pts = (cv.curve || []).filter((p: any) => p[1] != null);
        const intersects = (cv.intervals ?? []).length > 0;
        let clear: number | null = null;
        let localWorst = 1;
        if (pts.length) {
          let best = Infinity;
          for (const [t, d] of pts) {
            if (d < best) {
              best = d;
              localWorst = t;
            }
          }
          clear = best;
        }
        // jump to the interference start if any, else the tightest moment
        const localJump = intersects ? cv.intervals[0].t[0] : localWorst;
        const leg = cv.leg ? ` leg ${cv.leg}/${cv.legs}` : '';
        return {
          label: `${cv.component}${leg}`,
          component: cv.component as string,
          w0,
          w1,
          jumpT: w0 + localJump * (w1 - w0),
          clear: intersects ? null : clear,
          color: compColor.get(cv.component) ?? '#8a8a8a',
        };
      })
      .sort((a, b) => a.w0 - b.w0);
    // collapse a deployable unit's member steps into ONE row (the panels of
    // a solar array deploy together - show them as one assembly, not N rows)
    type Step = (typeof rows)[number] & { members?: string[] };
    const compUnit: Map<string, { id: string; kind?: string }> =
      c.compUnit ?? new Map();
    const groups = new Map<string, Step[]>();
    const collapsed: Step[] = [];
    for (const r of rows) {
      const u = compUnit.get(r.component);
      if (u?.id) {
        if (!groups.has(u.id)) {
          groups.set(u.id, []);
        }
        groups.get(u.id)!.push(r);
      } else {
        collapsed.push(r);
      }
    }
    for (const [unitId, members] of groups) {
      if (members.length === 1) {
        collapsed.push(members[0]);
        continue;
      }
      const anyIntersect = members.some((m) => m.clear == null);
      const clear = anyIntersect
        ? null
        : Math.min(...members.map((m) => m.clear as number));
      const tight = anyIntersect
        ? members.find((m) => m.clear == null)!
        : members.reduce((a, b) => ((a.clear as number) <= (b.clear as number) ? a : b));
      const kind = compUnit.get(members[0].component)?.kind ?? 'unit';
      collapsed.push({
        label: `${unitId} · ${members.length}-panel ${kind}`,
        component: unitId,
        members: members.map((m) => m.component),
        w0: Math.min(...members.map((m) => m.w0)),
        w1: Math.max(...members.map((m) => m.w1)),
        jumpT: tight.jumpT,
        clear,
        color: members[0].color,
      });
    }
    collapsed.sort((a, b) => a.w0 - b.w0);
    setSteps(collapsed);
  }

  function stopPlay() {
    const c = ctx.current;
    c.playing = false;
    if (c.playRaf) {
      cancelAnimationFrame(c.playRaf);
      c.playRaf = 0;
    }
    setPlaying(false);
  }

  /** Play the whole sequenced timeline smoothly to the deployed pose. */
  function togglePlay() {
    const c = ctx.current;
    if (c.playing) {
      stopPlay();
      return;
    }
    if ((c.lastDeployT ?? 1) >= 0.999) {
      scrubDeploy(0); // replay from stowed if resting at deployed
    }
    c.playing = true;
    setPlaying(true);
    const DURATION = 6000; // ms for the full sequence
    let last = performance.now();
    const step = (now: number) => {
      if (!c.playing) {
        return;
      }
      const t = Math.min((c.lastDeployT ?? 0) + (now - last) / DURATION, 1);
      last = now;
      scrubDeploy(t);
      if (t >= 1) {
        stopPlay();
        return;
      }
      c.playRaf = requestAnimationFrame(step);
    };
    c.playRaf = requestAnimationFrame(step);
  }

  /** The clearance strip: engine-sampled clearance along the whole
   * sequence as a color band (red = interference interval, amber =
   * tight), clickable to jump the scrubber to that moment. */
  function buildStrip() {
    const curves = ctx.current.deployCurves as any[] | null;
    if (!curves || curves.length === 0) {
      setStripBg('');
      setInterferences([]);
      return;
    }
    const N = 96;
    const stops: string[] = [];
    for (let i = 0; i < N; i++) {
      const v = clearanceAt(i / (N - 1));
      const col =
        v == null ? '#4b5563' : v <= 1e-6 ? '#dc2626' : v < 0.15 ? '#d97706' : '#57755a';
      stops.push(`${col} ${(i / N) * 100}%`, `${col} ${((i + 1) / N) * 100}%`);
    }
    setStripBg(`linear-gradient(to right, ${stops.join(',')})`);
    const segs: Array<[number, number, string]> = [];
    for (const c of curves) {
      const [w0, w1] = (c.window as [number, number] | undefined) ?? [0, 1];
      for (const iv of c.intervals ?? []) {
        segs.push([
          w0 + iv.t[0] * (w1 - w0),
          w0 + iv.t[1] * (w1 - w0),
          `${c.component} × ${iv.other}`,
        ]);
      }
    }
    setInterferences(segs);
  }

  // Seek the deploy mixer without hitting the loop-wrap: setTime(duration)
  // on a looping clip wraps back to the stowed pose, so hold just shy of
  // the end when t reaches 1 (visually the fully deployed frame).
  function seekT(c: any, t: number) {
    if (!c.mixer) {
      return;
    }
    const dur = c.clipDur ?? 1;
    const tt = Math.min(Math.max(t, 0), 1);
    c.mixer.setTime(tt >= 1 ? dur - 1e-4 : tt * dur);
  }

  function scrubDeploy(t: number) {
    setDeployT(t);
    const c = ctx.current;
    c.lastDeployT = t;
    seekT(c, t);
  }

  function clearGhost() {
    const c = ctx.current;
    if (c.ghostGroup && c.ghostGroup.parent) {
      c.ghostGroup.parent.remove(c.ghostGroup);
    }
    c.ghostGroup = null;
  }

  /** The swept volume as a picture: translucent copies of every moving
   * part at sampled points of the timeline - the keep-out corridor a
   * deployment needs, visible at a glance. */
  function buildGhost() {
    const c = ctx.current;
    const THREE = c.THREE;
    clearGhost();
    if (!c.scene || !c.mixer) {
      return;
    }
    const meshes: any[] = [];
    c.scene.traverse((o: any) => {
      if (o.isMesh && o.userData && o.userData.id && !o.userData.envelope) {
        meshes.push(o);
      }
    });
    const K = 8;
    const samples: Map<any, any[]> = new Map(meshes.map((m) => [m, []]));
    for (let k = 0; k < K; k++) {
      seekT(c, k / (K - 1));
      c.scene.updateMatrixWorld(true);
      for (const m of meshes) {
        samples.get(m)!.push(m.matrixWorld.clone());
      }
    }
    seekT(c, c.lastDeployT ?? 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7d8fa5,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
    });
    const group = new THREE.Group();
    for (const m of meshes) {
      const mats = samples.get(m)!;
      if (mats.every((mx) => mx.equals(mats[0]))) {
        continue; // static part: no corridor
      }
      for (const mx of mats) {
        const g = new THREE.Mesh(m.geometry, mat);
        g.matrixAutoUpdate = false;
        g.matrix.copy(mx);
        g.raycast = () => undefined; // ghosts are scenery, never pickable
        group.add(g);
      }
    }
    c.scene.add(group);
    c.ghostGroup = group;
  }

  /** Engine-sampled clearance at scrub position t: tightest across the
   * scene's deployment stages, interpolated between the sweep samples. */
  function clearanceAt(t: number): number | null {
    const curves = ctx.current.deployCurves as any[] | null;
    if (!curves || curves.length === 0) {
      return null;
    }
    let worst: number | null = null;
    for (const c of curves) {
      const pts = (c.curve || []).filter((p: any) => p[1] != null);
      if (!pts.length) {
        continue;
      }
      // sequenced timeline: each stage animates inside its window and
      // holds its start/final pose outside it - map global t to the
      // stage-local motion parameter before sampling its curve
      const [w0, w1] = (c.window as [number, number] | undefined) ?? [0, 1];
      const lt = Math.min(Math.max((t - w0) / (w1 - w0 || 1), 0), 1);
      let v = pts[pts.length - 1][1];
      if (lt <= pts[0][0]) {
        v = pts[0][1];
      } else {
        for (let i = 1; i < pts.length; i++) {
          if (lt <= pts[i][0]) {
            const [t0, d0] = pts[i - 1];
            const [t1, d1] = pts[i];
            v = d0 + ((d1 - d0) * (lt - t0)) / (t1 - t0 || 1);
            break;
          }
        }
      }
      if (worst == null || v < worst) {
        worst = v;
      }
    }
    return worst;
  }

  function clearOverlay() {
    const c = ctx.current;
    if (c.overlay && c.overlay.parent) {
      c.overlay.parent.remove(c.overlay);
    }
    c.overlay = null;
  }

  /** Redraw highlights for every pick made in the ACTIVE scene. */
  function rebuildOverlay(list: PickEntry[]) {
    const c = ctx.current;
    const THREE = c.THREE;
    clearOverlay();
    if (!c.scene) {
      return;
    }
    const group = new THREE.Group();
    for (const p of list) {
      if (p.scene !== c.activeLabel) {
        continue; // picked in another configuration
      }
      let node: any = null;
      c.scene.traverse((o: any) => {
        if (!node && o.userData && o.userData.id === p.component) {
          node = o;
        }
      });
      if (!node) {
        continue;
      }
      if (p.entity) {
        const e = (node.userData.entities || []).find((x: any) => x.id === p.entity);
        if (e) {
          group.add(entityOverlay(THREE, e, c.sceneSize));
        }
      } else {
        group.add(new THREE.Box3Helper(new THREE.Box3().setFromObject(node), ACCENT));
      }
    }
    c.scene.add(group);
    c.overlay = group;
  }

  function clearFindingOverlay() {
    const c = ctx.current;
    if (c.findingOverlay && c.findingOverlay.parent) {
      c.findingOverlay.parent.remove(c.findingOverlay);
    }
    c.findingOverlay = null;
  }

  /** Severity-colored outlines for the components a clicked finding
   * names (red FAIL / amber WARN / green PASS) - the constraints tab's
   * bridge into the viewport. */
  function rebuildFindingOverlay() {
    const c = ctx.current;
    const THREE = c.THREE;
    clearFindingOverlay();
    const sel = c.findingSel;
    if (!c.scene || !sel || sel.ids.length === 0) {
      return;
    }
    const group = new THREE.Group();
    for (const id of sel.ids) {
      let node: any = null;
      c.scene.traverse((o: any) => {
        if (!node && o.userData && o.userData.id === id) {
          node = o;
        }
      });
      if (node) {
        group.add(new THREE.Box3Helper(new THREE.Box3().setFromObject(node), sel.color));
      }
    }
    c.scene.add(group);
    c.findingOverlay = group;
  }

  /** Click a finding row: outline every component it names. Vocabulary-
   * bound like reply mentions - only ids present in the loaded model
   * match, so prose in the detail text can never highlight geometry that
   * does not exist. Clicking the active row clears. */
  function highlightFinding(row: any, ix: number) {
    const c = ctx.current;
    if (!c.compIds) {
      return;
    }
    if (findingIx === ix) {
      setFindingIx(-1);
      c.findingSel = null;
      clearFindingOverlay();
      return;
    }
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const text = `${row.subject ?? ''} ${row.detail ?? ''}`;
    const ids: string[] = [];
    for (const id of c.compIds) {
      if (new RegExp('\\b' + esc(id) + '\\b').test(text)) {
        ids.push(id);
      }
    }
    c.findingSel = {
      ids,
      color: row.status === 'FAIL' ? 0xdc2626 : row.status === 'WARN' ? 0xd97706 : 0x57755a,
    };
    setFindingIx(ix);
    rebuildFindingOverlay();
  }

  function clearMentionOverlay() {
    const c = ctx.current;
    if (c.mentionOverlay && c.mentionOverlay.parent) {
      c.mentionOverlay.parent.remove(c.mentionOverlay);
    }
    c.mentionOverlay = null;
  }

  /** Amber highlights for refs the model cited in its latest reply. */
  function rebuildMentionOverlay() {
    const c = ctx.current;
    const THREE = c.THREE;
    clearMentionOverlay();
    if (!c.scene || !c.mentions || c.mentions.length === 0) {
      return;
    }
    const group = new THREE.Group();
    for (const m of c.mentions) {
      let node: any = null;
      c.scene.traverse((o: any) => {
        if (!node && o.userData && o.userData.id === m.component) {
          node = o;
        }
      });
      if (!node) {
        continue; // not present in this configuration
      }
      if (m.entity) {
        const e = (node.userData.entities || []).find((x: any) => x.id === m.entity);
        if (e) {
          group.add(entityOverlay(THREE, e, c.sceneSize, MENTION));
        }
      } else {
        group.add(new THREE.Box3Helper(new THREE.Box3().setFromObject(node), MENTION));
      }
    }
    c.scene.add(group);
    c.mentionOverlay = group;
  }

  /** Scan the newest assistant turn for component/entity refs so the
   * reply's subjects light up in the view. Vocabulary-bound (only ids
   * that exist in the loaded model match), qualified refs beat whole-
   * part boxes, and bare `edge(...)` refs attach only when exactly one
   * component is in play - no guessing. */
  function scanReplyMentions() {
    const c = ctx.current;
    if (!c.gltf || !c.compIds) {
      return;
    }
    const turns = document.querySelectorAll('main .agent-turn');
    const text = turns.length ? (turns[turns.length - 1].textContent ?? '') : '';
    if (text === c.lastMentionText) {
      return;
    }
    c.lastMentionText = text;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentions: { component: string; entity: string | null }[] = [];
    const seen = new Set<string>();
    const add = (component: string, entity: string | null) => {
      const k = component + '|' + (entity ?? '');
      if (!seen.has(k)) {
        seen.add(k);
        mentions.push({ component, entity });
      }
    };
    for (const mt of text.matchAll(/([A-Za-z_]\w*)\.((?:edge|vertex)\([^)\s]{1,40}\))/g)) {
      if (c.compIds.has(mt[1]) && c.entIds.get(mt[1])?.has(mt[2])) {
        add(mt[1], mt[2]);
      }
    }
    const compsInText: string[] = [];
    for (const id of c.compIds) {
      if (new RegExp('\\b' + esc(id) + '\\b').test(text)) {
        compsInText.push(id);
      }
    }
    if (compsInText.length === 1) {
      for (const mt of text.matchAll(/(?:^|[^.\w])((?:edge|vertex)\([^)\s]{1,40}\))/g)) {
        if (c.entIds.get(compsInText[0])?.has(mt[1])) {
          add(compsInText[0], mt[1]);
        }
      }
    }
    for (const comp of compsInText) {
      if (!mentions.some((m) => m.component === comp && m.entity)) {
        add(comp, null);
      }
    }
    c.mentions = mentions.slice(0, 12); // a reply that names everything highlights nothing useful
    setMentionCount(c.mentions.length);
    rebuildMentionOverlay();
  }

  // reply-reference highlighting: poll the newest assistant turn (DOM
  // spike wiring, like auto-load; production hooks the message stream)
  useEffect(() => {
    const iv = setInterval(scanReplyMentions, 2500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Raycast the cursor to a PickEntry per the active selector mode
   * (part / edge / point), or null if nothing under it. */
  function resolvePick(ev: PointerEvent): PickEntry | null {
    const c = ctx.current;
    const THREE = c.THREE;
    if (!c.scene) {
      return null;
    }
    const rect = c.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, c.camera);
    const hits = ray
      .intersectObjects(c.scene.children, true)
      // the fairing envelope is scenery: pick THROUGH it to the hardware
      .filter((h: any) => h.object.userData && h.object.userData.id && !h.object.userData.envelope);
    if (!hits.length) {
      return null;
    }
    const hit = hits[0];
    const ud = hit.object.userData;
    // the selector tool decides granularity: part = the component;
    // edge/point = the NEAREST canonical entity of that kind on the hit
    // component (explicit modes, so selection is deterministic - no
    // guessing whether a click was "close enough" to an edge)
    const mode = c.selMode ?? 'part';
    let best: any = null;
    if (mode !== 'part') {
      const want = mode === 'edge' ? 'edge' : mode === 'face' ? 'face' : 'vertex';
      let bestD = Infinity;
      for (const e of ud.entities || []) {
        if (e.type !== want) {
          continue;
        }
        const d = entityDistance(THREE, hit.point, e);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
    const entity = best ? (best.id as string) : null;
    return {
      ref: ud.id + (entity ? '.' + entity : ''),
      component: ud.id,
      entity,
      scene: c.activeLabel,
    };
  }

  function pick(ev: PointerEvent) {
    const append = ev.ctrlKey || ev.shiftKey || ev.metaKey;
    const rec = resolvePick(ev);
    if (!rec) {
      if (!append) {
        setPicks([]);
        rebuildOverlay([]);
      }
      return;
    }
    setPicks((prev) => {
      const ix = prev.findIndex(
        (p) => p.component === rec.component && p.entity === rec.entity && p.scene === rec.scene,
      );
      let next: PickEntry[];
      if (append) {
        // ordered sequence: click order mirrors speech order ("this…that…");
        // ctrl-clicking a picked reference unpicks it
        next = ix >= 0 ? prev.filter((_, i) => i !== ix) : [...prev, rec];
      } else {
        next = ix >= 0 && prev.length === 1 ? [] : [rec];
      }
      rebuildOverlay(next);
      return next;
    });
    console.log('[workbench] selection', {
      component: rec.component,
      entity: rec.entity,
      state: rec.scene,
    });
  }

  const methods = useChatFormContext();

  /** Append ONE reference token to the composer (the double-click path). */
  function insertOneRef(rec: PickEntry) {
    if (!methods) {
      return;
    }
    const token = `[selected: ${rec.ref} — in ${rec.scene}]`;
    const cur = (methods.getValues('text') as string) ?? '';
    methods.setValue('text', (cur ? cur.trimEnd() + ' ' : '') + token + ' ', {
      shouldValidate: true,
      shouldDirty: true,
    });
    setTimeout(() => {
      const ta = document.querySelector('form textarea') as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }, 0);
  }

  /** The composer bridge: bound references become model-legible text in
   * the message box - the user types the instruction around them, edits
   * or deletes them like any text, and the ordinals resolve "this…that…". */
  function insertIntoMessage() {
    if (!methods || picks.length === 0) {
      return;
    }
    const tokens =
      picks.length === 1
        ? `[selected: ${picks[0].ref} — in ${picks[0].scene}]`
        : picks.map((p, i) => `[selected ${i + 1}: ${p.ref} — in ${p.scene}]`).join(' ');
    const cur = (methods.getValues('text') as string) ?? '';
    methods.setValue('text', (cur ? cur.trimEnd() + ' ' : '') + tokens + ' ', {
      shouldValidate: true,
      shouldDirty: true,
    });
    // caret to the END so the user's next keystrokes append after the
    // tokens instead of splicing into them (found on camera: a typed
    // instruction interleaved mid-token)
    setTimeout(() => {
      const ta = document.querySelector('form textarea') as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }, 0);
  }

  function removePick(i: number) {
    setPicks((prev) => {
      const next = prev.filter((_, ix) => ix !== i);
      rebuildOverlay(next);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2 text-sm text-text-primary">
      <div className="flex gap-2">
        <label className="flex-1 cursor-pointer rounded-md border border-border-medium p-2 text-center hover:bg-surface-hover">
          load glTF
          <input
            type="file"
            accept=".gltf,.glb,model/gltf+json"
            className="hidden"
            onChange={(e) => e.target.files && e.target.files[0] && loadFile(e.target.files[0])}
          />
        </label>
        {scenes.length > 0 && (
          <button
            type="button"
            disabled={exporting}
            onClick={exportStep}
            title="export STEP (AP214) CAD files for NX/Creo/SolidWorks - the geometry handoff out of the tool"
            className="flex-1 rounded-md border border-border-medium p-2 text-center hover:bg-surface-hover disabled:opacity-50"
          >
            {exporting ? 'exporting…' : 'export STEP'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setTutStep(1)}
          title="guided tour"
          aria-label="guided tour"
          className="rounded-md border border-border-medium px-2 hover:bg-surface-hover"
        >
          ?
        </button>
      </div>
      {tutStep >= 1 && tutStep <= TUT_STEPS.length && (
        <div
          className="rounded-md border border-blue-500/60 bg-surface-secondary p-2 text-xs"
          data-testid="wb-tutorial"
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="font-semibold text-blue-500">
              Guided tour · {tutStep}/{TUT_STEPS.length}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={endTour}
              className="text-text-secondary hover:text-text-primary"
            >
              skip
            </button>
          </div>
          <div className="text-text-primary">{TUT_STEPS[tutStep - 1].text}</div>
          <div className="mt-1.5 flex items-center gap-2">
            {tutStep > 1 && (
              <button
                type="button"
                onClick={() => setTutStep((s) => s - 1)}
                className="rounded border border-border-medium px-2 py-0.5 hover:bg-surface-hover"
              >
                back
              </button>
            )}
            <span className="flex-1" />
            <button
              type="button"
              onClick={() =>
                tutStep >= TUT_STEPS.length ? endTour() : setTutStep((s) => s + 1)
              }
              className="rounded bg-surface-active-alt px-2.5 py-0.5 font-semibold hover:bg-surface-hover"
            >
              {tutStep >= TUT_STEPS.length ? 'finish' : 'next'}
            </button>
          </div>
        </div>
      )}
      {stepLinks.length > 0 && (
        <div className="rounded-md border border-border-medium p-1.5 text-xs" data-testid="wb-step-links">
          <div className="text-text-secondary">STEP files (right-click → save):</div>
          {stepLinks.map((l) => (
            <a
              key={l.url}
              href={l.url}
              download={l.name}
              className="block truncate font-mono text-[11px] text-blue-500 hover:underline"
            >
              {l.name} ({l.kb} KB)
            </a>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="min-w-0 flex-1 truncate">{status}</span>
        {ctx.current.lastStamp != null && rated !== 'sent' && (
          <span className="flex items-center gap-1" data-testid="wb-feedback">
            {rated === '' ? (
              <>
                <button
                  type="button"
                  aria-label="that did what I meant"
                  title="that did what I meant"
                  className="rounded px-1 hover:bg-surface-hover"
                  onClick={() => {
                    sendFeedback(1);
                    setRated('sent');
                  }}
                >
                  👍
                </button>
                <button
                  type="button"
                  aria-label="that is not what I meant"
                  title="that is not what I meant"
                  className="rounded px-1 hover:bg-surface-hover"
                  onClick={() => setRated('down')}
                >
                  👎
                </button>
              </>
            ) : (
              <input
                autoFocus
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    sendFeedback(-1, why);
                    setRated('sent');
                  }
                }}
                placeholder="what went wrong? (Enter)"
                className="w-44 rounded border border-border-medium bg-transparent px-1 py-0.5"
              />
            )}
          </span>
        )}
        {rated === 'sent' && <span title="feedback recorded">✓</span>}
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
      {scenes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {scenes.map((s) => (
            <button
              key={s}
              onClick={() => showScene(s)}
              className={
                'rounded px-2 py-0.5 text-xs ' +
                (s === active
                  ? 'bg-surface-active-alt font-semibold'
                  : 'bg-surface-secondary hover:bg-surface-hover')
              }
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {scenes.length > 0 && (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-text-secondary">select:</span>
          {(['part', 'face', 'edge', 'point'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                ctx.current.selMode = m;
                setSelMode(m);
              }}
              title={
                m === 'point'
                  ? 'nearest corner of the clicked part (smooth solids have no corners - rims are edges)'
                  : m === 'edge'
                    ? 'nearest edge of the clicked part (incl. rims)'
                    : m === 'face'
                      ? 'the clicked FACE of the part (its center + outward normal)'
                      : 'the whole part'
              }
              className={
                'rounded px-2 py-0.5 ' +
                (selMode === m
                  ? 'bg-surface-active-alt font-semibold'
                  : 'bg-surface-secondary hover:bg-surface-hover')
              }
            >
              {m}
            </button>
          ))}
          <span className="text-text-secondary">· ctrl-click adds · double-click → chat</span>
          {mentionCount > 0 && (
            <span className="text-amber-500" title="geometry the reply refers to is outlined in amber">
              · {mentionCount} in reply
            </span>
          )}
        </div>
      )}
      {mode === 'deploy' && hasDeploy && (
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'pause deployment' : 'play deployment'}
            title={playing ? 'pause' : 'play the full deployment sequence'}
            className="rounded px-2 py-0.5 font-mono hover:bg-surface-hover"
            data-testid="wb-deploy-play"
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <div className="flex flex-1 flex-col gap-0.5">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={deployT}
              onChange={(e) => {
                stopPlay();
                scrubDeploy(parseFloat(e.target.value));
              }}
              className="w-full"
              data-testid="wb-deploy-scrub"
            />
            {stripBg && (
              <div
                className="h-1.5 w-full cursor-pointer rounded-sm"
                style={{ background: stripBg }}
                data-testid="wb-deploy-strip"
                title={
                  interferences.length
                    ? 'engine-sampled clearance along the sequence — RED = interference (' +
                      interferences.map((s) => s[2]).join('; ') +
                      '); click to jump'
                    : 'engine-sampled clearance along the sequence; click to jump'
                }
                onClick={(e) => {
                  stopPlay();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  scrubDeploy(Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1));
                }}
              />
            )}
          </div>
          {(() => {
            const v = clearanceAt(deployT);
            if (v == null) {
              return null;
            }
            const cls =
              v <= 1e-6 ? 'text-red-500' : v < 0.15 ? 'text-amber-500' : 'text-text-secondary';
            return (
              <span
                className={cls}
                title="tightest clearance across this configuration's deployment stages at the scrubbed position - engine-sampled, interpolated between samples"
              >
                {v <= 1e-6 ? 'INTERSECTS' : `min clear ${v.toFixed(2)} m`}
              </span>
            );
          })()}
          <button
            type="button"
            onClick={() => {
              const on = !ctx.current.ghostOn;
              ctx.current.ghostOn = on;
              setGhost(on);
              if (on) {
                buildGhost();
              } else {
                clearGhost();
              }
            }}
            title="show the swept volume: translucent copies of every moving part along its motion - the corridor the deployment needs"
            className={
              'rounded px-2 py-0.5 ' +
              (ghost
                ? 'bg-surface-active-alt font-semibold'
                : 'bg-surface-secondary hover:bg-surface-hover')
            }
            data-testid="wb-deploy-ghost"
          >
            ghost
          </button>
        </div>
      )}
      <div ref={mountRef} className="min-h-[280px] flex-1 overflow-hidden rounded-md" />
      {legend.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs"
          data-testid="wb-legend"
          title="one color per major system; twins and mirror segments share their system's color"
        >
          {legend.map((l) => (
            <span key={l.system} className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: l.color }}
              />
              <span className="text-text-secondary">
                {l.system}
                {l.kind && l.count > 1 && (
                  <span className="text-text-tertiary"> ·{l.count} {l.kind}</span>
                )}
              </span>
            </span>
          ))}
        </div>
      )}
      {picks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" data-testid="workbench-picks">
          {picks.map((p, i) => (
            <span
              key={p.ref + p.scene}
              className="flex items-center gap-1 rounded-full border border-border-medium py-0.5 pl-2 pr-1 font-mono text-xs"
              title={`picked in ${p.scene}`}
            >
              {picks.length > 1 && <b className="text-red-500">{i + 1}</b>}
              {p.ref}
              <button
                type="button"
                aria-label={`unbind ${p.ref}`}
                onClick={() => removePick(i)}
                className="px-1 text-text-secondary hover:text-text-primary"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={insertIntoMessage}
            className="rounded-md border border-border-medium px-2 py-0.5 text-xs hover:bg-surface-hover"
            title="insert the bound references into the message box (click = pick, ctrl-click = add in order)"
          >
            → message
          </button>
        </div>
      )}
        </div>
        {mode === 'constraints' && (
          <div
            className="flex w-64 flex-shrink-0 flex-col gap-1 overflow-hidden rounded-md border border-border-medium p-1.5 text-xs"
            data-testid="wb-constraints"
          >
            <div className="flex items-center gap-1">
              {verdict && (
                <span
                  className={
                    'font-semibold ' + (verdict === 'FITS' ? 'text-green-600' : 'text-red-500')
                  }
                >
                  {verdict}
                </span>
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                title="also show PASS findings"
                className={
                  'rounded px-1.5 py-0.5 ' +
                  (showPass
                    ? 'bg-surface-active-alt font-semibold'
                    : 'bg-surface-secondary hover:bg-surface-hover')
                }
              >
                pass
              </button>
              {picks.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelOnly(!selOnly)}
                  title="only findings that name a picked component"
                  className={
                    'rounded px-1.5 py-0.5 ' +
                    (selOnly
                      ? 'bg-surface-active-alt font-semibold'
                      : 'bg-surface-secondary hover:bg-surface-hover')
                  }
                >
                  picked
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {findings.length === 0 && (
                <span className="text-text-secondary">
                  no findings data - run a pack tool (older tool servers do not publish findings)
                </span>
              )}
              {(() => {
                const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // failures-first WITHIN each layer group: the finding that
                // drives DOES-NOT-FIT must never sit below a wall of green
                // PASS rows (blinded-persona round, 2026-07-14). Stable
                // within a severity by keeping the original index order.
                const sev = (s: string) => (s === 'FAIL' ? 0 : s === 'WARN' ? 1 : 2);
                const visible = findings
                  .map((f, i) => [f, i] as [any, number])
                  .filter(([f]) => showPass || f.status !== 'PASS')
                  .filter(
                    ([f]) =>
                      !selOnly ||
                      picks.some((p) =>
                        new RegExp('\\b' + esc(p.component) + '\\b').test(
                          `${f.subject ?? ''} ${f.detail ?? ''}`,
                        ),
                      ),
                  )
                  .sort((a, b) => sev(a[0].status) - sev(b[0].status) || a[1] - b[1]);
                const row = ([f, i]: [any, number]) => (
                  <div
                    key={i}
                    role="button"
                    tabIndex={0}
                    onClick={() => highlightFinding(f, i)}
                    onKeyDown={(e) => e.key === 'Enter' && highlightFinding(f, i)}
                    className={
                      'mb-1 w-full cursor-pointer rounded border px-1.5 py-1 text-left ' +
                      (findingIx === i
                        ? 'border-border-heavy bg-surface-active-alt'
                        : 'border-border-medium hover:bg-surface-hover')
                    }
                  >
                    <div className="flex items-center gap-1">
                      <span
                        className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                        style={{
                          background:
                            f.status === 'FAIL'
                              ? '#dc2626'
                              : f.status === 'WARN'
                                ? '#d97706'
                                : '#57755a',
                        }}
                      />
                      <span className="truncate font-semibold">{f.check}</span>
                      {f.margin != null && (
                        <span
                          className={
                            'ml-auto flex-shrink-0 font-mono ' +
                            (f.margin < 0
                              ? 'text-red-500'
                              : f.margin < 0.15
                                ? 'text-amber-500'
                                : 'text-text-secondary')
                          }
                        >
                          {(f.margin >= 0 ? '+' : '') + f.margin.toFixed(3)} m
                        </span>
                      )}
                    </div>
                    <div className="text-text-secondary">
                      {f.subject}: {f.detail}
                    </div>
                    {f.constraints && f.constraints.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {f.constraints.map((cid: string) => (
                          <button
                            key={cid}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenCid(openCid === cid ? '' : cid);
                            }}
                            title="show this corpus constraint (source-cited; read-only - the corpus changes only through reviewed proposals)"
                            className={
                              'rounded px-1 font-mono text-[10px] ' +
                              (openCid === cid
                                ? 'bg-surface-active-alt font-semibold'
                                : 'bg-surface-secondary text-text-secondary hover:bg-surface-hover')
                            }
                          >
                            {cid}
                          </button>
                        ))}
                      </div>
                    )}
                    {openCid && f.constraints?.includes(openCid) && corpus?.[openCid] && (
                      <div className="mt-1 rounded border border-border-medium bg-surface-secondary p-1 text-[11px]">
                        <div className="flex items-center gap-1">
                          <span className="font-semibold">{corpus[openCid].title}</span>
                          <span className="ml-auto rounded bg-surface-active-alt px-1 text-[10px]">
                            {corpus[openCid].status}
                          </span>
                        </div>
                        {corpus[openCid].statement && (
                          <div className="pt-0.5">{corpus[openCid].statement}</div>
                        )}
                        <div className="pt-0.5 font-mono text-[10px] text-text-secondary">
                          {corpus[openCid].source} · {corpus[openCid].type}
                        </div>
                      </div>
                    )}
                  </div>
                );
                if (!findings.some((f) => f.layer != null)) {
                  return visible.map(row); // older tool server: flat list
                }
                // FAILURES-FIRST STRIP (blinded-persona round: the FAILs that
                // drive DOES-NOT-FIT sat below a wall of green WARN rows, and
                // across-group they can land under any layer). Hoist every
                // failing finding to a strip at the very top, above the
                // layer groups; they still appear in-group below for context.
                const failRows = visible.filter(([f]) => f.status === 'FAIL');
                const failStrip = failRows.length > 0 && (
                  <div key="failstrip" className="mb-2 rounded-md border border-red-500/60 p-1" data-testid="wb-failures">
                    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-500">
                      must fix — {failRows.length} failing
                    </div>
                    {failRows.map(row)}
                  </div>
                );
                // feedback layers: geometry always in view, declared-intent
                // next, disciplines collapsed into the maturity section
                // (WARN = graded against placeholder data, by definition)
                const groups = [
                  { L: 1, label: 'geometry',
                    hint: 'closed-form fit + interference - concept-agnostic, true at any scale' },
                  { L: 2, label: 'declared intent',
                    hint: 'checks this spec opted into by declaring optics / motion / clearance floors' },
                  { L: 3, label: 'disciplines (advisory)',
                    hint: 'corpus-scoped engineering checks, largely on placeholder data - the design-maturity view; click to expand' },
                ];
                const groupEls = groups.map(({ L, label, hint }) => {
                  const rows = visible.filter(([f]) => (f.layer ?? 3) === L);
                  if (!rows.length) {
                    return null;
                  }
                  const fails = rows.filter(([f]) => f.status === 'FAIL').length;
                  const warns = rows.filter(([f]) => f.status === 'WARN').length;
                  const collapsed = L === 3 && !showL3;
                  return (
                    <div key={L} className="mb-1.5" data-testid={`wb-layer-${L}`}>
                      <button
                        type="button"
                        disabled={L !== 3}
                        onClick={() => L === 3 && setShowL3(!showL3)}
                        title={hint}
                        className={
                          'mb-0.5 flex w-full items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-secondary' +
                          (L === 3 ? ' hover:text-text-primary' : '')
                        }
                      >
                        <span>{label}</span>
                        {fails > 0 && <span className="normal-case text-red-500">{fails} fail</span>}
                        {warns > 0 && (
                          <span
                            className="normal-case text-amber-500"
                            title="WARN = graded against placeholder data pending SME confirmation"
                          >
                            {warns} placeholder-graded
                          </span>
                        )}
                        {L === 3 && <span className="ml-auto">{collapsed ? '▸' : '▾'}</span>}
                      </button>
                      {!collapsed && rows.map(row)}
                    </div>
                  );
                });
                return [failStrip, ...groupEls];
              })()}
            </div>
            <span className="text-[10px] text-text-secondary">
              click a finding to outline its parts · WARN = placeholder data
            </span>
          </div>
        )}
        {mode === 'deploy' && (
          <div
            className="flex w-64 flex-shrink-0 flex-col gap-1 overflow-hidden rounded-md border border-border-medium p-1.5 text-xs"
            data-testid="wb-deploy-pane"
          >
            {!hasDeploy ? (
              <span className="text-text-secondary">
                no deployment animation in this configuration - pick one with deploy stages
              </span>
            ) : (
              <>
                <span className="text-text-secondary">
                  steps (click to jump the scrubber):
                </span>
                <div className="min-h-0 flex-1 overflow-y-auto" data-testid="wb-deploy-steps">
                  {steps.map((s, i) => {
                    const stepActive = deployT >= s.w0 - 1e-6 && deployT <= s.w1 + 1e-6;
                    const dot =
                      s.clear == null ? '#dc2626' : s.clear < 0.15 ? '#d97706' : '#57755a';
                    const stepIds = s.members ?? [s.component];
                    const picked = picks.some((p) => stepIds.includes(p.component));
                    return (
                      <button
                        key={s.label + i}
                        type="button"
                        onClick={() => {
                          stopPlay();
                          scrubDeploy(s.jumpT);
                          // cross-tab sync: outline the moving part
                          ctx.current.findingSel = { ids: stepIds, color: ACCENT };
                          setFindingIx(-1);
                          rebuildFindingOverlay();
                        }}
                        title={
                          `${s.label} · ${(s.w0 * 100).toFixed(0)}–${(s.w1 * 100).toFixed(0)}% of the sequence · ` +
                          (s.clear == null
                            ? 'INTERSECTS (jumps to the interference)'
                            : `min clearance ${s.clear.toFixed(2)} m (jumps to the tightest moment)`)
                        }
                        className={
                          'mb-1 flex w-full items-center gap-1 rounded border px-1.5 py-1 text-left font-mono ' +
                          (stepActive
                            ? 'border-border-heavy bg-surface-active-alt'
                            : 'border-border-medium hover:bg-surface-hover') +
                          (picked ? ' border-amber-500' : '')
                        }
                      >
                        <span className="text-text-secondary">{i + 1}</span>
                        <span
                          className="inline-block h-2 w-2 flex-shrink-0 rounded-sm"
                          style={{ background: s.color }}
                        />
                        <span className="min-w-0 flex-1 truncate">{s.label}</span>
                        <span
                          className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                          style={{ background: dot }}
                        />
                        {s.clear != null && (
                          <span className="flex-shrink-0 text-text-secondary">
                            {s.clear.toFixed(2)}m
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[10px] text-text-secondary">
                  scrubber + clearance strip are under the view
                </span>
              </>
            )}
          </div>
        )}
        {mode === 'edit' && (
          <div
            className="flex w-64 flex-shrink-0 flex-col gap-1 overflow-hidden rounded-md border border-border-medium p-1.5 text-xs"
            data-testid="wb-edit-pane"
          >
            {!editTarget ? (
              <span className="text-text-secondary">
                pick a part in the viewport to edit its dimensions - every
                edit re-verifies through the engine, nothing is moved by hand
              </span>
            ) : !dims ? (
              <span className="text-text-secondary">
                loading dimensions of {editTarget}…{opStatus && ` ${opStatus}`}
              </span>
            ) : (
              <>
                <span className="font-semibold">{dims.component}</span>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {Object.entries(dims.dims ?? {}).map(([p, v]) => (
                    <div key={p} className="mb-1.5">
                      <div className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate font-mono">{p}</span>
                        <input
                          type="number"
                          step="0.05"
                          value={dimEdits[p] ?? ''}
                          onChange={(e) =>
                            setDimEdits({ ...dimEdits, [p]: e.target.value })
                          }
                          onKeyDown={(e) => e.key === 'Enter' && applyDim(p)}
                          className="w-20 rounded border border-border-medium bg-transparent px-1 py-0.5 font-mono"
                          data-testid={`wb-dim-${p}`}
                        />
                        <button
                          type="button"
                          disabled={busyOp !== ''}
                          onClick={() => applyDim(p)}
                          title="apply: the engine re-packs and re-verifies; the view and findings update"
                          className="rounded bg-surface-secondary px-1.5 py-0.5 hover:bg-surface-hover disabled:opacity-50"
                        >
                          {busyOp === p ? '…' : 'set'}
                        </button>
                        <button
                          type="button"
                          disabled={busyOp !== ''}
                          onClick={() => windowDim(p)}
                          title="sweep this dimension for its feasible window (a few seconds of re-packs)"
                          className="rounded bg-surface-secondary px-1.5 py-0.5 hover:bg-surface-hover disabled:opacity-50"
                        >
                          {busyOp === 'win:' + p ? '…' : 'window'}
                        </button>
                      </div>
                      {dimWin && dimWin.param === p && (
                        <div className="pt-1">
                          <div
                            className="relative h-2 w-full overflow-hidden rounded-sm"
                            style={{ background: '#7f1d1d' }}
                            title="green = FITS; red = does not fit; white line = current value"
                          >
                            {(dimWin.res.windows ?? []).map((w: any, wi: number) => (
                              <div
                                key={wi}
                                className="absolute h-full"
                                style={{
                                  background: '#57755a',
                                  left: `${(100 * (w.lo - dimWin.low)) / (dimWin.high - dimWin.low)}%`,
                                  width: `${(100 * (w.hi - w.lo)) / (dimWin.high - dimWin.low)}%`,
                                }}
                              />
                            ))}
                            {isFinite(parseFloat(dimEdits[p])) && (
                              <div
                                className="absolute h-full w-0.5 bg-white"
                                style={{
                                  left: `${(100 * (parseFloat(dimEdits[p]) - dimWin.low)) / (dimWin.high - dimWin.low)}%`,
                                }}
                              />
                            )}
                          </div>
                          <div className="pt-0.5 font-mono text-[10px] text-text-secondary">
                            {(dimWin.res.windows ?? []).length
                              ? dimWin.res.windows
                                  .map((w: any) => `[${w.lo.toFixed(2)}, ${w.hi.toFixed(2)}]`)
                                  .join(' ')
                              : 'no feasible value in the swept range'}
                            {' · swept ['}
                            {dimWin.low.toFixed(2)}, {dimWin.high.toFixed(2)}]
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {opStatus && (
                  <span className="truncate font-mono text-[10px]" title={opStatus}>
                    {opStatus}
                  </span>
                )}
                <span className="text-[10px] text-text-secondary">
                  edits are spec operations the engine re-verifies - same
                  verbs the assistant uses
                </span>
              </>
            )}
          </div>
        )}
        {scenes.length > 0 && (
          <div
            className="flex flex-shrink-0 flex-col gap-1 border-l border-border-medium pl-1 text-xs"
            data-testid="wb-tabs"
          >
            {(['constraints', 'deploy', 'edit'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(mode === m ? '' : m)}
                title={
                  m === 'constraints'
                    ? 'the engine findings grading this design, with their corpus constraint ids - click a row to outline its parts'
                    : m === 'deploy'
                      ? 'the deployment sequence: scrubber + clearance overlay on the view, step list in the pane'
                      : 'pick a part, edit its dimensions - every edit re-verifies through the engine; window shows the feasible range'
                }
                className={
                  'flex flex-col items-center gap-1 rounded px-1 py-2 ' +
                  (mode === m
                    ? 'bg-surface-active-alt font-semibold'
                    : 'bg-surface-secondary hover:bg-surface-hover')
                }
              >
                <span style={{ writingMode: 'vertical-rl' } as any}>{m}</span>
                {m === 'constraints' && findings.some((f) => f.status === 'FAIL') && (
                  <span className="text-red-500">
                    {findings.filter((f) => f.status === 'FAIL').length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
