/**
 * Postproducción cinematográfica de una demostración YA GRABADA (fotogramas de record-*.mjs), sin dependencias nuevas:
 * compone en un <canvas> de Edge los fotogramas reales con un guion de cámara (zoom/desplazamiento suaves), disolvencias
 * (desenfoque) que reemplazan las pantallas de carga, destacados naranjas y rótulos de capítulo, y lo graba con MediaRecorder (MP4 H.264).
 *
 *   node scripts/demo/cinematic.mjs <carpeta-fotogramas> <guion.json> <carpeta-salida> [nombre]
 *
 * Genera <nombre>.mp4 y <nombre>-poster.jpg. NO modifica la interfaz grabada: solo recorta (zoom), mezcla y superpone.
 * No abre la app, no usa credenciales y no toca la cuenta de demostración: trabaja solo sobre los fotogramas existentes.
 * Es reproducible: mismo material + mismo guion = mismo video (salvo la compresión del codificador).
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [framesDir, directorFile, outDir, name = "cinematic"] = process.argv.slice(2);
if (!framesDir || !directorFile || !outDir) {
  console.error("Uso: node scripts/demo/cinematic.mjs <carpeta-fotogramas> <guion.json> <carpeta-salida> [nombre]");
  process.exit(1);
}
const director = JSON.parse(fs.readFileSync(directorFile, "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(framesDir, "manifest.json"), "utf8"));
const { width: W, height: H } = manifest.viewport;
const t0 = manifest.frames[0].t;
// Tramos recortados por el grabador (esperas de carga o del modelo): se quitan sus fotogramas y se cierra el hueco, así que los
// tiempos del guion son los del material YA recortado (los mismos que ve `encode-video.mjs`).
const cuts = manifest.cuts ?? [];
const inCut = (t) => cuts.some(([from, to]) => t >= from && t <= to);
const removedBefore = (t) => cuts.reduce((sum, [from, to]) => sum + (t > to ? to - from : t > from ? t - from : 0), 0);
const timeline = manifest.frames.filter((f) => !inCut(f.t)).map((f) => ({ t: f.t - t0 - removedBefore(f.t), file: f.file }));
const END = timeline[timeline.length - 1].t - (director.trimEnd ?? 0);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: W, height: H } });
const page = await context.newPage();
await page.route("http://frames.local/**", async (route) => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === "/index.html") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><canvas id=c></canvas>" });
  await route.fulfill({ status: 200, contentType: "image/jpeg", body: fs.readFileSync(path.join(framesDir, pathname.slice(1))) });
});
await page.goto("http://frames.local/index.html");

async function render(mimeType, bitsPerSecond) {
  return page.evaluate(
    async ({ timeline, director, END, W, H, mimeType, bitsPerSecond }) => {
      const FPS = 30;
      const canvas = document.getElementById("c");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // ---------------------------------------------------------------- utilidades
      const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
      const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
      const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
      const idxAt = (t) => {
        let lo = 0, hi = timeline.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (timeline[mid].t <= t) lo = mid; else hi = mid - 1; }
        return lo;
      };

      // ---------------------------------------------------------------- línea de tiempo: tramos normales y disolvencias
      const segs = [];
      let cur = 0, acc = 0;
      for (const d of director.dissolves ?? []) {
        segs.push({ type: "n", s: cur, e: d.from, o: acc, len: d.from - cur });
        acc += d.from - cur;
        segs.push({ type: "d", a: d.from, b: d.to, dur: d.dur, push: d.push ?? 0, o: acc, len: d.dur });
        acc += d.dur;
        cur = d.to;
      }
      // `endHold`: segundos extra con el último fotograma congelado (la cámara y los destacados siguen animándose).
      const hold = director.endHold ?? 0;
      segs.push({ type: "n", s: cur, e: END, o: acc, len: END - cur + hold });
      const total = acc + (END - cur) + hold;
      const speed = director.speed ?? 1;
      const duration = total / speed;
      const segAt = (u) => { for (let i = segs.length - 1; i >= 0; i--) if (u >= segs[i].o) return segs[i]; return segs[0]; };

      // ---------------------------------------------------------------- cámara
      const cams = director.camera;
      const cam = (st) => {
        if (st <= cams[0][0]) return { x: cams[0][1], y: cams[0][2], z: cams[0][3] };
        for (let i = 0; i < cams.length - 1; i++) {
          const [ta, xa, ya, za] = cams[i], [tb, xb, yb, zb] = cams[i + 1];
          if (st <= tb) { const k = smoother((st - ta) / (tb - ta)); return { x: xa + (xb - xa) * k, y: ya + (yb - ya) * k, z: za + (zb - za) * k }; }
        }
        const l = cams[cams.length - 1];
        return { x: l[1], y: l[2], z: l[3] };
      };
      const view = (c, extra = 1) => {
        const z = c.z * extra, w = W / z, h = H / z;
        const sx = clamp(c.x - w / 2, 0, W - w), sy = clamp(c.y - h / 2, 0, H - h);
        return { z, w, h, sx, sy };
      };

      // ---------------------------------------------------------------- fotogramas (carga bajo demanda, sin acumular memoria)
      const cache = new Map();
      const keep = new Set([0]);
      for (const d of director.dissolves ?? []) { keep.add(idxAt(d.from)); keep.add(idxAt(d.to)); }
      const load = (i) => {
        if (!cache.has(i)) cache.set(i, fetch(`http://frames.local/${timeline[i].file}`).then((r) => r.blob()).then((b) => createImageBitmap(b)));
        return cache.get(i);
      };
      const housekeeping = (idx) => {
        for (let k = idx; k < Math.min(idx + 40, timeline.length); k++) load(k);
        for (const [i, p] of cache) if (i < idx - 2 && !keep.has(i)) { p.then((b) => b.close()); cache.delete(i); }
      };

      // ---------------------------------------------------------------- dibujo
      function drawFrame(bitmap, v) { ctx.drawImage(bitmap, v.sx, v.sy, v.w, v.h, 0, 0, W, H); }
      const toOut = (r, v) => [(r[0] - v.sx) * v.z, (r[1] - v.sy) * v.z, r[2] * v.z, r[3] * v.z];
      function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

      function drawHighlights(st, v, now) {
        for (const h of director.highlights ?? []) {
          const a = Math.min(smooth((st - h.from) / 0.4), 1 - smooth((st - (h.to - 0.4)) / 0.4));
          if (a <= 0.01) continue;
          const [x, y, w, hh] = toOut(h.rect, v);
          const pad = 8 * v.z, r = 14 * v.z;
          // atenúa el resto para dirigir la mirada (la interfaz sigue siendo legible)
          ctx.save();
          ctx.fillStyle = `rgba(0,0,0,${0.28 * a})`;
          ctx.beginPath();
          ctx.rect(0, 0, W, H);
          ctx.roundRect(x - pad, y - pad, w + pad * 2, hh + pad * 2, r);
          ctx.fill("evenodd");
          // anillo naranja con un pulso muy suave
          const pulse = 0.85 + 0.15 * Math.sin(now * 3.2);
          ctx.shadowColor = `rgba(255,120,10,${0.75 * a})`;
          ctx.shadowBlur = 26 * pulse;
          ctx.strokeStyle = `rgba(255,128,20,${0.95 * a})`;
          ctx.lineWidth = 3;
          roundRect(x - pad, y - pad, w + pad * 2, hh + pad * 2, r);
          ctx.stroke();
          ctx.restore();
        }
      }

      function drawChapter(st) {
        for (const c of director.chapters ?? []) {
          const a = Math.min(smooth((st - c.from) / 0.4), 1 - smooth((st - (c.to - 0.4)) / 0.4));
          if (a <= 0.01) continue;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.font = "600 18px 'Segoe UI', system-ui, sans-serif";
          const tw = ctx.measureText(c.text).width;
          const w = tw + 58, h = 38, x = (W - w) / 2, y = H - 52 + (1 - a) * 10;
          ctx.fillStyle = "rgba(10,10,13,0.82)";
          ctx.strokeStyle = "rgba(255,140,40,0.5)";
          ctx.lineWidth = 1.2;
          roundRect(x, y, w, h, 19);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#ff780a";
          ctx.shadowColor = "rgba(255,120,10,0.9)";
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(x + 21, y + h / 2, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#fafafa";
          ctx.textBaseline = "middle";
          ctx.fillText(c.text, x + 36, y + h / 2 + 1);
          ctx.restore();
        }
      }

      function drawVignette(z) {
        const strength = 0.14 + 0.28 * clamp((z - 1) / 0.3, 0, 1);
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.0);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${strength})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      async function drawAt(u, now) {
        const seg = segAt(u);
        let st, c;
        if (seg.type === "n") {
          st = seg.s + (u - seg.o);
          const i = idxAt(st);
          housekeeping(i);
          c = cam(st);
          const v = view(c);
          drawFrame(await load(i), v);
          finish(st, v, now);
        } else {
          const p = clamp((u - seg.o) / seg.dur, 0, 1);
          const k = smooth(p);
          st = seg.a + (seg.b - seg.a) * k;
          c = cam(st);
          const va = view(c, 1 + seg.push * k);
          const vb = view(c, 1 + seg.push * (1 - k));
          const A = await load(idxAt(seg.a)), B = await load(idxAt(seg.b));
          // Transición "desenfoque": A se desenfoca y se mezcla con B, que se enfoca. Con el desenfoque máximo el texto de las
          // dos pantallas no se superpone legible (una disolvencia plana deja letras dobles).
          const blur = (director.blurPx ?? 12) * Math.sin(Math.PI * p);
          ctx.filter = `blur(${blur.toFixed(2)}px)`;
          drawFrame(A, va);
          ctx.globalAlpha = k;
          drawFrame(B, vb);
          ctx.globalAlpha = 1;
          ctx.filter = "none";
          ctx.fillStyle = `rgba(6,6,8,${(0.22 * Math.sin(Math.PI * p)).toFixed(3)})`;
          ctx.fillRect(0, 0, W, H);
          finish(st, va, now);
        }
        // `fadeDark`: cuando el último y el primer cuadro son pantallas distintas, el bucle pasa por un fundido breve a oscuro
        // (en lugar de mezclar dos interfaces superpuestas).
        const fd = director.fadeDark ?? 0;
        if (fd > 0) {
          const a = Math.max(smooth((u - (total - fd)) / fd), 1 - smooth(u / fd));
          if (a > 0.003) {
            ctx.fillStyle = `rgba(8,8,10,${a.toFixed(3)})`;
            ctx.fillRect(0, 0, W, H);
          }
        }
        // cierre en bucle: los últimos instantes se mezclan con el primer fotograma (misma cámara que al inicio)
        const lf = director.loopFade ?? 0;
        if (lf > 0 && u > total - lf) {
          const q = smooth((u - (total - lf)) / lf);
          const v0 = view(cam(0));
          ctx.globalAlpha = q;
          drawFrame(await load(0), v0);
          ctx.globalAlpha = 1;
        }
      }
      function finish(st, v, now) {
        drawVignette(v.z);
        drawHighlights(st, v, now);
        drawChapter(st);
      }

      // ---------------------------------------------------------------- póster
      await Promise.all([load(0), ...[...keep].map(load)]);
      const posterSt = director.posterAt ?? 1;
      await drawAt(posterSt, posterSt);
      const poster = canvas.toDataURL("image/jpeg", 0.88).split(",")[1];
      cache.clear();
      housekeeping(0);
      await drawAt(0, 0);

      // ---------------------------------------------------------------- grabación en tiempo real
      const stream = canvas.captureStream(FPS);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitsPerSecond });
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start(500);
      const start = performance.now();
      await new Promise((resolve) => {
        const tick = async () => {
          const vt = (performance.now() - start) / 1000;
          if (vt >= duration) return resolve();
          await drawAt(Math.min(vt * speed, total - 0.001), vt);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await drawAt(total - 0.001, duration);
      await new Promise((r) => setTimeout(r, 250));
      recorder.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
      const video = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.readAsDataURL(blob);
      });
      return { video, poster, duration };
    },
    { timeline, director, END, W, H, mimeType, bitsPerSecond },
  );
}

try {
  const result = await render("video/mp4;codecs=avc1.42E01E", director.bitrate ?? 1_500_000);
  const mp4 = path.join(outDir, `${name}.mp4`);
  fs.writeFileSync(mp4, Buffer.from(result.video, "base64"));
  fs.writeFileSync(path.join(outDir, `${name}-poster.jpg`), Buffer.from(result.poster, "base64"));
  console.log(`${name}.mp4: ${(fs.statSync(mp4).size / 1024 / 1024).toFixed(2)} MB · ${result.duration.toFixed(1)} s`);
  console.log(`${name}-poster.jpg: ${(fs.statSync(path.join(outDir, `${name}-poster.jpg`)).size / 1024).toFixed(0)} KB`);
} finally {
  await browser.close();
}
