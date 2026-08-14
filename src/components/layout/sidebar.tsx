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
  Shield,
  Sparkles,
  Globe,
  Users,
} from "lucide-react";
import { Youtube, Instagram } from "@/components/ui/icons";
import { createClient } from "@/utils/supabase/client";

interface SidebarProps {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const NAV_GROUPS = [
  {
    group: "Plataforma",
    items: [
      { path: "/stampy", label: "Stampy IA", icon: Sparkles },
      { path: "/academia", label: "Academia", icon: BookOpen },
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

export function Sidebar({ mobileOpen, setMobileOpen }: SidebarProps) {
  const pathname = usePathname();
  const supabase = createClient();
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [isMembershipActive, setIsMembershipActive] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function checkRoleAndMembership() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, membership_status")
        .eq("id", user.id)
        .single();
      if (profile) {
        if (profile.role === "admin") {
          setIsAdmin(true);
        }
        if (profile.membership_status === "active") {
          setIsMembershipActive(true);
        }
      }
      setLoading(false);
    }
    checkRoleAndMembership();
  }, []);

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
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/5 bg-[#070707] transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand logo header */}
        <div className="flex items-center justify-between px-5 py-5">
          <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#ff6a00] text-white">
              <Layers size={18} />
            </div>
            <div>
              <p className="text-sm font-bold leading-none text-white">Stampa</p>
              <p className="mt-0.5 text-[11px] leading-none text-gray-500">Academia 3D</p>
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
            pathname === "/" ? "bg-[#ff6a00]/10 text-[#ff6a00]" : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <div className="flex h-5 w-5 items-center justify-center">🏠</div>
          Inicio
        </Link>

        {/* Navigation Groups */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {(() => {
            const groupsToRender = [...NAV_GROUPS];
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
            return groupsToRender.map((group) => (
              <div key={group.group} className="mb-5">
                <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">
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
                        onClick={() => setMobileOpen(false)}
                        className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                          active
                            ? isStampy
                              ? "bg-cyan-500/10 text-cyan-400"
                              : "bg-[#ff6a00]/10 text-[#ff6a00]"
                            : item.path === "/salir"
                            ? "text-gray-500 hover:bg-red-500/10 hover:text-red-400"
                            : "text-gray-400 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <Icon
                          size={17}
                          className={
                            active
                              ? isStampy
                                ? "text-cyan-400"
                                : "text-[#ff6a00]"
                              : item.path === "/salir"
                              ? "text-gray-500 group-hover:text-red-400"
                              : isStampy
                              ? "text-gray-500 group-hover:text-cyan-400/80"
                              : "text-gray-500 group-hover:text-gray-300"
                          }
                        />
                        <span className="flex-1 text-left">{item.label}</span>
                        {active && <span className={`h-1.5 w-1.5 rounded-full ${isStampy ? 'bg-cyan-400' : 'bg-[#ff6a00]'}`} />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
        </nav>

        {/* Membership CTA banner */}
        {!loading && !isMembershipActive && !isAdmin && (
          <div className="mx-3 mb-4 rounded-2xl bg-white/5 border border-white/10 p-4 text-white">
            <p className="text-xs font-semibold text-[#ff6a00]">Activar membresía</p>
            <p className="mt-1 text-xs text-gray-400">Desbloqueá todos los cursos y STL exclusivos de la academia.</p>
            <Link 
              href="/sin-acceso"
              onClick={() => setMobileOpen(false)}
              className="mt-3 block w-full text-center rounded-lg bg-white/10 py-2 text-xs font-semibold hover:bg-white/20 transition-colors"
            >
              Ver planes
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
