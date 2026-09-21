"use client";

import React from "react";
import { AlertTriangle, Cable, Move, RotateCcw } from "lucide-react";
import { NumberField, SegmentedControl, Toggle } from "@/components/maker/MakerTextControls";
import { resetMountOverrides, setLetterMountCount, setLetterSplice } from "@/lib/maker/installation/editing";
import type {
  InstallationRecipe,
  KeyholeMountSettings,
  LedVoltage,
  MountingType,
  PaperFormat,
  SpliceSettings,
  StandoffMountSettings,
  WiringDirection,
  WiringMode,
  WiringSettings,
} from "@/lib/maker/installation/types";
import type { LetterGeometryResult, LetterSignParams } from "@/lib/maker/types";

const MOUNTING_OPTIONS: { value: MountingType; label: string }[] = [
  { value: "none", label: "Ninguno" },
  { value: "keyhole", label: "Keyhole" },
  { value: "standoff", label: "Separadores" },
];
const WIRING_OPTIONS: { value: WiringMode; label: string }[] = [
  { value: "off", label: "Desactivado" },
  { value: "chained", label: "Encadenado" },
];
const DIRECTION_OPTIONS: { value: WiringDirection; label: string }[] = [
  { value: "ltr", label: "Izq. → Der." },
  { value: "rtl", label: "Der. → Izq." },
];
const PAPER_OPTIONS: { value: PaperFormat; label: string }[] = [
  { value: "A4", label: "A4" },
  { value: "Letter", label: "Carta" },
  { value: "A3", label: "A3" },
];
const VOLTAGE_OPTIONS: { value: LedVoltage | "none"; label: string }[] = [
  { value: "none", label: "—" },
  { value: "5V", label: "5 V" },
  { value: "12V", label: "12 V" },
  { value: "24V", label: "24 V" },
  { value: "other", label: "Otro" },
];

function SubTitle({ children }: { children: React.ReactNode }) {
  return <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{children}</span>;
}

interface Props {
  params: LetterSignParams;
  onChange: (patch: Partial<LetterSignParams>) => void;
  geometry: LetterGeometryResult | null;
  editingMounts: boolean;
  onToggleEditingMounts: () => void;
  showWiring: boolean;
  onShowWiring: (v: boolean) => void;
  showWall: boolean;
  onShowWall: (v: boolean) => void;
}

/** INSTALACIÓN: MONTAJE (keyhole / separadores), CABLEADO (encadenado físico, paralelo eléctrico) y PLANTILLA. Controles condicionales para no saturar el panel. */
export function MakerInstallationSection({ params, onChange, geometry, editingMounts, onToggleEditingMounts, showWiring, onShowWiring, showWall, onShowWall }: Props) {
  const recipe = params.installation;
  const setRecipe = (patch: Partial<InstallationRecipe>) => onChange({ installation: { ...recipe, ...patch } });
  const setKeyhole = (patch: Partial<KeyholeMountSettings>) => setRecipe({ mounting: { ...recipe.mounting, keyhole: { ...recipe.mounting.keyhole, ...patch } } });
  const setStandoff = (patch: Partial<StandoffMountSettings>) => setRecipe({ mounting: { ...recipe.mounting, standoff: { ...recipe.mounting.standoff, ...patch } } });
  const setWiring = (patch: Partial<WiringSettings>) => setRecipe({ wiring: { ...recipe.wiring, ...patch } });
  const setSplice = (patch: Partial<SpliceSettings>) => setWiring({ splice: { ...recipe.wiring.splice, ...patch } });
  const setOverrides = (next: LetterSignParams["installationOverrides"]) => onChange({ installationOverrides: next });

  const { mounting, wiring } = recipe;
  const plan = geometry?.installation ?? null;
  const overrides = params.installationOverrides ?? {};
  const hasManual = Object.values(overrides).some((o) => o.mountPoints || o.mountCount);
  const issues = [...(plan?.errors ?? []).map((e) => ({ ...e, level: "error" as const })), ...(plan?.warnings ?? []).map((e) => ({ ...e, level: "warning" as const }))];
  const spacerPart = geometry?.installationParts[0];
  const letters = geometry?.letters ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Instalación</span>
        <p className="mt-1 text-xs text-gray-500">
          Montaje y cableado del cartel. Stampa imprime las piezas que sostienen, ordenan, separan y protegen; el contacto eléctrico lo hacen tus empalmes (baja tensión DC).
        </p>
      </div>

      {/* ---------------------------------------------------------------- MONTAJE */}
      <div className="flex flex-col gap-3">
        <SubTitle>Montaje</SubTitle>
        <SegmentedControl options={MOUNTING_OPTIONS} value={mounting.type} onChange={(type) => setRecipe({ mounting: { ...mounting, type } })} />

        {mounting.type === "keyhole" && (
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Ø cabeza tornillo" suffix="mm" value={mounting.keyhole.headDiameterMm} onChange={(v) => setKeyhole({ headDiameterMm: v })} />
            <NumberField label="Ancho cuello" suffix="mm" value={mounting.keyhole.neckWidthMm} onChange={(v) => setKeyhole({ neckWidthMm: v })} />
            <NumberField label="Largo cuello" suffix="mm" value={mounting.keyhole.neckLengthMm} onChange={(v) => setKeyhole({ neckLengthMm: v })} />
            <NumberField label="Profundidad" suffix="mm" value={mounting.keyhole.depthMm} onChange={(v) => setKeyhole({ depthMm: v })} />
            <NumberField label="Margen al borde" suffix="mm" value={mounting.keyhole.edgeMarginMm} onChange={(v) => setKeyhole({ edgeMarginMm: v })} />
            <p className="col-span-2 text-xs text-gray-500">Distribución automática (mínimo 2 puntos separados por letra). Con «Editar montaje» podés moverlos.</p>
          </div>
        )}

        {mounting.type === "standoff" && (
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Separación de pared" suffix="mm" value={mounting.standoff.wallSpacingMm} onChange={(v) => setStandoff({ wallSpacingMm: v })} />
            <NumberField label="Ø cuerpo separador" suffix="mm" value={mounting.standoff.bodyDiameterMm} onChange={(v) => setStandoff({ bodyDiameterMm: v })} />
            <NumberField label="Ø espiga" suffix="mm" value={mounting.standoff.pegDiameterMm} onChange={(v) => setStandoff({ pegDiameterMm: v })} />
            <NumberField label="Profundidad encastre" suffix="mm" value={mounting.standoff.insertDepthMm} onChange={(v) => setStandoff({ insertDepthMm: v })} />
            <NumberField label="Holgura por lado" suffix="mm" value={mounting.standoff.clearanceMm} onChange={(v) => setStandoff({ clearanceMm: v })} />
            <NumberField label="Ø agujero tornillo" suffix="mm" value={mounting.standoff.screwHoleDiameterMm} onChange={(v) => setStandoff({ screwHoleDiameterMm: v })} />
            <NumberField label="Ø rebaje cabeza (0 = sin)" suffix="mm" value={mounting.standoff.screwHeadDiameterMm} onChange={(v) => setStandoff({ screwHeadDiameterMm: v })} />
            <NumberField label="Refuerzo del receptor" suffix="mm" value={mounting.standoff.bossWallMm} onChange={(v) => setStandoff({ bossWallMm: v })} />
            <NumberField label="Margen al borde" suffix="mm" value={mounting.standoff.edgeMarginMm} onChange={(v) => setStandoff({ edgeMarginMm: v })} />
            <p className="col-span-2 text-xs text-gray-500">
              Distribución automática según el tamaño de cada letra. El receptor con refuerzo va dentro de la cavidad; nada sobresale por detrás de la letra.
            </p>
            {spacerPart && (
              <p className="col-span-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-gray-300">
                Separador de pared · cantidad: <b>{spacerPart.quantity}</b> · {spacerPart.fileBaseName}.stl
              </p>
            )}
            <Toggle label="Mostrar pared de referencia" checked={showWall} onChange={onShowWall} />
          </div>
        )}

        {mounting.type !== "none" && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!geometry || geometry.triangleCount === 0}
              onClick={onToggleEditingMounts}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stampa-border bg-stampa-surface-soft px-3 text-xs font-semibold text-stampa-text-muted hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <Move size={13} />
              {editingMounts ? "Terminar edición" : "Editar montaje"}
            </button>
            {hasManual && (
              <button
                type="button"
                onClick={() => setOverrides(resetMountOverrides(overrides))}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stampa-border bg-stampa-surface-soft px-3 text-xs font-semibold text-stampa-text-muted hover:bg-white/10 hover:text-white"
              >
                <RotateCcw size={13} />
                Restablecer automático
              </button>
            )}
          </div>
        )}
      </div>

      {/* --------------------------------------------------------------- CABLEADO */}
      <div className="flex flex-col gap-3">
        <SubTitle>Cableado</SubTitle>
        <SegmentedControl options={WIRING_OPTIONS} value={wiring.mode} onChange={(mode) => setWiring({ mode })} />
        {wiring.mode === "chained" && (
          <>
            <p className="text-xs text-gray-500">Los cables recorren las letras en cadena, pero la conexión eléctrica es en <b>paralelo</b>: cada letra toma + y - de los mismos buses.</p>
            <div>
              <span className="mb-1 block text-xs font-semibold text-gray-500">Dirección</span>
              <SegmentedControl compact options={DIRECTION_OPTIONS} value={wiring.direction} onChange={(direction) => setWiring({ direction })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Ø cable" suffix="mm" value={wiring.wireDiameterMm} onChange={(v) => setWiring({ wireDiameterMm: v })} />
              <NumberField label="Holgura del puerto" suffix="mm" value={wiring.portClearanceMm} onChange={(v) => setWiring({ portClearanceMm: v })} />
              <NumberField label="Margen de servicio" suffix="mm" value={wiring.serviceMarginMm} onChange={(v) => setWiring({ serviceMarginMm: v })} />
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">Entrada de alimentación</span>
                <select disabled value="direct-wire" className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white">
                  <option value="direct-wire">Cable directo + / -</option>
                </select>
              </label>
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">Voltaje LED (solo referencia)</span>
                <SegmentedControl compact options={VOLTAGE_OPTIONS} value={wiring.voltage ?? "none"} onChange={(v) => setWiring({ voltage: v === "none" ? null : v })} />
              </label>
            </div>
            <Toggle label="Alojamiento de empalmes (+ y -)" checked={wiring.splice.enabled} onChange={(enabled) => setSplice({ enabled })} />
            {wiring.splice.enabled && (
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="Ø empalme" suffix="mm" value={wiring.splice.diameterMm} onChange={(v) => setSplice({ diameterMm: v })} />
                <NumberField label="Largo" suffix="mm" value={wiring.splice.lengthMm} onChange={(v) => setSplice({ lengthMm: v })} />
                <NumberField label="Holgura" suffix="mm" value={wiring.splice.clearanceMm} onChange={(v) => setSplice({ clearanceMm: v })} />
              </div>
            )}
            <Toggle label="Etiquetas impresas (+, -, IN, OUT)" checked={wiring.printLabels} onChange={(printLabels) => setWiring({ printLabels })} />
            <Toggle label="Mostrar cableado" checked={showWiring} onChange={onShowWiring} />

            {plan && plan.cableLengths.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-300">
                  <Cable size={13} /> Longitud de cable entre letras
                </span>
                <ul className="flex flex-col gap-0.5 text-xs text-gray-400">
                  {plan.cableLengths.map((c) => (
                    <li key={`${c.fromId}-${c.toId}`}>
                      Cable {c.fromLabel} → {c.toLabel}: <span className="text-gray-200">{Math.round(c.lengthMm)} mm</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-gray-500">Distancia entre puertos + margen de servicio. No dimensiona sección eléctrica.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ------------------------------------------------------ POR LETRA (avanzado) */}
      {letters.length > 0 && (mounting.type !== "none" || wiring.mode === "chained") && (
        <details className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <summary className="cursor-pointer text-xs font-semibold text-gray-300">Ajustes por letra</summary>
          <div className="mt-2 flex flex-col gap-2">
            {letters.map((l) => {
              const o = overrides[l.instance.id];
              const lp = plan?.letters.find((p) => p.instanceId === l.instance.id);
              const role = plan?.wiring?.letters.find((w) => w.instanceId === l.instance.id)?.role;
              return (
                <div key={l.instance.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-300">
                  <b className="w-8 text-white">{l.instance.label}</b>
                  {mounting.type !== "none" && (
                    <label className="flex items-center gap-1">
                      soportes
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={o?.mountCount ?? lp?.mounts.length ?? 0}
                        onChange={(e) => setOverrides(setLetterMountCount(overrides, l.instance.id, Number(e.target.value) || null))}
                        className="h-7 w-14 rounded-md border border-white/10 bg-white/[0.06] px-2 text-xs text-white"
                      />
                    </label>
                  )}
                  {wiring.mode === "chained" && wiring.splice.enabled && (
                    <Toggle label="empalmes" checked={o?.spliceEnabled !== false} onChange={(v) => setOverrides(setLetterSplice(overrides, l.instance.id, v))} />
                  )}
                  {role && <span className="text-gray-500">{role.isFirst ? "alimentación" : role.hasIn ? "entrada" : ""}{role.hasOut ? (role.isFirst ? " + salida" : " + salida") : ""}</span>}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* --------------------------------------------------------------- PLANTILLA */}
      <div className="flex flex-col gap-3">
        <SubTitle>Plantilla</SubTitle>
        <div>
          <span className="mb-1 block text-xs font-semibold text-gray-500">Papel</span>
          <SegmentedControl compact options={PAPER_OPTIONS} value={recipe.template.paper} onChange={(paper) => setRecipe({ template: { ...recipe.template, paper } })} />
        </div>
        <NumberField label="Superposición entre hojas" suffix="mm" value={recipe.template.overlapMm} onChange={(v) => setRecipe({ template: { ...recipe.template, overlapMm: v } })} />
        <p className="text-xs text-gray-500">PDF vectorial 1:1 con contorno de cada letra, marcas de perforación, control de 100 mm y marcas de alineación. Se descarga desde «Exportar».</p>
      </div>

      {issues.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`} className={`flex items-start gap-1.5 text-xs ${issue.level === "error" ? "text-red-300" : "text-amber-300"}`}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
