"use client";

import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "#academia", label: "Academia" },
  { href: "#herramientas", label: "Herramientas" },
  { href: "#stampy", label: "Stampy" },
];

export function LandingV2Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="absolute inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)]">
      <nav
        aria-label="Navegación principal"
        className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10"
      >
        <Link
          href="/landing"
          aria-label="Academia Stampa, inicio"
          className="group flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stampa-orange"
        >
          <Image
            src="/favicon.svg"
            alt=""
            width={36}
            height={36}
            priority
            className="h-8 w-8 shrink-0 object-contain transition-transform duration-300 group-hover:scale-105 sm:h-9 sm:w-9"
          />
          <span className="text-sm font-semibold tracking-[-0.01em] text-white sm:text-base">
            Academia <span className="text-stampa-orange">Stampa</span>
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-zinc-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stampa-orange"
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stampa-orange"
          >
            Ingresar
          </Link>
          <Link
            href="/registro"
            className="rounded-xl bg-stampa-orange px-4 py-2.5 text-sm font-bold text-white shadow-[0_10px_30px_-12px_rgba(255,120,10,0.9)] transition-colors hover:bg-stampa-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Crear cuenta
          </Link>
        </div>

        <button
          type="button"
          aria-label={mobileOpen ? "Cerrar navegación" : "Abrir navegación"}
          aria-expanded={mobileOpen}
          aria-controls="landing-v2-mobile-navigation"
          onClick={() => setMobileOpen((open) => !open)}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stampa-orange md:hidden"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {mobileOpen ? (
        <div
          id="landing-v2-mobile-navigation"
          className="mx-4 rounded-2xl border border-white/10 bg-[#1c1c1f]/95 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl md:hidden"
        >
          <div className="grid gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-xl px-4 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/[0.08] pt-3">
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="rounded-xl border border-white/10 px-3 py-3 text-center text-sm font-semibold text-zinc-200"
            >
              Ingresar
            </Link>
            <Link
              href="/registro"
              onClick={() => setMobileOpen(false)}
              className="rounded-xl bg-stampa-orange px-3 py-3 text-center text-sm font-bold text-white"
            >
              Crear cuenta
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
