"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useAppFeedback } from "@/components/ui/app-feedback";
import {
  loadFeatureFlagsAdminAction,
  setFeatureFlagAction,
  type FeatureFlagAdminRow,
  type FeatureFlagsAdminResult,
} from "@/app/admin/funcionalidades/actions";
import { FEATURE_REGISTRY, type FeatureDefinition, type FeatureGroup, type FeatureId } from "@/lib/features/registry";

const GROUP_LABELS: Record<FeatureGroup, string> = {
  plataforma: "Plataforma",
  areas: "Áreas",
  comunidad: "Comunidad",
};
const GROUP_ORDER: FeatureGroup[] = ["plataforma", "areas", "comunidad"];

type RowMap = Partial<Record<FeatureId, FeatureFlagAdminRow>>;

function toRowMap(rows: FeatureFlagAdminRow[]): RowMap {
  return Object.fromEntries(rows.map((row) => [row.featureId, row]));
}

function effectiveEnabled(feature: FeatureDefinition, row: FeatureFlagAdminRow | undefined): boolean {
  return typeof row?.enabled === "boolean" ? row.enabled : feature.defaultEnabled;
}

const dateFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

export function FeatureFlagsManager({ initial }: { initial: FeatureFlagsAdminResult }) {
  const { toast, confirmAction } = useAppFeedback();
  const [result, setResult] = useState<FeatureFlagsAdminResult>(initial);
  const [rows, setRows] = useState<RowMap>(initial.success ? toRowMap(initial.rows) : {});
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<FeatureId | null>(null);
  const [saved, setSaved] = useState<FeatureId | null>(null);
  const [rowError, setRowError] = useState<{ featureId: FeatureId; message: string } | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await loadFeatureFlagsAdminAction();
      setResult(next);
      if (next.success) setRows(toRowMap(next.rows));
    } catch {
      setResult({ success: false, code: "load_failed", error: "No pudimos cargar la configuración. Probá de nuevo." });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const toggle = useCallback(
    async (feature: FeatureDefinition) => {
      if (saving) return;
      const next = !effectiveEnabled(feature, rows[feature.id]);

      if (!next) {
        const confirmed = await confirmAction({
          title: `¿Deshabilitar ${feature.name}?`,
          description: `Los usuarios dejarán de ver y de poder usar ${feature.name}. Los administradores conservan el acceso y los datos de los usuarios no se modifican. Podés volver a habilitarla cuando quieras.`,
          confirmLabel: "Deshabilitar",
          destructive: true,
        });
        if (!confirmed) return;
      }

      setSaving(feature.id);
      setRowError(null);
      try {
        const response = await setFeatureFlagAction({ featureId: feature.id, enabled: next });
        if (!response.success) {
          setRowError({ featureId: feature.id, message: response.error });
          toast.error(response.error);
          return;
        }
        setRows((current) => ({ ...current, [feature.id]: response.row }));
        setSaved(feature.id);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(null), 2500);
        toast.success(`${feature.name} ${next ? "habilitada" : "deshabilitada"} para los usuarios.`);
      } catch {
        const message = "No pudimos guardar el cambio. Revisá tu conexión y probá de nuevo.";
        setRowError({ featureId: feature.id, message });
        toast.error(message);
      } finally {
        setSaving(null);
      }
    },
    [saving, rows, confirmAction, toast],
  );

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        features: FEATURE_REGISTRY.filter((feature) => feature.group === group),
      })).filter((entry) => entry.features.length > 0),
    [],
  );

  const enabledCount = FEATURE_REGISTRY.filter((feature) => effectiveEnabled(feature, rows[feature.id])).length;
  const editable = result.success;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-2xl border border-stampa-orange/25 bg-stampa-orange/[0.07] p-4 text-sm text-orange-100">
        <ShieldCheck size={20} className="mt-0.5 shrink-0 text-stampa-orange" aria-hidden="true" />
        <p>
          Los <strong>administradores siempre tienen acceso</strong> a todas las herramientas, estén habilitadas o no. Los cambios
          se aplican en segundos, sin nuevo despliegue, y no modifican los datos de los usuarios. Para probar la vista pública usá una
          cuenta que no sea administradora.
        </p>
      </div>

      {!result.success && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-red-200">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            {result.error}
          </p>
          {result.code !== "forbidden" && (
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-400/40 px-4 text-sm font-semibold text-red-100 hover:bg-red-500/10 disabled:opacity-60"
            >
              {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Reintentar
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400" aria-live="polite">
          <span className="font-bold text-white">{enabledCount}</span> de {FEATURE_REGISTRY.length} herramientas habilitadas para los usuarios
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stampa-border px-3 text-xs font-semibold text-gray-300 hover:bg-white/5 disabled:opacity-60"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Actualizar
        </button>
      </div>

      {grouped.map(({ group, features }) => (
        <section key={group} aria-labelledby={`feature-group-${group}`}>
          <h2 id={`feature-group-${group}`} className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">
            {GROUP_LABELS[group]}
          </h2>
          <ul className="divide-y divide-stampa-border overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface">
            {features.map((feature) => {
              const row = rows[feature.id];
              const enabled = effectiveEnabled(feature, row);
              const configured = typeof row?.enabled === "boolean";
              const isSaving = saving === feature.id;
              const error = rowError?.featureId === feature.id ? rowError.message : null;
              const labelId = `feature-label-${feature.id}`;
              return (
                <li key={feature.id} className="flex items-start gap-4 p-4 sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 id={labelId} className="text-sm font-bold text-white">{feature.name}</h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          !enabled
                            ? "border-red-500/30 bg-red-500/10 text-red-300"
                            : configured
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                              : "border-stampa-border bg-white/5 text-gray-400"
                        }`}
                      >
                        {!enabled ? "Deshabilitada" : configured ? "Habilitada" : "Sin configurar · habilitada"}
                      </span>
                      {saved === feature.id && (
                        <span role="status" className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                          <Check size={12} aria-hidden="true" /> Guardado
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-400">{feature.description}</p>
                    {feature.adminNote && <p className="mt-1 text-[11px] text-gray-500">{feature.adminNote}</p>}
                    {row?.updatedAt && (
                      <p className="mt-1 text-[11px] text-gray-600">Última modificación: {dateFormat.format(new Date(row.updatedAt))}</p>
                    )}
                    {error && (
                      <p role="alert" className="mt-1 text-xs font-semibold text-red-400">{error}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-labelledby={labelId}
                    disabled={!editable || isSaving || (saving !== null && !isSaving)}
                    onClick={() => toggle(feature)}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange focus-visible:ring-offset-2 focus-visible:ring-offset-stampa-surface disabled:cursor-not-allowed disabled:opacity-50 ${
                      enabled ? "border-stampa-orange bg-stampa-orange" : "border-stampa-border bg-white/10"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${
                        enabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    >
                      {isSaving && <Loader2 size={12} className="animate-spin text-stampa-orange" aria-hidden="true" />}
                    </span>
                    <span className="sr-only">{isSaving ? "Guardando" : enabled ? "Habilitada" : "Deshabilitada"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
