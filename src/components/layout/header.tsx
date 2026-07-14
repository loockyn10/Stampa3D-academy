"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu, Search, Bell, ChevronDown } from "lucide-react";
import { COURSES } from "@/data/mock-data";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";

interface HeaderProps {
  setMobileOpen: (open: boolean) => void;
}

const PAGE_TITLES: Record<string, string> = {
  "/": "Inicio",
  "/cursos": "Cursos",
  "/sorteos": "Sorteos",
  "/calculadora": "Calculadora de costos",
  "/libreria-stl": "Librería STL",
  "/presupuestos": "Presupuestos",
  "/productos": "Productos",
  "/stock": "Stock",
  "/perfil": "Mi perfil",
  "/salir": "Sesión cerrada",
  "/telegram": "Telegram",
  "/whatsapp": "WhatsApp",
  "/youtube": "YouTube",
  "/instagram": "Instagram",
};

export function Header({ setMobileOpen }: HeaderProps) {
  const pathname = usePathname();
  const supabase = createClient();
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("full_name, display_name, email, avatar_url, member_level, membership_status")
        .eq("id", user.id)
        .single();
      
      if (data) {
        setProfile(data);
      }
    }
    loadProfile();
  }, [supabase]);

  const getInitials = () => {
    const name = profile?.full_name || profile?.display_name || profile?.email || "U";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getMemberLevelLabel = () => {
    if (!profile) return "Miembro";
    if (profile.membership_status !== "active") return "Membresía inactiva";
    
    switch (profile.member_level) {
      case "bronze": return "Miembro Bronce";
      case "silver": return "Miembro Silver";
      case "gold": return "Miembro Gold";
      case "elite": return "Miembro Elite";
      default: return "Miembro";
    }
  };

  // Resolve title based on pathname
  let title = PAGE_TITLES[pathname] || "";

  // Handle dynamic course route title
  if (pathname.startsWith("/cursos/")) {
    const courseId = pathname.split("/").pop();
    const course = COURSES.find((c) => c.id === courseId);
    if (course) {
      title = course.title;
    } else {
      title = "Detalle del Curso";
    }
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-gray-100 bg-white/90 px-4 backdrop-blur lg:px-8">
      <button className="text-gray-500 lg:hidden" onClick={() => setMobileOpen(true)}>
        <Menu size={22} />
      </button>

      <h1 className="mr-2 hidden text-base font-bold text-gray-900 sm:block">{title}</h1>

      <div className="ml-auto flex flex-1 items-center gap-3 sm:ml-0 hidden">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar cursos, STL, productos..."
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
          />
        </div>
      </div>

      <button className="relative flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-50">
        <Bell size={18} />
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-orange-500" />
      </button>

      <Link href="/perfil" className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-gray-50">
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="Avatar" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-600">
            {getInitials()}
          </div>
        )}
        <div className="hidden text-left sm:block">
          <p className="text-xs font-semibold leading-none text-gray-900">
            {profile?.full_name || profile?.display_name || profile?.email || "Mi perfil"}
          </p>
          <p className="mt-0.5 text-[11px] leading-none text-gray-400">
            {getMemberLevelLabel()}
          </p>
        </div>
        <ChevronDown size={14} className="hidden text-gray-400 sm:block" />
      </Link>
    </header>
  );
}
