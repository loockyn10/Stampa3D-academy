"use client";

import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAppFeedback } from "@/components/ui/app-feedback";
import {
  MakerPersistenceError,
  deleteProject,
  downloadProjectSource,
  fetchProjectRow,
  listProjects,
  saveProject,
  toUserMessage,
  type ProjectSummary,
} from "@/lib/maker/persistence/makerRepository";
import {
  deserializeNeonProject,
  neonProjectSignature,
  serializeNeonProject,
  type LoadedNeonProject,
  type NeonFileKind,
  type NeonWorkState,
} from "@/lib/maker/neon/projects/neonProjectData";
import { MIME_BY_KIND } from "@/lib/maker/projects/projectData";

/** Archivo de origen cargado en la página (SVG como texto; PNG/JPEG como bytes). Se sube a Storage privado al guardar. */
export type NeonFileSource =
  | { kind: "svg"; fileName: string; content: string }
  | { kind: "png" | "jpg"; fileName: string; bytes: Uint8Array };

export interface CurrentNeonProject {
  id: string;
  name: string;
  storagePath: string | null;
}

interface Options {
  work: NeonWorkState;
  file: NeonFileSource | null;
  /** Reemplaza todo el trabajo con un proyecto abierto (el archivo ya viene descargado: el motor lo reprocesa). */
  onLoad: (loaded: LoadedNeonProject, file: NeonFileSource | null) => void;
  /** Vuelve a un trabajo en blanco y devuelve ese estado (es la nueva línea base de "sin cambios"). */
  onReset: () => NeonWorkState;
}

function toBlob(file: NeonFileSource): Blob {
  return file.kind === "svg" ? new Blob([file.content], { type: MIME_BY_KIND.svg }) : new Blob([file.bytes as BlobPart], { type: MIME_BY_KIND[file.kind] });
}

function sniffKind(name: string, mime: string): NeonFileKind {
  if (mime === MIME_BY_KIND.svg || /\.svg$/i.test(name)) return "svg";
  if (mime === MIME_BY_KIND.jpg || /\.jpe?g$/i.test(name)) return "jpg";
  return "png";
}

/**
 * Proyectos de Neon LED: guardar/abrir/eliminar el trabajo actual. Guarda el ORIGEN (texto, o el archivo en Storage
 * privado) más la receta de conversión; al abrir descarga el original y repite el pipeline. Reusa el repositorio de
 * Maker (tabla `maker_projects`, prefijo "neon-" en source_type) y sus mensajes de error comprensibles.
 */
export function useNeonProjects({ work, file, onLoad, onReset }: Options) {
  const [supabase] = useState(() => createClient());
  const { toast, confirmAction, promptForValue } = useAppFeedback();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState<CurrentNeonProject | null>(null);
  const [baseline, setBaseline] = useState<string | null>(() => neonProjectSignature(work));
  // Archivo tal como quedó guardado/abierto (identidad de objeto): distinto => hay que volver a subirlo.
  const [savedFile, setSavedFile] = useState<NeonFileSource | null>(null);

  const dirty = useMemo(() => {
    if (baseline === null) return false;
    return neonProjectSignature(work) !== baseline || (!!project && work.sourceType !== "text" && file !== savedFile);
  }, [work, baseline, project, file, savedFile]);

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
      setProjects(await listProjects(supabase, "neon"));
    } catch (err) {
      toast.error(toUserMessage(err, "No se pudieron cargar tus proyectos."));
    } finally {
      setProjectsLoading(false);
    }
  }, [supabase, toast]);

  const persist = useCallback(
    async (target: { id: string; isNew: boolean; name: string; storagePath: string | null }) => {
      const payload = serializeNeonProject(work);
      const needsUpload = payload.source_type !== "neon-text" && !!file && (target.isNew || file !== savedFile);
      if (payload.source_type !== "neon-text" && !file && !target.storagePath) throw new MakerPersistenceError("Falta el archivo de origen del proyecto.");
      const { storagePath } = await saveProject(supabase, {
        id: target.id,
        isNew: target.isNew,
        name: target.name,
        payload,
        upload: needsUpload && file ? { kind: file.kind, blob: toBlob(file) } : null,
        previousStoragePath: target.storagePath,
      });
      setProject({ id: target.id, name: target.name.trim(), storagePath });
      setSavedFile(file);
      setBaseline(neonProjectSignature(work));
      await refresh();
    },
    [work, file, savedFile, supabase, refresh],
  );

  const saveAs = useCallback(async () => {
    const name = await promptForValue({ title: "Guardar proyecto", label: "Nombre del proyecto", initialValue: project?.name ?? "", placeholder: "Ej: Cartel Bar", confirmLabel: "Guardar" });
    if (!name?.trim()) return;
    await run("Proyecto guardado.", () => persist({ id: crypto.randomUUID(), isNew: true, name, storagePath: null }));
  }, [promptForValue, project, run, persist]);

  const save = useCallback(async () => {
    if (!project) return saveAs();
    await run("Proyecto guardado.", () => persist({ id: project.id, isNew: false, name: project.name, storagePath: project.storagePath }));
  }, [project, saveAs, run, persist]);

  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirmAction({
      title: "Cambios sin guardar",
      description: "Tenés cambios sin guardar en el trabajo actual. Si continuás, se van a perder.",
      confirmLabel: "Descartar cambios",
      destructive: true,
    });
  }, [dirty, confirmAction]);

  const open = useCallback(
    async (id: string) => {
      if (!(await confirmDiscard())) return false;
      const ok = await run("Proyecto abierto.", async () => {
        const record = await fetchProjectRow(supabase, id);
        let loaded: LoadedNeonProject;
        try {
          loaded = deserializeNeonProject(record.row);
        } catch (err) {
          throw new MakerPersistenceError(err instanceof Error ? err.message : "El proyecto está dañado.");
        }
        let loadedFile: NeonFileSource | null = null;
        if (loaded.fileRef) {
          // Se descarga el ORIGINAL y el motor vigente repite el pipeline (no se guardó el skeleton).
          const blob = await downloadProjectSource(supabase, loaded.fileRef.storagePath);
          const kind = sniffKind(loaded.fileRef.originalFilename, loaded.fileRef.mimeType);
          loadedFile =
            kind === "svg"
              ? { kind, fileName: loaded.fileRef.originalFilename, content: await blob.text() }
              : { kind, fileName: loaded.fileRef.originalFilename, bytes: new Uint8Array(await blob.arrayBuffer()) };
        }
        setSavedFile(loadedFile);
        onLoad(loaded, loadedFile);
        setProject({ id: record.id, name: record.name, storagePath: loaded.fileRef?.storagePath ?? null });
        setBaseline(
          neonProjectSignature({
            params: loaded.params,
            sourceType: loaded.sourceType,
            text: loaded.text,
            fontId: loaded.fontId,
            letterSpacingPct: loaded.letterSpacingPct,
            raster: loaded.raster,
            fileMeta: loaded.fileRef ? { kind: loaded.fileRef.kind, fileName: loaded.fileRef.originalFilename, sizeBytes: loaded.fileRef.sizeBytes } : null,
            installationRecipe: loaded.installationRecipe,
            installationOverrides: loaded.installationOverrides,
          }),
        );
        return true;
      });
      return ok === true;
    },
    [confirmDiscard, run, supabase, onLoad],
  );

  const newProject = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    const blank = onReset();
    setProject(null);
    setSavedFile(null);
    setBaseline(neonProjectSignature(blank));
  }, [confirmDiscard, onReset]);

  const remove = useCallback(
    async (summary: ProjectSummary) => {
      const ok = await confirmAction({
        title: "Eliminar proyecto",
        description: `Se eliminará "${summary.name}" y su archivo de origen. No se puede deshacer.`,
        confirmLabel: "Eliminar",
        destructive: true,
      });
      if (!ok) return;
      await run("Proyecto eliminado.", async () => {
        const storagePath = project?.id === summary.id ? project.storagePath : ((await fetchProjectRow(supabase, summary.id)).row.source_data as { storagePath?: string })?.storagePath ?? null;
        await deleteProject(supabase, summary.id, storagePath);
        if (project?.id === summary.id) setProject(null);
        await refresh();
      });
    },
    [confirmAction, run, supabase, project, refresh],
  );

  return { projects, projectsLoading, busy, project, dirty, refresh, save, saveAs, open, newProject, remove };
}
