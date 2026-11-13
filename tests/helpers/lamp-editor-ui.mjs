// Carga los componentes REALES del editor de lámparas (biblioteca, propiedades y lista de exportación) para renderizarlos a HTML estático en los tests.
// `MakerLampControls` es una composición SOLO DE PRUEBA: biblioteca + propiedades de la pantalla + del difusor + de la base, es decir, todo lo que el editor
// puede mostrar para un diseño (en la interfaz real se ve un componente a la vez). Así los tests de contenido recorren los tres paneles con una sola llamada.
import { createElement } from "react";
import { loadMakerModule } from "../../scripts/lib/maker-engine-node.mjs";
import { loadTs } from "./load-ts.mjs";

const noop = () => {};
const { applyShadeType } = loadMakerModule("lib/maker/lamps/openwork/presets.ts");

export function loadLampUi(extraMocks = {}) {
  const mocks = { "next/link": { __esModule: true, default: (props) => createElement("a", props) }, "opentype.js": {}, ...extraMocks };
  const cache = new Map();
  const { LampLibraryPanel } = loadTs("src/components/maker/lamps/LampLibraryPanel.tsx", mocks, cache);
  const { LampPropertiesPanel } = loadTs("src/components/maker/lamps/LampPropertiesPanel.tsx", mocks, cache);
  const { LampExportList } = loadTs("src/components/maker/lamps/LampExportList.tsx", mocks, cache);

  /** Biblioteca + propiedades de cada componente. Props como las del panel de propiedades (más `onSelectFamily`, `onApplyPreset`, `onGenerateVariation`). */
  function MakerLampControls(p) {
    const shared = {
      def: p.def,
      onChange: p.onChange ?? noop,
      errors: p.errors ?? [],
      warnings: p.warnings ?? [],
      metrics: p.metrics ?? null,
      ranges: p.ranges,
      stale: p.stale,
      outdated: p.outdated,
      onAdvancedToggle: p.onAdvancedToggle,
      onRestoreLast: p.onRestoreLast,
      onApplyStandardMechanics: p.onApplyStandardMechanics ?? noop,
    };
    return createElement(
      "div",
      null,
      createElement(LampLibraryPanel, { def: p.def, onChange: p.onChange ?? noop, onSelectFamily: p.onSelectFamily ?? ((type) => (p.onChange ?? noop)(applyShadeType(p.def, type))), onApplyPreset: p.onApplyPreset ?? noop, onGenerateVariation: p.onGenerateVariation ?? noop }),
      ...["shade", "diffuser", "base"].map((component) => createElement(LampPropertiesPanel, { key: component, component, ...shared })),
    );
  }
  return { MakerLampControls, LampExportButtons: LampExportList, LampLibraryPanel, LampPropertiesPanel, LampExportList };
}
