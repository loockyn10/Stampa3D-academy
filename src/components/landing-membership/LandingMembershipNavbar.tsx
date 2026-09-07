"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const navigation = [
  { label: "Cómo funciona", href: "#mecanismo" },
  { label: "Plataforma", href: "#plataforma" },
  { label: "Qué incluye", href: "#pilares" },
  { label: "Precio", href: "#precio" },
] as const;

export function LandingMembershipNavbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      aria-label="Navegación principal"
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-stampa-border bg-stampa-bg/90 py-3 shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-md"
          : "bg-transparent py-5"
      }`}
    >
      <div className="container mx-auto flex items-center justify-between px-5 md:px-6">
        <Link
          href="#inicio"
          className="group flex items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded bg-gradient-to-br from-orange-500 to-orange-600 text-lg font-bold text-white shadow-[0_0_15px_rgba(234,88,12,0.4)] transition-shadow group-hover:shadow-[0_0_20px_rgba(234,88,12,0.6)]">
            S
          </span>
          <span className="hidden text-lg font-bold tracking-tight text-white sm:block md:text-xl">
            Academia <span className="text-stampa-orange">Stampa</span>
          </span>
        </Link>

        <div className="hidden items-center gap-7 text-sm font-medium lg:flex">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded text-zinc-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400"
            >
              {item.label}
            </Link>
          ))}
        </div>

        <Link
          href="/login"
          className="rounded-lg border border-stampa-border bg-white/10 px-4 py-2 text-sm font-medium text-white transition-all hover:border-orange-400 hover:bg-stampa-orange focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400 sm:px-5"
        >
          Ingresar
        </Link>
      </div>
    </nav>
  );
}
