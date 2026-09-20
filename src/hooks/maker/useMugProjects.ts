"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAppFeedback } from "@/components/ui/app-feedback";
import {
  MakerPersistenceError,
  currentUserId,
  deleteProject,
  downloadProjectSource,
  fetchProjectRow,
  listProjects,
  removeProjectAssets,
  saveProject,
  toUserMessage,
  uploadProjectAsset,
  type ProjectSummary,
} from "@/lib/maker/persistence/makerRepository";
import { referencedAssetIds } from "@/lib/maker/mugs/decorations/decorationDefaults";
import type { MugAsset } from "@/lib/maker/mugs/decorations/artworkProvider";
import { deserializeMugProject, mugAssetPath, mugProjectSignature, readMugAssetRefs, serializeMugProject, type MugAssetRef } from "@/lib/maker/mugs/projects/mugProjectData";
import { MIME_BY_KIND } from "@/lib/maker/projects/projectData";
import type { MugDefinition } from "@/lib/maker/mugs/types";

interface Options {
  def: MugDefinition;
  /** Archivos originales de las decoraciones (por assetId). */
  assets: ReadonlyMap<string, MugAsset>;
  /** Reemplaza la definición y los assets actuales por los de un proyecto abierto. */
  onLoad: (def: MugDefinition, assets: MugAsset[]) => void;
  /** Vuelve a la definición inicial (sin assets) y la devuelve (es la nueva línea base de "sin cambios"). */
  onReset: () => MugDefinition;
}

function assetBlob(asset: MugAsset): Blob {
  return asset.kind === "svg" ? new Blob([asset.content], { type: MIME_BY_KIND.svg }) : new Blob([asset.bytes as BlobPart], { type: MIME_BY_KIND[asset.format] });
}
const kindOf = (a: MugAsset): MugAssetRef["kind"] => (a.kind === "svg" ? "svg" : a.format);

/**
 * Proyectos de Jarros 3D: guardar/abrir/eliminar la MugDefinition. Las decoraciones guardan solo referencias
 * (`assetId`); los archivos originales (SVG/PNG/JPG) van a Storage privado (`{user}/{project}/assets/{id}.{ext}`) y al
 * abrir se descargan para reconstruir el campo con el motor vigente (nunca se persiste el raster/SDF procesado). Un
 * `assetId` es inmutable: se sube una sola vez por proyecto. Reusa `maker_projects` con `source_type = "mug"`.
 */
export function useMugProjects({ def, assets, onLoad, onReset }: Options) {
  const [supabase] = useState(() => createClient());
  const { toast, confirmAction, promptForValue } = useAppFeedback();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const [baseline, setBaseline] = useState<string>(() => mugProjectSignature(def));
  /** Assets ya subidos, por proyecto: `${projectId}:${assetId}` -> ref. */
  const uploaded = useRef(new Map<string, MugAssetRef>());

  const dirty = useMemo(() => mugProjectSignature(def) !== baseline, [def, baseline]);

  const run = useCallback(
    async <T,>(okMessage: string | null, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await fn();
        if (okMessage) toast.success(okMessage);
        return result;
      } catch (err) {
        toast.error(toUserMessage(err));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const refresh = useCallback(async () => {
    setProjectsLoading(true);
    try {
      setProjects(await listProjects(supabase, "mug"));
    } catch (err) {
      toast.error(toUserMessage(err, "No se pudieron cargar tus proyectos."));
    } finally {
      setProjectsLoading(false);
    }
  }, [supabase, toast]);

  const persist = useCallback(
    async (target: { id: string; isNew: boolean; name: string }) => {
      const needed = referencedAssetIds(def.decorations);
      const refs: MugAssetRef[] = [];
      let userId: string | null = null;
      for (const assetId of needed) {
        const asset = assets.get(assetId);
        const key = `${target.id}:${assetId}`;
        const known = uploaded.current.get(key);
        if (known) {
          refs.push(known);
          continue;
        }
        if (!asset) throw new MakerPersistenceError("Falta el archivo de una decoración: volvé a cargarlo antes de guardar.");
        userId ??= await currentUserId(supabase);
        const kind = kindOf(asset);
        const blob = assetBlob(asset);
        const storagePath = mugAssetPath(userId, target.id, assetId, kind);
        await uploadProjectAsset(supabase, storagePath, blob);
        const ref: MugAssetRef = { assetId, kind, fileName: asset.fileName, mimeType: blob.type, sizeBytes: blob.size, storagePath };
        uploaded.current.set(key, ref);
        refs.push(ref);
      }
      await saveProject(supabase, { id: target.id, isNew: target.isNew, name: target.name, payload: serializeMugProject(def, refs), upload: null, previousStoragePath: null });
      // Limpieza best-effort de assets que ya no usa ninguna decoración.
      const stale = [...uploaded.current.entries()].filter(([k, r]) => k.startsWith(`${target.id}:`) && !needed.includes(r.assetId));
      if (stale.length > 0) {
        await removeProjectAssets(supabase, stale.map(([, r]) => r.storagePath));
        for (const [k] of stale) uploaded.current.delete(k);
      }
      setProject({ id: target.id, name: target.name.trim() });
      setBaseline(mugProjectSignature(def));
      await refresh();
    },
    [def, assets, supabase, refresh],
  );

  const saveAs = useCallback(async () => {
    const name = await promptForValue({ title: "Guardar proyecto", label: "Nombre del proyecto", initialValue: project?.name ?? "", placeholder: "Ej: Jarro vikingo", confirmLabel: "Guardar" });
    if (!name?.trim()) return;
    await run("Proyecto guardado.", () => persist({ id: crypto.randomUUID(), isNew: true, name }));
  }, [promptForValue, project, run, persist]);

  const save = useCallback(async () => {
    if (!project) return saveAs();
    await run("Proyecto guardado.", () => persist({ id: project.id, isNew: false, name: project.name }));
  }, [project, saveAs, run, persist]);

  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirmAction({ title: "Cambios sin guardar", description: "Tenés cambios sin guardar en el trabajo actual. Si continuás, se van a perder.", confirmLabel: "Descartar cambios", destructive: true });
  }, [dirty, confirmAction]);

  const open = useCallback(
    async (id: string) => {
      if (!(await confirmDiscard())) return false;
      const ok = await run("Proyecto abierto.", async () => {
        const record = await fetchProjectRow(supabase, id);
        let loaded: MugDefinition;
        try {
          loaded = deserializeMugProject(record.row);
        } catch (err) {
          throw new MakerPersistenceError(err instanceof Error ? err.message : "El proyecto está dañado.");
        }
        // Se descargan los ORIGINALES y el motor vigente reconstruye los campos (no se guardó el raster/SDF).
        const refs = new Map(readMugAssetRefs(record.row).map((r) => [r.assetId, r]));
        const loadedAssets: MugAsset[] = [];
        let missing = 0;
        for (const assetId of referencedAssetIds(loaded.decorations)) {
          const ref = refs.get(assetId);
          if (!ref) { missing++; continue; }
          try {
            const blob = await downloadProjectSource(supabase, ref.storagePath);
            loadedAssets.push(ref.kind === "svg" ? { id: assetId, kind: "svg", fileName: ref.fileName, content: await blob.text() } : { id: assetId, kind: "raster", format: ref.kind, fileName: ref.fileName, bytes: new Uint8Array(await blob.arrayBuffer()) });
            uploaded.current.set(`${record.id}:${assetId}`, ref);
          } catch {
            missing++;
          }
        }
        if (missing > 0) toast.error(`No se pudieron recuperar ${missing} archivo(s) de decoraciones; esas decoraciones se omiten.`);
        onLoad(loaded, loadedAssets);
        setProject({ id: record.id, name: record.name });
        setBaseline(mugProjectSignature(loaded));
        return true;
      });
      return ok === true;
    },
    [confirmDiscard, run, supabase, onLoad, toast],
  );

  const newProject = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    const blank = onReset();
    setProject(null);
    setBaseline(mugProjectSignature(blank));
  }, [confirmDiscard, onReset]);

  const remove = useCallback(
    async (summary: ProjectSummary) => {
      const ok = await confirmAction({ title: "Eliminar proyecto", description: `Se eliminará "${summary.name}" y sus archivos de decoraciones. No se puede deshacer.`, confirmLabel: "Eliminar", destructive: true });
      if (!ok) return;
      await run("Proyecto eliminado.", async () => {
        const paths = readMugAssetRefs((await fetchProjectRow(supabase, summary.id)).row).map((r) => r.storagePath);
        await deleteProject(supabase, summary.id, null);
        await removeProjectAssets(supabase, paths);
        for (const k of [...uploaded.current.keys()]) if (k.startsWith(`${summary.id}:`)) uploaded.current.delete(k);
        if (project?.id === summary.id) setProject(null);
        await refresh();
      });
    },
    [confirmAction, run, supabase, project, refresh],
  );

  return { projects, projectsLoading, busy, project, dirty, refresh, save, saveAs, open, newProject, remove };
}
