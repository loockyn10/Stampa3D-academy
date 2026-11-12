"use client";

import { UniversoIsotipo } from "@/components/brand/UniversoLogo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Shield } from "lucide-react";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import type { UserAccessSnapshot } from "@/lib/auth/user-access";
import { useFeatureVisibility } from "@/components/features/feature-flags-provider";
import { ThemeMenu } from "@/components/theme/theme-switcher";
import { getPageTitle, getParentRoute } from "./page-titles";

interface MobileHeaderProps {
  access: UserAccessSnapshot | null;
  loading: boolean;
}

function getInitials(access: UserAccessSnapshot | null): string {
  const identity = access?.identity;
  const name = identity?.fullName || identity?.displayName || identity?.email || "U";
  const parts = name.trim().split(/\s+/);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return name.substring(0, 2).toUpperCase();
}

export function MobileHeader({ access, loading }: MobileHeaderProps) {
  const identity = access?.identity;
  const isAdmin = !loading && access?.role === "admin";
  const isFree = !loading && access?.authenticated === true && !access.capabilities.accessPlatform;
  const visibility = useFeatureVisibility();
  const freeHome = visibility.isFeatureVisible("calculadora") ? "/calculadora" : "/";
  const pathname = usePathname() ?? "/";
  // Dónde está el usuario: título de la pantalla y, en subpantallas, "volver" al nivel anterior del área.
  const title = getPageTitle(pathname, { compact: true });
  const parentRoute = getParentRoute(pathname);
  const isHome = pathname === "/";

  return (
    <header
      className="sticky top-0 z-30 border-b border-stampa-border bg-stampa-bg/95 backdrop-blur-xl lg:hidden"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <div className="flex h-14 items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 flex-1 items-center">
          {parentRoute ? (
            <Link
              href={parentRoute}
              aria-label={`Volver a ${getPageTitle(parentRoute, { compact: true }) || "la pantalla anterior"}`}
              className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fg transition-colors active:bg-fg/5"
            >
              <ArrowLeft size={22} aria-hidden="true" />
            </Link>
          ) : (
            <Link
              href={isFree ? freeHome : "/"}
              aria-label="Ir al inicio"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors active:bg-fg/5"
            >
              <UniversoIsotipo height={28} alt="Universo Stampa" priority />
            </Link>
          )}
          <p className="min-w-0 truncate pl-1 pr-2 text-base font-bold text-fg">{isHome || !title ? "Universo Stampa" : title}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ThemeMenu />
          {isAdmin && (
            <Link
              href="/admin"
              aria-label="Abrir administración"
              title="Administración"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-violet-300 transition-colors hover:bg-violet-500/10 active:bg-violet-500/15"
            >
              <Shield size={20} />
            </Link>
          )}

          <Link
            href="/perfil"
            aria-label="Abrir mi perfil"
            className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors active:bg-fg/5"
          >
            {identity?.avatarUrl ? (
              <img
                src={identity.avatarUrl}
                alt="Avatar"
                className="h-9 w-9 rounded-full border border-fg/10 object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-stampa-orange/25 bg-stampa-orange/10 text-xs font-bold text-stampa-accent">
                {getInitials(access)}
              </span>
            )}
          </Link>
        </div>
      </div>

      {!isFree && <div className="px-3 pb-3"><GlobalSearch /></div>}
    </header>
  );
}
