"use client";

import Image from "next/image";
import Link from "next/link";
import { Shield } from "lucide-react";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import type { UserAccessSnapshot } from "@/lib/auth/user-access";

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

  return (
    <header className="sticky top-0 z-30 border-b border-stampa-border bg-stampa-bg/95 backdrop-blur-xl lg:hidden">
      <div className="flex h-14 items-center justify-between px-3">
        <Link
          href="/"
          aria-label="Ir al inicio"
          className="flex h-11 min-w-11 items-center gap-2 rounded-xl px-1 transition-colors active:bg-white/5"
        >
          <Image
            src="/favicon.svg"
            alt="Stampa"
            width={34}
            height={34}
            priority
            className="h-[34px] w-[34px] shrink-0 object-contain"
          />
          <span className="text-sm font-bold text-white">Stampa</span>
        </Link>

        <div className="flex items-center gap-1">
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
            className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors active:bg-white/5"
          >
            {identity?.avatarUrl ? (
              <img
                src={identity.avatarUrl}
                alt="Avatar"
                className="h-9 w-9 rounded-full border border-white/10 object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-stampa-orange/25 bg-stampa-orange/10 text-xs font-bold text-stampa-orange">
                {getInitials(access)}
              </span>
            )}
          </Link>
        </div>
      </div>

      <div className="px-3 pb-3">
        <GlobalSearch />
      </div>
    </header>
  );
}
