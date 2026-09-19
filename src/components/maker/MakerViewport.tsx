"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LetterGeometryResult, PartKind } from "@/lib/maker/types";
import { letterGeometryToBufferGeometry } from "@/lib/maker/geometry/toBufferGeometry";
import { computeExplodeRanks } from "@/lib/maker/geometry/explodeOrder";

export type MakerViewMode = "assembled" | "exploded";

interface MakerViewportProps {
  geometry: LetterGeometryResult | null;
  /** Solo visual: desplaza las piezas no-"body" hacia adelante en la escena, sin tocar la geometría exportada. Default "assembled". */
  viewMode?: MakerViewMode;
}

/** Desplazamiento puramente visual entre piezas en vista explosionada (mm). */
const EXPLODE_OFFSET_MM = 10;

/** Color por tipo de pieza, solo para diferenciarlas visualmente en el preview (no es el color real de impresión). */
const PART_COLORS: Record<PartKind, number> = {
  body: 0xd8d8dc,
  lid: 0xffb066,
  mask: 0x6b6f76,
  diffuser: 0xfff3d6,
  channelDiffuser: 0xfff3d6,
};

/**
 * Visor 3D imperativo (three.js "vanilla", sin react-three-fiber) para
 * mantener el preview desacoplado de la generación geométrica. Cada pieza
 * de `geometry.parts` (cuerpo, tapa, máscara, difusor...) es un
 * THREE.Mesh separado: nunca se fusionan en una sola BufferGeometry, así
 * se puede desplazar cada una en vista explosionada moviendo solo su
 * Object3D (transform de escena, no una segunda geometría ni un cambio en
 * las coordenadas exportadas).
 */
export function MakerViewport({ geometry, viewMode = "assembled" }: MakerViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const partMeshesRef = useRef<Map<PartKind, THREE.Mesh>>(new Map());
  // Rango de explosión de cada pieza no-"body": cuántos "saltos" de
  // EXPLODE_OFFSET_MM se le aplican, derivado de la capa de armado
  // SEMÁNTICA de cada PartKind (0.4.2, ver geometry/explodeOrder.ts) — ni
  // del orden en que aparecen en `geometry.parts` (PART_ORDER de
  // createLetterGeometry.ts es un orden de EXPORTACIÓN/nombre de archivo)
  // ni de la posición Z real de la malla (0.4.1 intentó esto último con
  // `meshMinZ` y volvió a romperse: el faldón lateral de la máscara
  // perforada, 15.6, extiende su geometría hacia atrás del difusor, así que
  // su minZ podía ser MENOR aunque sea la pieza más externa).
  const explodeRankRef = useRef<Map<PartKind, number>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight || 1, 0.1, 5000);
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

    const grid = new THREE.GridHelper(400, 40, 0x555555, 0x2c2c2c);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    let frameId = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    for (const mesh of partMeshesRef.current.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    partMeshesRef.current = new Map();

    if (!geometry || geometry.triangleCount === 0) return;

    const box = new THREE.Box3();
    // El offset explosionado de cada pieza no-"body" depende de su capa de
    // armado SEMÁNTICA (`PART_ASSEMBLY_LAYER`, ver explodeOrder.ts), no de
    // su posición Z real ni del orden en `geometry.parts`: con 1 sola pieza
    // extra (tapa, o difusor de canal) da el mismo +10mm de siempre; con 2
    // (máscara+difusor, 0.4 Etapa 5) el difusor (capa 1, más cerca del
    // cuerpo) recibe +10mm y la máscara (capa 2, más lejos) +20mm — así la
    // separación relativa entre ellas queda en el mismo orden que la vista
    // ensamblada, nunca invertida.
    const presentKinds = geometry.parts.filter((p) => p.mesh.triangleCount > 0).map((p) => p.kind);
    const explodeRank = computeExplodeRanks(presentKinds);
    explodeRankRef.current = explodeRank;

    for (const part of geometry.parts) {
      if (part.mesh.triangleCount === 0) continue;
      const bufferGeometry = letterGeometryToBufferGeometry(part.mesh);
      const material = new THREE.MeshStandardMaterial({
        color: PART_COLORS[part.kind],
        roughness: part.kind === "body" ? 0.65 : 0.55,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(bufferGeometry, material);

      if (part.kind !== "body") {
        const rank = explodeRank.get(part.kind) ?? 0;
        mesh.position.z = viewMode === "exploded" ? EXPLODE_OFFSET_MM * rank : 0;
      }

      scene.add(mesh);
      partMeshesRef.current.set(part.kind, mesh);
      bufferGeometry.computeBoundingBox();
      if (bufferGeometry.boundingBox) box.union(bufferGeometry.boundingBox);
    }

    if (!box.isEmpty()) {
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z, 1);

      controls.target.copy(center);
      const distance = maxDim * 1.8;
      camera.position.set(center.x + distance * 0.55, center.y + distance * 0.55, center.z + distance * 0.75);
      camera.near = Math.max(distance / 100, 0.1);
      camera.far = distance * 20;
      camera.updateProjectionMatrix();
      controls.update();
    }
    // El encuadre se calcula sobre la posición ensamblada (offset 0) a
    // propósito, para que no "salte" la cámara al alternar la vista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);

  // Vista explosionada: solo mueve el Object3D de cada pieza no-"body" en
  // la escena, sin tocar la geometría ni recrear ningún mesh. No afecta la
  // exportación.
  useEffect(() => {
    for (const [kind, mesh] of partMeshesRef.current) {
      if (kind === "body") continue;
      const rank = explodeRankRef.current.get(kind) ?? 0;
      mesh.position.z = viewMode === "exploded" ? EXPLODE_OFFSET_MM * rank : 0;
    }
  }, [viewMode]);

  return <div ref={containerRef} className="h-full w-full min-h-[420px]" />;
}
