"use client";

import React from "react";
import { Dices } from "lucide-react";
import { LampFamilyPicker } from "@/components/maker/LampFamilyPicker";
import { accentButton, HiddenNote, SectionLabel } from "@/components/maker/lamps/controls";
import { DoubleStyleThumb, OpenworkThumb, PresetThumb } from "@/components/maker/lamps/thumbs";
import { availableLampPresets, availableOpenworkPresets } from "@/lib/maker/lamps/availability";
import { DOUBLE_STYLES, applyDoubleStyle, availableDoubleStyles, doubleStyleMatches, type DoubleStyle } from "@/lib/maker/lamps/editor";
import { OPENWORK_PRESETS, applyOpenworkPreset, openworkPresetMatches } from "@/lib/maker/lamps/openwork/presets";
import type { LampPreset } from "@/lib/maker/lamps/presets";
import type { LampDefinition, LampShadeType } from "@/lib/maker/lamps/types";

/** El preset de la pantalla sólida está activo si su receta es la de la pantalla actual. */
function isPresetActive(def: LampDefinition, preset: LampPreset): boolean {
  const { topRatio, ...r } = preset.recipe;
  return (Object.keys(r) as (keyof typeof r)[]).every((k) => def.shade[k] === r[k]) && def.shade.topDiameterMm === Math.round(def.shade.bottomDiameterMm * topRatio);
}

export interface LampLibraryPanelProps {
  def: LampDefinition;
  onChange: (next: LampDefinition) => void;
  onSelectFamily: (type: LampShadeType) => void;
  onApplyPreset: (preset: LampPreset) => void;
  onGenerateVariation: () => void;
}

/**
 * PANEL IZQUIERDO — biblioteca de diseños. Responsabilidad ÚNICA: elegir qué lámpara se quiere diseñar (familia y estilo). No tiene ninguna medida ni
 * configuración mecánica. Los estilos que con las medidas actuales no dan una geometría válida no se ofrecen (y se dice cuántos quedaron fuera).
 */
export function LampLibraryPanel({ def, onChange, onSelectFamily, onApplyPreset, onGenerateVariation }: LampLibraryPanelProps) {
  const deferred = React.useDeferredValue(def);
  const solid = React.useMemo(() => (deferred.shadeType === "solid" ? availableLampPresets(deferred) : null), [deferred]);
  const openwork = React.useMemo(() => (deferred.shadeType === "openwork" ? availableOpenworkPresets(deferred, OPENWORK_PRESETS) : null), [deferred]);
  const double = React.useMemo(() => (deferred.shadeType === "double" ? availableDoubleStyles(deferred, DOUBLE_STYLES) : null), [deferred]);
  return (
    <div className="flex flex-col gap-4" data-panel="library">
      {/* en móvil el tipo se elige con el selector compacto bajo el visor */}
      <section className="flex flex-col gap-2 max-lg:hidden">
        <SectionLabel>Tipo de lámpara</SectionLabel>
        <LampFamilyPicker value={def.shadeType} onSelect={onSelectFamily} />
      </section>
      <section className="flex flex-col gap-2" data-family-section={def.shadeType}>
        <SectionLabel>Estilos</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {solid?.available.map((preset) => <PresetThumb key={preset.id} preset={preset} def={def} active={isPresetActive(def, preset)} onApply={onApplyPreset} />)}
          {openwork?.available.map((preset) => <OpenworkThumb key={preset.id} preset={preset} def={def} active={openworkPresetMatches(def, preset)} onApply={(p) => onChange(applyOpenworkPreset(def, p))} />)}
          {double?.available.map((style: DoubleStyle) => <DoubleStyleThumb key={style.id} style={style} def={def} active={doubleStyleMatches(def, style)} onApply={(s) => onChange(applyDoubleStyle(def, s))} />)}
        </div>
        {solid && <HiddenNote items={solid.hidden.map((h) => ({ label: h.preset.label, reason: h.reason }))} noun="estilo" />}
        {openwork && <HiddenNote items={openwork.hidden.map((h) => ({ label: h.preset.label, reason: h.reason }))} noun="estilo" />}
        {double && <HiddenNote items={double.hidden.map((h) => ({ label: h.style.label, reason: h.reason }))} noun="estilo" />}
        {def.shadeType === "solid" && (
          <button type="button" onClick={onGenerateVariation} className={accentButton}>
            <Dices size={15} aria-hidden="true" />
            Generar variación
          </button>
        )}
      </section>
    </div>
  );
}
