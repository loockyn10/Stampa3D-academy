/**
 * Núcleo digital luminoso de Universo: un corazón con aspecto tecnológico (no una bombilla) formado por un núcleo
 * incandescente, dos retículas poliédricas contrarrotantes con nodos en sus vértices y tres anillos giroscópicos,
 * envueltos en un halo suave. Representa el ecosistema digital que hay "dentro" de la pieza protagonista.
 *
 * Compartido por el núcleo y la lámpara: cada escena decide cuándo aparece y cuánto brilla; este módulo solo dibuja.
 */

import * as THREE from "three";

export type DigitalCoreState = {
  /** Escala del conjunto (0 lo oculta). */
  scale: number;
  haloOpacity: number;
  haloScale: number;
  lightIntensity: number;
};

export class HeroDigitalCore {
  readonly group = new THREE.Group();
  private readonly shell: THREE.LineSegments;
  private readonly lattice: THREE.LineSegments;
  private readonly rings: THREE.Mesh[] = [];
  private readonly halo: THREE.Sprite;
  private readonly light = new THREE.PointLight(0xff7a1a, 0, 10, 2);
  private readonly disposables: Array<{ dispose: () => void }> = [];

  constructor(glowTexture: THREE.Texture, options: { haloDepthTest: boolean }) {
    // Núcleo incandescente.
    const coreGeometry = new THREE.IcosahedronGeometry(0.2, 2);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffc48a, toneMapped: false });
    this.disposables.push(coreGeometry, coreMaterial);
    this.group.add(new THREE.Mesh(coreGeometry, coreMaterial));

    // Dos retículas poliédricas (aristas finas) que giran en sentidos opuestos, con nodos en los vértices.
    const shellBase = new THREE.IcosahedronGeometry(0.5, 1);
    const latticeBase = new THREE.IcosahedronGeometry(0.8, 1);
    const shellEdges = new THREE.WireframeGeometry(shellBase);
    const latticeEdges = new THREE.WireframeGeometry(latticeBase);
    const shellMaterial = new THREE.LineBasicMaterial({ color: 0xffa25a, transparent: true, opacity: 0.75, toneMapped: false });
    const latticeMaterial = new THREE.LineBasicMaterial({ color: 0xffc58f, transparent: true, opacity: 0.4, toneMapped: false });
    this.disposables.push(shellBase, latticeBase, shellEdges, latticeEdges, shellMaterial, latticeMaterial);
    this.shell = new THREE.LineSegments(shellEdges, shellMaterial);
    this.lattice = new THREE.LineSegments(latticeEdges, latticeMaterial);

    const nodeMaterial = new THREE.PointsMaterial({
      size: 0.15,
      map: glowTexture,
      color: 0xffd7a8,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    this.disposables.push(nodeMaterial);
    // Sin atributo `uv`: con él, three muestrea la textura con las UV del vértice y los puntos salen como cuadrados.
    const latticePoints = latticeBase.clone();
    const shellPoints = shellBase.clone();
    for (const g of [latticePoints, shellPoints]) {
      g.deleteAttribute("uv");
      g.deleteAttribute("normal");
      this.disposables.push(g);
    }
    const latticeNodes = new THREE.Points(latticePoints, nodeMaterial);
    const shellNodes = new THREE.Points(shellPoints, nodeMaterial);
    this.shell.add(shellNodes);
    this.lattice.add(latticeNodes);
    this.group.add(this.shell, this.lattice);

    // Anillos giroscópicos.
    const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xff780a, emissive: 0xff5a00, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.35 });
    this.disposables.push(ringMaterial);
    [0.98, 1.24, 1.5].forEach((radius, index) => {
      const geometry = new THREE.TorusGeometry(radius, 0.011 + index * 0.003, 8, 96);
      this.disposables.push(geometry);
      const ring = new THREE.Mesh(geometry, ringMaterial);
      ring.rotation.set(index * 0.9, index * 0.5, index * 0.3);
      this.rings.push(ring);
      this.group.add(ring);
    });

    // Halo y luz.
    const haloMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xff7a1a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: options.haloDepthTest,
      toneMapped: false,
    });
    this.disposables.push(haloMaterial);
    this.halo = new THREE.Sprite(haloMaterial);
    this.halo.renderOrder = 10;
    this.group.add(this.halo, this.light);
    this.group.scale.setScalar(0.0001);
  }

  update(time: number, state: DigitalCoreState): void {
    const pulse = 1 + Math.sin(time * 2.1) * 0.04;
    this.group.scale.setScalar(Math.max(0.0001, state.scale * pulse));
    this.shell.rotation.set(time * 0.17, time * 0.3, 0);
    this.lattice.rotation.set(-time * 0.11, -time * 0.19, time * 0.07);
    this.rings.forEach((ring, index) => {
      ring.rotation.x += 0.004 * (index + 1);
      ring.rotation.y += 0.003 * (3 - index);
    });
    (this.halo.material as THREE.SpriteMaterial).opacity = state.haloOpacity;
    this.halo.scale.setScalar(state.haloScale);
    this.light.intensity = state.lightIntensity;
  }

  dispose(): void {
    for (const resource of this.disposables) resource.dispose();
    this.disposables.length = 0;
    this.group.clear();
  }
}
