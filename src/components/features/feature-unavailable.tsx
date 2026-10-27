import Link from "next/link";
import { Hammer } from "lucide-react";

export const FEATURE_UNAVAILABLE_TITLE = "Esta herramienta todavía no está disponible.";
export const FEATURE_UNAVAILABLE_DESCRIPTION = "Estamos trabajando para incorporarla próximamente a Universo Stampa.";

interface FeatureUnavailableProps {
  /** Nombre de la herramienta (ya resuelto desde el registro; nunca texto crudo de la URL). */
  featureName?: string | null;
  homeHref?: string;
}

/** Pantalla reutilizable para herramientas deshabilitadas públicamente. No expone detalles técnicos ni internos. */
export function FeatureUnavailable({ featureName, homeHref = "/" }: FeatureUnavailableProps) {
  return (
    <section
      aria-labelledby="feature-unavailable-title"
      className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 py-12 text-center"
    >
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-stampa-orange/25 bg-stampa-orange/10 text-stampa-orange">
        <Hammer size={28} aria-hidden="true" />
      </div>
      {featureName && (
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-stampa-orange">{featureName}</p>
      )}
      <h1 id="feature-unavailable-title" className="text-xl font-bold text-white sm:text-2xl">
        {FEATURE_UNAVAILABLE_TITLE}
      </h1>
      <p className="mt-3 text-sm text-gray-400">{FEATURE_UNAVAILABLE_DESCRIPTION}</p>
      <Link
        href={homeHref}
        className="mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-stampa-orange px-6 text-sm font-bold text-neutral-950 transition-colors hover:bg-stampa-orange-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange focus-visible:ring-offset-2 focus-visible:ring-offset-stampa-bg"
      >
        Volver a Inicio
      </Link>
    </section>
  );
}
