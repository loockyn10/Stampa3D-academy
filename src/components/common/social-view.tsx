"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { CommunityIcon } from "@/components/community/community-icon";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";
import { getPlatform, openLabel, type CommunityLink } from "@/lib/community/links";

interface SocialViewProps {
  /** Plataforma de la ruta (/instagram, /whatsapp…). */
  id: "telegram" | "whatsapp" | "youtube" | "instagram";
  /** Enlace configurado por el Admin para esa plataforma; null si no hay uno activo y visible para el usuario. */
  link: CommunityLink | null;
  loadFailed?: boolean;
}

const BACK_ROUTE: Record<SocialViewProps["id"], { href: string; label: string }> = {
  telegram: { href: "/canales", label: "Ver todos los canales" },
  whatsapp: { href: "/canales", label: "Ver todos los canales" },
  youtube: { href: "/redes", label: "Ver todas las redes" },
  instagram: { href: "/redes", label: "Ver todas las redes" },
};

export function SocialView({ id, link, loadFailed = false }: SocialViewProps) {
  const platform = getPlatform(id);
  const name = link?.name ?? platform.label;
  const unlocked = link !== null && !link.locked && link.url !== null;

  const stampyScreenContext = useMemo<StampyScreenContext>(
    () => ({
      page: { section: "community", route: `/${id}`, title: name },
      mode: "detail",
      selectedEntity: {
        type: "community_channel",
        id,
        name,
        facts: [{ label: "Enlace visible", value: unlocked }],
      },
      pageData: { kind: "pageFacts", facts: [{ label: "Canal actualmente visible", value: name }] },
    }),
    [id, name, unlocked],
  );
  usePublishStampyScreenContext(stampyScreenContext);

  const back = BACK_ROUTE[id];

  return (
    <div>
      <SectionTitle eyebrow="Comunidad" title={name} />
      <Card className="mx-auto max-w-lg p-8 text-center sm:mx-0">
        <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border ${platform.tone}`}>
          <CommunityIcon link={link ?? { iconKey: null, platform: id }} size={28} />
        </div>
        {loadFailed ? (
          <p role="alert" className="text-sm text-red-300">No pudimos cargar este enlace ahora. Probá de nuevo en unos minutos.</p>
        ) : link ? (
          <>
            <p className="text-lg font-bold text-fg">{link.name} de Academia Stampa</p>
            {link.description && <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">{link.description}</p>}
            {unlocked ? (
              <PrimaryButton href={link.url ?? undefined} target="_blank" rel="noopener noreferrer" className="mx-auto mt-5">
                {openLabel(link)} <ExternalLink size={14} aria-hidden="true" />
              </PrimaryButton>
            ) : (
              <p className="mx-auto mt-5 max-w-sm text-sm font-semibold text-fg">
                Este canal es exclusivo para miembros Premium.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-lg font-bold text-fg">{platform.label} de Academia Stampa</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">Este enlace todavía no está disponible.</p>
          </>
        )}
        <Link href={back.href} className="mt-5 inline-block text-sm font-semibold text-stampa-accent hover:underline">
          {back.label}
        </Link>
      </Card>
    </div>
  );
}
