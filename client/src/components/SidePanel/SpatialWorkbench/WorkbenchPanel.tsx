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

function entityOverlay(THREE: any, e: any, size: number): any {
  const mat = new THREE.LineBasicMaterial({ color: ACCENT });
  if (e.type === 'vertex' && e.point) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.012, 12, 12),
      new THREE.MeshBasicMaterial({ color: ACCENT }),
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
  const [status, setStatus] = useState('Load a .gltf (truss: pack --out writes packed.gltf)');

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
      .filter((h: any) => h.object.userData && h.object.userData.id);
    if (!hits.length) {
      if (!append) {
        setPicks([]);
        rebuildOverlay([]);
      }
      return;
    }
    const hit = hits[0];
    const ud = hit.object.userData;
    // nearest canonical sub-entity to the hit point, threshold ~ scene scale
    let best: any = null;
    let bestD = Math.max(0.05, c.sceneSize * 0.02);
    for (const e of ud.entities || []) {
      const d = entityDistance(THREE, hit.point, e);
      if (d < bestD) {
        bestD = d;
        best = e;
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
    (document.querySelector('form textarea') as HTMLTextAreaElement | null)?.focus();
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
      <div className="text-xs text-text-secondary">{status}</div>
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
