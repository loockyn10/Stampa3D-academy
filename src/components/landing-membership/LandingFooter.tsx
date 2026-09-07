import Link from "next/link";
import { legalLinks, socialLinks } from "./landing-content";

export function LandingFooter() {
  return (
    <footer className="border-t border-stampa-border bg-[#09090b] py-12 text-sm">
      <div className="container mx-auto grid gap-10 px-5 md:grid-cols-[1.2fr_0.8fr_0.8fr] md:px-6">
        <div>
          <Link
            href="#inicio"
            className="inline-flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 text-lg font-bold text-white">
              S
            </span>
            <span className="text-lg font-bold text-white">
              Academia <span className="text-orange-400">Stampa</span>
            </span>
          </Link>
          <p className="mt-4 max-w-sm leading-relaxed text-zinc-500">
            Formación y herramientas para aprender, organizar y hacer crecer tu taller de impresión 3D.
          </p>
          <Link
            href="/login"
            className="mt-5 inline-block rounded font-medium text-zinc-300 transition-colors hover:text-orange-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400"
          >
            Acceso para miembros
          </Link>
        </div>

        <div>
          <h2 className="font-bold text-white">Comunidad y soporte</h2>
          <ul className="mt-4 space-y-3">
            {socialLinks.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded text-zinc-500 transition-colors hover:text-orange-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="font-bold text-white">Información legal</h2>
          <ul className="mt-4 space-y-3">
            {legalLinks.map((link) => (
              <li key={link.label}>
                {link.href ? (
                  <Link href={link.href} className="text-zinc-500 transition-colors hover:text-orange-400">
                    {link.label}
                  </Link>
                ) : (
                  <span className="text-zinc-600">
                    {link.label} <span className="text-[10px] uppercase tracking-wider">— pendiente</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="container mx-auto mt-10 border-t border-white/8 px-5 pt-6 text-xs text-zinc-600 md:px-6">
        © {new Date().getFullYear()} Academia Stampa.
      </div>
    </footer>
  );
}
