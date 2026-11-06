// Sprint UX/UI y Mobile — shell compartido: títulos de página, «volver» en subpantallas, safe areas y menú de herramientas.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const titles = loadTs("src/components/layout/page-titles.ts");

test("títulos: exactos, por sección y versiones cortas para el header móvil", () => {
  assert.equal(titles.getPageTitle("/mi-negocio/ventas"), "Ventas");
  assert.equal(titles.getPageTitle("/mi-negocio/clientes"), "Clientes");
  assert.equal(titles.getPageTitle("/stampa-maker/lamparas"), "Lámparas");
  assert.equal(titles.getPageTitle("/stampy"), "Stampy IA");
  assert.equal(titles.getPageTitle("/configuracion"), "Configuración");
  assert.equal(titles.getPageTitle("/cursos/abc-123"), "Curso");
  assert.equal(titles.getPageTitle("/libreria-stl/grupo/modelo"), "Librería STL");
  assert.equal(titles.getPageTitle("/mi-taller/productos/"), "Productos", "barra final ignorada");
  assert.equal(titles.getPageTitle("/ruta-que-no-existe"), "");
  assert.equal(titles.getPageTitle("/calculadora"), "Calculadora de costos");
  assert.equal(titles.getPageTitle("/calculadora", { compact: true }), "Calculadora");
});

test("volver: solo en subpantallas de áreas con navegación propia, un nivel hacia arriba", () => {
  assert.equal(titles.getParentRoute("/mi-taller/productos"), "/mi-taller");
  assert.equal(titles.getParentRoute("/mi-negocio/ticket/abc"), "/mi-negocio/ticket");
  assert.equal(titles.getParentRoute("/libreria-stl/grupo/modelo"), "/libreria-stl/grupo");
  assert.equal(titles.getParentRoute("/admin/usuarios"), "/admin");
  assert.equal(titles.getParentRoute("/mi-taller"), null, "la raíz del área se alcanza con la barra inferior");
  assert.equal(titles.getParentRoute("/"), null);
  assert.equal(titles.getParentRoute("/cursos/abc"), null, "el detalle de curso trae su propio «Volver»");
  assert.equal(titles.getParentRoute("/perfil"), null);
});

test("PWA y áreas seguras: viewport-fit=cover, header e insets laterales de la barra inferior", () => {
  assert.match(read("src/app/layout.tsx"), /viewportFit:\s*"cover"/);
  assert.match(read("src/components/layout/mobile-header.tsx"), /env\(safe-area-inset-top\)/);
  assert.match(read("src/components/layout/mobile-bottom-navigation.tsx"), /env\(safe-area-inset-left\)/);
  assert.match(read("src/app/globals.css"), /--mobile-app-header-height:\s*calc\(6\.625rem \+ env\(safe-area-inset-top\)\)/);
});

test("campos táctiles: 16 px en pantallas táctiles para que iOS no haga zoom al enfocar", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?font-size:\s*16px/);
});
