/**
 * "El Núcleo de Universo": escena Three.js del Hero.
 *
 * - Un vaso generativo hecho de capas onduladas apiladas (como una pieza impresa en 3D) que "se imprime" de abajo hacia arriba.
 * - Piezas independientes (esquirlas metálicas, paneles translúcidos, tejas mate y anillos de cobre) que se ensamblan a su alrededor.
 * - Un corazón luminoso interno que crece con el scroll hasta que la cámara lo atraviesa.
 *
 * No depende de React: la clase recibe un canvas, una calidad y, en cada frame, el estado de la línea de tiempo.
 * Todo lo que crea (geometrías, materiales, texturas, PMREM, renderer) se libera en `dispose()`.
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { HeroQuality } from "./hero-quality";
import { clamp01, easeOutCubic, lerp, smoothstep, type HeroTimeline } from "./hero-timeline";

/** Altura total del vaso (unidades de escena). */
const CORE_HEIGHT = 5.4;
/** Duración de la formación inicial, en segundos, y espera previa. */
const FORMATION_SECONDS = 4.6;
const FORMATION_DELAY = 0.35;
const BED_Y = -3.05;

/** Radio interior relativo de cada capa (la boca del vaso deja ver el corazón luminoso). */
const LAYER_INNER = 0.58;
/** Semialtura de la sección de cada capa en unidades de geometría (la escala vertical la fija la separación entre capas). */
const LAYER_HALF_HEIGHT = 0.2;
/** Torsión total de la escultura, de la base a la boca (rad). */
const SCULPTURE_TWIST = 3.6;

/** Silueta (radio por altura normalizada): base estable, bulbo, cintura fina y boca acampanada, todo continuo. */
function profileRadius(t: number): number {
  const body = Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * t)), 1.15);
  const waist = Math.exp(-(((t - 0.56) / 0.15) ** 2));
  return 0.72 + 0.66 * body - 0.5 * waist + 0.38 * smoothstep(0.66, 1, t);
}

/** Contorno ondulado de una capa: tres lóbulos suaves (se tuercen de capa en capa). */
function outlineRadius(theta: number): number {
  return 1 + 0.14 * Math.sin(3 * theta) + 0.035 * Math.sin(6 * theta + 0.8);
}

/**
 * Losa anular unitaria con bordes redondeados (sección tipo "squircle") que sigue el contorno ondulado.
 * Todas las capas la comparten: al apilarse y torcerse forman una superficie continua con finas líneas de capa.
 */
function buildSlabGeometry(thetaSegments: number, crossSegments: number): THREE.BufferGeometry {
  const positions = new Float32Array(thetaSegments * crossSegments * 3);
  const squircle = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.5);
  for (let j = 0; j < thetaSegments; j += 1) {
    const theta = (j / thetaSegments) * Math.PI * 2;
    const outer = outlineRadius(theta);
    const cx = Math.cos(theta);
    const sz = Math.sin(theta);
    for (let k = 0; k < crossSegments; k += 1) {
      const u = (k / crossSegments) * Math.PI * 2;
      const px = squircle(Math.cos(u));
      const py = squircle(Math.sin(u));
      const radius = outer * (LAYER_INNER + ((1 - LAYER_INNER) * (px + 1)) / 2);
      const o = (j * crossSegments + k) * 3;
      positions[o] = cx * radius;
      positions[o + 1] = py * LAYER_HALF_HEIGHT;
      positions[o + 2] = sz * radius;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < thetaSegments; j += 1) {
    const jn = (j + 1) % thetaSegments;
    for (let k = 0; k < crossSegments; k += 1) {
      const kn = (k + 1) % crossSegments;
      const a = j * crossSegments + k;
      const b = jn * crossSegments + k;
      const c = jn * crossSegments + kn;
      const d = j * crossSegments + kn;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Comprobación de orientación: en la cara exterior (u = 0, θ = 0) la normal debe apuntar hacia +X.
  const normal = geometry.getAttribute("normal");
  if (normal.getX(0) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
  }
  return geometry;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(255,255,255,0.55)");
    g.addColorStop(0.5, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type PieceFamily = {
  mesh: THREE.InstancedMesh;
  ids: number[];
};

type Piece = {
  family: number;
  slot: number;
  home: THREE.Vector3;
  spawn: THREE.Vector3;
  baseQuat: THREE.Quaternion;
  axis: THREE.Vector3;
  rate: number;
  scale: THREE.Vector3;
  delay: number;
  bob: number;
  drift: number;
};

export type CoreSceneOptions = {
  reducedMotion: boolean;
  onContextLost?: () => void;
  onFormed?: () => void;
};

export class HeroCoreScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly quality: HeroQuality;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.05, 80);
  private readonly rig = new THREE.Group();
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly options: CoreSceneOptions;

  // Capas del vaso
  private readonly layerCount: number;
  private readonly layerMeshes: THREE.InstancedMesh[] = [];
  private readonly layerClass: Uint8Array;
  private readonly layerSlot: Uint16Array;
  private readonly layerY: Float32Array;
  private readonly layerRadius: Float32Array;
  private readonly layerSpawn: Float32Array;
  private readonly layerPhase: Float32Array;
  private readonly layerTilt: Float32Array;
  private readonly layerDelay: Float32Array;
  private readonly layerSy: number;

  // Piezas
  private readonly pieces: Piece[] = [];
  private readonly families: PieceFamily[] = [];

  // Corazón, plataforma, partículas, luces
  private readonly heart = new THREE.Group();
  private readonly heartCore: THREE.Mesh;
  private readonly heartHalo: THREE.Sprite;
  private readonly heartRings: THREE.Mesh[] = [];
  private readonly heartLight = new THREE.PointLight(0xff7a1a, 0, 10, 2);
  private readonly nozzleLight = new THREE.PointLight(0xff8a2a, 0, 4.5, 2);
  private readonly nozzleGlow: THREE.Sprite;
  private readonly bed = new THREE.Group();
  private readonly bedMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly bedGlow: THREE.Mesh;
  private readonly dust: THREE.Points;

  private readonly dummy = new THREE.Object3D();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler();

  private width = 1;
  private height = 1;
  private dpr = 1;
  private pieceSpread = 1;
  private elapsed = 0;
  private spin = 0;
  private pointerX = 0;
  private pointerY = 0;
  private pointerTX = 0;
  private pointerTY = 0;
  private formedNotified = false;
  private lastTimeline: HeroTimeline | null = null;
  private disposed = false;
  private frameAvg = 16;
  private frameCount = 0;
  private dprSteps = 0;
  private readonly onLost: (event: Event) => void;

  /** Rig de cámara dependiente del encuadre; lo calcula `resize`. */
  baseZ = 11.5;
  readonly endZ = -4.6;

  constructor(canvas: HTMLCanvasElement, quality: HeroQuality, options: CoreSceneOptions) {
    this.canvas = canvas;
    this.quality = quality;
    this.options = options;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr);
    this.renderer.setPixelRatio(this.dpr);

    this.onLost = (event: Event) => {
      event.preventDefault();
      this.options.onContextLost?.();
    };
    canvas.addEventListener("webglcontextlost", this.onLost);

    this.scene.fog = new THREE.FogExp2(0x09090b, 0.026);
    this.scene.add(this.rig);

    if (quality.environment) this.setupEnvironment();
    this.setupLights();

    // --- Capas ---
    this.layerCount = quality.layers;
    const n = this.layerCount;
    this.layerClass = new Uint8Array(n);
    this.layerSlot = new Uint16Array(n);
    this.layerY = new Float32Array(n);
    this.layerRadius = new Float32Array(n);
    this.layerSpawn = new Float32Array(n * 3);
    this.layerPhase = new Float32Array(n);
    this.layerTilt = new Float32Array(n);
    this.layerDelay = new Float32Array(n);
    // Capas casi en contacto: la separación de apilado fija el grosor, con una fina línea entre ellas.
    this.layerSy = ((CORE_HEIGHT / (n - 1)) * 0.96) / (2 * LAYER_HALF_HEIGHT);
    this.buildLayers();

    // --- Piezas ---
    this.buildPieces();

    // --- Corazón ---
    const glowTexture = makeGlowTexture();
    this.disposables.push(glowTexture);

    const heartGeo = new THREE.IcosahedronGeometry(0.4, 3);
    const heartMat = new THREE.MeshBasicMaterial({ color: 0xffb36b, toneMapped: false });
    this.disposables.push(heartGeo, heartMat);
    this.heartCore = new THREE.Mesh(heartGeo, heartMat);
    this.heart.add(this.heartCore);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xff780a,
      emissive: 0xff5a00,
      emissiveIntensity: 1.6,
      metalness: 0.4,
      roughness: 0.35,
    });
    this.disposables.push(ringMat);
    [0.72, 0.98, 1.24].forEach((radius, index) => {
      const geo = new THREE.TorusGeometry(radius, 0.012 + index * 0.003, 8, 72);
      this.disposables.push(geo);
      const ring = new THREE.Mesh(geo, ringMat);
      ring.rotation.set(index * 0.9, index * 0.5, index * 0.3);
      this.heartRings.push(ring);
      this.heart.add(ring);
    });

    const haloMat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xff7a1a,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.disposables.push(haloMat);
    this.heartHalo = new THREE.Sprite(haloMat);
    this.heartHalo.renderOrder = 10;
    this.heart.add(this.heartHalo);
    this.heart.add(this.heartLight);
    this.heart.scale.setScalar(0.0001);
    this.rig.add(this.heart);

    // Boquilla: luz que recorre la capa que se está imprimiendo.
    const nozzleMat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffa24d,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.disposables.push(nozzleMat);
    this.nozzleGlow = new THREE.Sprite(nozzleMat);
    this.nozzleGlow.scale.setScalar(1.1);
    this.rig.add(this.nozzleLight, this.nozzleGlow);

    // --- Plataforma de impresión ---
    const bedGlowGeo = new THREE.CircleGeometry(4.6, 64);
    const bedGlowMat = new THREE.MeshBasicMaterial({
      map: glowTexture,
      color: 0xff6a00,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.disposables.push(bedGlowGeo, bedGlowMat);
    this.bedMaterials.push(bedGlowMat);
    this.bedGlow = new THREE.Mesh(bedGlowGeo, bedGlowMat);
    this.bedGlow.rotation.x = -Math.PI / 2;
    this.bed.add(this.bedGlow);
    [
      [2.3, 2.33, 0.32],
      [3.1, 3.12, 0.2],
      [4.0, 4.015, 0.12],
    ].forEach(([inner, outer, opacity]) => {
      const geo = new THREE.RingGeometry(inner, outer, 128);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff8a2a,
        transparent: true,
        opacity,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      this.disposables.push(geo, mat);
      this.bedMaterials.push(mat);
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      this.bed.add(ring);
    });
    this.bed.position.y = BED_Y;
    this.scene.add(this.bed);

    // --- Partículas ---
    this.dust = this.buildDust(glowTexture);
    this.scene.add(this.dust);

    this.camera.position.set(0, 1.3, this.baseZ);
  }

  // ---------------------------------------------------------------- construcción

  private setupEnvironment(): void {
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const target = pmrem.fromScene(room, 0.04);
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = 0.55;
    room.dispose();
    pmrem.dispose();
    this.disposables.push(target);
  }

  private setupLights(): void {
    const key = new THREE.DirectionalLight(0xffe2c4, 2.4);
    key.position.set(4, 6, 7);
    const rim = new THREE.DirectionalLight(0xff6a00, 3.4);
    rim.position.set(-6, 2.5, -5);
    const fill = new THREE.PointLight(0x6d86ff, 22, 18, 2);
    fill.position.set(6, -2.5, 3);
    const top = new THREE.PointLight(0xffffff, 14, 14, 2);
    top.position.set(0, 6.5, 1);
    const ambient = new THREE.AmbientLight(0x2a2230, this.quality.environment ? 0.5 : 1.4);
    this.scene.add(key, rim, fill, top, ambient);
  }

  private buildLayers(): void {
    const n = this.layerCount;
    const rnd = mulberry32(0x57a9);

    const geometry = buildSlabGeometry(this.quality.ringSegments, Math.max(12, this.quality.tubeSegments * 3));
    this.disposables.push(geometry);

    // Cuerpo: metal satinado con degradado grafito → acero → cobre (color por instancia). Acento: capas naranjas luminosas.
    const materials = [
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.92, roughness: 0.27 }),
      new THREE.MeshStandardMaterial({ color: 0xff780a, emissive: 0xff4d00, emissiveIntensity: 1.1, metalness: 0.2, roughness: 0.42 }),
    ];
    materials.forEach((material) => this.disposables.push(material));

    const counts = [0, 0];
    const lowColor = new THREE.Color(0x24242b);
    const midColor = new THREE.Color(0x7d818d);
    const highColor = new THREE.Color(0xc4743c);
    const tint = new THREE.Color();
    const tints: THREE.Color[] = [];
    for (let i = 0; i < n; i += 1) {
      const cls = i % 9 === 4 ? 1 : 0;
      this.layerClass[i] = cls;
      this.layerSlot[i] = counts[cls];
      counts[cls] += 1;

      const t = i / (n - 1);
      this.layerY[i] = (t - 0.5) * CORE_HEIGHT;
      this.layerRadius[i] = profileRadius(t);
      this.layerPhase[i] = t * SCULPTURE_TWIST;
      this.layerTilt[i] = Math.sin(i * 0.55) * 0.1;
      this.layerDelay[i] = t * 0.5;

      if (t < 0.5) tint.copy(lowColor).lerp(midColor, smoothstep(0, 0.5, t));
      else tint.copy(midColor).lerp(highColor, smoothstep(0.45, 1, t));
      tints[i] = tint.clone();

      const angle = i * 2.399;
      const spawnRadius = 6 + rnd() * 3.5;
      this.layerSpawn[i * 3] = Math.cos(angle) * spawnRadius;
      this.layerSpawn[i * 3 + 1] = this.layerY[i] + 3.5 + rnd() * 3;
      this.layerSpawn[i * 3 + 2] = Math.sin(angle) * spawnRadius;
    }

    materials.forEach((material, cls) => {
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(counts[cls], 1));
      mesh.count = counts[cls];
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (cls === 0) {
        for (let i = 0; i < n; i += 1) if (this.layerClass[i] === 0) mesh.setColorAt(this.layerSlot[i], tints[i]);
      }
      this.layerMeshes.push(mesh);
      this.rig.add(mesh);
      this.disposables.push({ dispose: () => mesh.dispose() });
    });
  }

  private buildPieces(): void {
    const rnd = mulberry32(0x91c3);
    const total = this.quality.pieces;

    // Pocas piezas, pequeñas y sobrias: acompañan a la escultura sin competir con ella.
    const geometries = [
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.BoxGeometry(1, 0.14, 0.7),
      new THREE.TorusGeometry(1, 0.06, 10, 44),
    ];
    const materials = [
      new THREE.MeshStandardMaterial({ color: 0xa5abb8, metalness: 1, roughness: 0.24, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0xff780a, emissive: 0x3a1400, metalness: 0.08, roughness: 0.55 }),
      new THREE.MeshStandardMaterial({ color: 0xd9731f, metalness: 1, roughness: 0.3 }),
    ];
    geometries.forEach((g) => this.disposables.push(g));
    materials.forEach((m) => this.disposables.push(m));

    const perFamily = [0, 0, 0];
    for (let k = 0; k < total; k += 1) {
      const family = k % 3;
      const slot = perFamily[family];
      perFamily[family] += 1;

      // Altura y radio: siempre bien por fuera de la silueta de la escultura.
      const h = (rnd() - 0.5) * (CORE_HEIGHT + 0.4);
      const tNorm = clamp01(h / CORE_HEIGHT + 0.5);
      const rho = profileRadius(tNorm) * 1.12 + 1.25 + rnd() * 1.4;
      const phi = k * 2.399 + rnd() * 0.6;
      const home = new THREE.Vector3(Math.cos(phi) * rho, h, Math.sin(phi) * rho);

      const spawn = home.clone().multiplyScalar(2.9);
      spawn.y += 2.5 + rnd() * 4;

      const scale = new THREE.Vector3();
      if (family === 0) scale.set(0.12 + rnd() * 0.1, 0.2 + rnd() * 0.14, 0.12 + rnd() * 0.08);
      else if (family === 1) scale.setScalar(0.22 + rnd() * 0.2);
      else scale.setScalar(0.17 + rnd() * 0.14);

      this.pieces.push({
        family,
        slot,
        home,
        spawn,
        baseQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28)),
        axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
        rate: (rnd() < 0.5 ? -1 : 1) * (0.1 + rnd() * 0.25),
        scale,
        delay: 0.4 + rnd() * 0.3,
        bob: rnd() * 6.28,
        drift: 0.75 + rnd() * 0.7,
      });
    }

    materials.forEach((material, family) => {
      const mesh = new THREE.InstancedMesh(geometries[family], material, Math.max(perFamily[family], 1));
      mesh.count = perFamily[family];
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.rig.add(mesh);
      this.families.push({ mesh, ids: [] });
      this.disposables.push({ dispose: () => mesh.dispose() });
    });
  }

  private buildDust(texture: THREE.Texture): THREE.Points {
    const rnd = mulberry32(0xd057);
    const count = this.quality.dust;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const warm = new THREE.Color(0xff8a2a);
    const cool = new THREE.Color(0xdfe3f2);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      const radius = 3.8 + rnd() * 13;
      const theta = rnd() * Math.PI * 2;
      const y = (rnd() - 0.5) * 16;
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(theta) * radius;
      tmp.copy(rnd() < 0.34 ? warm : cool).multiplyScalar(0.35 + rnd() * 0.65);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.11,
      map: texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.disposables.push(geometry, material);
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  // ---------------------------------------------------------------- API pública

  /** Formación inicial 0..1 (se completa sola con el tiempo). */
  get formation(): number {
    if (this.options.reducedMotion) return 1;
    return clamp01((this.elapsed - FORMATION_DELAY) / FORMATION_SECONDS);
  }

  /** Posición del cursor normalizada a -1..1 (y hacia arriba). */
  setPointer(x: number, y: number): void {
    this.pointerTX = Math.max(-1, Math.min(1, x));
    this.pointerTY = Math.max(-1, Math.min(1, y));
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.renderer.setSize(this.width, this.height, false);
    const aspect = this.width / this.height;
    this.camera.aspect = aspect;
    const portrait = aspect < 1;
    this.camera.fov = portrait ? 44 : 36;
    this.pieceSpread = portrait ? 0.78 : 1;
    const requiredWidth = portrait ? 8.4 : 9.6;
    const fitZ = requiredWidth / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect);
    this.baseZ = Math.max(portrait ? 12 : 14.5, fitZ);
    this.applyViewOffset(1);
    // Cambiar el tamaño vacía el buffer: sin bucle de animación (movimiento reducido) hay que redibujar.
    if (this.options.reducedMotion && this.lastTimeline) this.render(this.lastTimeline, 0);
  }

  /** Desplaza el encuadre (lente) para dejar sitio al texto: a la derecha en horizontal, hacia arriba en vertical. */
  private applyViewOffset(shift: number): void {
    const aspect = this.width / this.height;
    const horizontal = smoothstep(0.85, 1.25, aspect);
    const shiftX = 0.21 * horizontal * shift;
    const shiftY = 0.15 * (1 - horizontal) * shift;
    this.camera.setViewOffset(this.width, this.height, -shiftX * this.width, shiftY * this.height, this.width, this.height);
  }

  render(timeline: HeroTimeline, dt: number): void {
    if (this.disposed) return;
    this.lastTimeline = timeline;
    const step = this.options.reducedMotion ? 0 : Math.min(dt, 0.05);
    this.elapsed += step;
    const time = this.elapsed;
    const formation = this.formation;
    if (!this.formedNotified && formation >= 1) {
      this.formedNotified = true;
      this.options.onFormed?.();
    }

    // Cursor suavizado (se atenúa al avanzar el scroll).
    const follow = 1 - Math.exp(-step * 3.2);
    this.pointerX += (this.pointerTX - this.pointerX) * follow;
    this.pointerY += (this.pointerTY - this.pointerY) * follow;
    const idle = this.options.reducedMotion ? 0 : timeline.idle;

    // Rig: flotación, giro lento y reacción sutil al cursor.
    this.spin += step * 0.1 * (0.35 + 0.65 * idle);
    this.rig.rotation.y = this.spin + this.pointerX * 0.3 * idle + timeline.twist;
    this.rig.rotation.x = 0.07 - this.pointerY * 0.13 * idle;
    this.rig.position.y = Math.sin(time * 0.75) * 0.1 * idle;
    this.rig.updateMatrixWorld();

    // Cámara
    const parallax = idle * 0.35;
    this.camera.position.set(this.pointerX * parallax, timeline.camY - this.pointerY * 0.16 * idle, timeline.camZ);
    this.camera.lookAt(this.pointerX * -0.12 * idle, timeline.lookY, timeline.camZ - 9);
    this.applyViewOffset(timeline.shift);

    this.updateLayers(timeline, time, formation);
    this.updatePieces(timeline, time, formation);
    this.updateHeart(timeline, time, formation);
    this.updateNozzle(time, formation, timeline);
    this.updateBed(timeline, formation);

    this.dust.rotation.y = time * 0.012;
    this.dust.position.y = Math.sin(time * 0.3) * 0.25;
    (this.dust.material as THREE.PointsMaterial).opacity = 0.6 * smoothstep(0, 0.4, formation + 0.05);

    this.renderer.render(this.scene, this.camera);
    this.adaptQuality(dt);
  }

  private updateLayers(tl: HeroTimeline, time: number, formation: number): void {
    const n = this.layerCount;
    const ex = tl.explode;
    const dummy = this.dummy;
    for (let i = 0; i < n; i += 1) {
      const f = clamp01((formation - this.layerDelay[i]) / 0.42);
      const e = easeOutCubic(f);
      const grow = smoothstep(0, 0.3, f);
      const yHome = this.layerY[i] * (1 + 1.75 * ex);
      const x = lerp(this.layerSpawn[i * 3], 0, e);
      const y = lerp(this.layerSpawn[i * 3 + 1], yHome, e);
      const z = lerp(this.layerSpawn[i * 3 + 2], 0, e);
      const radius = this.layerRadius[i] * (1 + 0.5 * ex + 0.2 * ex * Math.sin(i * 0.7)) * Math.max(grow, 0.0001);
      const sign = i % 2 === 0 ? 1 : -1;
      const flex = (i / n - 0.5) * Math.sin(time * 0.45) * 0.1;
      const rotY = this.layerPhase[i] + flex + ex * (i - n / 2) * 0.04 + (1 - e) * 2.4 * sign;
      const rotX = (1 - e) * 0.9 * sign + ex * this.layerTilt[i];
      dummy.position.set(x, y, z);
      dummy.rotation.set(rotX, rotY, (1 - e) * 0.5 * -sign);
      dummy.scale.set(radius, this.layerSy * Math.max(grow, 0.0001), radius);
      dummy.updateMatrix();
      this.layerMeshes[this.layerClass[i]].setMatrixAt(this.layerSlot[i], dummy.matrix);
    }
    for (const mesh of this.layerMeshes) mesh.instanceMatrix.needsUpdate = true;
  }

  private updatePieces(tl: HeroTimeline, time: number, formation: number): void {
    const ex = tl.explode;
    const dummy = this.dummy;
    const cam = this.camera.position;
    for (const piece of this.pieces) {
      const f = clamp01((formation - piece.delay) / 0.32);
      const e = easeOutCubic(f);
      const grow = smoothstep(0, 0.25, f);

      const outward = 1 + ex * 2.3 * piece.drift;
      this.tmpV.copy(piece.home).multiplyScalar(this.pieceSpread * outward);
      this.tmpV.y += Math.sin(time * 0.6 + piece.bob) * 0.08 * (1 - ex * 0.5);
      this.tmpV.lerpVectors(piece.spawn, this.tmpV, e);
      dummy.position.copy(this.tmpV);

      const angle = time * piece.rate + (1 - e) * 5 + ex * piece.rate * 5;
      this.tmpQ.setFromAxisAngle(piece.axis, angle);
      this.tmpQ2.copy(this.tmpQ).multiply(piece.baseQuat);
      dummy.quaternion.copy(this.tmpQ2);

      // Se encogen al pasar cerca de la cámara para que la travesía quede despejada.
      this.tmpV.applyMatrix4(this.rig.matrixWorld);
      const near = smoothstep(0.9, 3.4, this.tmpV.distanceTo(cam));
      const s = grow * near;
      dummy.scale.set(piece.scale.x * s, piece.scale.y * s, piece.scale.z * s);
      dummy.updateMatrix();
      this.families[piece.family].mesh.setMatrixAt(piece.slot, dummy.matrix);
    }
    for (const family of this.families) family.mesh.instanceMatrix.needsUpdate = true;
  }

  private updateHeart(tl: HeroTimeline, time: number, formation: number): void {
    const appear = smoothstep(0.72, 1, formation);
    const glow = tl.glow;
    const pulse = 1 + Math.sin(time * 2.1) * 0.04;
    this.heart.scale.setScalar(Math.max(0.0001, appear * (0.8 + glow * 1.6) * pulse));
    this.heartRings.forEach((ring, index) => {
      ring.rotation.x += 0.004 * (index + 1);
      ring.rotation.y += 0.003 * (3 - index);
    });
    const halo = this.heartHalo.material as THREE.SpriteMaterial;
    halo.opacity = (0.16 + 0.7 * glow) * appear;
    this.heartHalo.scale.setScalar(4.2 + glow * 9);
    this.heartLight.intensity = (6 + 70 * glow) * appear;
  }

  private updateNozzle(time: number, formation: number, tl: HeroTimeline): void {
    const building = formation > 0 && formation < 0.96 && tl.explode < 0.2;
    const material = this.nozzleGlow.material as THREE.SpriteMaterial;
    if (!building) {
      this.nozzleLight.intensity = 0;
      material.opacity = 0;
      return;
    }
    const n = this.layerCount;
    const front = clamp01(formation / 0.55);
    const index = Math.min(n - 1, Math.floor(front * (n - 1)));
    const radius = this.layerRadius[index] * 1.12;
    const angle = time * 9;
    this.nozzleGlow.position.set(Math.cos(angle) * radius, this.layerY[index], Math.sin(angle) * radius);
    this.nozzleLight.position.copy(this.nozzleGlow.position);
    const fade = 1 - smoothstep(0.55, 0.92, formation);
    this.nozzleLight.intensity = 16 * fade;
    material.opacity = 0.95 * fade;
  }

  private updateBed(tl: HeroTimeline, formation: number): void {
    const visible = smoothstep(0, 0.35, formation) * (1 - smoothstep(0.1, 0.6, tl.explode));
    this.bed.visible = visible > 0.01;
    this.bed.scale.setScalar(1 + tl.explode * 1.2);
    this.bedMaterials.forEach((material, index) => {
      material.opacity = (index === 0 ? 0.22 : [0.32, 0.2, 0.12][index - 1]) * visible;
    });
  }

  /** Si el equipo no sostiene ~35 fps, baja la resolución de render de a pasos (máx. 4, hasta 0,75×). */
  private adaptQuality(dt: number): void {
    if (this.options.reducedMotion || dt <= 0 || dt > 0.5) return;
    this.frameAvg = this.frameAvg * 0.94 + dt * 1000 * 0.06;
    this.frameCount += 1;
    if (this.frameCount > 45 && this.frameAvg > 28 && this.dpr > 0.75 && this.dprSteps < 4) {
      this.dprSteps += 1;
      this.dpr = Math.max(0.75, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.width, this.height, false);
      this.frameCount = 0;
      this.frameAvg = 16;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    for (const resource of this.disposables) resource.dispose();
    this.disposables.length = 0;
    this.scene.environment = null;
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
