import assert from "node:assert/strict";
import test from "node:test";
import { readRepoFile as read } from "./helpers/load-ts.mjs";

const V2_COMPONENTS = [
  "src/components/ui/dashboard.tsx",
  "src/components/workshop/workshop-dashboard.tsx",
  "src/components/business/business-dashboard.tsx",
  "src/components/home/home-dashboard.tsx",
  "src/components/raffles/raffles-view.tsx",
  "src/app/stampy/page.tsx",
  "src/components/calculadora/calculator-settings-modal.tsx",
];

test("contraste: los componentes V2 no usan text-gray-500 (≈3.4:1) para texto secundario", () => {
  for (const file of V2_COMPONENTS) assert.doesNotMatch(read(file), /\btext-gray-500\b/, file);
});

test("áreas táctiles: enlaces de panel y acciones de fila con alto mínimo", () => {
  assert.match(read("src/components/ui/dashboard.tsx"), /inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-1 text-xs font-semibold text-stampa-accent/);
  assert.match(read("src/components/home/home-dashboard.tsx"), /inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-xs font-semibold text-stampa-accent/);
  assert.equal((read("src/components/workshop/workshop-dashboard.tsx").match(/inline-flex min-h-9 shrink-0 items-center rounded-lg px-2/g) ?? []).length, 2);
});

test("Mi Negocio: solo se aplica la respuesta del último período pedido (Semana/Mes)", () => {
  const ui = read("src/components/business/business-dashboard.tsx");
  assert.match(ui, /const requestId = \+\+metricsRequestRef\.current/);
  assert.match(ui, /if \(requestId !== metricsRequestRef\.current\) return;/);
});

test("Inventario: el filtro 'sin stock' muestra un mensaje cuando no hay resultados", () => {
  assert.match(read("src/app/stock/page.tsx"), /No hay productos activos sin stock\./);
});

test("Stampy: el composer anula el estilo global de textarea y el scroll largo no depende de la animación", () => {
  const page = read("src/app/stampy/page.tsx");
  assert.match(page, /bg-transparent! border-transparent! shadow-none!/);
  assert.match(page, /behavior: reduceMotion \|\| far \? "auto" : "smooth"/);
  assert.doesNotMatch(page, /window\.scrollTo/);
});

test("Calculadora: el acceso a Explorar Modelos conserva su nombre accesible en mobile", () => {
  const calc = read("src/app/calculadora/page.tsx");
  assert.match(calc, /title="Explorar Modelos"/);
  assert.match(calc, /<span className="sr-only min-\[400px\]:not-sr-only">Explorar Modelos<\/span>/);
});
