"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { UniversoIsotipo } from "@/components/brand/UniversoLogo";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Gift,
  Home,
  Calculator,
  Boxes,
  Compass,
  User,
  Settings,
  LogOut,
  Shield,
  Sparkles,
  Globe,
  Users,
  Printer,
  Store,
  Lock,
  Type,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { UserAccessSnapshot } from "@/lib/auth/user-access";
import type { FeatureId } from "@/lib/features/registry";
import { pruneEmptyGroups } from "@/lib/features/visibility";
import { useFeatureVisibility } from "@/components/features/feature-flags-provider";
import { readSidebarCollapsed, subscribeSidebarPreference, writeSidebarCollapsed } from "@/lib/layout/sidebar-preference";

interface SidebarProps {
  access: UserAccessSnapshot | null;
  loading: boolean;
}

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  locked?: boolean;
  /** Funcionalidad que controla la entrada cuando la ruta no la identifica (promos bloqueadas de usuarios Free). */
  feature?: FeatureId;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: "Plataforma",
    items: [
      { path: "/stampy", label: "Stampy IA", icon: Sparkles },
      { path: "/calculadora", label: "Calculadora", icon: Calculator },
      { path: "/stampa-maker", label: "Stampa Maker", icon: Type },
      { path: "/sorteos", label: "Sorteos", icon: Gift },
      { path: "/libreria-stl", label: "Librería STL", icon: Boxes },
      { path: "/explorar-modelos", label: "Explorar Modelos", icon: Compass },
    ],
  },
  {
    group: "Áreas",
    items: [
      { path: "/academia", label: "Academia", icon: BookOpen },
      { path: "/mi-taller", label: "Mi Taller", icon: Printer },
      { path: "/mi-negocio", label: "Mi Negocio", icon: Store },
    ],
  },
  {
    group: "Comunidad",
    items: [
      { path: "/redes", label: "Redes", icon: Globe },
      { path: "/canales", label: "Canales", icon: Users },
    ],
  },
  {
    group: "Usuario",
    items: [
      { path: "/perfil", label: "Mi perfil", icon: User },
      { path: "/configuracion", label: "Configuración", icon: Settings },
      { path: "/salir", label: "Cerrar sesión", icon: LogOut },
    ],
  },
];

export function Sidebar({ access, loading }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const visibility = useFeatureVisibility();
  const isAdmin = access?.capabilities.accessAdmin === true;
  const hasPlatformAccess = access?.capabilities.accessPlatform === true;
  const isFree = !loading && access?.authenticated === true && !hasPlatformAccess;
  // La preferencia vive en <html data-sidebar>; el servidor siempre pinta «expandido» y el CSS ya refleja el estado real.
  const collapsed = useSyncExternalStore(subscribeSidebarPreference, readSidebarCollapsed, () => false);
  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number } | null>(null);
  const showTooltip = (label: string) => (event: { currentTarget: HTMLElement }) => {
    if (!collapsed) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 });
  };
  const hideTooltip = () => setTooltip(null);
  const tooltipHandlers = (label: string) => ({
    onMouseEnter: showTooltip(label),
    onFocus: showTooltip(label),
    onMouseLeave: hideTooltip,
    onBlur: hideTooltip,
  });
  const freeGroups: NavGroup[] = [
    { group: "Gratis", items: [
      { path: "/calculadora", label: "Calculadora", icon: Calculator },
      { path: "/explorar-modelos", label: "Explorar Modelos", icon: Compass },
    ] },
    { group: "Descubrí Stampa", items: [
      { path: "/sin-acceso?feature=stampy", label: "Stampy IA", icon: Sparkles, locked: true, feature: "stampy" },
      { path: "/sin-acceso?feature=academia", label: "Academia", icon: BookOpen, locked: true, feature: "academia" },
      { path: "/sin-acceso?feature=taller", label: "Mi Taller", icon: Printer, locked: true, feature: "mi_taller" },
      { path: "/sin-acceso?feature=negocio", label: "Mi Negocio", icon: Store, locked: true, feature: "mi_negocio" },
    ] },
    { group: "Cuenta", items: [
      { path: "/perfil", label: "Mi perfil", icon: User },
      { path: "/salir", label: "Cerrar sesión", icon: LogOut },
    ] },
  ];

  // Helper to check if a route is active
  const isActive = (path: string) => {
    const [basePath, query] = path.split("?");
    if (basePath === "/") {
      return pathname === "/";
    }
    if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return false;
    if (!query) return true;
    const expected = new URLSearchParams(query);
    return Array.from(expected.entries()).every(([key, value]) => {
      const actual = searchParams.get(key);
      return actual === value || (basePath === "/stock" && key === "tab" && value === "productos" && actual === null);
    });
  };

  return (
      <aside className="app-sidebar relative hidden shrink-0 flex-col self-start border-r border-stampa-border bg-stampa-bg lg:sticky lg:top-0 lg:z-30 lg:flex lg:h-screen">
        {/* Primero en el orden de tabulación: contraer/expandir. Va sobre el borde para no robar espacio al contenido. */}
        <button
          type="button"
          onClick={() => {
            hideTooltip();
            writeSidebarCollapsed(!collapsed);
          }}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar-nav"
          aria-label={collapsed ? "Expandir menú lateral" : "Contraer menú lateral"}
          title={collapsed ? "Expandir menú lateral" : "Contraer menú lateral"}
          className="absolute -right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-stampa-border bg-stampa-surface text-gray-400 shadow-md transition-colors hover:border-stampa-orange/40 hover:text-fg"
        >
          {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
        </button>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Brand logo header */}
        <div className="app-sidebar-brand flex items-center px-5 py-5">
          <Link
            href={isFree && visibility.isFeatureVisible("calculadora") ? "/calculadora" : "/"}
            className="flex items-center gap-2"
            aria-label="Universo Stampa, inicio"
            {...tooltipHandlers("Universo Stampa")}
          >
            <UniversoIsotipo height={36} priority />
            <div className="app-sidebar-label whitespace-nowrap">
              <p className="text-sm font-bold leading-none text-fg">Universo Stampa</p>
              <p className="mt-0.5 text-[11px] leading-none text-stampa-text-muted">Impresión 3D</p>
            </div>
          </Link>
        </div>

        {/* Dashboard/Inicio Link */}
        {!isFree && <Link
          href="/"
          aria-label="Inicio"
          aria-current={pathname === "/" ? "page" : undefined}
          {...tooltipHandlers("Inicio")}
          className={`app-sidebar-item relative mx-3 mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
            pathname === "/" ? "bg-stampa-orange/10 text-stampa-accent" : "text-gray-400 hover:bg-fg/5 hover:text-fg"
          }`}
        >
          <Home size={17} aria-hidden="true" className="shrink-0" />
          <span className="app-sidebar-label">Inicio</span>
        </Link>}

        {/* Navigation Groups */}
        <nav id="app-sidebar-nav" aria-label="Navegación principal" onScroll={hideTooltip} className="flex-1 overflow-y-auto stampa-scrollbar px-3 pb-4">
          {(() => {
            const groupsToRender: NavGroup[] = isFree ? freeGroups : [...NAV_GROUPS];
            if (isAdmin) {
              const userGroupIndex = groupsToRender.findIndex(g => g.group === "Usuario");
              const adminGroup = {
                group: "Administración",
                items: [
                  { path: "/admin", label: "Admin", icon: Shield }
                ]
              };
              if (userGroupIndex !== -1) {
                groupsToRender.splice(userGroupIndex, 0, adminGroup);
              } else {
                groupsToRender.push(adminGroup);
              }
            }
            // Funcionalidades deshabilitadas públicamente: se quitan las entradas y los grupos que queden vacíos.
            const visibleGroups = pruneEmptyGroups(
              groupsToRender.map((group) => ({
                ...group,
                items: group.items.filter((item) =>
                  item.feature ? visibility.isFeatureVisible(item.feature) : visibility.isPathVisible(item.path),
                ),
              })),
            );
            return visibleGroups.map((group, groupIndex) => (
              <div key={group.group} className="mb-5">
                {groupIndex > 0 && <div aria-hidden="true" className="app-sidebar-divider mx-2 mb-3 h-px bg-stampa-border" />}
                <p className="app-sidebar-label mb-1.5 whitespace-nowrap px-3 text-[11px] font-bold uppercase tracking-wider text-stampa-text-muted">
                  {group.group}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.path);
                    const isStampy = item.path === "/stampy";
                    return (
                      <Link
                        key={item.path}
                        href={item.path}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                        {...tooltipHandlers(item.label)}
                        className={`app-sidebar-item group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                          active
                            ? isStampy
                              ? "bg-cyan-500/10 text-cyan-400"
                              : "bg-stampa-orange/10 text-stampa-accent"
                            : item.path === "/salir"
                            ? "text-gray-500 hover:bg-red-500/10 hover:text-red-400"
                            : "text-gray-400 hover:bg-fg/5 hover:text-fg"
                        }`}
                      >
                        <Icon
                          size={17}
                          aria-hidden="true"
                          className={
                            "shrink-0 " + (active
                              ? isStampy
                                ? "text-cyan-400"
                                : "text-stampa-accent"
                              : item.path === "/salir"
                              ? "text-gray-500 group-hover:text-red-400"
                              : isStampy
                              ? "text-gray-500 group-hover:text-cyan-400/80"
                              : "text-gray-500 group-hover:text-gray-300")
                          }
                        />
                        <span className="app-sidebar-label flex-1 whitespace-nowrap text-left">{item.label}</span>
                        {item.locked && <Lock size={13} aria-hidden="true" className="app-sidebar-label text-gray-600" />}
                        {active && <span aria-hidden="true" className={`app-sidebar-label h-1.5 w-1.5 rounded-full ${isStampy ? 'bg-cyan-400' : 'bg-stampa-orange'}`} />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
        </nav>

        {/* Membership CTA banner */}
        {!loading && !hasPlatformAccess && (
          <div className="app-sidebar-label mx-3 mb-4 rounded-2xl bg-fg/5 border border-stampa-border p-4 text-fg">
            <p className="text-xs font-semibold text-stampa-accent">Activar membresía</p>
            <p className="mt-1 text-xs text-gray-400">Desbloqueá todos los cursos y STL exclusivos de la academia.</p>
            <Link 
              href="/sin-acceso"
              className="mt-3 block w-full text-center rounded-lg bg-fg/10 py-2 text-xs font-semibold hover:bg-fg/20 transition-colors"
            >
              Ver planes
            </Link>
          </div>
        )}
        </div>

        {/* Tooltip del sidebar contraído: fijo en el viewport para que el scroll del menú no lo recorte. */}
        {collapsed && tooltip && (
          <div
            role="tooltip"
            style={{ top: tooltip.top, left: tooltip.left }}
            className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg border border-stampa-border bg-stampa-surface px-2.5 py-1.5 text-xs font-semibold text-fg shadow-lg"
          >
            {tooltip.label}
          </div>
        )}
      </aside>
  );
}
