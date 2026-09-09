import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Boxes,
  Calculator,
  Gift,
  Globe,
  Home,
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
    href: "/",
    label: "Inicio",
    icon: Home,
    activePrefixes: ["/"],
  },
  {
    href: "/academia",
    label: "Academia",
    icon: BookOpen,
    activePrefixes: ["/academia", "/cursos", "/talleres"],
  },
  {
    href: "/mi-taller",
    label: "Mi Taller",
    shortLabel: "Taller",
    icon: Boxes,
    activePrefixes: ["/mi-taller"],
  },
  {
    href: "/mi-negocio",
    label: "Mi Negocio",
    shortLabel: "Negocio",
    icon: Store,
    activePrefixes: ["/mi-negocio", "/presupuestos"],
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
  if (item.href === "/") return pathname === "/";
  return item.activePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
