import React from "react";
import Link from "next/link";
import { Boxes, FolderOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { groupHref, type StlGroupSummary } from "@/lib/stl/library";

export function StlGroupCard({ group }: { group: StlGroupSummary }) {
  return (
    <Link
      href={groupHref({ id: group.id, slug: group.slug })}
      className="group block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange"
    >
      <Card className="flex h-full flex-col overflow-hidden rounded-2xl border border-stampa-border bg-stampa-surface transition-all group-hover:border-stampa-orange/30 group-hover:shadow-[0_0_20px_rgba(255,106,0,0.05)]">
        <div className="relative flex h-40 items-center justify-center overflow-hidden border-b border-stampa-border bg-stampa-bg-soft sm:h-44">
          {group.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.thumbnailUrl} alt={group.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <FolderOpen size={44} className="text-gray-600" />
          )}
        </div>
        <div className="flex flex-1 flex-col p-5">
          <h3 className="mb-1 line-clamp-2 text-base font-bold leading-snug text-white transition-colors group-hover:text-orange-100">
            {group.name}
          </h3>
          {group.description && (
            <p className="mb-3 line-clamp-2 text-xs text-gray-400">{group.description}</p>
          )}
          <div className="mt-auto flex items-center justify-between gap-3 pt-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-400">
              <Boxes size={14} />
              {group.modelCount} {group.modelCount === 1 ? "modelo" : "modelos"}
            </span>
            <span className="text-xs font-bold text-stampa-orange">Ver grupo →</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
