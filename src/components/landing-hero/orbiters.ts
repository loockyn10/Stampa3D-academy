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
  /** Semiejes de la órbita elíptica (x: ancho, z: profundidad) y altura media respecto al centro del protagonista. */
  radiusX: number;
  radiusZ: number;
  height: number;
  /** Velocidad angular de la órbita (rad/s; el signo es el sentido) y fase inicial. */
  omega: number;
  phase: number;
  /** Giro propio (rad/s) e inclinación fija sobre X. */
  spin: number;
  tilt: number;
  /** Momento de llegada dentro de la formación (0..1). */
  delay: number;
  /**
   * Si existe, la pieza se mantiene de cara a la cámara (en vez de girar entera) y solo se balancea ±`swing` rad alrededor de
   * `facing`: así el barco y la torre se ven siempre de perfil/tres cuartos, que es donde se reconocen.
   */
  swing?: { amplitude: number; facing: number };
};

/**
 * Orden de prioridad: los equipos modestos usan solo los primeros. Órbitas más profundas que anchas (poca extensión lateral:
 * no invaden el texto) y alturas repartidas por encima y por debajo de la pieza central.
 */
const SPECS: readonly OrbiterSpec[] = [
  { id: "boat", size: 2.0, radiusX: 3.2, radiusZ: 4.1, height: 1.5, omega: 0.13, phase: 0.3, spin: 0.45, tilt: 0.08, delay: 0.5, swing: { amplitude: 0.5, facing: -0.45 } },
  { id: "tower", size: 1.7, radiusX: 3.0, radiusZ: 3.9, height: -1.75, omega: -0.11, phase: 2.5, spin: 0.4, tilt: 0.05, delay: 0.6, swing: { amplitude: 0.6, facing: 0.35 } },
  { id: "cube", size: 1.0, radiusX: 3.3, radiusZ: 4.3, height: 2.75, omega: 0.1, phase: 4.3, spin: 0.55, tilt: 0.3, delay: 0.7 },
  { id: "gear", size: 1.2, radiusX: 3.1, radiusZ: 4.0, height: -2.8, omega: -0.14, phase: 5.4, spin: 0.8, tilt: 0.55, delay: 0.78 },
];

type Orbiter = {
  spec: OrbiterSpec;
  mesh: THREE.Mesh;
  spawn: THREE.Vector3;
  /** Ángulo orbital acumulado (la velocidad varía con la posición, por eso se integra). */
  angle: number;
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
  private lateral = 1;
  private lastTime = 0;

  /** `count`: cuántos objetos mostrar (3 o 4). */
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
        spawn: new THREE.Vector3(Math.cos(angle) * spec.radiusX * 3, spec.height + 3 + rnd() * 3, Math.sin(angle) * spec.radiusZ * 3),
        angle: spec.phase,
        bob: rnd() * Math.PI * 2,
        drift: 0.8 + rnd() * 0.5,
      });
    }
  }

  /** Retrae la órbita en pantallas verticales para que no se salga del encuadre (`lateral`: solo el ancho). */
  setSpread(spread: number, lateral = spread): void {
    this.spread = spread;
    this.lateral = lateral;
  }

  /**
   * @param center altura del centro del protagonista (la órbita se arma alrededor de ese punto).
   * @param cameraPosition posición de la cámara, para encoger lo que se acerca demasiado.
   */
  update(time: number, tl: HeroTimeline, formation: number, centerY: number, cameraPosition: THREE.Vector3): void {
    const ex = tl.explode;
    const parent = this.group.parent;
    const rigYaw = parent?.rotation.y ?? 0;
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    for (const item of this.items) {
      const { spec, mesh } = item;
      const f = clamp01((formation - spec.delay) / 0.3);
      const e = easeOutCubic(f);
      const grow = smoothstep(0, 0.25, f);

      // Cuando el objeto pasa por delante de la pieza central (hacia la cámara) acelera y se achica un poco: así no
      // tapa el centro durante períodos prolongados. `front` = 1 justo delante, 0 a los lados y por detrás.
      const front = Math.max(0, Math.sin(item.angle - rigYaw));
      item.angle += dt * spec.omega * (1 + 1.8 * front * front);
      const angle = item.angle + ex * spec.omega * 4;

      const open = 1 + ex * 1.6 * item.drift;
      this.home.set(
        Math.cos(angle) * spec.radiusX * this.lateral * open,
        centerY + spec.height * this.spread * (1 + ex * 0.6) + Math.sin(angle + spec.phase) * 0.3 + Math.sin(time * 0.6 + item.bob) * 0.08,
        Math.sin(angle) * spec.radiusZ * this.spread * open,
      );
      mesh.position.lerpVectors(item.spawn, this.home, e);
      // Giro propio: completo (cubo, engranaje) o balanceo de cara a la cámara (barco, torre; compensa el giro del conjunto).
      const yaw = spec.swing ? -rigYaw + spec.swing.facing + Math.sin(time * spec.spin + item.bob) * spec.swing.amplitude : item.bob + time * spec.spin;
      mesh.rotation.set(spec.tilt + Math.sin(time * 0.5 + item.bob) * 0.06, yaw + (1 - e) * 4, Math.sin(time * 0.4 + item.bob) * 0.05);

      let near = 1;
      if (parent) {
        this.world.copy(mesh.position).applyMatrix4(parent.matrixWorld);
        near = smoothstep(0.9, 3.4, this.world.distanceTo(cameraPosition));
      }
      mesh.scale.setScalar(Math.max(0.0001, spec.size * grow * near * (1 - 0.2 * front * front)));
    }
  }

  dispose(): void {
    for (const resource of this.disposables) resource.dispose();
    this.disposables.length = 0;
    this.group.clear();
    this.items.length = 0;
  }
}

