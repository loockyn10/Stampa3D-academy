"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Gift,
  Calculator,
  Boxes,
  FileText,
  Package,
  Archive,
  Send,
  MessageCircle,
  User,
  Settings,
  LogOut,
  Layers,
  X,
} from "lucide-react";
import { Youtube, Instagram } from "@/components/ui/icons";

interface SidebarProps {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const NAV_GROUPS = [
  {
    group: "Plataforma",
    items: [
      { path: "/cursos", label: "Cursos", icon: BookOpen },
      { path: "/sorteos", label: "Sorteos", icon: Gift },
      { path: "/calculadora", label: "Calculadora", icon: Calculator },
      { path: "/libreria-stl", label: "Librería STL", icon: Boxes },
    ],
  },
  {
    group: "Mi taller",
    items: [
      { path: "/presupuestos", label: "Presupuestos", icon: FileText },
      { path: "/productos", label: "Productos", icon: Package },
      { path: "/stock", label: "Stock", icon: Archive },
    ],
  },
  {
    group: "Comunidad",
    items: [
      { path: "/telegram", label: "Telegram", icon: Send },
      { path: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
      { path: "/youtube", label: "YouTube", icon: Youtube },
      { path: "/instagram", label: "Instagram", icon: Instagram },
    ],
  },
  {
    group: "Usuario",
    items: [
      { path: "/perfil", label: "Mi perfil", icon: User },
      { path: "/perfil?tab=configuracion", label: "Configuración", icon: Settings },
      { path: "/salir", label: "Cerrar sesión", icon: LogOut },
    ],
  },
];

export function Sidebar({ mobileOpen, setMobileOpen }: SidebarProps) {
  const pathname = usePathname();

  // Helper to check if a route is active
  const isActive = (path: string) => {
    const basePath = path.split("?")[0];
    if (basePath === "/") {
      return pathname === "/";
    }
    return pathname.startsWith(basePath);
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-gray-900/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-100 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand logo header */}
        <div className="flex items-center justify-between px-5 py-5">
          <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500 text-white">
              <Layers size={18} />
            </div>
            <div>
              <p className="text-sm font-bold leading-none text-gray-900">Extruye</p>
              <p className="mt-0.5 text-[11px] leading-none text-gray-400">Academia 3D</p>
            </div>
          </Link>
          <button className="text-gray-400 lg:hidden" onClick={() => setMobileOpen(false)}>
            <X size={20} />
          </button>
        </div>

        {/* Dashboard/Inicio Link */}
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className={`mx-3 mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
            pathname === "/" ? "bg-orange-50 text-orange-600" : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          <div className="flex h-5 w-5 items-center justify-center">🏠</div>
          Inicio
        </Link>

        {/* Navigation Groups */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.group} className="mb-5">
              <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                {group.group}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.path);
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                        active
                          ? "bg-orange-50 text-orange-600"
                          : item.path === "/salir"
                          ? "text-gray-500 hover:bg-red-50 hover:text-red-600"
                          : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <Icon
                        size={17}
                        className={
                          active
                            ? "text-orange-500"
                            : item.path === "/salir"
                            ? "text-gray-400 group-hover:text-red-500"
                            : "text-gray-400 group-hover:text-gray-600"
                        }
                      />
                      <span className="flex-1 text-left">{item.label}</span>
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Premium CTA banner */}
        <div className="mx-3 mb-4 rounded-2xl bg-gray-900 p-4 text-white">
          <p className="text-xs font-semibold text-orange-400">Pasate a Premium</p>
          <p className="mt-1 text-xs text-gray-300">Desbloqueá todos los cursos y STL exclusivos.</p>
          <button className="mt-3 w-full rounded-lg bg-white/10 py-2 text-xs font-semibold hover:bg-white/20">
            Ver planes
          </button>
        </div>
      </aside>
    </>
  );
}
