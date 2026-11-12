"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UniversoLogotipo } from "@/components/brand/UniversoLogo";

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
          <UniversoLogotipo height={40} priority />
        </Link>

        <div className="hidden items-center gap-7 text-sm font-medium lg:flex">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded text-zinc-300 transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400"
            >
              {item.label}
            </Link>
          ))}
        </div>

        <Link
          href="/login"
          className="rounded-lg border border-stampa-border bg-fg/10 px-4 py-2 text-sm font-medium text-fg transition-all hover:border-orange-400 hover:bg-stampa-orange hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400 sm:px-5"
        >
          Ingresar
        </Link>
      </div>
    </nav>
  );
}
