"use client";

import React, { useMemo } from "react";
import { ExternalLink, Lock, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import { EmptyState } from "@/components/ui/empty-state";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import {
  ACCESS_LEVEL_LABELS,
  CHANNEL_TYPE_LABELS,
  getPlatform,
  openLabel,
  type CommunityKind,
  type CommunityLink,
} from "@/lib/community/links";
import { CommunityIcon } from "./community-icon";

/** Tarjeta de un enlace. `preview` la muestra tal como se vería, pero sin navegar (vista previa del Admin). */
export function CommunityLinkCard({ link, preview = false }: { link: CommunityLink; preview?: boolean }) {
  const platform = getPlatform(link.platform);
  const locked = link.locked || !link.url;

  return (
    <Card className={`flex flex-col justify-between border p-6 transition-shadow ${locked ? "" : "hover:shadow-md"}`}>
      <div>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${platform.tone} ${locked ? "opacity-60" : ""}`}>
            <CommunityIcon link={link} size={24} />
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {link.kind === "channel" && link.channelType && <Badge tone="gray">{CHANNEL_TYPE_LABELS[link.channelType]}</Badge>}
            {link.accessLevel !== "public" && (
              <Badge tone={link.accessLevel === "premium" ? "orange" : "dark"}>
                {link.accessLevel === "premium" && <Lock size={11} aria-hidden="true" />}
                {ACCESS_LEVEL_LABELS[link.accessLevel]}
              </Badge>
            )}
          </div>
        </div>
        <h3 className="mb-1 text-lg font-bold text-fg">{link.name}</h3>
        {link.description && <p className="mb-6 text-sm text-gray-500">{link.description}</p>}
        {!link.description && <div className="mb-6" />}
      </div>

      {locked ? (
        <div className="rounded-xl border border-dashed border-stampa-border bg-fg/5 p-3 text-center">
          <p className="flex items-center justify-center gap-2 text-sm font-semibold text-fg">
            <Lock size={14} aria-hidden="true" /> Exclusivo para miembros {link.accessLevel === "premium" ? "Premium" : "registrados"}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {link.accessLevel === "premium"
              ? "Activá tu membresía para sumarte a este canal."
              : "Iniciá sesión para sumarte a este canal."}
          </p>
        </div>
      ) : preview ? (
        <span
          aria-disabled="true"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-stampa-orange px-4 py-2.5 text-sm font-semibold text-neutral-950 opacity-90"
        >
          {openLabel(link)}
        </span>
      ) : (
        <PrimaryButton href={link.url ?? undefined} target="_blank" rel="noopener noreferrer" className="w-full justify-center">
          {openLabel(link)} <ExternalLink size={14} aria-hidden="true" />
        </PrimaryButton>
      )}
    </Card>
  );
}

export function CommunityLinksGrid({ links, preview = false }: { links: CommunityLink[]; preview?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {links.map((link) => (
        <CommunityLinkCard key={link.id} link={link} preview={preview} />
      ))}
    </div>
  );
}

interface CommunityLinksViewProps {
  links: CommunityLink[];
  kind: CommunityKind;
  route: string;
  title: string;
  intro: string;
  emptyTitle: string;
  emptyHint: string;
  /** Si la lectura falló (no si simplemente no hay enlaces) se avisa en vez de mostrar "no hay nada". */
  loadFailed?: boolean;
}

/** Pantalla /redes y /canales: lista los enlaces que el Admin configuró y el usuario puede ver. */
export function CommunityLinksView({ links, kind, route, title, intro, emptyTitle, emptyHint, loadFailed = false }: CommunityLinksViewProps) {
  const entityType = kind === "social" ? "social_network" : "community_channel";

  // El contexto de Stampy nunca incluye URLs: solo qué se ve y si está disponible para el usuario.
  const stampyScreenContext = useMemo<StampyScreenContext>(
    () => ({
      page: { section: "community", route, title },
      mode: "browse",
      visibleEntities: links.map((link, index) => ({
        type: entityType,
        id: link.id,
        name: link.name,
        position: index + 1,
        facts: [{ label: link.locked ? "Estado visible" : "Enlace disponible", value: link.locked ? "Bloqueado" : true }],
      })),
      pageData: { kind: "pageFacts", facts: [{ label: kind === "social" ? "Redes visibles" : "Canales visibles", value: links.length }] },
    }),
    [links, route, title, kind, entityType],
  );
  usePublishStampyScreenContext(stampyScreenContext);

  return (
    <div className="max-w-5xl pb-12">
      <SectionTitle eyebrow="Comunidad" title={title} />
      <p className="-mt-3 mb-8 text-sm text-gray-500">{intro}</p>

      {loadFailed ? (
        <p role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          No pudimos cargar los enlaces ahora. Probá de nuevo en unos minutos.
        </p>
      ) : links.length === 0 ? (
        <EmptyState icon={Users} title={emptyTitle} hint={emptyHint} />
      ) : (
        <CommunityLinksGrid links={links} />
      )}
    </div>
  );
}
