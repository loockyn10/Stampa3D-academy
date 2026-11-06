"use client";

import Link from "next/link";
import { useFeatureVisibility } from "@/components/features/feature-flags-provider";
import { isMobileNavigationItemActive, secondaryMobileNavigation } from "./mobile-navigation";
import { usePathname } from "next/navigation";

interface MobileRadialMenuProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Menú "Más herramientas" del botón central. Antes era un arco radial: con 7 herramientas los rótulos se pisaban en
 * 320–360 px. Ahora es un panel con grilla (4 columnas, rótulos de hasta dos líneas) que nunca superpone ítems.
 * Se conserva el contrato: id `mobile-tools-menu`, role `menu` / `menuitem` y el cierre por fondo/Escape/navegación.
 */
export function MobileRadialMenu({ open, onClose }: MobileRadialMenuProps) {
  const visibility = useFeatureVisibility();
  const pathname = usePathname() ?? "/";
  const items = secondaryMobileNavigation.filter((item) => visibility.isPathVisible(item.href));

  return (
    <>
      <button
        type="button"
        aria-label="Cerrar menú de herramientas"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={`fixed inset-x-0 top-0 z-[-1] bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{ bottom: "calc(var(--mobile-bottom-navigation-height) + env(safe-area-inset-bottom))" }}
      />

      <div
        id="mobile-tools-menu"
        data-open={open}
        aria-hidden={!open}
        role="menu"
        aria-label="Herramientas secundarias"
        className={`mobile-tools-sheet absolute z-10 grid grid-cols-4 gap-1 rounded-3xl border border-stampa-border bg-stampa-surface p-2 shadow-2xl shadow-black/40 transition-[opacity,transform] duration-200 ease-out lg:hidden ${
          open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        }`}
        style={{
          left: "max(0.75rem, env(safe-area-inset-left))",
          right: "max(0.75rem, env(safe-area-inset-right))",
          // Deja libre el botón central, que sobresale de la barra.
          bottom: "calc(100% + 1.75rem)",
        }}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = isMobileNavigationItemActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              tabIndex={open ? 0 : -1}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              onClick={onClose}
              className={`flex min-h-[4.75rem] min-w-0 flex-col items-center justify-start gap-1.5 rounded-2xl px-1 py-2.5 text-center transition-colors active:bg-fg/10 ${
                active ? "bg-stampa-orange/10 text-stampa-accent" : "text-stampa-text-soft hover:bg-fg/5"
              }`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${
                  active ? "border-stampa-orange/40 bg-stampa-orange/10" : "border-fg/10 bg-fg/5"
                }`}
              >
                <Icon size={20} aria-hidden="true" />
              </span>
              <span className="-mx-1.5 w-[calc(100%+0.75rem)] break-words text-[11px] font-semibold leading-tight tracking-tight">{item.shortLabel || item.label}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
