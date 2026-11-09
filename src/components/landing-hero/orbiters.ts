/**
 * Objetos de impresión 3D que orbitan al protagonista. Compartido por el núcleo y la lámpara: misma geometría, mismas
 * animaciones y misma liberación de recursos; cada escena solo decide la cantidad (según la calidad) y el radio base.
 *
 * Cada objeto gira despacio sobre su propio eje como en una plataforma giratoria (se mantiene reconocible), recorre una
 * órbita amplia a distinta altura y profundidad, llega al ensamblaje desde lejos, se abre con el scroll y se encoge al
 * pasar cerca de la cámara para no tapar la travesía.
 */

import * as THREE from "three";
import { clamp01, easeOutCubic, smoothstep, type HeroTimeline } from "./hero-timeline";
import { createPrintedModel, type PrintedModelId } from "./printed-models";
import { mulberry32 } from "./scene-utils";

type OrbiterSpec = {
  id: PrintedModelId;
  /** Tamaño en unidades de escena (lado mayor). */
  size: number;
  /** Radio de la órbita y altura media (respecto al centro del protagonista). */
  radius: number;
  height: number;
  /** Velocidad angular de la órbita (rad/s; el signo es el sentido) y fase inicial. */
  omega: number;
  phase: number;
  /** Giro propio (rad/s) e inclinación fija sobre X. */
  spin: number;
  tilt: number;
  /** Momento de llegada dentro de la formación (0..1). */
  delay: number;
};

/** Orden de prioridad: los equipos modestos usan solo los primeros. */
const SPECS: readonly OrbiterSpec[] = [
  { id: "benchy", size: 1.25, radius: 3.15, height: 0.85, omega: 0.15, phase: 0.4, spin: 0.55, tilt: 0.06, delay: 0.5 },
  { id: "tower", size: 1.15, radius: 2.85, height: -1.35, omega: -0.12, phase: 2.5, spin: 0.42, tilt: 0.04, delay: 0.58 },
  { id: "cube", size: 0.6, radius: 3.4, height: 2.05, omega: 0.11, phase: 4.3, spin: 0.7, tilt: 0.35, delay: 0.66 },
  { id: "gear", size: 0.78, radius: 3.0, height: -2.25, omega: -0.16, phase: 5.4, spin: 0.9, tilt: 0.5, delay: 0.72 },
  { id: "vase", size: 0.95, radius: 3.55, height: 0.1, omega: 0.09, phase: 1.3, spin: 0.38, tilt: 0.03, delay: 0.78 },
];

type Orbiter = {
  spec: OrbiterSpec;
  mesh: THREE.Mesh;
  spawn: THREE.Vector3;
  bob: number;
  drift: number;
};

export class HeroOrbiters {
  readonly group = new THREE.Group();
  private readonly items: Orbiter[] = [];
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly home = new THREE.Vector3();
  private readonly world = new THREE.Vector3();
  private spread = 1;

  /** `count`: cuántos objetos mostrar (3 a 5). */
  constructor(count: number) {
    const rnd = mulberry32(0x0b17);
    for (const spec of SPECS.slice(0, Math.max(0, Math.min(SPECS.length, count)))) {
      const { geometry, material } = createPrintedModel(spec.id);
      this.disposables.push(geometry, material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.setScalar(0.0001);
      this.group.add(mesh);
      const angle = spec.phase;
      this.items.push({
        spec,
        mesh,
        spawn: new THREE.Vector3(Math.cos(angle) * spec.radius * 3, spec.height + 3 + rnd() * 3, Math.sin(angle) * spec.radius * 3),
        bob: rnd() * Math.PI * 2,
        drift: 0.8 + rnd() * 0.5,
      });
    }
  }

  /** Retrae la órbita en pantallas verticales para que no se salga del encuadre. */
  setSpread(spread: number): void {
    this.spread = spread;
  }

  /**
   * @param center altura del centro del protagonista (la órbita se arma alrededor de ese punto).
   * @param cameraPosition posición de la cámara, para encoger lo que se acerca demasiado.
   */
  update(time: number, tl: HeroTimeline, formation: number, centerY: number, cameraPosition: THREE.Vector3): void {
    const ex = tl.explode;
    const parent = this.group.parent;
    for (const item of this.items) {
      const { spec, mesh } = item;
      const f = clamp01((formation - spec.delay) / 0.3);
      const e = easeOutCubic(f);
      const grow = smoothstep(0, 0.25, f);

      const angle = spec.phase + time * spec.omega + ex * spec.omega * 4;
      const radius = spec.radius * this.spread * (1 + ex * 1.6 * item.drift);
      this.home.set(
        Math.cos(angle) * radius,
        centerY + spec.height * (1 + ex * 0.6) + Math.sin(angle + spec.phase) * 0.35 + Math.sin(time * 0.6 + item.bob) * 0.08,
        Math.sin(angle) * radius,
      );
      mesh.position.lerpVectors(item.spawn, this.home, e);
      mesh.rotation.set(spec.tilt + Math.sin(time * 0.5 + item.bob) * 0.08, item.bob + time * spec.spin + (1 - e) * 4, Math.sin(time * 0.4 + item.bob) * 0.06);

      let near = 1;
      if (parent) {
        this.world.copy(mesh.position).applyMatrix4(parent.matrixWorld);
        near = smoothstep(0.9, 3.4, this.world.distanceTo(cameraPosition));
      }
      mesh.scale.setScalar(Math.max(0.0001, spec.size * grow * near));
    }
  }

  dispose(): void {
    for (const resource of this.disposables) resource.dispose();
    this.disposables.length = 0;
    this.group.clear();
    this.items.length = 0;
  }
}

