import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

/**
 * Búsqueda ampliada (español ↔ inglés), nivel 1 determinista. Estas pruebas NO tocan la red: verifican el motor de
 * variantes y el léxico. Que las variantes encuentren modelos reales se comprueba aparte con
 * `node scripts/verify-model-search.mjs --multilingual`.
 */
const root = process.cwd();

function createLoader() {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    });
    const mod = { exports: {} };
    cache.set(filename, mod);
    const localRequire = (request) => {
      if (request.startsWith("@/")) return load(path.join(root, "src", `${request.slice(2)}.ts`));
      if (request.startsWith(".")) return load(path.resolve(path.dirname(filename), `${request}.ts`));
      throw new Error(`Unexpected dependency: ${request}`);
    };
    new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
    return mod.exports;
  }
  return (relative) => load(path.join(root, relative));
}

const load = createLoader();
const variants = load("src/lib/model-search/query-variants.ts");
const lexicon = load("src/lib/model-search/lexicon.ts");
const { expandQuery, titleMatchesQuery, stripAccents, MAX_QUERY_VARIANTS } = variants;

// ---------- Español → inglés (los ejemplos del producto) ----------

test("soporte de notebook → laptop stand / laptop holder (el significado, no 'notebook support')", () => {
  assert.deepEqual(expandQuery("Soporte de notebook"), ["laptop stand", "laptop holder"]);
  assert.deepEqual(expandQuery("soporte notebook"), ["laptop stand", "laptop holder"]);
  assert.ok(!expandQuery("soporte notebook").some((variant) => /support/.test(variant)));
});

test("soporte para celular → phone stand / phone holder", () => {
  assert.deepEqual(expandQuery("Soporte para celular"), ["phone stand", "phone holder"]);
  assert.deepEqual(expandQuery("soporte celular"), ["phone stand", "phone holder"]);
});

test("dragón articulado → articulated dragon (el adjetivo pasa delante)", () => {
  assert.deepEqual(expandQuery("Dragón articulado"), ["articulated dragon"]);
  assert.deepEqual(expandQuery("dragon articulado"), ["articulated dragon"], "sin tilde da lo mismo");
});

test("maceta colgante → hanging planter", () => {
  assert.equal(expandQuery("Maceta colgante")[0], "hanging planter");
});

test("la traducción del objeto principal depende del complemento: pared → mount, no stand", () => {
  assert.equal(expandQuery("soporte de pared")[0], "wall mount");
  assert.equal(expandQuery("soporte para auriculares")[0], "headphone stand");
  assert.equal(expandQuery("soporte de bobina")[0], "spool holder");
  assert.equal(expandQuery("caja para celular")[0], "phone case");
});

// ---------- Inglés → español ----------

test("desk organizer → organizador de escritorio", () => {
  assert.deepEqual(expandQuery("Desk organizer"), ["organizador de escritorio"]);
});

test("laptop stand / phone holder / articulated dragon al español", () => {
  assert.deepEqual(expandQuery("laptop stand"), ["soporte para notebook", "soporte para laptop"]);
  assert.equal(expandQuery("phone holder")[0], "soporte para celular");
  assert.deepEqual(expandQuery("articulated dragon"), ["dragón articulado"]);
  assert.equal(expandQuery("wall mount")[0], "soporte de pared");
});

// ---------- Sinónimos, regionalismos, plurales y concordancia ----------

test("regionalismos de notebook y celular se reconocen como el mismo objeto", () => {
  for (const laptop of ["notebook", "laptop", "computadora portátil", "ordenador portátil", "compu portátil"]) {
    assert.equal(expandQuery(`soporte para ${laptop}`)[0], "laptop stand", laptop);
  }
  for (const phone of ["celular", "teléfono", "móvil", "smartphone", "teléfono celular"]) {
    assert.equal(expandQuery(`soporte para ${phone}`)[0], "phone stand", phone);
  }
  assert.equal(expandQuery("cellphone stand")[0], "soporte para celular");
  assert.equal(expandQuery("audífonos soporte")[0], "headphone stand", "el objeto genérico siempre es el principal");
  assert.deepEqual(expandQuery("caja funda"), [], "dos genéricos juntos no se interpretan");
  assert.equal(expandQuery("soporte para audífonos")[0], "headphone stand");
  assert.equal(expandQuery("soporte para parlante")[0], "speaker stand");
});

test("plurales y femeninos se conservan en la variante", () => {
  assert.deepEqual(expandQuery("dragones articulados"), ["articulated dragons"]);
  assert.deepEqual(expandQuery("soportes para celulares").slice(0, 1), ["phone stands"]);
  assert.equal(expandQuery("foldable laptop stands")[0], "soportes plegables para notebook");
  assert.equal(expandQuery("mini organizer")[0], "mini organizador");
});

test("el adjetivo español concuerda en género al generar (y los de tamaño van primero en inglés)", () => {
  assert.equal(expandQuery("foldable laptop stand")[0], "soporte plegable para notebook");
  assert.equal(expandQuery("custom keychain")[0], "llavero personalizado");
  assert.equal(expandQuery("hanging planter")[0], "maceta colgante");
  assert.equal(expandQuery("maceta colgante grande")[0], "large hanging planter");
  assert.equal(expandQuery("soporte para notebook plegable")[0], "foldable laptop stand", "adjetivo tras el complemento");
});

// ---------- Términos técnicos de impresión 3D ----------

test("términos técnicos: repuestos, calibración, bobinas y nombres propios intactos", () => {
  assert.deepEqual(expandQuery("repuesto para ender 3"), ["ender 3 replacement part", "ender 3 spare part"]);
  assert.equal(expandQuery("torre de temperatura")[0], "temperature tower");
  assert.equal(expandQuery("cubo de calibración")[0], "calibration cube");
  assert.equal(expandQuery("soporte para ps5")[0], "ps5 stand");
  assert.equal(expandQuery("soporte para ender 3 pro")[0], "ender 3 pro stand");
  assert.equal(expandQuery("caja de herramientas")[0], "toolbox");
  assert.equal(expandQuery("organizador de cables")[0], "cable organizer");
  assert.equal(expandQuery("lámpara de escritorio")[0], "desk lamp");
});

test("expresiones fijas se traducen completas en ambos sentidos", () => {
  assert.equal(expandQuery("posavasos")[0], "coaster");
  assert.equal(expandQuery("coaster")[0], "posavasos");
  assert.equal(expandQuery("pencil holder")[0], "portalápices");
  assert.equal(expandQuery("cama caliente")[0], "heated bed");
});

// ---------- Consultas que no se traducen ----------

test("sin traducción segura: desconocidas, ambiguas, genéricas, nombres propios y estructuras raras", () => {
  const untouched = [
    "xyz abc", // desconocida
    "soporte técnico", // palabra desconocida en este contexto
    "soporte", // objeto genérico solo: demasiado ambiguo ("support" no es "soporte")
    "stand",
    "caja",
    "case",
    "benchy", // nombre propio
    "dragon ball goku", // franquicia: no se vuelve "bola de dragón"
    "ender 3",
    "robot", // ya es igual en ambos idiomas
    "mini robot",
    "soporte con ruedas", // "con" cambia el sentido
    "soporte para notebook y tablet",
    "soporte para control de ps5", // dos complementos encadenados
    "soporte para portátil", // 'portátil' es adjetivo salvo que sea 'computadora/ordenador portátil'
    "",
    "   ",
  ];
  for (const query of untouched) assert.deepEqual(expandQuery(query), [], `"${query}" no debe generar variantes`);
});

test("palabras que coinciden en ambos idiomas no generan una variante igual a la original", () => {
  assert.deepEqual(expandQuery("tablet"), []);
  assert.deepEqual(expandQuery("organizador"), ["organizer", "organiser"]);
  for (const query of ["robot", "tablet", "modular vertical"]) {
    const original = stripAccents(query.toLowerCase());
    for (const variant of expandQuery(query)) assert.notEqual(stripAccents(variant.toLowerCase()), original);
  }
});

// ---------- Límites, duplicados y abuso ----------

test("las variantes no se repiten ni repiten la consulta original (sin importar tildes ni mayúsculas)", () => {
  for (const query of ["soporte de notebook", "Soporte Para Celular", "Desk Organizer", "maceta colgante", "dragon articulado"]) {
    const result = expandQuery(query);
    const keys = result.map((variant) => stripAccents(variant.toLowerCase()));
    assert.equal(new Set(keys).size, keys.length, query);
    assert.ok(!keys.includes(stripAccents(query.toLowerCase())), query);
  }
});

test("el máximo de variantes se respeta y nunca supera el tope global", () => {
  assert.equal(MAX_QUERY_VARIANTS, 2);
  assert.equal(expandQuery("soporte de notebook", 1).length, 1);
  assert.deepEqual(expandQuery("soporte de notebook", 0), []);
  assert.equal(expandQuery("soporte de notebook", 50).length, MAX_QUERY_VARIANTS);
  assert.deepEqual(expandQuery("soporte de notebook", -3), []);
});

test("consultas abusivas: demasiado largas, símbolos, control, emoji y mezclas no rompen ni generan basura", () => {
  const abusive = [
    "soporte ".repeat(40),
    "a ".repeat(60),
    "x".repeat(5000),
    "soporte para ' OR 1=1 --",
    "soporte para <script>alert(1)</script>",
    "soporte\u0000para\u0007celular",
    "🐉 dragón articulado 🐉",
    "soporte\n\npara\tcelular",
    "ＳＯＰＯＲＴＥ ｎｏｔｅｂｏｏｋ",
    "‮elurelec arap etropos",
  ];
  for (const query of abusive) {
    const result = expandQuery(query);
    assert.ok(Array.isArray(result) && result.length <= MAX_QUERY_VARIANTS, query.slice(0, 30));
    for (const variant of result) {
      assert.equal(typeof variant, "string");
      assert.ok(variant.length > 0 && variant.length <= 100, "las variantes quedan acotadas");
      assert.doesNotMatch(variant, /[<>'"\u0000-\u001f]/);
    }
  }
  assert.deepEqual(expandQuery("soporte ".repeat(40)), [], "más de 8 palabras: frase libre, no se interpreta");
  assert.deepEqual(expandQuery("🐉 dragón articulado 🐉"), ["articulated dragon"], "los símbolos se ignoran, no rompen");
});

test("estabilidad: la misma consulta siempre da las mismas variantes (las páginas siguientes la recalculan)", () => {
  for (const query of ["soporte notebook", "laptop stand", "xyz", "dragón articulado"]) {
    assert.deepEqual(expandQuery(query), expandQuery(query));
  }
});

test("fuzz: ninguna combinación de palabras del léxico lanza ni devuelve variantes inválidas", () => {
  const words = lexicon.LEXICON.flatMap((entry) => [...entry.es, ...entry.en]);
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let index = 0; index < 600; index += 1) {
    const size = 1 + Math.floor(next() * 4);
    const query = Array.from({ length: size }, () => words[Math.floor(next() * words.length)]).join(" ");
    const result = expandQuery(query);
    assert.ok(result.length <= MAX_QUERY_VARIANTS, query);
    assert.equal(new Set(result).size, result.length, query);
    for (const variant of result) assert.ok(variant.trim() === variant && !variant.includes("  "), query);
  }
});

// ---------- Integridad del léxico ----------

test("léxico: ids únicos, formas no vacías y ninguna forma pertenece a dos conceptos del mismo idioma", () => {
  const ids = new Set();
  const forms = { es: new Map(), en: new Map() };
  for (const entry of lexicon.LEXICON) {
    assert.ok(!ids.has(entry.id), `id repetido: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.es.length > 0 && entry.en.length > 0, `${entry.id}: faltan formas`);
    for (const lang of ["es", "en"]) {
      for (const form of entry[lang]) {
        assert.equal(form, form.trim(), `${entry.id}: forma con espacios`);
        const key = stripAccents(form.toLowerCase());
        assert.ok(!forms[lang].has(key) || forms[lang].get(key) === entry.id, `"${key}" (${lang}) está en ${forms[lang].get(key)} y en ${entry.id}`);
        forms[lang].set(key, entry.id);
      }
    }
  }
  // Los conceptos referenciados en `withHead` existen.
  for (const entry of lexicon.LEXICON) for (const head of Object.keys(entry.withHead ?? {})) assert.ok(ids.has(head), `${entry.id}.withHead → ${head}`);
  // Las expresiones fijas no pisan el léxico: se evalúan primero y deben ser inequívocas.
  for (const phrase of lexicon.PHRASES) assert.ok(phrase.es.length > 0 && phrase.en.length > 0);
  // Ningún nombre propio protegido es además una palabra del léxico (nunca se traduciría).
  for (const word of lexicon.PROTECTED_WORDS) {
    assert.ok(!forms.es.has(word) && !forms.en.has(word), `"${word}" está protegida y también en el léxico`);
  }
});

test("extensible: agregar una equivalencia es solo agregar datos (el motor no tiene palabras fijas)", () => {
  const source = fs
    .readFileSync(path.join(root, "src/lib/model-search/query-variants.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const word of ["notebook", "celular", "dragon", "laptop", "soporte", "stand"]) {
    assert.doesNotMatch(source, new RegExp(`["'\`]${word}`, "i"), `query-variants.ts no debe codificar "${word}"`);
  }
});

// ---------- Orden de resultados de una variante ----------

test("titleMatchesQuery: coincide por palabra significativa (singular/plural indistinto) y nunca descarta por sí solo", () => {
  assert.equal(titleMatchesQuery("Foldable Laptop Stand", "laptop stand"), true);
  assert.equal(titleMatchesQuery("Notebook Stands pack", "laptop stand"), true);
  assert.equal(titleMatchesQuery("Headphones holder", "headphone stand"), true);
  assert.equal(titleMatchesQuery("Beach umbrella", "laptop stand"), false);
  assert.equal(titleMatchesQuery("Cualquier cosa", "de la"), true, "una consulta sin palabras significativas no demota nada");
});
