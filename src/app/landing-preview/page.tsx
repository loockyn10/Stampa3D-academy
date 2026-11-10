import type { Metadata } from "next";
import { UniversoHero } from "@/components/landing-hero/UniversoHero";

// Previsualización interna del Hero 3D y de la primera sección de herramientas (Landing 5.2). No reemplaza a /landing y no se indexa.
export const metadata: Metadata = {
  title: "Universo Stampa | Vista previa del Hero 3D",
  description: "Prototipo del Hero 3D de Universo Stampa.",
  robots: { index: false, follow: false },
};

export default function LandingPreviewPage() {
  return <UniversoHero />;
}
