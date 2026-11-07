// Sprint 4.1 — UX-01: los modales deben medir el viewport, no la página.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readRepoFile as read } from "./helpers/load-ts.mjs";

const css = read("src/app/globals.css");

test("la entrada de página no deja un transform persistente en <main> (rompe position: fixed de los modales)", () => {
  const pageIn = css.match(/@keyframes stampa-page-in\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(pageIn, "existe la animación de entrada de página");
  assert.ok(!/transform/.test(pageIn), "stampa-page-in solo anima opacidad");
  const rule = css.match(/\.animate-page-in\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(!/forwards|both/.test(rule), "animate-page-in no retiene su último fotograma");
  const slide = css.match(/\.animate-slide-up\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(!/forwards|both/.test(slide), "animate-slide-up no retiene su último fotograma");
  for (const keyframes of css.matchAll(/@keyframes stampa-[\w-]+\s*\{[\s\S]*?\n\}/g)) {
    assert.ok(!/transform:\s*translate\w*\(0(px)?(,\s*0(px)?)?\)/.test(keyframes[0]), "ningún estado final deja translate(0): usar `transform: none`");
  }
});

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

test("todo overlay `fixed inset-0` de la app (fuera del layout global y de landings) se monta en un portal", () => {
  const exempt = [
    path.join("src", "components", "ui", "app-feedback.tsx"), // vive en el layout raíz, fuera de <main>
    path.join("src", "components", "barcode", "BarcodeScannerProvider.tsx"),
  ];
  const offenders = walk(path.join(process.cwd(), "src"))
    .map((file) => path.relative(process.cwd(), file))
    .filter((file) => !file.includes("landing") && !exempt.includes(file))
    .filter((file) => /fixed inset-0/.test(fs.readFileSync(file, "utf8")))
    .filter((file) => !/createPortal|ModalPortal/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders, [], `overlays sin portal: ${offenders.join(", ")}`);
});

test("ModalPortal monta en document.body", () => {
  const source = read("src/components/ui/modal-portal.tsx");
  assert.match(source, /createPortal\(children, document\.body\)/);
});
