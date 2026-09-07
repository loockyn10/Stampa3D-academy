import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BookOpen,
  Boxes,
  Calculator,
  Gift,
  Globe,
  Package,
  Settings,
  Store,
  Users,
} from "lucide-react";

export interface MobileNavigationItem {
  href: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  activePrefixes: readonly string[];
}

export const mainMobileNavigation: readonly MobileNavigationItem[] = [
  {
    href: "/academia",
    label: "Academia",
    icon: BookOpen,
    activePrefixes: ["/academia", "/cursos", "/talleres"],
  },
  {
    href: "/stock",
    label: "Mi Taller",
    shortLabel: "Taller",
    icon: Archive,
    activePrefixes: ["/stock"],
  },
  {
    href: "/mi-negocio",
    label: "Mi Negocio",
    shortLabel: "Negocio",
    icon: Store,
    activePrefixes: ["/mi-negocio", "/presupuestos"],
  },
  {
    href: "/productos",
    label: "Productos",
    icon: Package,
    activePrefixes: ["/productos"],
  },
];

export const secondaryMobileNavigation: readonly MobileNavigationItem[] = [
  {
    href: "/calculadora",
    label: "Calculadora",
    shortLabel: "Calculadora",
    icon: Calculator,
    activePrefixes: ["/calculadora"],
  },
  {
    href: "/libreria-stl",
    label: "Librería STL",
    shortLabel: "Librería STL",
    icon: Boxes,
    activePrefixes: ["/libreria-stl"],
  },
  {
    href: "/sorteos",
    label: "Sorteos",
    icon: Gift,
    activePrefixes: ["/sorteos"],
  },
  {
    href: "/canales",
    label: "Canales",
    icon: Users,
    activePrefixes: ["/canales", "/telegram", "/whatsapp"],
  },
  {
    href: "/redes",
    label: "Redes",
    icon: Globe,
    activePrefixes: ["/redes", "/instagram", "/youtube"],
  },
  {
    href: "/configuracion",
    label: "Configuración",
    shortLabel: "Config.",
    icon: Settings,
    activePrefixes: ["/configuracion"],
  },
];

export function isMobileNavigationItemActive(
  pathname: string,
  item: MobileNavigationItem,
): boolean {
  return item.activePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
