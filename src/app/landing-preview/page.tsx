import type { Metadata } from "next";
import { CommercialSections } from "@/components/landing-hero/commercial/CommercialSections";
import { UniversoHero } from "@/components/landing-hero/UniversoHero";

// Previsualización interna del Hero 3D y de la primera sección de herramientas (Landing 5.2). No reemplaza a /landing y no se indexa.
export const metadata: Metadata = {
  title: "Universo Stampa | Vista previa del Hero 3D",
  description: "Prototipo del Hero 3D de Universo Stampa.",
  robots: { index: false, follow: false },
};

// Se regenera cada 5 minutos: el precio de la membresía y los enlaces de comunidad se leen en el servidor (ver commercial/load-membership-price.ts).
export const revalidate = 300;

export default function LandingPreviewPage() {
  return (
    <UniversoHero>
      <CommercialSections />
    </UniversoHero>
  );
}
