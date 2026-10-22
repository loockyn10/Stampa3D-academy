"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, LayoutDashboard, Package, Printer, Warehouse, type LucideIcon } from "lucide-react";
import { WORKSHOP_SECTIONS, isWorkshopSectionActive } from "@/lib/workshop/routes";

const SECTION_ICONS: Record<string, LucideIcon> = {
  "/mi-taller": LayoutDashboard,
  "/mi-taller/inventario": Warehouse,
  "/mi-taller/productos": Package,
  "/mi-taller/filamentos": Boxes,
  "/mi-taller/impresoras": Printer,
};

export function WorkshopNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Secciones de Mi Taller"
      className="-mx-4 mb-5 overflow-x-auto border-b border-stampa-border px-4 hide-scrollbar sm:mx-0 sm:px-0"
    >
      <div className="flex min-w-max">
        {WORKSHOP_SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section.href] ?? Package;
          const active = isWorkshopSectionActive(section, pathname);

          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-12 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stampa-orange sm:px-5 ${
                active
                  ? "border-stampa-orange text-stampa-orange"
                  : "border-transparent text-gray-500 hover:border-white/20 hover:text-gray-300"
              }`}
            >
              <Icon size={16} aria-hidden="true" />
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
