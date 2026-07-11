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
  const [selMode, setSelMode] = useState<'part' | 'edge' | 'point'>('part');
  const [status, setStatus] = useState('Load a .gltf (truss: pack --out writes packed.gltf)');
  // feedback widget: shown after a tool publishes geometry; the
  // model-independent channel that calibrates the in-band record_feedback
  // tool (widget-negatives without a tool-filed negative = under-reporting)
  const [rated, setRated] = useState<'' | 'up' | 'down' | 'sent'>('');
  const [why, setWhy] = useState('');
  const [mentionCount, setMentionCount] = useState(0);

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

  function pick(ev: PointerEvent) {
    const c = ctx.current;
    const THREE = c.THREE;
    if (!c.scene) {
      return;
    }
    const append = ev.ctrlKey || ev.shiftKey || ev.metaKey;
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
      if (!append) {
        setPicks([]);
        rebuildOverlay([]);
      }
      return;
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
      const want = mode === 'edge' ? 'edge' : 'vertex';
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
    const rec: PickEntry = {
      ref: ud.id + (entity ? '.' + entity : ''),
      component: ud.id,
      entity,
      scene: c.activeLabel,
    };
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
      <label className="cursor-pointer rounded-md border border-border-medium p-2 text-center hover:bg-surface-hover">
        load glTF
        <input
          type="file"
          accept=".gltf,.glb,model/gltf+json"
          className="hidden"
          onChange={(e) => e.target.files && e.target.files[0] && loadFile(e.target.files[0])}
        />
      </label>
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
          {(['part', 'edge', 'point'] as const).map((m) => (
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
          <span className="text-text-secondary">· ctrl-click adds in order</span>
          {mentionCount > 0 && (
            <span className="text-amber-500" title="geometry the reply refers to is outlined in amber">
              · {mentionCount} in reply
            </span>
          )}
        </div>
      )}
      <div ref={mountRef} className="min-h-[280px] flex-1 overflow-hidden rounded-md" />
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
  );
}
