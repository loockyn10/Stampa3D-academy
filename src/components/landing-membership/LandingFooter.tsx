import Link from "next/link";
import { loadPublicCommunityLinks } from "@/lib/community/public";
import { legalLinks } from "./landing-content";

export async function LandingFooter() {
  // Enlaces administrados en /admin/redes-canales (solo los de nivel público llegan a un visitante).
  const { links } = await loadPublicCommunityLinks();
  const communityLinks = links.filter((link) => link.url !== null);

  return (
    <footer className="border-t border-stampa-border bg-stampa-sunken py-12 text-sm">
      <div className="container mx-auto grid gap-10 px-5 md:grid-cols-[1.2fr_0.8fr_0.8fr] md:px-6">
        <div>
          <Link
            href="#inicio"
            className="inline-flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 text-lg font-bold text-white">
              S
            </span>
            <span className="text-lg font-bold text-fg">
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
          <h2 className="font-bold text-fg">Comunidad y soporte</h2>
          {communityLinks.length > 0 && (
            <ul className="mt-4 space-y-3">
              {communityLinks.map((link) => (
                <li key={link.id}>
                  <a
                    href={link.url ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded text-zinc-500 transition-colors hover:text-orange-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400"
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="font-bold text-fg">Información legal</h2>
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
      <div className="container mx-auto mt-10 border-t border-fg/8 px-5 pt-6 text-xs text-zinc-600 md:px-6">
        © {new Date().getFullYear()} Academia Stampa.
      </div>
    </footer>
  );
}
