/**
 * Genera las imágenes de producto de la cuenta de demostración: renders 3D ORIGINALES (Three.js, ya presente en el proyecto)
 * de piezas realmente fabricables por impresión 3D (filamento con líneas de capa), sobre fondo de estudio.
 * No usan fotos ni modelos de terceros: la geometría se construye por código, así que no hay derechos que verificar.
 *
 *   node scripts/demo/render-product-images.mjs [carpeta-salida] [--only=soporte-celular,...]
 *
 * Salida: JPG cuadrados de 1200x1200 (el formulario de producto los recorta 1:1 a 1000x1000).
 * Son renders, no fotografías: no deben presentarse como fotos de producto reales.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = process.cwd();
const outDir = path.resolve(process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) || path.join(ROOT, "scripts", "demo", "assets", "products"));
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice(7).split(",") : null;
const SIZE = 1200;
fs.mkdirSync(outDir, { recursive: true });

const THREE_DIR = path.join(ROOT, "node_modules", "three");
const PAGE = `<!doctype html><html><body style="margin:0;background:#fff"><canvas id="out" width="${SIZE}" height="${SIZE}"></canvas>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const SIZE = ${SIZE};
const SS = 2; // supermuestreo: se renderiza al doble y se reduce (bordes más limpios)

// ---------------------------------------------------------------- materiales de filamento
const LAYER_H = 0.22; // cm (≈ 0,2 mm a escala 1 unidad = 1 cm... se exagera un poco para que se vea)
function printMaterial({ color, roughness = 0.52, clearcoat = 0.12, sheen = 0.25, layer = 0.2, flat = false, double = false }) {
  const m = new THREE.MeshPhysicalMaterial({ side: double ? THREE.DoubleSide : THREE.FrontSide, color, roughness, metalness: 0, clearcoat, clearcoatRoughness: 0.55, sheen, sheenRoughness: 0.6, sheenColor: new THREE.Color(color), flatShading: flat });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLayer = { value: layer };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\\nvarying float vWY;").replace("#include <begin_vertex>", "#include <begin_vertex>\\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\\nvarying float vWY;\\nuniform float uLayer;")
      .replace("#include <color_fragment>", "#include <color_fragment>\\nfloat band = abs(fract(vWY / uLayer) - 0.5) * 2.0;\\ndiffuseColor.rgb *= 0.955 + 0.045 * band;")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\\nroughnessFactor = clamp(roughnessFactor + (band - 0.5) * 0.10, 0.2, 1.0);");
  };
  return m;
}
const ORANGE = 0xff7a1a, WHITE = 0xf2f0ea, BLACK = 0x1c1c20;

// ---------------------------------------------------------------- geometría
function rrect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function hole(w, h, r) { const p = rrect(w, h, r); const path = new THREE.Path(); path.setFromPoints(p.getPoints(24).reverse()); return path; }
function extrude(shape, depth, bevel = 0.12) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 24 });
  g.translate(0, 0, -depth / 2);
  return g;
}
function hexShape(R, rot = 0) { const s = new THREE.Shape(); for (let i = 0; i < 6; i++) { const a = rot + (Math.PI / 3) * i; const x = Math.cos(a) * R, y = Math.sin(a) * R; i ? s.lineTo(x, y) : s.moveTo(x, y); } s.closePath(); return s; }
function hexHole(R, rot = 0) { const p = new THREE.Path(); for (let i = 5; i >= 0; i--) { const a = rot + (Math.PI / 3) * i; const x = Math.cos(a) * R, y = Math.sin(a) * R; i === 5 ? p.moveTo(x, y) : p.lineTo(x, y); } p.closePath(); return p; }
/** Prisma vertical (eje Y) a partir de una forma XY: se gira para que la extrusión crezca hacia arriba. */
function upright(geo, y0 = 0) { geo.rotateX(-Math.PI / 2); geo.computeBoundingBox(); geo.translate(0, y0 - geo.boundingBox.min.y, 0); return geo; }
function mesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; }
/** Superficie poligonal con torsión (jarrones facetados). */
function twistSurface({ sides, levels, height, radius, twist, inside = false }) {
  const pos = [], idx = [];
  for (let j = 0; j <= levels; j++) {
    const t = j / levels, y = t * height, r = radius(t), rot = twist * t;
    for (let i = 0; i < sides; i++) { const a = rot + (i / sides) * Math.PI * 2; pos.push(Math.cos(a) * r, y, Math.sin(a) * r); }
  }
  for (let j = 0; j < levels; j++) for (let i = 0; i < sides; i++) {
    const a = j * sides + i, b = j * sides + ((i + 1) % sides), c = (j + 1) * sides + i, d = (j + 1) * sides + ((i + 1) % sides);
    if (inside) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g.toNonIndexed();
}

// ---------------------------------------------------------------- piezas
const PIECES = {
  "soporte-auriculares"() {
    const g = new THREE.Group(), mat = printMaterial({ color: ORANGE });
    const base = new THREE.LatheGeometry([[0, 0], [6.6, 0], [6.9, 0.15], [6.9, 0.85], [6.6, 1.1], [0, 1.1]].map(([x, y]) => new THREE.Vector2(x, y)), 64);
    g.add(mesh(base, mat));
    const neck = extrude(rrect(2.6, 17, 0.9), 3.2, 0.14); upright(neck, 0); neck.rotateX(0);
    // el cuello es una placa vertical: forma en XY (ancho x alto) extruida en Z
    const neckMesh = mesh(extrude(rrect(2.6, 15.5, 1.0), 3.0, 0.14), mat); neckMesh.position.set(0, 1.1 + 7.75, 0); g.add(neckMesh);
    const head = mesh(extrude(rrect(14.5, 4.6, 2.3), 3.4, 0.16), mat); head.position.set(0, 1.1 + 15.5 + 0.9, 0); g.add(head);
    g.position.y = 0; g.userData.target = new THREE.Vector3(0, 9.5, 0); g.userData.dist = 40; g.userData.rotY = -0.62; g.userData.elev = 0.2;
    return g;
  },
  "organizador-escritorio"() {
    const g = new THREE.Group(), mat = printMaterial({ color: WHITE, roughness: 0.55 });
    const floor = mesh(extrude(rrect(21, 12.6, 1.4), 1.0, 0.14), mat); upright(floor.geometry, 0); floor.position.y = 0; g.add(floor);
    const cells = [ { x: -6.3, w: 7.0, d: 10.0, h: 10.5 }, { x: 0.35, w: 5.6, d: 10.0, h: 4.2 }, { x: 6.3, w: 6.4, d: 10.0, h: 8.0 } ];
    for (const c of cells) {
      const s = rrect(c.w, c.d, 0.9); s.holes.push(hole(c.w - 1.3, c.d - 1.3, 0.55));
      const wall = mesh(extrude(s, c.h, 0.1), mat); upright(wall.geometry, 0.9); wall.position.x = c.x; g.add(wall);
    }
    // ranura para clips/post-it al frente
    const lip = mesh(extrude(rrect(5.4, 1.1, 0.4), 2.4, 0.08), mat); upright(lip.geometry, 0.9); lip.position.set(0.35, 0, 5.2); g.add(lip);
    g.userData.target = new THREE.Vector3(0, 4.6, 0); g.userData.dist = 46; g.userData.rotY = -0.55; g.userData.elev = 0.38;
    return g;
  },
  "maceta-geometrica"() {
    const g = new THREE.Group(), mat = printMaterial({ color: BLACK, roughness: 0.32, clearcoat: 0.45, sheen: 0.1, flat: true, double: true });
    const radius = (t) => 3.3 + 3.6 * Math.pow(t, 0.8) * (1 - 0.18 * Math.sin(t * Math.PI));
    const H = 11.5;
    const outer = mesh(twistSurface({ sides: 8, levels: 46, height: H, radius, twist: 0.9 }), mat);
    const inner = mesh(twistSurface({ sides: 8, levels: 46, height: H - 0.9, radius: (t) => radius(t * (H - 0.9) / H) - 0.6, twist: 0.9, inside: true }), mat);
    inner.position.y = 0.9; const bottom = mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.9, 8), mat); bottom.rotation.y = 0.9 * 0; bottom.position.y = 0.45;
    g.add(outer, inner, bottom);
    // borde superior
    const rim = new THREE.Shape(); const R = radius(1); for (let i = 0; i < 8; i++) { const a = 0.9 + (i / 8) * Math.PI * 2; const x = Math.cos(a) * R, y = -Math.sin(a) * R; i ? rim.lineTo(x, y) : rim.moveTo(x, y); } rim.closePath();
    const hl = new THREE.Path(); for (let i = 7; i >= 0; i--) { const a = 0.9 + (i / 8) * Math.PI * 2; const x = Math.cos(a) * (R - 0.6), y = -Math.sin(a) * (R - 0.6); i === 7 ? hl.moveTo(x, y) : hl.lineTo(x, y); } hl.closePath(); rim.holes.push(hl);
    const rimMesh = mesh(new THREE.ExtrudeGeometry(rim, { depth: 0.25, bevelEnabled: false }), mat); rimMesh.rotation.x = -Math.PI / 2; rimMesh.position.y = H - 0.25; g.add(rimMesh);
    // tierra y suculenta (escenografía: NO es parte de la pieza impresa)
    const soil = mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.3, 24), new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1 })); soil.position.y = H - 1.9; g.add(soil);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x6aa04a, roughness: 0.55 });
    const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x86b862, roughness: 0.55 });
    const plant = new THREE.Group();
    [[10, 1.6, 0.0, 0.62], [8, 1.35, 0.5, 0.82], [6, 1.05, 0.9, 1.0], [4, 0.8, 1.2, 1.15]].forEach(([n, len, lift, tilt], ring) => {
      for (let i = 0; i < n; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), ring % 2 ? leafMat2 : leafMat);
        leaf.scale.set(0.45 + ring * 0.02, len * 0.95, 0.15); leaf.castShadow = true; leaf.receiveShadow = true;
        const a = (i / n) * Math.PI * 2 + ring * 0.4;
        const pivot = new THREE.Group(); pivot.rotation.y = a; leaf.position.set(0, len * 0.95, 0); const tiltG = new THREE.Group(); tiltG.rotation.z = -(Math.PI / 2 - tilt * 0.62); tiltG.add(leaf); pivot.add(tiltG); pivot.position.y = lift * 0.55; plant.add(pivot);
      }
    });
    plant.position.y = H - 1.7; plant.scale.setScalar(1.35); g.add(plant);
    g.userData.target = new THREE.Vector3(0, 8.0, 0); g.userData.dist = 44; g.userData.rotY = 0.4; g.userData.elev = 0.3;
    return g;
  },
  "soporte-celular"() {
    const g = new THREE.Group(), mat = printMaterial({ color: ORANGE });
    // perfil lateral (X = largo, Y = alto) extruido a lo ancho (Z): base, tope frontal y respaldo inclinado
    const p = new THREE.Shape();
    p.moveTo(0, 0); p.lineTo(12.4, 0); p.lineTo(12.4, 2.5); p.lineTo(11.0, 2.5); p.lineTo(11.0, 1.4); p.lineTo(8.6, 1.4);
    p.lineTo(2.6, 12.4); p.lineTo(0.9, 12.4); p.lineTo(0, 0); p.closePath();
    const body = mesh(extrude(p, 8.2, 0.14), mat); body.position.set(-6.2, 0, 0); g.add(body);
    g.userData.rotY = 0.62; g.userData.elev = 0.26;
    return g;
  },
  "portalapices-hexagonal"() {
    const g = new THREE.Group(), mat = printMaterial({ color: WHITE, roughness: 0.55 });
    const R = 3.9, gap = 0.04, step = R * Math.sqrt(3) + gap;
    const cells = [ { x: 0, z: 0, h: 11.5 }, { x: step, z: 0, h: 8.6 }, { x: step * 0.5, z: step * 0.8660254, h: 7.2 } ];
    cells.forEach((c) => {
      const s = hexShape(R, Math.PI / 6); s.holes.push(hexHole(R - 0.62, Math.PI / 6));
      const wall = mesh(new THREE.ExtrudeGeometry(s, { depth: c.h, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2 }), mat); upright(wall.geometry, 0.9); wall.position.set(c.x, 0, c.z); g.add(wall);
      const floor = mesh(new THREE.ExtrudeGeometry(hexShape(R, Math.PI / 6), { depth: 0.9, bevelEnabled: false }), mat); upright(floor.geometry, 0); floor.position.set(c.x, 0, c.z); g.add(floor);
    });
    g.userData.target = new THREE.Vector3(0, 5.2, 0); g.userData.dist = 46; g.userData.rotY = -0.35; g.userData.elev = 0.42;
    return g;
  },
  "posavasos-hexagonales"() {
    const g = new THREE.Group(), mat = printMaterial({ color: WHITE, roughness: 0.5, layer: 0.12 });
    const R = 5.4, T = 0.75;
    const coaster = (y, rot) => {
      const grp = new THREE.Group();
      const baseS = hexShape(R, rot);
      const base = mesh(new THREE.ExtrudeGeometry(baseS, { depth: T, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.12, bevelSegments: 2 }), mat); upright(base.geometry, 0); grp.add(base);
      const ring = hexShape(R - 0.25, rot); ring.holes.push(hexHole(R - 0.85, rot));
      const rim = mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.22, bevelEnabled: false }), mat); upright(rim.geometry, T); grp.add(rim);
      // panal: pequeños hexágonos en relieve
      const cell = 0.78; const r2 = cell / 1.1547;
      for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
        const x = (q + r / 2) * cell * 1.0 * 1.0, z = r * cell * 0.8660254;
        if (Math.hypot(x, z) > R - 1.7) continue;
        const h = mesh(new THREE.ExtrudeGeometry(hexShape(r2 * 0.86, rot + Math.PI / 6), { depth: 0.17, bevelEnabled: false }), mat); upright(h.geometry, T); h.position.set(x, 0, z); grp.add(h);
      }
      grp.position.y = y; return grp;
    };
    [0, 1, 2, 3].forEach((i) => { const c = coaster(i * (T + 0.02), i * 0.13); c.children.forEach((m) => { m.castShadow = true; m.receiveShadow = true; }); if (i < 3) c.children.slice(2).forEach((m) => (m.visible = false)); g.add(c); });
    // un posavasos suelto al frente para mostrar el relieve
    const lone = coaster(0, 0.35); lone.position.set(7.6, 0, 6.8); lone.scale.setScalar(1); g.add(lone);
    g.position.set(-3.3, 0, -2.6);
    g.userData.target = new THREE.Vector3(1.6, 1.6, 1.0); g.userData.dist = 44; g.userData.rotY = -0.4; g.userData.elev = 0.62;
    return g;
  },
};

// ---------------------------------------------------------------- escena de estudio
async function renderPiece(name) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(SIZE * SS, SIZE * SS, false);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.75;
  // fondo degradado de estudio
  const gc = document.createElement("canvas"); gc.width = 4; gc.height = 512; const gx = gc.getContext("2d"); const gr = gx.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, "#f1f2f4"); gr.addColorStop(1, "#d6d8dd"); gx.fillStyle = gr; gx.fillRect(0, 0, 4, 512);
  const bg = new THREE.CanvasTexture(gc); bg.colorSpace = THREE.SRGBColorSpace; scene.background = bg;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.ShadowMaterial({ opacity: 0.28 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const key = new THREE.DirectionalLight(0xfff2e6, 2.6); key.position.set(-20, 38, 22); key.castShadow = true; key.shadow.mapSize.set(4096, 4096); key.shadow.radius = 5; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.04;
  Object.assign(key.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 }); scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7); fill.position.set(26, 14, 18); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(4, 18, -30); scene.add(rim);
  const obj = PIECES[name](); scene.add(obj);
  // sombra de contacto suave
  const cc = document.createElement("canvas"); cc.width = cc.height = 256; const cx = cc.getContext("2d"); const rg = cx.createRadialGradient(128, 128, 10, 128, 128, 128); rg.addColorStop(0, "rgba(0,0,0,0.38)"); rg.addColorStop(1, "rgba(0,0,0,0)"); cx.fillStyle = rg; cx.fillRect(0, 0, 256, 256);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cc), transparent: true, depthWrite: false })); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02;
  const box = new THREE.Box3().setFromObject(obj); const sz = box.getSize(new THREE.Vector3()); blob.scale.set(Math.max(sz.x, sz.z) * 1.5, Math.max(sz.x, sz.z) * 1.5, 1); blob.position.x = (box.min.x + box.max.x) / 2; blob.position.z = (box.min.z + box.max.z) / 2; scene.add(blob);
  const u = obj.userData; const cam = new THREE.PerspectiveCamera(26, 1, 1, 400);
  const fbox = new THREE.Box3().setFromObject(obj); const sphere = fbox.getBoundingSphere(new THREE.Sphere());
  const ty = sphere.center.clone(); ty.y -= sphere.radius * 0.04;
  const d = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * 0.97;
  cam.position.set(ty.x + Math.sin(u.rotY) * d * Math.cos(u.elev), ty.y + Math.sin(u.elev) * d, ty.z + Math.cos(u.rotY) * d * Math.cos(u.elev)); cam.lookAt(ty);
  renderer.render(scene, cam);
  const out = document.getElementById("out"); const octx = out.getContext("2d"); octx.imageSmoothingQuality = "high"; octx.drawImage(renderer.domElement, 0, 0, SIZE, SIZE);
  const data = out.toDataURL("image/jpeg", 0.92).split(",")[1];
  renderer.dispose();
  return data;
}
window.renderPiece = renderPiece; window.PIECE_NAMES = Object.keys(PIECES); window.READY = true;
</script></body></html>`;

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message.slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text().slice(0, 300)); });
await page.route("http://render.local/**", async (route) => {
  const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
  if (pathname === "/index.html") return route.fulfill({ status: 200, contentType: "text/html", body: PAGE });
  if (pathname.startsWith("/three/")) {
    const file = path.join(THREE_DIR, pathname.slice(7));
    if (!file.startsWith(THREE_DIR) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(file) });
  }
  return route.fulfill({ status: 404, body: "" });
});
await page.goto("http://render.local/index.html");
await page.waitForFunction(() => window.READY === true, null, { timeout: 60_000 });
const names = await page.evaluate(() => window.PIECE_NAMES);
for (const name of names) {
  if (only && !only.includes(name)) continue;
  const data = await page.evaluate((n) => window.renderPiece(n), name);
  fs.writeFileSync(path.join(outDir, `${name}.jpg`), Buffer.from(data, "base64"));
  console.log(`${name}.jpg  ${(fs.statSync(path.join(outDir, `${name}.jpg`)).size / 1024).toFixed(0)} KB`);
}
await browser.close();
