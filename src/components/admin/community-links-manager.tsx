"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { Dialog } from "@/components/ui/dialog";
import { CalculatorSelect } from "@/components/ui/calculator-select";
import { CommunityIcon, IconByKey } from "@/components/community/community-icon";
import { CommunityLinksGrid } from "@/components/community/community-links-view";
import {
  createCommunityLinkAction,
  deleteCommunityLinkAction,
  loadCommunityLinksAdminAction,
  reorderCommunityLinksAction,
  setCommunityLinkActiveAction,
  updateCommunityLinkAction,
  type CommunityLinksAdminResult,
} from "@/app/admin/redes-canales/actions";
import {
  ACCESS_LEVELS,
  ACCESS_LEVEL_HINTS,
  ACCESS_LEVEL_LABELS,
  AUDIENCES,
  AUDIENCE_LABELS,
  CHANNEL_TYPES,
  CHANNEL_TYPE_LABELS,
  COMMUNITY_ICON_KEYS,
  COMMUNITY_ICON_LABELS,
  DESCRIPTION_MAX,
  NAME_MAX,
  getPlatform,
  linkHost,
  moveId,
  normalizeCommunityLinkInput,
  platformsForKind,
  previewForAudience,
  sortCommunityLinks,
  validateCommunityUrl,
  type AccessLevel,
  type Audience,
  type ChannelType,
  type CommunityIconKey,
  type CommunityKind,
  type CommunityLinkAdmin,
  type CommunityLinkField,
} from "@/lib/community/links";

const INPUT_CLASS =
  "min-h-11 w-full rounded-xl border border-stampa-border bg-stampa-surface px-3 text-sm text-fg outline-none focus:border-stampa-orange focus:ring-1 focus:ring-stampa-orange";

const KIND_TABS: { kind: CommunityKind; label: string; singular: string; empty: string }[] = [
  { kind: "social", label: "Redes sociales", singular: "red social", empty: "Todavía no cargaste ninguna red social." },
  { kind: "channel", label: "Canales y comunidades", singular: "canal", empty: "Todavía no cargaste ningún canal." },
];

const dateFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

type FieldErrors = Partial<Record<CommunityLinkField, string>>;

interface FormState {
  platform: string;
  name: string;
  channelType: ChannelType;
  description: string;
  url: string;
  iconKey: CommunityIconKey | "";
  accessLevel: AccessLevel;
  isActive: boolean;
}

function emptyForm(kind: CommunityKind): FormState {
  const platform = platformsForKind(kind)[0];
  return {
    platform: platform.id,
    name: platform.label,
    channelType: "group",
    description: "",
    url: "",
    iconKey: "",
    accessLevel: "public",
    isActive: true,
  };
}

function formFromLink(link: CommunityLinkAdmin): FormState {
  return {
    platform: link.platform,
    name: link.name,
    channelType: link.channelType ?? "group",
    description: link.description ?? "",
    url: link.url,
    iconKey: (link.iconKey as CommunityIconKey | null) ?? "",
    accessLevel: link.accessLevel,
    isActive: link.isActive,
  };
}

function Switch({ checked, onChange, disabled, labelledBy, busy }: { checked: boolean; onChange: () => void; disabled?: boolean; labelledBy: string; busy?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange focus-visible:ring-offset-2 focus-visible:ring-offset-stampa-surface disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "border-stampa-orange bg-stampa-orange" : "border-stampa-border bg-fg/10"
      }`}
    >
      <span className={`flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}>
        {busy && <Loader2 size={12} className="animate-spin text-stampa-accent" aria-hidden="true" />}
      </span>
    </button>
  );
}

function VisibilityBadge({ link }: { link: CommunityLinkAdmin }) {
  if (!link.isActive) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-stampa-border bg-fg/5 px-2 py-0.5 text-[11px] font-semibold text-gray-400">
        <EyeOff size={11} aria-hidden="true" /> Oculto
      </span>
    );
  }
  const tone =
    link.accessLevel === "premium"
      ? "border-stampa-orange/30 bg-stampa-orange/10 text-stampa-accent"
      : link.accessLevel === "registered"
        ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  const Icon = link.accessLevel === "premium" ? Lock : Eye;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      <Icon size={11} aria-hidden="true" /> {ACCESS_LEVEL_LABELS[link.accessLevel]}
    </span>
  );
}

export function CommunityLinksManager({ initial }: { initial: CommunityLinksAdminResult }) {
  const { toast, confirmAction } = useAppFeedback();
  const [result, setResult] = useState<CommunityLinksAdminResult>(initial);
  const [links, setLinks] = useState<CommunityLinkAdmin[]>(initial.success ? sortCommunityLinks(initial.links) : []);
  const [tab, setTab] = useState<CommunityKind>("social");
  const [audience, setAudience] = useState<Audience>("premium");
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; link: CommunityLinkAdmin } | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await loadCommunityLinksAdminAction();
      setResult(next);
      if (next.success) setLinks(sortCommunityLinks(next.links));
    } catch {
      setResult({ success: false, code: "load_failed", error: "No pudimos cargar los enlaces. Probá de nuevo." });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const tabLinks = useMemo(() => links.filter((link) => link.kind === tab), [links, tab]);
  const counts = useMemo(
    () => ({
      social: links.filter((link) => link.kind === "social").length,
      channel: links.filter((link) => link.kind === "channel").length,
    }),
    [links],
  );
  const editable = result.success;
  const tabMeta = KIND_TABS.find((entry) => entry.kind === tab) ?? KIND_TABS[0];

  const upsert = useCallback((saved: CommunityLinkAdmin) => {
    setLinks((current) => sortCommunityLinks([...current.filter((link) => link.id !== saved.id), saved]));
  }, []);

  const toggleActive = useCallback(
    async (link: CommunityLinkAdmin) => {
      if (busyId || reordering) return;
      setBusyId(link.id);
      try {
        const response = await setCommunityLinkActiveAction(link.id, !link.isActive);
        if (!response.success) {
          toast.error(response.error);
          return;
        }
        upsert(response.link);
        toast.success(`${link.name} ${response.link.isActive ? "visible" : "oculto"} para los usuarios.`);
      } catch {
        toast.error("No pudimos guardar el cambio. Revisá tu conexión y probá de nuevo.");
      } finally {
        setBusyId(null);
      }
    },
    [busyId, reordering, toast, upsert],
  );

  const remove = useCallback(
    async (link: CommunityLinkAdmin) => {
      if (busyId || reordering) return;
      const confirmed = await confirmAction({
        title: `¿Eliminar ${link.name}?`,
        description: "El enlace deja de mostrarse en toda la plataforma y no se puede recuperar. Si solo querés ocultarlo por un tiempo, desactivalo en lugar de eliminarlo.",
        confirmLabel: "Eliminar",
        destructive: true,
      });
      if (!confirmed) return;
      setBusyId(link.id);
      try {
        const response = await deleteCommunityLinkAction(link.id);
        if (!response.success) {
          toast.error(response.error);
          return;
        }
        setLinks((current) => current.filter((item) => item.id !== link.id));
        toast.success(`${link.name} eliminado.`);
      } catch {
        toast.error("No pudimos eliminar el enlace. Revisá tu conexión y probá de nuevo.");
      } finally {
        setBusyId(null);
      }
    },
    [busyId, reordering, confirmAction, toast],
  );

  const move = useCallback(
    async (link: CommunityLinkAdmin, direction: "up" | "down") => {
      if (busyId || reordering) return;
      const ids = tabLinks.map((item) => item.id);
      const nextIds = moveId(ids, link.id, direction);
      if (nextIds.every((id, index) => id === ids[index])) return;

      const previous = links;
      const positions = new Map(nextIds.map((id, index) => [id, index]));
      setLinks((current) =>
        sortCommunityLinks(current.map((item) => (positions.has(item.id) ? { ...item, sortOrder: positions.get(item.id) as number } : item))),
      );
      setReordering(true);
      try {
        const response = await reorderCommunityLinksAction(link.kind, nextIds);
        if (!response.success) {
          setLinks(previous);
          toast.error(response.error);
        }
      } catch {
        setLinks(previous);
        toast.error("No pudimos guardar el nuevo orden. Revisá tu conexión y probá de nuevo.");
      } finally {
        setReordering(false);
      }
    },
    [busyId, reordering, tabLinks, links, toast],
  );

  const preview = useMemo(
    () => previewForAudience(links, tab === "social" ? "anonymous" : audience).filter((link) => link.kind === tab),
    [links, tab, audience],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-2xl border border-stampa-orange/25 bg-stampa-orange/[0.07] p-4 text-sm text-orange-100">
        <ShieldCheck size={20} className="mt-0.5 shrink-0 text-stampa-accent" aria-hidden="true" />
        <p>
          Todo lo que cargues acá es lo que ven los usuarios en <strong>Redes</strong>, <strong>Canales</strong> y el pie de la
          página pública. Los enlaces de canales <strong>Premium</strong> solo se entregan a quienes tienen acceso: al resto se le
          muestra una tarjeta bloqueada, sin el enlace. Solo se aceptan URLs <strong>https</strong>.
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

      <div role="tablist" aria-label="Tipo de enlace" className="flex gap-1 rounded-2xl border border-stampa-border bg-stampa-surface p-1">
        {KIND_TABS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            role="tab"
            id={`community-tab-${entry.kind}`}
            aria-selected={tab === entry.kind}
            aria-controls="community-tabpanel"
            onClick={() => setTab(entry.kind)}
            className={`min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold transition-colors ${
              tab === entry.kind ? "bg-stampa-orange text-neutral-950" : "text-gray-400 hover:bg-fg/5 hover:text-fg"
            }`}
          >
            {entry.label} <span className="opacity-70">({counts[entry.kind]})</span>
          </button>
        ))}
      </div>

      <section id="community-tabpanel" role="tabpanel" aria-labelledby={`community-tab-${tab}`} className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-400" aria-live="polite">
            <span className="font-bold text-fg">{tabLinks.filter((link) => link.isActive).length}</span> de {tabLinks.length} visibles para los usuarios
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Actualizar listado"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stampa-border px-3 text-xs font-semibold text-gray-300 hover:bg-fg/5 disabled:opacity-60"
            >
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              <span className="hidden sm:inline">Actualizar</span>
            </button>
            <button
              type="button"
              onClick={() => setDialog({ mode: "create" })}
              disabled={!editable}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-stampa-orange px-4 text-sm font-semibold text-neutral-950 hover:bg-stampa-orange-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16} aria-hidden="true" /> Agregar
            </button>
          </div>
        </div>

        {tabLinks.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-stampa-border px-6 py-12 text-center">
            <Users size={22} className="mb-3 text-stampa-accent" aria-hidden="true" />
            <p className="text-sm font-semibold text-fg">{tabMeta.empty}</p>
            <p className="mt-1 text-xs text-gray-500">Usá «Agregar» para cargar la primera.</p>
          </div>
        ) : (
          <ul className="divide-y divide-stampa-border overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface">
            {tabLinks.map((link, index) => {
              const platform = getPlatform(link.platform);
              const labelId = `community-link-${link.id}`;
              const busy = busyId === link.id;
              const locked = !editable || busyId !== null || reordering;
              return (
                <li key={link.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${link.isActive ? "" : "opacity-70"}`}>
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${platform.tone}`}>
                      <CommunityIcon link={link} size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 id={labelId} className="text-sm font-bold text-fg">{link.name}</h3>
                        <VisibilityBadge link={link} />
                        {link.channelType && (
                          <span className="rounded-full border border-stampa-border bg-fg/5 px-2 py-0.5 text-[11px] font-semibold text-gray-400">
                            {CHANNEL_TYPE_LABELS[link.channelType]}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-400" title={link.url}>
                        {platform.label} · {linkHost(link.url) ?? link.url}
                      </p>
                      {link.description && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{link.description}</p>}
                      {link.updatedAt && <p className="mt-1 text-[11px] text-gray-600">Modificado: {dateFormat.format(new Date(link.updatedAt))}</p>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => move(link, "up")}
                        disabled={locked || index === 0}
                        aria-label={`Subir ${link.name}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stampa-border text-gray-300 hover:bg-fg/5 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ArrowUp size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(link, "down")}
                        disabled={locked || index === tabLinks.length - 1}
                        aria-label={`Bajar ${link.name}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stampa-border text-gray-300 hover:bg-fg/5 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ArrowDown size={16} aria-hidden="true" />
                      </button>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Probar el enlace de ${link.name}`}
                        title="Probar el enlace"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stampa-border text-gray-300 hover:bg-fg/5"
                      >
                        <ExternalLink size={16} aria-hidden="true" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setDialog({ mode: "edit", link })}
                        disabled={locked}
                        aria-label={`Editar ${link.name}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stampa-border text-gray-300 hover:bg-fg/5 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(link)}
                        disabled={locked}
                        aria-label={`Eliminar ${link.name}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-gray-500">{link.isActive ? "Activo" : "Inactivo"}</span>
                      <Switch checked={link.isActive} onChange={() => toggleActive(link)} disabled={locked} busy={busy} labelledBy={labelId} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-3 pt-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Vista previa</h2>
            {tab === "channel" && (
              <div role="group" aria-label="Ver como" className="flex gap-1 rounded-xl border border-stampa-border bg-stampa-surface p-1">
                {AUDIENCES.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    aria-pressed={audience === entry}
                    onClick={() => setAudience(entry)}
                    className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-semibold sm:flex-none ${
                      audience === entry ? "bg-fg/10 text-fg" : "text-gray-400 hover:text-fg"
                    }`}
                  >
                    {AUDIENCE_LABELS[entry]}
                  </button>
                ))}
              </div>
            )}
          </div>
          {preview.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-stampa-border p-6 text-center text-xs text-gray-500">
              {tab === "channel" && audience !== "premium"
                ? "Esta audiencia no ve ningún canal activo."
                : "Cuando haya enlaces activos vas a ver acá cómo aparecen para los usuarios."}
            </p>
          ) : (
            <CommunityLinksGrid links={preview} preview />
          )}
        </div>
      </section>

      {dialog && (
        <LinkFormDialog
          key={dialog.mode === "edit" ? dialog.link.id : "new"}
          kind={dialog.mode === "edit" ? dialog.link.kind : tab}
          link={dialog.mode === "edit" ? dialog.link : null}
          onClose={closeDialog}
          onSaved={(saved, created) => {
            upsert(saved);
            closeDialog();
            toast.success(created ? `${saved.name} agregado.` : `${saved.name} actualizado.`);
          }}
        />
      )}
    </div>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-400">
        {label}
        <div className="mt-1.5">{children}</div>
      </label>
      {error ? (
        <p role="alert" className="mt-1 text-xs font-semibold text-red-400">{error}</p>
      ) : (
        hint && <p className="mt-1 text-[11px] text-gray-500">{hint}</p>
      )}
    </div>
  );
}

function LinkFormDialog({
  kind,
  link,
  onClose,
  onSaved,
}: {
  kind: CommunityKind;
  link: CommunityLinkAdmin | null;
  onClose: () => void;
  onSaved: (link: CommunityLinkAdmin, created: boolean) => void;
}) {
  const { toast } = useAppFeedback();
  const [form, setForm] = useState<FormState>(() => (link ? formFromLink(link) : emptyForm(kind)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const nameTouched = useRef(link !== null);
  const savingRef = useRef(false);
  const isChannel = kind === "channel";
  const titleId = "community-link-dialog-title";

  // Identidad estable: el Dialog reenfoca su primer campo cada vez que cambia `onClose`.
  const handleClose = useCallback(() => {
    if (!savingRef.current) onClose();
  }, [onClose]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const platformOptions = useMemo(
    () => platformsForKind(kind).map((platform) => ({ value: platform.id, label: platform.label })),
    [kind],
  );
  const iconOptions = useMemo(
    () => [
      { value: "", label: "Automático (según la plataforma)" },
      ...COMMUNITY_ICON_KEYS.map((key) => ({
        value: key,
        label: COMMUNITY_ICON_LABELS[key],
        element: (
          <span className="flex items-center gap-2">
            <IconByKey iconKey={key} size={16} /> {COMMUNITY_ICON_LABELS[key]}
          </span>
        ),
      })),
    ],
    [],
  );

  const testUrl = () => {
    const check = validateCommunityUrl(form.url);
    if (!check.ok) {
      setErrors((current) => ({ ...current, url: check.error }));
      return;
    }
    setErrors((current) => ({ ...current, url: undefined }));
    window.open(check.url, "_blank", "noopener,noreferrer");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const payload = {
      kind,
      platform: form.platform,
      name: form.name,
      channelType: isChannel ? form.channelType : null,
      description: form.description,
      url: form.url,
      iconKey: form.iconKey || null,
      accessLevel: isChannel ? form.accessLevel : "public",
      isActive: form.isActive,
    };
    const checked = normalizeCommunityLinkInput(payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }

    setSaving(true);
    savingRef.current = true;
    try {
      const response = link ? await updateCommunityLinkAction(link.id, payload) : await createCommunityLinkAction(payload);
      if (!response.success) {
        if (response.fieldErrors) setErrors(response.fieldErrors);
        toast.error(response.error);
        return;
      }
      onSaved(response.link, link === null);
    } catch {
      toast.error("No pudimos guardar el enlace. Revisá tu conexión y probá de nuevo.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const kindLabel = isChannel ? "canal" : "red social";
  const switchLabelId = "community-link-active-label";

  return (
    <Dialog open onClose={handleClose} labelledBy={titleId} panelClassName="max-w-lg rounded-2xl border border-stampa-border bg-stampa-surface">
      <form onSubmit={submit} noValidate className="p-5">
        <h2 id={titleId} className="text-lg font-black text-fg">
          {link ? `Editar ${kindLabel}` : `Agregar ${kindLabel}`}
        </h2>

        <div className="mt-4 grid gap-4">
          <Field label="Plataforma" error={errors.platform}>
            <CalculatorSelect
              options={platformOptions}
              value={form.platform}
              usePortal
              onChange={(value) => {
                setForm((current) => ({
                  ...current,
                  platform: value,
                  name: nameTouched.current ? current.name : getPlatform(value).label,
                }));
              }}
            />
          </Field>

          <Field label="Nombre visible *" error={errors.name}>
            <input
              value={form.name}
              maxLength={NAME_MAX}
              onChange={(event) => {
                nameTouched.current = true;
                set("name", event.target.value);
              }}
              className={INPUT_CLASS}
            />
          </Field>

          {isChannel && (
            <Field label="Tipo de canal *" error={errors.channelType}>
              <CalculatorSelect
                options={CHANNEL_TYPES.map((type) => ({ value: type, label: CHANNEL_TYPE_LABELS[type] }))}
                value={form.channelType}
                usePortal
                onChange={(value) => set("channelType", value as ChannelType)}
              />
            </Field>
          )}

          <Field label="URL *" error={errors.url} hint="Tiene que empezar con https://">
            <div className="flex gap-2">
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://"
                value={form.url}
                onChange={(event) => set("url", event.target.value)}
                className={INPUT_CLASS}
              />
              <button
                type="button"
                onClick={testUrl}
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-stampa-border px-3 text-xs font-semibold text-gray-300 hover:bg-fg/5"
              >
                <ExternalLink size={14} aria-hidden="true" /> Probar
              </button>
            </div>
          </Field>

          <Field label="Descripción (opcional)" error={errors.description} hint={`${form.description.length}/${DESCRIPTION_MAX}`}>
            <textarea
              rows={3}
              maxLength={DESCRIPTION_MAX}
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
              className={`${INPUT_CLASS} resize-none py-2.5`}
            />
          </Field>

          <Field label="Icono">
            <CalculatorSelect options={iconOptions} value={form.iconKey} usePortal onChange={(value) => set("iconKey", value as CommunityIconKey | "")} />
          </Field>

          {isChannel && (
            <fieldset>
              <legend className="text-xs font-semibold text-gray-400">Nivel de acceso *</legend>
              <div className="mt-1.5 grid gap-2">
                {ACCESS_LEVELS.map((level) => (
                  <label
                    key={level}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                      form.accessLevel === level ? "border-stampa-orange bg-stampa-orange/10" : "border-stampa-border hover:bg-fg/5"
                    }`}
                  >
                    <input
                      type="radio"
                      name="community-access-level"
                      value={level}
                      checked={form.accessLevel === level}
                      onChange={() => set("accessLevel", level)}
                      className="mt-1 accent-[#ff6a00]"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-fg">{ACCESS_LEVEL_LABELS[level]}</span>
                      <span className="block text-xs text-gray-500">{ACCESS_LEVEL_HINTS[level]}</span>
                    </span>
                  </label>
                ))}
              </div>
              {errors.accessLevel && <p role="alert" className="mt-1 text-xs font-semibold text-red-400">{errors.accessLevel}</p>}
            </fieldset>
          )}

          <div className="flex items-center justify-between gap-3 rounded-xl border border-stampa-border p-3">
            <div>
              <p id={switchLabelId} className="text-sm font-semibold text-fg">Visible para los usuarios</p>
              <p className="text-xs text-gray-500">Si lo desactivás, se guarda pero no se muestra en ningún lado.</p>
            </div>
            <Switch checked={form.isActive} onChange={() => set("isActive", !form.isActive)} labelledBy={switchLabelId} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-xl border border-stampa-border text-sm font-bold text-gray-300 hover:bg-fg/5 disabled:opacity-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stampa-orange text-sm font-black text-neutral-950 hover:bg-stampa-orange-hover disabled:opacity-60">
            {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} {link ? "Guardar cambios" : "Agregar"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
