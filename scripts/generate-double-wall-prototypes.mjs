// Genera los dos prototipos STL del experimento V4 (pantalla de doble pared) y su informe medido.
//
//   node scripts/generate-double-wall-prototypes.mjs [carpeta_salida]
//
// Salida (por defecto tests/fixtures/maker-double-wall/):
//   double-wall-vase-test.stl           prototipo A: sección en C con abertura posterior (modo jarrón / spiral vase)
//   double-wall-conventional-test.stl   prototipo B: dos anillos cerrados unidos por nervios (impresión convencional)
//   double-wall-report.json             medidas verificadas sobre las mallas (no son resultados de laminado)
//
// Usa el mismo motor y la misma exportación STL que Lámparas (`buildSTLBlob`). Es determinista: los mismos parámetros dan los mismos bytes.
import fs from "node:fs";
import path from "node:path";
import { loadMakerModule } from "./lib/maker-engine-node.mjs";

const out = path.resolve(process.argv[2] ?? "tests/fixtures/maker-double-wall");
fs.mkdirSync(out, { recursive: true });

const dw = loadMakerModule("lib/maker/lamps/experiments/doubleWall/index.ts");
const { meshToSoup } = loadMakerModule("lib/maker/mugs/geometry/mesh.ts");
const { buildSTLBlob } = loadMakerModule("lib/maker/exporters/exportSTL.ts");

const files = { "vase-c": "double-wall-vase-test.stl", conventional: "double-wall-conventional-test.stl" };
const report = { params: dw.DEFAULT_DOUBLE_WALL, note: "Medidas sobre las mallas generadas. NO son resultados de laminado: ningún laminador se ejecutó.", prototypes: {} };
for (const strategy of Object.keys(files)) {
  const proto = dw.createDoubleWallPrototype(strategy);
  const blob = buildSTLBlob(meshToSoup(proto.build.mesh, 45));
  const bytes = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(path.join(out, files[strategy]), bytes);
  report.prototypes[strategy] = { file: files[strategy], fileBytes: bytes.length, ...proto.report };
  console.log(`${files[strategy]}: ${proto.report.triangles} triángulos, ${(bytes.length / 1e6).toFixed(2)} MB, componentes ${proto.report.components}, cerrada ${proto.report.watertight}`);
}
fs.writeFileSync(path.join(out, "double-wall-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log("informe:", path.join(out, "double-wall-report.json"));
