"use client";

import React, { useState } from "react";
import { Copy, FilePlus, FolderOpen, Loader2, Pencil, Plus, Save, Star, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CalculatorSelect } from "@/components/ui/calculator-select";
import { Dialog } from "@/components/ui/dialog";
import type { useMakerLibrary } from "@/hooks/maker/useMakerLibrary";

type Library = ReturnType<typeof useMakerLibrary>;

function IconButton({
  label,
  onClick,
  disabled,
  children,
  active = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-stampa-orange/40 bg-stampa-orange/15 text-stampa-orange"
          : "border-white/10 bg-white/[0.04] text-gray-400 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

const NO_PRESET = "__none__";

/** Presets (receta reutilizable) y proyectos (trabajo concreto), arriba del panel de configuración. */
export function MakerLibraryPanel({ library }: { library: Library }) {
  const [openDialog, setOpenDialog] = useState(false);
  const busy = library.busy !== null;
  const { activePreset, project } = library;

  const presetOptions = [
    { value: NO_PRESET, label: "Sin preset (valores de Stampa)" },
    ...library.presets.map((p) => ({ value: p.id, label: p.isDefault ? `★ ${p.name}` : p.name })),
  ];

  const openProjects = () => {
    setOpenDialog(true);
    void library.refreshProjects();
  };

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-500">Preset</span>
          {(library.presetsLoading || library.busy === "preset") && <Loader2 size={13} className="animate-spin text-gray-500" />}
        </div>
        <CalculatorSelect
          options={presetOptions}
          value={library.activePresetId ?? NO_PRESET}
          onChange={(v) => library.applyPreset(v === NO_PRESET ? null : v)}
          disabled={library.presetsLoading || busy}
          usePortal
        />
        {activePreset && (
          <span className={`text-xs ${library.presetModified ? "text-amber-300" : "text-gray-500"}`}>
            {activePreset.name}
            {library.presetModified ? " • Modificado" : ""}
            {activePreset.isDefault ? " · Predeterminado" : ""}
          </span>
        )}
        <div className="flex flex-wrap gap-1.5">
          {activePreset ? (
            <IconButton label="Actualizar preset con la configuración actual" onClick={library.updateActivePreset} disabled={busy || !library.presetModified}>
              <Save size={15} />
            </IconButton>
          ) : null}
          <IconButton label="Guardar como preset nuevo" onClick={() => library.saveAsNewPreset()} disabled={busy}>
            <Plus size={15} />
          </IconButton>
          {activePreset && (
            <>
              <IconButton label="Renombrar preset" onClick={library.renameActivePreset} disabled={busy}>
                <Pencil size={15} />
              </IconButton>
              <IconButton label="Duplicar preset" onClick={library.duplicateActivePreset} disabled={busy}>
                <Copy size={15} />
              </IconButton>
              <IconButton
                label={activePreset.isDefault ? "Quitar como predeterminado" : "Establecer como predeterminado"}
                onClick={library.toggleDefaultPreset}
                disabled={busy}
                active={activePreset.isDefault}
              >
                <Star size={15} />
              </IconButton>
              <IconButton label="Eliminar preset" onClick={library.deleteActivePreset} disabled={busy}>
                <Trash2 size={15} />
              </IconButton>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-500">Proyecto</span>
          {library.busy === "project" && <Loader2 size={13} className="animate-spin text-gray-500" />}
        </div>
        <div className="truncate text-sm text-white">
          {project ? project.name : <span className="text-gray-500">Sin guardar</span>}
          {library.dirty && <span className="ml-1.5 text-xs text-amber-300">• Modificado</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <IconButton label="Nuevo proyecto" onClick={library.newProject} disabled={busy}>
            <FilePlus size={15} />
          </IconButton>
          <IconButton label="Abrir proyecto" onClick={openProjects} disabled={busy}>
            <FolderOpen size={15} />
          </IconButton>
          <IconButton label="Guardar proyecto" onClick={library.saveCurrentProject} disabled={busy || (!!project && !library.dirty)}>
            <Save size={15} />
          </IconButton>
          <IconButton label="Guardar como..." onClick={library.saveAsNewProject} disabled={busy}>
            <Copy size={15} />
          </IconButton>
          {project && (
            <>
              <IconButton label="Renombrar proyecto" onClick={library.renameCurrentProject} disabled={busy}>
                <Pencil size={15} />
              </IconButton>
              <IconButton label="Eliminar proyecto" onClick={library.deleteCurrentProject} disabled={busy}>
                <Trash2 size={15} />
              </IconButton>
            </>
          )}
        </div>
      </div>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} labelledBy="maker-open-project-title" panelClassName="max-w-md rounded-2xl border border-stampa-border bg-stampa-surface">
        <div className="p-5">
          <h2 id="maker-open-project-title" className="text-lg font-bold text-white">
            Abrir proyecto
          </h2>
          <div className="mt-3 flex max-h-80 flex-col gap-1.5 overflow-y-auto">
            {library.projectsLoading && (
              <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
                <Loader2 size={15} className="animate-spin" /> Cargando proyectos…
              </div>
            )}
            {!library.projectsLoading && library.projects.length === 0 && (
              <p className="py-4 text-sm text-gray-400">Todavía no guardaste ningún proyecto.</p>
            )}
            {library.projects.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={async () => {
                  // Se cierra antes: el diálogo de confirmación (cambios sin guardar) debe quedar por encima.
                  setOpenDialog(false);
                  await library.openProject(p.id);
                }}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-white/10 disabled:opacity-50 ${
                  p.id === project?.id ? "border-stampa-orange/40 bg-stampa-orange/10" : "border-white/10 bg-white/[0.04]"
                }`}
              >
                <span className="truncate text-sm font-semibold text-white">{p.name}</span>
                <span className="shrink-0 text-[11px] uppercase text-gray-500">{p.sourceType}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => setOpenDialog(false)} className="rounded-xl border border-stampa-border px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-white/10">
              Cerrar
            </button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
