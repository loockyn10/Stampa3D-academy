import Image from "next/image";

/**
 * Identidad oficial de Universo Stampa (assets generados con scripts/brand/build-brand-assets.mjs desde design/brand/*.svg).
 *
 * - Isotipo: iconos y espacios reducidos. Funciona sobre fondos claros y oscuros.
 * - Logotipo completo: cabeceras y espacios amplios. Su texto es BLANCO: usarlo solo sobre superficies siempre oscuras
 *   (landing, Open Graph). En superficies que siguen el tema claro/oscuro usar el isotipo + el nombre en texto.
 */
export const BRAND_NAME = "Universo Stampa";

const ISOTIPO = { src: "/brand/universo-isotipo.png", width: 512, height: 357 } as const;
const LOGOTIPO = { src: "/brand/universo-logotipo.png", width: 1200, height: 403 } as const;

/** `height` es la altura visible en px; el ancho sale de la proporción real del archivo (no se deforma). */
export function UniversoIsotipo({ height = 32, alt = "", className = "", priority = false }: { height?: number; alt?: string; className?: string; priority?: boolean }) {
  return (
    <Image
      src={ISOTIPO.src}
      alt={alt}
      width={ISOTIPO.width}
      height={ISOTIPO.height}
      priority={priority}
      unoptimized
      style={{ height, width: "auto" }}
      className={`shrink-0 select-none object-contain ${className}`}
    />
  );
}

export function UniversoLogotipo({ height = 44, alt = BRAND_NAME, className = "", priority = false }: { height?: number; alt?: string; className?: string; priority?: boolean }) {
  return (
    <Image
      src={LOGOTIPO.src}
      alt={alt}
      width={LOGOTIPO.width}
      height={LOGOTIPO.height}
      priority={priority}
      unoptimized
      style={{ height, width: "auto" }}
      className={`shrink-0 select-none object-contain ${className}`}
    />
  );
}
