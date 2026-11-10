/**
 * Convierte los fotogramas de record-mi-taller.mjs en video web (MP4 H.264) y un póster, sin ffmpeg:
 * reproduce los fotogramas sobre un <canvas> en Edge y los graba con MediaRecorder.
 *
 *   node scripts/demo/encode-video.mjs <carpeta-fotogramas> <carpeta-salida> [nombre=mi-taller] [--speed=1.3] [--trim-end=0.6]
 *
 * --speed      acelera el recorrido (1.3 = 30 % más rápido) para acortar las esperas.
 * --trim-end   segundos que se recortan del final (evita una carga a medias en el cuadro final).
 * Genera: <nombre>.mp4 (H.264, duración y búsqueda correctas) y <nombre>-poster.jpg  (--webm agrega un WebM, sin duración)
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const args = process.argv.slice(2);
const flag = (name, fallback) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const positional = args.filter((a) => !a.startsWith("--"));
const [framesDir, outDir, name = "mi-taller"] = positional;
if (!framesDir || !outDir) {
  console.error("Uso: node scripts/demo/encode-video.mjs <carpeta-fotogramas> <carpeta-salida> [nombre] [--speed=1.3] [--trim-end=0.6]");
  process.exit(1);
}
const SPEED = flag("speed", 1.3);
const TRIM_END = flag("trim-end", 0.6);
const FPS = 30;

const manifest = JSON.parse(fs.readFileSync(path.join(framesDir, "manifest.json"), "utf8"));
const { width, height } = manifest.viewport;
const t0 = manifest.frames[0].t;
const lastT = manifest.frames[manifest.frames.length - 1].t - TRIM_END;
// Tramos recortados por el grabador (esperas de carga): se quitan sus fotogramas y se cierra el hueco.
const cuts = manifest.cuts ?? [];
const inCut = (t) => cuts.some(([from, to]) => t >= from && t <= to);
const removedBefore = (t) => cuts.reduce((sum, [from, to]) => sum + (t > to ? to - from : t > from ? t - from : 0), 0);
// Línea de tiempo virtual (segundos de video) → fotograma.
const timeline = manifest.frames.filter((f) => f.t <= lastT && !inCut(f.t)).map((f) => ({ at: (f.t - t0 - removedBefore(f.t)) / SPEED, file: f.file }));
const duration = timeline[timeline.length - 1].at + 0.8;
fs.mkdirSync(outDir, { recursive: true });
console.log(`Fotogramas: ${timeline.length} · duración del video: ${duration.toFixed(1)} s (x${SPEED})`);

const browser = await chromium.launch({ channel: "msedge", headless: true });

async function encode(mimeType, bitsPerSecond, outFile) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  // Origen propio (frames.local) para que los fetch de los fotogramas sean del mismo origen que la página.
  await page.route("http://frames.local/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/index.html") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><canvas id=c></canvas>" });
    await route.fulfill({ status: 200, contentType: "image/jpeg", body: fs.readFileSync(path.join(framesDir, pathname.slice(1))) });
  });
  await page.goto("http://frames.local/index.html");
  const base64 = await page.evaluate(
    async ({ timeline, duration, width, height, FPS, mimeType, bitsPerSecond }) => {
      const canvas = document.getElementById("c");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      const bitmaps = new Map();
      const load = async (i) => {
        if (bitmaps.has(i)) return bitmaps.get(i);
        const promise = fetch(`http://frames.local/${timeline[i].file}`).then((r) => r.blob()).then((b) => createImageBitmap(b));
        bitmaps.set(i, promise);
        return promise;
      };
      // Precarga hacia adelante y libera lo ya usado: no se mantienen todos los fotogramas decodificados en memoria.
      const AHEAD = 45;
      let pointer = 0;
      await Promise.all(Array.from({ length: Math.min(AHEAD, timeline.length) }, (_, i) => load(i)));
      ctx.drawImage(await load(0), 0, 0);

      const stream = canvas.captureStream(FPS);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitsPerSecond });
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start(500);

      const start = performance.now();
      await new Promise((resolve) => {
        const tick = async () => {
          const now = (performance.now() - start) / 1000;
          while (pointer + 1 < timeline.length && timeline[pointer + 1].at <= now) {
            const old = pointer;
            pointer++;
            bitmaps.get(old)?.then((b) => b.close());
            bitmaps.delete(old);
          }
          for (let k = pointer; k < Math.min(pointer + AHEAD, timeline.length); k++) load(k);
          ctx.drawImage(await load(pointer), 0, 0);
          if (now >= duration) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      recorder.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.readAsDataURL(blob);
      });
    },
    { timeline, duration, width, height, FPS, mimeType, bitsPerSecond },
  );
  fs.writeFileSync(outFile, Buffer.from(base64, "base64"));
  await context.close();
  console.log(`  ${path.basename(outFile)}: ${(fs.statSync(outFile).size / 1024 / 1024).toFixed(2)} MB`);
}

try {
  await encode("video/mp4;codecs=avc1.42E01E", flag("mp4-bps", 1_100_000), path.join(outDir, `${name}.mp4`));
  // El WebM de MediaRecorder no trae duración (Infinity) y no permite buscar posiciones: solo se genera si se pide (--webm).
  if (args.includes("--webm")) await encode("video/webm;codecs=vp9", flag("webm-bps", 1_000_000), path.join(outDir, `${name}.webm`));
} finally {
  await browser.close();
}

// Póster: primer cuadro estable (la lista de Productos ya cargada), que también es el último del bucle.
const posterFrame = timeline.find((f) => f.at >= 0.5) ?? timeline[0];
await sharp(path.join(framesDir, posterFrame.file)).resize(width, height).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(outDir, `${name}-poster.jpg`));
console.log(`  ${name}-poster.jpg: ${(fs.statSync(path.join(outDir, `${name}-poster.jpg`)).size / 1024).toFixed(0)} KB`);
