import React from "react";
import Link from "next/link";
import { Boxes } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StlDifficultyBadge } from "@/components/stl/StlDifficultyBadge";

export interface StlModelCardData {
  id: string;
  title: string;
  thumbnail_url?: string | null;
  difficulty?: string | null;
  material_type?: string | null;
  estimated_print_time?: string | null;
  hasFile: boolean;
}

/** Card estática: solo thumbnail. El viewer 3D vive exclusivamente en el detalle. */
export function StlModelCard({ model, href, groupLabel }: { model: StlModelCardData; href: string; groupLabel?: string }) {
  return (
    <Link href={href} className="group block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange">
      <Card className="flex h-full flex-col overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface transition-all group-hover:border-stampa-orange/30 group-hover:shadow-[0_0_20px_rgba(255,106,0,0.05)]">
        <div className="relative flex h-48 items-center justify-center overflow-hidden border-b border-stampa-border bg-stampa-bg-soft">
          {model.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={model.thumbnail_url} alt={model.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <Boxes size={48} className="text-gray-600" />
          )}
          <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
            <StlDifficultyBadge difficulty={model.difficulty} />
          </div>
        </div>
        <div className="flex flex-1 flex-col p-5">
          {groupLabel && (
            <p className="mb-1.5 truncate text-[10px] font-bold uppercase tracking-wider text-stampa-orange">{groupLabel}</p>
          )}
          <h3 className="mb-3 line-clamp-2 text-base font-bold leading-snug text-white">{model.title}</h3>
          <div className="mt-auto grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-stampa-border bg-stampa-bg-soft p-2">
              <span className="mb-0.5 block text-[10px] font-medium text-gray-500">Material</span>
              <span className="block truncate text-xs font-bold text-white">{model.material_type || "-"}</span>
            </div>
            <div className="rounded-lg border border-stampa-border bg-stampa-bg-soft p-2">
              <span className="mb-0.5 block text-[10px] font-medium text-gray-500">Tiempo Imp.</span>
              <span className="block truncate text-xs font-bold text-white">{model.estimated_print_time || "-"}</span>
            </div>
          </div>
          <p className="mt-4 text-center text-xs font-bold text-stampa-orange">
            {model.hasFile ? "Ver modelo 3D" : "Ver detalle"}
          </p>
        </div>
      </Card>
    </Link>
  );
}
