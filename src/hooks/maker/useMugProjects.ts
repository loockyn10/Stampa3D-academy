"use client";

import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { MakerPersistenceError, deleteProject, fetchProjectRow, listProjects, saveProject, toUserMessage, type ProjectSummary } from "@/lib/maker/persistence/makerRepository";
import { deserializeMugProject, mugProjectSignature, serializeMugProject } from "@/lib/maker/mugs/projects/mugProjectData";
import type { MugDefinition } from "@/lib/maker/mugs/types";

interface Options {
  def: MugDefinition;
  /** Reemplaza la definición actual por la de un proyecto abierto. */
  onLoad: (def: MugDefinition) => void;
  /** Vuelve a la definición inicial y la devuelve (es la nueva línea base de "sin cambios"). */
  onReset: () => MugDefinition;
}

/**
 * Proyectos de Jarros 3D: guardar/abrir/eliminar la MugDefinition. Sin Storage (no hay archivos de origen): reusa el
 * repositorio de Maker con `source_type = "mug"`, que Carteles y Neon nunca listan.
 */
export function useMugProjects({ def, onLoad, onReset }: Options) {
  const [supabase] = useState(() => createClient());
  const { toast, confirmAction, promptForValue } = useAppFeedback();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const [baseline, setBaseline] = useState<string>(() => mugProjectSignature(def));

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
      await saveProject(supabase, { id: target.id, isNew: target.isNew, name: target.name, payload: serializeMugProject(def), upload: null, previousStoragePath: null });
      setProject({ id: target.id, name: target.name.trim() });
      setBaseline(mugProjectSignature(def));
      await refresh();
    },
    [def, supabase, refresh],
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
        onLoad(loaded);
        setProject({ id: record.id, name: record.name });
        setBaseline(mugProjectSignature(loaded));
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
    setBaseline(mugProjectSignature(blank));
  }, [confirmDiscard, onReset]);

  const remove = useCallback(
    async (summary: ProjectSummary) => {
      const ok = await confirmAction({ title: "Eliminar proyecto", description: `Se eliminará "${summary.name}". No se puede deshacer.`, confirmLabel: "Eliminar", destructive: true });
      if (!ok) return;
      await run("Proyecto eliminado.", async () => {
        await deleteProject(supabase, summary.id, null);
        if (project?.id === summary.id) setProject(null);
        await refresh();
      });
    },
    [confirmAction, run, supabase, project, refresh],
  );

  return { projects, projectsLoading, busy, project, dirty, refresh, save, saveAs, open, newProject, remove };
}
