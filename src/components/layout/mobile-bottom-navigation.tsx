"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Calculator, Compass, Lock, Plus, Printer, Store, User } from "lucide-react";
import type { UserAccessSnapshot } from "@/lib/auth/user-access";
import type { FeatureId } from "@/lib/features/registry";
import { useFeatureVisibility } from "@/components/features/feature-flags-provider";
import {
  isMobileNavigationItemActive,
  mainMobileNavigation,
  type MobileNavigationItem,
} from "./mobile-navigation";
import { MobileRadialMenu } from "./mobile-radial-menu";

interface MobileBottomNavigationProps {
  access: UserAccessSnapshot | null;
  loading: boolean;
  toolsOpen: boolean;
  onToolsOpenChange: (open: boolean) => void;
}

function NavigationLink({ item, pathname }: { item: MobileNavigationItem; pathname: string }) {
  const Icon = item.icon;
  const active = isMobileNavigationItemActive(pathname, item);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-semibold transition-colors ${
        active ? "text-stampa-accent" : "text-gray-500 hover:text-gray-200"
      }`}
    >
      <Icon size={20} strokeWidth={active ? 2.4 : 2} />
      <span className="flex max-w-full items-center gap-0.5 truncate">{item.shortLabel || item.label}{"locked" in item && item.locked ? <Lock size={9} /> : null}</span>
    </Link>
  );
}

export function MobileBottomNavigation({
  access,
  loading,
  toolsOpen,
  onToolsOpenChange,
}: MobileBottomNavigationProps) {
  const pathname = usePathname();
  const visibility = useFeatureVisibility();
  const isFree = !loading && access?.authenticated === true && !access.capabilities.accessPlatform;
  const allFreeItems: (MobileNavigationItem & { locked?: boolean; feature?: FeatureId })[] = [
    { href: "/calculadora", label: "Calculadora", icon: Calculator, activePrefixes: ["/calculadora"] },
    { href: "/explorar-modelos", label: "Explorar Modelos", shortLabel: "Explorar", icon: Compass, activePrefixes: ["/explorar-modelos"] },
    { href: "/sin-acceso?feature=academia", label: "Academia", icon: BookOpen, activePrefixes: [], locked: true, feature: "academia" },
    { href: "/sin-acceso?feature=taller", label: "Taller", icon: Printer, activePrefixes: [], locked: true, feature: "mi_taller" },
    { href: "/sin-acceso?feature=negocio", label: "Negocio", icon: Store, activePrefixes: [], locked: true, feature: "mi_negocio" },
  ];
  // Funcionalidades deshabilitadas públicamente no se ofrecen; si no queda ninguna, el perfil evita una barra vacía.
  const visibleFreeItems = allFreeItems.filter((item) =>
    item.feature ? visibility.isFeatureVisible(item.feature) : visibility.isPathVisible(item.href),
  );
  const freeItems = visibleFreeItems.length > 0
    ? visibleFreeItems
    : [{ href: "/perfil", label: "Mi perfil", shortLabel: "Perfil", icon: User, activePrefixes: ["/perfil"] } as MobileNavigationItem];
  // Navegación principal (Inicio siempre presente): se reparte a ambos lados del botón central.
  const visibleMainItems = mainMobileNavigation.filter((item) => visibility.isPathVisible(item.href));
  const leftCount = Math.ceil(visibleMainItems.length / 2);
  const leftItems = visibleMainItems.slice(0, leftCount);
  const rightItems = visibleMainItems.slice(leftCount);
  const sideColumns = Math.max(leftItems.length, rightItems.length);
  const mainGridTemplate = `repeat(${sideColumns}, minmax(0, 1fr)) 4.5rem repeat(${sideColumns}, minmax(0, 1fr))`;

  useEffect(() => {
    onToolsOpenChange(false);
  }, [pathname, onToolsOpenChange]);

  useEffect(() => {
    if (!toolsOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToolsOpenChange(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [toolsOpen, onToolsOpenChange]);

  if (isFree) {
    return <div className="fixed inset-x-0 bottom-0 z-[60] lg:hidden"><nav aria-label="Navegación principal" className="border-t border-fg/10 bg-stampa-bg/95 backdrop-blur-xl" style={{ height: "calc(var(--mobile-bottom-navigation-height) + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)" }}><div className="grid h-[var(--mobile-bottom-navigation-height)] items-center px-1" style={{ gridTemplateColumns: `repeat(${freeItems.length}, minmax(0, 1fr))` }}>{freeItems.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} />)}</div></nav></div>;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] lg:hidden">
      <MobileRadialMenu open={toolsOpen} onClose={() => onToolsOpenChange(false)} />

      <nav
        aria-label="Navegación principal"
        className="relative border-t border-fg/10 bg-stampa-bg/95 shadow-[0_-12px_35px_rgba(0,0,0,0.3)] backdrop-blur-xl"
        style={{
          height: "calc(var(--mobile-bottom-navigation-height) + env(safe-area-inset-bottom))",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div
          className="grid h-[var(--mobile-bottom-navigation-height)] items-center px-1"
          style={{ gridTemplateColumns: mainGridTemplate }}
        >
          {leftItems.map((item) => (
            <NavigationLink key={item.href} item={item} pathname={pathname} />
          ))}
          {Array.from({ length: sideColumns - leftItems.length }, (_, index) => (
            <span key={`left-gap-${index}`} aria-hidden="true" />
          ))}

          <span aria-hidden="true" />

          {rightItems.map((item) => (
            <NavigationLink key={item.href} item={item} pathname={pathname} />
          ))}
          {Array.from({ length: sideColumns - rightItems.length }, (_, index) => (
            <span key={`right-gap-${index}`} aria-hidden="true" />
          ))}
        </div>

        <button
          type="button"
          aria-label={toolsOpen ? "Cerrar herramientas" : "Abrir herramientas"}
          aria-expanded={toolsOpen}
          aria-controls="mobile-tools-menu"
          onClick={() => onToolsOpenChange(!toolsOpen)}
          className="absolute left-1/2 top-0 z-20 flex h-16 w-16 -translate-x-1/2 -translate-y-[18px] items-center justify-center rounded-full border-4 border-stampa-bg bg-gradient-to-br from-stampa-orange to-orange-500 text-white shadow-[0_8px_28px_rgba(255,120,10,0.32)] transition-transform duration-200 active:scale-95"
        >
          <Plus
            size={28}
            strokeWidth={2.5}
            className={`transition-transform duration-200 ${toolsOpen ? "rotate-45" : "rotate-0"}`}
          />
        </button>
      </nav>
    </div>
  );
}
