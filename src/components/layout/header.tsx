"use client";

import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { ThemeMenu } from "@/components/theme/theme-switcher";
import type { UserAccessSnapshot } from "@/lib/auth/user-access";
import { getPageTitle } from "./page-titles";

interface HeaderProps {
  access: UserAccessSnapshot | null;
  loading: boolean;
}

export function Header({ access, loading }: HeaderProps) {
  const pathname = usePathname();
  const identity = access?.identity;
  const isFree = !loading && access?.authenticated === true && !access.capabilities.accessPlatform;

  const getInitials = () => {
    const name = identity?.fullName || identity?.displayName || identity?.email || "U";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getMemberLevelLabel = () => {
    if (loading || !access) return "Miembro";
    if (access.capabilities.accessAdmin) return "Administrador";

    if (!access.membershipValid) {
      if (access.validGrantTypes.includes("beta_tester")) return "Beta Tester";
      if (access.validGrantTypes.includes("manual_free_access")) return "Acceso gratuito";
      if (access.validGrantTypes.includes("internal_tester")) return "Tester interno";
      return "Cuenta gratis";
    }

    switch (identity?.memberLevel) {
      case "bronze": return "Miembro Bronce";
      case "silver": return "Miembro Silver";
      case "gold": return "Miembro Gold";
      case "elite": return "Miembro Elite";
      default: return "Miembro";
    }
  };

  const title = getPageTitle(pathname);

  return (
    <header className="sticky top-0 z-20 hidden h-16 items-center border-b border-stampa-border bg-stampa-bg/80 px-8 backdrop-blur lg:flex">
      {/* 1. Izquierda: Título */}
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <h1 className="truncate text-base font-bold text-fg">{title}</h1>
      </div>

      {/* 2. Centro: Buscador global */}
      <div className="mx-6 w-full max-w-xl flex-1">
        {!isFree && <GlobalSearch />}
      </div>

      {/* 3. Derecha: Iconos y perfil */}
      <div className="flex flex-1 items-center justify-end gap-3">
        <ThemeMenu />
        <Link href="/perfil" className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-fg/5 transition-colors">
          {identity?.avatarUrl ? (
            <img src={identity.avatarUrl} alt="Avatar" className="h-8 w-8 rounded-full object-cover shrink-0" />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-stampa-accent">
              {getInitials()}
            </div>
          )}
          <div className="hidden text-left sm:block min-w-max">
            <p className="text-xs font-semibold leading-none text-fg truncate max-w-[120px]">
              {identity?.fullName || identity?.displayName || identity?.email || "Mi perfil"}
            </p>
            <p className="mt-0.5 text-[11px] leading-none text-gray-400 truncate max-w-[120px]">
              {getMemberLevelLabel()}
            </p>
          </div>
          <ChevronDown size={14} className="hidden text-gray-400 sm:block shrink-0" />
        </Link>
      </div>
    </header>
  );
}
