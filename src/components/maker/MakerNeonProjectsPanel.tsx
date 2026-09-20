"use client";

import React from "react";
import { FolderOpen, Loader2, Save, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";
import type { useNeonProjects } from "@/hooks/maker/useNeonProjects";
import type { useMugProjects } from "@/hooks/maker/useMugProjects";

/** Proyectos de Neon LED y de Jarros 3D: guardar / guardar como / nuevo / abrir / eliminar. Solo presentación: la lógica vive en useNeonProjects. */
export function MakerNeonProjectsPanel({
  library,
  emptyText = "Todavía no guardaste proyectos Neon.",
  showType = true,
}: {
  library: ReturnType<typeof useNeonProjects> | ReturnType<typeof useMugProjects>;
  emptyText?: string;
  /** Muestra el tipo de origen junto al nombre (útil en Neon: texto/svg/png; Jarros no lo necesita). */
  showType?: boolean;
}) {
  const { projects, projectsLoading, busy, project, dirty, refresh } = library;
  const [listOpen, setListOpen] = React.useState(false);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Proyecto</span>
          <span className="block truncate text-sm font-semibold text-white">
            {project ? project.name : "Sin guardar"}
            {dirty && <span className="ml-1.5 text-xs font-normal text-amber-300">· cambios sin guardar</span>}
          </span>
        </div>
        {busy && <Loader2 size={14} className="animate-spin text-gray-400" />}
      </div>
      <div className="flex flex-wrap gap-2">
        <GhostButton type="button" onClick={library.save} disabled={busy}>
          <Save size={14} className="mr-1" />
          Guardar
        </GhostButton>
        <GhostButton type="button" onClick={library.saveAs} disabled={busy}>
          Guardar como…
        </GhostButton>
        <GhostButton type="button" onClick={library.newProject} disabled={busy}>
          Nuevo
        </GhostButton>
        <GhostButton
          type="button"
          onClick={() => {
            const next = !listOpen;
            setListOpen(next);
            if (next) void refresh();
          }}
          disabled={busy}
        >
          <FolderOpen size={14} className="mr-1" />
          Abrir
        </GhostButton>
      </div>
      {listOpen && (
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] p-1.5">
          {projectsLoading && <span className="px-2 py-1 text-xs text-gray-500">Cargando…</span>}
          {!projectsLoading && projects.length === 0 && <span className="px-2 py-1 text-xs text-gray-500">{emptyText}</span>}
          {projects.map((p) => (
            <div key={p.id} className="flex items-center gap-1">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (await library.open(p.id)) setListOpen(false);
                }}
                className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-gray-200 hover:bg-white/10"
              >
                {p.name}
                {showType && <span className="ml-2 font-normal text-gray-500">{p.sourceType.replace("neon-", "")}</span>}
              </button>
              <button type="button" disabled={busy} onClick={() => library.remove(p)} aria-label={`Eliminar ${p.name}`} className="rounded-lg p-1.5 text-gray-500 hover:bg-white/10 hover:text-red-400">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
