"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LetterGeometryResult, PartKind } from "@/lib/maker/types";
import { letterGeometryToBufferGeometry } from "@/lib/maker/geometry/toBufferGeometry";
import { DEFAULT_EXPLOSION_AMOUNT, computeExplodeOffsetMm, computeExplodeRanks } from "@/lib/maker/geometry/explodeOrder";
import { placementMatrix, type BedItem, type BedLayout } from "@/lib/maker/printBed/bedLayout";
import type { PrinterProfile } from "@/lib/maker/printBed/printerProfiles";
import { createCutoutEditor, type CutoutEditor, type CutoutEditorState } from "@/components/maker/cutoutEditorScene";

export type MakerDisplayMode = "model" | "bed";

export interface MakerBedView {
  items: BedItem[];
  layout: BedLayout;
  profile: PrinterProfile;
  /** 1-based. */
  plateIndex: number;
}

interface MakerViewportProps {
  geometry: LetterGeometryResult | null;
  /** "model": objeto flotando sobre fondo neutro, sin grid. "bed": cama de impresión con las piezas orientadas y acomodadas. */
  displayMode?: MakerDisplayMode;
  /** Separación 0-100 (solo visual; única fuente: 0 = ensamblado). Desplaza las piezas no-"body" hacia adelante en la escena, sin tocar la geometría exportada. */
  explosionAmount?: number;
  bed?: MakerBedView | null;
  /** Modo Editar recortes (solo Model View): cámara trasera ortográfica + handles arrastrables. null/undefined = modo apagado. */
  cutoutEditing?: CutoutEditorState | null;
}

/** Color por tipo de pieza, solo para diferenciarlas visualmente en el preview (no es el color real de impresión). */
const PART_COLORS: Record<PartKind, number> = {
  body: 0xd8d8dc,
  lid: 0xffb066,
  mask: 0x6b6f76,
  diffuser: 0xfff3d6,
  channelDiffuser: 0xfff3d6,
};

type CameraState = { position: THREE.Vector3; target: THREE.Vector3 };

function makeMaterial(kind: PartKind): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: PART_COLORS[kind],
    roughness: kind === "body" ? 0.65 : 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
}

function clearGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((obj) => {
      const disposable = obj as THREE.Mesh | THREE.LineSegments;
      disposable.geometry?.dispose();
      const mat = disposable.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }
}

/** Grid en milímetros (línea cada 10 mm, más marcada cada 50 mm) + contorno físico, en el plano Z=0 de la cama. */
function buildBedPlate(profile: PrinterProfile): THREE.Object3D {
  const group = new THREE.Group();
  const W = profile.widthMm;
  const D = profile.depthMm;

  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshBasicMaterial({ color: 0x15171b, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  surface.position.set(W / 2, D / 2, -0.15);
  group.add(surface);

  const minor: number[] = [];
  const major: number[] = [];
  for (let x = 0; x <= W + 1e-6; x += 10) (x % 50 === 0 ? major : minor).push(x, 0, 0, x, D, 0);
  for (let y = 0; y <= D + 1e-6; y += 10) (y % 50 === 0 ? major : minor).push(0, y, 0, W, y, 0);
  const lines = (points: number[], color: number, opacity: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  };
  group.add(lines(minor, 0x3a3e46, 0.7));
  group.add(lines(major, 0x5a606b, 0.9));
  group.add(lines([0, 0, 0, W, 0, 0, W, 0, 0, W, D, 0, W, D, 0, 0, D, 0, 0, D, 0, 0, 0, 0], 0xff8a3d, 1));
  return group;
}

/**
 * Visor 3D imperativo (three.js "vanilla", sin react-three-fiber) para
 * mantener el preview desacoplado de la generación geométrica. Cada pieza
 * de `geometry.parts` es un THREE.Mesh separado (nunca fusionadas), así la
 * vista explosionada mueve solo su Object3D.
 *
 * Una única geometría fuente alimenta dos escenas:
 *  - Modelo: las piezas combinadas, fondo neutro, sin grid ni ejes.
 *  - Cama: instancias visuales (matriz de escena por pieza, ver
 *    printBed/bedLayout.ts) apoyadas en Z=0 sobre el perfil de impresora.
 * Cada modo conserva su propia cámara.
 */
export function MakerViewport({ geometry, displayMode = "model", explosionAmount = DEFAULT_EXPLOSION_AMOUNT, bed = null, cutoutEditing = null }: MakerViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const bedRootRef = useRef<THREE.Group | null>(null);
  const bedContentRef = useRef<THREE.Group | null>(null);
  const partMeshesRef = useRef<Map<PartKind, THREE.Mesh>>(new Map());
  // Rango de explosión por pieza (capa de armado SEMÁNTICA, geometry/explodeOrder.ts;
  // nunca el orden de `geometry.parts` ni la posición Z real de la malla).
  const explodeRankRef = useRef<Map<PartKind, number>>(new Map());
  const camStoreRef = useRef<{ model: CameraState | null; bed: CameraState | null }>({ model: null, bed: null });
  const activeModeRef = useRef<MakerDisplayMode>(displayMode);
  const editorRef = useRef<CutoutEditor | null>(null);
  const geometryRef = useRef<LetterGeometryResult | null>(geometry);

  const fitTo = (center: THREE.Vector3, maxDim: number, dir: THREE.Vector3) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const distance = maxDim * 1.8;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(dir, distance);
    camera.near = Math.max(distance / 100, 0.1);
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
    controls.update();
  };

  const fitModel = () => {
    const group = modelGroupRef.current;
    if (!group) return;
    const box = new THREE.Box3();
    for (const mesh of partMeshesRef.current.values()) {
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // Perspectiva 3/4. El encuadre se calcula sobre la posición ensamblada.
    fitTo(center, Math.max(size.x, size.y, size.z, 1), new THREE.Vector3(0.55, 0.55, 0.75));
  };

  const fitBed = () => {
    const profile = bedProfileRef.current;
    if (!profile) return;
    // Vista superior 3/4 tipo slicer, centrada en la cama.
    fitTo(new THREE.Vector3(0, 0, 0), Math.max(profile.widthMm, profile.depthMm) * 0.75, new THREE.Vector3(0, 1.1, 0.75).normalize());
  };
  const bedProfileRef = useRef<PrinterProfile | null>(null);
  useEffect(() => {
    bedProfileRef.current = bed?.profile ?? null;
  }, [bed?.profile]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight || 1, 0.1, 8000);
    camera.position.set(140, 140, 200);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1, 1.6, 1.2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-1, -0.4, -1);
    scene.add(fill);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    // La cama vive con Z hacia arriba: se gira -90° en X para encajar en la escena Y-up.
    const bedRoot = new THREE.Group();
    bedRoot.rotation.x = -Math.PI / 2;
    bedRoot.visible = false;
    scene.add(bedRoot);
    bedRootRef.current = bedRoot;
    const bedContent = new THREE.Group();
    bedRoot.add(bedContent);
    bedContentRef.current = bedContent;

    const editor = createCutoutEditor(scene, renderer.domElement, container);
    editorRef.current = editor;

    let frameId = 0;
    const animate = () => {
      const editing = editor.isActive();
      if (editing) editor.controls.update();
      else controls.update();
      renderer.render(scene, editing ? editor.camera : camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
      editor.resize();
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      editor.dispose();
      editorRef.current = null;
      controls.dispose();
      clearGroup(modelGroup);
      clearGroup(bedContent);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      modelGroupRef.current = null;
      bedRootRef.current = null;
      bedContentRef.current = null;
      partMeshesRef.current = new Map();
    };
  }, []);

  // Escena Modelo: una malla por pieza combinada.
  useEffect(() => {
    const group = modelGroupRef.current;
    if (!group) return;
    clearGroup(group);
    partMeshesRef.current = new Map();
    if (!geometry || geometry.triangleCount === 0) return;

    const presentKinds = geometry.parts.filter((p) => p.mesh.triangleCount > 0).map((p) => p.kind);
    explodeRankRef.current = computeExplodeRanks(presentKinds);

    for (const part of geometry.parts) {
      if (part.mesh.triangleCount === 0) continue;
      const mesh = new THREE.Mesh(letterGeometryToBufferGeometry(part.mesh), makeMaterial(part.kind));
      group.add(mesh);
      partMeshesRef.current.set(part.kind, mesh);
    }

    camStoreRef.current.model = null;
    if (activeModeRef.current === "model") fitModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);

  // Vista explosionada: solo mueve el Object3D de cada pieza no-"body". La
  // distancia es visual y escala con el tamaño del modelo y el slider.
  useEffect(() => {
    for (const [kind, mesh] of partMeshesRef.current) {
      if (kind === "body") continue;
      const rank = explodeRankRef.current.get(kind) ?? 0;
      mesh.position.set(0, 0, geometry ? computeExplodeOffsetMm(geometry.boundingBox, explosionAmount, rank) : 0);
    }
  }, [explosionAmount, geometry]);

  // Escena Cama: plato + instancias visuales de las piezas de la placa actual.
  useEffect(() => {
    const root = bedRootRef.current;
    const content = bedContentRef.current;
    if (!root || !content) return;
    clearGroup(content);
    if (!bed) return;

    root.position.set(-bed.profile.widthMm / 2, 0, bed.profile.depthMm / 2);
    content.add(buildBedPlate(bed.profile));

    const plate = bed.layout.plates[bed.plateIndex - 1];
    const byId = new Map(bed.items.map((item) => [item.id, item]));
    for (const placement of plate?.placements ?? []) {
      const item = byId.get(placement.id);
      if (!item) continue;
      const mesh = new THREE.Mesh(letterGeometryToBufferGeometry(item.mesh), makeMaterial(item.kind));
      mesh.matrixAutoUpdate = false;
      mesh.matrix.fromArray(placementMatrix(item, placement));
      content.add(mesh);
    }
    if (activeModeRef.current === "bed" && !camStoreRef.current.bed) fitBed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bed]);

  // Cambio de modo: cada uno conserva su cámara.
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const prev = activeModeRef.current;
    if (prev !== displayMode) {
      camStoreRef.current[prev] = { position: camera.position.clone(), target: controls.target.clone() };
    }
    activeModeRef.current = displayMode;
    if (modelGroupRef.current) modelGroupRef.current.visible = displayMode === "model";
    if (bedRootRef.current) bedRootRef.current.visible = displayMode === "bed";

    const stored = camStoreRef.current[displayMode];
    if (prev !== displayMode && stored) {
      camera.position.copy(stored.position);
      controls.target.copy(stored.target);
      camera.updateProjectionMatrix();
      controls.update();
    } else if (prev !== displayMode) {
      if (displayMode === "bed") fitBed();
      else fitModel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode]);

  // Modo Editar recortes: entra/sale de la vista trasera ortográfica. La cámara
  // perspectiva y sus controles quedan intactos (al salir, el Model View vuelve
  // exactamente como estaba).
  const editingOn = cutoutEditing !== null;
  const hasGeometry = !!geometry && geometry.triangleCount > 0;
  useEffect(() => {
    geometryRef.current = geometry;
  });
  useEffect(() => {
    const editor = editorRef.current;
    const controls = controlsRef.current;
    if (!editor || !controls) return;
    if (editingOn && geometryRef.current) {
      const g = geometryRef.current;
      controls.enabled = false;
      editor.enter({
        centerX: g.designCenter.x,
        centerY: g.designCenter.y,
        centerZ: g.boundingBox.depth / 2,
        width: g.boundingBox.width,
        height: g.boundingBox.height,
        depth: g.boundingBox.depth,
      });
    } else {
      editor.exit();
      controls.enabled = true;
    }
    // Solo al entrar/salir del modo (o cuando aparece la geometría): regenerar el modelo mientras se arrastra no debe resetear zoom/encuadre.
  }, [editingOn, hasGeometry]);

  useEffect(() => {
    if (cutoutEditing) editorRef.current?.update(cutoutEditing);
  }, [cutoutEditing]);

  return <div ref={containerRef} className="h-full w-full min-h-[320px] bg-[radial-gradient(ellipse_at_center,#23262c_0%,#15171b_75%)]" />;
}
