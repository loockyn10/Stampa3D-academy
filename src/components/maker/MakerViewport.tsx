"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LetterGeometryResult, PartKind, TriangleSoupData } from "@/lib/maker/types";
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
  /** Malla auxiliar SOLO visual (p.ej. el inserto de Jarros): semitransparente, solo en Modelo, nunca forma parte del resultado exportable. */
  helperMesh?: TriangleSoupData | null;
  /** Lámparas: el modelo tiene Z hacia arriba (se gira -90° en X para encajar en la escena Y-up) y el encuadre inicial es lateral. */
  zUp?: boolean;
  /** Piezas ocultas SOLO en pantalla (no regenera nada ni toca la geometría exportada). */
  hiddenKinds?: readonly PartKind[] | null;
  /** Color de vista previa por pieza (#rrggbb), aplicado sin reconstruir mallas. No simula la luz real. */
  partColors?: Partial<Record<PartKind, string>> | null;
}

/** Color por tipo de pieza, solo para diferenciarlas visualmente en el preview (no es el color real de impresión). */
const PART_COLORS: Record<PartKind, number> = {
  body: 0xd8d8dc,
  lid: 0xffb066,
  mask: 0x6b6f76,
  diffuser: 0xfff3d6,
  channelDiffuser: 0xfff3d6,
  lampInsert: 0xe5483b,
  lampShade: 0xf4efe6,
};

type CameraState = { position: THREE.Vector3; target: THREE.Vector3 };

function makeMaterial(kind: PartKind): THREE.MeshStandardMaterial {
  // Lámparas: la pantalla y el inserto son de filamento translúcido; se dibujan semitransparentes para ver el inserto adentro.
  if (kind === "lampShade") {
    return new THREE.MeshStandardMaterial({ color: PART_COLORS[kind], roughness: 0.35, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  }
  if (kind === "lampInsert") {
    // Un poco de brillo propio: el filamento translúcido iluminado se ve más saturado que uno apagado (solo vista previa).
    return new THREE.MeshStandardMaterial({ color: PART_COLORS[kind], emissive: PART_COLORS[kind], emissiveIntensity: 0.3, roughness: 0.45, metalness: 0, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
  }
  return new THREE.MeshStandardMaterial({
    color: PART_COLORS[kind],
    roughness: kind === "body" ? 0.65 : 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
}

/** Visibilidad de una pieza: helper fuera del componente (los efectos solo llaman métodos, como el resto de este visor). */
function setPartAppearance(mesh: THREE.Mesh, visible: boolean, color?: string, glow = false) {
  mesh.visible = visible;
  if (color) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.set(color);
    if (glow) material.emissive.set(color);
  }
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
export function MakerViewport({ geometry, displayMode = "model", explosionAmount = DEFAULT_EXPLOSION_AMOUNT, bed = null, cutoutEditing = null, helperMesh = null, zUp = false, hiddenKinds = null, partColors = null }: MakerViewportProps) {
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
  const hadModelRef = useRef(false);

  const fitTo = (center: THREE.Vector3, maxDim: number, dir: THREE.Vector3, margin = 1.8) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const distance = maxDim * margin;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(dir, distance);
    camera.near = Math.max(distance / 100, 0.1);
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
    controls.update();
  };

  // `keepView`: reencuadra (centro y distancia) pero conserva la DIRECCIÓN de la cámara actual, para que cambiar texto/estilo no deshaga la rotación del usuario.
  const fitModel = (keepView = false) => {
    const group = modelGroupRef.current;
    if (!group) return;
    const box = new THREE.Box3();
    for (const mesh of partMeshesRef.current.values()) {
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox);
    }
    if (box.isEmpty()) return;
    // Con Z hacia arriba (lámparas) el grupo está girado: el encuadre se calcula en coordenadas de escena.
    if (zUp) {
      group.updateMatrixWorld(true);
      box.applyMatrix4(group.matrixWorld);
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // Perspectiva 3/4 (o la dirección actual con `keepView`). El encuadre se calcula sobre la posición ensamblada.
    const dir = zUp ? new THREE.Vector3(0.85, 0.42, 0.95) : new THREE.Vector3(0.55, 0.55, 0.75);
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (keepView && camera && controls) {
      const current = camera.position.clone().sub(controls.target);
      if (current.lengthSq() > 1e-6) dir.copy(current.normalize());
    }
    // Lámparas: más aire alrededor (los paneles flotantes tapan parte del visor).
    fitTo(center, Math.max(size.x, size.y, size.z, 1), dir, zUp ? 2.5 : 1.8);
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

  // Orientación del modelo (antes del efecto de geometría, que encuadra con la matriz ya aplicada).
  useEffect(() => {
    const group = modelGroupRef.current;
    if (!group) return;
    group.rotation.x = zUp ? -Math.PI / 2 : 0;
    group.updateMatrixWorld(true);
  }, [zUp]);

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
      // Translúcidos: el inserto se dibuja antes que la pantalla para que se vea a través de ella.
      if (part.kind === "lampInsert") mesh.renderOrder = 2;
      if (part.kind === "lampShade") mesh.renderOrder = 3;
      group.add(mesh);
      partMeshesRef.current.set(part.kind, mesh);
    }

    camStoreRef.current.model = null;
    // Primera geometría: encuadre 3/4 inicial. Las siguientes (texto, estilo, parámetros) conservan la rotación que eligió el usuario.
    const keepView = hadModelRef.current;
    hadModelRef.current = true;
    if (activeModeRef.current === "model") fitModel(keepView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);

  // Visibilidad y color por pieza: solo cambian propiedades del material/objeto, sin reconstruir geometría.
  const hiddenKey = hiddenKinds?.join(",") ?? "";
  const colorsKey = partColors ? JSON.stringify(partColors) : "";
  useEffect(() => {
    const hidden = new Set(hiddenKey ? hiddenKey.split(",") : []);
    const colors = colorsKey ? (JSON.parse(colorsKey) as Partial<Record<PartKind, string>>) : {};
    for (const [kind, mesh] of partMeshesRef.current) {
      setPartAppearance(mesh, !hidden.has(kind), colors[kind], kind === "lampInsert");
    }
  }, [geometry, hiddenKey, colorsKey]);

  // Malla auxiliar (helper) visual: se agrega al grupo Modelo DESPUÉS de las piezas (el efecto de arriba limpia el
  // grupo al cambiar la geometría), sin tocar `partMeshesRef` (no se explota ni entra en el auto-fit ni en la cama).
  useEffect(() => {
    const group = modelGroupRef.current;
    if (!group || !helperMesh || helperMesh.triangleCount === 0) return;
    const mesh = new THREE.Mesh(
      letterGeometryToBufferGeometry(helperMesh),
      new THREE.MeshStandardMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.28, roughness: 0.4, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.renderOrder = 2;
    group.add(mesh);
    return () => {
      group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    };
  }, [geometry, helperMesh]);

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
