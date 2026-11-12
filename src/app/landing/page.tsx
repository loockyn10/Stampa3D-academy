import type { Metadata } from "next";
import { CommercialSections } from "@/components/landing-hero/commercial/CommercialSections";
import { UniversoHero } from "@/components/landing-hero/UniversoHero";

export const metadata: Metadata = {
  title: "Universo Stampa | Formación y gestión para impresión 3D",
  description:
    "Aprendé impresión 3D, calculá costos, organizá tu taller y generá presupuestos profesionales desde una sola plataforma.",
};

// Landing definitiva (Hero 3D + secciones comerciales). Se regenera cada 5 minutos: el precio de la membresía y los enlaces
// de comunidad se leen en el servidor (ver commercial/load-membership-price.ts y /admin/redes-canales).
export const revalidate = 300;

export default function LandingPage() {
  return (
    <UniversoHero>
      <CommercialSections />
    </UniversoHero>
  );
}
