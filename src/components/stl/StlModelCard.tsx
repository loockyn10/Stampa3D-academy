import React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ModelPreviewCardMedia } from "@/components/stl/ModelPreviewCardMedia";
import { StlDifficultyBadge } from "@/components/stl/StlDifficultyBadge";

export interface StlModelCardData {
  id: string;
  title: string;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  difficulty?: string | null;
  material_type?: string | null;
  estimated_print_time?: string | null;
  hasFile: boolean;
}

/**
 * Card liviana: media 4:3 (thumbnail / preview 360° prerenderizado / placeholder en el mismo marco) + pie compacto
 * (nombre, material/tiempo en una línea y CTA). El viewer 3D vive exclusivamente en el detalle.
 */
export function StlModelCard({ model, href, groupLabel }: { model: StlModelCardData; href: string; groupLabel?: string }) {
  const material = model.material_type?.trim() || null;
  const time = model.estimated_print_time?.trim() || null;
  return (
    <Link href={href} className="group block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange">
      <Card className="flex h-full flex-col overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface transition-all group-hover:border-stampa-orange/30 group-hover:shadow-[0_0_20px_rgba(255,106,0,0.05)]">
        <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-stampa-border bg-stampa-bg-soft">
          <ModelPreviewCardMedia id={model.id} title={model.title} thumbnailUrl={model.thumbnail_url} previewUrl={model.preview_url} />
          <div className="pointer-events-none absolute right-2 top-2 z-10 flex flex-col items-end gap-1.5">
            <StlDifficultyBadge difficulty={model.difficulty} />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 px-3.5 py-3">
          {groupLabel && (
            <p className="-mb-1 truncate text-[10px] font-bold uppercase tracking-wider text-stampa-accent">{groupLabel}</p>
          )}
          <h3 className="line-clamp-2 break-words text-[15px] font-bold leading-snug text-fg">{model.title}</h3>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {(material || time) && (
              <p className="flex min-w-0 items-center gap-1.5 text-xs text-gray-400">
                {material && (
                  <span className="truncate" title="Material">
                    <span className="sr-only">Material: </span>
                    <span className="font-bold text-fg">{material}</span>
                  </span>
                )}
                {material && time && <span aria-hidden="true">·</span>}
                {time && (
                  <span className="truncate" title="Tiempo de impresión">
                    <span className="sr-only">Tiempo de impresión: </span>
                    <span className="font-bold text-fg">{time}</span>
                  </span>
                )}
              </p>
            )}
            <span className="ml-auto py-0.5 text-xs font-bold text-stampa-accent">
              {model.hasFile ? "Ver modelo 3D" : "Ver detalle"} <span aria-hidden="true">→</span>
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
