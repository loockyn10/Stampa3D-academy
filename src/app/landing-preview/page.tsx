import type { Metadata } from "next";
import { UniversoHero } from "@/components/landing-hero/UniversoHero";

// Previsualización interna del Hero 3D (Sprint 5.1). No reemplaza a /landing y no se indexa.
export const metadata: Metadata = {
  title: "Universo Stampa | Vista previa del Hero 3D",
  description: "Prototipo del Hero 3D de Universo Stampa.",
  robots: { index: false, follow: false },
};

// `?modelo=lampara` muestra la variante de lámpara de diseño; sin parámetro, el núcleo actual (prueba de comparación).
export default async function LandingPreviewPage({ searchParams }: { searchParams: Promise<{ modelo?: string | string[] }> }) {
  const { modelo } = await searchParams;
  return <UniversoHero model={modelo === "lampara" ? "lampara" : "nucleo"} />;
}
