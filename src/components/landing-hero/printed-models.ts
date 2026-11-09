/**
 * Miniaturas de objetos clásicos de impresión 3D, construidas con geometría procedural simplificada (sin assets externos).
 *
 * - "Benchy": barco de pruebas con casco de proa afilada, camarote con ventanas, techo, chimenea y caseta de proa. Es una
 *   interpretación propia del icono, no el modelo original (3DBenchy se publica con licencia CC BY-ND, que no permite derivados).
 * - Torre de temperatura: base y niveles de colores con un voladizo y un puente en cada nivel.
 * - Cubo de calibración XYZ: cubo con las letras X, Y y Z en relieve.
 * - Engranaje recto con aligeramientos.
 * - Jarrón paramétrico con líneas de capa.
 *
 * Cada modelo se fusiona en UNA geometría con colores por vértice (un draw call), centrada en el origen y normalizada a
 * ~1 unidad de lado mayor; quien la use decide la escala. Todo se libera con `dispose()` de la geometría y el material.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type PrintedModelId = "benchy" | "tower" | "cube" | "gear" | "vase";

export type PrintedModel = {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
};

type Part = { geometry: THREE.BufferGeometry; color: THREE.ColorRepresentation };

/** Fusiona partes con color por vértice, centra el resultado y lo normaliza a ~1 unidad. */
function assemble(parts: Part[], normalizeTo = 1): THREE.BufferGeometry {
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
  merged.translate(-center.x, -center.y, -center.z);
  merged.scale(normalizeTo / Math.max(size.x, size.y, size.z), normalizeTo / Math.max(size.x, size.y, size.z), normalizeTo / Math.max(size.x, size.y, size.z));
  merged.computeBoundingSphere();
  return merged;
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- Benchy

function buildBenchy(): THREE.BufferGeometry {
  const RED = 0xe8512b;
  const WHITE = 0xf2ede4;
  const DARK = 0x262b33;

  // Casco: caja deformada. Proa (+X) afilada y levantada, quilla en V, borda con curva de arrufo.
  const hull = new THREE.BoxGeometry(1, 0.26, 0.4, 16, 3, 4);
  const position = hull.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    let y = position.getY(i);
    let z = position.getZ(i);
    const xn = x / 0.5;
    const bow = Math.max(0, xn);
    const stern = Math.max(0, -xn);
    z *= 1 - 0.96 * Math.pow(bow, 1.8) - 0.12 * stern * stern;
    const yn = y / 0.13;
    if (yn < 0) z *= 1 + 0.22 * yn;
    y += 0.055 * bow * bow + 0.018 * stern * stern;
    if (yn < 0) y += 0.11 * bow * bow * bow;
    position.setXYZ(i, x, y, z);
  }
  hull.computeVertexNormals();

  const deckY = 0.13 + 0.0;
  const parts: Part[] = [{ geometry: hull, color: RED }];

  // Camarote (popa), ventanas, techo.
  const cabinX = -0.19;
  parts.push({ geometry: box(0.27, 0.2, 0.3, cabinX, deckY + 0.1, 0), color: WHITE });
  parts.push({ geometry: box(0.015, 0.075, 0.15, cabinX + 0.14, deckY + 0.12, 0), color: DARK });
  parts.push({ geometry: box(0.11, 0.075, 0.012, cabinX, deckY + 0.12, 0.152), color: DARK });
  parts.push({ geometry: box(0.11, 0.075, 0.012, cabinX, deckY + 0.12, -0.152), color: DARK });
  parts.push({ geometry: box(0.31, 0.03, 0.35, cabinX, deckY + 0.215, 0), color: RED });

  // Chimenea con banda oscura en la boca.
  parts.push({ geometry: new THREE.CylinderGeometry(0.05, 0.055, 0.21, 20).translate(0.03, deckY + 0.105, 0), color: RED });
  parts.push({ geometry: new THREE.CylinderGeometry(0.056, 0.056, 0.035, 20).translate(0.03, deckY + 0.225, 0), color: DARK });

  // Caseta de proa.
  parts.push({ geometry: box(0.15, 0.075, 0.2, 0.24, deckY + 0.04, 0), color: WHITE });
  parts.push({ geometry: box(0.16, 0.015, 0.21, 0.24, deckY + 0.082, 0), color: RED });

  return assemble(parts);
}

// ---------------------------------------------------------------- Torre de temperatura

function buildTemperatureTower(): THREE.BufferGeometry {
  const TIERS = 6;
  const TIER_H = 0.14;
  const cold = new THREE.Color(0x5b7cff);
  const warm = new THREE.Color(0xff780a);
  const parts: Part[] = [{ geometry: box(0.66, 0.06, 0.34, 0, 0.03, 0), color: 0x2b2f38 }];
  for (let i = 0; i < TIERS; i += 1) {
    const color = cold.clone().lerp(warm, i / (TIERS - 1));
    const y = 0.06 + TIER_H * (i + 0.5);
    const top = y + TIER_H / 2;
    // Columna central, voladizo a la izquierda, pilar y puente a la derecha.
    parts.push({ geometry: box(0.16, TIER_H, 0.2, 0, y, 0), color });
    parts.push({ geometry: box(0.17, 0.04, 0.2, -0.165, top - 0.02, 0), color });
    parts.push({ geometry: box(0.05, TIER_H, 0.2, 0.225, y, 0), color });
    parts.push({ geometry: box(0.2, 0.04, 0.2, 0.15, top - 0.02, 0), color });
    // Marca de nivel (muesca oscura en la cara frontal).
    parts.push({ geometry: box(0.07, 0.012, 0.004, 0, y, 0.102), color: 0x1d2128 });
  }
  return assemble(parts);
}

// ---------------------------------------------------------------- Cubo de calibración XYZ

function letterX(): THREE.BufferGeometry[] {
  return [box(0.04, 0.27, 0.02).rotateZ(0.72), box(0.04, 0.27, 0.02).rotateZ(-0.72)];
}
function letterY(): THREE.BufferGeometry[] {
  return [box(0.04, 0.16, 0.02, -0.045, 0.075, 0).rotateZ(0), box(0.04, 0.16, 0.02, 0.045, 0.075, 0), box(0.04, 0.15, 0.02, 0, -0.075, 0)];
}
function letterZ(): THREE.BufferGeometry[] {
  return [box(0.21, 0.04, 0.02, 0, 0.115, 0), box(0.21, 0.04, 0.02, 0, -0.115, 0), box(0.04, 0.3, 0.02).rotateZ(0.66)];
}

function buildXYZCube(): THREE.BufferGeometry {
  const SIZE = 0.5;
  const IVORY = 0xefe6d8;
  const ORANGE = 0xff780a;
  const parts: Part[] = [{ geometry: new THREE.BoxGeometry(SIZE, SIZE, SIZE), color: IVORY }];
  const face = SIZE / 2 + 0.008;
  // Las letras se dibujan mirando a +Z y se giran a cada cara.
  for (const g of letterX()) parts.push({ geometry: g.translate(0, 0, face), color: ORANGE });
  for (const g of letterY()) parts.push({ geometry: g.translate(0, 0, face).rotateY(Math.PI / 2), color: ORANGE });
  for (const g of letterZ()) parts.push({ geometry: g.translate(0, 0, face).rotateX(-Math.PI / 2), color: ORANGE });
  return assemble(parts);
}

// ---------------------------------------------------------------- Engranaje

function buildGear(): THREE.BufferGeometry {
  const TEETH = 12;
  const ROOT = 0.36;
  const TIP = 0.46;
  const pitch = (Math.PI * 2) / TEETH;
  const shape = new THREE.Shape();
  for (let i = 0; i < TEETH; i += 1) {
    const a = i * pitch;
    const pts: Array<[number, number]> = [
      [a, ROOT],
      [a + 0.13 * pitch, TIP],
      [a + 0.4 * pitch, TIP],
      [a + 0.53 * pitch, ROOT],
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
  hub.absarc(0, 0, 0.1, 0, Math.PI * 2, true);
  shape.holes.push(hub);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const hole = new THREE.Path();
    hole.absarc(Math.cos(a) * 0.235, Math.sin(a) * 0.235, 0.065, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const body = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1, curveSegments: 14 });
  // El eje del engranaje queda vertical: gira como un plato sobre su eje.
  body.translate(0, 0, -0.07).rotateX(-Math.PI / 2);
  return assemble([{ geometry: body, color: 0xb9bfcc }]);
}

// ---------------------------------------------------------------- Jarrón paramétrico

function buildVase(): THREE.BufferGeometry {
  const points: THREE.Vector2[] = [];
  const steps = 72;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const body = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.25)), 0.85);
    const ridge = 1 + 0.012 * Math.sin(t * 56);
    const radius = (0.1 + 0.22 * body + 0.06 * smooth(0.8, 1, t)) * ridge;
    points.push(new THREE.Vector2(radius, t * 0.9));
  }
  const lathe = new THREE.LatheGeometry(points, 40);
  return assemble([{ geometry: lathe, color: 0xeadcc4 }]);
}

// ---------------------------------------------------------------- API

const BUILDERS: Record<PrintedModelId, { build: () => THREE.BufferGeometry; roughness: number; metalness: number; doubleSided?: boolean }> = {
  benchy: { build: buildBenchy, roughness: 0.52, metalness: 0.02 },
  tower: { build: buildTemperatureTower, roughness: 0.5, metalness: 0.02 },
  cube: { build: buildXYZCube, roughness: 0.5, metalness: 0.02 },
  gear: { build: buildGear, roughness: 0.3, metalness: 0.9 },
  vase: { build: buildVase, roughness: 0.45, metalness: 0, doubleSided: true },
};

export function createPrintedModel(id: PrintedModelId): PrintedModel {
  const spec = BUILDERS[id];
  const geometry = spec.build();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  return { geometry, material };
}
