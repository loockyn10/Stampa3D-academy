import Link from "next/link";
import { UniversoIsotipo } from "@/components/brand/UniversoLogo";

/** Universo Stampa identity shared by the access screens (login, registro, email, contraseña, onboarding). */
export function AuthBrand({ align = "center" }: { align?: "center" | "start" }) {
  return (
    <Link
      href="/landing"
      className={`flex items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/50 ${align === "center" ? "justify-center" : ""}`}
      aria-label="Universo Stampa — inicio"
    >
      <UniversoIsotipo height={44} priority />
      <span className="text-left leading-none">
        <span className="block text-lg font-bold tracking-tight text-fg">Universo Stampa</span>
        <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-stampa-accent">Impresión 3D</span>
      </span>
    </Link>
  );
}
