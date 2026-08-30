import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BookOpen,
  Boxes,
  Calculator,
  FileText,
  Gift,
  Globe,
  Package,
  Settings,
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
    href: "/calculadora",
    label: "Calculadora",
    shortLabel: "Calculadora",
    icon: Calculator,
    activePrefixes: ["/calculadora"],
  },
  {
    href: "/stock",
    label: "Stock",
    icon: Archive,
    activePrefixes: ["/stock"],
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
    href: "/presupuestos",
    label: "Presupuestos",
    shortLabel: "Presupuestos",
    icon: FileText,
    activePrefixes: ["/presupuestos"],
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
