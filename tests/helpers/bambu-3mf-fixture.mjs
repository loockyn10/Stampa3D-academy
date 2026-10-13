/**
 * Generador de 3MF sintéticos con la MISMA estructura que escriben Bambu Studio 02.07 y OrcaSlicer 2.4
 * (verificada contra archivos reales sin geometría; ver docs/ARCHITECTURE.md §18d):
 *   3D/3dmodel.model            objeto envoltorio -> <component p:path objectid=id-de-parte>, <build><item objectid=envoltorio>
 *   3D/Objects/object_N.model   mallas (una por objeto)
 *   Metadata/model_settings.config  <object><metadata extruder/><part id>, <plate><model_instance object_id/instance_id>
 *   Metadata/project_settings.config JSON con filament_colour
 * NO es un archivo real de un slicer: sirve para ejercitar el pipeline con geometría conocida.
 */
import { zipSync, strToU8 } from "three/examples/jsm/libs/fflate.module.js";

const CUBE_TRIANGLES = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
  [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
];

function cubeMesh(size, { paint = false } = {}) {
  const v = [[0, 0, 0], [size, 0, 0], [size, size, 0], [0, size, 0], [0, 0, size], [size, 0, size], [size, size, size], [0, size, size]];
  const vertices = v.map(([x, y, z]) => `    <vertex x="${x}" y="${y}" z="${z}"/>`).join("\n");
  const triangles = CUBE_TRIANGLES.map(
    ([a, b, c], i) => `    <triangle v1="${a}" v2="${b}" v3="${c}"${paint && i === 0 ? ' paint_color="4"' : ""}/>`,
  ).join("\n");
  return `<mesh>\n   <vertices>\n${vertices}\n   </vertices>\n   <triangles>\n${triangles}\n   </triangles>\n  </mesh>`;
}

const NS =
  'unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';

/**
 * @param {object} spec
 * @param {Array<{ id: number, name?: string, extruder?: number|null, size?: number, parts?: Array<{ partId: number, extruder?: number|null, size?: number, paint?: boolean }> }>} spec.objects
 *   (cada objeto sin `parts` = una sola parte con id 65536 + id)
 * @param {number[]} spec.buildOrder ids de objeto en el orden del <build> (puede diferir del orden de plates)
 * @param {number[][]} spec.plates ids de objeto por cama (instance_id 0)
 * @param {"bambu"|"orca"|"none"} [spec.slicer] none = 3MF estándar sin metadata de slicer
 * @param {string[]|null} [spec.filamentColours]
 * @param {boolean} [spec.omitPlates] quita <plate> del model_settings (metadata incompleta)
 * @param {boolean} [spec.omitSettings] quita model_settings.config
 */
export function buildSlicer3mf(spec) {
  const slicer = spec.slicer ?? "bambu";
  const objects = spec.objects.map((o) => ({
    ...o,
    parts: o.parts ?? [{ partId: 65536 + o.id, size: o.size ?? 10 }],
  }));
  const byId = new Map(objects.map((o) => [o.id, o]));
  const files = {};

  const meta =
    slicer === "none"
      ? '<metadata name="Application">Generic3MF</metadata>'
      : slicer === "orca"
        ? ' <metadata name="Application">BambuStudio-02.06.00.51</metadata>\n <metadata name="OrcaSlicer">2.4.2</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>'
        : ' <metadata name="Application">BambuStudio-02.07.00.55</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>';

  const resources = objects
    .map(
      (o) =>
        `  <object id="${o.id}" type="model">\n   <components>\n` +
        o.parts
          .map((p) => `    <component p:path="/3D/Objects/object_${o.id}.model" objectid="${p.partId}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`)
          .join("\n") +
        "\n   </components>\n  </object>",
    )
    .join("\n");
  const plateOf = new Map();
  spec.plates.forEach((ids, plateIndex) => ids.forEach((id) => plateOf.set(id, plateIndex)));
  let slot = 0;
  const build = spec.buildOrder
    .map((id) => {
      const plateIndex = plateOf.get(id) ?? 0;
      slot += 1;
      return `  <item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${plateIndex * 300 + slot} ${slot * 15} 0" printable="1"/>`;
    })
    .join("\n");
  files["3D/3dmodel.model"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<model ${NS}>\n${meta}\n <resources>\n${resources}\n </resources>\n <build>\n${build}\n </build>\n</model>`,
  );
  files["3D/_rels/3dmodel.model.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
      objects
        .map((o, i) => ` <Relationship Target="/3D/Objects/object_${o.id}.model" Id="rel-${i + 1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`)
        .join("\n") +
      "\n</Relationships>",
  );
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>`,
  );
  files["[Content_Types].xml"] = strToU8(
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
  );
  for (const o of objects) {
    files[`3D/Objects/object_${o.id}.model`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<model ${NS}>\n <resources>\n` +
        o.parts
          .map((p) => `  <object id="${p.partId}" type="model">\n  ${cubeMesh(p.size ?? o.size ?? 10, { paint: p.paint })}\n  </object>`)
          .join("\n") +
        "\n </resources>\n <build/>\n</model>",
    );
  }

  if (slicer !== "none" && !spec.omitSettings) {
    const objectXml = objects
      .map(
        (o) =>
          `  <object id="${o.id}">\n    <metadata key="name" value="${o.name ?? `obj${o.id}`}"/>\n` +
          (o.extruder === null || o.extruder === undefined ? "" : `    <metadata key="extruder" value="${o.extruder}"/>\n`) +
          o.parts
            .map(
              (p) =>
                `    <part id="${p.partId}" subtype="normal_part">\n      <metadata key="name" value="p${p.partId}"/>\n` +
                (p.extruder === null || p.extruder === undefined ? "" : `      <metadata key="extruder" value="${p.extruder}"/>\n`) +
                "    </part>",
            )
            .join("\n") +
          "\n  </object>",
      )
      .join("\n");
    const plateXml = spec.omitPlates
      ? ""
      : spec.plates
          .map(
            (ids, i) =>
              `  <plate>\n    <metadata key="plater_id" value="${i + 1}"/>\n    <metadata key="plater_name" value=""/>\n` +
              ids
                .map(
                  (id) =>
                    `    <model_instance>\n      <metadata key="object_id" value="${id}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${100 + id}"/>\n    </model_instance>`,
                )
                .join("\n") +
              "\n  </plate>",
          )
          .join("\n");
    files["Metadata/model_settings.config"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${objectXml}\n${plateXml}\n</config>\n`);
    if (spec.filamentColours !== null) {
      files["Metadata/project_settings.config"] = strToU8(
        JSON.stringify({ filament_colour: spec.filamentColours ?? ["#ffd800", "#c12e1e"], from: "project", version: "02.07.00.55" }),
      );
    }
  }
  void byId;
  return zipSync(files);
}

/** 3MF estándar con <basematerials> (color real sin metadata de slicer). */
export function buildStandard3mf({ colored = true } = {}) {
  const files = {};
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
  );
  files["[Content_Types].xml"] = strToU8(
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
  );
  const mesh = cubeMesh(10);
  files["3D/3dmodel.model"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n <resources>\n` +
      (colored ? '  <basematerials id="1"><base name="Rojo" displaycolor="#FF0000FF"/></basematerials>\n' : "") +
      `  <object id="2" type="model"${colored ? ' pid="1" pindex="0"' : ""}>\n  ${mesh}\n  </object>\n </resources>\n <build>\n  <item objectid="2"/>\n </build>\n</model>`,
  );
  return zipSync(files);
}
