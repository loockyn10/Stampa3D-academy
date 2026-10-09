import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface StlCrumb {
  label: string;
  href?: string;
}

export function StlBreadcrumb({ items }: { items: StlCrumb[] }) {
  return (
    <nav aria-label="Ruta" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-semibold text-gray-500">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {item.href && !isLast ? (
                <Link href={item.href} className="truncate transition-colors hover:text-stampa-orange">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} className={`truncate ${isLast ? "text-stampa-text-soft" : ""}`}>
                  {item.label}
                </span>
              )}
              {!isLast && <ChevronRight size={12} className="shrink-0" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
