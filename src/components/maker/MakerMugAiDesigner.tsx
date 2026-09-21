"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Eye, EyeOff, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { designMugWithAiAction } from "@/app/stampa-maker/jarros/actions";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/maker/MakerTextControls";
import { applyMugDesignProposal, pendingAssetChoices, resolveAssetChoice } from "@/lib/maker/mugs/ai/applyProposal";
import { diffMugDefinitions } from "@/lib/maker/mugs/ai/diff";
import { MUG_AI_LIMITS } from "@/lib/maker/mugs/ai/schema";
import type { MugAiAssetInfo, MugAiMode, MugDesignProposal } from "@/lib/maker/mugs/ai/types";
import type { MugAsset } from "@/lib/maker/mugs/decorations/artworkProvider";
import { validateMug } from "@/lib/maker/mugs/validation/validateMug";
import type { MugDefinition } from "@/lib/maker/mugs/types";

// Ejemplos que SOLO rellenan el prompt: no son presets ni configuran nada por sí solos.
const EXAMPLES: { label: string; prompt: string }[] = [
  { label: "Vikingo", prompt: "Quiero un jarro vikingo robusto, cuerpo tipo barril, tres bandas metálicas, asa grande angular y borde grueso." },
  { label: "Taberna medieval", prompt: "Un jarro de taberna medieval, pesado, con cuerpo abombado, asa clásica grande y un par de bandas." },
  { label: "Cyberpunk", prompt: "Un jarro cyberpunk agresivo, superficie facetada, asa angular y líneas duras." },
  { label: "Minimalista", prompt: "Un jarro minimalista moderno, liso, de líneas rectas, borde redondeado y un asa fina." },
  { label: "Industrial", prompt: "Un jarro industrial, cónico, con ranuras verticales y un asa angular robusta." },
  { label: "Fantasía", prompt: "Un jarro de fantasía, cuerpo abombado con borde redondeado y ranuras suaves." },
];

const MODE_OPTIONS: { value: MugAiMode; label: string }[] = [
  { value: "full", label: "Diseñar desde cero" },
  { value: "patch", label: "Modificar el actual" },
];

const btnBase = "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary = `${btnBase} border border-transparent bg-stampa-orange text-neutral-950 hover:bg-stampa-orange-hover`;
const btnGhost = `${btnBase} border border-white/10 bg-white/[0.04] text-gray-300 hover:border-stampa-orange/50 hover:text-white`;

function assetInfos(assets: ReadonlyMap<string, MugAsset>): MugAiAssetInfo[] {
  return [...assets.values()].map((a) => ({ id: a.id, kind: a.kind === "svg" ? "svg" : a.format, fileName: a.fileName }));
}

interface Props {
  def: MugDefinition;
  assets: ReadonlyMap<string, MugAsset>;
  /** Vista previa temporal (no toca el proyecto ni lo marca como modificado). null = volver al diseño real. */
  onPreview: (def: MugDefinition | null) => void;
  /** Aplica el diseño: reemplaza la MugDefinition del proyecto (esto sí lo marca como modificado). */
  onApply: (def: MugDefinition) => void;
}

/**
 * "Diseñar con IA": pide una propuesta al servidor, la muestra como ANTES → DESPUÉS y solo la aplica si el usuario
 * acepta. No contiene lógica geométrica: la propuesta ya viene saneada y se aplica con funciones puras del motor.
 */
export function MakerMugAiDesigner({ def, assets, onPreview, onApply }: Props) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<MugAiMode>("full");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<MugDesignProposal | null>(null);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [previewing, setPreviewing] = useState(false);
  const [applied, setApplied] = useState(false);
  const [serial, setSerial] = useState(0);
  const requestId = useRef(0);
  const inFlight = useRef(false);

  const assetList = useMemo(() => assetInfos(assets), [assets]);

  // Propuesta con las elecciones de archivo del usuario ya resueltas.
  const effective = useMemo(() => {
    if (!proposal) return null;
    let p = proposal;
    for (const [idx, id] of Object.entries(choices)) {
      const asset = assetList.find((a) => a.id === id);
      if (!asset) continue;
      const source = asset.kind === "svg"
        ? ({ kind: "svg", assetId: asset.id, fileName: asset.fileName } as const)
        : ({ kind: "raster", assetId: asset.id, fileName: asset.fileName, format: asset.kind, detection: "auto", threshold: null, invert: false } as const);
      p = resolveAssetChoice(p, Number(idx), source);
    }
    return p;
  }, [proposal, choices, assetList]);

  const pending = useMemo(() => (effective ? pendingAssetChoices(effective) : []), [effective]);

  // Ids estables entre vista previa y aplicación (mismo `next` en ambos).
  const next = useMemo(() => {
    if (!effective) return null;
    let n = 0;
    return applyMugDesignProposal(def, effective, { newId: () => `dec-ai-${serial}-${++n}` });
  }, [def, effective, serial]);
  const diff = useMemo(() => (next ? diffMugDefinitions(def, next) : []), [def, next]);
  const validation = useMemo(() => (next ? validateMug(next) : null), [next]);

  // La vista previa sigue a `next` mientras esté activada; al cerrar/cancelar/desmontar se restaura el diseño real.
  useEffect(() => {
    onPreview(previewing && next ? next : null);
  }, [previewing, next, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const reset = useCallback(() => {
    requestId.current++; // descarta cualquier respuesta en curso
    inFlight.current = false;
    setLoading(false);
    setProposal(null);
    setChoices({});
    setPreviewing(false);
    setError(null);
  }, []);

  const generate = useCallback(async () => {
    if (inFlight.current) return; // evita doble submit
    if (prompt.trim().length < MUG_AI_LIMITS.promptMin) {
      setError("Contanos un poco más sobre el jarro que querés.");
      return;
    }
    inFlight.current = true;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setApplied(false);
    setProposal(null);
    setChoices({});
    setPreviewing(false);
    try {
      const result = await designMugWithAiAction({ mode, prompt, current: def, assets: assetList });
      if (id !== requestId.current) return; // cancelado o reemplazado
      if (result.ok) {
        setSerial((v) => v + 1);
        setProposal(result.proposal);
      }
      else setError(result.message);
    } catch {
      if (id === requestId.current) setError("No se pudo generar el diseño. Tu diseño actual no cambió.");
    } finally {
      if (id === requestId.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [prompt, mode, def, assetList]);

  const apply = useCallback(() => {
    if (!next || !validation || validation.errors.length > 0 || pending.length > 0) return;
    setPreviewing(false);
    onPreview(null);
    onApply(next);
    setProposal(null);
    setChoices({});
    setPrompt("");
    setMode("patch");
    setApplied(true);
  }, [next, validation, pending.length, onApply, onPreview]);

  const toggleOpen = () => {
    if (open) reset();
    setOpen(!open);
  };

  const textareaId = `${uid}-prompt`;
  const canApply = !!next && !!validation && validation.errors.length === 0 && pending.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls={`${uid}-panel`}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-gradient-to-r from-stampa-orange to-amber-400 px-4 text-sm font-bold text-neutral-950 shadow-lg shadow-stampa-orange/20 transition-opacity hover:opacity-90"
      >
        <Sparkles size={16} aria-hidden="true" />
        {open ? "Cerrar Diseñar con IA" : "✨ Diseñar con IA"}
      </button>

      {open && (
        <Card className="flex flex-col gap-3 p-3">
          <div id={`${uid}-panel`} className="flex flex-col gap-3">
            <p className="text-xs text-gray-400">Describí tu idea y Stampa configurará el generador por vos. Vos decidís qué se aplica.</p>

            <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} compact />

            <div className="flex flex-col gap-1.5">
              <label htmlFor={textareaId} className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {applied || mode === "patch" ? "¿Qué cambiarías?" : "Describí el jarro que querés crear"}
              </label>
              <textarea
                id={textareaId}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, MUG_AI_LIMITS.promptMax))}
                maxLength={MUG_AI_LIMITS.promptMax}
                rows={4}
                disabled={loading}
                placeholder={mode === "full" ? "Quiero un jarro medieval robusto, tipo barril…" : "Quiero el asa más grande y el cuerpo menos gordo."}
                className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-xs text-gray-100 placeholder:text-gray-600 focus:border-stampa-orange/60 focus:outline-none disabled:opacity-60"
              />
              <span className="self-end text-[10px] text-gray-600">{prompt.length}/{MUG_AI_LIMITS.promptMax}</span>
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ejemplos rápidos">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setPrompt(ex.prompt);
                    setMode("full");
                  }}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-gray-300 transition-colors hover:border-stampa-orange/50 hover:text-white disabled:opacity-50"
                >
                  {ex.label}
                </button>
              ))}
            </div>
            {mode === "full" && <p className="text-[11px] text-gray-500">Desde cero reemplaza forma, dimensiones, asa, bandas y ranuras. Conserva el modo (jarro/inserto) y tus decoraciones, salvo que pidas quitarlas.</p>}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={generate} disabled={loading || prompt.trim().length === 0} className={btnPrimary}>
                {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
                {mode === "full" ? "Generar diseño" : "Modificar con IA"}
              </button>
              {loading && (
                <button type="button" onClick={reset} className={btnGhost}>
                  <X size={14} aria-hidden="true" />
                  Cancelar
                </button>
              )}
            </div>

            <div aria-live="polite" role="status" className="text-xs text-gray-400">
              {loading && "Diseñando tu jarro…"}
              {applied && !loading && !proposal && "Diseño aplicado. Podés seguir ajustándolo: escribí qué cambiarías."}
            </div>
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {effective && next && validation && (
              <section aria-label="Propuesta de la IA" className="flex flex-col gap-2 rounded-xl border border-stampa-orange/30 bg-stampa-orange/[0.06] p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-stampa-orange">Propuesta IA</h3>
                <p className="text-sm font-bold text-white">{effective.name}</p>
                {effective.description && <p className="text-xs text-gray-300">{effective.description}</p>}

                {diff.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {diff.map((d) => (
                      <li key={d.id} className="text-xs text-gray-200">
                        <span className="text-gray-400">{d.label}: </span>
                        {d.kind === "added" ? <span className="font-semibold text-emerald-300">+ {d.after}</span> : d.kind === "removed" ? <span className="font-semibold text-red-300">− {d.before}</span> : (
                          <>
                            <span className="text-gray-400">{d.before}</span> → <span className="font-semibold text-white">{d.after}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-400">Esta propuesta no cambia nada del jarro actual.</p>
                )}

                {effective.replaceDecorations && def.decorations.length > 0 && (
                  <p className="text-xs font-semibold text-amber-300">Se van a eliminar las {def.decorations.length} decoraciones actuales y reemplazarlas por las propuestas.</p>
                )}

                {pending.map((idx) => (
                  <div key={idx} className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.04] p-2">
                    <label htmlFor={`${uid}-asset-${idx}`} className="text-xs font-semibold text-gray-200">¿Qué archivo querés usar en la decoración?</label>
                    <select
                      id={`${uid}-asset-${idx}`}
                      value={choices[idx] ?? ""}
                      onChange={(e) => setChoices((c) => ({ ...c, [idx]: e.target.value }))}
                      className="rounded-md border border-white/10 bg-stampa-surface px-2 py-1 text-xs text-gray-100"
                    >
                      <option value="">Elegí un archivo…</option>
                      {assetList.map((a) => <option key={a.id} value={a.id}>{a.fileName}</option>)}
                    </select>
                  </div>
                ))}

                {effective.unsupportedRequests.length > 0 && (
                  <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">
                    <p className="font-semibold">Todavía no disponible</p>
                    <ul className="ml-4 list-disc">{effective.unsupportedRequests.map((u, i) => <li key={i}>{u}</li>)}</ul>
                  </div>
                )}
                {effective.warnings.length > 0 && (
                  <ul className="ml-4 list-disc text-[11px] text-gray-400">{effective.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                )}
                {validation.errors.length > 0 && (
                  <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
                    <p className="font-semibold">Esta propuesta genera un jarro inválido:</p>
                    <ul className="ml-4 list-disc">{validation.errors.slice(0, 4).map((e, i) => <li key={i}>{e.message}</li>)}</ul>
                    <p className="mt-1">Regenerá o pedí otro ajuste.</p>
                  </div>
                )}
                {validation.errors.length === 0 && validation.warnings.length > 0 && (
                  <ul className="ml-4 list-disc text-[11px] text-amber-200">{validation.warnings.slice(0, 3).map((w, i) => <li key={i}>{w.message}</li>)}</ul>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => setPreviewing((p) => !p)} className={btnGhost} aria-pressed={previewing}>
                    {previewing ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                    {previewing ? "Salir de la vista" : "Ver propuesta"}
                  </button>
                  <button type="button" onClick={apply} disabled={!canApply} className={btnPrimary}>
                    <Check size={14} aria-hidden="true" />
                    Aplicar diseño
                  </button>
                  <button type="button" onClick={generate} disabled={loading} className={btnGhost}>
                    <RefreshCw size={14} aria-hidden="true" />
                    Regenerar
                  </button>
                  <button type="button" onClick={reset} className={btnGhost}>
                    <X size={14} aria-hidden="true" />
                    Cancelar
                  </button>
                </div>
              </section>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
