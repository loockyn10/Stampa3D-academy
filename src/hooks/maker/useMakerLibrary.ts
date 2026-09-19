"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { DEFAULT_LETTER_SIGN_PARAMS } from "@/lib/maker/defaults";
import { DEFAULT_PNG_OPTIONS } from "@/lib/maker/import/types";
import type { FileDesignSource } from "@/lib/maker/import/importDesign";
import type { LetterSignParams } from "@/lib/maker/types";
import {
  createPreset,
  deletePreset,
  deleteProject,
  downloadProjectSource,
  fetchProject,
  listPresets,
  listProjects,
  renamePreset,
  renameProject,
  saveProject,
  setDefaultPreset,
  toUserMessage,
  updatePresetSettings,
  type PresetRow,
  type ProjectSummary,
} from "@/lib/maker/persistence/makerRepository";
import {
  applyPresetSettings,
  extractPresetSettings,
  isPresetModified,
  resolveInitialParams,
} from "@/lib/maker/presets/presetSettings";
import {
  MIME_BY_KIND,
  isProjectDirty,
  projectSignature,
  serializeProject,
  type LoadedProject,
  type ProjectWorkState,
} from "@/lib/maker/projects/projectData";

export interface CurrentProject {
  id: string;
  name: string;
  storagePath: string | null;
}

interface Options {
  work: ProjectWorkState;
  file: FileDesignSource | null;
  /** Aplica params (receta de un preset o defaults) sin tocar el origen del diseño. */
  onParams: (params: LetterSignParams) => void;
  /** Reemplaza todo el trabajo (abrir proyecto). `file` ya está procesado a bytes/texto: el motor lo re-importa. */
  onLoadWork: (loaded: LoadedProject, file: FileDesignSource | null) => void;
  /** Vuelve a un trabajo en blanco con estos params. */
  onResetWork: (params: LetterSignParams) => void;
}

function fileToBlob(file: FileDesignSource): Blob {
  return file.type === "svg"
    ? new Blob([file.content], { type: MIME_BY_KIND.svg })
    : new Blob([file.bytes as BlobPart], { type: MIME_BY_KIND.png });
}

/**
 * Presets (receta reutilizable) y proyectos (trabajo concreto) del usuario.
 * Estrictamente separados: un proyecto solo REFERENCIA el preset usado y
 * puede divergir de él sin modificarlo. Toda operación expone loading y
 * reporta éxito/error con mensajes comprensibles (nunca errores SQL crudos).
 */
export function useMakerLibrary({ work, file, onParams, onLoadWork, onResetWork }: Options) {
  const [supabase] = useState(() => createClient());
  const { toast, confirmAction, promptForValue } = useAppFeedback();

  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preset" | "project" | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [project, setProject] = useState<CurrentProject | null>(null);
  const [baselineSignature, setBaselineSignature] = useState<string | null>(null);
  // Archivo tal como quedó guardado/cargado (identidad de objeto): distinto => hay que subirlo y el proyecto está modificado.
  const [savedFile, setSavedFile] = useState<FileDesignSource | null>(null);

  const workRef = useRef(work);
  useEffect(() => {
    workRef.current = work;
  });

  const activePreset = useMemo(() => presets.find((p) => p.id === activePresetId) ?? null, [presets, activePresetId]);
  const presetModified = activePreset ? isPresetModified(work.params, activePreset.settings, activePreset.schemaVersion) : false;

  // Línea base de "sin cambios": firma del trabajo recién creado/cargado/guardado.
  const rebaseline = useCallback((state: ProjectWorkState, presetId: string | null) => {
    setBaselineSignature(projectSignature(state, presetId));
  }, []);

  // Carga inicial: presets + preset predeterminado (si existe, se aplica automáticamente).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await listPresets(supabase);
        if (!active) return;
        setPresets(rows);
        const def = rows.find((r) => r.isDefault) ?? null;
        const current = workRef.current;
        if (def) {
          const params = applyPresetSettings(current.params, def.settings, def.schemaVersion);
          onParams(params);
          setActivePresetId(def.id);
          rebaseline({ ...current, params }, def.id);
        } else {
          rebaseline(current, null);
        }
      } catch (err) {
        if (!active) return;
        rebaseline(workRef.current, null);
        toast.error(toUserMessage(err, "No se pudieron cargar tus presets."));
      } finally {
        if (active) setPresetsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = useMemo(() => {
    if (baselineSignature === null) return false;
    const changed = isProjectDirty(work, activePresetId, baselineSignature);
    const fileChanged = work.sourceMode === "file" && !!project && file !== savedFile;
    return changed || fileChanged;
  }, [work, activePresetId, baselineSignature, file, project, savedFile]);

  const run = useCallback(
    async <T,>(kind: "preset" | "project", okMessage: string | null, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(kind);
      try {
        const result = await fn();
        if (okMessage) toast.success(okMessage);
        return result;
      } catch (err) {
        toast.error(toUserMessage(err));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const refreshPresets = useCallback(async () => {
    const rows = await listPresets(supabase);
    setPresets(rows);
    return rows;
  }, [supabase]);

  // ------------------------------ Presets ------------------------------

  const applyPreset = useCallback(
    (id: string | null) => {
      setActivePresetId(id);
      if (id === null) {
        // Sin preset: vuelve a la receta por defecto de Stampa (el diseño no cambia).
        onParams(applyPresetSettings(workRef.current.params, {}));
        return;
      }
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;
      onParams(applyPresetSettings(workRef.current.params, preset.settings, preset.schemaVersion));
    },
    [presets, onParams],
  );

  const saveAsNewPreset = useCallback(
    async (suggested = "") => {
      const name = await promptForValue({ title: "Nuevo preset", label: "Nombre del preset", initialValue: suggested, placeholder: "Ej: Perforado 5mm", confirmLabel: "Guardar" });
      if (!name?.trim()) return;
      await run("preset", "Preset guardado.", async () => {
        const created = await createPreset(supabase, name, extractPresetSettings(workRef.current.params));
        await refreshPresets();
        setActivePresetId(created.id);
      });
    },
    [promptForValue, run, supabase, refreshPresets],
  );

  const updateActivePreset = useCallback(async () => {
    if (!activePreset) return;
    const ok = await confirmAction({
      title: "Actualizar preset",
      description: `Se sobrescribirá la receta de "${activePreset.name}" con la configuración actual. Los proyectos que lo usan no cambian.`,
      confirmLabel: "Actualizar",
    });
    if (!ok) return;
    await run("preset", "Preset actualizado.", async () => {
      await updatePresetSettings(supabase, activePreset.id, extractPresetSettings(workRef.current.params));
      await refreshPresets();
    });
  }, [activePreset, confirmAction, run, supabase, refreshPresets]);

  const renameActivePreset = useCallback(async () => {
    if (!activePreset) return;
    const name = await promptForValue({ title: "Renombrar preset", label: "Nombre", initialValue: activePreset.name, confirmLabel: "Renombrar" });
    if (!name?.trim() || name.trim() === activePreset.name) return;
    await run("preset", "Preset renombrado.", async () => {
      await renamePreset(supabase, activePreset.id, name);
      await refreshPresets();
    });
  }, [activePreset, promptForValue, run, supabase, refreshPresets]);

  const duplicateActivePreset = useCallback(async () => {
    if (!activePreset) return;
    const name = await promptForValue({ title: "Duplicar preset", label: "Nombre de la copia", initialValue: `${activePreset.name} (copia)`, confirmLabel: "Duplicar" });
    if (!name?.trim()) return;
    await run("preset", "Preset duplicado.", async () => {
      const created = await createPreset(supabase, name, activePreset.settings);
      await refreshPresets();
      setActivePresetId(created.id);
    });
  }, [activePreset, promptForValue, run, supabase, refreshPresets]);

  const deleteActivePreset = useCallback(async () => {
    if (!activePreset) return;
    const ok = await confirmAction({
      title: "Eliminar preset",
      description: `Se eliminará "${activePreset.name}". Tus proyectos conservan su configuración.`,
      confirmLabel: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    await run("preset", "Preset eliminado.", async () => {
      await deletePreset(supabase, activePreset.id);
      setActivePresetId(null);
      await refreshPresets();
    });
  }, [activePreset, confirmAction, run, supabase, refreshPresets]);

  const toggleDefaultPreset = useCallback(async () => {
    if (!activePreset) return;
    await run("preset", activePreset.isDefault ? "Ya no es el predeterminado." : "Preset predeterminado actualizado.", async () => {
      await setDefaultPreset(supabase, activePreset.isDefault ? null : activePreset.id);
      await refreshPresets();
    });
  }, [activePreset, run, supabase, refreshPresets]);

  // ------------------------------ Projects ------------------------------

  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirmAction({
      title: "Cambios sin guardar",
      description: "Tenés cambios sin guardar en el trabajo actual. Si continuás, se van a perder.",
      confirmLabel: "Descartar cambios",
      destructive: true,
    });
  }, [dirty, confirmAction]);

  const newProject = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    const def = presets.find((p) => p.isDefault) ?? null;
    const params = resolveInitialParams(def?.settings, def?.schemaVersion);
    onResetWork(params);
    setProject(null);
    setSavedFile(null);
    setActivePresetId(def?.id ?? null);
    rebaseline(
      { params, sourceMode: "text", designHeightMm: DEFAULT_LETTER_SIGN_PARAMS.heightMm, pngOptions: { ...DEFAULT_PNG_OPTIONS }, fileMeta: null },
      def?.id ?? null,
    );
  }, [confirmDiscard, presets, onResetWork, rebaseline]);

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      setProjects(await listProjects(supabase));
    } catch (err) {
      toast.error(toUserMessage(err, "No se pudieron cargar tus proyectos."));
    } finally {
      setProjectsLoading(false);
    }
  }, [supabase, toast]);

  const openProject = useCallback(
    async (id: string) => {
      if (!(await confirmDiscard())) return false;
      const ok = await run("project", null, async () => {
        const record = await fetchProject(supabase, id);
        const loaded = record.project;
        let loadedFile: FileDesignSource | null = null;
        if (loaded.fileRef) {
          const blob = await downloadProjectSource(supabase, loaded.fileRef.storagePath);
          const name = loaded.fileRef.originalFilename;
          loadedFile = loaded.fileRef.mimeType === MIME_BY_KIND.svg || name.toLowerCase().endsWith(".svg")
            ? { type: "svg", fileName: name, content: await blob.text() }
            : { type: "png", fileName: name, bytes: new Uint8Array(await blob.arrayBuffer()) };
        }
        setSavedFile(loadedFile);
        onLoadWork(loaded, loadedFile);
        setProject({ id: record.id, name: record.name, storagePath: loaded.fileRef?.storagePath ?? null });
        setActivePresetId(loaded.presetId && presets.some((p) => p.id === loaded.presetId) ? loaded.presetId : null);
        rebaseline(
          {
            params: loaded.params,
            sourceMode: loaded.sourceMode,
            designHeightMm: loaded.designHeightMm,
            pngOptions: loaded.pngOptions,
            fileMeta: loaded.fileRef
              ? { kind: loaded.fileRef.mimeType === MIME_BY_KIND.svg ? "svg" : "png", fileName: loaded.fileRef.originalFilename, sizeBytes: loaded.fileRef.sizeBytes }
              : null,
          },
          loaded.presetId && presets.some((p) => p.id === loaded.presetId) ? loaded.presetId : null,
        );
        return true;
      });
      if (ok) toast.success("Proyecto abierto.");
      return ok === true;
    },
    [confirmDiscard, run, supabase, onLoadWork, presets, rebaseline, toast],
  );

  const persist = useCallback(
    async (target: { id: string; isNew: boolean; name: string; storagePath: string | null }) => {
      const current = workRef.current;
      const payload = serializeProject(current, { presetId: activePresetId });
      const needsUpload = current.sourceMode === "file" && !!file && (target.isNew || file !== savedFile);
      const result = await saveProject(supabase, {
        id: target.id,
        isNew: target.isNew,
        name: target.name,
        payload,
        upload: needsUpload && file ? { kind: file.type, blob: fileToBlob(file) } : null,
        previousStoragePath: target.storagePath,
      });
      setSavedFile(current.sourceMode === "file" ? file : null);
      setProject({ id: target.id, name: target.name.trim(), storagePath: result.storagePath });
      rebaseline(current, activePresetId);
    },
    [activePresetId, file, savedFile, supabase, rebaseline],
  );

  const saveAsNewProject = useCallback(async () => {
    const name = await promptForValue({ title: "Guardar proyecto", label: "Nombre del proyecto", initialValue: project ? `${project.name} (copia)` : "", placeholder: "Ej: Cartel Barbería", confirmLabel: "Guardar" });
    if (!name?.trim()) return;
    await run("project", "Proyecto guardado.", () => persist({ id: crypto.randomUUID(), isNew: true, name, storagePath: null }));
  }, [promptForValue, project, run, persist]);

  const saveCurrentProject = useCallback(async () => {
    if (!project) return saveAsNewProject();
    await run("project", "Proyecto guardado.", () => persist({ id: project.id, isNew: false, name: project.name, storagePath: project.storagePath }));
  }, [project, saveAsNewProject, run, persist]);

  const renameCurrentProject = useCallback(async () => {
    if (!project) return;
    const name = await promptForValue({ title: "Renombrar proyecto", label: "Nombre", initialValue: project.name, confirmLabel: "Renombrar" });
    if (!name?.trim() || name.trim() === project.name) return;
    await run("project", "Proyecto renombrado.", async () => {
      await renameProject(supabase, project.id, name);
      setProject({ ...project, name: name.trim() });
    });
  }, [project, promptForValue, run, supabase]);

  const deleteCurrentProject = useCallback(async () => {
    if (!project) return;
    const ok = await confirmAction({
      title: "Eliminar proyecto",
      description: `Se eliminará "${project.name}" y su archivo de origen. Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    await run("project", "Proyecto eliminado.", async () => {
      await deleteProject(supabase, project.id, project.storagePath);
      setProject(null);
      setSavedFile(null);
      // El trabajo en pantalla queda como proyecto sin guardar.
      setBaselineSignature("deleted");
    });
  }, [project, confirmAction, run, supabase]);

  return {
    presets,
    presetsLoading,
    activePreset,
    activePresetId,
    presetModified,
    busy,
    projects,
    projectsLoading,
    project,
    dirty,
    applyPreset,
    saveAsNewPreset,
    updateActivePreset,
    renameActivePreset,
    duplicateActivePreset,
    deleteActivePreset,
    toggleDefaultPreset,
    newProject,
    refreshProjects,
    openProject,
    saveCurrentProject,
    saveAsNewProject,
    renameCurrentProject,
    deleteCurrentProject,
  };
}
