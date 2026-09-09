"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Package, Printer, Warehouse } from "lucide-react";

const WORKSHOP_SECTIONS = [
  { href: "/mi-taller/impresoras", label: "Impresoras", icon: Printer },
  { href: "/mi-taller/filamentos", label: "Filamentos", icon: Boxes },
  { href: "/mi-taller/productos", label: "Productos", icon: Package },
  { href: "/mi-taller/inventario", label: "Inventario", icon: Warehouse },
] as const;

export function WorkshopNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Secciones de Mi Taller"
      className="mb-6 overflow-x-auto border-b border-stampa-border hide-scrollbar"
    >
      <div className="flex min-w-max">
        {WORKSHOP_SECTIONS.map((section) => {
          const Icon = section.icon;
          const active = pathname === section.href || pathname.startsWith(`${section.href}/`);

          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-12 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors sm:px-5 ${
                active
                  ? "border-stampa-orange text-stampa-orange"
                  : "border-transparent text-gray-500 hover:border-white/20 hover:text-gray-300"
              }`}
            >
              <Icon size={16} />
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
