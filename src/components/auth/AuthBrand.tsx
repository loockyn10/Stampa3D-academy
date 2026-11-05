import Link from "next/link";
import { Layers } from "lucide-react";

/** Universo Stampa identity shared by the access screens (login, registro, email, contraseña, onboarding). */
export function AuthBrand({ align = "center" }: { align?: "center" | "start" }) {
  return (
    <Link
      href="/landing"
      className={`flex items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/50 ${align === "center" ? "justify-center" : ""}`}
      aria-label="Universo Stampa — inicio"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-stampa-orange text-neutral-950 shadow-lg shadow-stampa-orange/20">
        <Layers className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="text-left leading-none">
        <span className="block text-lg font-bold tracking-tight text-fg">Universo Stampa</span>
        <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-stampa-accent">Impresión 3D</span>
      </span>
    </Link>
  );
}
