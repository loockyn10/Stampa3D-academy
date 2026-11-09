/**
 * Miniaturas de objetos clásicos de impresión 3D, construidas con geometría procedural (sin assets externos).
 *
 * Identidad común: todas parecen impresas con el mismo filamento marfil mate-satinado, con líneas de capa sutiles
 * (shader) y pequeños acentos naranjas. Sin metales ni colores arcoíris.
 *
 * - Barco de calibración: modelo ORIGINAL (casco loftado, camarote, techo, chimenea, caseta de proa) con la silueta clásica
 *   de las pruebas de impresión. NO es 3DBenchy: ese modelo se publica con CC BY-ND 4.0 (sin derivados), lo que impide
 *   convertirlo/optimizarlo para web, y descargarlo sin autorización no corresponde. No se presenta como el modelo oficial.
 * - Torre de temperatura: base y niveles con voladizo, puente y marca de nivel.
 * - Cubo de calibración XYZ: cubo biselado con letras legibles en relieve.
 * - Engranaje recto con aligeramientos y buje naranja.
 *
 * Cada modelo se fusiona en UNA geometría con colores por vértice (un draw call), centrada y normalizada a ~1 unidad de
 * lado mayor; quien la use decide la escala. Todo se libera con `dispose()` de la geometría y el material.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export type PrintedModelId = "boat" | "tower" | "cube" | "gear";

export type PrintedModel = {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
};

type Part = { geometry: THREE.BufferGeometry; color: THREE.ColorRepresentation };

const IVORY = 0xeee5d3;
const IVORY_SHADE = 0xd8ccb6;
const ORANGE = 0xf0701a;
const DARK = 0x3b362f;

/** Fusiona partes con color por vértice, centra el resultado y lo normaliza a ~1 unidad. */
function assemble(parts: Part[]): THREE.BufferGeometry {
  const prepared = parts.map(({ geometry, color }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.deleteAttribute("uv");
    const count = g.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.dispose();
    return g;
  });
  const merged = mergeGeometries(prepared, false);
  prepared.forEach((g) => g.dispose());
  if (!merged) throw new Error("No se pudo fusionar el modelo impreso");
  merged.computeBoundingBox();
  const box = merged.boundingBox as THREE.Box3;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const k = 1 / Math.max(size.x, size.y, size.z);
  merged.translate(-center.x, -center.y, -center.z);
  merged.scale(k, k, k);
  merged.computeBoundingSphere();
  return merged;
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function rounded(w: number, h: number, d: number, radius: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 3, radius).translate(x, y, z);
}

/** Si la normal del vértice de prueba apunta al lado contrario del esperado, invierte el sentido de los triángulos. */
function orient(geometry: THREE.BufferGeometry, vertex: number, axis: "x" | "y" | "z", sign: 1 | -1): void {
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal");
  const value = axis === "x" ? normal.getX(vertex) : axis === "y" ? normal.getY(vertex) : normal.getZ(vertex);
  if (value * sign >= 0) return;
  const index = geometry.getIndex();
  if (!index) return;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  geometry.computeVertexNormals();
}

// ---------------------------------------------------------------- Barco de calibración

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Cuaderna del casco en la estación u (0 = popa, 1 = proa): semimanga, calado y altura de cubierta. */
function hullStation(u: number): { beam: number; keel: number; top: number } {
  const bowT = Math.max(0, (u - 0.52) / 0.48);
  const beam = Math.max(0.006, 0.19 * (0.9 + 0.1 * smooth(0, 0.35, u)) * Math.pow(Math.max(0, 1 - Math.pow(bowT, 1.7)), 0.72));
  const keel = 0.125 * (u < 0.12 ? 0.82 + 1.5 * u : 1) * (1 - Math.pow(Math.max(0, (u - 0.58) / 0.42), 2.1)) + 0.004;
  const top = 0.095 + 0.085 * Math.pow(Math.max(0, (u - 0.5) / 0.5), 2.2) + 0.018 * Math.pow(Math.max(0, (0.22 - u) / 0.22), 2);
  return { beam, keel, top };
}

function buildBoat(): THREE.BufferGeometry {
  const STATIONS = 26;
  const SIDES = 12;

  // Casco loftado: sección en U, proa afilada y elevada, quilla que sube hacia la proa.
  const hullPositions: number[] = [];
  const stations: Array<{ x: number; beam: number; keel: number; top: number }> = [];
  for (let i = 0; i <= STATIONS; i += 1) {
    const u = i / STATIONS;
    const s = hullStation(u);
    stations.push({ x: -0.5 + u, ...s });
    for (let j = 0; j <= SIDES; j += 1) {
      const phi = (Math.PI * j) / SIDES;
      hullPositions.push(-0.5 + u, s.top - (s.top + s.keel) * Math.sin(phi), -s.beam * Math.cos(phi));
    }
  }
  const hullIndex: number[] = [];
  const row = SIDES + 1;
  for (let i = 0; i < STATIONS; i += 1) {
    for (let j = 0; j < SIDES; j += 1) {
      const a = i * row + j;
      hullIndex.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute("position", new THREE.Float32BufferAttribute(hullPositions, 3));
  hull.setIndex(hullIndex);
  orient(hull, Math.floor(STATIONS / 2) * row + SIDES / 2, "y", -1);

  // Cubierta plana.
  const deckPositions: number[] = [];
  const deckIndex: number[] = [];
  stations.forEach((s, i) => {
    deckPositions.push(s.x, s.top, -s.beam, s.x, s.top, s.beam);
    if (i < STATIONS) deckIndex.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  });
  const deck = new THREE.BufferGeometry();
  deck.setAttribute("position", new THREE.Float32BufferAttribute(deckPositions, 3));
  deck.setIndex(deckIndex);
  orient(deck, 2, "y", 1);

  // Espejo de popa.
  const first = stations[0];
  const transomPositions: number[] = [first.x, (first.top - first.keel) / 2, 0];
  const transomIndex: number[] = [];
  for (let j = 0; j <= SIDES; j += 1) {
    const phi = (Math.PI * j) / SIDES;
    transomPositions.push(first.x, first.top - (first.top + first.keel) * Math.sin(phi), -first.beam * Math.cos(phi));
  }
  for (let j = 0; j <= SIDES; j += 1) transomIndex.push(0, 1 + j, 1 + ((j + 1) % (SIDES + 1)));
  const transom = new THREE.BufferGeometry();
  transom.setAttribute("position", new THREE.Float32BufferAttribute(transomPositions, 3));
  transom.setIndex(transomIndex);
  orient(transom, 0, "x", -1);

  const cabinX = -0.19;
  const deckAtCabin = hullStation((cabinX + 0.5) ).top;
  const bowX = 0.25;
  const deckAtBow = hullStation(bowX + 0.5).top;
  const parts: Part[] = [
    { geometry: hull, color: IVORY },
    { geometry: deck, color: IVORY },
    { geometry: transom, color: IVORY_SHADE },
    // Camarote con ventanas y hueco trasero, techo con vuelo.
    { geometry: rounded(0.27, 0.24, 0.3, 0.012, cabinX, deckAtCabin + 0.12, 0), color: IVORY },
    { geometry: box(0.014, 0.085, 0.17, cabinX + 0.138, deckAtCabin + 0.15, 0), color: DARK },
    { geometry: box(0.12, 0.085, 0.014, cabinX + 0.01, deckAtCabin + 0.15, 0.153), color: DARK },
    { geometry: box(0.12, 0.085, 0.014, cabinX + 0.01, deckAtCabin + 0.15, -0.153), color: DARK },
    { geometry: box(0.014, 0.12, 0.2, cabinX - 0.138, deckAtCabin + 0.13, 0), color: DARK },
    { geometry: rounded(0.35, 0.034, 0.39, 0.012, cabinX, deckAtCabin + 0.257, 0), color: ORANGE },
    // Chimenea con boca oscura.
    { geometry: new THREE.CylinderGeometry(0.05, 0.058, 0.26, 24).translate(0.04, deckAtCabin + 0.13, 0), color: ORANGE },
    { geometry: new THREE.CylinderGeometry(0.059, 0.059, 0.034, 24).translate(0.04, deckAtCabin + 0.277, 0), color: DARK },
    // Caseta de proa.
    { geometry: rounded(0.15, 0.08, 0.2, 0.01, bowX, deckAtBow + 0.04, 0), color: IVORY },
    { geometry: rounded(0.165, 0.018, 0.215, 0.008, bowX, deckAtBow + 0.088, 0), color: ORANGE },
  ];
  return assemble(parts);
}

// ---------------------------------------------------------------- Torre de temperatura

function buildTemperatureTower(): THREE.BufferGeometry {
  const TIERS = 6;
  const TIER_H = 0.14;
  const parts: Part[] = [
    { geometry: rounded(0.68, 0.07, 0.36, 0.014, 0, 0.035, 0), color: IVORY_SHADE },
    { geometry: box(0.3, 0.012, 0.004, 0, 0.036, 0.182), color: ORANGE },
  ];
  for (let i = 0; i < TIERS; i += 1) {
    const y = 0.07 + TIER_H * (i + 0.5);
    const top = y + TIER_H / 2;
    // Columna central, voladizo a la izquierda, pilar y puente a la derecha (hueco de prueba de puentes).
    parts.push({ geometry: box(0.17, TIER_H, 0.21, 0, y, 0), color: IVORY });
    parts.push({ geometry: box(0.19, 0.042, 0.21, -0.18, top - 0.021, 0), color: IVORY });
    parts.push({ geometry: box(0.05, TIER_H, 0.21, 0.24, y, 0), color: IVORY });
    parts.push({ geometry: box(0.22, 0.042, 0.21, 0.155, top - 0.021, 0), color: IVORY });
    // Marca de nivel en la cara frontal y líneas de separación entre niveles.
    parts.push({ geometry: box(0.075, 0.016, 0.005, 0, y, 0.107), color: ORANGE });
    if (i > 0) parts.push({ geometry: box(0.17, 0.006, 0.212, 0, top - TIER_H, 0), color: IVORY_SHADE });
  }
  return assemble(parts);
}

// ---------------------------------------------------------------- Cubo de calibración XYZ

// Letras en el plano XY, mirando a +Z, ~0.3 de alto, trazo 0.062, relieve 0.03.
const STROKE = 0.062;
const RELIEF = 0.03;
const LETTER_H = 0.3;

function bar(w: number, h: number, x: number, y: number, angle = 0): THREE.BufferGeometry {
  return rounded(w, h, RELIEF, 0.006, 0, 0, 0).rotateZ(angle).translate(x, y, 0);
}

function letterX(): THREE.BufferGeometry[] {
  const len = Math.hypot(LETTER_H, 0.21);
  const angle = Math.atan2(0.21, LETTER_H);
  return [bar(STROKE, len, 0, 0, angle), bar(STROKE, len, 0, 0, -angle)];
}
function letterY(): THREE.BufferGeometry[] {
  const arm = Math.hypot(0.13, 0.15);
  const angle = Math.atan2(0.13, 0.15);
  return [bar(STROKE, arm, -0.0625, 0.09, angle), bar(STROKE, arm, 0.0625, 0.09, -angle), bar(STROKE, 0.155, 0, -0.0725)];
}
function letterZ(): THREE.BufferGeometry[] {
  const diag = Math.hypot(0.2, LETTER_H - STROKE);
  const angle = Math.atan2(0.2, LETTER_H - STROKE);
  return [bar(0.22, STROKE, 0, (LETTER_H - STROKE) / 2), bar(0.22, STROKE, 0, -(LETTER_H - STROKE) / 2), bar(STROKE, diag, 0, 0, -angle)];
}

function buildXYZCube(): THREE.BufferGeometry {
  const SIZE = 0.5;
  const parts: Part[] = [{ geometry: new RoundedBoxGeometry(SIZE, SIZE, SIZE, 4, 0.03), color: IVORY }];
  const face = SIZE / 2 - 0.004;
  // Caras laterales (la pieza gira sobre su eje vertical): X, Y, Z y X; las letras se leen sin espejo desde fuera.
  const faces: Array<{ letter: () => THREE.BufferGeometry[]; rotateY: number }> = [
    { letter: letterX, rotateY: 0 },
    { letter: letterY, rotateY: Math.PI / 2 },
    { letter: letterZ, rotateY: Math.PI },
    { letter: letterX, rotateY: -Math.PI / 2 },
  ];
  for (const { letter, rotateY } of faces) {
    for (const g of letter()) parts.push({ geometry: g.translate(0, 0, face + RELIEF / 2).rotateY(rotateY), color: ORANGE });
  }
  return assemble(parts);
}

// ---------------------------------------------------------------- Engranaje

function buildGear(): THREE.BufferGeometry {
  const TEETH = 14;
  const ROOT = 0.355;
  const TIP = 0.46;
  const pitch = (Math.PI * 2) / TEETH;
  const shape = new THREE.Shape();
  for (let i = 0; i < TEETH; i += 1) {
    const a = i * pitch;
    const pts: Array<[number, number]> = [
      [a, ROOT],
      [a + 0.14 * pitch, TIP],
      [a + 0.4 * pitch, TIP],
      [a + 0.54 * pitch, ROOT],
    ];
    pts.forEach(([angle, radius], k) => {
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  const hub = new THREE.Path();
  hub.absarc(0, 0, 0.095, 0, Math.PI * 2, true);
  shape.holes.push(hub);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const hole = new THREE.Path();
    hole.absarc(Math.cos(a) * 0.235, Math.sin(a) * 0.235, 0.07, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const body = new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: true, bevelSize: 0.011, bevelThickness: 0.011, bevelSegments: 2, curveSegments: 16 });
  // El eje queda vertical: gira como un plato sobre su eje.
  body.translate(0, 0, -0.075).rotateX(-Math.PI / 2);
  const bushing = new THREE.CylinderGeometry(0.088, 0.088, 0.19, 28);
  return assemble([
    { geometry: body, color: IVORY },
    { geometry: bushing, color: ORANGE },
  ]);
}

// ---------------------------------------------------------------- Material común

/** Capas de impresión por unidad de altura del objeto normalizado (≈ 4 px por capa a ~140 px de alto). */
const LAYERS_PER_UNIT = 34;

/**
 * Filamento marfil satinado: PBR mate, sin metal, con líneas de capa sutiles (bandas horizontales de oscurecimiento
 * ligado a la altura en el espacio del objeto, para que escalen con la pieza).
 */
function createPrintMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vObjY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjY = position.y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vObjY;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float layerBand = abs(fract(vObjY * ${LAYERS_PER_UNIT.toFixed(1)}) - 0.5) * 2.0;
        diffuseColor.rgb *= 1.0 - 0.075 * smoothstep(0.62, 1.0, layerBand);`,
      );
  };
  return material;
}

// ---------------------------------------------------------------- API

const BUILDERS: Record<PrintedModelId, () => THREE.BufferGeometry> = {
  boat: buildBoat,
  tower: buildTemperatureTower,
  cube: buildXYZCube,
  gear: buildGear,
};

export function createPrintedModel(id: PrintedModelId): PrintedModel {
  return { geometry: BUILDERS[id](), material: createPrintMaterial() };
}
