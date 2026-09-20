"use client";

import React from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Eye, EyeOff, Image as ImageIcon, Lock, LockOpen, Shapes, Trash2, Type, Upload } from "lucide-react";
import { NumberField, SegmentedControl } from "@/components/maker/MakerTextControls";
import type { AddAssetResult } from "@/hooks/maker/useMugArtwork";
import { MAKER_FONTS } from "@/lib/maker/fonts/registry";
import { rasterizeArtwork } from "@/lib/maker/mugs/decorations/field";
import type { Artwork } from "@/lib/maker/mugs/decorations/artwork";
import type { MugArtworkProvider, MugAsset } from "@/lib/maker/mugs/decorations/artworkProvider";
import { DEFAULT_MEDALLION, MAX_DECORATIONS, MAX_TEXT_LENGTH, createDecoration, defaultDepth, newDecorationId } from "@/lib/maker/mugs/decorations/decorationDefaults";
import { ANGLE_PRESETS, effectiveSize } from "@/lib/maker/mugs/decorations/evaluator";
import { SAFE_MARGIN_MM } from "@/lib/maker/mugs/decorations/validateDecorations";
import type { MugDecoration, MugDecorationMode, MugIssue, MugMedallionShape, MugRasterDetection, MugTextAlign } from "@/lib/maker/mugs/types";

const MODE_OPTIONS: { value: MugDecorationMode; label: string }[] = [
  { value: "emboss", label: "Relieve" },
  { value: "engrave", label: "Grabado" },
  { value: "medallion", label: "Medallón" },
];
const MODE_LABEL: Record<MugDecorationMode, string> = { emboss: "Relieve", engrave: "Grabado", medallion: "Medallón" };
const ALIGN_OPTIONS: { value: MugTextAlign; label: string }[] = [
  { value: "left", label: "Izquierda" },
  { value: "center", label: "Centro" },
  { value: "right", label: "Derecha" },
];
const SHAPE_OPTIONS: { value: MugMedallionShape; label: string }[] = [
  { value: "oval", label: "Oval" },
  { value: "circle", label: "Circular" },
  { value: "rounded-rect", label: "Rectángulo" },
];
const DETECTION_OPTIONS: { value: MugRasterDetection; label: string }[] = [
  { value: "auto", label: "Automática" },
  { value: "alpha", label: "Transparencia" },
  { value: "luminance", label: "Luminosidad" },
];
const IMAGE_ACCEPT = "image/png,image/jpeg,.png,.jpg,.jpeg";
const round1 = (n: number) => Math.round(n * 10) / 10;

function kindLabel(d: MugDecoration): string {
  const s = d.source;
  return s.kind === "text" ? "Texto" : s.kind === "svg" ? "SVG" : s.kind === "raster" ? (s.format === "jpg" ? "JPG" : "PNG") : "Liso";
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{children}</span>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-gray-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-white/[0.06] text-stampa-orange focus:ring-2 focus:ring-stampa-orange/40 focus:ring-offset-0" />
      {label}
    </label>
  );
}

function FileButton({ label, icon, accept, onFile, disabled }: { label: string; icon: React.ReactNode; accept: string; onFile: (f: File) => void; disabled?: boolean }) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => ref.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-semibold text-gray-200 transition-colors hover:border-stampa-orange/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
        {icon}
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** Miniaturas 2D de la fuente: «Original» y «Máscara» (lo que se convertirá en relieve/grabado). Sin skeleton. */
function SourcePreview({ asset, art }: { asset: MugAsset | undefined; art: Artwork | null }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  // Data URL (sin efectos ni object URLs que revocar). Las imágenes muy pesadas omiten la miniatura del original.
  const url = React.useMemo(() => {
    if (!asset) return null;
    if (asset.kind === "svg") return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.content)}`;
    if (asset.bytes.length > 3 * 1024 * 1024) return null;
    let bin = "";
    for (let i = 0; i < asset.bytes.length; i += 0x8000) bin += String.fromCharCode(...asset.bytes.subarray(i, i + 0x8000));
    return `data:${asset.format === "jpg" ? "image/jpeg" : "image/png"};base64,${btoa(bin)}`;
  }, [asset]);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !art) return;
    const w = 112, h = Math.max(8, Math.min(112, Math.round(w / art.aspect)));
    const mask = rasterizeArtwork(art, w, h);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i] ? 30 : 235;
      img.data.set([v, v, v, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
  }, [art]);
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["Original", "Máscara"] as const).map((label) => (
        <div key={label} className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gray-500">{label}</span>
          <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white">
            {label === "Original" ? (
              // eslint-disable-next-line @next/next/no-img-element
              url ? <img src={url} alt="Original" className="max-h-full max-w-full object-contain" /> : null
            ) : art ? (
              <canvas ref={canvasRef} className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="px-2 text-center text-[11px] text-gray-500">Sin máscara</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface MakerMugDecorationsPanelProps {
  decorations: MugDecoration[];
  onChange: (next: MugDecoration[]) => void;
  heightMm: number;
  issues: MugIssue[];
  provider: MugArtworkProvider;
  assets: ReadonlyMap<string, MugAsset>;
  addSvg: (file: File) => Promise<AddAssetResult>;
  addRaster: (file: File) => Promise<AddAssetResult>;
  onError: (message: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/** Sección DECORACIONES: lista (activar / duplicar / eliminar / orden) + editor de la decoración seleccionada. Solo edita `MugDecoration[]`. */
export function MakerMugDecorationsPanel(p: MakerMugDecorationsPanelProps) {
  const { decorations, onChange, heightMm, provider } = p;
  const full = decorations.length >= MAX_DECORATIONS;
  const selected = decorations.find((d) => d.id === p.selectedId) ?? null;
  const setOne = (id: string, patch: Partial<MugDecoration>) => onChange(decorations.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const append = (d: MugDecoration) => {
    onChange([...decorations, d]);
    p.onSelect(d.id);
  };

  const addText = () => append(createDecoration({ kind: "text", text: "STAMPA", fontId: "montserrat-bold", align: "center" }, heightMm));
  const addFile = async (kind: "svg" | "raster", file: File) => {
    const r = await (kind === "svg" ? p.addSvg(file) : p.addRaster(file));
    if (!r.ok) return p.onError(r.message);
    const a = r.asset;
    append(createDecoration(a.kind === "svg" ? { kind: "svg", assetId: a.id, fileName: a.fileName } : { kind: "raster", assetId: a.id, fileName: a.fileName, format: a.format, detection: "auto", threshold: null, invert: false }, heightMm, { name: a.fileName.replace(/\.[^.]+$/, "").slice(0, 24) }));
  };
  const replaceFile = async (d: MugDecoration, file: File) => {
    const r = await (d.source.kind === "svg" ? p.addSvg(file) : p.addRaster(file));
    if (!r.ok) return p.onError(r.message);
    const a = r.asset;
    setOne(d.id, { source: a.kind === "svg" ? { kind: "svg", assetId: a.id, fileName: a.fileName } : { kind: "raster", assetId: a.id, fileName: a.fileName, format: a.format, detection: d.source.kind === "raster" ? d.source.detection : "auto", threshold: d.source.kind === "raster" ? d.source.threshold : null, invert: d.source.kind === "raster" ? d.source.invert : false } });
  };
  const move = (id: string, dir: -1 | 1) => {
    const i = decorations.findIndex((d) => d.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= decorations.length) return;
    const next = decorations.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const duplicate = (d: MugDecoration) => {
    if (full) return;
    append({ ...d, id: newDecorationId(), name: `${d.name} (copia)`.slice(0, 60), position: { ...d.position }, size: { ...d.size }, medallion: { ...d.medallion }, source: { ...d.source } });
  };
  const remove = (id: string) => {
    onChange(decorations.filter((d) => d.id !== id));
    if (p.selectedId === id) p.onSelect(null);
  };

  const issuesOf = (d: MugDecoration) => p.issues.filter((i) => i.field?.startsWith(`decoration:${d.id}:`));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Decoraciones</h3>
        <span className="text-[11px] text-gray-500">{decorations.length}/{MAX_DECORATIONS}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={full} onClick={addText} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-semibold text-gray-200 transition-colors hover:border-stampa-orange/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
          <Type size={13} /> + Texto
        </button>
        <FileButton label="+ SVG" icon={<Shapes size={13} />} accept=".svg,image/svg+xml" onFile={(f) => addFile("svg", f)} disabled={full} />
        <FileButton label="+ Imagen" icon={<ImageIcon size={13} />} accept={IMAGE_ACCEPT} onFile={(f) => addFile("raster", f)} disabled={full} />
      </div>
      {decorations.length === 0 && <p className="text-xs text-gray-500">Personalizá el jarro con texto, un SVG relleno o una imagen (PNG/JPG), en relieve, grabado o sobre un medallón. Se envuelven sobre la superficie real.</p>}

      <div className="flex flex-col gap-1.5">
        {decorations.map((d, i) => {
          const active = d.id === p.selectedId;
          const bad = issuesOf(d).some((x) => !x.code.startsWith("DECO_NEAR") && x.code !== "DECO_OVER_HANDLE" && x.code !== "DECO_ART_MISSING");
          return (
            <div key={d.id} className={`flex items-center gap-1 rounded-xl border px-2 py-1.5 ${active ? "border-stampa-orange/60 bg-stampa-orange/10" : "border-white/10 bg-white/[0.03]"}`}>
              <button type="button" aria-label={d.enabled ? "Ocultar decoración" : "Mostrar decoración"} onClick={() => setOne(d.id, { enabled: !d.enabled })} className="rounded-md p-1 text-gray-400 hover:text-white">
                {d.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button type="button" onClick={() => p.onSelect(active ? null : d.id)} className={`min-w-0 flex-1 text-left ${d.enabled ? "" : "opacity-50"}`}>
                <span className="block truncate text-xs font-semibold text-gray-100">{d.name || "Decoración"}{bad && <span className="ml-1 text-red-400">●</span>}</span>
                <span className="block truncate text-[11px] text-gray-500">{kindLabel(d)} · {MODE_LABEL[d.mode]}</span>
              </button>
              <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => move(d.id, -1)} className="rounded-md p-1 text-gray-500 hover:text-white disabled:opacity-30"><ArrowUp size={13} /></button>
              <button type="button" aria-label="Bajar" disabled={i === decorations.length - 1} onClick={() => move(d.id, 1)} className="rounded-md p-1 text-gray-500 hover:text-white disabled:opacity-30"><ArrowDown size={13} /></button>
              <button type="button" aria-label="Duplicar" disabled={full} onClick={() => duplicate(d)} className="rounded-md p-1 text-gray-500 hover:text-white disabled:opacity-30"><Copy size={13} /></button>
              <button type="button" aria-label="Eliminar" onClick={() => remove(d.id)} className="rounded-md p-1 text-gray-500 hover:text-red-400"><Trash2 size={13} /></button>
            </div>
          );
        })}
        {decorations.length > 1 && <p className="text-[11px] text-gray-500">El orden importa: si se superponen un relieve y un grabado, gana el que está más abajo en la lista.</p>}
      </div>

      {selected && <DecorationEditor key={selected.id} d={selected} set={(patch) => setOne(selected.id, patch)} heightMm={heightMm} issues={issuesOf(selected)} provider={provider} asset={selected.source.kind === "svg" || selected.source.kind === "raster" ? p.assets.get(selected.source.assetId) : undefined} onReplace={(f) => replaceFile(selected, f)} />}
    </section>
  );
}

function DecorationEditor({ d, set, heightMm, issues, provider, asset, onReplace }: { d: MugDecoration; set: (patch: Partial<MugDecoration>) => void; heightMm: number; issues: MugIssue[]; provider: MugArtworkProvider; asset: MugAsset | undefined; onReplace: (f: File) => void }) {
  const res = provider.result(d);
  const art = res && res.ok ? res.artwork : null;
  const err = (prop: string) => issues.find((i) => i.field === `decoration:${d.id}:${prop}` && !["DECO_NEAR_RIM", "DECO_NEAR_BASE", "DECO_OVER_HANDLE"].includes(i.code))?.message.replace(/^[^:]*: /, "");
  const isMed = d.mode === "medallion";
  const src = d.source;
  const eff = effectiveSize(d, art);
  const locked = d.size.lockAspectRatio && !isMed;
  const depthLabel = d.mode === "engrave" ? "Profundidad del grabado" : d.mode === "emboss" ? "Altura del relieve" : "Altura del arte";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <label className="block">
        <SubLabel>Nombre</SubLabel>
        <input type="text" value={d.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs text-white outline-none focus:border-stampa-orange/60" />
      </label>

      <div className="flex flex-col gap-2">
        <SubLabel>Tipo</SubLabel>
        <SegmentedControl
          options={MODE_OPTIONS}
          value={d.mode}
          compact
          onChange={(mode) => {
            const patch: Partial<MugDecoration> = { mode, depthMm: defaultDepth(mode) };
            if (mode === "medallion") patch.size = { ...d.size, widthMm: Math.max(d.size.widthMm, 40), heightMm: round1(eff.heightMm + 10), lockAspectRatio: true };
            if (mode !== "medallion" && src.kind === "none") patch.source = { kind: "text", text: "STAMPA", fontId: "montserrat-bold", align: "center" };
            set(patch);
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <SubLabel>Contenido</SubLabel>
        {isMed && <Check label="Medallón liso (sin arte)" checked={src.kind === "none"} onChange={(plain) => set({ source: plain ? { kind: "none" } : { kind: "text", text: "STAMPA", fontId: "montserrat-bold", align: "center" } })} />}
        {src.kind === "text" && (
          <>
            <textarea value={src.text} rows={2} maxLength={MAX_TEXT_LENGTH} onChange={(e) => set({ source: { ...src, text: e.target.value } })} placeholder="STAMPA" className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none focus:border-stampa-orange/60" />
            <span className="text-[11px] text-gray-500">Hasta 4 líneas. Mayúsculas, minúsculas, números, tildes, Ñ y símbolos comunes.</span>
            <SegmentedControl options={MAKER_FONTS.map((f) => ({ value: f.id, label: f.label }))} value={src.fontId} compact onChange={(fontId) => set({ source: { ...src, fontId } })} />
            <span className="text-xs font-semibold text-gray-500">Alineación</span>
            <SegmentedControl options={ALIGN_OPTIONS} value={src.align} compact onChange={(align) => set({ source: { ...src, align } })} />
          </>
        )}
        {(src.kind === "svg" || src.kind === "raster") && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-gray-300">{src.fileName}</span>
              <FileButton label="Reemplazar" icon={<Upload size={13} />} accept={src.kind === "svg" ? ".svg,image/svg+xml" : IMAGE_ACCEPT} onFile={onReplace} />
            </div>
            {!asset && <p className="text-xs text-amber-300">El archivo original no está disponible: volvé a cargarlo con «Reemplazar».</p>}
            {src.kind === "raster" && (
              <>
                <span className="text-xs font-semibold text-gray-500">Detección</span>
                <SegmentedControl options={DETECTION_OPTIONS} value={src.detection} compact onChange={(detection) => set({ source: { ...src, detection } })} />
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label={src.threshold === null ? "Umbral (auto)" : "Umbral (0–255)"} value={src.threshold ?? 128} onChange={(v) => set({ source: { ...src, threshold: Math.min(255, Math.max(0, Math.round(v))) } })} />
                  <div className="flex items-end pb-2"><Check label="Invertir" checked={src.invert} onChange={(invert) => set({ source: { ...src, invert } })} /></div>
                </div>
                {src.threshold !== null && <button type="button" onClick={() => set({ source: { ...src, threshold: null } })} className="w-fit text-[11px] font-semibold text-stampa-orange hover:underline">Volver al umbral automático</button>}
              </>
            )}
            <SourcePreview asset={asset} art={art} />
          </>
        )}
        {res && !res.ok && <p className="text-xs text-red-400">{res.message}</p>}
        {art && art.warnings.map((w) => <p key={w} className="text-xs text-amber-300">{w}</p>)}
        {!res && src.kind === "text" && <p className="text-xs text-gray-500">Cargando fuente…</p>}
      </div>

      <div className="flex flex-col gap-2">
        <SubLabel>Posición</SubLabel>
        <div className="flex flex-wrap gap-1.5">
          {ANGLE_PRESETS.map((a) => (
            <button key={a.label} type="button" onClick={() => set({ position: { ...d.position, angleDeg: a.angleDeg } })} className={`rounded-lg border px-2 py-1 text-xs font-semibold transition-colors ${d.position.angleDeg === a.angleDeg ? "border-stampa-orange/60 bg-stampa-orange/10 text-stampa-orange" : "border-white/10 bg-white/[0.04] text-gray-300 hover:text-white"}`}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Ángulo (0° frente, +90° asa)" value={d.position.angleDeg} onChange={(v) => set({ position: { ...d.position, angleDeg: v } })} suffix="°" error={err("angleDeg")} />
          <NumberField label="Rotación" value={d.rotationDeg} onChange={(v) => set({ rotationDeg: v })} suffix="°" error={err("rotationDeg")} />
        </div>
        <NumberField label="Posición vertical (desde la base)" value={d.position.centerZMm} onChange={(v) => set({ position: { ...d.position, centerZMm: v } })} suffix="mm" error={err("centerZMm")} />
        <span className="text-[11px] text-gray-500">Rango 0–{round1(heightMm)} mm · margen recomendado {SAFE_MARGIN_MM} mm desde la boca y la base.</span>
      </div>

      <div className="flex flex-col gap-2">
        <SubLabel>{isMed ? "Tamaño del medallón" : "Tamaño"}</SubLabel>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Ancho" value={d.size.widthMm} onChange={(v) => set({ size: { ...d.size, widthMm: v } })} suffix="mm" error={err("widthMm")} />
          {locked ? (
            <div className="flex flex-col justify-end pb-2 text-xs"><span className="text-gray-500">Alto</span><span className="font-semibold text-gray-200">{round1(eff.heightMm)} mm</span></div>
          ) : (
            <NumberField label="Alto" value={d.size.heightMm} onChange={(v) => set({ size: { ...d.size, heightMm: v } })} suffix="mm" error={err("heightMm")} />
          )}
        </div>
        <button type="button" onClick={() => set({ size: { ...d.size, lockAspectRatio: !d.size.lockAspectRatio, heightMm: round1(eff.heightMm) } })} className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-gray-300 hover:text-white">
          {d.size.lockAspectRatio ? <Lock size={13} /> : <LockOpen size={13} />} Mantener proporción
        </button>
        {isMed && <span className="text-[11px] text-gray-500">{src.kind === "none" ? "Medallón liso." : "El arte se ajusta dentro del medallón (menos el margen)."}</span>}
      </div>

      <div className="flex flex-col gap-2">
        <SubLabel>Profundidad</SubLabel>
        <NumberField label={depthLabel} value={d.depthMm} onChange={(v) => set({ depthMm: v })} suffix="mm" error={err("depthMm")} />
        <NumberField label="Suavizado de borde (bevel)" value={d.edgeBevelMm} onChange={(v) => set({ edgeBevelMm: v })} suffix="mm" error={err("edgeBevelMm")} />
        <span className="text-[11px] text-gray-500">0 mm = borde recto. El bevel es una rampa hacia adentro de la silueta.</span>
      </div>

      {isMed && (
        <div className="flex flex-col gap-2">
          <SubLabel>Medallón</SubLabel>
          <SegmentedControl options={SHAPE_OPTIONS} value={d.medallion.shape} compact onChange={(shape) => set({ medallion: { ...d.medallion, shape } })} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Espesor base" value={d.medallion.baseDepthMm} onChange={(v) => set({ medallion: { ...d.medallion, baseDepthMm: v } })} suffix="mm" error={err("baseDepthMm")} />
            <NumberField label="Margen del arte" value={d.medallion.paddingMm} onChange={(v) => set({ medallion: { ...d.medallion, paddingMm: v } })} suffix="mm" error={err("paddingMm")} />
          </div>
          {d.medallion.shape === "rounded-rect" && <NumberField label="Radio de esquina" value={d.medallion.cornerRadiusMm ?? DEFAULT_MEDALLION.cornerRadiusMm} onChange={(v) => set({ medallion: { ...d.medallion, cornerRadiusMm: v } })} suffix="mm" error={err("cornerRadiusMm")} />}
        </div>
      )}

      {issues.map((i, k) => (
        <div key={`${i.code}-${k}`} className={`flex items-start gap-2 text-xs ${i.code.startsWith("DECO_NEAR") || i.code === "DECO_OVER_HANDLE" || i.code === "DECO_ART_MISSING" ? "text-amber-300" : "text-red-300"}`}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{i.message.replace(/^[^:]*: /, "")}</span>
        </div>
      ))}
    </div>
  );
}
