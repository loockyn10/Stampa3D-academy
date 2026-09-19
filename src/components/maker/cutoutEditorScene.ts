import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type * as ClipperLib from "clipper-lib";
import { backCutoutPolygons, validateBackCutoutShape } from "@/lib/maker/geometry/backCutouts";
import {
  backViewCameraPose,
  checkBackCutoutPlacement,
  designToWorld,
  roundMm,
  worldToDesign,
} from "@/lib/maker/backCutoutEditor";
import type { BackCutout } from "@/lib/maker/types";

/**
 * Capa de edición de recortes traseros dentro del MISMO MakerViewport (sin
 * segundo canvas): una cámara ortográfica trasera, controles propios sin
 * rotación y un grupo de HANDLES (helpers semitransparentes, no forman parte
 * de ningún SignPart ni se exportan). Todo el arrastre se resuelve con un rayo
 * contra el plano de la base (Z=0) — milímetros reales del diseño, nunca un
 * delta de píxeles. Ver docs/STAMPA_MAKER.md sección 24.
 */
export interface CutoutEditorState {
  cutouts: BackCutout[];
  selectedId: string | null;
  /** Centro del diseño (origen de X/Y). */
  origin: { x: number; y: number };
  /** Ids inválidos según el estado ya commiteado (durante el drag se recalcula en vivo). */
  invalidIds: Set<string>;
  safeZone: ClipperLib.Paths | null;
  onSelect: (id: string | null) => void;
  /** `final = false` mientras se arrastra (throttled); `true` al soltar (posición exacta final). */
  onMove: (id: string, x: number, y: number, final: boolean) => void;
}

export interface CutoutEditorFrame {
  centerX: number;
  centerY: number;
  centerZ: number;
  width: number;
  height: number;
  depth: number;
}

const COLOR_NORMAL = 0x9aa0aa;
const COLOR_SELECTED = 0xff8a3d;
const COLOR_INVALID = 0xef4444;
const HANDLE_Z = -0.15;
/** Frecuencia máxima con la que el drag hace commit "vivo" al estado de React (ms). El handle se mueve a cada frame por ref. */
const LIVE_COMMIT_INTERVAL_MS = 80;

interface Handle {
  group: THREE.Group;
  fill: THREE.Mesh;
  line: THREE.LineLoop;
  signature: string;
}

export function createCutoutEditor(scene: THREE.Scene, dom: HTMLElement, container: HTMLElement) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20000);
  const controls = new OrbitControls(camera, dom);
  // Cámara fija trasera: sin rotación ni paneo; el zoom con la rueda es natural.
  controls.enableRotate = false;
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.enabled = false;

  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const handles = new Map<string, Handle>();
  const raycaster = new THREE.Raycaster();
  const basePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();

  let active = false;
  let state: CutoutEditorState | null = null;
  let halfHeight = 100;
  let drag: { id: string; offsetX: number; offsetY: number; pointerId: number; lastCommit: number; x: number; y: number; moved: boolean } | null = null;

  function updateFrustum() {
    const aspect = container.clientWidth / Math.max(container.clientHeight, 1) || 1;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  function colorFor(id: string, invalid: boolean): number {
    if (invalid) return COLOR_INVALID;
    return state?.selectedId === id ? COLOR_SELECTED : COLOR_NORMAL;
  }

  function paint(id: string, invalid: boolean) {
    const h = handles.get(id);
    if (!h) return;
    const color = colorFor(id, invalid);
    (h.fill.material as THREE.MeshBasicMaterial).color.setHex(color);
    (h.fill.material as THREE.MeshBasicMaterial).opacity = state?.selectedId === id ? 0.5 : 0.32;
    (h.line.material as THREE.LineBasicMaterial).color.setHex(color);
  }

  function disposeHandle(h: Handle) {
    group.remove(h.group);
    h.fill.geometry.dispose();
    (h.fill.material as THREE.Material).dispose();
    h.line.geometry.dispose();
    (h.line.material as THREE.Material).dispose();
  }

  /** Silueta EXACTA del recorte (misma función que el motor), centrada en su propio origen. */
  function buildHandle(cutout: BackCutout): Handle {
    const polys = backCutoutPolygons({ ...cutout, x: 0, y: 0 } as BackCutout, { x: 0, y: 0 });
    const outer = polys[0];
    const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: COLOR_NORMAL, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthTest: false }),
    );
    fill.renderOrder = 20;
    const lineGeo = new THREE.BufferGeometry().setFromPoints(outer.map(([x, y]) => new THREE.Vector3(x, y, 0)));
    const line = new THREE.LineLoop(lineGeo, new THREE.LineBasicMaterial({ color: COLOR_NORMAL, depthTest: false }));
    line.renderOrder = 21;
    const g = new THREE.Group();
    g.add(fill, line);
    group.add(g);
    fill.userData.cutoutId = cutout.id;
    return { group: g, fill, line, signature: "" };
  }

  function shapeSignature(c: BackCutout): string {
    return JSON.stringify({ ...c, x: 0, y: 0, id: "" });
  }

  /** Sincroniza los handles con el estado: reutiliza meshes; solo reconstruye geometría si cambió la FORMA (no la posición). */
  function sync() {
    if (!state) return;
    const live = new Set<string>();
    for (const c of state.cutouts) {
      if (validateBackCutoutShape(c)) continue; // medidas inválidas: no hay silueta que mostrar (el error ya se ve en la lista)
      live.add(c.id);
      const sig = shapeSignature(c);
      let h = handles.get(c.id);
      if (h && h.signature !== sig) {
        disposeHandle(h);
        handles.delete(c.id);
        h = undefined;
      }
      if (!h) {
        h = buildHandle(c);
        h.signature = sig;
        handles.set(c.id, h);
      }
      if (drag?.id !== c.id) {
        const w = designToWorld({ x: c.x, y: c.y }, state.origin);
        h.group.position.set(w.x, w.y, HANDLE_Z);
        paint(c.id, state.invalidIds.has(c.id));
      }
    }
    for (const [id, h] of handles) {
      if (!live.has(id)) {
        disposeHandle(h);
        handles.delete(id);
      }
    }
  }

  function pointerToNdc(e: PointerEvent) {
    const rect = dom.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function pick(e: PointerEvent): string | null {
    pointerToNdc(e);
    const fills = [...handles.values()].map((h) => h.fill);
    const hits = raycaster.intersectObjects(fills, false);
    return hits.length > 0 ? (hits[0].object.userData.cutoutId as string) : null;
  }

  /** Punto del plano de la base bajo el puntero, en coordenadas de escena; null si el rayo no lo corta. */
  function planePoint(e: PointerEvent): THREE.Vector3 | null {
    pointerToNdc(e);
    return raycaster.ray.intersectPlane(basePlane, hit) ? hit.clone() : null;
  }

  function onPointerDown(e: PointerEvent) {
    if (!active || !state || e.button !== 0) return;
    const id = pick(e);
    if (!id) {
      state.onSelect(null);
      return;
    }
    const p = planePoint(e);
    const h = handles.get(id);
    if (!p || !h) return;
    state.onSelect(id);
    // El offset evita que el handle "salte" al centro del cursor.
    drag = { id, offsetX: h.group.position.x - p.x, offsetY: h.group.position.y - p.y, pointerId: e.pointerId, lastCommit: 0, x: 0, y: 0, moved: false };
    controls.enabled = false;
    try {
      dom.setPointerCapture(e.pointerId);
    } catch {
      /* algunos navegadores lanzan si el puntero ya no está activo */
    }
    dom.style.cursor = "grabbing";
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!active || !state) return;
    if (!drag) {
      dom.style.cursor = pick(e) ? "grab" : "default";
      return;
    }
    if (e.pointerId !== drag.pointerId) return;
    const p = planePoint(e);
    const h = handles.get(drag.id);
    const cutout = state.cutouts.find((c) => c.id === drag!.id);
    if (!p || !h || !cutout) return;
    const wx = p.x + drag.offsetX;
    const wy = p.y + drag.offsetY;
    // Movimiento visual inmediato (por ref, sin pasar por React).
    h.group.position.set(wx, wy, HANDLE_Z);
    const design = worldToDesign({ x: wx, y: wy }, state.origin);
    drag.moved = true;
    drag.x = roundMm(design.x);
    drag.y = roundMm(design.y);
    // Validez en vivo con la misma prueba del motor; sin clamp: la posición inválida se ve en rojo.
    paint(drag.id, !checkBackCutoutPlacement({ ...cutout, x: drag.x, y: drag.y } as BackCutout, state.origin, state.safeZone).valid);
    const now = performance.now();
    if (now - drag.lastCommit >= LIVE_COMMIT_INTERVAL_MS) {
      drag.lastCommit = now;
      state.onMove(drag.id, drag.x, drag.y, false);
    }
  }

  function endDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    try {
      dom.releasePointerCapture(e.pointerId);
    } catch {
      /* ya liberado */
    }
    controls.enabled = active;
    dom.style.cursor = "default";
    // Un simple click (sin mover) solo selecciona: no reescribe la posición.
    if (d.moved) state?.onMove(d.id, d.x, d.y, true);
  }

  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointermove", onPointerMove);
  dom.addEventListener("pointerup", endDrag);
  dom.addEventListener("pointercancel", endDrag);

  return {
    camera,
    controls,
    isActive: () => active,
    /** Entra al modo: cámara trasera ortográfica perpendicular a la base, centrada en el diseño. */
    enter(frame: CutoutEditorFrame) {
      active = true;
      group.visible = true;
      halfHeight = Math.max(frame.height / 2, frame.width / 2 / Math.max(container.clientWidth / Math.max(container.clientHeight, 1), 0.1), 1) * 1.25;
      const distance = Math.max(frame.width, frame.height, frame.depth, 1) * 3;
      const pose = backViewCameraPose({ x: frame.centerX, y: frame.centerY, z: frame.centerZ }, distance);
      camera.zoom = 1;
      camera.position.set(...pose.position);
      camera.up.set(...pose.up);
      camera.near = 0.1;
      camera.far = distance * 2 + frame.depth + 100;
      controls.target.set(...pose.target);
      camera.lookAt(...pose.target);
      updateFrustum();
      controls.enabled = true;
      controls.update();
      sync();
    },
    exit() {
      active = false;
      drag = null;
      group.visible = false;
      controls.enabled = false;
      dom.style.cursor = "default";
    },
    update(next: CutoutEditorState) {
      state = next;
      if (active) sync();
    },
    resize() {
      if (active) updateFrustum();
    },
    dispose() {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", endDrag);
      dom.removeEventListener("pointercancel", endDrag);
      for (const h of handles.values()) disposeHandle(h);
      handles.clear();
      controls.dispose();
      scene.remove(group);
    },
  };
}

export type CutoutEditor = ReturnType<typeof createCutoutEditor>;
