import type { Metadata } from "next";
import { LandingMembershipPage } from "@/components/landing-membership/LandingMembershipPage";

// Landing anterior (vigente hasta el lanzamiento): sigue disponible en esta ruta, pero fuera de buscadores.
// La landing definitiva es /landing.
export const metadata: Metadata = {
  title: "Universo Stampa | Landing anterior",
  description: "Versión anterior de la landing de Universo Stampa.",
  robots: { index: false, follow: false },
};

// Los enlaces de comunidad del footer se administran en /admin/redes-canales; la página se regenera cada minuto.
export const revalidate = 60;

export default function LandingOldPage() {
  return <LandingMembershipPage />;
}
