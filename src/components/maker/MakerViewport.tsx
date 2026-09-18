"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LetterGeometryResult } from "@/lib/maker/types";
import { letterGeometryToBufferGeometry } from "@/lib/maker/geometry/toBufferGeometry";

export type MakerViewMode = "assembled" | "exploded";

interface MakerViewportProps {
  geometry: LetterGeometryResult | null;
  /** Solo visual: desplaza la tapa hacia adelante en la escena, sin tocar la geometría exportada. Default "assembled". */
  viewMode?: MakerViewMode;
}

/** Desplazamiento puramente visual de la tapa en vista explosionada (mm). */
const EXPLODE_OFFSET_MM = 10;

/**
 * Visor 3D imperativo (three.js "vanilla", sin react-three-fiber) para
 * mantener el preview desacoplado de la generación geométrica. Cuerpo y
 * tapa (cuando existe) son dos THREE.Mesh separados: nunca se fusionan en
 * una sola BufferGeometry, así se puede desplazar la tapa en vista
 * explosionada moviendo solo su Object3D (transform de escena, no una
 * segunda geometría ni un cambio en las coordenadas exportadas).
 */
export function MakerViewport({ geometry, viewMode = "assembled" }: MakerViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const bodyMeshRef = useRef<THREE.Mesh | null>(null);
  const lidMeshRef = useRef<THREE.Mesh | null>(null);

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

    for (const ref of [bodyMeshRef, lidMeshRef]) {
      if (ref.current) {
        scene.remove(ref.current);
        ref.current.geometry.dispose();
        (ref.current.material as THREE.Material).dispose();
        ref.current = null;
      }
    }

    if (!geometry || geometry.triangleCount === 0) return;

    const box = new THREE.Box3();

    if (geometry.body.triangleCount > 0) {
      const bodyGeometry = letterGeometryToBufferGeometry(geometry.body);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0xd8d8dc,
        roughness: 0.65,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
      scene.add(bodyMesh);
      bodyMeshRef.current = bodyMesh;
      bodyGeometry.computeBoundingBox();
      if (bodyGeometry.boundingBox) box.union(bodyGeometry.boundingBox);
    }

    if (geometry.lid && geometry.lid.triangleCount > 0) {
      const lidGeometry = letterGeometryToBufferGeometry(geometry.lid);
      const lidMaterial = new THREE.MeshStandardMaterial({
        color: 0xffb066,
        roughness: 0.55,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const lidMesh = new THREE.Mesh(lidGeometry, lidMaterial);
      lidMesh.position.z = viewMode === "exploded" ? EXPLODE_OFFSET_MM : 0;
      scene.add(lidMesh);
      lidMeshRef.current = lidMesh;
      lidGeometry.computeBoundingBox();
      if (lidGeometry.boundingBox) box.union(lidGeometry.boundingBox);
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

  // Vista explosionada: solo mueve el Object3D de la tapa en la escena, sin
  // tocar la geometría ni recrear ningún mesh. No afecta la exportación.
  useEffect(() => {
    if (lidMeshRef.current) {
      lidMeshRef.current.position.z = viewMode === "exploded" ? EXPLODE_OFFSET_MM : 0;
    }
  }, [viewMode]);

  return <div ref={containerRef} className="h-full w-full min-h-[420px]" />;
}
