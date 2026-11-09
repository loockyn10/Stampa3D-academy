/**
 * Variante "lámpara de diseño" del Hero (prueba creativa: /landing-preview?modelo=lampara).
 *
 * Una lámpara impresa en modo jarrón: pantalla ondulada y torcida hecha de capas apiladas casi en contacto, sobre una base
 * sólida con la misma geometría de capas. Se construye capa por capa, queda apagada y después se enciende desde adentro.
 *
 * Mantiene el mismo contrato que `HeroCoreScene` (render / setPointer / resize / dispose), de modo que el controlador de
 * scroll, la línea de tiempo y el resto del Hero no cambian. La luz es un material emisivo modulado en el shader, no una
 * esfera visible: la pantalla parece translúcida sin pagar el coste de `transmission`.
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { CoreSceneOptions } from "./core-scene";
import type { HeroQuality } from "./hero-quality";
import { clamp01, easeOutCubic, lerp, smoothstep, type HeroTimeline } from "./hero-timeline";
import { makeGlowTexture, mulberry32 } from "./scene-utils";

const BASE_Y0 = -2.85;
const BASE_HEIGHT = 0.62;
const SHADE_Y0 = BASE_Y0 + BASE_HEIGHT - 0.02;
const SHADE_HEIGHT = 5.0;
const SHADE_CENTER = SHADE_Y0 + SHADE_HEIGHT / 2;
const BULB_Y = -0.7;
const BED_Y = BASE_Y0 - 0.03;

const FORMATION_SECONDS = 4.6;
const FORMATION_DELAY = 0.35;
/** El encendido empieza un instante después de terminar el ensamblaje y dura unos segundos. */
const IGNITE_DELAY = 0.8;
const IGNITE_SECONDS = 3.2;

const SHADE_OFF_COLOR = new THREE.Color(0xf0e4d0);
const SHADE_ON_COLOR = new THREE.Color(0xb59a7c);

const LOBES = 5;
const LOBE_AMPLITUDE = 0.07;
const SHADE_TWIST = 2.8;
const WALL_RATIO = 0.955;
const HALF_HEIGHT = 0.05;

/** Silueta de la pantalla (radio por altura normalizada): cuello angosto, vientre amplio y boca levemente cerrada. */
function shadeRadius(t: number): number {
  const body = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.4)), 0.9);
  const ripple = 1 + 0.025 * Math.sin(t * Math.PI * 5);
  return (0.66 + 0.7 * body + 0.33 * smoothstep(0.75, 1, t)) * ripple;
}

/** Base: pedestal ancho y bajo con borde redondeado que sostiene el cuello de la pantalla (u: 0 abajo → 1 arriba). */
function baseRadius(u: number): number {
  const edge = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, u - 0.6) / 0.4, 2)));
  return 1.02 * (0.9 + 0.1 * edge) - 0.04 * u;
}

/**
 * Losa con bordes redondeados y contorno de cinco lóbulos suaves. `inner` = 1 - espesor relativo de pared
 * (0 = disco macizo). Se comparte entre todas las capas; el radio y el giro de cada una forman la silueta y la torsión.
 */
function buildSlabGeometry(thetaSegments: number, crossSegments: number, inner: number): THREE.BufferGeometry {
  const count = thetaSegments * crossSegments;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const squircle = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.5);
  for (let j = 0; j < thetaSegments; j += 1) {
    const theta = (j / thetaSegments) * Math.PI * 2;
    const outer = 1 + LOBE_AMPLITUDE * Math.sin(LOBES * theta);
    const cx = Math.cos(theta);
    const sz = Math.sin(theta);
    for (let k = 0; k < crossSegments; k += 1) {
      const u = (k / crossSegments) * Math.PI * 2;
      const px = squircle(Math.cos(u));
      const py = squircle(Math.sin(u));
      const radius = outer * (inner + ((1 - inner) * (px + 1)) / 2);
      const o = j * crossSegments + k;
      positions[o * 3] = cx * radius;
      positions[o * 3 + 1] = py * HALF_HEIGHT;
      positions[o * 3 + 2] = sz * radius;
      uvs[o * 2] = j / thetaSegments;
      uvs[o * 2 + 1] = (py + 1) / 2;
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
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Orientación: en la cara exterior (u = 0, θ = 0) la normal debe apuntar hacia +X.
  if (geometry.getAttribute("normal").getX(0) < 0) {
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

export class HeroLampScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly quality: HeroQuality;
  private readonly options: CoreSceneOptions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.05, 80);
  private readonly rig = new THREE.Group();
  private readonly disposables: Array<{ dispose: () => void }> = [];

  private readonly shadeCount: number;
  private readonly baseCount: number;
  private readonly shadeMesh: THREE.InstancedMesh;
  private readonly baseMesh: THREE.InstancedMesh;
  private readonly shadeMaterial: THREE.MeshStandardMaterial;
  private readonly shadePitch: number;
  private readonly basePitch: number;
  private readonly shadeSpawn: Float32Array;
  private readonly baseSpawn: Float32Array;

  private readonly bulbLight = new THREE.PointLight(0xffa955, 0, 7.5, 2);
  private readonly bulbGlow: THREE.Sprite;
  private readonly nozzleLight = new THREE.PointLight(0xffb36b, 0, 4.5, 2);
  private readonly nozzleGlow: THREE.Sprite;
  private readonly bed = new THREE.Group();
  private readonly bedMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly bedBase = [0.22, 0.28, 0.16, 0.1];
  private readonly dust: THREE.Points;
  private readonly dummy = new THREE.Object3D();

  private width = 1;
  private height = 1;
  private dpr = 1;
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

  baseZ = 14.5;
  readonly endZ = -4.6;

  constructor(canvas: HTMLCanvasElement, quality: HeroQuality, options: CoreSceneOptions) {
    this.canvas = canvas;
    this.quality = quality;
    this.options = options;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr);
    this.renderer.setPixelRatio(this.dpr);

    this.onLost = (event: Event) => {
      event.preventDefault();
      this.options.onContextLost?.();
    };
    canvas.addEventListener("webglcontextlost", this.onLost);

    this.scene.fog = new THREE.FogExp2(0x09090b, 0.024);
    this.scene.add(this.rig);
    if (quality.environment) this.setupEnvironment();
    this.setupLights();

    const glowTexture = makeGlowTexture();
    this.disposables.push(glowTexture);

    // --- Capas: pantalla (hueca) y base (maciza) ---
    this.shadeCount = quality.layers;
    this.baseCount = Math.max(5, Math.round(quality.layers * 0.16));
    this.shadePitch = SHADE_HEIGHT / this.shadeCount;
    this.basePitch = BASE_HEIGHT / this.baseCount;
    const thetaSegments = quality.ringSegments;
    const crossSegments = quality.tier === "low" ? 8 : 12;

    const shadeGeometry = buildSlabGeometry(thetaSegments, crossSegments, WALL_RATIO);
    const baseGeometry = buildSlabGeometry(thetaSegments, crossSegments, 0);
    const layerT = new Float32Array(this.shadeCount);
    for (let i = 0; i < this.shadeCount; i += 1) layerT[i] = (i + 0.5) / this.shadeCount;
    shadeGeometry.setAttribute("aT", new THREE.InstancedBufferAttribute(layerT, 1));
    this.disposables.push(shadeGeometry, baseGeometry);

    this.shadeMaterial = this.createShadeMaterial();
    // Base en madera clara mate: contrasta con la pantalla y reconoce el objeto como lámpara de mesa.
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xb98557, roughness: 0.62, metalness: 0.02 });
    this.disposables.push(this.shadeMaterial, baseMaterial);

    this.shadeMesh = new THREE.InstancedMesh(shadeGeometry, this.shadeMaterial, this.shadeCount);
    this.baseMesh = new THREE.InstancedMesh(baseGeometry, baseMaterial, this.baseCount);
    for (const mesh of [this.shadeMesh, this.baseMesh]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.rig.add(mesh);
      this.disposables.push({ dispose: () => mesh.dispose() });
    }

    const rnd = mulberry32(0x1a3b);
    this.shadeSpawn = new Float32Array(this.shadeCount * 3);
    for (let i = 0; i < this.shadeCount; i += 1) {
      const angle = i * 2.399 + rnd() * 0.8;
      const radius = 5.5 + rnd() * 4;
      const home = SHADE_Y0 + (i + 0.5) * this.shadePitch;
      this.shadeSpawn[i * 3] = Math.cos(angle) * radius;
      this.shadeSpawn[i * 3 + 1] = home + (rnd() < 0.7 ? 1 : -0.6) * (3 + rnd() * 3.5);
      this.shadeSpawn[i * 3 + 2] = Math.sin(angle) * radius;
    }
    this.baseSpawn = new Float32Array(this.baseCount * 3);
    for (let i = 0; i < this.baseCount; i += 1) {
      const angle = i * 2.399 + 1.1;
      const radius = 5 + rnd() * 3;
      this.baseSpawn[i * 3] = Math.cos(angle) * radius;
      this.baseSpawn[i * 3 + 1] = BASE_Y0 + 0.3 + rnd() * 1.8;
      this.baseSpawn[i * 3 + 2] = Math.sin(angle) * radius;
    }

    // --- Luz interior: se ve a través de las paredes, no como una esfera ---
    const bulbMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffd6a0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.disposables.push(bulbMaterial);
    this.bulbGlow = new THREE.Sprite(bulbMaterial);
    this.bulbGlow.position.set(0, BULB_Y, 0);
    this.bulbLight.position.set(0, BULB_Y, 0);
    this.rig.add(this.bulbLight, this.bulbGlow);

    // Cabezal de impresión: luz cálida que recorre la capa que se está construyendo.
    const nozzleMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffa24d,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.disposables.push(nozzleMaterial);
    this.nozzleGlow = new THREE.Sprite(nozzleMaterial);
    this.nozzleGlow.scale.setScalar(0.9);
    this.rig.add(this.nozzleLight, this.nozzleGlow);

    // --- Plataforma / mesa: el halo cálido crece cuando la lámpara se enciende ---
    const bedGlowGeometry = new THREE.CircleGeometry(4.4, 64);
    const bedGlowMaterial = new THREE.MeshBasicMaterial({
      map: glowTexture,
      color: 0xff9a3c,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.disposables.push(bedGlowGeometry, bedGlowMaterial);
    this.bedMaterials.push(bedGlowMaterial);
    const bedGlow = new THREE.Mesh(bedGlowGeometry, bedGlowMaterial);
    bedGlow.rotation.x = -Math.PI / 2;
    this.bed.add(bedGlow);
    [
      [2.3, 2.33],
      [3.1, 3.12],
      [4.0, 4.015],
    ].forEach(([innerRadius, outerRadius], index) => {
      const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 128);
      const material = new THREE.MeshBasicMaterial({
        color: 0xff8a2a,
        transparent: true,
        opacity: this.bedBase[index + 1],
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      this.disposables.push(geometry, material);
      this.bedMaterials.push(material);
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = -Math.PI / 2;
      this.bed.add(ring);
    });
    this.bed.position.y = BED_Y;
    this.scene.add(this.bed);

    this.dust = this.buildDust(glowTexture);
    this.scene.add(this.dust);

    this.camera.position.set(0, 1.3, this.baseZ);
  }

  // ---------------------------------------------------------------- construcción

  /**
   * Pantalla de plástico translúcido: blanco cálido apagada; encendida, emisivo ámbar suave. El shader modula el emisivo
   * con la orientación (el centro brilla más que los bordes), las líneas entre capas y la altura (más cerca de la luz = más brillo).
   */
  private createShadeMaterial(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0xf0e4d0,
      roughness: 0.5,
      metalness: 0,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0xff9f45),
      emissiveIntensity: 0,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aT;\nvarying float vLayerT;\nvarying float vLayerS;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLayerT = aT;\nvLayerS = uv.y;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vLayerT;\nvarying float vLayerS;")
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          float facing = abs(normalize(vNormal).z);
          totalEmissiveRadiance *= mix(0.38, 1.05, pow(facing, 0.85)) * (0.84 + 0.16 * cos(vLayerS * 6.28318)) * mix(1.0, 0.58, vLayerT);`,
        );
    };
    return material;
  }

  private setupEnvironment(): void {
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const target = pmrem.fromScene(room, 0.04);
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = 0.5;
    room.dispose();
    pmrem.dispose();
    this.disposables.push(target);
  }

  private setupLights(): void {
    const key = new THREE.DirectionalLight(0xffe6cc, 2.3);
    key.position.set(4, 6, 7);
    const rim = new THREE.DirectionalLight(0xff8a3a, 2.2);
    rim.position.set(-6, 2.5, -5);
    const fill = new THREE.PointLight(0x6d86ff, 14, 18, 2);
    fill.position.set(6, -2.5, 3);
    const top = new THREE.PointLight(0xffffff, 8, 14, 2);
    top.position.set(0, 6.5, 1);
    const ambient = new THREE.AmbientLight(0x2a2230, this.quality.environment ? 0.5 : 1.3);
    this.scene.add(key, rim, fill, top, ambient);
  }

  private buildDust(texture: THREE.Texture): THREE.Points {
    const rnd = mulberry32(0xd057);
    const count = Math.round(this.quality.dust * 0.6);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const warm = new THREE.Color(0xffb066);
    const cool = new THREE.Color(0xdfe3f2);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      const radius = 4 + rnd() * 13;
      const theta = rnd() * Math.PI * 2;
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = (rnd() - 0.5) * 16;
      positions[i * 3 + 2] = Math.sin(theta) * radius;
      tmp.copy(rnd() < 0.34 ? warm : cool).multiplyScalar(0.3 + rnd() * 0.6);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.1,
      map: texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
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

  /** Encendido 0..1: empieza cuando termina el ensamblaje. Con movimiento reducido la lámpara ya está encendida. */
  private get ignition(): number {
    if (this.options.reducedMotion) return 1;
    const k = clamp01((this.elapsed - (FORMATION_DELAY + FORMATION_SECONDS + IGNITE_DELAY)) / IGNITE_SECONDS);
    // Arranque lento y asentamiento suave, como un regulador de intensidad.
    return Math.pow(k * k * (3 - 2 * k), 1.35);
  }

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
    const requiredWidth = portrait ? 5.6 : 6.4;
    const fitZ = requiredWidth / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect);
    this.baseZ = Math.max(portrait ? 12 : 14.5, fitZ);
    this.applyViewOffset(1);
    if (this.options.reducedMotion && this.lastTimeline) this.render(this.lastTimeline, 0);
  }

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
    const step = this.options.reducedMotion ? 0 : Math.min(dt, 0.1);
    this.elapsed += step;
    const time = this.elapsed;
    const formation = this.formation;
    if (!this.formedNotified && formation >= 1) {
      this.formedNotified = true;
      this.options.onFormed?.();
    }

    const follow = 1 - Math.exp(-step * 3.2);
    this.pointerX += (this.pointerTX - this.pointerX) * follow;
    this.pointerY += (this.pointerTY - this.pointerY) * follow;
    const idle = this.options.reducedMotion ? 0 : timeline.idle;

    this.spin += step * 0.1 * (0.35 + 0.65 * idle);
    this.rig.rotation.y = this.spin + this.pointerX * 0.3 * idle + timeline.twist;
    this.rig.rotation.x = 0.05 - this.pointerY * 0.11 * idle;
    this.rig.position.y = Math.sin(time * 0.75) * 0.06 * idle;
    this.rig.updateMatrixWorld();

    this.camera.position.set(this.pointerX * idle * 0.35, timeline.camY - this.pointerY * 0.16 * idle, timeline.camZ);
    this.camera.lookAt(this.pointerX * -0.12 * idle, timeline.lookY, timeline.camZ - 9);
    this.applyViewOffset(timeline.shift);

    const ignition = this.ignition;
    this.updateLayers(timeline, time, formation);
    this.updateLight(timeline, ignition);
    this.updateNozzle(time, formation, timeline);
    this.updateBed(timeline, formation, ignition);

    this.dust.rotation.y = time * 0.012;
    this.dust.position.y = Math.sin(time * 0.3) * 0.25;
    (this.dust.material as THREE.PointsMaterial).opacity = 0.55 * smoothstep(0, 0.4, formation + 0.05);

    this.renderer.render(this.scene, this.camera);
    this.adaptQuality(dt);
  }

  private updateLayers(tl: HeroTimeline, time: number, formation: number): void {
    const ex = tl.explode;
    const dummy = this.dummy;
    const n = this.shadeCount;

    // Pantalla: de abajo hacia arriba; al separarse, las capas se abren hacia el centro de la pantalla.
    for (let i = 0; i < n; i += 1) {
      const t = (i + 0.5) / n;
      const f = clamp01((formation - (0.1 + t * 0.42)) / 0.42);
      const e = easeOutCubic(f);
      const grow = Math.max(smoothstep(0, 0.3, f), 0.0001);
      const sign = i % 2 === 0 ? 1 : -1;
      const yHome = SHADE_Y0 + (i + 0.5) * this.shadePitch;
      const yTarget = SHADE_CENTER + (yHome - SHADE_CENTER) * (1 + 1.75 * ex);
      const radius = shadeRadius(t) * (1 + 0.45 * ex + 0.15 * ex * Math.sin(i * 0.7)) * grow;
      const flex = (t - 0.5) * Math.sin(time * 0.45) * 0.08;
      dummy.position.set(lerp(this.shadeSpawn[i * 3], 0, e), lerp(this.shadeSpawn[i * 3 + 1], yTarget, e), lerp(this.shadeSpawn[i * 3 + 2], 0, e));
      dummy.rotation.set((1 - e) * 0.9 * sign + ex * Math.sin(i * 0.55) * 0.08, t * SHADE_TWIST + flex + ex * (i - n / 2) * 0.035 + (1 - e) * 2.4 * sign, (1 - e) * 0.5 * -sign);
      dummy.scale.set(radius, ((this.shadePitch * 1.05) / (2 * HALF_HEIGHT)) * grow, radius);
      dummy.updateMatrix();
      this.shadeMesh.setMatrixAt(i, dummy.matrix);
    }
    this.shadeMesh.instanceMatrix.needsUpdate = true;

    // Base: se construye primero y, al separar, se hunde suavemente.
    for (let i = 0; i < this.baseCount; i += 1) {
      const u = (i + 0.5) / this.baseCount;
      const f = clamp01((formation - u * 0.1) / 0.42);
      const e = easeOutCubic(f);
      const grow = Math.max(smoothstep(0, 0.3, f), 0.0001);
      const sign = i % 2 === 0 ? 1 : -1;
      const yHome = BASE_Y0 + (i + 0.5) * this.basePitch;
      const radius = baseRadius(u) * (1 + 0.25 * ex) * grow;
      dummy.position.set(lerp(this.baseSpawn[i * 3], 0, e), lerp(this.baseSpawn[i * 3 + 1], yHome - ex * 1.1, e), lerp(this.baseSpawn[i * 3 + 2], 0, e));
      dummy.rotation.set((1 - e) * 0.7 * sign, -(1 - u) * 0.45 + (1 - e) * 2 * sign, 0);
      dummy.scale.set(radius, ((this.basePitch * 1.05) / (2 * HALF_HEIGHT)) * grow, radius);
      dummy.updateMatrix();
      this.baseMesh.setMatrixAt(i, dummy.matrix);
    }
    this.baseMesh.instanceMatrix.needsUpdate = true;
  }

  private updateLight(tl: HeroTimeline, ignition: number): void {
    // El scroll empuja la luz algo más allá del encendido normal, siempre dentro de un rango sobrio.
    const boost = 1 + 0.5 * tl.glow;
    this.shadeMaterial.emissiveIntensity = 1.5 * ignition * boost;
    // Con la luz interior el plástico se ve más rico y menos "blanco de estudio": el color propio cede ante la emisión.
    this.shadeMaterial.color.lerpColors(SHADE_OFF_COLOR, SHADE_ON_COLOR, ignition);
    this.bulbLight.intensity = ignition * (9 + 26 * tl.glow);
    const glow = this.bulbGlow.material as THREE.SpriteMaterial;
    glow.opacity = ignition * (0.08 + 0.5 * tl.glow);
    this.bulbGlow.scale.setScalar(1.8 + tl.glow * 6.5);
  }

  private updateNozzle(time: number, formation: number, tl: HeroTimeline): void {
    const material = this.nozzleGlow.material as THREE.SpriteMaterial;
    if (!(formation > 0 && formation < 0.96 && tl.explode < 0.2)) {
      this.nozzleLight.intensity = 0;
      material.opacity = 0;
      return;
    }
    const front = clamp01(formation / 0.55);
    const index = Math.min(this.shadeCount - 1, Math.floor(front * (this.shadeCount - 1)));
    const t = (index + 0.5) / this.shadeCount;
    const radius = shadeRadius(t) * (1 + LOBE_AMPLITUDE) * 1.02;
    const angle = time * 9;
    this.nozzleGlow.position.set(Math.cos(angle) * radius, SHADE_Y0 + (index + 0.5) * this.shadePitch, Math.sin(angle) * radius);
    this.nozzleLight.position.copy(this.nozzleGlow.position);
    const fade = 1 - smoothstep(0.55, 0.92, formation);
    this.nozzleLight.intensity = 10 * fade;
    material.opacity = 0.85 * fade;
  }

  private updateBed(tl: HeroTimeline, formation: number, ignition: number): void {
    const visible = smoothstep(0, 0.35, formation) * (1 - smoothstep(0.1, 0.6, tl.explode));
    this.bed.visible = visible > 0.01;
    this.bed.scale.setScalar(1 + tl.explode * 1.2);
    this.bedMaterials.forEach((material, index) => {
      // El primer elemento es el halo de la mesa: se enciende con la lámpara.
      material.opacity = (index === 0 ? 0.04 + 0.34 * ignition : this.bedBase[index]) * visible;
    });
  }

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
