import Image from "next/image";
import Link from "next/link";
import { Camera, CirclePlay } from "lucide-react";

const FOOTER_LINKS = [
  { href: "#academia", label: "Academia" },
  { href: "#herramientas", label: "Herramientas" },
  { href: "#stampy", label: "Stampy" },
  { href: "#comunidad", label: "Comunidad" },
  { href: "#precios", label: "Membresía" },
  { href: "#faq", label: "Preguntas frecuentes" },
];

export function LandingV2Footer() {
  return (
    <footer className="border-t border-white/[0.07] px-5 py-10 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <Link
            href="/landing"
            aria-label="Academia Stampa, inicio"
            className="flex w-fit items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stampa-orange"
          >
            <Image src="/favicon.svg" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
            <span className="text-sm font-semibold text-white">
              Academia <span className="text-stampa-orange">Stampa</span>
            </span>
          </Link>

          <nav aria-label="Navegación del pie" className="flex flex-wrap gap-x-6 gap-y-3">
            {FOOTER_LINKS.map((item) => (
              <Link key={item.href} href={item.href} className="text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-200">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href="https://instagram.com/extruye"
              target="_blank"
              rel="noreferrer"
              aria-label="Stampa en Instagram"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] text-zinc-500 transition-colors hover:border-white/20 hover:text-white"
            >
              <Camera size={16} />
            </a>
            <a
              href="https://youtube.com/extruye"
              target="_blank"
              rel="noreferrer"
              aria-label="Stampa en YouTube"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] text-zinc-500 transition-colors hover:border-white/20 hover:text-white"
            >
              <CirclePlay size={17} />
            </a>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-white/[0.06] pt-6 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Academia Stampa.</p>
          <p>Plataforma de impresión 3D.</p>
        </div>
      </div>
    </footer>
  );
}
