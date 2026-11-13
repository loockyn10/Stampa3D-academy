"use client";

import React from "react";
import { DIFFUSER_KIND_LABELS, type DiffuserKind } from "@/lib/maker/lamps/capabilities";
import { doubleWallSilhouette } from "@/lib/maker/lamps/doublewall/silhouette";
import { applyDoubleStyle, type DoubleStyle } from "@/lib/maker/lamps/editor";
import { insertSilhouette, referenceInsertSurface } from "@/lib/maker/lamps/insert/silhouette";
import { applyOpenworkPreset, type OpenworkPreset } from "@/lib/maker/lamps/openwork/presets";
import { renderOpenworkThumbnail } from "@/lib/maker/lamps/openwork/thumbnail";
import type { LampPreset } from "@/lib/maker/lamps/presets";
import { resolveLampDef } from "@/lib/maker/lamps/resolve";
import { lampSilhouette } from "@/lib/maker/lamps/silhouette";
import type { LampDefinition, LampInsertDef, LampInsertStyle, LampShadeDef } from "@/lib/maker/lamps/types";

/** Miniaturas del editor. TODAS salen del mismo evaluador / campo que la malla exportada: una miniatura nunca dibuja otra forma que el modelo. */

const CARD = "flex flex-col items-center gap-1 rounded-xl border px-1.5 pb-1.5 pt-2 transition-colors";
const cardClass = (active: boolean) => `${CARD} ${active ? "border-stampa-orange/60 bg-stampa-orange/10" : "border-fg/10 bg-fg/[0.04] hover:border-stampa-orange/40"}`;
const CAPTION = "text-center text-[11px] font-semibold leading-tight text-gray-300";

/** Estilo de la pantalla sólida (preset): silueta de crestas y valles con las medidas actuales. */
export function PresetThumb({ preset, def, active, onApply }: { preset: LampPreset; def: LampDefinition; active: boolean; onApply: (p: LampPreset) => void }) {
  const shade: LampShadeDef = { ...def.shade, ...preset.recipe, topDiameterMm: Math.round(def.shade.bottomDiameterMm * preset.recipe.topRatio) };
  const s = React.useMemo(() => lampSilhouette(shade, 64), [shade.family, shade.profile, shade.profileAmountPct, shade.topDiameterMm, shade.bottomDiameterMm, shade.heightMm, shade.collarHeightMm, shade.amplitudeMm, shade.waves, shade.twistDeg, shade.verticalFrequency, shade.patternIntensityPct, shade.organicPct, shade.seed, shade.wallMm]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button type="button" title={preset.description} aria-pressed={active} data-style={preset.id} onClick={() => onApply(preset)} className={cardClass(active)}>
      <svg viewBox={`0 0 ${s.width} ${s.height}`} height={56} className="max-w-full" aria-hidden>
        <path d={s.crest} className="fill-stampa-accent/25 stroke-stampa-accent" strokeWidth={1.2} strokeLinejoin="round" />
        <path d={s.valley} className="fill-none stroke-stampa-accent/50" strokeWidth={0.8} strokeLinejoin="round" />
      </svg>
      <span className={CAPTION}>{preset.label}</span>
    </button>
  );
}

/** Estilo de la pantalla calada: máscara leída del mismo campo de aberturas que la malla, pintada con el color de acento. */
export function OpenworkThumb({ preset, def, active, onApply }: { preset: OpenworkPreset; def: LampDefinition; active: boolean; onApply: (p: OpenworkPreset) => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const applied = React.useMemo(() => applyOpenworkPreset(def, preset), [def.shade.heightMm, def.shade.bottomDiameterMm, def.openwork, def.thread, preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const thumb = React.useMemo(() => {
    try {
      // con el difusor como dato, los extremos de la pantalla son los resueltos por el motor (la miniatura dibuja lo mismo que la malla)
      const resolved = resolveLampDef(applied);
      return renderOpenworkThumbnail(resolved.shade, resolved.openwork, 112);
    } catch {
      return null;
    }
  }, [applied]);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumb) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = thumb.width;
    canvas.height = thumb.height;
    ctx.putImageData(new ImageData(thumb.pixels as unknown as Uint8ClampedArray<ArrayBuffer>, thumb.width, thumb.height), 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = getComputedStyle(canvas).color;
    ctx.fillRect(0, 0, thumb.width, thumb.height);
  }, [thumb]);
  return (
    <button type="button" title={preset.description} aria-pressed={active} data-style={preset.id} onClick={() => onApply(preset)} className={cardClass(active)}>
      <canvas ref={canvasRef} aria-hidden className="h-14 max-w-full text-stampa-accent" />
      <span className={CAPTION}>{preset.label}</span>
    </button>
  );
}

/** Estilo de la doble pared (forma exterior + forma interior): las dos paredes dibujadas con las mismas superficies que la malla. */
export function DoubleStyleThumb({ style, def, active, onApply }: { style: DoubleStyle; def: LampDefinition; active: boolean; onApply: (s: DoubleStyle) => void }) {
  const applied = React.useMemo(() => applyDoubleStyle(def, style), [def.shade.heightMm, def.shade.bottomDiameterMm, def.shade.topDiameterMm, def.doubleWall, style]); // eslint-disable-line react-hooks/exhaustive-deps
  const sil = React.useMemo(() => {
    try {
      return doubleWallSilhouette(applied, 64);
    } catch {
      return null;
    }
  }, [applied]);
  return (
    <button type="button" title={style.description} aria-pressed={active} data-style={style.id} onClick={() => onApply(style)} className={cardClass(active)}>
      {sil ? (
        <svg viewBox={`0 0 ${sil.width} ${sil.height}`} height={56} className="max-w-full" aria-hidden>
          <path d={sil.outer} className="fill-stampa-accent/20 stroke-stampa-accent" strokeWidth={1.2} strokeLinejoin="round" />
          <path d={sil.inner} className="fill-none stroke-stampa-accent/60" strokeWidth={1} strokeLinejoin="round" />
        </svg>
      ) : (
        <span className="h-14" />
      )}
      <span className={CAPTION}>{style.label}</span>
    </button>
  );
}

const INSERT_STYLE_INFO: Record<LampInsertStyle, string> = {
  flat: "Cilindro cerrado con tapa plana a 90°. Se imprime invertido: la tapa sobre la cama y el extremo abierto hacia arriba.",
  drop: "Cilindro que se cierra de forma progresiva en una punta redondeada. Se imprime parado, con la abertura inferior sobre la cama.",
  wavy: "Cilindro con ondas en la superficie lateral (suaves o pronunciadas), abierto o con tapa.",
  mossglow: "Silueta ancha abajo que se estrecha progresivamente hacia arriba.",
  tulip: "Cuerpo que se abre suavemente hacia arriba, como un cáliz.",
  hourglass: "Dos extremos anchos con una cintura central: la intensidad y la posición cambian la forma.",
  bell: "Falda ancha abajo y cierre superior redondeado, en gota o con tapa plana.",
};

export const DIFFUSER_KIND_INFO: Record<DiffuserKind, string> = {
  cylinder: "Cilindro recto y abierto: se coloca y se retira por arriba.",
  flat: INSERT_STYLE_INFO.flat,
  drop: INSERT_STYLE_INFO.drop,
  wavy: INSERT_STYLE_INFO.wavy,
  mossglow: INSERT_STYLE_INFO.mossglow,
  tulip: INSERT_STYLE_INFO.tulip,
  hourglass: INSERT_STYLE_INFO.hourglass,
  bell: INSERT_STYLE_INFO.bell,
};

/** Tarjeta de forma del difusor: la miniatura sale de la MISMA superficie que se malla y se exporta (con los parámetros actuales si es la forma elegida, o los iniciales si no). Todos comparten el encastre inferior estándar. */
export function DiffuserKindCard({ kind, def, active, onSelect }: { kind: DiffuserKind; def: LampDefinition; active: boolean; onSelect: (k: DiffuserKind) => void }) {
  const i = def.insert;
  const style: LampInsertStyle = kind === "cylinder" ? "wavy" : kind;
  const sil = React.useMemo(
    () => {
      const shown: LampInsertDef = kind === "cylinder" ? { ...i, amplitudeMm: 0, twistDeg: 0, verticalFrequency: 0, wavyTop: "open" } : i;
      return insertSilhouette(referenceInsertSurface(style, shown, kind === "cylinder" || active), 64);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, style, active, i.thicknessMm, i.capThicknessMm, i.dropClosureMm, i.dropCurvaturePct, i.dropTipRadiusMm, i.waves, i.amplitudeMm, i.twistDeg, i.verticalFrequency, i.wavyTop, i.profileWidthMm, i.profileTopDiameterMm, i.profileCurvaturePct, i.profileWaistPct, i.profileWaistPositionPct, i.profileTop],
  );
  return (
    <button type="button" role="radio" aria-checked={active} data-diffuser={kind} title={DIFFUSER_KIND_INFO[kind]} onClick={() => onSelect(kind)} className={`flex flex-col items-center gap-1 rounded-xl border px-1 pb-1.5 pt-2 transition-colors ${active ? "border-stampa-orange/60 bg-stampa-orange/10" : "border-fg/10 bg-fg/[0.04] hover:border-stampa-orange/40"}`}>
      <svg viewBox={`0 0 ${sil.width} ${sil.height}`} height={56} className="max-w-full" aria-hidden>
        <path d={sil.outer} className="fill-stampa-accent/25 stroke-stampa-accent" strokeWidth={1.2} strokeLinejoin="round" />
        {kind === "wavy" && <path d={sil.valley} className="fill-none stroke-stampa-accent/50" strokeWidth={0.8} strokeLinejoin="round" />}
        <path d={sil.cavity} className="fill-none stroke-stampa-accent/40" strokeWidth={0.7} strokeDasharray="2 2" strokeLinejoin="round" />
      </svg>
      <span className="text-center text-[11px] font-semibold leading-tight text-gray-300">{DIFFUSER_KIND_LABELS[kind]}</span>
    </button>
  );
}
